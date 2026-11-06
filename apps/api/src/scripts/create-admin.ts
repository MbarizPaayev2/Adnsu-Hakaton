/**
 * Creates a NEW admin operator out-of-band (operators otherwise join only
 * through a SUPER_ADMIN's invitation). It never modifies an existing account
 * — use admin-recover.ts for recovery — and the password is typed at a hidden
 * prompt, never passed in argv/env/shell history.
 *
 *   npm run script:create-admin -- --email ops@company.com [--role SUPPORT|ADMIN]
 *   (production container: npm run script:create-admin:prod -- --email ...)
 *
 * SUPER_ADMIN can only be created here when no active SUPER_ADMIN exists
 * (first bootstrap); afterwards a SUPER_ADMIN grants it in the admin panel.
 * Uses a bare Prisma client, not the whole AppModule and its processors.
 */
import { PrismaClient, AdminRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { argValue, newPasswordTwice } from './admin-cli.util';

async function main() {
  const email = (argValue('email') || '').trim().toLowerCase();
  const role = (argValue('role') || 'SUPPORT') as AdminRole;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: --email you@company.com [--role SUPPORT|ADMIN|SUPER_ADMIN]');
  if (!['SUPER_ADMIN', 'ADMIN', 'SUPPORT'].includes(role)) throw new Error('Unknown role');

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.adminUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (existing) throw new Error('An operator with this email already exists; nothing was changed. Use admin-recover for recovery.');
    if (role === 'SUPER_ADMIN' && (await prisma.adminUser.count({ where: { role: 'SUPER_ADMIN', disabledAt: null } })) > 0) {
      throw new Error('A SUPER_ADMIN already exists; grant further SUPER_ADMIN roles in the admin panel.');
    }
    const hashedPassword = await bcrypt.hash(await newPasswordTwice(), 12);
    const created = await prisma.adminUser.create({ data: { email, hashedPassword, role, passwordChangedAt: new Date() } });
    await prisma.adminAuditLog.create({ data: { adminUserId: null, action: 'ADMIN_CREATED_VIA_CLI', targetType: 'AdminUser', targetId: created.id, metadata: { email, role } } });
    console.log(`Created ${role} operator ${email} (id ${created.id}). Enrol MFA after the first login.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
