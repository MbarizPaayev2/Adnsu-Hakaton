import { bulletVoice, finiteForm, toFirstPersonText } from './az-voice';

describe('az-voice', () => {
  it('reads the person of regular finite verbs and leaves nouns alone', () => {
    expect(finiteForm('hazırladı')).toEqual({ person: 'third', tense: 'past' });
    expect(finiteForm('hazırladım')).toEqual({ person: 'first', tense: 'past' });
    expect(finiteForm('edir')).toEqual({ person: 'third', tense: 'present' });
    expect(finiteForm('hazırlayır')).toEqual({ person: 'third', tense: 'present' });
    expect(finiteForm('hazırlayıram')).toEqual({ person: 'first', tense: 'present' });
    expect(finiteForm('müdir')).toBeNull();
    expect(finiteForm('tədbir')).toBeNull();
    expect(finiteForm('hesabatlar')).toBeNull();
    expect(finiteForm('olunur')).toBeNull(); // passive: the subject is not the candidate
    expect(finiteForm('edilir')).toBeNull();
    expect(finiteForm('uyğundur')).toBeNull(); // copula
    expect(finiteForm('azaldı')).toBeNull(); // not a personal action
    expect(finiteForm('bağlandı')).toBeNull(); // passive
  });

  it('classifies bullets', () => {
    expect(bulletVoice('Müştərilərin sənədlərini qəbul edib sistemə daxil etdim')).toBe('first');
    expect(bulletVoice('Gündə təxminən 40 sənədi yoxlayırdım')).toBe('first');
    expect(bulletVoice('Müştərilərin sənədlərini qəbul edib sistemə daxil etdi')).toBe('third');
    expect(bulletVoice('Tərcümələrin redaktəsini aparır')).toBe('third');
    expect(bulletVoice('Excel və SQL bilikləri')).toBe('none');
    expect(bulletVoice('Hesabatlar hazırladım, tərcümələri redaktə edir')).toBe('mixed');
  });

  it('converts third-person bullets to the first person, past and present', () => {
    expect(toFirstPersonText('Müştərilərin sənədlərini qəbul edib sistemə daxil etdi').text).toBe('Müştərilərin sənədlərini qəbul edib sistemə daxil etdim');
    expect(toFirstPersonText('Gündə təxminən 40 sənədi yoxladı').text).toBe('Gündə təxminən 40 sənədi yoxladım');
    expect(toFirstPersonText('Ayda təxminən 120 səhifə tərcümə edir').text).toBe('Ayda təxminən 120 səhifə tərcümə edirəm');
    expect(toFirstPersonText('Hüquqi sənədləri tərcümə edir və redaktəsini aparır').text).toBe('Hüquqi sənədləri tərcümə edirəm və redaktəsini aparıram');
    expect(toFirstPersonText('Hesabat paneli hazırlayır').text).toBe('Hesabat paneli hazırlayıram');
    expect(toFirstPersonText('Cədvəlləri yeniləyir və hesabatları təqdim edir').text).toBe('Cədvəlləri yeniləyirəm və hesabatları təqdim edirəm');
    expect(toFirstPersonText('Sənədləri yoxlayıb təsdiq edib').text).toBe('Sənədləri yoxlayıb təsdiq etmişəm');
    expect(toFirstPersonText('Xərclər azaldı').changed).toEqual([]);
    expect(toFirstPersonText('95K+ müştəri üçün RFM iş axını və 13M gəlir əhatə edən Power BI paneli qurdu').text).toBe('95K+ müştəri üçün RFM iş axını və 13M gəlir əhatə edən Power BI paneli qurdum');
  });
});
