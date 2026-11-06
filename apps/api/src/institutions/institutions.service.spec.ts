import { InstitutionsService } from './institutions.service';

const make = () => {
  const prisma = { institutionEnquiry: { create: jest.fn(async ({ data }) => ({ id: 'e1', ...data })) } };
  const email = { send: jest.fn(async () => ({ ok: true })) };
  const config = { get: jest.fn(() => undefined) };
  return { svc: new InstitutionsService(prisma as any, email as any, config as any), prisma, email };
};
const base = { organization: 'Example Academy', contactName: 'Aysel Example', email: 'Aysel@Example.test', consent: true as const };

describe('institution pilot enquiries', () => {
  it('stores the enquiry and notifies the team with escaped fields', async () => {
    const { svc, prisma, email } = make();
    await expect(svc.enquire({ ...base, cohortSize: 30, timing: 'next_month', message: '<b>30 graduates</b>' })).resolves.toEqual({ received: true });
    expect(prisma.institutionEnquiry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'aysel@example.test', cohortSize: 30, timing: 'next_month' }) });
    const [to, subject, html] = email.send.mock.calls[0] as unknown as [string, string, string];
    expect(to).toBe('ceo@aisehr.com');
    expect(subject).toContain('Example Academy');
    expect(html).toContain('&lt;b&gt;30 graduates&lt;/b&gt;');
  });

  it('answers a filled honeypot the same way and stores nothing', async () => {
    const { svc, prisma, email } = make();
    await expect(svc.enquire({ ...base, website: 'spam.example' })).resolves.toEqual({ received: true });
    expect(prisma.institutionEnquiry.create).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('keeps the enquiry when the notice fails', async () => {
    const { svc, email } = make();
    email.send.mockRejectedValueOnce(new Error('provider down'));
    await expect(svc.enquire(base)).resolves.toEqual({ received: true });
  });
});
