# -*- coding: utf-8 -*-
"""Checks of the rules-mode posting cache in main.py: keys, invalidation, bounds, and that no candidate data enters or leaks.
Needs the service dependencies (fastapi). Run: python rules_cache_selftest.py"""
import copy
import json
import os
import time

os.environ["SCORER_MODE"] = "rules"
os.environ.setdefault("MATCHING_SERVICE_TOKEN", "selftest")

import main as M  # noqa: E402
import pipeline as P  # noqa: E402
import rules_scorer as R  # noqa: E402

RAW = {"slug": "c1", "title": "Mühasib", "company": {"name": "A", "slug": "a"}, "location": "Bakı",
       "detail": {"title": "Mühasib", "description_text": "Hesabatlar.", "requirements_text": "1C, Excel, vergi uçotu.", "sidebar": {"Təcrübə": "1-3 il"}}}


def reset(**kw):
    M._rules_cache.clear()
    for k in M.rules_cache_stats:
        M.rules_cache_stats[k] = 0
    for k, v in kw.items():
        setattr(M, k, v)


reset()
a = M._rules_job(RAW)
b = M._rules_job(copy.deepcopy(RAW))
assert a is b and M.rules_cache_stats == {"hits": 1, "misses": 1, "evictions": 0, "expired": 0}, M.rules_cache_stats
print("OK  an unchanged posting is parsed once")

# Content change -> new entry (the old one is never served for the new content).
changed = copy.deepcopy(RAW)
changed["detail"]["requirements_text"] = "Python, SQL."
c = M._rules_job(changed)
assert c is not a and c["_rules"]["required"] != a["_rules"]["required"], (c["_rules"]["required"], a["_rules"]["required"])
print("OK  a changed posting is re-processed and gets different features")

# Scorer or lexicon version change -> every entry misses.
old = R.SCORER_VERSION
try:
    R.SCORER_VERSION = old + "+x"
    d = M._rules_job(RAW)
    assert d is not a
finally:
    R.SCORER_VERSION = old
print("OK  a scorer or lexicon version change invalidates entries")

# Time limit.
reset(_RULES_CACHE_TTL_S=0.05)
e = M._rules_job(RAW)
time.sleep(0.12)
f = M._rules_job(RAW)
assert f is not e and M.rules_cache_stats["expired"] == 1, M.rules_cache_stats
print("OK  entries expire after the time limit")

# Size bound (LRU).
reset(_RULES_CACHE_MAX=2, _RULES_CACHE_TTL_S=3600.0)
for i in range(5):
    r = copy.deepcopy(RAW)
    r["slug"] = "c%d" % i
    r["title"] = "Mühasib %d" % i
    M._rules_job(r)
assert len(M._rules_cache) == 2 and M.rules_cache_stats["evictions"] == 3, (len(M._rules_cache), M.rules_cache_stats)
print("OK  the cache is size-bounded")

# No candidate data in the cache, and no leakage between candidates: the same cached posting scores each persona exactly
# as a freshly parsed posting does, whatever was scored before.
reset(_RULES_CACHE_MAX=100, _RULES_CACHE_TTL_S=3600.0)
alice = {"candidate_id": "alice", "name": "Alice Secret", "email": "alice@example.com", "languages": [{"code": "az"}], "years_of_experience": 3, "summary": "Mühasib",
         "target_titles": ["Mühasib"], "hard_skills": ["1C", "Excel"], "soft_skills": [], "experience_history": [], "education": {"rank": 4}, "preferred_cities": ["Bakı"]}
bob = {"candidate_id": "bob", "name": "Bob Secret", "email": "bob@example.com", "languages": [{"code": "ru"}], "years_of_experience": 0.5, "summary": "Aşpaz",
       "target_titles": ["Aşpaz"], "hard_skills": ["Mətbəx"], "soft_skills": [], "experience_history": [], "education": {"rank": 1}, "preferred_cities": ["Gəncə"]}
cached = M._rules_job(RAW)
blob = json.dumps({k: sorted(v) if isinstance(v, set) else v for k, v in cached["_rules"].items()}, default=str, ensure_ascii=False) + json.dumps(cached, default=str, ensure_ascii=False)
for secret in ("Alice", "Bob", "alice@", "bob@"):
    assert secret not in blob, "candidate data found in the cache"
for who in (alice, bob, alice):
    via_cache = R.score_job(P.parse_persona(copy.deepcopy(who)), M._rules_job(RAW))
    fresh = R.score_job(P.parse_persona(copy.deepcopy(who)), R.parse_posting(copy.deepcopy(RAW)))
    assert via_cache["score"] == fresh["score"] and via_cache["components"] == fresh["components"]
assert "_rules" not in P.parse_persona(copy.deepcopy(alice)), "persona features must live on the request's own object only"
print("OK  cached postings hold no candidate data and give each candidate the same result as an uncached run")
print("ALL RULES CACHE SELFTESTS PASSED")
