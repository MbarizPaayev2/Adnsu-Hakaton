# -*- coding: utf-8 -*-
"""Core engine for the AI job-matching pipeline (glorri.az vacancies).

Implements the multi-stage pipeline described in the brief:

Phase 1  Structuring  -> raw scraped glorri jobs and persona -> structured schemas
Phase 2  Matching     -> multilingual embeddings + hard filters + (optional) LLM rerank

Stateless: embeddings are computed in memory on every run, nothing is cached.
Everything degrades gracefully to a fully offline, deterministic mode when no
LLM key is configured.
"""

from __future__ import annotations

import html
import json
import math
import os
import random
import re
import sys
import time
from pathlib import Path

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "glorri_jobs_detail.json"
PERSONA_FILE = BASE_DIR / "persona.json"
SETTINGS_FILE = BASE_DIR / "settings.json"
OUTPUT_DIR = BASE_DIR / "output"
EMB_MODEL = "paraphrase-multilingual-MiniLM-L12-v2"
# Exact model revision the CPU rehearsal and self-test were run against
# (sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2). Pinned so the
# image, the running service and the evidence all use the same weights; the
# Dockerfile downloads this revision at build time (prefetch_model).
EMB_MODEL_REVISION = os.environ.get("EMB_MODEL_REVISION") or "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
JOB_URL = "https://jobs.glorri.az/en/vacancies/{company}/{slug}"


# ---------------------------------------------------------------------------
# Console
# ---------------------------------------------------------------------------
def configure_utf8() -> None:
    """Make stdout safe for Azerbaijani/Cyrillic output on Windows."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if os.name == "nt":
        os.system("")


# ---------------------------------------------------------------------------
# Text cleaning
# ---------------------------------------------------------------------------
def clean_html(value) -> str:
    """Strip tags and fully unescape HTML entities (handles double encoding)."""
    if not value:
        return ""
    text = str(value)
    for _ in range(3):
        if "&" not in text:
            break
        decoded = html.unescape(text)
        if decoded == text:
            break
        text = decoded
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text, flags=re.I)
    text = text.replace("\xa0", " ")
    text = re.sub(r"https?://\S+|www\.\S+", " ", text)
    text = re.sub(r"\\r|\\n", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def norm_lower(text: str) -> str:
    return clean_html(text).lower()


# ---------------------------------------------------------------------------
# Multilingual concept dictionary (az / en / ru / tr)
# ---------------------------------------------------------------------------
CONCEPTS = {
    "sales": ["satış üzrə", "satış", "sales", "продаж", "satis ile"],
    "sales_manager": ["satış meneceri", "satış menecer", "sales manager", "менеджер по продаж"],
    "sales_consultant": ["satış məsləhətçisi", "məsləhətçi", "sales consultant", "консультант по продаж"],
    "customer": ["müştəri", "client", "customer", "клиент"],
    "customer_service": ["müştəri xidməti", "customer service", "обслуживани клиент", "xidmət"],
    "negotiation": ["danışıqlar", "danışıq", "negotiat", "переговор", "razılaşma"],
    "retail": ["pərakəndə", "retail", "розниц"],
    "wholesale": ["topdan", "wholesale", "опт"],
    "active_sales": ["aktiv satış", "aktiv satis", "cold", "prospect", "axtarış"],
    "targets": ["satış hədəfi", "kpi", "plan", "target", "hədəf", "план"],
    "after_sales": ["satışdan sonra", "after-sales", "after sales", "post-sale"],
    "showroom": ["salon", "showroom", "şou-rum", "салон"],
    "accountant": ["mühasib", "accountant", "бухгалтер"],
    "accounting": ["mühasibat uçotu", "mühasibat", "accounting", "бухгалтерия"],
    "tax": ["vergi", "tax", "налог"],
    "payroll": ["əmək haqqı", "payroll", "зарплат", "maaş hesablama"],
    "invoice": ["qaimə", "hesab-faktura", "invoice", "счет", "faktura"],
    "reconciliation": ["barışdırılma", "reconcil", "сверк", "uyğunlaşdırma"],
    "cash": ["kassa əməliyyat", "kassa", "cash", "касса", "nəğd"],
    "bank": ["bank əməliyyat", "banking", "bank", "банк"],
    "reporting": ["hesabat", "reporting", "report", "отчёт", "отчет"],
    "primary_docs": ["ilkin sənəd", "primary document", "sənəd"],
    "budget": ["büdcə", "budget", "бюджет"],
    "financial_analysis": ["maliyyə təhlili", "financial analysis", "финансовый анализ", "finans təhlil"],
    "1c": ["1c", "1с", "1c: buxgalteriya", "1c: mühasibat"],
    "excel": ["excel", "exсel"],
    "word": ["word", "ворд"],
    "powerpoint": ["powerpoint", "пауэрпоинт"],
    "crm": ["crm", "срм"],
    "ms_office": ["microsoft office", "ms office", "office proqram", "офисн"],
    "secretary": ["katibə", "resepşn", "receptionist", "secretary", "секретар", "resepsion"],
    "office_manager": ["ofis meneceri", "office manager", "офис-менеджер"],
    "phone_calls": ["zəng", "phone call", "calls", "звонк", "telefon"],
    "email_correspondence": ["yazışma", "correspondence", "переписк", "e-poçt"],
    "documentation": ["sənədləşmə", "document", "документ", "sənəd"],
    "scheduling": ["cədvəl", "schedule", "расписан", "qrafik"],
    "communication": ["ünsiyyət", "communication", "коммуникац", "əlaqə"],
    "teamwork": ["komanda işi", "teamwork", "team work", "команд", "komanda"],
    "responsibility": ["məsuliyyət", "responsib", "ответственност"],
    "computer": ["kompüter", "computer", "компьютер", "kompyuter"],
    "organization": ["təşkilatçılıq", "organiz", "организованност"],
    "time_management": ["vaxt idarə", "time management", "тайм-менедж"],
    "detail_orientation": ["dəqiqlik", "attention to detail", "внимательн", "dəqiq"],
    "problem_solving": ["problem həll", "problem solving", "решение проблем"],
    "leadership": ["rəhbərlik", "leadership", "руководств"],
    "logistics": ["logistik", "logistics", "логистик", "daşınma"],
    "warehouse": ["anbar", "warehouse", "склад"],
    "purchasing": ["satınalma", "tədarük", "procurement", "purchase", "закупк"],
    "driver": ["sürücü", "driver", "водител"],
    "cleaning": ["xadimə", "cleaning", "уборк", "təmizlik"],
    "security": ["mühafizə", "security", "охрана"],
    "construction": ["tikinti", "construction", "строит"],
    "engineer": ["mühəndis", "engineer", "инженер"],
    "cook": ["aşpaz", "şirniyyatçı", "çörəkçi", "cook", "повар"],
    "barista": ["barista", "ofisiant", "waiter", "официант", "barmen"],
    "nurse": ["tibb bacısı", "nurse", "медсестр"],
    "doctor": ["həkim", "doctor", "врач"],
    "call_center": ["çağrı mərkəzi", "call center", "колл-центр"],
    "courier": ["kuryer", "courier", "курьер"],
    "tourism": ["turizm", "tourism", "туризм"],
    "marketing": ["marketinq", "marketing", "маркетинг"],
    "smm": ["smm", "sm m", "social media", "контент"],
    "analytics": ["analiz", "analytic", "analitik", "analyst", "аналит"],
    # Bare "hr" is matched with word boundaries at scoring time (see
    # _CONCEPT_PATTERNS), so "HR", "HR-manager" and "(HR)" all hit while
    # "through"/"xhr" never do — no trailing-space hack needed.
    "hr": ["kadr", "kadrlar", "hr", "human resource", "hr manager", "персонал"],
    "translation": ["tərcümə", "translation", "перевод"],
    "sales_rep_medical": ["tibbi nümayəndə", "medical rep", "мед. представитель"],
    "real_estate": ["daşınmaz əmlak", "real estate", "недвижим", "makler", "агент"],
    "production": ["istehsal", "production", "производств"],
    "quality": ["keyfiyyət", "quality", "качеств"],
    "customs": ["gömrük", "customs", "таможн"],
    "legal": ["hüquq", "legal", "юрид"],
    "architecture": ["memar", "architect", "архитект", "interyer"],

    # ---- software / IT (previously entirely missing — every tech-role
    # keyword score silently fell back to the flat 0.2 no-concepts default,
    # regardless of how well a candidate's actual stack matched the posting)
    "software_development": ["proqram təminatı", "software development", "software engineer", "разработ", "proqramlaşdırma"],
    "frontend": ["frontend", "front-end", "front end", "фронтенд"],
    "backend": ["backend", "back-end", "back end", "бэкенд", "бекенд"],
    "fullstack": ["full stack", "full-stack", "fullstack", "фулстек"],
    "mobile_dev": ["mobil tətbiq", "mobile developer", "mobile development", "android developer", "ios developer", "мобильн"],
    # "java" is a literal substring of "javascript" — every alias here must
    # be distinctive enough not to collide with the javascript concept below.
    "java_lang": ["java developer", "java proqramçı", "spring boot", "spring framework", "джава разработ"],
    "javascript": ["javascript", "джаваскрипт"],
    "typescript": ["typescript", "тайпскрипт"],
    "python": ["python", "питон", "пайтон"],
    "php": ["php", "пхп"],
    "csharp_dotnet": ["c#", ".net", "dotnet", "си шарп"],
    "cpp": ["c++", "си плюс"],
    # Bare "go" is deliberately NOT an alias — it is an English verb and would
    # fire on almost every English posting. The multi-word aliases below plus
    # word-boundary matching on "golang" cover real Go postings.
    "golang": ["golang", "go developer", "go proqram", "go dili", "go proqramlaşdırma"],
    "kotlin": ["kotlin", "котлин"],
    "swift_lang": ["swift", "свифт"],
    "react_js": ["react.js", "react ", "react,", "reactjs", "реакт"],
    "vue_js": ["vue.js", "vue ", "vue,", "vuejs"],
    "angular_js": ["angular", "ангуляр"],
    "nodejs": ["node.js", "node ", "node,", "nodejs", "ноде"],
    "html_css": ["html", "css", "вёрстка", "verstka"],
    "sql_db": ["sql", "postgresql", "postgres", "mysql", "mongodb", "database", "verilənlər bazası", "баз данн"],
    "api_rest": ["rest api", "restful", "graphql", "api inteqrasiya", "api"],
    "git_vcs": ["git", "github", "gitlab", "гит"],
    "docker_k8s": ["docker", "kubernetes", "k8s", "докер", "кубернет"],
    "cloud": ["aws", "azure", "google cloud", "gcp", "bulud texnologiya", "облачн"],
    "cicd": ["ci/cd", "cicd", "continuous integration", "continuous deployment"],
    "linux_sys": ["linux", "unix", "линукс"],
    "software_testing": ["proqram testi", "qa mühəndis", "software testing", "test automation", "тестировани", "qa engineer"],
    "data_science": ["data science", "data analyst", "data engineer", "machine learning", "süni intellekt", "данные", "машинное обучение"],
    "agile_scrum": ["agile", "scrum", "kanban", "sprint", "аджайл", "скрам"],
    "algorithms": ["alqoritm", "data structure", "algorithm", "алгоритм", "структур данн"],
    "it_support": ["texniki dəstək", "it support", "sistem administrator", "техподдержк", "сисадмин"],
}

# Concepts every posting states regardless of the role ("ünsiyyət bacarığı",
# "komanda ilə işləmək", office tools). Matching on them is noise: a cook and an
# accountant both "require communication", and a candidate listing Excel would
# match every office posting. They are ignored when measuring keyword overlap
# and when comparing titles.
GENERIC_CONCEPTS = {
    "communication", "teamwork", "responsibility", "computer", "organization",
    "time_management", "detail_orientation", "problem_solving", "ms_office",
    "word", "excel", "powerpoint", "email_correspondence", "documentation",
    "customer",
}

# Occupations that need a licence or a specific degree. A posting titled for one
# is not a stretch for a profile that shows none of it.
REGULATED_CONCEPTS = {"doctor", "nurse", "legal"}

# Glorri also files "Tam ştat" / "Yarım ştat" under the same list as the
# location; a value like that says how the job is worked, never where.
_EMPLOYMENT_TYPE_LABELS = {
    "tam stat", "yarim stat", "novbe esasinda", "konullu", "muveqqeti", "tecrube", "frilans",
    "full time", "full-time", "part time", "part-time", "freelance", "internship", "contract", "temporary",
}

# Blend of the four signals into `base` (they sum to 1). Whole-document semantic
# similarity carries the least weight: measured on the evaluation set
# (docs/matching-evaluation.md) it barely separated strong from poor pairs,
# because the multilingual model scores any two Azerbaijani postings as similar
# (0.70-0.83 for unrelated pairs) while role/title, skill and concept overlap
# do separate them.
W_SEMANTIC = 0.15
W_ROLE_FIT = 0.30
W_SKILL_DEMAND = 0.25
W_KEYWORD = 0.30

# A title that means the same role as one of the candidate's target roles: the
# title embedding of an exact equivalent scores 0.92-0.97, so credit at least this.
TITLE_MATCH_ROLE_FIT = 0.85

_LANG_MARKERS = {
    # Only mentions of the LANGUAGE (see _AZ_LANGUAGE_CONTEXT for the English
    # forms). A bare "azerbai" stem also matched every "Azerbaijan"/"Azerbaijani"
    # in a company blurb and charged those postings a missing-language penalty.
    "az": ["azərbaycan dili", "azərbaycanca", "azərbaycan dilində", "ana dili"],
    "ru": ["rus dili", "rusca", "rus dilində", "russian", "русск"],
    "en": ["ingilis dili", "ingiliscə", "ingilis dilində", "english", "англ"],
    "tr": ["türk dili", "türkcə", "türk dilində", "turkish", "түрк"],
}

CONCEPT_LABELS = {
    "sales": "sales",
    "sales_manager": "sales management",
    "sales_consultant": "client consulting",
    "customer": "customer relations",
    "customer_service": "customer service",
    "negotiation": "negotiation",
    "retail": "retail operations",
    "wholesale": "wholesale operations",
    "active_sales": "active prospecting",
    "targets": "target achievement",
    "after_sales": "after-sales support",
    "showroom": "showroom",
    "accountant": "accounting",
    "accounting": "accounting",
    "tax": "tax compliance",
    "payroll": "payroll",
    "invoice": "invoicing",
    "reconciliation": "reconciliation",
    "cash": "cash operations",
    "bank": "bank operations",
    "reporting": "reporting",
    "primary_docs": "primary documentation",
    "budget": "budget control",
    "financial_analysis": "financial analysis",
    "1c": "1C",
    "excel": "MS Excel",
    "word": "MS Word",
    "powerpoint": "PowerPoint",
    "crm": "CRM",
    "ms_office": "MS Office",
    "secretary": "front-desk reception",
    "office_manager": "office administration",
    "phone_calls": "phone handling",
    "email_correspondence": "email correspondence",
    "documentation": "documentation",
    "scheduling": "scheduling",
    "communication": "communication",
    "teamwork": "teamwork",
    "responsibility": "ownership of duties",
    "computer": "computer skills",
    "organization": "organization",
    "time_management": "time management",
    "detail_orientation": "attention to detail",
    "problem_solving": "problem solving",
    "leadership": "leadership",
    "logistics": "logistics",
    "warehouse": "warehouse",
    "purchasing": "procurement",
    "driver": "driving",
    "cleaning": "facility upkeep",
    "security": "security",
    "construction": "construction",
    "engineer": "engineering",
    "cook": "cooking",
    "barista": "food & beverage service",
    "nurse": "nursing",
    "doctor": "medical care",
    "call_center": "call-center handling",
    "courier": "delivery",
    "tourism": "tourism",
    "marketing": "marketing",
    "smm": "social-media content",
    "analytics": "analytics",
    "hr": "HR administration",
    "translation": "translation",
    "sales_rep_medical": "pharma field sales",
    "real_estate": "real estate",
    "production": "production",
    "quality": "quality control",
    "customs": "customs",
    "legal": "legal",
    "architecture": "architecture & interior",

    "software_development": "software development",
    "frontend": "frontend development",
    "backend": "backend development",
    "fullstack": "full-stack development",
    "mobile_dev": "mobile development",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "python": "Python",
    "java_lang": "Java",
    "php": "PHP",
    "csharp_dotnet": "C# / .NET",
    "cpp": "C++",
    "golang": "Go",
    "kotlin": "Kotlin",
    "swift_lang": "Swift",
    "react_js": "React",
    "vue_js": "Vue.js",
    "angular_js": "Angular",
    "nodejs": "Node.js",
    "html_css": "HTML/CSS",
    "sql_db": "SQL / databases",
    "api_rest": "API integration",
    "git_vcs": "Git",
    "docker_k8s": "Docker/Kubernetes",
    "cloud": "cloud platforms",
    "cicd": "CI/CD",
    "linux_sys": "Linux/Unix",
    "software_testing": "QA / test automation",
    "data_science": "data science & ML",
    "agile_scrum": "Agile/Scrum",
    "algorithms": "algorithms & data structures",
    "it_support": "IT support / sysadmin",
}


def concept_label(concept: str) -> str:
    return CONCEPT_LABELS.get(concept, concept.replace("_", " "))


def _alias_pattern(alias: str) -> "re.Pattern":
    """Compile one concept alias to a case-sensitive regex over already-
    lowercased text.

    Short tech aliases MUST NOT match inside longer words: a naive `in`
    check for "api" fires on "capital"/"rapid", "git" on "digital"/"legit",
    "sql" on "postgresql"/"mysql". Word-char sides get \\w lookarounds;
    symbol-led aliases (c#, .net, node.js) only constrain their word-char
    side, since e.g. ".net" inside "asp.net" is a genuine hit.
    """
    esc = re.escape(alias)
    left = r"(?<!\w)" if re.match(r"\w", alias, re.U) else r""
    right = r"(?!\w)" if re.search(r"\w$", alias, re.U) else r""
    # Azerbaijani, Turkish and Russian attach suffixes to the stem ("mühəndis"
    # -> "mühəndisi", "hüquq" -> "hüquqşünas", "müştəri" -> "müştərilərlə"), so
    # a stem with a non-ASCII letter must also match its inflected forms. Plain
    # ASCII aliases stay strict: "api" must not match "apical", "java" not
    # "javascript", "go" not "golang".
    if len(alias) >= 4 and any(ord(ch) > 127 for ch in alias):
        right = r""
    return re.compile(left + esc + right, re.U)


# Precompiled once at import: ~200 aliases, negligible memory, and every
# extract_concepts()/concept_count() call reuses them instead of rebuilding.
_CONCEPT_PATTERNS: dict = {
    concept: [_alias_pattern(a) for a in aliases if a]
    for concept, aliases in CONCEPTS.items()
}

_EXPERIENCE_BANDS = {
    "təcrübəsiz": (0, 0),
    "1 ildən aşağı": (0, 1),
    "1 ildən 3 ilə qədər": (1, 3),
    "3 ildən 5 ilə qədər": (3, 5),
    "5 ildən artıq": (5, 99),
}

# Order matters: `parse_education` breaks on the first substring match, so a
# key that is itself a substring of a more specific one ("ali" inside
# "natamam ali") must come after it, never before.
_EDUCATION_RANK = {
    "elmi dərəcə": 5,
    # Glorri's own "Təhsil" sidebar field uses "Bakalavr"/"Magistr" rather
    # than the generic "Ali" (higher education) label this dict was
    # originally written for. Ranked the same as "ali" (4) — matching the
    # TS-side estimateEducationRank, which also treats bachelor's and
    # master's as one tier and reserves rank 5 for a doctorate alone — so a
    # job requiring either is satisfiable by a persona ranked from either.
    "magistr": 4,
    "bakalavr": 4,
    "natamam ali": 3,
    "ali": 4,
    "orta texniki": 2,
    "orta xüsusi": 2,
    "peşə təhsili": 2,
    "orta": 1,
    "-": 0,
    "none": 0,
}

_LOCATION_ALIASES = {
    "bakı": ["bakı", "baku", "баку", "baki"],
    "sumqayıt": ["sumqayıt", "sumgait", "сумгаит"],
    "xırdalan": ["xırdalan", "khirdalan"],
    "xocavənd": ["xocavənd", "khojavend"],
    "xankəndi": ["xankəndi", "khankendi"],
    "zəngilan": ["zəngilan", "zangilan"],
    "cəlilabad": ["cəlilabad", "jalilabad"],
    "xaçmaz": ["xaçmaz", "khachmaz"],
    "kəlbəcər": ["kəlbəcər", "kelbajar"],
    "lənkəran": ["lənkəran", "lankaran"],
    "naxçıvan": ["naxçıvan", "nakhichevan"],
    "astara": ["astara"],
    "dubay": ["dubay", "dubai"],
    "laçın": ["laçın", "lachin"],
    "quba": ["quba", "guba"],
    "salyan": ["salyan"],
    # Not a city: canonical bucket for remote postings ("Uzaqdan", "Remote",
    # "Məsafədən", ...). Lets remote jobs and remote-seeking candidates meet
    # without tripping the outside-preferred-cities penalty in score_job().
    "remote": ["uzaqdan", "remote", "remotely", "məsafədən", "mesafeden", "evdən iş", "evden"],
    "gəncə": ["gəncə", "ganja"],
    "xızı": ["xızı"],
    "ismayıllı": ["ismayıllı"],
    "moskva": ["moskva", "moscow"],
}


def _fold_ascii(text: str) -> str:
    import unicodedata
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return text.lower().replace("ı", "i").replace("ə", "e").replace("ş", "s").replace("ç", "c").replace("ğ", "g").replace("ö", "o").replace("ü", "u").strip(" .,;:-")


def is_employment_type(value: str) -> bool:
    return _fold_ascii(clean_html(value)) in _EMPLOYMENT_TYPE_LABELS


def canonical_location(location: str) -> str:
    if is_employment_type(location):
        return "unknown"
    loc = norm_lower(location)
    for canonical, aliases in _LOCATION_ALIASES.items():
        if any(a in loc for a in aliases):
            return canonical
    return loc or "unknown"


def _concept_haystack(hay: str, concept: str) -> str:
    # Data preparation is not facility upkeep. Strip only the data-related
    # phrase for this concept; mixed text can still evidence real cleaning work.
    if concept != "cleaning":
        return hay
    return re.sub(
        r"\b(?:data|datasets?|records?|tables?|database)\s+(?:(?:manipulation|preparation|preprocessing|wrangling|validation|quality|and)\s+){0,3}(?:cleaning|cleansing|cleanup)\b"
        r"|\b(?:cleaning|cleansing)\s+(?:(?:of|the)\s+){0,2}(?:data|datasets?|records?|tables?|database)\b",
        " ", hay,
    )


def extract_concepts(text: str) -> list:
    """Return ordered concept list (longest alias first for stability).

    Word-boundary matching: "api" must not fire on "capital", "git" must
    not fire on "digital". See _alias_pattern.
    """
    hay = norm_lower(text)
    hits = []
    for concept, patterns in _CONCEPT_PATTERNS.items():
        concept_hay = _concept_haystack(hay, concept)
        for pat in patterns:
            if pat.search(concept_hay):
                hits.append(concept)
                break
    return hits


def concept_count(text: str) -> dict:
    counts = {}
    hay = norm_lower(text)
    for concept, patterns in _CONCEPT_PATTERNS.items():
        concept_hay = _concept_haystack(hay, concept)
        n = sum(len(pat.findall(concept_hay)) for pat in patterns)
        if n:
            counts[concept] = n
    return counts


# "Azerbaijani" names a language only next to language cues: "Azerbaijani and
# Russian speaking clients", "fluent Azerbaijani", "Azerbaijani language". It is
# not one in "the Azerbaijani market" or "Azerbaijani customers".
_AZ_LANGUAGE_CONTEXT = re.compile(
    r"azerbaijani\s*(?:,|/|&|and|or)\s*(?:russian|english|turkish)"
    r"|(?:russian|english|turkish)\s*(?:,|/|&|and|or)\s*azerbaijani"
    r"|azerbaijani[\s-]+(?:language|speaking|speaker|fluen|proficien|native|written|spoken)"
    r"|(?:fluent|fluency|knowledge|proficiency|command)\s+(?:of\s+|in\s+)?azerbaijani"
    r"|native\s+azerbaijani|azeri\s+language"
)


def detect_languages(text: str) -> set:
    hay = norm_lower(text)
    found = set()
    for lang, markers in _LANG_MARKERS.items():
        for m in markers:
            if m in hay:
                found.add(lang)
                break
    if "az" not in found and _AZ_LANGUAGE_CONTEXT.search(hay):
        found.add("az")
    return found


def parse_experience(az: str):
    label = (az or "").strip().lower()

    # Glorri's own "Təcrübə" sidebar field uses "N ilədək" (up to N years),
    # "N-M il" (a range) and "N ildən artıq" (more than N years) — a more
    # regular, numeric shape than the hand-picked _EXPERIENCE_BANDS labels
    # below (written for a different source's fixed set of options), so it
    # is matched by regex rather than added as more fixed strings.
    m = re.search(r"(\d+)\s*ilə?dək", label)
    if m:
        return (0, int(m.group(1))), (az or "").strip()
    m = re.search(r"(\d+)\s*-\s*(\d+)\s*il\b", label)
    if m:
        return (int(m.group(1)), int(m.group(2))), (az or "").strip()
    m = re.search(r"(\d+)\s*ild[əe]n\s*art[ıi]q", label)
    if m:
        return (int(m.group(1)), 99), (az or "").strip()

    for key, band in _EXPERIENCE_BANDS.items():
        if key in label:
            return band, (az or "").strip()
    # English-language experience levels (platform-posted vacancies and
    # generic ingest payloads don't use the Azerbaijani glorri labels).
    _EN_BANDS = [
        (("intern", "trainee", "junior", "entry", "0-1", "1 ildən aşağı"), (0, 1)),
        (("middle", "mid-level", "1-3", "1 ildən 3"), (1, 3)),
        (("senior", "3-5", "3 ildən 5"), (3, 5)),
        (("lead", "principal", "staff", "5+", "5 ildən artıq"), (5, 99)),
    ]
    for markers, band in _EN_BANDS:
        if any(m in label for m in markers):
            return band, (az or "").strip()
    return (None, None), (az or "").strip()


def parse_education(az: str):
    label = (az or "").strip().lower()
    rank = 0
    for key, r in _EDUCATION_RANK.items():
        if key in label:
            rank = r
            break
    return rank, (az or "").strip()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
def parse_glorri_salary(raw: str | None):
    """Parses glorri's "Əmək haqqı" sidebar string into (from, to, currency).

    Observed shapes: "700-700AZN" (fixed), "1000-1500AZN" (range),
    "600-AZN" (floor only, open-ended), "0-0AZN" (glorri's own way of saying
    "not specified" — a real posting is never actually offering 0), and
    occasional free-text noise ("500.00 AZN net Ə/H-AZN") that isn't worth
    reverse-engineering. Falls back to (None, None, currency-if-any) — found
    less, not invented — rather than guessing at a malformed string.
    """
    text = (raw or "").strip()
    if not text:
        return None, None, None
    currency = "AZN" if re.search(r"azn", text, re.I) else None

    m = re.search(r"([\d.]+)\s*-\s*([\d.]*)", text)
    if not m:
        return None, None, currency

    def to_num(s: str):
        try:
            v = float(s)
            return int(v) if v > 0 and math.isfinite(v) else None
        except (TypeError, ValueError):
            return None

    lo = to_num(m.group(1))
    hi = to_num(m.group(2))
    if lo is None and hi is None:
        return None, None, currency
    return lo, (hi if hi is not None else lo), currency


def parse_job(raw: dict, with_counts: bool = True) -> dict:
    detail = raw.get("detail") or {}
    sidebar = detail.get("sidebar") or {}
    company_raw = raw.get("company") or {}
    title = clean_html(raw.get("title") or detail.get("title"))
    cat_name = clean_html(detail.get("category")) or clean_html(raw.get("jobFunction"))
    company = clean_html(company_raw.get("name") or detail.get("company_name"))
    location = clean_html(raw.get("location") or detail.get("location"))
    location = re.sub(r"[,\s]+azərbaycan\s*$", "", location, flags=re.I).strip().rstrip(",").strip()
    description = clean_html(detail.get("description_text"))
    requirements = clean_html(detail.get("requirements_text"))

    full_text = " ".join([title, cat_name, description, requirements])
    req_text = " ".join([requirements])
    title_text = " ".join([title, cat_name])

    # Glorri never sends experience/education/salary as top-level keys the way
    # a platform-posted Vacancy or generic ingest payload does — those values
    # live under detail.sidebar, in Azerbaijani, under glorri's own labels
    # ("Təcrübə", "Təhsil", "Əmək haqqı"). Prefer the flat keys (other
    # sources), fall back to the sidebar (glorri) so both shapes resolve to
    # real data instead of the sidebar text silently going unread.
    exp_lo, exp_hi, exp_label = (0, 0, "")
    try:
        (exp_lo, exp_hi), exp_label = parse_experience(raw.get("experience") or sidebar.get("Təcrübə"))
    except Exception:
        pass
    edu_rank, edu_label = parse_education(raw.get("education") or sidebar.get("Təhsil"))
    seniority_label = clean_html(sidebar.get("Vəzifə dərəcəsi"))

    def num(v):
        try:
            f = float(v)
            return int(f) if math.isfinite(f) else None
        except Exception:
            return None

    slug = str(raw.get("slug"))
    co_slug = clean_html(company_raw.get("slug"))
    url = JOB_URL.format(company=co_slug, slug=slug) if co_slug else ""
    # Language requirements are routinely stated in the description body, not
    # just the requirements section — scan the full text. (Previously only
    # req_text was scanned, so jobs naming languages elsewhere both dodged
    # the filter when they shouldn't and triggered it inconsistently.)
    # Remote detection: glorri payloads carry isRemote/employment_type; the
    # location string is the fallback shared with generic payloads.
    emp_type = clean_html(detail.get("employment_type") or raw.get("employment_type") or raw.get("type"))
    loc_for_remote = " ".join([location, emp_type, cat_name])
    arrangement_raw = clean_html(raw.get("workArrangement") or detail.get("workArrangement") or "").lower().replace("_", "-")
    if arrangement_raw in ("remote", "fully remote", "work from home", "uzaqdan", "məsafədən", "mesafeden"):
        work_arrangement = "remote"
    elif arrangement_raw in ("hybrid", "hibrid", "mixed"):
        work_arrangement = "hybrid"
    elif arrangement_raw in ("onsite", "on-site", "on site", "office", "əyani", "ofis"):
        work_arrangement = "onsite"
    else:
        work_arrangement = "remote" if bool(raw.get("isRemote")) or canonical_location(loc_for_remote) == "remote" else None
    is_remote = work_arrangement == "remote"

    # Same flat-key-first, sidebar-fallback shape as experience/education
    # above — glorri's salary text ("700-700AZN", "600-AZN", ...) lives under
    # detail.sidebar["Əmək haqqı"], never as top-level salaryFrom/To keys.
    sb_from, sb_to, sb_currency = parse_glorri_salary(sidebar.get("Əmək haqqı"))
    salary_from = num(raw.get("salaryFrom"))
    salary_to = num(raw.get("salaryTo"))
    if salary_from is None and salary_to is None:
        salary_from, salary_to = sb_from, sb_to
    return {
        "id": slug,
        "source": "job",
        "title": title,
        "category": cat_name,
        "company": company,
        "location": location,
        "location_canonical": canonical_location(location),
        "is_remote": is_remote,
        "work_arrangement": work_arrangement,
        "salary_from": salary_from,
        "salary_to": salary_to,
        "salary_currency": (raw.get("salaryCurrency") or detail.get("salary_currency") or sb_currency or "AZN"),
        "seniority_label": seniority_label,
        "experience_label": exp_label,
        "exp_lo": exp_lo,
        "exp_hi": exp_hi,
        "education_label": edu_label,
        "edu_rank": edu_rank,
        "description": description,
        "requirements": requirements,
        "responsibilities": "",
        "full_text": full_text,
        "req_text": req_text,
        "title_text": title_text,
        "languages_required": sorted(detect_languages(full_text)),
        "concepts": extract_concepts(full_text),
        "title_concepts": extract_concepts(title),
        # per-concept counts only order the "gaps" list of the embedding scorer; the rules scorer passes with_counts=False
        "concept_counts": concept_count(full_text) if with_counts else {},
        "status": raw.get("status"),
        "hits": raw.get("viewCount"),
        "url": url,
    }


def parse_vacancy(raw: dict, with_counts: bool = True) -> dict:
    """Parse a platform-posted employer Vacancy into the same schema parse_job
    returns, so score_job() can rank it with zero special-casing.

    The TS adapter (job-matching.service.ts:buildVacancyPayload) sends the
    Vacancy row's native columns — title/description/requirements/
    responsibilities/skills[]/salaryMin-Max/location/workArrangement/
    experienceLevel/company — never a glorri-shaped cast.
    """
    title = clean_html(raw.get("title"))
    company = clean_html((raw.get("company") or {}).get("name") if isinstance(raw.get("company"), dict) else raw.get("company"))
    location = clean_html(raw.get("location"))
    description = clean_html(raw.get("description"))
    requirements = clean_html(raw.get("requirements"))
    responsibilities = clean_html(raw.get("responsibilities"))
    skills = " ".join(clean_html(s) for s in (raw.get("skills") or []) if s)

    full_text = " ".join([title, description, requirements, responsibilities, skills])
    req_text = " ".join([requirements, responsibilities, skills])

    arrangement_raw = clean_html(raw.get("workArrangement")).lower().replace("_", "-")
    if arrangement_raw in ("remote", "fully remote", "work from home", "uzaqdan", "məsafədən", "mesafeden"):
        work_arrangement = "remote"
    elif arrangement_raw in ("hybrid", "hibrid", "mixed"):
        work_arrangement = "hybrid"
    elif arrangement_raw in ("onsite", "on-site", "on site", "office", "əyani", "ofis"):
        work_arrangement = "onsite"
    else:
        work_arrangement = "remote" if canonical_location(location) == "remote" else None
    # Keep `is_remote` as a compatibility flag for genuinely remote postings.
    # Hybrid requires a location-aware comparison and must not be treated as remote.
    is_remote = work_arrangement == "remote"

    (exp_lo, exp_hi), exp_label = parse_experience(raw.get("experienceLevel"))

    def num(v):
        try:
            f = float(v)
            return int(f) if math.isfinite(f) else None
        except Exception:
            return None

    return {
        "id": str(raw.get("id")),
        "source": "vacancy",
        "title": title,
        "category": "",
        "company": company,
        "location": location,
        "location_canonical": canonical_location(location),
        "is_remote": is_remote,
        "work_arrangement": work_arrangement,
        "salary_from": num(raw.get("salaryMin")),
        "salary_to": num(raw.get("salaryMax")),
        "salary_currency": (raw.get("salaryCurrency") or "AZN"),
        "experience_label": exp_label,
        "exp_lo": exp_lo,
        "exp_hi": exp_hi,
        "education_label": "",
        "edu_rank": 0,
        "description": description,
        "requirements": requirements,
        "responsibilities": responsibilities,
        "full_text": full_text,
        "req_text": req_text,
        "title_text": title,
        "languages_required": sorted(detect_languages(full_text)),
        "concepts": extract_concepts(full_text),
        "title_concepts": extract_concepts(title),
        # per-concept counts only order the "gaps" list of the embedding scorer; the rules scorer passes with_counts=False
        "concept_counts": concept_count(full_text) if with_counts else {},
        "status": raw.get("status"),
        "hits": raw.get("views"),
        "url": "",
    }


def parse_persona(data: dict) -> dict:
    langs = set()
    for entry in data.get("languages", []):
        code = (entry.get("code") or "").lower()
        if code in _LANG_MARKERS:
            langs.add(code)
    experience = data.get("years_of_experience")
    summary = clean_html(data.get("summary"))
    titles = [clean_html(t) for t in data.get("target_titles", [])]
    skills = [clean_html(s) for s in data.get("hard_skills", [])]
    soft = [clean_html(s) for s in data.get("soft_skills", [])]

    roles = []
    for r in data.get("experience_history", []):
        roles.append({
            "company": clean_html(r.get("company")),
            "role": clean_html(r.get("role")),
            "location": clean_html(r.get("location")),
            "dates": clean_html(r.get("dates")),
            "achievements": [clean_html(a) for a in r.get("achievements", [])],
        })

    evidence_text = " ".join([
        summary,
        " ".join(titles),
        " ".join(skills),
        " ".join(soft),
        " ".join(a for r in roles for a in r["achievements"]),
        " ".join(r["role"] for r in roles),
    ])
    evidence = set(extract_concepts(evidence_text))
    # What the candidate IS (headline, target roles, past job titles), as opposed
    # to everything their descriptions happen to mention.
    role_concepts = set(extract_concepts(" ".join([summary] + titles + [r["role"] for r in roles])))

    cities = [canonical_location(c) for c in data.get("preferred_cities", [])]
    # Remote/work-arrangement preferences ride along with cities in the TS
    # adapter's `locations` array ("Uzaqdan", ...). Split them out: a remote
    # preference must make remote jobs location-neutral, never act as a city
    # that every onsite job fails against.
    arrangements = {(a or "").strip().lower() for a in data.get("work_arrangements", []) if a}
    if "remote" in cities:
        cities.remove("remote")
        arrangements.add("remote")
    if "hybrid" in cities:
        cities.remove("hybrid")
        arrangements.add("hybrid")
    if "onsite" in cities:
        cities.remove("onsite")
        arrangements.add("onsite")
    sal = data.get("salary_expectation", {}) or {}
    return {
        "candidate_id": data.get("candidate_id", "usr_test"),
        "name": clean_html(data.get("name")),
        "email": clean_html(data.get("email")),
        "phone": clean_html(data.get("phone")),
        "linkedin": clean_html(data.get("linkedin")),
        "location": clean_html(data.get("location")),
        "target_titles": titles,
        "hard_skills": skills,
        "soft_skills": soft,
        "experience_history": roles,
        "years_of_experience": experience,
        "education": data.get("education") or {},
        "languages": data.get("languages", []),
        "languages_set": langs,
        "salary_min": sal.get("monthly_min"),
        "salary_max": sal.get("monthly_max"),
        "salary_currency": sal.get("currency", "AZN"),
        "preferred_cities": cities,
        "work_arrangements": sorted(arrangements),
        "citizenship": clean_html(data.get("citizenship")),
        "certifications": data.get("certifications", []),
        "summary": summary,
        "evidence": evidence,
        "role_concepts": role_concepts,
        "query_text": " ".join([
            summary,
            "Target roles: " + "; ".join(titles) + ".",
            "Skills: " + "; ".join(skills + soft) + ".",
            "Experience: " + " ".join(r["role"] + " at " + r["company"] for r in roles) + ".",
            "Achievements: " + " ".join(a for r in roles for a in r["achievements"]) + ".",
            "Languages: " + ", ".join(sorted(langs)),
        ]),
    }


# ---------------------------------------------------------------------------
# Embeddings (multilingual model, computed in memory on every run - no cache)
# ---------------------------------------------------------------------------
def prefetch_model(attempts: int = 3, wait_s: float = 20.0) -> None:
    """Download the pinned model into the Hugging Face cache (image build step).

    Retries a transient network failure a bounded number of times; the last
    failure is raised so the build fails rather than shipping without weights.
    """
    from sentence_transformers import SentenceTransformer
    for attempt in range(1, attempts + 1):
        try:
            SentenceTransformer(EMB_MODEL, device="cpu", revision=EMB_MODEL_REVISION)
            return
        except Exception as exc:  # network/transfer errors vary by backend
            print(f"model download attempt {attempt}/{attempts} failed: {type(exc).__name__}", file=sys.stderr)
            if attempt == attempts:
                raise
            time.sleep(wait_s * attempt)


class Embedder:
    def __init__(self, model_name: str = EMB_MODEL):
        self.model_name = model_name
        self._model = None

    def _load(self):
        from sentence_transformers import SentenceTransformer
        self._model = SentenceTransformer(self.model_name, device="cpu", revision=EMB_MODEL_REVISION)

    def encode(self, texts, batch_size: int = 24) -> np.ndarray:
        if self._model is None:
            self._load()
        arr = self._model.encode(
            list(texts),
            normalize_embeddings=True,
            batch_size=batch_size,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return np.asarray(arr, dtype="float32")


_EMBEDDER = None


def _shared_embedder() -> "Embedder":
    """One lazy model instance per process (avoids loading it twice per run)."""
    global _EMBEDDER
    if _EMBEDDER is None:
        _EMBEDDER = Embedder()
    return _EMBEDDER


def _split_sentences(text: str):
    return [s for s in re.split(r"(?<=[.!?…])\s+|\n+", text) if s.strip()]


def chunk_text(text: str, max_chars: int = 620, min_chars: int = 80) -> list:
    text = " ".join(text.split())
    sents = _split_sentences(text)
    chunks, cur = [], ""
    for s in sents:
        if len(s) > max_chars:
            if cur:
                chunks.append(cur.strip())
                cur = ""
            while len(s) > max_chars:
                chunks.append(s[:max_chars].strip())
                s = s[max_chars:]
            cur = s
        elif len(cur) + len(s) + 1 <= max_chars:
            cur = (cur + " " + s).strip()
        else:
            if cur.strip():
                chunks.append(cur.strip())
            cur = s
    if cur.strip():
        chunks.append(cur.strip())
    if not chunks:
        chunks = [text[:max_chars]] if text else []
    return chunks


def _cos(a, b) -> float:
    if np is None or a is None or b is None:
        return 0.0
    a, b = np.asarray(a, dtype="float32"), np.asarray(b, dtype="float32")
    if a.size == 0 or b.size == 0:
        return 0.0
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.clip(np.dot(a, b) / (na * nb), 0.0, 1.0))


def _pool(embedder: "Embedder", chunk_lists: list) -> list:
    """Mean-pool chunk embeddings per document; zero vector for empty docs."""
    flat = [t for ch in chunk_lists for t in ch]
    vecs = embedder.encode(flat, batch_size=24) if flat else np.zeros((0, 384), "float32")
    idx = 0
    out = []
    for chunks in chunk_lists:
        if not chunks:
            out.append([0.0] * 384)
        else:
            out.append(np.mean(vecs[idx:idx + len(chunks)], axis=0).tolist())
            idx += len(chunks)
    return out


def build_job_index() -> list:
    raw_jobs = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    parsed = [parse_job(j) for j in raw_jobs if j.get("status") in (None, "", "approved")]

    print("  computing embeddings for %d jobs..." % len(parsed))
    t0 = time.time()
    embedder = _shared_embedder()
    embeds = _pool(embedder, [chunk_text(j["full_text"]) for j in parsed])
    embeds_req = _pool(embedder, [chunk_text(j["req_text"]) for j in parsed])
    titles = [j["title_text"] or j["title"] or j["category"] for j in parsed]
    embeds_title = embedder.encode(titles, batch_size=24)

    for i, j in enumerate(parsed):
        j["emb"] = [float(v) for v in embeds[i]]
        j["emb_req"] = [float(v) for v in embeds_req[i]]
        j["emb_title"] = np.asarray(embeds_title[i], dtype="float32").reshape(-1).tolist()

    print("  done (%.1f s)" % (time.time() - t0))
    return parsed


_JOBS_INDEX = None


def load_jobs() -> list:
    """Build the parsed+embedded job index once per process (in-memory only)."""
    global _JOBS_INDEX
    if _JOBS_INDEX is None:
        _JOBS_INDEX = build_job_index()
    return _JOBS_INDEX


def load_job_by_id(job_id: str) -> dict:
    jobs = load_jobs()
    for j in jobs:
        if j["id"] == str(job_id):
            return j
    return None


def _persona_vectors(persona: dict) -> dict:
    print("  computing persona embeddings...")
    embedder = _shared_embedder()
    labels = []
    if persona["target_titles"]:
        labels = list(persona["target_titles"])
    skills = list(persona["hard_skills"] + persona["soft_skills"])
    query = embedder.encode([persona["query_text"]])[0]
    role_vecs = {lbl: embedder.encode([lbl])[0] for lbl in labels} if labels else {}
    skill_vecs = {sk: embedder.encode([sk])[0] for sk in skills} if skills else {}
    return {
        "query": query,
        "roles": role_vecs,
        "skills": skill_vecs,
    }


def load_persona(path: Path = PERSONA_FILE) -> dict:
    if not path.exists():
        data = build_test_persona()
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print("  created %s" % path.name)
    return parse_persona(json.loads(path.read_text(encoding="utf-8")))


# ---------------------------------------------------------------------------
# Phase 2 - matching / scoring
# ---------------------------------------------------------------------------
# Seniority markers matched (word-boundary) against the job title when the
# posting carries no structured experience requirement. Structured labels
# (exp_lo/exp_hi) already drive the experience filter; this only catches the
# common glorri case of a senior-titled posting with no machine-readable
# experience band, so "Head of Strategy" stops outranking a 1-year candidate
# on embedding similarity alone. Deliberately conservative: fires only for
# clearly junior personas (< 2 yrs), never for mid-level+ candidates.
_SENIOR_TITLE_MARKERS = [
    "senior", "head", "lead", "chief", "director", "vp", "president",
    "principal", "manager", "menecer", "rəhbər", "rehber",
    "baş", "müdir", "mudir", "aparıcı", "aparici",
    "менеджер", "руководитель", "начальник", "заведующ", "директор",
    # Azerbaijani spelling of "director" and "partner" — glorri's own
    # "Vəzifə dərəcəsi" (seniority) sidebar field uses these directly
    # ("Direktor", "Tərəfdaş"), see parse_job's seniority_label.
    "direktor", "tərəfdaş",
]
_SENIOR_TITLE_RES = [_alias_pattern(m.strip()) for m in _SENIOR_TITLE_MARKERS if m.strip()]


def _has_senior_title(title_text: str) -> bool:
    hay = norm_lower(title_text or "")
    return any(pat.search(hay) for pat in _SENIOR_TITLE_RES)


# Approximate FX to AZN for salary comparison. Rates are coarse on purpose:
# the salary filter only needs to know "job pays far below expectation",
# not payroll precision. Unknown currencies fall back to 1.0 (treat as AZN).
_FX_TO_AZN = {"AZN": 1.0, "₼": 1.0, "USD": 1.7, "$": 1.7, "EUR": 1.85, "€": 1.85}


def score_job(persona: dict, job: dict, pv: dict) -> dict:
    semantic = _cos(pv["query"], job.get("emb"))
    role_fit = max([_cos(v, job.get("emb_title")) for v in pv["roles"].values()] or [0.0])
    skill_scores = [_cos(v, job.get("emb_req")) for v in pv["skills"].values()]
    # Top-k pooling, not a mean over every skill: a candidate with 15 skills
    # where 3 match the posting perfectly must outrank one with 3 mediocre
    # matches. The old mean() diluted strong-but-narrow fits and was a direct
    # source of "irrelevant" winners.
    if skill_scores:
        top = sorted(skill_scores, reverse=True)[:3]
        skill_demand = float(sum(top) / len(top))
    else:
        skill_demand = 0.0
    title_skill = max([_cos(v, job.get("emb_title")) for v in pv["skills"].values()] or [0.0])
    skill_demand = max(skill_demand, title_skill)

    # Role relevance from the title itself: "Mühasib" and "Accountant", or
    # "İnşaat mühəndisi" and "Site Engineer", are the same role even where the
    # multilingual title embedding is lukewarm.
    title_concepts = set(job.get("title_concepts") or []) - GENERIC_CONCEPTS
    title_match = bool(title_concepts & set(persona.get("role_concepts") or []))
    if title_match:
        role_fit = max(role_fit, TITLE_MATCH_ROLE_FIT)

    job_concepts = set(job.get("concepts", [])) - GENERIC_CONCEPTS
    evidence = persona["evidence"]
    matched = job_concepts & evidence
    gaps = sorted(job_concepts - evidence, key=lambda c: -job.get("concept_counts", {}).get(c, 0))
    if job_concepts:
        raw_keyword = len(matched) / len(job_concepts)
        # Confidence blend: a ratio over 1-2 concepts is noise (one generic
        # hit like "communication" reads as a perfect 1.0 and inflates thin
        # postings to the top of the ranking). Blend toward neutral when the
        # denominator is small; full weight from 3+ concepts.
        confidence = min(len(job_concepts), 3) / 3.0
        keyword = 0.5 * (1.0 - confidence) + raw_keyword * confidence
    else:
        # No extractable concepts means "no keyword signal", not "bad fit" —
        # stay neutral instead of the old flat 0.2 penalty, which systematically
        # buried short/generic postings regardless of embedding fit.
        keyword = 0.5

    base = (
        W_SEMANTIC * semantic + W_ROLE_FIT * role_fit + W_SKILL_DEMAND * skill_demand + W_KEYWORD * keyword
    )

    notes = {}
    mult = 1.0

    # Location: unknown preferences and remote pairings are NEUTRAL, never a
    # penalty. The old code multiplied 0.6 whenever the city wasn't in the
    # preferred list — including when the user never set any preference, when
    # the job location was missing/unknown, and for remote jobs. That single
    # branch deflated almost every real-world pair into the same low band,
    # destroying ranking discrimination.
    city = job.get("location_canonical", "unknown")
    pref_cities = [c for c in persona.get("preferred_cities", []) if c]
    job_remote = bool(job.get("is_remote")) or city == "remote"
    wants_remote = "remote" in (persona.get("work_arrangements", []) or [])
    if job_remote and (wants_remote or not pref_cities):
        loc_ok = True
    elif not pref_cities or city in ("unknown", ""):
        loc_ok = True
        if pref_cities:
            notes["location"] = "job location unspecified"
    elif city in pref_cities:
        loc_ok = True
    else:
        loc_ok = False
        mult *= 0.6
        notes["location"] = "%s (%s outside preferred)" % (job.get("location"), city)

    # Salary: compare in AZN, correct direction (a job whose ceiling is below
    # the candidate's floor is the bad case — the old `j_from <= s_min → OK`
    # branch had this backwards). Paying ABOVE expectation is never a
    # penalty. Unknown on either side stays neutral.
    fx = _FX_TO_AZN.get(str(persona.get("salary_currency") or "AZN").upper(), 1.0)
    s_min = persona.get("salary_min")
    s_max = persona.get("salary_max")
    try:
        s_min = float(s_min) * fx if s_min is not None else None
        s_max = float(s_max) * fx if s_max is not None else None
    except (TypeError, ValueError):
        s_min, s_max = None, None
    j_fx = _FX_TO_AZN.get(str(job.get("salary_currency") or "AZN").upper(), 1.0)
    j_from, j_to = job.get("salary_from"), job.get("salary_to")
    try:
        j_from = float(j_from) * j_fx if j_from is not None else None
        j_to = float(j_to) * j_fx if j_to is not None else None
    except (TypeError, ValueError):
        j_from, j_to = None, None
    if j_to is None and j_from is None:
        salary_ok = True
        mult *= 0.95
        notes["salary"] = "unspecified"
    elif s_min is not None and j_to is not None and j_to < s_min:
        salary_ok = False
        mult *= 0.75
        notes["salary"] = "job pays up to %d, expect min %d" % (j_to, s_min)
    else:
        salary_ok = True
        if s_max is not None and j_from is not None and j_from > s_max:
            notes["salary"] = "pays above expected range"

    years = persona.get("years_of_experience") or 0
    req_min = job.get("exp_lo") or 0
    if req_min and req_min > years + 0.5:
        exp_ok = False
        # The further the posting is above the candidate, the less it is a stretch.
        gap = req_min - years
        mult *= 0.7 if gap <= 2 else (0.55 if gap <= 4 else 0.4)
        notes["experience"] = "requires %d+ yrs (have %d)" % (req_min, years)
    elif (job.get("exp_hi") is not None and job.get("exp_hi") <= 1 and years >= 5):
        exp_ok = True
        mult *= 0.95
        notes["experience"] = "junior role, senior candidate"
    elif (
        _has_senior_title(job.get("title_text") or "") or _has_senior_title(job.get("seniority_label") or "")
    ) and years < 2:
        # No structured experience band on the posting, but the title itself
        # is senior (Head/Senior/Baş/...), or glorri's own "Vəzifə dərəcəsi"
        # seniority field says so ("Rəhbər", "Direktor", "Tərəfdaş") even when
        # the title text alone doesn't. Mild penalty for clearly junior
        # personas only — mid-level+ candidates are untouched.
        exp_ok = False
        mult *= 0.85
        notes["experience"] = "senior-titled role (%s), junior candidate" % (job.get("title") or "")
    else:
        exp_ok = True

    edu_rank = job.get("edu_rank") or 0
    p_edu = int((persona.get("education") or {}).get("rank", 0))
    if edu_rank > p_edu:
        edu_ok = False
        mult *= 0.8 if edu_rank - p_edu < 2 else 0.65
        notes["education"] = "requires higher education (%s)" % job.get("education_label")
    elif edu_rank and p_edu > edu_rank:
        edu_ok = True
        mult *= 0.97
        notes["education"] = "education exceeds requirement"
    else:
        edu_ok = True

    # Language: proportional to what's actually missing, and neutral when the
    # candidate's languages are unknown. The old flat 0.55 for ANY missing
    # language was the single harshest multiplier — and since the API adapter
    # always sent `languages: []`, it fired on nearly every pair, flattening
    # the whole ranking into noise.
    missing_langs = [l for l in job.get("languages_required", []) if l not in persona["languages_set"]]
    if not job.get("languages_required"):
        lang_ok = True
    elif not persona["languages_set"]:
        lang_ok = True
        notes["language"] = "candidate languages unknown — not penalized"
    elif missing_langs:
        lang_ok = False
        mult *= max(0.7, 1.0 - 0.15 * len(missing_langs))
        notes["language"] = "missing: " + ", ".join(missing_langs)
    else:
        lang_ok = True

    # Regulated occupation (doctor, nurse, lawyer) with nothing in the profile's
    # headline, target roles or past titles that shows it.
    missing_regulated = (set(job.get("title_concepts") or []) & REGULATED_CONCEPTS) - set(persona.get("role_concepts") or [])
    if missing_regulated:
        mult *= 0.4
        notes["qualification"] = "regulated occupation (%s) not shown in profile" % ", ".join(sorted(missing_regulated))

    mult = max(mult, 0.3)
    score = max(0.0, min(100.0, base * mult * 100))

    return {
        "semantic": round(semantic, 3),
        "role_fit": round(role_fit, 3),
        "skill_demand": round(skill_demand, 3),
        "keyword": round(keyword, 3),
        "base": round(base, 3),
        "filter_multiplier": round(mult, 3),
        "filters": {
            "location_ok": loc_ok,
            "salary_ok": salary_ok,
            "experience_ok": exp_ok,
            "education_ok": edu_ok,
            "language_ok": lang_ok,
        },
        "notes": notes,
        "matched_concepts": sorted(matched),
        "gaps": gaps,
        "score": round(score, 1),
    }


def run_matching(top_n: int = 25, rerank: bool = True) -> list:
    print("[1/4] Parsing glorri jobs + computing embeddings...")
    jobs = load_jobs()
    print("[2/4] Loading persona...")
    persona = load_persona()
    pv = _persona_vectors(persona)

    print("[3/4] Scoring %d jobs..." % len(jobs))
    results = []
    for j in jobs:
        sc = score_job(persona, j, pv)
        results.append({
            "id": j["id"],
            "title": j["title"],
            "category": j["category"],
            "company": j["company"],
            "location": j["location"],
            "salary": "%s-%s" % (j["salary_from"], j["salary_to"]) if j["salary_from"] or j["salary_to"] else "-",
            "experience": j["experience_label"],
            "url": j["url"],
            "score": sc["score"],
            "score_detail": sc,
        })
    results.sort(key=lambda r: -r["score"])

    if rerank and _nim().available:
        print("[4/4] LLM rerank (NVIDIA NIM)...")
        results = _nim_rerank(results, persona, top_n=min(top_n, 20))

    return results


# ---------------------------------------------------------------------------
# NVIDIA NIM LLM client (optional enhancement)
# ---------------------------------------------------------------------------
def _load_settings() -> dict:
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _nim() -> "NIMClient":
    return NIMClient()


class NIMClient:
    def __init__(self, api_key: str | None = None, model: str | None = None, base_url: str | None = None):
        cfg = _load_settings().get("nim", {}) or {}
        self.api_key = (api_key or cfg.get("api_key") or os.environ.get("NVIDIA_API_KEY") or "").strip()
        self.model = model or cfg.get("model") or "meta/llama-3.3-70b-instruct"
        self.base_url = base_url or cfg.get("base_url") or "https://integrate.api.nvidia.com/v1/chat/completions"
        self.available = bool(self.api_key)

    def chat(self, messages, temperature: float = 0.1, max_tokens: int = 2000, timeout: int = 150) -> str:
        import requests
        resp = requests.post(
            self.base_url,
            headers={"Authorization": "Bearer %s" % self.api_key, "Content-Type": "application/json"},
            json={"model": self.model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens},
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


def extract_json(text: str):
    text = re.sub(r"```(?:json)?", "", text).strip()
    for open_ch, close_ch in (("[", "]"), ("{", "}")):
        start = text.find(open_ch)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(text)):
            c = text[i]
            if c == open_ch:
                depth += 1
            elif c == close_ch:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except Exception:
                        break
    return None


def _nim_rerank(results: list, persona: dict | None = None, top_n: int = 20) -> list:
    shortlist = results[:top_n]
    jobs_by_id = {j["id"]: j for j in load_jobs()}
    payload = []
    for r in shortlist:
        job = jobs_by_id.get(r["id"])
        reqs = (job or {}).get("req_text", "")[:220]
        payload.append({
            "id": r["id"],
            "title": r["title"],
            "category": r["category"],
            "salary": r["salary"],
            "reqs": reqs,
        })
    # The rerank prompt must describe the ACTUAL candidate being scored.
    # (It previously hardcoded a sales+accounting generalist persona, so every
    # rerank for any other candidate — e.g. a software engineer — was judged
    # against fabricated qualifications.)
    if persona:
        titles = ", ".join((persona.get("target_titles") or [])[:6]) or "unspecified"
        skills = ", ".join((persona.get("hard_skills") or [])[:10]) or "unspecified"
        langs = ", ".join(sorted(persona.get("languages_set") or [])) or "unspecified"
        cand_desc = (
            "Target roles: %s; skills: %s; %s years experience; languages: %s; "
            "expects %s-%s %s/month; prefers %s."
            % (
                titles, skills, persona.get("years_of_experience") or 0, langs,
                persona.get("salary_min"), persona.get("salary_max"),
                persona.get("salary_currency") or "AZN",
                ", ".join(persona.get("preferred_cities") or []) or "unspecified",
            )
        )
    else:
        cand_desc = "unspecified candidate"
    system = (
        "You are a senior recruitment analyst. "
        "Return ONLY valid JSON: a list of objects {\"id\": \"...\", \"score\": 0-100 integer, "
        "\"note\": \"<one-line fit rationale, max 15 words>\"}. Base the score on genuine skill/experience fit. "
        "Never fabricate candidate qualifications."
    )
    user = json.dumps(payload, ensure_ascii=False)
    try:
        out = NIMClient().chat([
            {"role": "system", "content": system},
            {"role": "user", "content": "Candidate persona: %s. Jobs:\n%s" % (cand_desc, user)},
        ], temperature=0.0, max_tokens=3000)
        parsed = extract_json(out)
        if not isinstance(parsed, list):
            return results
        notes = {}
        for item in parsed:
            if isinstance(item, dict) and item.get("id"):
                notes[str(item["id"])] = item
        for r in shortlist:
            item = notes.get(r["id"])
            if not item:
                continue
            try:
                llm_score = float(item.get("score", 0))
            except Exception:
                llm_score = 0.0
            llm_score = max(0.0, min(100.0, llm_score))
            r["score"] = round(0.5 * llm_score + 0.5 * r["score"], 1)
            r["llm_note"] = str(item.get("note", ""))[:120]
        results.sort(key=lambda x: -x["score"])
    except Exception as exc:
        print("  rerank skipped (%s)" % exc)
    return results


# ---------------------------------------------------------------------------
# Test persona generation (seeded random)
# ---------------------------------------------------------------------------
def build_test_persona(seed: int = 7) -> dict:
    rng = random.Random(seed)
    names = [
        "Aytac Məmmədova", "Leyla Hüseynova", "Nigar Əliyeva",
        "Rüfət Quliyev", "Tural İsmayılov", "Günel Rəhimova",
    ]
    name = rng.choice(names)
    email_name = name.lower().replace(" ", ".").replace("ə", "e").replace("ü", "u").replace("ö", "o").replace("ı", "i")
    hard_pool = [
        "Microsoft Excel", "1C: Mühasibat", "CRM", "Bank əməliyyatları",
        "Kassa əməliyyatları", "Qaimə sənədi", "Vergi hesabatları",
        "Maliyyə təhlili", "Microsoft Word", "E-poçt müxbirəsi",
    ]
    soft_pool = [
        "Ünsiyyət bacarıqları", "Müştəri xidməti", "Komanda işi",
        "Vaxtın idarə edilməsi", "Dəqiqlik və diqqət", "Məsuliyyətlilik",
    ]
    rng.shuffle(hard_pool)
    rng.shuffle(soft_pool)
    languages = [
        {"code": "az", "name": "Azerbaijani", "level": "Native"},
        {"code": "en", "name": "English", "level": "Advanced (C1)"},
        {"code": "ru", "name": "Russian", "level": "Advanced (C1)"},
    ]
    roles = [
        {
            "company": "Bakı Plaza MMC",
            "role": "Satış üzrə mütəxəssis",
            "location": "Bakı",
            "dates": "Apr 2022 - Present",
            "achievements": [
                "Aylıq satış hədəfini 115% yerinə yetirərək göstəricini 12 ay dalbadal üstələmişəm",
                "Yeni 40+ müştəri cəlb edərək aktiv satış bazası qurmuşam",
                "Müştəri müraciətlərini CRM-də qeyd edərək satışdan sonrakı xidməti yaxşılaşdırmışam",
                "Topdan və pərakəndə müştərilər üçün qaimə sənədlərini dəqiqliklə tərtib etmişəm",
            ],
        },
        {
            "company": "Azər Körfəz Firması",
            "role": "Mühasib köməkçisi",
            "location": "Bakı",
            "dates": "Jun 2019 - Mar 2022",
            "achievements": [
                "İlkin sənədləri qəbul edərək kassa əməliyyatlarını 100% dəqiqliklə aparmışam",
                "Bank əməliyyatlarını və hesabların barışdırılmasını hər ay vaxtında yerinə yetirmişəm",
                "1C proqramında vergi və mühasibat hesabatlarını hazırlayıb təqdim etmişəm",
                "Xərclər üzrə maliyyə təhlili apararaq büdcəyə riayət olunmasını təmin etmişəm",
            ],
        },
        {
            "company": "Gənc Ofis Xidmətləri",
            "role": "Ofis meneceri köməkçisi",
            "location": "Bakı",
            "dates": "Jul 2018 - May 2019",
            "achievements": [
                "Zənglərə cavab verərək e-poçt yazışmalarını və müştəri görüşlərini təşkil etmişəm",
                "Microsoft Excel-də cədvəl və sənədləşmə işlərini aparmışam",
            ],
        },
    ]
    return {
        "candidate_id": "p_test_sales_accounting_001",
        "name": name,
        "email": email_name + "@gmail.com",
        "phone": "+994 (50) 123-45-67",
        "linkedin": "linkedin.com/in/" + email_name.replace(".", "-"),
        "location": "Bakı",
        "target_titles": [
            "Satış üzrə mütəxəssis", "Satış meneceri", "Sales Specialist",
            "Mühasib", "Accountant", "Ofis meneceri", "Office Manager",
        ],
        "hard_skills": hard_pool,
        "soft_skills": soft_pool,
        "experience_history": roles,
        "years_of_experience": 5,
        "education": {
            "institution": "Bakı Dövlət Universiteti",
            "location": "Bakı",
            "degree": "Bakalavr, Maliyyə və Mühasibat",
            "dates": "Sep 2014 - Jun 2018",
            "rank": 4,
        },
        "languages": languages,
        "salary_expectation": {"currency": "AZN", "monthly_min": 900, "monthly_max": 1500},
        "preferred_cities": ["Bakı"],
        "certifications": [
            {"name": "1C: Peşəkar (Mühasibat modulu)", "issuer": "1C Azerbaijan", "date": "2021"},
            {"name": "Elektron vergi hesabatı təlimi", "issuer": "Vergilər Nazirliyi", "date": "2020"},
        ],
        "summary": (
            "Satış, mühasibat uçotu və ofis idarəçiliyi sahələrində 5 illik təcrübəyə malik "
            "mütəxəssis. Satış hədəflərini mütəmadi üstələyən, maliyyə sənədləşməsində dəqiq, "
            "müştəri münasibətlərində etibarlı işçi."
        ),
    }


def save_test_persona(seed: int = 7, path: Path = PERSONA_FILE) -> Path:
    data = build_test_persona(seed)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
def grade(score: float) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 55:
        return "C"
    if score >= 40:
        return "D"
    return "E"


def salary_str(job: dict) -> str:
    if job.get("salary_from") or job.get("salary_to"):
        lo = job.get("salary_from") or "?"
        hi = job.get("salary_to") or "?"
        return "%s - %s AZN" % (lo, hi)
    return "n/s"
