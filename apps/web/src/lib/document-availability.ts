/** Public server capabilities, read afresh so a rollout or rollback changes the landing copy too. Unknown is null, never "on". */
async function capability(key: 'documentGenerationEnabled' | 'emailApplicationsEnabled' | 'emailAutomationEnabled'): Promise<boolean | null> {
  try {
    const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
    const response = await fetch(`${base}/billing/status`, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.[key] === 'boolean' ? data[key] : null;
  } catch { return null; }
}

export const documentAvailability = () => capability('documentGenerationEnabled');
export const emailApplicationAvailability = () => capability('emailApplicationsEnabled');
export const emailAutomationAvailability = () => capability('emailAutomationEnabled');
