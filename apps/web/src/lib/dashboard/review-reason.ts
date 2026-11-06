/**
 * Why a prepared application is in the review queue, from facts the server recorded: which of the candidate's own role and city rules the
 * posting meets, and which of the vacancy's keywords the profile shows. A keyword the profile does not show is "not evidenced in your
 * profile", never "you lack it".
 */
const fold = (v: string) => v.toLocaleLowerCase('az').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/ə/g, 'e');

export interface ReviewReason { roles: string[]; cities: string[]; evidenced: string[]; notEvidenced: string[] }

export function reviewReason(input: { title: string; rules: { allowedRoles: string[]; allowedLocations: string[] } | null; match?: { matchedKeywords?: unknown; gaps?: unknown } | null }): ReviewReason {
  const title = fold(input.title);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 6) : []);
  return {
    roles: (input.rules?.allowedRoles ?? []).filter((r) => title.includes(fold(r))),
    cities: input.rules?.allowedLocations ?? [],
    evidenced: list(input.match?.matchedKeywords),
    notEvidenced: list(input.match?.gaps),
  };
}
