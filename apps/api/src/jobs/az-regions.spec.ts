import { classifyLocation } from './az-regions';
import { vacancySegments } from './vacancy-segments';

describe('classifyLocation', () => {
  it.each([
    ['Bakı', 'Bakı', 'Bakı'],
    ['Baku, Azerbaijan', 'Bakı', 'Bakı'],
    ['BAKI şəhəri, Nəsimi r.', 'Bakı', 'Bakı'],
    ['Sumgait', 'Sumqayıt', 'Abşeron-Xızı'],
    ['Gəncə', 'Gəncə', 'Gəncə-Daşkəsən'],
    ['Lankaran', 'Lənkəran', 'Lənkəran-Astara'],
    ['Sheki', 'Şəki', 'Şəki-Zaqatala'],
    ['Şəki filialı', 'Şəki', 'Şəki-Zaqatala'],
    ['Naxçıvan MR', 'Naxçıvan', 'Naxçıvan'],
    ['Qusar filialı', 'Qusar', 'Quba-Xaçmaz'],
    ['Ağcabədi', 'Ağcabədi', 'Qarabağ'],
    ['Mingachevir', 'Mingəçevir', 'Mərkəzi Aran'],
  ])('%s → %s (%s)', (input, place, region) => {
    expect(classifyLocation(input)).toEqual({ place, region });
  });

  it('never assumes Bakı for a country-only, remote or empty location', () => {
    for (const loc of ['Azerbaijan', 'Azərbaycan', 'Remote', '', null, undefined]) expect(classifyLocation(loc)).toEqual({ place: null, region: null });
  });

  it('takes the first place named and does not match inside other words', () => {
    expect(classifyLocation('Gəncə, Bakı')).toEqual({ place: 'Gəncə', region: 'Gəncə-Daşkəsən' });
    expect(classifyLocation('Qaxacaq')).toEqual({ place: null, region: null });
  });
});

describe('vacancySegments', () => {
  it('reads segments from the posting words, with Azerbaijani case endings', () => {
    expect(vacancySegments('İngilis dili müəllimi')).toEqual(['education']);
    expect(vacancySegments('Yük maşını sürücüsü')).toEqual(['trades']);
    expect(vacancySegments('Summer Internship Programme 2026')).toEqual(['internship']);
    expect(vacancySegments('Satış məsləhətçisi', 'Yarımştat iş qrafiki')).toEqual(['part-time', 'retail']);
    expect(vacancySegments('Həkim-terapevt')).toEqual(['health']);
  });

  it('does not over-match look-alike words', () => {
    expect(vacancySegments('International Sales Manager')).toEqual([]);
    expect(vacancySegments('Texniki dəstək mütəxəssisi')).toEqual([]);
  });
});
