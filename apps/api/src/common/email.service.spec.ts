import { EmailDeliveryError, EmailService, EmailSender } from './email.service';

function senderWith(send: EmailSender['emails']['send']): EmailSender {
  return { emails: { send } };
}

describe('EmailService', () => {
  it('uses explicit mock delivery in non-production when the API key is missing or mock', async () => {
    const send = jest.fn();
    const service = EmailService.forTests({
      apiKey: 're_mock_key',
      nodeEnv: 'development',
      sender: senderWith(send),
    });

    const result = await service.send('user@example.com', 'Hello', '<p>Hi</p>');

    expect(result.mock).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(service.getDeliveryRecords()).toEqual([
      expect.objectContaining({ outcome: 'mock', attempts: 1 }),
    ]);
    expect(service.getCapturedEmails()).toEqual([
      expect.objectContaining({ to: 'user@example.com', html: '<p>Hi</p>', mock: true }),
    ]);
  });

  it('fails closed in production when the provider key is missing or mock', async () => {
    const service = EmailService.forTests({ apiKey: 're_mock_key', nodeEnv: 'production' });

    await expect(service.send('user@example.com', 'Hello', '<p>Hi</p>')).rejects.toMatchObject({
      code: 'missing_production_config',
    });
    expect(service.getDeliveryRecords()).toEqual([
      expect.objectContaining({ outcome: 'failed', errorCode: 'missing_production_config' }),
    ]);
  });

  // Callers keep signup/reset responses generic on mail failure, so a
  // placeholder key on the host must at least be visible in the logs.
  it('logs a missing production key at startup and on every refused send, without the recipient', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const service = EmailService.forTests({ apiKey: '"re_mock_key"', nodeEnv: 'production' });
      expect(error).toHaveBeenCalledWith(expect.stringContaining('[EMAIL CONFIG]'));
      error.mockClear();

      await expect(service.send('person@example.com', 'Hello', '<p>Hi</p>')).rejects.toMatchObject({
        code: 'missing_production_config',
      });
      expect(error).toHaveBeenCalledTimes(1);
      const line = String(error.mock.calls[0][0]);
      expect(line).toContain('missing_production_config');
      expect(line).toContain('***@example.com');
      expect(line).not.toContain('person@');
    } finally {
      error.mockRestore();
    }
  });

  it('does not log a configuration error for a real key or outside production', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      EmailService.forTests({ apiKey: 're_live_key', nodeEnv: 'production', sender: senderWith(jest.fn()) });
      EmailService.forTests({ apiKey: 're_mock_key', nodeEnv: 'development' });
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('throws when the provider result includes an error field instead of treating the call as sent', async () => {
    const send = jest.fn().mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'invalid to' },
    });
    const service = EmailService.forTests({
      apiKey: 're_live_key',
      nodeEnv: 'production',
      sender: senderWith(send),
      maxAttempts: 1,
    });

    await expect(service.send('user@example.com', 'Hello', '<p>Hi</p>')).rejects.toBeInstanceOf(EmailDeliveryError);
    expect(service.getDeliveryRecords()).toEqual([
      expect.objectContaining({ outcome: 'failed', errorCode: 'validation_error', attempts: 1 }),
    ]);
  });

  it('throws when the provider client itself rejects', async () => {
    const send = jest.fn().mockRejectedValue(new Error('network down'));
    const service = EmailService.forTests({
      apiKey: 're_live_key',
      nodeEnv: 'development',
      sender: senderWith(send),
      maxAttempts: 1,
    });

    await expect(service.send('user@example.com', 'Hello', '<p>Hi</p>')).rejects.toMatchObject({
      code: 'provider_exception',
    });
    expect(service.getDeliveryRecords().at(-1)).toEqual(
      expect.objectContaining({ outcome: 'failed', errorCode: 'provider_exception' }),
    );
  });

  it('retries a bounded number of times and succeeds if a later attempt returns an id', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: { id: 'msg_2' }, error: null });
    const service = EmailService.forTests({
      apiKey: 're_live_key',
      nodeEnv: 'production',
      sender: senderWith(send),
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    const result = await service.send('user@example.com', 'Hello', '<p>Hi</p>');

    expect(result).toEqual({ id: 'msg_2', mock: false });
    expect(send).toHaveBeenCalledTimes(2);
    expect(service.getDeliveryRecords()).toEqual([
      expect.objectContaining({ outcome: 'sent', attempts: 2 }),
    ]);
  });

  it('does not capture message bodies in production', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'msg_prod' }, error: null });
    const service = EmailService.forTests({
      apiKey: 're_live_key',
      nodeEnv: 'production',
      sender: senderWith(send),
      maxAttempts: 1,
    });

    await service.send('user@example.com', 'Hello', '<p>secret-link</p>');
    expect(service.getCapturedEmails()).toEqual([]);
  });
});
