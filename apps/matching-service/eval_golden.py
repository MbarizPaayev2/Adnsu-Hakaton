# -*- coding: utf-8 -*-
"""Golden eval + regression gate for the AI job-matching scorer.

Covers the exact failure modes behind "irrelevant matches / bad ranking":

  unit (no model download, stub vectors):
    - concept word boundaries ("capital" must not match api, "digital" must
      not match git, "through" must not match hr)
    - language detection scans the description, not just requirements
    - empty location preferences are neutral (no 0.6 penalty)
    - remote jobs are location-neutral for remote-seeking candidates
    - salary direction (job ceiling below expectation = bad; overlap = ok)
    - unknown candidate languages are not penalized
    - skill pooling is top-k (narrow-but-perfect beats broad-but-mediocre)

  golden (real multilingual embeddings, model is cached in CI image):
    - a Full-Stack engineer persona must rank the React and NestJS jobs
      above the Sales Manager job, with a real score spread (ranking
      discrimination, not a compressed 15-35 band).

Run:  python eval_golden.py
Exit code is non-zero on any failure (CI gate).
"""
import sys

import pipeline as P

P.configure_utf8()

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name: str, cond: bool, detail: str = "") -> None:
    results.append((name, bool(cond), detail))
    print("[%s] %s %s" % (PASS if cond else FAIL, name, ("— " + str(detail)) if detail and not cond else ""))


def stub_pv(query=(1.0, 0.0), roles=((1.0, 0.0),), skills=((1.0, 0.0),)):
    import numpy as np
    return {
        "query": np.asarray(query, dtype="float32"),
        "roles": {"r%d" % i: np.asarray(v, dtype="float32") for i, v in enumerate(roles)},
        "skills": {"s%d" % i: np.asarray(v, dtype="float32") for i, v in enumerate(skills)},
    }


def stub_job(**over):
    base = {
        "emb": [1.0, 0.0],
        "emb_req": [1.0, 0.0],
        "emb_title": [1.0, 0.0],
        "concepts": [],
        "concept_counts": {},
        "location": "Bakı",
        "location_canonical": "bakı",
        "is_remote": False,
        "salary_from": None,
        "salary_to": None,
        "salary_currency": "AZN",
        "exp_lo": 0,
        "exp_hi": None,
        "experience_label": "",
        "edu_rank": 0,
        "education_label": "",
        "languages_required": [],
    }
    base.update(over)
    return base


def stub_persona(**over):
    base = {
        "evidence": set(),
        "preferred_cities": [],
        "work_arrangements": [],
        "languages_set": set(),
        "salary_min": None,
        "salary_max": None,
        "salary_currency": "AZN",
        "years_of_experience": 5,
        "education": {"rank": 4},
    }
    base.update(over)
    return base


# ---- concept word boundaries -------------------------------------------
check(
    "concepts: 'capital/rapid/digital' fires no tech concepts",
    not (set(P.extract_concepts("rapid capital growth in digital marketing")) & {"api_rest", "git_vcs", "sql_db", "golang"}),
    str(P.extract_concepts("rapid capital growth in digital marketing")),
)
check(
    "concepts: 'REST API, Git, PostgreSQL' fires api/git/sql",
    {"api_rest", "git_vcs", "sql_db"} <= set(P.extract_concepts("REST API integration, Git version control, PostgreSQL database")),
    str(P.extract_concepts("REST API integration, Git version control, PostgreSQL database")),
)
check(
    "concepts: 'through' is not HR, 'HR manager' is",
    "hr" not in P.extract_concepts("go through the process") and "hr" in P.extract_concepts("HR manager needed"),
    str(P.extract_concepts("go through the process")) + " / " + str(P.extract_concepts("HR manager needed")),
)
check(
    "concepts: bare verb 'go' is not golang, 'Golang developer' is",
    "golang" not in P.extract_concepts("we go the extra mile for clients")
    and "golang" in P.extract_concepts("Golang developer with microservices experience"),
)

# ---- language detection scope -------------------------------------------
job_lang = P.parse_job({
    "title": "Sales Specialist", "slug": "x", "location": "Baku",
    "company": {"slug": "acme", "name": "Acme"},
    "detail": {
        "title": "Sales Specialist", "company_name": "Acme", "location": "Baku",
        "description_text": "Work with Azerbaijani and Russian speaking clients every day.",
        "requirements_text": "3+ years of sales experience.",
        "category": "Sales",
    },
})
check(
    "languages detected from description, not just requirements",
    set(job_lang["languages_required"]) >= {"az", "ru"},
    str(job_lang["languages_required"]),
)

# ---- defects found by the relevance evaluation (docs/matching-evaluation.md) ----
no_country = P.parse_job({
    "title": "Accountant", "slug": "y", "location": "Baku, Azerbaijan",
    "company": {"slug": "acme", "name": "Acme"},
    "detail": {"title": "Accountant", "company_name": "Acme", "location": "Baku, Azerbaijan",
               "description_text": "We have operated in the Azerbaijani market for many years. Azerbaijani customers trust us.",
               "requirements_text": "Accounting degree.", "category": "Finance"},
})
check(
    "a country/nationality mention is not a language requirement",
    "az" not in no_country["languages_required"],
    str(no_country["languages_required"]),
)
check(
    "fluent Azerbaijani and 'Azerbaijani, Russian' lists are language requirements",
    {"az"} <= P.detect_languages("Fluent Azerbaijani is required.") and {"az", "ru"} <= P.detect_languages("Azerbaijani, Russian"),
    "",
)
check(
    "inflected Azerbaijani forms match their stem (mühəndisi, Hüquqşünas, müştərilərlə, kadrlar)",
    all(P.extract_concepts(t) for t in ("İnşaat mühəndisi", "Hüquqşünas", "müştərilərlə", "Kadrlar üzrə mütəxəssis")),
    str([P.extract_concepts(t) for t in ("İnşaat mühəndisi", "Hüquqşünas", "müştərilərlə", "Kadrlar üzrə mütəxəssis")]),
)
check(
    "ASCII aliases stay strict (api not in capital/apical, git not in digital)",
    not P.extract_concepts("capital apical digital") and "javascript" in P.extract_concepts("javascript") and "java_lang" not in P.extract_concepts("javascript"),
    str(P.extract_concepts("capital apical digital javascript")),
)
check(
    "an employment type stored as the location is an unknown place, not a city outside the preferences",
    P.canonical_location("Tam ştat") == "unknown" and P.canonical_location("Yarım ştat") == "unknown"
    and P.canonical_location("Bakı, Azərbaycan") == "bakı",
    "%s %s" % (P.canonical_location("Tam ştat"), P.canonical_location("Bakı, Azərbaycan")),
)
twin_a = P.score_job(stub_persona(preferred_cities=["bakı"]), stub_job(location="Tam ştat", location_canonical=P.canonical_location("Tam ştat"), salary_from=1000, salary_to=2000), stub_pv())
twin_b = P.score_job(stub_persona(preferred_cities=["bakı"]), stub_job(salary_from=1000, salary_to=2000), stub_pv())
check("a 'Tam ştat' location is not penalised as outside the preferred cities", twin_a["score"] == twin_b["score"], "%s vs %s" % (twin_a["score"], twin_b["score"]))
generic_only = P.score_job(
    stub_persona(evidence={"communication", "teamwork"}),
    stub_job(concepts=["communication", "teamwork", "responsibility"], salary_from=1000, salary_to=2000),
    stub_pv(),
)
check("generic soft-skill concepts carry no keyword signal", generic_only["keyword"] == 0.5 and not generic_only["matched_concepts"], str(generic_only["keyword"]))
regulated = P.score_job(
    stub_persona(role_concepts={"nurse"}),
    stub_job(title_concepts=["doctor"], salary_from=1000, salary_to=2000),
    stub_pv(),
)
qualified = P.score_job(
    stub_persona(role_concepts={"doctor"}),
    stub_job(title_concepts=["doctor"], salary_from=1000, salary_to=2000),
    stub_pv(),
)
check(
    "a regulated occupation the profile does not show is heavily discounted",
    regulated["filter_multiplier"] == 0.4 and "qualification" in regulated["notes"] and qualified["filter_multiplier"] == 1.0,
    "%s / %s" % (regulated["filter_multiplier"], qualified["filter_multiplier"]),
)
far_senior = P.score_job(stub_persona(years_of_experience=3), stub_job(exp_lo=9, exp_hi=99, salary_from=1000, salary_to=2000), stub_pv())
near_senior = P.score_job(stub_persona(years_of_experience=3), stub_job(exp_lo=4, exp_hi=6, salary_from=1000, salary_to=2000), stub_pv())
check(
    "the further a posting's required experience is above the candidate, the lower the score",
    far_senior["filter_multiplier"] < near_senior["filter_multiplier"] < 1.0,
    "%s %s" % (far_senior["filter_multiplier"], near_senior["filter_multiplier"]),
)
title_equiv = P.score_job(
    stub_persona(role_concepts={"accountant"}),
    stub_job(title_concepts=["accountant"], emb_title=[0.0, 1.0], salary_from=1000, salary_to=2000),
    stub_pv(),
)
check("an equivalent title credits role fit even when the title embeddings disagree", title_equiv["role_fit"] >= P.TITLE_MATCH_ROLE_FIT, str(title_equiv["role_fit"]))

# ---- location neutrality -------------------------------------------------
# (stub jobs carry an explicit salary so the "unspecified salary" 0.95 does
# not leak into what these assertions measure)
neutral = P.score_job(stub_persona(), stub_job(salary_from=1000, salary_to=2000), stub_pv())
check(
    "empty location prefs are neutral (no 0.6 penalty)",
    neutral["filters"]["location_ok"] is True and neutral["filter_multiplier"] == 1.0,
    str(neutral["filters"]) + " mult=" + str(neutral["filter_multiplier"]),
)
remote_job = stub_job(location="Uzaqdan", location_canonical="remote", is_remote=True,
                    salary_from=1000, salary_to=2000)
remote_ok = P.score_job(stub_persona(preferred_cities=["bakı"], work_arrangements=["remote"]), remote_job, stub_pv())
check(
    "remote job neutral for remote-seeking Baku candidate",
    remote_ok["filters"]["location_ok"] is True,
    str(remote_ok["filters"]),
)
onsite_far = P.score_job(stub_persona(preferred_cities=["bakı"]), stub_job(location="Sumqayıt", location_canonical="sumqayıt"), stub_pv())
check(
    "genuinely outside city still penalized",
    onsite_far["filters"]["location_ok"] is False and onsite_far["filter_multiplier"] < 1.0,
    str(onsite_far["filter_multiplier"]),
)

# ---- salary direction ----------------------------------------------------
below = P.score_job(stub_persona(salary_min=2500), stub_job(salary_from=800, salary_to=1200), stub_pv())
check("job ceiling below expectation penalized", below["filters"]["salary_ok"] is False, str(below["filters"]))
overlap = P.score_job(stub_persona(salary_min=2500, salary_max=5000), stub_job(salary_from=2000, salary_to=6000), stub_pv())
check("overlapping range is OK", overlap["filters"]["salary_ok"] is True, str(overlap["filters"]))
above = P.score_job(stub_persona(salary_min=2500, salary_max=3000), stub_job(salary_from=5000, salary_to=8000), stub_pv())
check("paying above expectation never penalized", above["filters"]["salary_ok"] is True, str(above["filters"]))
fx = P.score_job(stub_persona(salary_min=2500, salary_currency="AZN"), stub_job(salary_from=2000, salary_to=3000, salary_currency="USD"), stub_pv())
check("USD salary converted before compare (2000-3000 USD clears 2500 AZN)", fx["filters"]["salary_ok"] is True, str(fx["notes"]))

# ---- language neutrality / proportionality --------------------------------
unknown_langs = P.score_job(
    stub_persona(languages_set=set()),
    stub_job(languages_required=["az", "en"], salary_from=1000, salary_to=2000),
    stub_pv(),
)
check(
    "unknown candidate languages are not penalized",
    unknown_langs["filters"]["language_ok"] is True and unknown_langs["filter_multiplier"] == 1.0,
    str(unknown_langs["filter_multiplier"]),
)
one_missing = P.score_job(
    stub_persona(languages_set={"az", "en"}),
    stub_job(languages_required=["az", "en", "ru"], salary_from=1000, salary_to=2000),
    stub_pv(),
)
check(
    "one missing language is a mild penalty (>=0.85), not 0.55",
    one_missing["filters"]["language_ok"] is False and one_missing["filter_multiplier"] >= 0.85,
    str(one_missing["filter_multiplier"]),
)

# ---- skill top-k pooling --------------------------------------------------
many_skills = stub_pv(skills=((1.0, 0.0),) * 3 + ((0.0, 1.0),) * 12)
pooled = P.score_job(stub_persona(), stub_job(), many_skills)
check(
    "top-k skill pooling: 3 perfect + 12 irrelevant still scores ~1.0",
    pooled["skill_demand"] >= 0.9,
    "skill_demand=" + str(pooled["skill_demand"]),
)

# ---- keyword neutral default ----------------------------------------------
noc = P.score_job(stub_persona(), stub_job(concepts=[]), stub_pv())
check("no job concepts is neutral (0.5), not a 0.2 penalty", noc["keyword"] == 0.5, str(noc["keyword"]))

# ---- thin-posting confidence blend ----------------------------------------
thin = P.score_job(
    stub_persona(evidence={"sales"}),
    stub_job(concepts=["sales"], salary_from=1000, salary_to=2000),
    stub_pv(),
)
check(
    "1-concept perfect keyword match blends toward neutral (<0.75), not 1.0",
    0.5 < thin["keyword"] < 0.75,
    "keyword=" + str(thin["keyword"]),
)
thick = P.score_job(
    stub_persona(evidence={"a", "b", "c"}),
    stub_job(concepts=["a", "b", "c"], salary_from=1000, salary_to=2000),
    stub_pv(),
)
check("3-concept perfect match keeps full 1.0 weight", thick["keyword"] == 1.0, str(thick["keyword"]))

# ---- seniority-from-title ---------------------------------------------------
senior_junior = P.score_job(
    stub_persona(years_of_experience=1),
    stub_job(title="Head of Strategy", title_text="Head of Strategy",
             salary_from=1000, salary_to=2000),
    stub_pv(),
)
check(
    "senior-titled posting mildly penalized for a 1-yr persona",
    senior_junior["filters"]["experience_ok"] is False
    and senior_junior["filter_multiplier"] == 0.85,
    str(senior_junior["filter_multiplier"]) + " " + str(senior_junior["filters"]),
)
senior_mid = P.score_job(
    stub_persona(years_of_experience=4),
    stub_job(title="Head of Strategy", title_text="Head of Strategy",
             salary_from=1000, salary_to=2000),
    stub_pv(),
)
check(
    "senior-titled posting untouched for a 4-yr persona",
    senior_mid["filters"]["experience_ok"] is True and senior_mid["filter_multiplier"] == 1.0,
    str(senior_mid["filter_multiplier"]),
)
junior_title = P.score_job(
    stub_persona(years_of_experience=1),
    stub_job(title="Data Analyst (junior)", title_text="Data Analyst (junior)",
             salary_from=1000, salary_to=2000),
    stub_pv(),
)
check(
    "non-senior title never triggers the junior penalty",
    junior_title["filters"]["experience_ok"] is True and junior_title["filter_multiplier"] == 1.0,
    str(junior_title["filter_multiplier"]),
)
seniority_label_senior = P.score_job(
    stub_persona(years_of_experience=1),
    stub_job(title="Satış üzrə mütəxəssis", title_text="Satış üzrə mütəxəssis",
             seniority_label="Rəhbər", salary_from=1000, salary_to=2000),
    stub_pv(),
)
check(
    "glorri's own seniority sidebar field (Vəzifə dərəcəsi) triggers the junior penalty"
    " even when the title text alone doesn't look senior",
    seniority_label_senior["filters"]["experience_ok"] is False
    and seniority_label_senior["filter_multiplier"] == 0.85,
    str(seniority_label_senior["filter_multiplier"]) + " " + str(seniority_label_senior["filters"]),
)

# ---- glorri's sidebar-only experience/education/salary fields -------------
# Real defect: glorri never sends experience/education/salary as top-level
# raw keys — those values live under detail.sidebar, in Azerbaijani, under
# glorri's own labels. parse_job used to read raw["experience"]/["education"]/
# ["salaryFrom"], which don't exist on a real glorri payload, so every
# glorri-sourced job silently scored as "no experience/education requirement,
# no salary" regardless of what the posting actually said.
GLORRI_SIDEBAR_JOB = {
    "slug": "job-1",
    "title": "Mühasib",
    "company": {"name": "Acme"},
    "location": "Bakı",
    "detail": {
        "title": "Mühasib",
        "company_name": "Acme",
        "location": "Bakı",
        "description_text": "Mühasibatlıq şöbəsində işləmək.",
        "requirements_text": "Excel biliyi tələb olunur.",
        "category": "Mühasibatlıq",
        "sidebar": {
            "Təcrübə": "1-2 il",
            "Təhsil": "Bakalavr",
            "Əmək haqqı": "700-900AZN",
            "Vəzifə dərəcəsi": "Rəhbər",
        },
    },
}
sidebar_job = P.parse_job(GLORRI_SIDEBAR_JOB)
check(
    "experience is parsed from the sidebar (\"1-2 il\") when no flat key exists",
    (sidebar_job["exp_lo"], sidebar_job["exp_hi"]) == (1, 2),
    str((sidebar_job["exp_lo"], sidebar_job["exp_hi"])),
)
check(
    "education is parsed from the sidebar (\"Bakalavr\") when no flat key exists",
    sidebar_job["edu_rank"] == 4,
    str(sidebar_job["edu_rank"]),
)
check(
    "salary is parsed from the sidebar (\"700-900AZN\") when no flat key exists",
    (sidebar_job["salary_from"], sidebar_job["salary_to"], sidebar_job["salary_currency"]) == (700, 900, "AZN"),
    str((sidebar_job["salary_from"], sidebar_job["salary_to"], sidebar_job["salary_currency"])),
)
check(
    "seniority label is carried through from the sidebar",
    sidebar_job["seniority_label"] == "Rəhbər",
    str(sidebar_job["seniority_label"]),
)

check(
    "glorri's own \"0-0AZN\" salary placeholder is treated as unspecified, not a real zero",
    P.parse_glorri_salary("0-0AZN") == (None, None, "AZN"),
    str(P.parse_glorri_salary("0-0AZN")),
)
check(
    "an open-ended floor-only salary (\"600-AZN\") repeats the floor as the ceiling",
    P.parse_glorri_salary("600-AZN") == (600, 600, "AZN"),
    str(P.parse_glorri_salary("600-AZN")),
)
check(
    "\"N ilədək\" (up to N years) parses as (0, N)",
    P.parse_experience("1 ilədək")[0] == (0, 1),
    str(P.parse_experience("1 ilədək")),
)
check(
    "\"N ildən artıq\" (more than N years) parses as (N, 99)",
    P.parse_experience("9 ildən artıq")[0] == (9, 99),
    str(P.parse_experience("9 ildən artıq")),
)
check(
    "Magistr (Master's) ranks the same tier as Bakalavr, matching the TS-side profile estimate",
    P.parse_education("Magistr")[0] == P.parse_education("Bakalavr")[0] == 4,
    str((P.parse_education("Magistr"), P.parse_education("Bakalavr"))),
)
check(
    "\"natamam ali\" ranks below \"ali\" instead of matching \"ali\" as a substring first",
    P.parse_education("natamam ali")[0] == 3,
    str(P.parse_education("natamam ali")),
)

# ---- golden ordering with real embeddings ---------------------------------
print("--- golden ordering (real embeddings) ---")
try:
    TECH_PERSONA = {
        "candidate_id": "golden_tech",
        "name": "Alex Developer",
        "location": "Bakı",
        "languages": [{"code": "az"}, {"code": "en"}],
        "years_of_experience": 4,
        "summary": "Senior Full Stack Engineer building web apps with React, TypeScript and Node.js.",
        "target_titles": ["Software Engineer", "Full Stack Developer", "Backend Developer"],
        "hard_skills": ["TypeScript", "JavaScript", "React", "Next.js", "NestJS", "Node.js", "PostgreSQL", "Tailwind CSS"],
        "soft_skills": ["Communication"],
        "experience_history": [
            {"company": "Tech Corp", "role": "Full Stack Engineer", "location": "Bakı", "dates": "2023-2026",
             "achievements": ["Built AI dashboards with React, TypeScript and NestJS on cloud infrastructure"]},
        ],
        "education": {"rank": 4},
        "salary_expectation": {"monthly_min": 2500, "monthly_max": 5000, "currency": "AZN"},
        "preferred_cities": ["Bakı"],
        "work_arrangements": ["remote", "hybrid"],
        "certifications": [],
    }

    def mkjob(slug, title, company, location, desc, reqs):
        return {
            "title": title, "slug": slug, "location": location,
            "company": {"slug": company.lower().replace(" ", "-"), "name": company},
            "detail": {"title": title, "company_name": company, "location": location,
                       "description_text": desc, "requirements_text": reqs, "category": "IT"},
        }

    JOBS = [
        mkjob("react-remote", "Senior Software Engineer (React / TypeScript)", "Innovate AI", "Uzaqdan",
              "We are seeking a Senior Software Engineer to build our AI dashboards.",
              "Strong experience with React, TypeScript, and Tailwind CSS. Node.js backend knowledge is a big plus. Fully remote role."),
        mkjob("nestjs-hybrid", "NestJS Backend Developer", "SaaS Solutions", "Bakı",
              "Looking for a backend engineer to design scalable APIs.",
              "Must have solid experience with NestJS, Node.js, PostgreSQL, and TypeScript. Hybrid work setting."),
        mkjob("sales-sumqayit", "Senior Sales Manager", "Global Retail", "Sumqayıt",
              "Lead our retail sales division across stores.",
              "Requires 5+ years of B2B sales management. Tech skills not required, leadership and communication essential."),
    ]

    from main import _embed_job

    persona = P.parse_persona(TECH_PERSONA)
    pv = P._persona_vectors(persona)
    scored = []
    for raw in JOBS:
        job = _embed_job(P.parse_job(raw))
        detail = P.score_job(persona, job, pv)
        scored.append((raw["slug"], detail["score"], detail))
        print("  %-14s %.1f  mult=%s notes=%s" % (raw["slug"], detail["score"], detail["filter_multiplier"], detail["notes"]))
    by_id = {s: v for s, v, _ in scored}
    check("tech persona: React job outranks Sales job", by_id["react-remote"] > by_id["sales-sumqayit"], str(by_id))
    check("tech persona: NestJS job outranks Sales job", by_id["nestjs-hybrid"] > by_id["sales-sumqayit"], str(by_id))
    spread = max(by_id.values()) - min(by_id.values())
    check("ranking has real spread (>10 pts, not a compressed band)", spread > 10, "spread=%.1f" % spread)

    # ---- vacancy path (platform-posted, no glorri shape) -------------------
    from main import _parse_posting

    VACANCIES = [
        {"id": "vac_react", "title": "Frontend Developer (React)", "company": {"name": "Local Startup"},
         "location": "Bakı", "description": "Build customer-facing web apps.",
         "requirements": "2+ years with React, TypeScript and REST APIs.",
         "responsibilities": "Ship features with the product team.",
         "skills": ["React", "TypeScript", "REST"], "salaryMin": 2000, "salaryMax": 3500,
         "workArrangement": "hybrid", "experienceLevel": "1-3 years", "status": "ACTIVE", "views": 10},
        {"id": "vac_sales", "title": "Sales Representative", "company": {"name": "Retail Chain"},
         "location": "Bakı", "description": "Sell consumer goods in stores.",
         "requirements": "Active sales experience, negotiation, customer service.",
         "responsibilities": "Meet monthly sales targets.",
         "skills": ["Satış", "Müştəri xidməti"], "salaryMin": 800, "salaryMax": 1200,
         "workArrangement": "onsite", "experienceLevel": "1-3 years", "status": "ACTIVE", "views": 5},
    ]
    vscores = {}
    for raw in VACANCIES:
        job = _embed_job(_parse_posting(raw))
        check("vacancy parses to source=vacancy (%s)" % raw["id"], job.get("source") == "vacancy", str(job.get("source")))
        detail = P.score_job(persona, job, pv)
        vscores[raw["id"]] = detail["score"]
        print("  %-14s %.1f  mult=%s" % (raw["id"], detail["score"], detail["filter_multiplier"]))
    check("tech persona: React vacancy outranks Sales vacancy", vscores["vac_react"] > vscores["vac_sales"], str(vscores))
except Exception as exc:  # model unavailable (offline CI): unit tests above still gate
    print("  golden embedding tests SKIPPED (%s)" % exc)

failed = [r for r in results if not r[1]]
print("---\n%d/%d checks passed" % (len(results) - len(failed), len(results)))
sys.exit(1 if failed else 0)
