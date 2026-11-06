# -*- coding: utf-8 -*-
"""Self-test: exercises the exact call path main.py uses per request
(parse_job -> embed -> parse_persona -> score_job), no network, no
dependency on the (now app-owned) glorri_jobs_detail.json dataset.
Run: python selftest.py"""
import pipeline as P
import threading
from main import _Cancelled, _embed_job, _embed_cache, embed_cache_stats

P.configure_utf8()

SAMPLE_JOB = {
    "title": "Sales Specialist",
    "slug": "sales-specialist-baku",
    "postedDate": "2026-08-01",
    "location": "Baku",
    "experience": "1-3 il",
    "education": "Ali",
    "salaryFrom": 800,
    "salaryTo": 1200,
    "status": "approved",
    "viewCount": 42,
    "company": {"slug": "acme", "name": "Acme LLC"},
    "detail": {
        "title": "Sales Specialist",
        "company_name": "Acme LLC",
        "location": "Baku",
        "description_text": "We are looking for a sales specialist to grow our client base in Azerbaijan.",
        "requirements_text": "3+ years of sales experience. Fluent in Azerbaijani and English. Negotiation skills.",
        "category": "Sales",
    },
}

SAMPLE_PERSONA = {
    "candidate_id": "test_1",
    "name": "Test Candidate",
    "location": "Baku",
    "languages": [{"code": "az"}, {"code": "en"}],
    "years_of_experience": 4,
    "summary": "Sales professional with client acquisition experience.",
    "target_titles": ["Sales Specialist", "Sales Manager"],
    "hard_skills": ["Sales", "Negotiation", "CRM"],
    "soft_skills": ["Communication"],
    "experience_history": [
        {"company": "Prior Co", "role": "Sales Representative", "location": "Baku",
         "dates": "2022-2026", "achievements": ["Grew regional sales by 20%"]},
    ],
    "education": {"rank": 4},
    "salary_expectation": {"monthly_min": 700, "monthly_max": 1100, "currency": "AZN"},
    "preferred_cities": ["Baku"],
    "certifications": [],
}

job = P.parse_job(SAMPLE_JOB)
job = _embed_job(job)
persona = P.parse_persona(SAMPLE_PERSONA)
pv = P._persona_vectors(persona)
result = P.score_job(persona, job, pv)

assert 0 <= result["score"] <= 100, result
assert "matched_concepts" in result and "filters" in result, result
print("OK  parsed sample job + persona, scored %.1f/100" % result["score"])
print("OK  filters:", result["filters"])

# Embedding cache: a second pass over identical text must reuse the vectors and give the identical score.
before = dict(embed_cache_stats)
job2 = _embed_job(P.parse_job(SAMPLE_JOB))
assert embed_cache_stats["hits"] == before["hits"] + 1 and embed_cache_stats["misses"] == before["misses"], embed_cache_stats
assert P.score_job(persona, job2, pv)["score"] == result["score"], "cached embeddings must not change the score"
print("OK  repeated posting text is served from the embedding cache with an identical score")

# A hung-up caller stops the work before any embedding is computed.
stop = threading.Event()
stop.set()
try:
    _embed_job(P.parse_job(SAMPLE_JOB), stop)
    raise AssertionError("a cancelled request must not be embedded")
except _Cancelled:
    print("OK  a cancelled request is abandoned instead of embedded")
# The public API's embedding mode must reject unrelated occupations too.
# Exercise its real wrapper with cached model vectors, not a fabricated score.
from main import _score_detail, _to_breakdown
import copy
raw = copy.deepcopy(SAMPLE_JOB)
raw["title"] = raw["detail"]["title"] = "Xadimə"
raw["detail"]["requirements_text"] = "Azərbaycan dili. Təcrübə tələb olunmur."
raw["detail"]["description_text"] = "Ofisin gündəlik təmizlənməsi."
unrelated = _embed_job(P.parse_job(raw))
rejected = _score_detail(persona, pv, unrelated)
assert rejected["score"] == 0, rejected
assert _to_breakdown(rejected)["filters"]["role_relevant"] is False
assert _score_detail(persona, pv, job)["filters"]["role_relevant"] is True
print("OK  real embedding API wrapper rejects occupation mismatches, preserves sales target")
print("ALL SELFTESTS PASSED")
