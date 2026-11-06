# -*- coding: utf-8 -*-
"""FastAPI wrapper around pipeline.py's deterministic offline scorer.

Exposes a single batched endpoint sized for the platform's actual access
pattern: one newly-ingested job scored against every profile at once. The
job is parsed and embedded exactly once per request; each profile's persona
embedding is cheap and computed per-profile. No NIM/LLM reranking here -
that stays a CLI-only convenience in pipeline.py's run_matching(), keeping
this service fully deterministic and safe to call unconditionally at
ingest time (see apps/api/src/matching).
"""
import asyncio
import hashlib
import hmac
import os
import threading
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import pipeline as P
import rules_scorer as R

# SCORER_MODE=rules runs the deterministic scorer (rules_scorer.py): no embedding model is loaded or used. It is an
# evaluation candidate (docs/rules-matching-evaluation-2026-10-03.md); the default stays the embedding scorer.
SCORER_MODE = os.environ.get("SCORER_MODE", "embedding").strip().lower()
if SCORER_MODE not in ("embedding", "rules"):
    raise RuntimeError("SCORER_MODE must be 'embedding' or 'rules'")

app = FastAPI(title="AISE Job Matching Service")

MAX_PROFILES_PER_REQUEST = 500
MAX_JOBS_PER_REQUEST = 200

# Shared-secret auth: this service has no user-facing auth of its own and is
# only ever meant to be called by apps/api (see MATCHING_SERVICE_TOKEN in
# apps/api/.env). Mirrors apps/apply-worker's WorkerTokenGuard: if the token
# isn't configured, every request is rejected (fails CLOSED) rather than
# silently allowing unauthenticated access to a service exposed on the
# docker-compose network.
_EXPECTED_TOKEN = os.environ.get("MATCHING_SERVICE_TOKEN")


def require_service_token(authorization: str = Header(default="")) -> None:
    if not _EXPECTED_TOKEN:
        raise HTTPException(status_code=401, detail="Service token is not configured")
    token = authorization.removeprefix("Bearer ").strip()
    if not token or not hmac.compare_digest(token, _EXPECTED_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing service token")


@app.on_event("startup")
def warm_embedder() -> None:
    # Load the sentence-transformers model once per process. Loading it
    # lazily on the first request would make that request pay a multi-second
    # cold-start cost; warming it here keeps request latency predictable.
    P._shared_embedder()


class ScoreProfile(BaseModel):
    profileId: str
    persona: Dict[str, Any]


class ScoreRequest(BaseModel):
    job: Dict[str, Any]
    profiles: List[ScoreProfile] = Field(max_length=MAX_PROFILES_PER_REQUEST)


class ScoreProfileRequest(BaseModel):
    """Inverse direction: one persona scored against many jobs/vacancies.

    Lets onboarding score a profile against every stored posting in a few
    batched calls (persona embedded once) instead of one /score round trip
    per job (persona re-embedded every time, job order lost on any single
    failure). `jobs` accepts glorri-shaped job dicts AND vacancy-shaped
    dicts — see P.parse_job / P.parse_vacancy dispatch in _parse_posting.
    """

    persona: Dict[str, Any]
    jobs: List[Dict[str, Any]] = Field(max_length=MAX_JOBS_PER_REQUEST)


class ScoreProfileResult(BaseModel):
    jobId: str
    source: str
    score: float
    matchedKeywords: List[str]
    breakdown: Dict[str, Any]
    gaps: List[str]


class ScoreProfileResponse(BaseModel):
    results: List[ScoreProfileResult]


class ScoreResult(BaseModel):
    profileId: str
    score: float
    matchedKeywords: List[str]
    breakdown: Dict[str, Any]
    gaps: List[str]


class ScoreResponse(BaseModel):
    results: List[ScoreResult]


class _Cancelled(Exception):
    """The caller hung up; the remaining work would only burn CPU."""


# Job embeddings depend only on the posting's text, so they are cached (bounded LRU). Identical text gives
# identical vectors, so cached and uncached scores are the same. This turns work that a client abandoned (a
# timed-out chunk keeps being computed) into a head start for the retry instead of waste.
_EMBED_CACHE_MAX = int(os.environ.get("SCORER_EMBED_CACHE_MAX", "8000"))
_embed_cache: "OrderedDict[str, tuple]" = OrderedDict()
_embed_cache_lock = threading.Lock()
embed_cache_stats = {"hits": 0, "misses": 0}


def _embed_job(job: Dict[str, Any], cancelled: Optional[threading.Event] = None) -> Dict[str, Any]:
    """Attach emb/emb_req/emb_title to a parse_job() output, mirroring
    build_job_index()'s per-job embedding step but for a single job."""
    if cancelled is not None and cancelled.is_set():
        raise _Cancelled()
    title_text = job["title_text"] or job["title"] or job["category"]
    key = hashlib.sha256("\x1f".join((job["full_text"], job["req_text"], title_text)).encode("utf-8")).hexdigest()
    with _embed_cache_lock:
        hit = _embed_cache.get(key)
        if hit is not None:
            _embed_cache.move_to_end(key)
            embed_cache_stats["hits"] += 1
    if hit is None:
        embedder = P._shared_embedder()
        embeds = P._pool(embedder, [P.chunk_text(job["full_text"])])
        embeds_req = P._pool(embedder, [P.chunk_text(job["req_text"])])
        embeds_title = embedder.encode([title_text])
        hit = (
            [float(v) for v in embeds[0]],
            [float(v) for v in embeds_req[0]],
            [float(v) for v in embeds_title[0]],
        )
        with _embed_cache_lock:
            embed_cache_stats["misses"] += 1
            if _EMBED_CACHE_MAX > 0:
                _embed_cache[key] = hit
                while len(_embed_cache) > _EMBED_CACHE_MAX:
                    _embed_cache.popitem(last=False)
    job["emb"], job["emb_req"], job["emb_title"] = list(hit[0]), list(hit[1]), list(hit[2])
    return job


# Rules mode: parsed + prepared posting features cached by content (bounded LRU with a time limit). Scoring itself is microseconds;
# parsing and feature extraction are the cost (~30 ms per posting), so an unchanged posting is processed once however many profiles
# are scored against it.
#   * Key = sha256(scorer version + lexicon version + the posting payload exactly as received). A posting whose content changes has a
#     different key; a scorer or lexicon change invalidates every entry at once. Nothing else is part of the key, and nothing about a
#     candidate is ever stored here: only posting-derived features.
#   * A closed, hidden or expired posting is simply no longer sent by the API, so its entry is never read again; the entry leaves by
#     the TTL (SCORER_RULES_CACHE_TTL_S, default 6 h) or the size bound (SCORER_RULES_CACHE_MAX, default 20,000), whichever is first.
_RULES_CACHE_MAX = int(os.environ.get("SCORER_RULES_CACHE_MAX", "20000"))
_RULES_CACHE_TTL_S = float(os.environ.get("SCORER_RULES_CACHE_TTL_S", "21600"))
_rules_cache: "OrderedDict[str, tuple]" = OrderedDict()   # key -> (stored_at, parsed job with prepared features)
_rules_cache_lock = threading.Lock()
rules_cache_stats = {"hits": 0, "misses": 0, "evictions": 0, "expired": 0}


def _rules_cache_key(raw: Dict[str, Any]) -> str:
    import json as _json
    body = _json.dumps(raw, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256((R.SCORER_VERSION + "\x1e" + body).encode("utf-8")).hexdigest()


def _rules_job(raw: Dict[str, Any], cancelled: Optional[threading.Event] = None) -> Dict[str, Any]:
    if cancelled is not None and cancelled.is_set():
        raise _Cancelled()
    key = _rules_cache_key(raw)
    now = time.monotonic()
    with _rules_cache_lock:
        hit = _rules_cache.get(key)
        if hit is not None:
            if _RULES_CACHE_TTL_S > 0 and now - hit[0] > _RULES_CACHE_TTL_S:
                del _rules_cache[key]
                rules_cache_stats["expired"] += 1
            else:
                _rules_cache.move_to_end(key)
                rules_cache_stats["hits"] += 1
                return hit[1]
    job = _parse_posting(raw)
    R.prepare_job(job)
    with _rules_cache_lock:
        rules_cache_stats["misses"] += 1
        if _RULES_CACHE_MAX > 0:
            _rules_cache[key] = (now, job)
            while len(_rules_cache) > _RULES_CACHE_MAX:
                _rules_cache.popitem(last=False)
                rules_cache_stats["evictions"] += 1
    return job


def _prepared_job(raw: Dict[str, Any], cancelled: Optional[threading.Event] = None) -> Dict[str, Any]:
    return _rules_job(raw, cancelled) if SCORER_MODE == "rules" else _embed_job(_parse_posting(raw), cancelled)


def _persona_pv(persona: Dict[str, Any]) -> Any:
    return None if SCORER_MODE == "rules" else P._persona_vectors(persona)


def _parse_posting(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Dispatch glorri-shaped dicts to parse_job and vacancy-shaped dicts
    (Vacancy rows carry `skills`/`requirements`/`workArrangement`, never a
    `detail` block) to parse_vacancy. Vacancy dicts always include `id`."""
    if isinstance(raw.get("detail"), dict) or "slug" in raw:
        return P.parse_job(raw)
    return P.parse_vacancy(raw)


def _score_detail(persona: Dict[str, Any], pv: Any, job: Dict[str, Any]) -> Dict[str, Any]:
    if SCORER_MODE == "rules":
        return R.score_job(persona, job)
    return R.apply_recommendation_policy(persona, job, P.score_job(persona, job, pv))


def _to_breakdown(detail: Dict[str, Any]) -> Dict[str, Any]:
    extra = {k: detail[k] for k in ("mode", "version", "confidence", "components") if k in detail}
    return {
        **extra,
        "semantic": detail["semantic"],
        "roleFit": detail["role_fit"],
        "skillDemand": detail["skill_demand"],
        "keyword": detail["keyword"],
        "filters": detail["filters"],
    }


@app.post("/score", response_model=ScoreResponse, dependencies=[Depends(require_service_token)])
def score(req: ScoreRequest) -> ScoreResponse:
    # _parse_posting (not parse_job directly): generic IngestJobDto payloads
    # carry no glorri `detail` block, and scoring them as vacancies degrades
    # far more gracefully than embedding empty strings.
    job = _prepared_job(req.job)

    results: List[ScoreResult] = []
    for entry in req.profiles:
        persona = P.parse_persona(entry.persona)
        pv = _persona_pv(persona)
        detail = _score_detail(persona, pv, job)
        results.append(
            ScoreResult(
                profileId=entry.profileId,
                score=round(detail["score"] / 100.0, 4),
                matchedKeywords=detail["matched_concepts"],
                breakdown=_to_breakdown(detail),
                gaps=detail["gaps"],
            )
        )

    return ScoreResponse(results=results)


# CPU-bound scoring is limited to a few concurrent requests so a burst of retries queues instead of thrashing
# the cores; a request whose client has already gone away is dropped when its turn comes, and one that is
# running stops at the next posting once the client disconnects.
_score_slots: Optional[asyncio.Semaphore] = None


def _slots() -> asyncio.Semaphore:
    global _score_slots
    if _score_slots is None:
        _score_slots = asyncio.Semaphore(max(1, int(os.environ.get("SCORER_MAX_CONCURRENCY", "2"))))
    return _score_slots


def _score_profile_sync(req: ScoreProfileRequest, cancelled: threading.Event) -> ScoreProfileResponse:
    persona = P.parse_persona(req.persona)
    pv = _persona_pv(persona)

    results: List[ScoreProfileResult] = []
    for raw in req.jobs:
        job = _prepared_job(raw, cancelled)
        detail = _score_detail(persona, pv, job)
        results.append(
            ScoreProfileResult(
                # The caller keys postings by its own id: prefer an explicit
                # clientId passthrough (extra keys are ignored by the parsers)
                # so job rows (keyed by slug server-side) and vacancy rows
                # (keyed by id) map back unambiguously.
                jobId=str(raw.get("clientId") or job.get("id")),
                source=str(job.get("source") or "job"),
                score=round(detail["score"] / 100.0, 4),
                matchedKeywords=detail["matched_concepts"],
                breakdown=_to_breakdown(detail),
                gaps=detail["gaps"],
            )
        )

    return ScoreProfileResponse(results=results)


@app.post("/score-profile", response_model=ScoreProfileResponse, dependencies=[Depends(require_service_token)])
async def score_profile(req: ScoreProfileRequest, request: Request) -> ScoreProfileResponse:
    cancelled = threading.Event()
    async with _slots():
        if await request.is_disconnected():
            raise HTTPException(status_code=499, detail="Client closed the request")

        async def watch() -> None:
            while not cancelled.is_set():
                if await request.is_disconnected():
                    cancelled.set()
                    return
                await asyncio.sleep(0.5)

        watcher = asyncio.create_task(watch())
        try:
            return await run_in_threadpool(_score_profile_sync, req, cancelled)
        except _Cancelled:
            raise HTTPException(status_code=499, detail="Client closed the request")
        finally:
            cancelled.set()
            watcher.cancel()


@app.get("/cache-stats", dependencies=[Depends(require_service_token)])
def cache_stats() -> Dict[str, Any]:
    """Operational visibility into the scorer-side caches (no posting or candidate content)."""
    with _rules_cache_lock:
        rules = {"entries": len(_rules_cache), **rules_cache_stats}
    with _embed_cache_lock:
        embed = {"entries": len(_embed_cache), **embed_cache_stats}
    return {"mode": SCORER_MODE, "version": R.SCORER_VERSION if SCORER_MODE == "rules" else None, "rulesCache": rules, "embeddingCache": embed}


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}
