/**
 * Private, interactive recovery for an EXISTING admin operator (e.g. the
 * founder who lost the password or the authenticator). Run by someone with
 * direct server access; nothing here is reachable over the network.
 *
 *   npm run script:admin-recover -- --email ceo@aisehr.com
 *   (production container: npm run script:admin-recover:prod -- --email ...)
 *
 * Asks, one by one, whether to set a new password (hidden prompt) and whether
 * to clear MFA; always ends every session of that operator and writes an
 * audit entry. It never creates accounts or changes roles.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { argValue, newPasswordTwice, prompt } from './admin-cli.util';

async function main() {
  const email = (argValue('email') || '').trim().toLowerCase();
  if (!email) throw new Error('Usage: --email operator@company.com');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.adminUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (!user) throw new Error('No operator with this email; nothing was changed.');
    console.log(`Operator ${user.email}: role ${user.role}, MFA ${user.mfaEnabledAt ? 'enabled' : 'not enabled'}${user.disabledAt ? ', DISABLED' : ''}.`);

    const changes: string[] = [];
    const data: Record<string, unknown> = {};
    if ((await prompt('Set a new password? [y/N] ')).toLowerCase() === 'y') {
      data.hashedPassword = await bcrypt.hash(await newPasswordTwice(), 12);
      data.passwordChangedAt = new Date();
      changes.push('password');
    }
    if (user.mfaEnabledAt && (await prompt('Clear MFA so it can be enrolled again? [y/N] ')).toLowerCase() === 'y') {
      Object.assign(data, { mfaEnabledAt: null, mfaSecretEnc: null, mfaRecoveryCodeHashes: [], mfaLastUsedStep: null });
      changes.push('mfa');
    }
    if (user.disabledAt && (await prompt('Re-enable this operator? [y/N] ')).toLowerCase() === 'y') {
      data.disabledAt = null;
      changes.push('enabled');
    }
    if ((await prompt(`Apply [${changes.join(', ') || 'end sessions only'}] and end all sessions? Type the email to confirm: `)).toLowerCase() !== user.email.toLowerCase()) {
      throw new Error('Not confirmed; nothing was changed.');
    }
    await prisma.$transaction([
      prisma.adminUser.update({ where: { id: user.id }, data }),
      prisma.adminSession.deleteMany({ where: { adminUserId: user.id } }),
      prisma.adminLoginChallenge.deleteMany({ where: { adminUserId: user.id } }),
      prisma.adminAuditLog.create({ data: { adminUserId: null, action: 'ADMIN_RECOVERED_VIA_CLI', targetType: 'AdminUser', targetId: user.id, metadata: { changes } } }),
    ]);
    console.log(`Done: ${changes.join(', ') || 'no account changes'}; all sessions ended.${changes.includes('mfa') ? ' Enrol MFA again right after logging in.' : ''}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
