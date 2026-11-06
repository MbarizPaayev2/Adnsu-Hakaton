# -*- coding: utf-8 -*-
"""Deterministic, rules-based matching: no embedding model, no LLM, no network.

An isolated alternative to pipeline.score_job for evaluation (docs/rules-matching-evaluation-2026-10-03.md). It
reuses pipeline's parsing and normalisation (parse_job/parse_vacancy/parse_persona, CONCEPTS, locations,
experience, education, languages, salary) and adds a seed synonym lexicon (rules_lexicon.py), a required/preferred
split of each posting, seniority and explicit qualifications.

Score = confidence-weighted blend of four components x multipliers for explicit mismatches.

  components (each 0..1 or unknown)        weight (hypothesis, not tuned on held-out data)
    role         title vs target/past roles      0.45
    required     required skills coverage        0.30
    preferred    preferred skills coverage       0.10
    seniority    posting level vs candidate      0.15
  An unknown component carries no weight and lowers `confidence`; the final score is discounted by
  (0.5 + 0.5 * confidence) and capped below the storage threshold when confidence < 0.4 (an incomplete profile or
  an unreadable posting must never look like a good match).
  multipliers: location 0.6, salary 0.75, experience gap 0.7/0.55/0.4, education 0.8/0.65, language >= 0.7,
  regulated occupation 0.4, explicit qualification 0.8 each. Unknown data (no salary, no city, no languages) is
  neutral, never a penalty.

Repetition never helps: skills are compared as sets of concepts, never counted.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Set

import pipeline as P
import rules_lexicon as L

MODE = "rules-v1.3"
SCORER_VERSION = MODE + "+unified-eligibility-20261026+lexicon-" + L.LEXICON_VERSION   # part of every cache key
WEIGHTS = {"role": 0.45, "required": 0.30, "preferred": 0.10, "seniority": 0.15}
CONTEXT_WEIGHT = 0.5          # a skill named only in the description counts half of one named as required
MIN_CONFIDENCE = 0.4          # below this the score is capped under the storage threshold
UNCERTAIN_CAP = 0.30
REGULATED = {"doctor", "nurse", "pharmacist", "lawyer"}
MANDATORY_QUALIFICATION_MULTIPLIER = 0.5   # a stated hard requirement is not a preference (hypothesis)
PREFERRED_QUALIFICATION_MULTIPLIER = 1.0   # preferred: reported, never penalised

_FOLD = str.maketrans({"ə": "e", "ı": "i", "ö": "o", "ü": "u", "ş": "s", "ç": "c", "ğ": "g", "İ": "i", "I": "i", "Ə": "e", "Ö": "o", "Ü": "u", "Ş": "s", "Ç": "c", "Ğ": "g"})


def _fold(text: str) -> str:
    return " ".join((text or "").translate(_FOLD).lower().split())


def _has_phrase(text: str, phrases: Iterable[str]) -> bool:
    """Match complete words/phrases so short stems cannot classify unrelated text."""
    hay = _fold(text)
    return any(re.search(r"(?<!\w)" + re.escape(_fold(phrase)) + r"(?!\w)", hay) for phrase in phrases)


def _normalise_arrangement(value: Any) -> Optional[str]:
    value = _fold(str(value or "")).replace("_", "-").strip()
    if value in {"remote", "fully remote", "work from home", "uzaqdan", "mesafeden"}:
        return "remote"
    if value in {"hybrid", "hibrid", "mixed"}:
        return "hybrid"
    if value in {"onsite", "on-site", "on site", "office", "eyani", "ofis"}:
        return "onsite"
    return None


def _preference_filters(persona: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    """Return conservative hard-veto signals shared by both scorer modes."""
    prefs = {_normalise_arrangement(x) for x in (persona.get("work_arrangements") or [])}
    prefs.discard(None)
    cities = [P.canonical_location(c) for c in (persona.get("preferred_cities") or []) if c]
    for tag in ("remote", "hybrid", "onsite"):
        if tag in cities:
            cities.remove(tag)
            prefs.add(tag)

    city = job.get("location_canonical", "unknown")
    arrangement = _normalise_arrangement(job.get("work_arrangement"))
    if arrangement is None and (bool(job.get("is_remote")) or city == "remote"):
        arrangement = "remote"  # legacy parsed job shape
    arrangement_ok = not (prefs and arrangement and arrangement not in prefs)

    roles = persona.get("experience_history") or []
    targets = " ".join(persona.get("target_titles") or [])
    past = " ".join(r.get("role", "") for r in roles if r.get("role"))
    if not targets.strip() and not past.strip():
        targets = persona.get("summary") or ""
    jf, pf = prepare_job(job), prepare_persona(persona)
    years = pf.get("years")
    senior_markers = ("senior", "aparıcı", "lead", "principal", "chief", "baş mütəxəssis", "baş mühasib", "старший", "ведущий")
    entry_markers = ("junior", "kiçik", "entry level", "entry-level", "student", "tələbə", "intern", "təcrübəçi", "trainee", "стажер", "стажёр", "младший")
    explicit_senior = _has_phrase(targets, senior_markers)
    explicit_entry_target = _has_phrase(targets, entry_markers)
    relevant_senior_history = any(
        _has_phrase(r.get("role", ""), senior_markers)
        and bool((_occupations(r.get("role", "")) & jf["occupations"]) - BROAD_OCCUPATIONS)
        for r in roles
    )
    # Total career years cannot prove seniority in a new occupation. An explicit
    # entry-level target takes precedence over prior senior roles during a career change.
    senior_candidate = not explicit_entry_target and (explicit_senior or relevant_senior_history)
    student_or_entry = (
        (years is not None and years == 0.0 and not pf["past_occupations"])
        or explicit_entry_target
    )
    title = job.get("title") or ""
    # A junior employee role is not automatically an internship.
    intern_job = _has_phrase(title, ("intern", "trainee", "təcrübəçi", "stajyer", "стажер", "стажёр"))
    executive_job = (jf["level"] is not None and jf["level"] >= 3) or _has_phrase(title, ("director", "direktor", "head of", "chief", "müdir", "rəhbər", "руководитель"))
    seniority_ok = not ((senior_candidate and intern_job) or (student_or_entry and executive_job))
    return {
        "work_arrangement_ok": arrangement_ok,
        "seniority_ok": seniority_ok,
        "work_arrangement_note": "posting arrangement is outside candidate preferences" if not arrangement_ok else None,
        "seniority_note": "posting seniority is incompatible with candidate experience" if not seniority_ok else None,
    }


def _compile(alias: str) -> "re.Pattern":
    exact = alias.startswith("=")
    a = _fold(alias.lstrip("="))
    esc = re.escape(a)
    letters = sum(ch.isalpha() for ch in a)
    if not exact and letters >= 5:
        return re.compile(r"(?<!\w)" + esc)          # prefix: inflected forms hit
    return re.compile(r"(?<!\w)" + esc + r"(?!\w)")  # short or exact: whole word only


_OCC_PATTERNS = {oid: [_compile(a) for a in aliases] for oid, (_fam, aliases) in L.OCCUPATIONS.items()}
_OCC_FAMILY = {oid: fam for oid, (fam, _a) in L.OCCUPATIONS.items()}
_EXTRA_PATTERNS = {cid: [_compile(a) for a in aliases] for cid, aliases in L.EXTRA_CONCEPTS.items()}
_QUAL_PATTERNS = {qid: [_compile(a) for a in aliases] for qid, aliases in L.QUALIFICATIONS.items()}
_PREFERRED = [_compile("=" + m) if len(m) < 5 else _compile(m) for m in L.PREFERRED_MARKERS]
_REQUIRED = [_compile("=" + m) if len(m) < 5 else _compile(m) for m in L.REQUIRED_MARKERS]
_STOP = {_fold(w) for w in L.TITLE_STOPWORDS}

# Seniority markers on the posting title, on the 0..3 scale used below. Longer markers are tried first.
_LEVEL_MARKERS = [
    (3, ["head of", "chief", "director", "direktor", "müdir", "директор", "руководитель отдела", "начальник", "rəhbər"]),
    (2, ["senior", "aparıcı", "старший", "ведущий", "principal", "lead", "baş mütəxəssis", "baş mühasib"]),
    (0, ["junior", "intern", "trainee", "təcrübəçi", "kiçik", "младший", "стажер", "стажёр", "assistant"]),
]
_LEVEL_PATTERNS = [(lvl, [_compile(m) for m in ms]) for lvl, ms in _LEVEL_MARKERS]
_MANAGER = [_compile(m) for m in L.MANAGER_MARKERS]
_SUBJECT_PATTERNS = {sid: [_compile(a) for a in aliases] for sid, aliases in L.SUBJECTS.items()}


# Broad occupations ("engineer", "director") say little on their own: they count only when nothing more specific is
# found in the same text, so "Software Engineer" is not also "an engineer" in the sense of a civil engineer.
BROAD_OCCUPATIONS = {"engineer", "executive_manager"}


def _occupations(text: str) -> Set[str]:
    hay = _fold(text)
    found = {oid for oid, pats in _OCC_PATTERNS.items() if any(p.search(hay) for p in pats)}
    # A database/system administrator is not an office administrator merely
    # because the generic word "administrator" is present.
    if found & {"database_administrator", "system_administrator"}:
        found.discard("office_administrator")
    # Generic "satıcı" must not erase the pharmaceutical specialization: keep
    # the role adjacent to general retail sales, rather than an exact match.
    if "pharmacy_sales_assistant" in found:
        found.discard("sales_representative")
        found.discard("retail_assistant")
    return found if found <= BROAD_OCCUPATIONS else found - BROAD_OCCUPATIONS


def _subjects(text: str) -> Set[str]:
    hay = _fold(text)
    return {sid for sid, pats in _SUBJECT_PATTERNS.items() if any(p.search(hay) for p in pats)}


def _is_manager_title(title: str) -> bool:
    hay = _fold(title)
    return any(p.search(hay) for p in _MANAGER)


def _extra_concepts(text: str) -> Set[str]:
    hay = _fold(text)
    return {cid for cid, pats in _EXTRA_PATTERNS.items() if any(p.search(hay) for p in pats)}


def concepts_in(text: str) -> Set[str]:
    """pipeline's concept dictionary plus the lexicon's extra synonyms."""
    return set(P.extract_concepts(text)) | _extra_concepts(text)


def _qualifications(text: str) -> Set[str]:
    hay = _fold(text)
    return {qid for qid, pats in _QUAL_PATTERNS.items() if any(p.search(hay) for p in pats)}


def _sentences(text: str) -> List[str]:
    return [s.strip() for s in re.split(r"[\n\r•·▪●;]|(?<=[.!?])\s+", text or "") if s and s.strip()]


def _significant_tokens(text: str) -> Set[str]:
    return {t[:5] for t in re.findall(r"[^\W\d_]{4,}", _fold(text)) if t not in _STOP}


def _title_level(title: str) -> Optional[int]:
    hay = _fold(title)
    for lvl, pats in _LEVEL_PATTERNS:
        if any(p.search(hay) for p in pats):
            return lvl
    return None


def _band_level(exp_lo: Optional[int], exp_hi: Optional[int]) -> Optional[int]:
    if exp_lo is None and exp_hi is None:
        return None
    lo, hi = exp_lo or 0, exp_hi
    if lo >= 5:
        return 2
    if lo >= 3:
        return 1
    if lo >= 1:
        return 1
    if hi is not None and hi <= 1:
        return 0
    return None  # "no requirement" is not evidence of a level


def _years_level(years: Optional[float]) -> int:
    if years < 1.5:
        return 0
    if years < 4.5:
        return 1
    if years < 8:
        return 2
    return 3


def prepare_job(job: Dict[str, Any]) -> Dict[str, Any]:
    """Posting-side features, computed once per posting and reused for every profile."""
    cached = job.get("_rules")
    if cached is not None:
        return cached
    title = job.get("title") or ""
    requirements = job.get("requirements") or ""
    required: Set[str] = set(job.get("title_concepts") or [])
    preferred: Set[str] = set()
    quals: Set[str] = set()        # stated as mandatory
    quals_preferred: Set[str] = set()
    for sentence in _sentences(requirements):
        folded = _fold(sentence)
        if any(p.search(folded) for p in _PREFERRED):
            preferred.update(concepts_in(sentence))
            quals_preferred |= _qualifications(sentence)
        else:
            required.update(concepts_in(sentence))
            quals |= _qualifications(sentence)
    for sentence in _sentences(job.get("description") or ""):
        folded = _fold(sentence)
        is_pref = any(p.search(folded) for p in _PREFERRED)
        is_req = any(p.search(folded) for p in _REQUIRED)
        if is_pref or is_req:
            (preferred if is_pref else required).update(concepts_in(sentence))
            (quals_preferred if is_pref else quals).update(_qualifications(sentence))
    quals_preferred -= quals
    mentioned = (set(job.get("concepts") or []) | _extra_concepts(job.get("full_text") or "")) - required - preferred
    preferred -= required
    generic = P.GENERIC_CONCEPTS
    level = _title_level(title)
    if level is None:
        level = _band_level(job.get("exp_lo"), job.get("exp_hi"))
        if level is None and _title_level(job.get("seniority_label") or "") is not None:
            level = _title_level(job.get("seniority_label"))
    if _is_manager_title(title) and (level is None or level < 1):
        level = 1   # a managerial posting is at least mid-level even when it states no experience band
    feats = {
        "occupations": _occupations(title),
        "subjects": _subjects(title),
        "families": set(),
        "tokens": _significant_tokens(title),
        "required": required - generic,
        "preferred": preferred - generic,
        "context": mentioned - generic,
        "qualifications": quals,
        "qualifications_preferred": quals_preferred,
        "level": level,
        "title_concepts": set(job.get("title_concepts") or []) - generic,
    }
    # broad occupations ("director", "engineer") never earn family credit: they say too little about what the job is
    feats["families"] = {_OCC_FAMILY[o] for o in feats["occupations"] - BROAD_OCCUPATIONS}
    job["_rules"] = feats
    return feats


def prepare_persona(persona: Dict[str, Any]) -> Dict[str, Any]:
    cached = persona.get("_rules")
    if cached is not None:
        return cached
    roles = persona.get("experience_history") or []
    targets = [t for t in persona.get("target_titles") or [] if t]
    if not targets and not any(r.get("role") for r in roles) and (persona.get("summary") or "").strip():
        # Many candidates state only a headline ("Mühasib / Accountant"). Without target roles or past titles the headline is the
        # candidate's own statement of what they are, so it stands in as the target role instead of leaving the role unknown.
        targets = [persona["summary"].strip()]
    past = [r.get("role") for r in roles if r.get("role")]
    evidence_text = " ".join(
        [persona.get("summary") or "", " ".join(targets), " ".join(persona.get("hard_skills") or []), " ".join(persona.get("soft_skills") or []),
         " ".join(past), " ".join(a for r in roles for a in r.get("achievements") or []), " ".join(map(str, persona.get("certifications") or []))]
    )
    feats = {
        "target_occupations": _occupations(" ".join(targets)),
        "past_occupations": _occupations(" ".join(past)),
        "tokens": _significant_tokens(" ".join(targets + past)),
        "evidence": concepts_in(evidence_text),
        "qualifications": _qualifications(evidence_text),
        "subjects": _subjects(" ".join(targets + past)),
        "has_roles": bool(targets or past),
        "role_concepts": set(persona.get("role_concepts") or []) | concepts_in(" ".join(targets + past)),
    }
    feats["target_families"] = {_OCC_FAMILY[o] for o in feats["target_occupations"] - BROAD_OCCUPATIONS}
    feats["past_families"] = {_OCC_FAMILY[o] for o in feats["past_occupations"] - BROAD_OCCUPATIONS}
    raw_years = persona.get("years_of_experience")
    if raw_years is not None:
        try:
            feats["years"] = float(raw_years)
        except (ValueError, TypeError):
            feats["years"] = None
    else:
        feats["years"] = None   # Unknown experience when neither years nor history are provided
    persona["_rules"] = feats
    return feats


def _teacher_specialisation(pf, jf):
    """Both sides teach; compare the subjects. -> (value or None, explanation); None means neutral/unknown."""
    if not jf["subjects"] or not pf["subjects"]:
        return None, "subject unknown on one side"
    if jf["subjects"] & pf["subjects"]:
        return 1.0, "same subject (%s)" % ", ".join(sorted(jf["subjects"] & pf["subjects"]))
    if any(frozenset((a, b)) in L.SUBJECT_NEIGHBOURS for a in jf["subjects"] for b in pf["subjects"]):
        return 0.55, "neighbouring subject (%s vs %s)" % (", ".join(sorted(jf["subjects"])), ", ".join(sorted(pf["subjects"])))
    return 0.3, "different subject (%s vs %s)" % (", ".join(sorted(jf["subjects"])), ", ".join(sorted(pf["subjects"])))


def _adjacent(job_occ: Set[str], cand_occ: Set[str]):
    best, pair = 0.0, None
    for a in job_occ:
        for b in cand_occ:
            v = L.ADJACENT.get(frozenset((a, b)), 0.0)
            if v > best:
                best, pair = v, (a, b)
    return best, pair


def _role_component(pf: Dict[str, Any], jf: Dict[str, Any]):
    """-> (value or None, explanation)"""
    if not pf["has_roles"]:
        return None, "candidate states no target or past roles"
    cand = pf["target_occupations"] | pf["past_occupations"]
    exact_target = jf["occupations"] & pf["target_occupations"]
    exact_past = jf["occupations"] & pf["past_occupations"]
    if exact_target or exact_past:
        value = 1.0 if exact_target else 0.85
        label = "title matches a %s role (%s)" % ("target" if exact_target else "past", ", ".join(sorted(exact_target or exact_past)))
        if "teacher" in (exact_target or exact_past):
            spec, why = _teacher_specialisation(pf, jf)
            if spec is not None:
                return min(value, spec) if spec < 1.0 else value, label + "; " + why
        return value, label
    lexicon_decides = bool(jf["occupations"]) and bool(cand)
    if jf["title_concepts"] & pf["role_concepts"] and not lexicon_decides:
        return 0.8, "title shares role concepts (%s)" % ", ".join(sorted(jf["title_concepts"] & pf["role_concepts"]))
    adj, pair = _adjacent(jf["occupations"], pf["target_occupations"])
    adj_past, pair_past = _adjacent(jf["occupations"], pf["past_occupations"])
    if adj_past * 0.85 > adj:
        adj, pair = adj_past * 0.85, pair_past
    if adj > 0:
        return round(adj, 3), "adjacent occupation (%s ~ %s)" % pair
    if jf["families"] & pf["target_families"]:
        return 0.6, "same occupation family as a target role (%s)" % ", ".join(sorted(jf["families"] & pf["target_families"]))
    if jf["families"] & pf["past_families"]:
        return 0.5, "same occupation family as a past role (%s)" % ", ".join(sorted(jf["families"] & pf["past_families"]))
    shared = jf["tokens"] & pf["tokens"]
    if shared:
        return 0.3, "title shares words with the candidate's roles"
    if not jf["occupations"] and not jf["tokens"]:
        return None, "posting title is not recognised"
    if not jf["occupations"]:
        return None, "posting title is not in the occupation lexicon and shares no words with the candidate's roles"
    return 0.0, "title is a different occupation (%s)" % ", ".join(sorted(jf["occupations"]))


def recommendation_role_relevant(persona: Dict[str, Any], job: Dict[str, Any]) -> bool:
    """Basic requirements cannot substitute for the occupation a candidate targets.

    Only a known posting occupation and an explicit zero role relationship veto
    a recommendation. Exact, adjacent and same-family careers remain eligible;
    unknown titles retain the existing evidence/confidence policy. A candidate
    deliberately targeting a new occupation is eligible even without past work.
    """
    pf, jf = prepare_persona(persona), prepare_job(job)
    # An incomplete lexicon is not evidence that a free-form role is incompatible.
    known_candidate = (pf["target_occupations"] | pf["past_occupations"]) - BROAD_OCCUPATIONS
    known_posting = jf["occupations"] - BROAD_OCCUPATIONS
    if not known_candidate or not known_posting:
        return True
    # Explicit target occupations override unrelated historical jobs (career change).
    # Unknown free-form targets are not treated as an exhaustive taxonomy.
    if pf["target_occupations"] - BROAD_OCCUPATIONS:
        targets = " ".join(persona.get("target_titles") or [])
        intended = {**pf, "past_occupations": set(), "past_families": set(),
                    "tokens": _significant_tokens(targets), "role_concepts": concepts_in(targets),
                    "subjects": _subjects(targets)}
        role, _ = _role_component(intended, jf)
    else:
        role, _ = _role_component(pf, jf)
    return not (pf["has_roles"] and jf["occupations"] and role == 0.0)


def apply_recommendation_policy(persona, job, detail):
    relevant = recommendation_role_relevant(persona, job)
    detail["filters"]["role_relevant"] = relevant

    preference = _preference_filters(persona, job)
    detail["filters"]["work_arrangement_ok"] = preference["work_arrangement_ok"]
    detail["filters"]["seniority_ok"] = preference["seniority_ok"]
    detail["filters"]["work_arrangement"] = preference["work_arrangement_ok"]
    detail["filters"]["seniority"] = preference["seniority_ok"]
    if preference["work_arrangement_note"]:
        detail["notes"]["work_arrangement"] = preference["work_arrangement_note"]
    if preference["seniority_note"]:
        detail["notes"]["seniority"] = preference["seniority_note"]

    loc_ok = detail["filters"].get("location_ok", True)
    detail["filters"]["location"] = loc_ok
    work_arr_ok = preference["work_arrangement_ok"]
    sen_ok = preference["seniority_ok"]
    posting_text = " ".join(str(job.get(k) or "") for k in ("title", "full_text", "description", "requirements"))
    folded_posting = _fold(posting_text)
    citizenship_phrases = re.finditer(
        r"\b(?:azerbaijan(?:i)?\s+(?:citizen|citizenship)|citizenship\s+(?:of|in)\s+azerbaijan|citizens?\s+of\s+azerbaijan|"
        r"az(?:erbaycan)?\s+(?:respublikasinin\s+)?vetendas(?:i|lari|liq)?|"
        r"ar\s+vetendas(?:i|lari|liq)?|гражданств\w*\s+азербайджан\w*)\b",
        folded_posting,
    )
    mandatory_citizenship = re.compile(
        r"\b(?:must|mandatory|required|only|olmalidir|teleb olunur|mutleqdir|vacibdir|mecburidir|"
        r"обязательн\w*|необходим\w*|требуется)\b"
    )
    requires_az_citizenship = any(
        mandatory_citizenship.search(folded_posting[max(0, match.start() - 70):match.end() + 70])
        for match in citizenship_phrases
    )
    stated_citizenship = _fold(str(persona.get("citizenship") or "")).strip()
    citizenship_ok = not (
        requires_az_citizenship
        and stated_citizenship
        and not re.search(r"\b(?:azerbaijan(?:i)?|az|ar)\b|азербайджан", stated_citizenship)
    )
    detail["filters"]["citizenship"] = citizenship_ok
    detail["filters"]["recommendation_eligible"] = bool(relevant and loc_ok and work_arr_ok and sen_ok and citizenship_ok)

    if not relevant:
        detail["score"] = 0.0
        detail["notes"]["role"] = "posting occupation is unrelated to stated target or past roles"
    elif not loc_ok:
        detail["score"] = 0.0
        detail["notes"]["location"] = detail["notes"].get("location", "posting location is outside candidate preferences")
    elif not work_arr_ok:
        detail["score"] = 0.0
        detail["notes"]["work_arrangement"] = detail["notes"].get("work_arrangement", "posting work arrangement is outside candidate preferences")
    elif not sen_ok:
        detail["score"] = 0.0
        detail["notes"]["seniority"] = detail["notes"].get("seniority", "posting seniority is incompatible with candidate experience")
    elif not citizenship_ok:
        detail["score"] = 0.0
        detail["notes"]["citizenship"] = "posting requires Azerbaijani citizenship and the stated citizenship does not match"
    return detail


def _coverage(wanted: Iterable[str], have: Set[str]):
    wanted = set(wanted)
    return (len(wanted & have) / len(wanted)) if wanted else None


def _seniority_component(pf: Dict[str, Any], jf: Dict[str, Any]):
    if jf["level"] is None:
        return None, "posting states no seniority"
    if pf["years"] is None:
        return None, "candidate experience unknown"
    gap = jf["level"] - _years_level(pf["years"])
    if gap == 0:
        return 1.0, "seniority matches"
    if gap < 0:
        return 0.85, "candidate is more senior than the posting"
    return (0.5 if gap == 1 else 0.15), "posting is %d level(s) above the candidate" % gap


def score_job(persona: Dict[str, Any], job: Dict[str, Any], pv: Optional[dict] = None) -> Dict[str, Any]:
    """Same signature and result keys as pipeline.score_job (pv is ignored: there are no vectors)."""
    pf, jf = prepare_persona(persona), prepare_job(job)
    notes: Dict[str, str] = {}
    comp: Dict[str, Optional[float]] = {}
    weight: Dict[str, float] = {}
    why: Dict[str, str] = {}

    comp["role"], why["role"] = _role_component(pf, jf)
    weight["role"] = WEIGHTS["role"]

    wanted = {c: 1.0 for c in jf["required"]}
    wanted.update({c: CONTEXT_WEIGHT for c in jf["context"] if c not in wanted})
    if wanted:
        have = pf["evidence"]
        comp["required"] = sum(w for c, w in wanted.items() if c in have) / sum(wanted.values())
        weight["required"] = WEIGHTS["required"] * min(len(wanted), 3) / 3.0
        why["required"] = "%d of %d skills/requirements found in the profile" % (sum(1 for c in wanted if c in have), len(wanted))
    else:
        comp["required"], weight["required"], why["required"] = None, WEIGHTS["required"], "posting names no recognisable skills"

    if not pf["evidence"]:
        comp["required"], why["required"] = None, "candidate states no skills or experience"
    pref_cov = _coverage(jf["preferred"], pf["evidence"])
    comp["preferred"] = pref_cov
    weight["preferred"] = WEIGHTS["preferred"] * min(len(jf["preferred"]), 2) / 2.0 if jf["preferred"] else WEIGHTS["preferred"]
    why["preferred"] = "%d of %d preferred skills found" % (len(jf["preferred"] & pf["evidence"]), len(jf["preferred"])) if jf["preferred"] else "posting lists no preferred skills"

    comp["seniority"], why["seniority"] = _seniority_component(pf, jf)
    weight["seniority"] = WEIGHTS["seniority"]

    known = {k: v for k, v in comp.items() if v is not None}
    full = sum(WEIGHTS.values())
    used = sum(weight[k] for k in known)
    confidence = used / full
    base = (sum(weight[k] * v for k, v in known.items()) / used) if used else 0.0

    mult = 1.0
    # location: unknown preferences and remote pairings are neutral
    city = job.get("location_canonical", "unknown")
    raw_prefs = persona.get("preferred_cities") or []
    prefs = [P.canonical_location(c) for c in raw_prefs if c]
    cand_arrangements = {_normalise_arrangement(a) for a in (persona.get("work_arrangements") or [])}
    cand_arrangements.discard(None)
    for tag in ("remote", "hybrid", "onsite"):
        if tag in prefs:
            prefs.remove(tag)
            cand_arrangements.add(tag)

    job_arrangement = _normalise_arrangement(job.get("work_arrangement"))
    if job_arrangement is None and (bool(job.get("is_remote")) or city == "remote"):
        job_arrangement = "remote"
    job_remote = job_arrangement == "remote" or city == "remote"
    preference = _preference_filters(persona, job)
    work_arrangement_ok = preference["work_arrangement_ok"]
    seniority_ok = preference["seniority_ok"]
    if not work_arrangement_ok:
        mult = 0.0
        notes["work_arrangement"] = preference["work_arrangement_note"]
    if not seniority_ok:
        mult = 0.0
        notes["seniority"] = preference["seniority_note"]

    loc_ok = True
    if job_remote and ("remote" in cand_arrangements or not prefs):
        pass
    elif not prefs or city in ("unknown", ""):
        if prefs:
            notes["location"] = "job location unspecified"
    elif city in prefs:
        loc_ok = True
    else:
        loc_ok = False
        mult = 0.0
        notes["location"] = "%s (%s outside preferred)" % (job.get("location"), city)

    # salary: only a stated ceiling below the candidate's floor counts; unknown is neutral
    fx = P._FX_TO_AZN.get(str(persona.get("salary_currency") or "AZN").upper(), 1.0)
    j_fx = P._FX_TO_AZN.get(str(job.get("salary_currency") or "AZN").upper(), 1.0)
    salary_ok = True
    try:
        s_min = float(persona["salary_min"]) * fx if persona.get("salary_min") is not None else None
        j_to = float(job["salary_to"]) * j_fx if job.get("salary_to") is not None else None
    except (TypeError, ValueError):
        s_min = j_to = None
    if job.get("salary_from") is None and job.get("salary_to") is None:
        notes["salary"] = "unspecified"
    elif s_min is not None and j_to is not None and j_to < s_min:
        salary_ok, mult = False, mult * 0.75
        notes["salary"] = "job pays up to %d, expect min %d" % (j_to, s_min)

    exp_ok = True
    years = persona.get("years_of_experience") or 0
    req_min = job.get("exp_lo") or 0
    if req_min and pf["years"] is None:
        notes["experience"] = "candidate experience unknown — not penalized"
    elif req_min and req_min > years + 0.5:
        exp_ok = False
        gap = req_min - years
        mult *= 0.7 if gap <= 2 else (0.55 if gap <= 4 else 0.4)
        notes["experience"] = "requires %d+ yrs (have %d)" % (req_min, years)

    edu_ok = True
    edu_rank = job.get("edu_rank") or 0
    p_edu = int((persona.get("education") or {}).get("rank", 0))
    if edu_rank > p_edu:
        edu_ok = False
        mult *= 0.8 if edu_rank - p_edu < 2 else 0.65
        notes["education"] = "requires higher education (%s)" % job.get("education_label")

    lang_ok = True
    missing = [l for l in job.get("languages_required", []) if l not in persona["languages_set"]]
    if job.get("languages_required"):
        if not persona["languages_set"]:
            notes["language"] = "candidate languages unknown — not penalized"
        elif missing:
            lang_ok = False
            mult *= max(0.7, 1.0 - 0.15 * len(missing))
            notes["language"] = "missing: " + ", ".join(missing)

    reg = (jf["occupations"] & REGULATED) - (pf["target_occupations"] | pf["past_occupations"])
    if reg:
        mult *= 0.4
        notes["qualification"] = "regulated occupation (%s) not shown in profile" % ", ".join(sorted(reg))

    missing_q = sorted(jf["qualifications"] - pf["qualifications"])
    for _q in missing_q[:2]:
        mult *= MANDATORY_QUALIFICATION_MULTIPLIER
    if missing_q:
        notes["certification"] = "posting requires %s (mandatory); not shown in profile" % ", ".join(missing_q)
    missing_pref = sorted(jf["qualifications_preferred"] - pf["qualifications"])
    if missing_pref:
        notes["preferred_certification"] = "posting prefers %s; not shown in profile (not penalised)" % ", ".join(missing_pref)

    if mult > 0.0:
        mult = max(mult, 0.3)
    score = base * mult * (0.5 + 0.5 * confidence)
    if confidence < MIN_CONFIDENCE:
        score = min(score, UNCERTAIN_CAP)
        notes["confidence"] = "too little known about the profile or posting to score reliably"
    # A posting whose title cannot be classified is recommended only on strong skill evidence: at least three
    # recognised skills and at least half of them present in the profile.
    if comp["role"] is None and pf["has_roles"] and jf["occupations"] == set() and not (comp["required"] is not None and comp["required"] >= 0.5 and len(wanted) >= 3):
        score = min(score, UNCERTAIN_CAP)
        notes.setdefault("confidence", "posting title not classified and skill evidence is weak")
    score = max(0.0, min(1.0, score))

    matched = sorted((jf["required"] | jf["preferred"] | jf["context"]) & pf["evidence"])
    gaps = sorted(jf["required"] - pf["evidence"])
    components = [
        {"name": k, "value": None if comp[k] is None else round(comp[k], 3), "weight": round(weight[k], 3), "known": comp[k] is not None, "why": why[k]}
        for k in ("role", "required", "preferred", "seniority")
    ]
    return apply_recommendation_policy(persona, job, {
        "semantic": 0.0,  # no embedding in this mode (kept so the response contract is unchanged)
        "role_fit": round(comp["role"] or 0.0, 3),
        "skill_demand": round(comp["required"] or 0.0, 3),
        "keyword": round(comp["preferred"] or 0.0, 3),
        "base": round(base, 3),
        "filter_multiplier": round(mult, 3),
        "filters": {
            "location_ok": loc_ok,
            "work_arrangement_ok": work_arrangement_ok,
            "seniority_ok": seniority_ok,
            "salary_ok": salary_ok,
            "experience_ok": exp_ok,
            "education_ok": edu_ok,
            "language_ok": lang_ok,
        },
        "notes": notes,
        "matched_concepts": matched,
        "gaps": gaps,
        "score": round(score * 100, 1),
        "mode": MODE,
        "version": SCORER_VERSION,
        "confidence": round(confidence, 3),
        "components": components,
    })


def parse_posting(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Same dispatch as main._parse_posting, without embedding."""
    if isinstance(raw.get("detail"), dict) or "slug" in raw:
        return P.parse_job(raw, with_counts=False)
    return P.parse_vacancy(raw, with_counts=False)
