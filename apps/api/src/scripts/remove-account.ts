/**
 * Removes the account(s) of ONE e-mail address: the candidate account (through the same deletion path as self-service and the admin panel: billing is
 * stopped first, owned rows and files go, nothing unrelated) and/or the operator account (its sessions go with it). Run by someone with direct server
 * access; nothing here is reachable over the network. Written because the admin panel cannot be driven without the founder's second factor.
 *
 *   npm run script:remove-account -- --email person@example.com --confirm person@example.com
 *   (production container: npm run script:remove-account:prod -- --email ... --confirm ...)
 *
 * Without --confirm (which must repeat the address exactly) it only reports what it found. The founder address and the last active super-admin are
 * refused. One audit entry (actor: none, "via CLI") is written per removed account and survives it.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/database.service';
import { AccountDeletionService } from '../accounts/account-deletion.service';
import { FOUNDER_EMAIL } from '../admin/permissions';
import { argValue } from './admin-cli.util';

const mask = (email: string) => `${email.slice(0, 1)}***@${email.split('@')[1] ?? ''}`;

async function main() {
  const email = (argValue('email') || '').trim().toLowerCase();
  const confirm = (argValue('confirm') || '').trim().toLowerCase();
  if (!email) throw new Error('Usage: --email person@example.com [--confirm person@example.com]');
  if (email === FOUNDER_EMAIL) throw new Error('The founder address is never removed by this script.');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const deletion = app.get(AccountDeletionService);
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, createdAt: true } });
    const operator = await prisma.adminUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, role: true, disabledAt: true } });
    console.log(`Candidate account: ${user ? `found (created ${user.createdAt.toISOString().slice(0, 10)})` : 'none'}`);
    console.log(`Operator account: ${operator ? `found (${operator.role}${operator.disabledAt ? ', disabled' : ''})` : 'none'}`);
    if (!user && !operator) return;
    if (confirm !== email) {
      console.log('Nothing was changed. Repeat the address with --confirm to remove.');
      return;
    }

    if (operator?.role === 'SUPER_ADMIN' && !operator.disabledAt) {
      const others = await prisma.adminUser.count({ where: { role: 'SUPER_ADMIN', disabledAt: null, id: { not: operator.id } } });
      if (others === 0) throw new Error('This is the last active super-admin; nothing was changed.');
    }
    if (user) {
      await deletion.deleteUser(user.id, { kind: 'self' });
      await prisma.adminAuditLog.create({ data: { adminUserId: null, action: 'USER_DELETED', targetType: 'User', targetId: user.id, metadata: { email: mask(email), via: 'cli', authorizedBy: 'founder' } } });
      console.log('Candidate account removed (billing stopped, sessions and owned records deleted).');
    }
    if (operator) {
      await prisma.$transaction([
        prisma.adminInvitation.updateMany({ where: { email: { equals: email, mode: 'insensitive' }, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
        prisma.adminAuditLog.create({ data: { adminUserId: null, action: 'ADMIN_REMOVED', targetType: 'AdminUser', targetId: operator.id, metadata: { email: mask(email), role: operator.role, via: 'cli', authorizedBy: 'founder' } } }),
        prisma.adminUser.delete({ where: { id: operator.id } }),
      ]);
      console.log('Operator account removed (its sessions and login challenges went with it).');
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
