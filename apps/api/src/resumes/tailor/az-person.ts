import { firstPersonPerfect } from './az-voice';
export { firstPersonPerfect } from './az-voice';

/**
 * A letter is the candidate's own "mən". Models given third-person evidence ("təhsil alıb", "kömək edib") often copy the third-person perfect. The first-person
 * equivalent is regular: the stem + -mış/-miş/-muş/-müş + -am/-əm ("almışam", "etmişəm"), so a sentence-final -ıb/-ib/-ub/-üb is repaired in place instead of
 * costing a whole draft. Only a sentence-final word is touched (a converb in the middle of a sentence, "yazıb təqdim etdim", is correct as it is), and a
 * noun that merely ends in -ib (sahib, tərtib, cənub) is left alone.
 */
export function repairThirdPersonPerfect(text: string): { text: string; changed: { from: string; to: string }[] } {
  const changed: { from: string; to: string }[] = [];
  const out = String(text ?? '').replace(/(?<![\p{L}\p{N}-])(\p{Ll}{3,})(?=\s*(?:[.!?](?:\s|$)|$))/gu, (whole, word: string) => {
    const to = firstPersonPerfect(word);
    if (!to) return whole;
    changed.push({ from: word, to });
    return to;
  });
  return { text: out, changed };
}
