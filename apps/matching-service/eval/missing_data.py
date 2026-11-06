# -*- coding: utf-8 -*-
"""Missing-data behaviour of the embedding scorer vs the deterministic scorer on the evaluation set.

Each variant blanks one kind of information, on the candidate side or on the posting side, and reports how much the
results move and whether unsuitable pairs start to be stored. Labels and personas are the unchanged evaluation
fixtures; nothing here feeds back into either scorer's weights.

    python eval/missing_data.py --scorer embedding=. --scorer rules=rules:.
"""
import argparse
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_eval as E  # noqa: E402

PERSONA_VARIANTS = {
    "no salary expectation": lambda p: p.__setitem__("salary_expectation", {}),
    "no preferred cities": lambda p: p.__setitem__("preferred_cities", []),
    "no languages": lambda p: p.__setitem__("languages", []),
    "experience unknown (0 years)": lambda p: p.__setitem__("years_of_experience", 0),
    "half of the skills missing": lambda p: p.__setitem__("hard_skills", p.get("hard_skills", [])[::2]),
    "no target titles": lambda p: p.__setitem__("target_titles", []),
}


def job_no_location(j):
    j["location"] = ""
    (j.get("detail") or {})["location"] = ""


def job_no_requirements(j):
    (j.get("detail") or {})["requirements_text"] = ""


JOB_VARIANTS = {"posting without location": job_no_location, "posting without requirements section": job_no_requirements}


class Scorer:
    def __init__(self, spec):
        self.rules = spec.startswith("rules:")
        if self.rules:
            self.R = E.load_rules_scorer(spec)
            self.P = self.R.P
        else:
            self.P = E.load_scorer(spec)
        self._jobs = {}

    def parsed(self, key, job):
        if key not in self._jobs:
            self._jobs[key] = self.R.parse_posting(copy.deepcopy(job)) if self.rules else E.embed_job(self.P, copy.deepcopy(job))
        return self._jobs[key]

    def score(self, personas, jobs, variant_key=""):
        parsed = {j["evalId"]: self.parsed((j["evalId"], variant_key), j) for j in jobs}
        out = {}
        for entry in personas:
            persona = self.P.parse_persona(copy.deepcopy(entry["persona"]))
            if self.rules:
                out[entry["evalId"]] = {jid: round(self.R.score_job(persona, job)["score"] / 100.0, 4) for jid, job in parsed.items()}
            else:
                pv = self.P._persona_vectors(persona)
                out[entry["evalId"]] = {jid: round(self.P.score_job(persona, job, pv)["score"] / 100.0, 4) for jid, job in parsed.items()}
        return out


def metrics(personas, jobs, labels, scores, base):
    deltas, nd, fp, strong_stored, strong_n, overlap = [], [], 0, 0, 0, []
    ids = [j["evalId"] for j in jobs]
    for p in personas:
        pid = p["evalId"]
        g, kind = E.grades_for(labels, pid, ids)
        s, b = scores[pid], base[pid]
        deltas += [abs(s[j] - b[j]) for j in ids]
        n = E.ndcg_at(s, g)
        if n is not None:
            nd.append(n)
        for j in ids:
            if kind[j] in ("poor", "hard") and s[j] >= E.STORE_THRESHOLD:
                fp += 1
            if kind[j] == "strong":
                strong_n += 1
                strong_stored += 1 if s[j] >= E.STORE_THRESHOLD else 0
        top = lambda x: set(sorted(x, key=lambda j: -x[j])[:3])
        overlap.append(len(top(s) & top(b)) / 3.0)
    return {
        "mean|Δscore|": sum(deltas) / len(deltas),
        "NDCG@5": sum(nd) / len(nd),
        "unsuitable stored": fp,
        "strong stored": strong_stored / strong_n,
        "top-3 kept": sum(overlap) / len(overlap),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scorer", action="append", required=True)
    ap.add_argument("--json")
    args = ap.parse_args()
    personas_all = json.load(open(os.path.join(HERE, "personas.generated.json"), encoding="utf-8"))
    personas = [p for p in personas_all if not p.get("expectNoEmail")]
    jobs = json.load(open(os.path.join(HERE, "jobs.json"), encoding="utf-8"))
    labels = json.load(open(os.path.join(HERE, "labels.json"), encoding="utf-8"))
    report = {}
    for item in args.scorer:
        name, _, spec = item.partition("=")
        sc = Scorer(spec)
        base = sc.score(personas, jobs)
        rows = {"baseline (nothing blanked)": metrics(personas, jobs, labels, base, base)}
        for label, fn in PERSONA_VARIANTS.items():
            variants = []
            for p in personas:
                q = copy.deepcopy(p)
                fn(q["persona"])
                variants.append(q)
            rows[label] = metrics(personas, jobs, labels, sc.score(variants, jobs), base)
        for label, fn in JOB_VARIANTS.items():
            variant_jobs = []
            for j in jobs:
                k = copy.deepcopy(j)
                fn(k)
                variant_jobs.append(k)
            rows[label] = metrics(personas, jobs, labels, sc.score(personas, variant_jobs, variant_key=label), base)
        report[name] = rows
        print("\n=== %s (%d labelled personas x %d postings) ===" % (name, len(personas), len(jobs)))
        print("  %-38s %-11s %-8s %-17s %-13s %s" % ("variant", "mean|Δscore|", "NDCG@5", "unsuitable stored", "strong stored", "top-3 kept"))
        for label, m in rows.items():
            print("  %-38s %-11.3f %-8.3f %-17d %-13.2f %.2f" % (label, m["mean|Δscore|"], m["NDCG@5"], m["unsuitable stored"], m["strong stored"], m["top-3 kept"]))
    if args.json:
        json.dump(report, open(args.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
