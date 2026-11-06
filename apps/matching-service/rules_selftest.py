# -*- coding: utf-8 -*-
"""Behavioural checks for the deterministic scorer (rules_scorer.py). No model, no network.
Run: python rules_selftest.py"""
import copy

import pipeline as P
import rules_scorer as R

PERSONA = {
    "candidate_id": "t", "location": "Bakı", "languages": [{"code": "az"}, {"code": "en"}],
    "years_of_experience": 4, "summary": "Accountant", "target_titles": ["Accountant", "Mühasib"],
    "hard_skills": ["Excel", "1C", "Tax", "Payroll"], "soft_skills": [],
    "experience_history": [{"company": "X", "role": "Accountant", "location": "", "dates": "", "achievements": ["Prepared tax reports and payroll"]}],
    "education": {"rank": 4}, "preferred_cities": ["Bakı"], "work_arrangements": [], "certifications": [],
}


def job(title, requirements="", description="", **extra):
    raw = {"slug": "x-" + title, "title": title, "location": extra.pop("location", "Bakı"), "company": {"name": "C", "slug": "c"},
           "detail": {"title": title, "description_text": description, "requirements_text": requirements}}
    raw.update(extra)
    return raw


def score(persona_raw, job_raw):
    d = R.score_job(P.parse_persona(copy.deepcopy(persona_raw)), R.parse_posting(job_raw))
    return d["score"], d


# 1. Determinism: identical input, identical output.
j = job("Mühasib", "Excel və vergi hesabatı bilikləri tələb olunur. Əmək haqqı hesablanması.")
assert score(PERSONA, j)[0] == score(PERSONA, j)[0]
print("OK  deterministic")

# 2. Synonyms across Azerbaijani / Russian / English titles meet the same occupation.
for title in ("Mühasib", "Бухгалтер", "Accountant", "Baş mühasib"):
    s, d = score(PERSONA, job(title, "Excel, tax, payroll"))
    assert d["components"][0]["value"] in (1.0,), (title, d["components"][0])
print("OK  AZ/RU/EN titles for one occupation")

# 3. A different occupation scores far lower and is not stored.
s_other, d_other = score(PERSONA, job("Aşpaz", "Mətbəx təcrübəsi"))
s_same, _ = score(PERSONA, job("Mühasib", "Excel, tax, payroll"))
assert s_other < 35 <= s_same, (s_other, s_same)
print("OK  unrelated occupation is not recommended")

# 4. Repetition never raises a score (sets, not counts), in the posting or in the profile.
base, _ = score(PERSONA, job("Mühasib", "Excel və vergi bilikləri tələb olunur."))
rep_job, _ = score(PERSONA, job("Mühasib", "Excel və vergi bilikləri tələb olunur. " + "Excel excel EXCEL vergi vergi. " * 40))
assert rep_job == base, (base, rep_job)
spam = copy.deepcopy(PERSONA)
spam["hard_skills"] = PERSONA["hard_skills"] + ["Excel"] * 30 + ["Tax"] * 30
spam["summary"] = PERSONA["summary"] + " excel " * 50
assert score(spam, job("Mühasib", "Excel və vergi bilikləri tələb olunur."))[0] == base
print("OK  keyword repetition does not change the score")

# 5. Required skills count more than preferred ones; preferred are reported separately.
req_only, _ = score(PERSONA, job("Mühasib", "Tələb olunur: 1C, payroll."))
miss_req, d1 = score(PERSONA, job("Mühasib", "Tələb olunur: python, sql, docker. Üstünlük: 1C."))
assert req_only > miss_req
assert d1["components"][2]["name"] == "preferred" and d1["components"][2]["value"] == 1.0, d1["components"]
print("OK  required vs preferred criteria")

# 6. Unknown stays unknown: no stated seniority / skills / candidate skills are reported as unknown, not as zero.
_, d = score(PERSONA, job("Mühasib", "Maraqlı iş."))
unknown = {c["name"] for c in d["components"] if not c["known"]}
assert {"preferred", "seniority"} <= unknown, d["components"]
assert next(c for c in d["components"] if c["name"] == "required")["weight"] < 0.3, "a single recognised skill carries a reduced weight"
assert d["confidence"] < 1.0
print("OK  unknown values are preserved and lower the confidence")

# 7. An incomplete profile is never a good match for anything.
empty = {"candidate_id": "e", "location": "", "languages": [], "years_of_experience": 0, "summary": "", "target_titles": [], "hard_skills": [], "soft_skills": [], "experience_history": [], "education": {}, "preferred_cities": [], "work_arrangements": [], "certifications": []}
for t in ("Mühasib", "Software Engineer", "Satış meneceri"):
    assert score(empty, job(t, "Excel, tax, sales, python"))[0] < 35
print("OK  an incomplete profile stays below the storage threshold")

# 8. Seniority: a junior candidate against a senior-titled posting scores lower than against a plain one.
junior = copy.deepcopy(PERSONA)
junior["years_of_experience"] = 0.5
junior["experience_history"][0]["achievements"] = ["Prepared tax reports"]
s_senior, _ = score(junior, job("Senior Accountant", "Excel, tax, payroll"))
s_plain, _ = score(junior, job("Accountant", "Excel, tax, payroll"))
assert s_senior < s_plain, (s_senior, s_plain)
print("OK  seniority fit")

# 9. Explicit qualification: a posting that requires ACCA scores lower for a profile that does not show it, and not lower once it does.
needs = job("Accountant", "Excel, tax. ACCA tələb olunur.")
no_cert, d = score(PERSONA, needs)
with_cert = copy.deepcopy(PERSONA)
with_cert["certifications"] = ["ACCA"]
has_cert, _ = score(with_cert, needs)
assert has_cert > no_cert and "certification" in d["notes"], (no_cert, has_cert, d["notes"])
print("OK  explicit qualifications")

# 10. Preferences: a stated city the posting does not match is a mismatch; a missing posting city is neutral.
far = job("Mühasib", "Excel, tax, payroll", location="Gəncə")
unknown_city = job("Mühasib", "Excel, tax, payroll", location="")
assert score(PERSONA, far)[0] < score(PERSONA, unknown_city)[0]
assert score(PERSONA, unknown_city)[1]["notes"].get("location") == "job location unspecified"
print("OK  location preference mismatch vs unknown")


# 12. Customer support and technical (IT) support are different occupations; each is adjacent-at-most to the other, never the same.
it_persona = copy.deepcopy(PERSONA)
it_persona.update({"summary": "IT support", "target_titles": ["IT Support Specialist"], "hard_skills": ["Windows", "Active Directory", "Networking"], "years_of_experience": 3,
                   "experience_history": [{"company": "X", "role": "IT Support Specialist", "location": "", "dates": "", "achievements": ["Helpdesk for 200 users"]}]})
cs_job = job("Müştəri xidməti operatoru (çağrı mərkəzi)", "CRM, rus və Azərbaycan dilləri.")
it_job = job("IT Support Specialist", "Windows, Active Directory, helpdesk.")
s_cs, d_cs = score(it_persona, cs_job)
s_it, d_it = score(it_persona, it_job)
assert d_it["components"][0]["value"] == 1.0 and d_cs["components"][0]["value"] < 0.5 and s_cs < 35 <= s_it, (s_cs, s_it, d_cs["components"][0])
cs_persona = copy.deepcopy(it_persona)
cs_persona.update({"summary": "customer service", "target_titles": ["Müştəri xidməti mütəxəssisi"], "hard_skills": ["CRM", "Telefon"],
                   "experience_history": [{"company": "X", "role": "Çağrı mərkəzi operatoru", "location": "", "dates": "", "achievements": ["zənglər"]}]})
assert score(cs_persona, it_job)[0] < 35, score(cs_persona, it_job)
print("OK  customer support is not technical support")

# 13. Subject-specific occupations: a maths teacher ranks maths above physics above English; unknown subject is neutral.
math = copy.deepcopy(PERSONA)
math.update({"summary": "Riyaziyyat müəllimi", "target_titles": ["Riyaziyyat müəllimi"], "hard_skills": ["Riyaziyyat", "Dərs planı"],
             "experience_history": [{"company": "X", "role": "Riyaziyyat müəllimi", "location": "", "dates": "", "achievements": ["dərs"]}]})
r_math = score(math, job("Riyaziyyat müəllimi", "Dərs planı."))[0]
r_phys = score(math, job("Fizika müəllimi", "Dərs planı."))[0]
r_eng = score(math, job("İngilis dili müəllimi", "Dərs planı."))[0]
r_unk = score(math, job("Müəllim", "Dərs planı."))[0]
assert r_math > r_phys > r_eng and r_unk > r_eng, (r_math, r_phys, r_eng, r_unk)
print("OK  subject-specific teaching roles")

# 14. Adjacent occupations get partial credit, strictly between an exact match and an unrelated one.
cashier = score(PERSONA_SALES := {**copy.deepcopy(PERSONA), "summary": "Satış", "target_titles": ["Satış məsləhətçisi"], "hard_skills": ["Satış", "Müştəri xidməti"],
                                   "experience_history": [{"company": "X", "role": "Satış məsləhətçisi", "location": "", "dates": "", "achievements": ["satış"]}]}, job("Kassir", "Kassa əməliyyatları, müştəri xidməti."))
exact = score(PERSONA_SALES, job("Satış məsləhətçisi", "Satış, müştəri xidməti."))[0]
unrelated = score(PERSONA_SALES, job("Aşpaz", "Mətbəx."))[0]
assert exact > cashier[0] > unrelated, (exact, cashier[0], unrelated)
assert "adjacent" in cashier[1]["components"][0]["why"], cashier[1]["components"][0]
print("OK  adjacent occupations receive partial credit")

# 15. Manager / menecer postings are at least mid-level: a junior ranks the plain role above the manager role.
junior_mkt = copy.deepcopy(PERSONA)
junior_mkt.update({"years_of_experience": 0.5, "summary": "Marketinq", "target_titles": ["Marketinq mütəxəssisi"], "hard_skills": ["SMM"],
                   "experience_history": [{"company": "X", "role": "Marketinq təcrübəçisi", "location": "", "dates": "", "achievements": ["SMM"]}]})
assert score(junior_mkt, job("Marketinq mütəxəssisi", "SMM."))[0] > score(junior_mkt, job("Marketinq meneceri", "SMM."))[0]
print("OK  manager titles imply at least mid-level")

# 16. A mandatory qualification is not a preference: required costs more than preferred, and preferred costs nothing.
mandatory, d_m = score(PERSONA, job("Accountant", "Excel, tax. ACCA tələb olunur."))
preferred, d_p = score(PERSONA, job("Accountant", "Excel, tax. ACCA üstünlük sayılır."))
plain, _ = score(PERSONA, job("Accountant", "Excel, tax."))
assert mandatory < preferred and preferred == plain, (mandatory, preferred, plain)
assert "mandatory" in d_m["notes"]["certification"] and "not penalised" in d_p["notes"]["preferred_certification"], (d_m["notes"], d_p["notes"])
print("OK  mandatory qualification vs preference")

# 17. Results carry the scorer + lexicon version (cache key material).
assert score(PERSONA, j)[1]["version"] == R.SCORER_VERSION and "lexicon-" in R.SCORER_VERSION

# 18. A headline alone (no target roles, no past titles) is the candidate's role; it must not leave the role unknown.
headline_only = copy.deepcopy(PERSONA)
headline_only.update({"summary": "Mühasib / Accountant", "target_titles": [], "experience_history": [], "years_of_experience": 0})
s_h, d_h = score(headline_only, job("Mühasib", "Excel, vergi, 1C."))
assert d_h["components"][0]["value"] == 1.0 and s_h >= 35, (s_h, d_h["components"])
print("OK  a headline stands in for target roles")

# 11. Every result explains itself with the same keys the API contract uses plus components.
_, d = score(PERSONA, j)
assert {"semantic", "role_fit", "skill_demand", "keyword", "filters", "matched_concepts", "gaps", "score", "components"} <= set(d)


# Recommendation admission must be about work, not shared office skills or neutral filters.
for title in ("Xadimə (Masazır)", "TƏMİZLİKÇİ", "Cleaner", "Janitor", "Уборщица"):
    for candidate in (
        {**PERSONA, "target_titles": ["Business Analyst"], "summary": "Business Analyst", "experience_history": [{"role": "Data Analyst", "achievements": ["Excel reports and customer analysis"]}]},
        {**PERSONA, "target_titles": ["Software Engineer"]},
        {**PERSONA, "target_titles": ["Accountant"]},
    ):
        raw = job(title, "Azərbaycan dili. Excel, teamwork, communication. Təcrübə tələb olunmur.")
        s, detail = score(candidate, raw)
        assert s == 0 and detail["filters"]["role_relevant"] is False, (title, candidate["target_titles"], s)
        # Embedding API applies the same occupation policy, even if similarities are high.
        legacy = {"score": 90.0, "filters": {}, "notes": {}}
        R.apply_recommendation_policy(P.parse_persona(copy.deepcopy(candidate)), R.parse_posting(raw), legacy)
        assert legacy["score"] == 0 and not legacy["filters"]["role_relevant"]
# Cleaning remains eligible for candidates who choose it; no global exclusion by occupation.
cleaner = {**PERSONA, "target_titles": ["Xadimə"], "experience_history": []}
assert score(cleaner, job("Təmizlikçi", "Təcrübə tələb olunmur"))[1]["filters"]["role_relevant"]
# Past unrelated work must not override a candidate's explicit career-change target.
changer = {**PERSONA, "target_titles": ["Data Analyst"], "experience_history": [{"role": "Cleaner", "achievements": []}]}
assert not score(changer, job("Cleaner"))[1]["filters"]["role_relevant"]
# Exact, neighbouring and sparse unknown jobs retain their normal scoring (not blanket score cutoff changes).
for title in ("Accountant", "Financial Analyst"):
    assert score(PERSONA, job(title, "Excel, tax, payroll"))[1]["filters"]["role_relevant"]
assert R.recommendation_role_relevant(P.parse_persona(PERSONA), R.parse_posting(job("Emerging Position Z")))
print("OK  occupation admission across languages, career changes and both scoring modes")

# Unclassified/broad titles remain unknown, not an invented incompatibility.
unknown = {**PERSONA, "target_titles": ["Emerging Specialist Z"], "experience_history": [], "summary": ""}
assert R.recommendation_role_relevant(P.parse_persona(unknown), R.parse_posting(job("Data Analyst")))
for title in ("Biznes analitiki", "Business Analyst", "Бизнес-аналитик"):
    candidate = {**PERSONA, "target_titles": [title], "experience_history": []}
    assert not score(candidate, job("Xadimə"))[1]["filters"]["role_relevant"]
    assert score(candidate, job("Data Analyst", "Excel"))[1]["filters"]["role_relevant"]


# Related analytical careers remain partial options, with the normal skills,
# qualification and seniority checks (no fabricated equivalence or raised score).
analyst = {**PERSONA, "target_titles":["Business Analyst"], "experience_history":[]}
for title in ("Junior Auditor", "Financial Analyst", "Credit Risk Analyst"):
    assert score(analyst, job(title))[1]["filters"]["role_relevant"], title
analyst = {**PERSONA, "target_titles":["Data Analyst"], "experience_history":[]}
assert score(analyst, job("Verilənlər Bazası Administratoru (Oracle/PostgreSQL)"))[1]["filters"]["role_relevant"]
for prose in ("Data cleaning with SQL", "Cleaning of the dataset", "Data manipulation and cleaning"):
    assert "cleaning" not in P.extract_concepts(prose), prose
    assert "cleaning" not in P.concept_count(prose), prose
assert "cleaning" in P.extract_concepts("Office cleaning and data cleaning")
assert "cleaning" in P.extract_concepts("Xadimə və təmizlik işləri")
print("OK  data cleaning is not facility work; related analytical careers remain eligible")

# 19. Recommendation leakage elimination: trade, service, physical, and teaching roles
# must be strictly rejected (score=0, role_relevant=False) for professional candidates (SWE, Analyst, Accountant).
leakage_roles = [
    "Bağban", "Bağban köməkçisi", "Садовник", "Gardener",
    "Qabyuyan", "Qabyuyan-xadimə", "Mətbəx işçisi", "Посудомойщица", "Дворник",
    "Xadimə (Port Baku)", "Təmizlik işçisi", "Уборщик", "Cleaner",
    "Разнорабочий", "Грузчик", "Anbar fəhləsi", "Fəhlə",
    "Dayə", "Няня", "Baxıcı", "Sanitarka",
    "Dərzi", "Швея", "Portnoy", "Tailor",
    "Fizika müəllimi (rus bölməsi)", "Riyaziyyat müəllimi",
    "Arxiv köməkçisi", "Kargüzar", "Qeydiyyatçı",
]
for candidate_target in (["Software Engineer", "Backend Developer"], ["Data Analyst"], ["Business Analyst"], ["Accountant"]):
    cand = {**PERSONA, "target_titles": candidate_target, "experience_history": []}
    for l_title in leakage_roles:
        s, detail = score(cand, job(l_title, "Baku, Azerbaijan. Əlaqəli təcrübə."))
        assert s == 0.0 and detail["filters"]["role_relevant"] is False, (candidate_target, l_title, s, detail["notes"])
print("OK  recommendation leakage eliminated for professional candidates vs trade/service/teaching roles")

# 20. Trade and service roles remain fully eligible for candidates actively targeting them.
for target, posting in [
    ("Bağban", "Bağban"),
    ("Садовник", "Landscaper"),
    ("Qabyuyan", "Mətbəx işçisi (qabyuyan)"),
    ("Xadimə", "Təmizlikçi"),
    ("Уборщица", "Cleaner"),
    ("Dayə", "Uşaq baxıcısı / Dayə"),
    ("Dərzi", "Dərzi köməkçisi"),
    ("Fəhlə", "Anbar fəhləsi / Yükləyici"),
    ("Mühafizəçi", "Mühafizə əməkdaşı"),
]:
    cand = {**PERSONA, "target_titles": [target], "experience_history": []}
    s, detail = score(cand, job(posting, "İş təcrübəsi arzuolunandır."))
    assert detail["filters"]["role_relevant"] is True, (target, posting, s)
print("OK  trade, physical, and care roles remain eligible for candidates targeting them")

# 21. Strict location preference preservation: candidate specifying preferred cities
# must never receive onsite jobs in outside regions (score=0, location_ok=False).
baku_dev = {**PERSONA, "target_titles": ["Software Engineer"], "preferred_cities": ["Bakı"], "work_arrangements": ["onsite", "hybrid"]}
for outside_city in ("Ucar", "Gəncə", "Mingəçevir", "Samux", "Zaqatala", "Quba"):
    s, detail = score(baku_dev, job("Software Engineer", "Python, SQL", location=outside_city, location_canonical=outside_city.lower()))
    assert s == 0.0 and detail["filters"]["location_ok"] is False, (outside_city, s, detail)
# Matching preferred city works normally.
s_baku, d_baku = score(baku_dev, job("Software Engineer", "Python, SQL", location="Bakı", location_canonical="bakı"))
assert s_baku >= 35.0 and d_baku["filters"]["location_ok"] is True, (s_baku, d_baku)
print("OK  location preferences strictly preserved (onsite region mismatch vetoed)")

# 22. Strict work-arrangement preservation: remote-only candidate must never receive onsite jobs.
remote_cand = {**PERSONA, "target_titles": ["Software Engineer"], "work_arrangements": ["remote"], "preferred_cities": ["Bakı"]}
s_onsite, d_onsite = score(remote_cand, job("Software Engineer", "Python, SQL", location="Bakı", workArrangement="On-site"))
assert s_onsite == 0.0 and d_onsite["filters"]["work_arrangement_ok"] is False, (s_onsite, d_onsite)
# Remote job is accepted.
s_rem, d_rem = score(remote_cand, job("Software Engineer", "Python, SQL", location="Uzaqdan", location_canonical="remote", is_remote=True))
assert s_rem >= 35.0 and d_rem["filters"]["work_arrangement_ok"] is True, (s_rem, d_rem)
print("OK  work-arrangement preferences strictly preserved (remote-only vs onsite vetoed)")

# 23. Seniority preservation:
# Senior candidate (5 yrs exp) vs intern/trainee job is vetoed (score=0, seniority_ok=False).
senior_cand = {**PERSONA, "target_titles": ["Senior Software Engineer"], "years_of_experience": 5.0, "preferred_cities": ["Bakı"]}
s_intern, d_intern = score(senior_cand, job("Təcrübəçi proqramçı (Intern)", "Python, SQL", location="Bakı", location_canonical="bakı", level=0))
assert s_intern == 0.0 and d_intern["filters"]["seniority_ok"] is False, (s_intern, d_intern)
# Student candidate (0 yrs exp) vs Executive / Director job is vetoed.
student_cand = {**PERSONA, "target_titles": ["Təcrübəçi proqramçı", "Junior Developer"], "years_of_experience": 0.0, "experience_history": [], "preferred_cities": ["Bakı"]}
s_exec, d_exec = score(student_cand, job("Head of Engineering / Direktor", "Python, SQL", location="Bakı", location_canonical="bakı", exp_lo=5, level=3))
assert s_exec == 0.0 and d_exec["filters"]["seniority_ok"] is False, (s_exec, d_exec)
# Normal seniority matches pass.
s_sr_match, d_sr_match = score(senior_cand, job("Senior Software Engineer", "Python, SQL", location="Bakı", location_canonical="bakı", exp_lo=4, level=2))
assert s_sr_match >= 35.0 and d_sr_match["filters"]["seniority_ok"] is True, (s_sr_match, d_sr_match)
print("OK  seniority strictly preserved (senior vs intern and student vs director vetoed)")

# Exact arrangements must survive both imported and native posting adapters, then
# enforce the same policy in rules scoring and embedding-result admission.
arrangement_cases = (("Remote", "remote"), ("Hybrid", "hybrid"), ("On-site", "onsite"))
for accepted in (["remote"], ["hybrid"], ["onsite"], ["remote", "hybrid"]):
    candidate = P.parse_persona({**remote_cand, "work_arrangements": accepted})
    for label, canonical in arrangement_cases:
        imported = job("Software Engineer", "Python, SQL", workArrangement=label)
        native = {"id": "native", "title": "Software Engineer", "location": "Bakı", "workArrangement": label, "skills": ["Python", "SQL"]}
        for raw in (imported, native):
            parsed = R.parse_posting(copy.deepcopy(raw))
            assert parsed["work_arrangement"] == canonical, (label, parsed)
            assert parsed["is_remote"] is (canonical == "remote"), (label, parsed)
            rules = R.score_job(copy.deepcopy(candidate), copy.deepcopy(parsed))
            embedding_policy = R.apply_recommendation_policy(copy.deepcopy(candidate), copy.deepcopy(parsed), {"score": 90.0, "filters": {}, "notes": {}})
            for result in (rules, embedding_policy):
                assert result["filters"]["work_arrangement_ok"] is (canonical in accepted), (accepted, label, result)
                if canonical not in accepted:
                    assert result["score"] == 0.0, (accepted, label, result)
# Hybrid still requires attendance in a preferred city; it is not location-neutral.
hybrid_far = job("Software Engineer", "Python, SQL", location="Gəncə", workArrangement="Hybrid")
assert score({**remote_cand, "work_arrangements": ["remote", "hybrid"]}, hybrid_far)[1]["filters"]["location_ok"] is False
# Missing arrangement is unknown, rather than assumed onsite from a city alone.
assert score(remote_cand, job("Software Engineer", "Python, SQL"))[1]["filters"]["work_arrangement_ok"] is True
print("OK  exact arrangement matrix, unknown facts, and hybrid location across scorer policies")

# Seniority vetoes must distinguish a clear level preference from career history.
for candidate, posting in (
    ({**senior_cand, "target_titles": ["Başlanğıc proqramçı"], "years_of_experience": 0, "experience_history": []}, "Təcrübəçi proqramçı"),
    ({**senior_cand, "target_titles": ["Software Engineer"], "experience_history": [{"role": "Accountant"}]}, "Təcrübəçi proqramçı"),
    ({**senior_cand, "target_titles": ["Junior Software Engineer"], "experience_history": [{"role": "Senior Software Engineer"}]}, "Təcrübəçi proqramçı"),
    (senior_cand, "Junior Software Engineer"),
):
    parsed_candidate = P.parse_persona(copy.deepcopy(candidate))
    parsed_job = R.parse_posting(job(posting, "Python, SQL"))
    for result in (
        R.score_job(copy.deepcopy(parsed_candidate), copy.deepcopy(parsed_job)),
        R.apply_recommendation_policy(copy.deepcopy(parsed_candidate), copy.deepcopy(parsed_job), {"score": 90.0, "filters": {}, "notes": {}}),
    ):
        assert result["filters"]["seniority_ok"] is True, (candidate["target_titles"], posting, result)
# Apply the seniority veto in default embedding mode too.
for candidate, posting in ((senior_cand, "Təcrübəçi proqramçı"), (student_cand, "Head of Engineering")):
    result = R.apply_recommendation_policy(P.parse_persona(copy.deepcopy(candidate)), R.parse_posting(job(posting, "Python, SQL")), {"score": 90.0, "filters": {}, "notes": {}})
    assert result["score"] == 0.0 and result["filters"]["seniority_ok"] is False, result
for raw in ({"target_titles": ["Software Engineer"]}, {"target_titles": ["Software Engineer"], "experience_history": [{"role": "Software Engineer"}]}):
    assert R.prepare_persona(P.parse_persona(raw))["years"] is None
assert R.prepare_persona(P.parse_persona({"years_of_experience": 0}))["years"] == 0.0
print("OK  career changes, junior versus intern, word boundaries, and unknown experience")

# The generic word "analyst" must not relabel specialist occupations as data work.
for title in ("Kredit risk analitiki", "Maliyyə analitiki", "Biznes təhlilçisi"):
    assert "data_analyst" not in R.prepare_job(R.parse_posting(job(title)))["occupations"], title
assert "data_analyst" in R.prepare_job(R.parse_posting(job("Məlumat analitiki")))["occupations"]
print("OK  specialist analyst titles retain their occupation")

# 24. Generic quality-control and HSE terms retain their own occupations;
# only software-specific QA wording maps to software testing.
qc_occ = R.prepare_job(R.parse_posting(job("Keyfiyyətə nəzarət üzrə mütəxəssis")))["occupations"]
hse_occ = R.prepare_job(R.parse_posting(job("Əməyin mühafizəsi üzrə mütəxəssis")))["occupations"]
qa_occ = R.prepare_job(R.parse_posting(job("Software QA Engineer")))["occupations"]
assert "qa_engineer" not in qc_occ and "quality_control_inspector" in qc_occ, qc_occ
assert "civil_engineer" not in hse_occ and "occupational_safety_specialist" in hse_occ, hse_occ
assert "qa_engineer" in qa_occ, qa_occ
print("OK  quality-control and HSE taxonomy avoids software/civil collisions")

# A generic retail seller must not get an exact-role score for a pharmacy
# sales position whose product domain is missing from the candidate profile.
pharmacy_title = "Aptek satıcısı"
pharmacy_job = job(pharmacy_title, "Tibbi və ya əczaçılıq sahəsinə maraq, müştəri xidməti, dəqiqlik.", description="Aptekdə dərman və tibbi vasitələrin satışı, müştərilərə məsləhət, kassa əməliyyatları.")
pharmacy_occupations = R.prepare_job(R.parse_posting(copy.deepcopy(pharmacy_job)))["occupations"]
assert "pharmacy_sales_assistant" in pharmacy_occupations, pharmacy_occupations
assert "sales_representative" not in pharmacy_occupations, pharmacy_occupations
sales_candidate = {
    **PERSONA,
    "summary": "Mağaza satış məsləhətçisi",
    "target_titles": ["Satış məsləhətçisi"],
    "hard_skills": ["Satış", "Müştəri xidməti", "Kassa"],
    "years_of_experience": 1,
    "education": {"rank": 2},
    "experience_history": [{"company": "X", "role": "Satış məsləhətçisi", "achievements": ["Müştərilərə məhsul seçimində məsləhət verdim və kassada işlədim."]}],
}
pharmacy_score, pharmacy_detail = score(sales_candidate, pharmacy_job)
assert pharmacy_detail["components"][0]["value"] == 0.3, pharmacy_detail
assert pharmacy_score < 50.0, pharmacy_detail
assert "pharmacy_retail" in pharmacy_detail["gaps"], pharmacy_detail
print("OK  pharmacy retail is a domain-adjacent role, not an exact match for every salesperson")

# 25. A citizenship restriction is enforced consistently in rules and
# embedding admission, while an unstated citizenship remains unknown/neutral.
az_only = job("Mühasib", "Azərbaycan Respublikasının vətəndaşı olmalıdır.")
az_preferred = job("Mühasib", "Azerbaijani citizenship is preferred.")
for candidate, expected in (({**PERSONA, "citizenship": "Georgia"}, False),
                            ({**PERSONA, "citizenship": "Azerbaijan"}, True),
                            ({**PERSONA, "citizenship": None}, True)):
    parsed_candidate = P.parse_persona(copy.deepcopy(candidate))
    parsed_job = R.parse_posting(copy.deepcopy(az_only))
    for result in (
        R.score_job(copy.deepcopy(parsed_candidate), copy.deepcopy(parsed_job)),
        R.apply_recommendation_policy(copy.deepcopy(parsed_candidate), copy.deepcopy(parsed_job), {"score": 90.0, "filters": {}, "notes": {}}),
    ):
        assert result["filters"]["citizenship"] is expected, (candidate.get("citizenship"), result)
        assert result["filters"]["recommendation_eligible"] is expected, result
        if not expected:
            assert result["score"] == 0.0, result
georgian_candidate = P.parse_persona({**PERSONA, "citizenship": "Georgia"})
preferred_result = R.score_job(georgian_candidate, R.parse_posting(az_preferred))
assert preferred_result["filters"]["citizenship"] is True, preferred_result
print("OK  citizenship veto and neutral unknown status in both scorer paths")

# 26. Precision across ATS-sourced vacancies: verified B2B sales roles match sales candidates
# and are strictly separated from software engineers, with trade/cleaning roles strictly excluded.
swe = {**PERSONA, "target_titles": ["Software Engineer", "Backend Developer"], "hard_skills": ["Python", "TypeScript", "SQL"], "experience_history": []}
b2b_sales = {**PERSONA, "target_titles": ["Sales Executive", "Sales Representative"], "hard_skills": ["B2B Sales", "Negotiation", "CRM"], "experience_history": []}
swe_job = job("Staff Software Engineer", "Python, Cloud, 5+ years experience", "bp Azerbaijan")
sales_job = job("Sales Executive", "4+ years experience in B2B sales and client relations", "ALUMIL Baku")
cleaner_job = job("XADİMƏ", "Təmizlik işləri", "ADA")

# Software engineer matches SWE job, zero score on cleaner job, low/zero on sales job
assert score(swe, swe_job)[0] >= 70.0
assert score(swe, cleaner_job)[0] == 0.0 and score(swe, cleaner_job)[1]["filters"]["role_relevant"] is False
assert score(swe, sales_job)[0] < 35.0

# Sales candidate matches sales job, zero score on cleaner job, zero on SWE job
assert score(b2b_sales, sales_job)[0] >= 60.0
assert score(b2b_sales, cleaner_job)[0] == 0.0 and score(b2b_sales, cleaner_job)[1]["filters"]["role_relevant"] is False
assert score(b2b_sales, swe_job)[0] == 0.0 and score(b2b_sales, swe_job)[1]["filters"]["role_relevant"] is False
print("OK  precision across verified ATS vacancies: sales, tech, and service roles separated")

print("ALL RULES SELFTESTS PASSED")
