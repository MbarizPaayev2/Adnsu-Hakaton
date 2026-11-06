# -*- coding: utf-8 -*-
"""Seed lexicon for the deterministic (rules-based) matching mode.

STATUS: a seed, not a reviewed lexicon. It is authored from the vocabulary that pipeline.CONCEPTS already
carries plus general occupation terms in Azerbaijani, Russian and English, written before any evaluation of this
mode. Every entry needs review by a native speaker of each language before production use; until then the mode
is an evaluation candidate only (docs/rules-matching-evaluation-2026-10-03.md).

Alias conventions (matched on lowercase text with Azerbaijani letters folded to ASCII, Cyrillic kept):
  * an alias of 5+ letters matches as a word PREFIX, so inflected forms hit ("mühasib" -> "mühasibi", "бухгалтер" ->
    "бухгалтера");
  * an alias of 4 letters or fewer, or one starting with "=", must match a whole word ("sql" must not hit "mysql" or
    "sqlite", "go" must not hit "good").
"""

LEXICON_VERSION = "2026-10-26.4"  # part of every cache key: change it whenever a table below changes

# occupation id -> (family, [aliases])
OCCUPATIONS = {
    # software and data
    "software_engineer": ("software", ["software engineer", "software developer", "full stack", "fullstack", "backend developer", "back-end developer", "=developer", "proqramçı", "proqram mühəndisi", "proqram təminatı mühəndisi", "proqram təminatı mütəxəssisi", "tərtibatçı", "veb tərtibatçı", "web developer", "veb proqramçı", "разработчик", "программист", "backend", "back-end"]),
    "frontend_developer": ("software", ["frontend", "front-end", "front end", "фронтенд", "react developer", "vue developer", "angular developer"]),
    "mobile_developer": ("software", ["mobile developer", "android developer", "ios developer", "mobil tətbiq", "мобильный разработчик"]),
    "qa_engineer": ("software", ["qa engineer", "qa mühəndis", "qa mütəxəssisi", "qa mütəxəssis", "software tester", "software test", "software quality assurance", "software quality engineer", "test engineer", "tester", "тестировщик", "qa analyst", "proqram təminatının test mühəndisi"]),
    "devops_engineer": ("it_ops", ["devops", "site reliability", "sre", "cloud engineer", "девопс"]),
    "system_administrator": ("it_ops", ["system administrator", "sistem administrator", "sysadmin", "network administrator", "şəbəkə administrator", "сисадмин", "системный администратор"]),
    "it_support": ("it_ops", ["it support", "help desk", "helpdesk", "technical support", "tech support", "texniki dəstək", "техническая поддержка", "техподдержк", "it mütəxəssis", "it helpdesk"]),
    "data_analyst": ("data", ["data analyst", "data scientist", "data engineer", "bi analyst", "bi analitik", "bi analitiki", "bi-аналитик", "məlumat analitik", "məlumat analitiki", "məlumat mühəndisi", "məlumat təhlilçisi", "аналитик данных"]),
    "business_analyst": ("data", ["business analyst", "biznes analitik", "biznes analitiki", "biznes təhlilçisi", "sistem analitiki", "system analyst", "системный аналитик", "бизнес-аналитик", "бизнес аналитик"]),
    "database_administrator": ("it_ops", ["database administrator", "database admin", "=dba", "verilənlər bazası administrator", "администратор баз данных"]),
    # finance, accounting, banking
    "accountant": ("accounting_finance", ["mühasib", "accountant", "бухгалтер", "bookkeeper", "mühasibat"]),
    "financial_analyst": ("accounting_finance", ["financial analyst", "finance analyst", "maliyyə analitik", "maliyyəçi", "финансовый аналитик", "finance manager", "maliyyə meneceri"]),
    "auditor": ("accounting_finance", ["auditor", "audit", "аудитор"]),
    "bank_teller": ("banking_risk", ["bank kassiri", "bank teller", "=teller", "банковский кассир", "bank operator", "bank əməkdaşı", "bank mütəxəssisi"]),
    "cashier": ("sales", ["kassir", "cashier", "кассир"]),
    "credit_officer": ("banking_risk", ["credit officer", "kredit mütəxəssisi", "kredit eksperti", "loan officer", "кредитный специалист", "кредитный эксперт", "credit analyst"]),
    "risk_analyst": ("banking_risk", ["risklərin idarə", "kredit risk", "credit risk", "risk analyst", "risk menecer", "risk manager", "risk mütəxəssis", "рисковый", "риск-менеджер", "compliance"]),
    # sales and marketing
    "sales_representative": ("sales", ["sales representative", "sales specialist", "sales consultant", "satış mütəxəssisi", "satış nümayəndəsi", "satış məsləhətçisi", "satış meneceri", "sales manager", "продавец", "менеджер по продаж", "консультант по продаж", "satıcı", "account manager"]),
    "telesales": ("sales", ["telefon satışı", "telefonla satış", "телефонные продажи", "телефонных продаж", "telesales", "tele-sales", "phone sales"]),
    "retail_assistant": ("sales", ["pərakəndə", "cashier retail", "shop assistant", "store assistant", "mağaza"]),
    # Pharmacy retail has domain-specific product responsibilities. Do not treat
    # its generic word "satıcı" as an exact match for every sales consultant.
    "pharmacy_sales_assistant": ("sales", ["aptek satıcısı", "aptekde satis meslehetcisi", "aptekdə satış məsləhətçisi", "pharmacy sales assistant", "pharmacy assistant", "аптечный продавец", "продавец-консультант в аптеке"]),
    "marketing_specialist": ("marketing", ["marketing", "marketinq", "маркетолог", "маркетинг", "smm", "digital marketing", "brand manager", "content manager", "kontent meneceri", "pr mütəxəssis"]),
    # people and administration
    "hr_specialist": ("hr", ["hr specialist", "hr manager", "hr generalist", "recruiter", "kadr", "kadrlar üzrə", "kadr mütəxəssisi", "рекрутер", "hr mütəxəssis", "специалист по кадрам", "talent acquisition", "hr"]),
    "office_administrator": ("admin_office", ["office manager", "ofis meneceri", "ofis administrator", "administrator", "katibə", "resepşn", "receptionist", "secretary", "секретарь", "офис-менеджер", "assistant", "köməkçi", "assistent", "qeydiyyatçı", "kargüzar", "kargüzarlıq", "arxivçi", "arxiv köməkçisi", "arxivarius", "делопроизводитель", "архивариус", "protokol mütəxəssisi", "protokol", "front desk", "resepsionist", "zal administratoru"]),
    "customer_support": ("customer_support", ["customer support", "customer service", "служба поддержки клиентов", "поддержки клиентов", "müştəri xidmətləri", "müştəri xidməti", "müştəri dəstəyi", "çağrı mərkəzi", "call center", "call-center", "contact center", "оператор колл", "колл-центр", "служба поддержки"]),
    # supply, transport
    "logistics_specialist": ("logistics_supply", ["logistics", "logistik", "логист", "экспедитор", "supply chain", "təchizat", "expeditor", "ekspeditor"]),
    "procurement_specialist": ("logistics_supply", ["procurement", "satınalma", "tədarük", "закупк", "purchasing"]),
    "warehouse_worker": ("logistics_supply", ["warehouse", "anbardar", "anbar işçisi", "anbar", "кладовщик", "склад", "storekeeper"]),
    "driver": ("driving_delivery", ["sürücü", "driver", "водитель"]),
    "courier": ("driving_delivery", ["kuryer", "courier", "курьер"]),
    # hospitality, care and trades
    "cook": ("food_hospitality", ["aşpaz", "cook", "повар", "şirniyyatçı", "çörəkçi", "chef", "şef aşpaz"]),
    "waiter_barista": ("food_hospitality", ["ofisiant", "waiter", "waitress", "официант", "barista", "barmen", "бариста", "bartender"]),
    "cleaner": ("general_labour", ["xadimə", "xadim", "təmizlik", "cleaner", "уборщ", "janitor", "qabyuyan", "qabyuyan-xadimə", "xadimə-qabyuyan", "mətbəx işçisi", "посудомойщица", "посудомойка", "посудомой", "дворник", "уборщик", "dishwasher", "housekeeper", "maid"]),
    "groundskeeper_gardener": ("general_labour", ["bağban", "садовник", "gardener", "landscaper", "yaşıllaşdırma", "озеленитель", "bağban köməkçisi"]),
    "security_guard": ("security", ["mühafizəçi", "mühafizə", "security guard", "охранник", "охрана"]),
    "labourer": ("general_labour", ["çilingər", "слесарь", "locksmith", "santexnik", "plumber", "сантехник", "fəhlə", "рабочий", "=helper", "=mason", "bənna", "=usta", "=master", "мастер", "разнорабочий", "разнорабоч", "грузчик", "anbar fəhləsi", "yükləyici", "fəhlə-qablaşdırıcı", "подсобник", "подсобный рабочий", "laborer"]),
    "caregiver": ("healthcare_support", ["dayə", "няня", "babysitter", "au pair", "baxıcı", "sanitar", "sanitarka", "санитар", "санитарка", "tərbiyəçi köməkçisi", "caregiver"]),
    "tailor": ("manufacturing", ["dərzi", "portnoy", "портной", "швея", "seamstress", "tailor", "biçici", "dərzi köməkçisi"]),
    # health, education, law
    "doctor": ("healthcare", ["həkim", "doctor", "врач", "physician", "stomatoloq", "dentist"]),
    "nurse": ("healthcare", ["tibb bacısı", "nurse", "медсестр", "feldşer"]),
    "pharmacist": ("healthcare", ["əczaçı", "pharmacist", "фармацевт"]),
    "teacher": ("education", ["müəllim", "teacher", "учитель", "преподаватель", "tutor", "repetitor", "educator", "təlimçi", "trainer", "тренер", "fizika müəllimi", "riyaziyyat müəllimi", "ingilis dili müəllimi", "rus dili müəllimi", "müəllimi", "tərbiyəçi", "pedaqoq"]),
    "lawyer": ("legal", ["hüquqşünas", "lawyer", "юрист", "advokat", "legal counsel", "hüquq məsləhətçi"]),
    # engineering and construction
    "civil_engineer": ("engineering_construction", ["civil engineer", "inşaat mühəndisi", "tikinti mühəndisi", "инженер-строитель", "site engineer", "прораб", "foreman", "construction engineer", "layihələndirmə mühəndisi", "sətəm mühəndisi", "sətəm üzrə mühəndis"]),
    "mechanical_engineer": ("engineering_construction", ["mechanical engineer", "mexanik mühəndis", "инженер-механик", "maşın mühəndisi"]),
    "electrical_engineer": ("engineering_construction", ["electrical engineer", "elektrik mühəndisi", "инженер-электрик", "elektrik", "electrician", "электрик"]),
    "engineer": ("engineering_construction", ["mühəndis", "engineer", "инженер"]),
    "architect_designer": ("engineering_construction", ["architect", "memar", "архитектор", "interior designer", "interyer dizayner"]),
    "graphic_designer": ("design", ["graphic designer", "qrafik dizayner", "ui/ux", "ux designer", "ui designer", "дизайнер", "designer", "dizayner"]),
    "translator": ("language", ["translator", "tərcüməçi", "переводчик", "interpreter"]),
    "tourism_agent": ("tourism", ["tour operator", "turizm", "travel agent", "туризм", "тур менеджер"]),
    "real_estate_agent": ("sales", ["real estate agent", "makler", "риэлтор", "daşınmaz əmlak üzrə", "realtor"]),
    "production_worker": ("manufacturing", ["istehsalat", "production operator", "оператор производства", "станочник", "конвейер"]),
    "quality_control_inspector": ("manufacturing", ["quality control inspector", "quality control specialist", "keyfiyyətə nəzarət mütəxəssisi", "keyfiyyətə nəzarət üzrə mütəxəssis", "контролер качества", "контроль качества"]),
    "occupational_safety_specialist": ("occupational_safety", ["hse specialist", "hse engineer", "qhse", "ehs specialist", "əməyin mühafizəsi üzrə mütəxəssis", "əməyin mühafizəsi mühəndisi", "техник по охране труда", "специалист по охране труда"]),
    "project_manager": ("management", ["project manager", "layihə meneceri", "layihə rəhbəri", "руководитель проекта", "product manager", "program manager", "scrum master", "product owner", "məhsul meneceri", "layihə koordinatoru", "project coordinator", "координатор проекта"]),
    "executive_manager": ("management", ["director", "direktor", "müdir", "директор", "head of", "chief", "rəhbər", "руководитель", "начальник", "general manager"]),
}

# Words that never identify an occupation on their own when comparing titles token by token.
TITLE_STOPWORDS = {
    "senior", "junior", "lead", "head", "chief", "middle", "mid", "trainee", "intern", "specialist", "expert",
    "manager", "assistant", "officer", "and", "the", "for", "baş", "aparıcı", "kiçik", "böyük", "üzrə", "mütəxəssis",
    "mütəxəssisi", "meneceri", "menecer", "köməkçisi", "təcrübəçi", "стажер", "старший", "младший", "главный",
    "специалист", "менеджер", "ведущий", "full", "time", "part", "remote", "uzaqdan", "vakansiya", "vacancy",
    "tam", "ştat", "yarım", "работа", "вакансия", "требуется", "tələb", "olunur", "axtarılır", "company", "şirkət",
    "azərbaycan", "azerbaijan", "азербайджан", "baku", "bakı", "баку", "departamenti", "departamentinin", "şöbəsi",
    "şöbəsinin", "bölməsi", "bölməsinin", "idarəsi", "idarəsinin", "xidməti", "mərkəzi", "holding", "group", "mmc",
    "asc", "llc", "filialı", "filial",
}

# Extra skill/concept aliases layered on pipeline.CONCEPTS (same alias conventions). A key that already exists in
# CONCEPTS adds synonyms; a new key adds a concept the base dictionary does not cover.
EXTRA_CONCEPTS = {
    "customer_service": ["müştəri dəstəyi", "клиентск", "customer support", "contact center", "əlaqə mərkəzi", "контакт-центр", "служба поддержки"],
    "call_center": ["inbound", "outbound", "gələn zənglər", "входящие звонки", "telefon satışı"],
    "pharmacy_retail": ["əczaçılıq sahəsinə maraq", "tibbi sahəyə maraq", "dərman vasitələri", "aptek məhsulları", "pharmacy knowledge", "pharmaceutical products", "pharmacy products", "лекарственные средства", "аптечная продукция"],
    "accounting": ["uçot", "бухучет", "бухгалтерский учет", "bookkeeping", "hesabatlılıq", "ilkin uçot"],
    "tax": ["vergi hesabatı", "налоговая отчетность", "ədv"],
    "financial_analysis": ["financial modeling", "maliyyə modelləşdirməsi", "финансовое моделирование"],
    "negotiation": ["переговоры", "danışıqlar aparmaq"],
    "teaching": ["tədris", "dərs demək", "преподавани", "teaching", "curriculum", "kurikulum", "lesson plan", "dərs planı", "pedaqoji", "pedagog", "педагог"],
    "credit_risk": ["kredit riski", "kreditləşdirmə", "kredit portfeli", "кредитный риск", "credit risk", "scoring", "skorinq", "loan portfolio", "portfolio quality", "npl"],
    "banking_regulation": ["mərkəzi bank", "central bank", "basel", "bazel", "aml", "kyc", "pul yuyulması", "отмывани"],
    "patient_care": ["xəstə baxımı", "patient care", "уход за пациент", "tibbi xidmət", "medical care", "injection", "inyeksiya", "klinika", "clinic", "больниц", "hospital"],
    "site_supervision": ["tikinti sahəsi", "construction site", "стройплощадк", "nəzarət tikinti", "technical supervision", "texniki nəzarət", "строительный надзор"],
    "structural_design": ["layihələndirmə", "projektləndirmə", "autocad", "revit", "проектирование", "structural", "konstruksiya", "smeta", "смета", "estimate"],
    "driving_licence": ["sürücülük vəsiqəsi", "sürücülük hüququ", "водительские права", "driving licen", "kateqoriya b", "категории b", "category b"],
    "russian_language_skill": ["rus dilində", "russian language", "русский язык", "rus dili"],
}

# Explicit qualifications / credentials that a posting can require. concept id -> aliases (same conventions).
QUALIFICATIONS = {
    "acca": ["=acca"],
    "cpa": ["=cpa"],
    "cfa": ["=cfa"],
    "pmp": ["=pmp"],
    "cisa": ["=cisa"],
    "ielts": ["=ielts", "=toefl"],
    "driving_licence": ["sürücülük vəsiqəsi", "водительские права", "driving licen", "kateqoriya b", "категории b", "category b"],
    "medical_licence": ["tibb təhsili", "tibbi təhsil", "медицинское образование", "medical licen", "həkim sertifikatı", "диплом врача", "lisenziya"],
    "bar_licence": ["vəkillik", "lawyer licen", "лицензия адвоката"],
}

# Phrases that mark a sentence as optional / as mandatory (matched on folded lowercase text).
PREFERRED_MARKERS = [
    "ustunluk", "ustunluk teskil", "arzuolunan", "arzu olunan", "arzu olunur", "arzuedilen", "nice to have", "preferred",
    "desirable", "is a plus", "a plus", "advantage", "bonus points", "will be an advantage", "будет плюсом", "приветствуется",
    "желательно", "преимуществом", "является плюсом",
]
REQUIRED_MARKERS = [
    "teleb olunur", "mutleq", "vacibdir", "mecburi", "required", "must have", "must", "mandatory", "essential",
    "обязательно", "необходим", "требуется", "обязательны",
]


# Teaching subjects: "teacher" is one occupation, but a maths teacher is not an English teacher. A subject is recognised from the
# title or the candidate's roles; an unknown subject on either side is neutral, never a mismatch.
SUBJECTS = {
    "math": ["riyaziyyat", "math", "математик", "алгебра", "həndəsə"],
    "english": ["ingilis dili", "english", "английск"],
    "russian": ["rus dili", "russian language", "русского языка", "русский язык"],
    "physics": ["fizika", "physics", "физик"],
    "chemistry": ["kimya", "chemistry", "хими"],
    "biology": ["biologiya", "biology", "биолог"],
    "history": ["tarix", "history", "истори"],
    "primary": ["ibtidai sinif", "primary school", "начальных классов", "ibtidai"],
    "azerbaijani": ["azərbaycan dili", "ədəbiyyat", "azerbaijani language"],
}
# Subjects that are close neighbours (partial credit rather than none).
SUBJECT_NEIGHBOURS = {frozenset(p) for p in (("math", "physics"), ("physics", "chemistry"), ("chemistry", "biology"), ("math", "chemistry"), ("russian", "azerbaijani"), ("english", "russian"), ("primary", "math"), ("primary", "english"), ("primary", "russian"), ("primary", "azerbaijani"))}

# Occupations in different families that are genuinely adjacent: partial credit for a target in one when the posting is in the other.
# Values of 0.3 are "weak adjacency": enough to rank above unrelated roles, not enough on their own to be stored (the storage threshold is 0.35).
# Symmetric. Values are hypotheses to validate, written down from general occupational similarity, not fitted to any scorer output.
ADJACENT = {
    frozenset(("customer_support", "telesales")): 0.6,
    frozenset(("customer_support", "sales_representative")): 0.3,
    frozenset(("telesales", "sales_representative")): 0.6,
    frozenset(("customer_support", "office_administrator")): 0.3,
    frozenset(("sales_representative", "retail_assistant")): 0.6,
    frozenset(("sales_representative", "pharmacy_sales_assistant")): 0.3,
    frozenset(("cashier", "pharmacy_sales_assistant")): 0.3,
    frozenset(("retail_assistant", "pharmacy_sales_assistant")): 0.3,
    frozenset(("pharmacist", "pharmacy_sales_assistant")): 0.5,
    frozenset(("sales_representative", "cashier")): 0.5,
    frozenset(("cashier", "retail_assistant")): 0.6,
    frozenset(("cashier", "bank_teller")): 0.4,
    frozenset(("sales_representative", "marketing_specialist")): 0.3,
    frozenset(("it_support", "system_administrator")): 0.6,
    frozenset(("it_support", "devops_engineer")): 0.3,
    frozenset(("software_engineer", "qa_engineer")): 0.5,
    frozenset(("software_engineer", "devops_engineer")): 0.5,
    frozenset(("software_engineer", "data_analyst")): 0.4,
    frozenset(("accountant", "financial_analyst")): 0.6,
    frozenset(("accountant", "auditor")): 0.6,
    frozenset(("financial_analyst", "data_analyst")): 0.4,
    frozenset(("business_analyst", "financial_analyst")): 0.4,
    frozenset(("business_analyst", "auditor")): 0.3,
    frozenset(("data_analyst", "auditor")): 0.3,
    frozenset(("business_analyst", "risk_analyst")): 0.4,
    frozenset(("data_analyst", "risk_analyst")): 0.4,
    frozenset(("data_analyst", "database_administrator")): 0.4,
    frozenset(("project_manager", "software_engineer")): 0.25,
    frozenset(("driver", "courier")): 0.5,
    frozenset(("logistics_specialist", "warehouse_worker")): 0.5,
    frozenset(("logistics_specialist", "procurement_specialist")): 0.5,
    frozenset(("logistics_specialist", "driver")): 0.3,
    frozenset(("nurse", "pharmacist")): 0.3,
    frozenset(("hr_specialist", "office_administrator")): 0.3,
    frozenset(("cook", "waiter_barista")): 0.4,
}

# A title that names a managerial role. A manager posting is at least mid-level even when it states no experience band.
MANAGER_MARKERS = ["manager", "menecer", "meneceri", "менеджер", "rəhbəri", "руководитель", "head of"]
