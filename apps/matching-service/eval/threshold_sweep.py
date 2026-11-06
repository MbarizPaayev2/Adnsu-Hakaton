# -*- coding: utf-8 -*-
"""Threshold-calibration EVIDENCE for the rules scorer (does not change any threshold): for a set of thresholds, how many pairs would be
stored/e-mailed, how many of them are labelled relevant (strong + partial), and how many strong pairs are kept.

    python eval/threshold_sweep.py --set . --splits dev heldout --set v2 --splits dev

Only the named splits are scored. The v2 sealed split is never scored by this tool unless asked for explicitly.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import run_eval as E  # noqa: E402

THRESHOLDS = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70]


def load(set_dir):
    d = os.path.join(HERE, set_dir)
    pf = "personas.json" if os.path.exists(os.path.join(d, "personas.json")) else "personas.generated.json"
    return (json.load(open(os.path.join(d, pf), encoding="utf-8")), json.load(open(os.path.join(d, "jobs.json"), encoding="utf-8")),
            json.load(open(os.path.join(d, "labels.json"), encoding="utf-8")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="append", nargs="+", metavar=("SET", "SPLIT"), required=True, help="--run <set dir> <split> [<split> ...]")
    args = ap.parse_args()
    R = E.load_rules_scorer("rules:.")
    for run in args.run:
        set_dir, splits = run[0], run[1:]
        personas, jobs, labels = load(set_dir)
        sel = [p for p in personas if p["split"] in splits and not p.get("expectNoEmail")]
        scores = E.score_all_rules(R, sel, jobs)
        ids = [j["evalId"] for j in jobs]
        rows = []
        n_rel = n_strong = 0
        for p in sel:
            g, kind = E.grades_for(labels, p["evalId"], ids)
            n_rel += sum(1 for j in ids if kind[j] in ("strong", "partial"))
            n_strong += sum(1 for j in ids if kind[j] == "strong")
        print("\n== set %s, splits %s: %d personas x %d postings; relevant %d, strong %d" % (set_dir, "+".join(splits), len(sel), len(jobs), n_rel, n_strong))
        print("  %-9s %-7s %-9s %-11s %-10s %s" % ("threshold", "stored", "relevant", "unsuitable", "precision", "strong kept"))
        for t in THRESHOLDS:
            stored = rel = strong = 0
            for p in sel:
                g, kind = E.grades_for(labels, p["evalId"], ids)
                for j in ids:
                    if scores[p["evalId"]][j] >= t:
                        stored += 1
                        rel += kind[j] in ("strong", "partial")
                        strong += kind[j] == "strong"
            print("  %-9.2f %-7d %-9d %-11d %-10.2f %d/%d" % (t, stored, rel, stored - rel, (rel / stored) if stored else 0.0, strong, n_strong))


if __name__ == "__main__":
    main()
