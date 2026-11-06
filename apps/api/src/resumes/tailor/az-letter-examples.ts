/**
 * Fictional style demonstrations adapted from the founder's v2 package.
 * Every candidate claim is explicit in its example input; no founder facts or
 * personal letters are included. These are prompt examples, not training data
 * or independent native-reader approval. Evaluation inputs stay separate.
 */
export const AZ_LETTER_STYLE_EXAMPLES = [
  {
    position: 'Satış məsləhətçisi', company: 'Nümunə Mağaza',
    motivation: 'Alıcılara məhsul seçimində kömək etmək istəyirəm.',
    evidence: [
      { id: 'E1', kind: 'experience', text: 'Ailə mağazasında üç ay kassada kömək etdim və qaytarma qaydalarını öyrəndim.' },
      { id: 'E2', kind: 'education', text: 'Mühasibatlıq üzrə son kurs tələbəsiyəm.' },
    ],
    paragraphs: [
      { text: 'Ailə mağazasında üç ay kassada kömək etdim və qaytarma qaydalarını öyrəndim. Nümunə Mağaza şirkətinin Satış məsləhətçisi vəzifəsinə müraciət edirəm.', uses: ['E1'] },
      { text: 'Hazırda mühasibatlıq üzrə son kurs tələbəsiyəm. Alıcılara məhsul seçimində kömək etmək istəyirəm.', uses: ['E2', 'motivation'] },
    ],
  },
  {
    position: 'Müştəri xidməti üzrə təcrübəçi', company: 'Nümunə Bank',
    motivation: 'Mobil bankçılıqla bağlı müştəri suallarını cavablandırmağı öyrənmək istəyirəm.',
    evidence: [
      { id: 'E1', kind: 'activity', text: 'Universitetin qəbul günündə 40-dan çox qonağın qeydiyyatına kömək etdim.' },
      { id: 'E2', kind: 'education', text: 'Biznesin idarə edilməsi üzrə ikinci kurs tələbəsiyəm.' },
    ],
    paragraphs: [
      { text: 'Nümunə Bank şirkətində Müştəri xidməti üzrə təcrübəçi vəzifəsinə müraciət edirəm. Mobil bankçılıqla bağlı müştəri suallarını cavablandırmağı öyrənmək istəyirəm.', uses: ['motivation'] },
      { text: 'Biznesin idarə edilməsi üzrə ikinci kursda oxuyuram. Universitetin qəbul günündə 40-dan çox qonağın qeydiyyatına kömək etdim.', uses: ['E1', 'E2'] },
    ],
  },
];

export const AZ_LETTER_EXAMPLE_INSTRUCTION = [
  'The following are short STYLE DEMONSTRATIONS about OTHER FICTIONAL candidates, not evidence about the current candidate.',
  'Notice the concrete facts, retained helper roles and modest use of a stated motivation. The retail example deliberately removes unsupported actions from its source demonstration.',
  'Do not borrow any example name, number, experience or motivation. Do not repeat a fixed opening. Use only the current user input as candidate evidence; examples never support a claim.',
  'These examples are shorter than the usual target because their evidence is sparse; never pad a letter or equate length with quality.',
  JSON.stringify(AZ_LETTER_STYLE_EXAMPLES),
].join('\n');
