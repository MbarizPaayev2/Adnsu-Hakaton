# -*- coding: utf-8 -*-
"""Latency of the deterministic scorer on (a) a real inventory dump and (b) a clearly labelled SYNTHETIC 5,000-posting scale set.

    python eval/bench_rules_latency.py --inventory inventory.json [--synthetic 5000]

inventory.json: {"persona": {...}, "jobs": [ <posting payloads exactly as the API sends them to /score-profile> ]}
(written by apps/api/test/scorer-latency-probe.ts dumpall). The synthetic set is built from the real postings by
deterministic mutation (unique ids/slugs, shuffled sentences, varied experience/location); it measures scale, not relevance.
Reported times are for the machine this runs on; label them accordingly (not production performance).
"""
import argparse
import copy
import json
import os
import random
import resource
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import pipeline as P  # noqa: E402
import rules_scorer as R  # noqa: E402


def ms(x):
    return "%.1f ms" % (x * 1000)


def synth(jobs, n, seed=20261003):
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        j = copy.deepcopy(jobs[i % len(jobs)])
        tag = "synthetic-%05d" % i
        j["slug"] = tag
        j["clientId"] = "job:" + tag
        detail = j.get("detail") or {}
        for key in ("description_text", "requirements_text"):
            text = detail.get(key)
            if text:
                parts = [s for s in text.replace("\r", "").split("\n") if s.strip()]
                rnd.shuffle(parts)
                detail[key] = "\n".join(parts) + "\n"
        out.append(j)
    return out


def bench(label, persona_raws, raw_jobs):
    personas = [P.parse_persona(copy.deepcopy(p)) for p in persona_raws]
    t0 = time.perf_counter()
    parsed = [R.parse_posting(j) for j in raw_jobs]
    t_parse = time.perf_counter() - t0
    t0 = time.perf_counter()
    for j in parsed:
        R.prepare_job(j)
    t_prep = time.perf_counter() - t0
    per_profile = []
    scores0 = None
    for persona in personas:
        R.prepare_persona(persona)
        t0 = time.perf_counter()
        scores = [R.score_job(persona, j)["score"] for j in parsed]
        per_profile.append(time.perf_counter() - t0)
        scores0 = scores0 or scores
    # Stateless service analogue: a request carries raw postings, so parse + prepare + score all happen per chunk.
    chunk = raw_jobs[:25]
    reps = []
    for _ in range(5):
        t0 = time.perf_counter()
        for j in chunk:
            job = R.parse_posting(j)
            R.score_job(personas[0], job)
        reps.append(time.perf_counter() - t0)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024 if sys.platform == "darwin" else 1024)
    print("\n== %s: %d postings, %d profiles ==" % (label, len(raw_jobs), len(personas)))
    print("  parse all postings (pipeline.parse_*)        %s total, %s per posting" % (ms(t_parse), ms(t_parse / len(raw_jobs))))
    print("  prepare posting features (rules, once)       %s total, %s per posting" % (ms(t_prep), ms(t_prep / len(raw_jobs))))
    print("  score one profile vs all postings (warm)     median %s, max %s  (%s per posting)" % (ms(statistics.median(per_profile)), ms(max(per_profile)), ms(statistics.median(per_profile) / len(raw_jobs))))
    print("  stateless 25-posting request (parse+score)   median %s" % ms(statistics.median(reps)))
    print("  cold full pass, one profile (parse+prepare+score) ~ %s" % ms(t_parse + t_prep + per_profile[0]))
    print("  peak RSS of this process                     %.0f MB" % rss)
    return scores0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--synthetic", type=int, default=5000)
    ap.add_argument("--personas", default=os.path.join(HERE, "personas.generated.json"))
    args = ap.parse_args()
    data = json.load(open(args.inventory, encoding="utf-8"))
    personas = [p["persona"] for p in json.load(open(args.personas, encoding="utf-8"))]
    print("machine: python %s, %s" % (sys.version.split()[0], sys.platform))
    bench("REAL inventory (census snapshot)", personas, data["jobs"])
    if args.synthetic:
        bench("SYNTHETIC scale test (mutated copies of the real postings; measures speed only)", personas, synth(data["jobs"], args.synthetic))


if __name__ == "__main__":
    main()
