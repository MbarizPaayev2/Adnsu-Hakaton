# -*- coding: utf-8 -*-
"""Embedding scorer (HTTP, a running matching-service) vs the deterministic scorer on a real inventory dump.

    python eval/inventory_compare.py --inventory inventory.json --scorer-url http://127.0.0.1:8100 --token-file /tmp/scorer-token --out out.json

There are no relevance labels for the inventory, so this reports AGREEMENT and counts, not accuracy: how many postings each
scorer would store (>= 0.35) / allow to be e-mailed (>= 0.50) per profile, how much their top-10 overlap, and the top-5 titles of
each so a person can judge them (docs/rules-matching-evaluation-2026-10-03.md has the reviewer notes). The profiles are the
evaluation personas; nothing here is used to tune either scorer.
"""
import argparse
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import rules_scorer as R  # noqa: E402

CHUNK = 25


def embedding_scores(url, token, persona, jobs):
    out = {}
    for i in range(0, len(jobs), CHUNK):
        chunk = jobs[i:i + CHUNK]
        req = urllib.request.Request(url + "/score-profile", data=json.dumps({"persona": persona, "jobs": chunk}).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + token})
        with urllib.request.urlopen(req, timeout=300) as r:
            for res in json.load(r)["results"]:
                out[res["jobId"]] = res["score"]
    return out


def spearman(a, b):
    def ranks(x):
        order = sorted(range(len(x)), key=lambda i: x[i])
        r = [0.0] * len(x)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and x[order[j + 1]] == x[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2.0 + 1
            i = j + 1
        return r
    ra, rb = ranks(a), ranks(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = sum((x - ma) ** 2 for x in ra) ** 0.5
    vb = sum((y - mb) ** 2 for y in rb) ** 0.5
    return cov / (va * vb) if va and vb else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--scorer-url", required=True)
    ap.add_argument("--token-file", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    token = open(args.token_file).read().strip()
    data = json.load(open(args.inventory, encoding="utf-8"))
    jobs = data["jobs"]
    ids = [j["clientId"] for j in jobs]
    title = {j["clientId"]: ((j.get("detail") or {}).get("title") or j.get("title") or "") for j in jobs}
    personas = json.load(open(os.path.join(HERE, "personas.generated.json"), encoding="utf-8"))
    t0 = time.perf_counter()
    parsed = {j["clientId"]: R.parse_posting(j) for j in jobs}
    print("rules: parsed %d postings in %.1f s" % (len(jobs), time.perf_counter() - t0), flush=True)
    result = {}
    for entry in personas:
        pid = entry["evalId"]
        persona_raw = entry["persona"]
        t0 = time.perf_counter()
        emb = embedding_scores(args.scorer_url, token, persona_raw, jobs)
        t_emb = time.perf_counter() - t0
        persona = R.P.parse_persona(json.loads(json.dumps(persona_raw)))
        t0 = time.perf_counter()
        rules = {cid: R.score_job(persona, parsed[cid])["score"] / 100.0 for cid in ids}
        t_rules = time.perf_counter() - t0
        e = [emb[c] for c in ids]
        r = [rules[c] for c in ids]
        top = lambda s, k: set(sorted(ids, key=lambda c: -s[c])[:k])
        row = {
            "split": entry["split"],
            "embedding_stored": sum(v >= 0.35 for v in e), "rules_stored": sum(v >= 0.35 for v in r),
            "embedding_floor": sum(v >= 0.50 for v in e), "rules_floor": sum(v >= 0.50 for v in r),
            "spearman": spearman(e, r),
            "top10_overlap": len(top(emb, 10) & top(rules, 10)) / 10.0,
            "embedding_seconds_warm": t_emb, "rules_seconds_features_cached": t_rules,
            "top5_embedding": [(title[c], round(emb[c], 3)) for c in sorted(ids, key=lambda c: -emb[c])[:5]],
            "top5_rules": [(title[c], round(rules[c], 3)) for c in sorted(ids, key=lambda c: -rules[c])[:5]],
        }
        result[pid] = row
        print("%-18s stored emb %4d rules %4d | floor emb %4d rules %4d | spearman %.2f | top10 overlap %.1f | emb %.1fs (cache warm) rules %.3fs" % (pid, row["embedding_stored"], row["rules_stored"], row["embedding_floor"], row["rules_floor"], row["spearman"], row["top10_overlap"], t_emb, t_rules), flush=True)
    json.dump(result, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
