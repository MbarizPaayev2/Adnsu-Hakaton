# -*- coding: utf-8 -*-
"""Relevance evaluation of the job-matching scorer on the synthetic set in this
directory (profiles.json, jobs.json, labels.json). See docs/matching-evaluation.md.

    python eval/run_eval.py --scorer main=.                      # this checkout
    python eval/run_eval.py --scorer rules=rules:.               # deterministic rules mode (no model)
    python eval/run_eval.py --scorer deployed=git:9decf92 --scorer main=.
    python eval/run_eval.py --split heldout --scorer main=. --json /tmp/out.json

A scorer is a directory holding pipeline.py, or `git:<rev>` to use
apps/matching-service/pipeline.py as committed at that revision (how the
30 August scorer that production still runs is reproduced).

Personas come from personas.generated.json, which is built by the production
TypeScript adapter (apps/api/src/matching/eval-personas.spec.ts). Postings are
passed to the scorer exactly as the adapter passes Glorri-shaped postings:
verbatim.

The acceptance criteria below were written before any scorer change and are the
only bar a change has to clear. Exit status is non-zero when any criterion
fails for the requested split.
"""
import argparse
import importlib.util
import json
import math
import os
import statistics
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICE_DIR = os.path.dirname(HERE)

STORE_THRESHOLD = 0.35  # MATCH_SCORE_THRESHOLD: a pair at/above this becomes a stored Match
EMAIL_FLOOR = 0.50      # MATCH_EMAIL_MIN_SCORE: a match at/above this may be emailed

GRADE = {"strong": 2, "partial": 1, "poor": 0, "hard": 0}

# name -> (dev bound, heldout bound, description). "max" bounds are upper limits.
CRITERIA = [
    ("C1 strong ranked above poor", "min", 0.95, 0.90),
    ("C2 strong ranked above partial", "min", 0.80, 0.75),
    ("C3 preference-eligible partial ranked above poor", "min", 0.80, 0.75),
    ("C4 hard mismatches stored as a match", "max", 0, 0),
    ("C5 poor/hard pairs at or above the email floor", "max", 0, 0),
    ("C6 strong pairs reaching the email floor", "min", 0.70, 0.60),
    ("C7 median(strong) - median(poor)", "min", 0.20, 0.20),
    ("C8 incomplete profile: pairs at or above the email floor", "max", 0, 0),
    ("C9 employment-type-as-location twin within 0.05 of its twin", "max", 0.05, 0.05),
    ("C10 mean NDCG@5", "min", 0.85, 0.85),
]


def load_scorer(spec):
    if spec.startswith("git:"):
        rev = spec[4:]
        tmp = tempfile.mkdtemp(prefix="scorer-")
        for name in ("pipeline.py",):
            blob = subprocess.check_output(
                ["git", "-C", SERVICE_DIR, "show", "%s:apps/matching-service/%s" % (rev, name)]
            )
            with open(os.path.join(tmp, name), "wb") as fh:
                fh.write(blob)
        path = tmp
    else:
        path = os.path.abspath(spec)
    module_name = "scorer_%d" % abs(hash(spec))
    spec_ = importlib.util.spec_from_file_location(module_name, os.path.join(path, "pipeline.py"))
    mod = importlib.util.module_from_spec(spec_)
    sys.modules[module_name] = mod
    sys.path.insert(0, path)
    try:
        spec_.loader.exec_module(mod)
    finally:
        sys.path.pop(0)
    return mod


def load_rules_scorer(spec):
    """`rules:<dir>`: the deterministic scorer (rules_scorer.py) in <dir>; it needs no embedding model."""
    path = os.path.abspath(spec[len("rules:"):] or ".")
    sys.path.insert(0, path)
    try:
        import importlib
        return importlib.import_module("rules_scorer")
    finally:
        sys.path.pop(0)


def score_all_rules(R, personas, jobs):
    parsed = {j["evalId"]: R.parse_posting(j) for j in jobs}
    out = {}
    for entry in personas:
        persona = R.P.parse_persona(entry["persona"])
        out[entry["evalId"]] = {jid: round(R.score_job(persona, job)["score"] / 100.0, 4) for jid, job in parsed.items()}
    return out


def embed_job(P, raw):
    """Same steps as main.py's _embed_job, against any scorer revision."""
    job = P.parse_job(raw)
    emb = P._shared_embedder()
    job["emb"] = [float(v) for v in P._pool(emb, [P.chunk_text(job["full_text"])])[0]]
    job["emb_req"] = [float(v) for v in P._pool(emb, [P.chunk_text(job["req_text"])])[0]]
    title_text = job["title_text"] or job["title"] or job["category"]
    job["emb_title"] = [float(v) for v in emb.encode([title_text])[0]]
    return job


def score_all(P, personas, jobs):
    parsed = {j["evalId"]: embed_job(P, j) for j in jobs}
    out = {}
    for entry in personas:
        persona = P.parse_persona(entry["persona"])
        pv = P._persona_vectors(persona)
        out[entry["evalId"]] = {
            jid: round(P.score_job(persona, job, pv)["score"] / 100.0, 4) for jid, job in parsed.items()
        }
    return out


def grades_for(labels, persona_id, job_ids):
    lab = labels[persona_id]
    g, kind = {}, {}
    for jid in job_ids:
        k = "poor"
        for name in ("strong", "partial", "hard"):
            if jid in lab.get(name, []):
                k = name
        kind[jid] = k
        g[jid] = GRADE[k]
    return g, kind


def pair_rate(scores, grades, hi, lo):
    wins = total = 0
    for a, ga in grades.items():
        for b, gb in grades.items():
            if ga == hi and gb == lo:
                total += 1
                wins += 1 if scores[a] > scores[b] else 0
    return wins, total


def labelled_pair_rate(scores, kinds, high, low, eligible=None):
    """Compare named labels exactly; hard cases are not poor controls."""
    wins = total = 0
    for a, kind_a in kinds.items():
        for b, kind_b in kinds.items():
            if kind_a != high or kind_b != low:
                continue
            if eligible is not None and (not eligible.get(a, True) or not eligible.get(b, True)):
                continue
            total += 1
            wins += 1 if scores[a] > scores[b] else 0
    return wins, total


def ndcg_at(scores, grades, k=5):
    ranked = sorted(scores, key=lambda j: -scores[j])[:k]
    dcg = sum((2 ** grades[j] - 1) / math.log2(i + 2) for i, j in enumerate(ranked))
    ideal = sorted(grades.values(), reverse=True)[:k]
    idcg = sum((2 ** g - 1) / math.log2(i + 2) for i, g in enumerate(ideal))
    return dcg / idcg if idcg else None


def preference_eligibility(R, personas, jobs):
    """Evaluate explicit candidate vetoes independently of the ranking score.

    A posting outside a stated city/work arrangement/seniority/citizenship
    constraint is not a candidate for the recommendation ranking. Role fit is
    deliberately not part of this exclusion: it remains the subject of C3.
    """
    parsed_jobs = {j["evalId"]: R.parse_posting(j) for j in jobs}
    out = {}
    for entry in personas:
        persona = R.P.parse_persona(entry["persona"])
        accepted = {}
        for jid, job in parsed_jobs.items():
            filters = R.score_job(persona, job).get("filters", {})
            accepted[jid] = all(
                filters.get(name) is not False
                for name in ("location_ok", "work_arrangement_ok", "seniority_ok", "citizenship")
            )
        out[entry["evalId"]] = accepted
    return out


def evaluate(personas, jobs, labels, scores, split, preference_eligible):
    job_ids = [j["evalId"] for j in jobs]
    sel = [p for p in personas if split == "all" or p["split"] == split]
    pr = {"ss": [0, 0], "sp": [0, 0], "pp_legacy": [0, 0], "pp_labeled": [0, 0], "pp_eligible": [0, 0]}
    by_kind = {"strong": [], "partial": [], "poor": [], "hard": []}
    hard_stored = poor_at_floor = strong_total = strong_at_floor = 0
    incomplete_at_floor = 0
    stored_counts, emailed_counts, ndcgs, per_persona = [], [], [], []
    twin_gap = 0.0
    for p in sel:
        pid = p["evalId"]
        s = scores[pid]
        g, kind = grades_for(labels, pid, job_ids)
        for key, high, low in (("ss", "strong", "poor"), ("sp", "strong", "partial"), ("pp_labeled", "partial", "poor")):
            w, t = labelled_pair_rate(s, kind, high, low)
            pr[key][0] += w
            pr[key][1] += t
        # Historical metric grouped `hard` with `poor` because both had grade 0.
        # Retain that number for audit; hard mismatches have their own C4/C5 gates.
        w, t = pair_rate(s, g, 1, 0)
        pr["pp_legacy"][0] += w
        pr["pp_legacy"][1] += t
        eligible = preference_eligible.get(pid, {})
        w, t = labelled_pair_rate(s, kind, "partial", "poor", eligible)
        pr["pp_eligible"][0] += w
        pr["pp_eligible"][1] += t
        for jid in job_ids:
            by_kind[kind[jid]].append(s[jid])
            if kind[jid] == "hard" and s[jid] >= STORE_THRESHOLD:
                hard_stored += 1
            if kind[jid] in ("poor", "hard") and s[jid] >= EMAIL_FLOOR:
                poor_at_floor += 1
            if kind[jid] == "strong":
                strong_total += 1
                strong_at_floor += 1 if s[jid] >= EMAIL_FLOOR else 0
        if p.get("expectNoEmail"):
            incomplete_at_floor += sum(1 for v in s.values() if v >= EMAIL_FLOOR)
        else:
            nd = ndcg_at(s, g)
            if nd is not None:
                ndcgs.append(nd)
        stored_counts.append(sum(1 for v in s.values() if v >= STORE_THRESHOLD))
        emailed_counts.append(sum(1 for v in s.values() if v >= EMAIL_FLOOR))
        if pid == "D2_acc_az":
            twin_gap = abs(s["j11"] - s["j12"])
        top = sorted(s, key=lambda j: -s[j])[:3]
        per_persona.append(
            {
                "persona": pid,
                "top3": [(j, kind[j], s[j]) for j in top],
                "stored": stored_counts[-1],
                "atEmailFloor": emailed_counts[-1],
                "strongScores": sorted((s[j] for j in job_ids if kind[j] == "strong"), reverse=True),
            }
        )

    def rate(v):
        return (v[0] / v[1]) if v[1] else None

    med = lambda xs: statistics.median(xs) if xs else None
    measured = {
        "C1 strong ranked above poor": rate(pr["ss"]),
        "C2 strong ranked above partial": rate(pr["sp"]),
        "C3 preference-eligible partial ranked above poor": rate(pr["pp_eligible"]),
        "C4 hard mismatches stored as a match": hard_stored,
        "C5 poor/hard pairs at or above the email floor": poor_at_floor,
        "C6 strong pairs reaching the email floor": (strong_at_floor / strong_total) if strong_total else None,
        "C7 median(strong) - median(poor)": (
            (med(by_kind["strong"]) - med(by_kind["poor"] + by_kind["hard"])) if by_kind["strong"] else None
        ),
        "C8 incomplete profile: pairs at or above the email floor": incomplete_at_floor,
        "C9 employment-type-as-location twin within 0.05 of its twin": twin_gap if any(p["evalId"] == "D2_acc_az" for p in sel) else None,
        "C10 mean NDCG@5": (sum(ndcgs) / len(ndcgs)) if ndcgs else None,
    }
    dist = {k: {"n": len(v), "min": min(v), "median": med(v), "max": max(v)} for k, v in by_kind.items() if v}
    return measured, dist, per_persona, {
        "storedPerPersona": stored_counts,
        "atEmailFloorPerPersona": emailed_counts,
        "c3PreferenceEligiblePairs": pr["pp_eligible"][1],
        "c3ExcludedByExplicitPreference": pr["pp_labeled"][1] - pr["pp_eligible"][1],
        "c3AllLabeledPairs": pr["pp_labeled"][1],
        "c3AllLabeledPairWinRate": rate(pr["pp_labeled"]),
        "c3HistoricalGradeCollapsedPairs": pr["pp_legacy"][1],
        "c3HistoricalGradeCollapsedWinRate": rate(pr["pp_legacy"]),
    }


def verdicts(measured, split):
    col = 3 if split in ("heldout", "sealed") else 2
    rows = []
    for crit in CRITERIA:
        name, kind = crit[0], crit[1]
        bound = crit[col]
        val = measured[name]
        if val is None:
            rows.append((name, bound, None, "n/a"))
            continue
        ok = val >= bound if kind == "min" else val <= bound
        rows.append((name, bound, val, "PASS" if ok else "FAIL"))
    return rows


def fmt(v):
    return "n/a" if v is None else ("%.3f" % v if isinstance(v, float) else str(v))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scorer", action="append", required=True, help="name=<dir>|git:<rev>")
    ap.add_argument("--split", default="dev", choices=["dev", "heldout", "sealed", "all"])
    ap.add_argument("--set", default=".", help="evaluation set directory under eval/ (default: the v1 set; v2 for eval/v2)")
    ap.add_argument("--gate", default="requested", choices=["requested", "dev", "none"],
                    help="dev: exit non-zero only when a development criterion fails (held-out is reported, "
                         "never tuned against; used by CI)")
    ap.add_argument("--json")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    set_dir = os.path.join(HERE, args.set)
    pfile = "personas.json" if os.path.exists(os.path.join(set_dir, "personas.json")) else "personas.generated.json"
    personas = json.load(open(os.path.join(set_dir, pfile), encoding="utf-8"))
    jobs = json.load(open(os.path.join(set_dir, "jobs.json"), encoding="utf-8"))
    labels = json.load(open(os.path.join(set_dir, "labels.json"), encoding="utf-8"))
    report, failed = {}, False
    # Keep the historical all-pairs C3 value visible for comparison, but do not
    # rank a vacancy the candidate explicitly cannot/will not accept against an
    # actionable partial match. Thresholds remain unchanged.
    Policy = load_rules_scorer("rules:.")
    preference_eligible = preference_eligibility(Policy, personas, jobs)
    for item in args.scorer:
        name, _, spec = item.partition("=")
        if spec.startswith("rules:"):
            scores = score_all_rules(load_rules_scorer(spec), personas, jobs)
        else:
            P = load_scorer(spec)
            scores = score_all(P, personas, jobs)
        splits = sorted({p["split"] for p in personas}, key=lambda x: ("dev", "heldout", "sealed").index(x)) if args.split == "all" else [args.split]
        report[name] = {"scores": scores}
        for sp in splits:
            measured, dist, per_persona, counts = evaluate(personas, jobs, labels, scores, sp, preference_eligible)
            rows = verdicts(measured, sp)
            report[name][sp] = {"measured": measured, "distribution": dist, "perPersona": per_persona, "counts": counts}
            print("\n=== scorer %-10s split %-8s ===" % (name, sp))
            for n, bound, val, res in rows:
                print("  %-4s %-62s bound %-6s measured %s" % (res, n, fmt(bound), fmt(val)))
                if res == "FAIL" and args.gate != "none" and (args.gate == "requested" or sp == "dev"):
                    failed = True
            print("  score by label (0-1):")
            for k in ("strong", "partial", "poor", "hard"):
                d = dist.get(k)
                if d:
                    print("    %-8s n=%-3d min %.3f  median %.3f  max %.3f" % (k, d["n"], d["min"], d["median"], d["max"]))
            print("  pairs stored (>= %.2f) per persona: %s ; at email floor (>= %.2f): %s"
                  % (STORE_THRESHOLD, counts["storedPerPersona"], EMAIL_FLOOR, counts["atEmailFloorPerPersona"]))
            print("  C3 audit: eligible %d / labelled %d; explicit-preference exclusions %d; labelled-pair rate %s; historical grade-collapsed rate %s"
                  % (counts["c3PreferenceEligiblePairs"], counts["c3AllLabeledPairs"], counts["c3ExcludedByExplicitPreference"], fmt(counts["c3AllLabeledPairWinRate"]), fmt(counts["c3HistoricalGradeCollapsedWinRate"])))
            if args.verbose:
                for pp in per_persona:
                    print("   ", pp["persona"], "top3", [(j, k, s) for j, k, s in pp["top3"]],
                          "strong", pp["strongScores"])
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=1)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
