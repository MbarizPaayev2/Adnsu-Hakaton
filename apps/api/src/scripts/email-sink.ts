/**
 * Local e-mail sink for development: a loopback server that speaks the provider's send API,
 * captures every message (open http://127.0.0.1:4599/ to read them) and can emit signed
 * webhook events to the local API. It never sends anything anywhere. Refuses to run in production.
 */
import { FakeProvider } from '../email-applications/fake-provider';
import { isLoopbackUrl } from '../email-applications/email-apply.config';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('The local e-mail sink must not run in production');
  const port = Number(process.env.EMAIL_SINK_PORT || 4599);
  const webhookUrl = process.env.EMAIL_SINK_WEBHOOK_URL || 'http://127.0.0.1:4000/webhooks/resend';
  if (!isLoopbackUrl(webhookUrl)) throw new Error('Sink webhooks may only target a loopback API');
  const provider = new FakeProvider();
  const secret = process.env.EMAIL_APPLY_WEBHOOK_SECRET;
  if (secret?.startsWith('whsec_')) provider.webhook = { url: webhookUrl, secret };
  const url = await provider.start(port);
  console.log(`Local e-mail sink listening on ${url} (webhooks ${provider.webhook ? 'enabled' : 'disabled: set EMAIL_APPLY_WEBHOOK_SECRET'})`);
}
if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : 'Sink failed'); process.exitCode = 1; });
