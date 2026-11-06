import { createHash } from 'node:crypto';
import { activePlanOverrides, effectivePlan } from '../billing/entitlement';
import type { PrismaService } from '../database/database.service';

export async function premiumEmailAccess(
  db: PrismaService,
  userId: string,
  now = new Date(),
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { subscription: true, planOverrides: activePlanOverrides(now) },
  });
  return { user, included: effectivePlan(user, now) === 'PREMIUM' };
}

/** Name is decorative; the user-specific suffix prevents collisions and reserved-mailbox impersonation. */
export function candidateAlias(
  name: string,
  userId: string,
  suffixLength = 10,
): string {
  const fold = name
    .toLocaleLowerCase('az')
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  const words = fold
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const label = (
    words.length > 1
      ? `${words[0]}.${words[words.length - 1]}`
      : words[0] || 'candidate'
  )
    .slice(0, 28)
    .replace(/\.+$/, '');
  return `${label}.${createHash('sha256').update(userId).digest('hex').slice(0, suffixLength)}@aisehr.com`;
}

export async function senderAlias(
  db: PrismaService,
  userId: string,
  name: string,
): Promise<string | null> {
  const { user, included } = await premiumEmailAccess(db, userId);
  if (!included || !user?.emailVerified) return null;
  if (user.candidateMailAlias) return user.candidateMailAlias;
  const address = candidateAlias(name, userId);
  try {
    await db.user.updateMany({
      where: { id: userId, candidateMailAlias: null },
      data: { candidateMailAlias: address },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    // Extremely rare short-suffix collision; the unique index remains the authority.
    await db.user.updateMany({
      where: { id: userId, candidateMailAlias: null },
      data: { candidateMailAlias: candidateAlias(name, userId, 32) },
    });
  }
  return (
    (
      await db.user.findUnique({
        where: { id: userId },
        select: { candidateMailAlias: true },
      })
    )?.candidateMailAlias ?? null
  );
}
