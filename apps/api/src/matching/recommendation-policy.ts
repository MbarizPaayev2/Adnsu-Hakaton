/** Shared admission gate for new matches and delayed notifications.
 * A high aggregate score cannot override an explicit occupation mismatch,
 * location mismatch, work-arrangement mismatch, or seniority mismatch.
 * Old deterministic results lack the flag, but expose a known zero role fit.
 * Do not infer a mismatch from absent legacy details.
 */
export function isRecommendationRelevant(details: unknown): boolean {
  const breakdown = (details as {
    breakdown?: {
      filters?: Record<string, boolean>;
      mode?: string;
      roleFit?: number;
    };
  } | null)?.breakdown;

  const filters = breakdown?.filters;
  if (filters?.role_relevant === false) return false;
  if (filters?.recommendation_eligible === false) return false;
  if (filters?.location === false || filters?.location_ok === false) return false;
  if (filters?.work_arrangement === false || filters?.work_arrangement_ok === false) return false;
  if (filters?.seniority === false || filters?.seniority_ok === false) return false;
  if (
    filters?.citizenship === false ||
    filters?.work_authorisation === false ||
    filters?.work_authorization === false
  ) return false;

  if (filters?.role_relevant === true) return true;
  return !(breakdown?.mode?.startsWith('rules') && breakdown.roleFit === 0);
}
