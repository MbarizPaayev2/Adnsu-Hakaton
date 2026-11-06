/** Browsing labels inferred from public job titles, never used as match scores.
 * Unrecognised titles remain visible under Other. No paid classifier is used. */
export const JOB_CATEGORIES = [
  { key: 'technology', label: 'IT və texnologiya', pattern: 'developer|software|devops|backend|frontend|full.?stack|proqram|informasiya texnolog|sistem admin|kiber|cyber|\\mit\\M|\\mqa\\M|data|analyst|analitik' },
  { key: 'finance', label: 'Maliyyə və mühasibat', pattern: 'muhasib|maliyye|account|audit|kredit|credit|bank|sigorta|insurance|treasury|finance|xezine' },
  { key: 'hr', label: 'İnsan resursları', pattern: '\\mhr\\M|insan resurs|human resource|recruit|talent|kadr' },
  { key: 'legal', label: 'Hüquq', pattern: 'huquq|legal|lawyer|vekil|advokat' },
  { key: 'medical', label: 'Tibb və səhiyyə', pattern: 'hekim|tibb|sehiyye|doctor|nurse|ecza|pharma|stomatoloq|tibb baci' },
  { key: 'education', label: 'Təhsil və təlim', pattern: 'muellim|teacher|telim|tutor|lecturer|educat|tehsil|kindergarten' },
  { key: 'sales', label: 'Satış və marketinq', pattern: 'satis|sales|market|merchand|ticaret|kommersiya|commercial' },
  { key: 'design', label: 'Dizayn və yaradıcılıq', pattern: 'dizayn|design|qrafik|graphic|copywriter|mezmun|content|animator|video|redaktor' },
  { key: 'agriculture', label: 'Kənd təsərrüfatı', pattern: 'aqro|agro|agron|kend teserrufat|ferma|tractor|traktor' },
  { key: 'engineering', label: 'Mühəndislik və istehsalat', pattern: 'muhendis|engineer|insaat|construction|elektrik|mexanik|mechanic|istehsal|qaynaq|texnik' },
  { key: 'logistics', label: 'Logistika və nəqliyyat', pattern: 'logisti|anbar|warehouse|surucu|driver|neqliyyat|transport|techizat|procurement|kuryer|delivery' },
  { key: 'hospitality', label: 'Turizm və xidmət', pattern: 'otel|hotel|ofisiant|waiter|receps|reception|barista|chef|aspaz|restoran|restaurant|turizm|touris|housekeep|xadime|cleaner' },
  { key: 'security', label: 'Mühafizə və təhlükəsizlik', pattern: 'muhafize|security|tehlukesizlik' },
  { key: 'administration', label: 'İnzibati və ofis', pattern: 'inzibati|administr|\\mofis|\\moffice|katib|assistant|assistent|call.?cent|musteri xidmet|customer' },
  { key: 'other', label: 'Digər', pattern: null },
] as const;

export const categoryLabel = (key: string) => JOB_CATEGORIES.find((c) => c.key === key)?.label ?? 'Digər';
