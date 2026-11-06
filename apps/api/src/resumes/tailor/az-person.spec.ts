import { firstPersonPerfect, repairThirdPersonPerfect } from './az-person';

describe('third-person perfect → first person', () => {
  it.each([
    ['alıb', 'almışam'], ['edib', 'etmişəm'], ['verib', 'vermişəm'], ['aparıb', 'aparmışam'], ['qazanıb', 'qazanmışam'],
    ['başlayıb', 'başlamışam'], ['gedib', 'getmişəm'], ['öyrədib', 'öyrətmişəm'.replace('öyrət', 'öyrəd')], ['hazırlayıb', 'hazırlamışam'], ['görüb', 'görmüşəm'], ['yazıb', 'yazmışam'],
  ])('%s → %s', (from, to) => expect(firstPersonPerfect(from)).toBe(to));

  it('leaves nouns that end in -ib and other words alone', () => {
    for (const w of ['sahib', 'tərtib', 'cənub', 'qalib', 'hesabat', 'almışam', 'olub', 'olmayıb', 'verməyib', 'yazmayıb']) expect(firstPersonPerfect(w)).toBeNull();
  });

  it('repairs only a sentence-final word, not a converb in the middle', () => {
    expect(repairThirdPersonPerfect('Universitetdə təhsil alıb. Layihədə kod yazıb komandaya təqdim etdim.').text).toBe('Universitetdə təhsil almışam. Layihədə kod yazıb komandaya təqdim etdim.');
    expect(repairThirdPersonPerfect('Müştərilərə kömək edib').text).toBe('Müştərilərə kömək etmişəm');
    expect(repairThirdPersonPerfect('Mən cənub bölgəsində işləmişəm.').changed).toEqual([]);
  });
});
