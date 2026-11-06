import { needsMfaSession, permissionsFor, roleCan } from './permissions';

describe('admin permission matrix', () => {
  it('lets SUPPORT only read', () => {
    expect(permissionsFor('SUPPORT')).toEqual(['self', 'companies.read', 'users.read', 'vacancies.read', 'ops.read', 'listings.read', 'applications.read']);
  });

  it('keeps operator management, deletion and system actions with SUPER_ADMIN, behind a verified second factor', () => {
    for (const p of ['operators.manage', 'users.delete', 'companies.delete'] as const) {
      expect(roleCan('SUPER_ADMIN', p)).toBe(true);
      expect(roleCan('ADMIN', p)).toBe(false);
      expect(roleCan('SUPPORT', p)).toBe(false);
      expect(needsMfaSession(p)).toBe(true);
    }
  });

  it('lets the founder role remove employers and vacancies, ADMIN only vacancies, both behind a verified second factor', () => {
    expect(roleCan('SUPER_ADMIN', 'vacancies.remove')).toBe(true);
    expect(roleCan('ADMIN', 'vacancies.remove')).toBe(true);
    expect(roleCan('SUPPORT', 'vacancies.remove')).toBe(false);
    expect(roleCan('ADMIN', 'companies.delete')).toBe(false);
    expect(needsMfaSession('vacancies.remove')).toBe(true);
  });

  it('lets ADMIN run bounded operations but SUPPORT only read them', () => {
    for (const p of ['ops.control', 'listings.moderate', 'users.suspend'] as const) {
      expect(roleCan('ADMIN', p)).toBe(true);
      expect(roleCan('SUPPORT', p)).toBe(false);
    }
  });

  it('lets ADMIN moderate and change plans but not manage operators', () => {
    expect(roleCan('ADMIN', 'companies.moderate')).toBe(true);
    expect(roleCan('ADMIN', 'users.plan')).toBe(true);
    expect(roleCan('ADMIN', 'audit.read')).toBe(true);
    expect(roleCan('SUPPORT', 'audit.read')).toBe(false);
  });

  it('limits academy sponsorship provisioning to platform admins with a verified second factor', () => {
    expect(roleCan('SUPER_ADMIN', 'academy.sponsorship')).toBe(true);
    expect(roleCan('ADMIN', 'academy.sponsorship')).toBe(true);
    expect(roleCan('SUPPORT', 'academy.sponsorship')).toBe(false);
    expect(needsMfaSession('academy.sponsorship')).toBe(true);
  });

  it('denies unknown permissions', () => {
    expect(roleCan('SUPER_ADMIN', 'does.not.exist' as any)).toBe(false);
  });
});
