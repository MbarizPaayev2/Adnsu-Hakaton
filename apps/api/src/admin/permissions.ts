import { SetMetadata } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';

/**
 * Server-enforced administrator permission matrix. Every admin route must
 * declare one permission with @AdminPermission(); AdminSessionGuard refuses
 * a route that declares none (default deny).
 */
export type AdminPermissionName =
  | 'self'                // own account: profile, password, sessions, MFA
  | 'companies.read'
  | 'companies.moderate'
  | 'users.read'
  | 'users.plan'
  | 'academy.sponsorship'
  | 'users.delete'
  | 'vacancies.read'
  | 'audit.read'
  | 'ops.read'            // overview, health, imports, queues, feature switches
  | 'ops.control'         // bounded operational actions (pause, safe retry, import)
  | 'listings.read'
  | 'listings.moderate'
  | 'applications.read'
  | 'users.suspend'
  | 'companies.delete'    // removes an employer account with its company profile and vacancies: MFA session required
  | 'vacancies.remove'    // takes an employer vacancy off the platform (soft: applications are kept): MFA session required
  | 'payments.refund'     // sends a refund to the payment provider (moves money): MFA session required
  | 'operators.manage';

const MATRIX: Record<AdminPermissionName, readonly AdminRole[]> = {
  self: ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  'companies.read': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  'companies.moderate': ['SUPER_ADMIN', 'ADMIN'],
  'users.read': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  'users.plan': ['SUPER_ADMIN', 'ADMIN'],
  'academy.sponsorship': ['SUPER_ADMIN', 'ADMIN'],
  'users.delete': ['SUPER_ADMIN'],
  'companies.delete': ['SUPER_ADMIN'],
  'vacancies.remove': ['SUPER_ADMIN', 'ADMIN'],
  'vacancies.read': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  'audit.read': ['SUPER_ADMIN', 'ADMIN'],
  'ops.read': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  'ops.control': ['SUPER_ADMIN', 'ADMIN'],
  'listings.read': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  'listings.moderate': ['SUPER_ADMIN', 'ADMIN'],
  'applications.read': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  'users.suspend': ['SUPER_ADMIN', 'ADMIN'],
  'payments.refund': ['SUPER_ADMIN', 'ADMIN'],
  'operators.manage': ['SUPER_ADMIN'],
};

/** Permissions that also need a session whose second factor was verified. */
const NEEDS_MFA_SESSION = new Set<AdminPermissionName>(['users.delete', 'companies.delete', 'vacancies.remove', 'operators.manage', 'payments.refund', 'academy.sponsorship']);

export function roleCan(role: AdminRole, permission: AdminPermissionName): boolean {
  return MATRIX[permission]?.includes(role) ?? false;
}

export function needsMfaSession(permission: AdminPermissionName): boolean {
  return NEEDS_MFA_SESSION.has(permission);
}

export function permissionsFor(role: AdminRole): AdminPermissionName[] {
  return (Object.keys(MATRIX) as AdminPermissionName[]).filter((p) => roleCan(role, p));
}

export const ADMIN_PERMISSION_KEY = 'adminPermission';
export const AdminPermission = (permission: AdminPermissionName) => SetMetadata(ADMIN_PERMISSION_KEY, permission);

/** The founder address designated by the reviewed migration (never inferred at runtime). */
export const FOUNDER_EMAIL = 'ceo@aisehr.com';
