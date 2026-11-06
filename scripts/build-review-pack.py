#!/usr/bin/env python3
"""Builds an ANONYMOUS native-reader review pack from an az-quality evaluation run (apps/api/test/support/az-quality-eval.js).

  scripts/build-review-pack.py <results.json> <pdf-dir> <fixtures.json> <out-dir> [--include-failed]

Writes: out/<neutral-id>.pdf (the generated document as a PDF), out/review-sheet.html (+ review-sheet.pdf with headless Chrome when available) and
out/KEY-do-not-share-with-reviewer.json (neutral id -> model, case, kind, automatic findings). The sheet shows the synthetic candidate's facts, the real public
vacancy's requirements, and for each document its text in a fixed shuffled order, with three SEPARATE scores: A facts, B language, C PDF layout.
The reviewer never sees model names or automatic flags. Only documents that passed the product's own gates are included (a rejected generation is not a sample).
"""
import html, json, os, random, re, shutil, subprocess, sys

res, pdfdir, fix, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)
results = [r for r in json.load(open(res)) if r.get('ok')]
cases = {c['id']: c for c in json.load(open(fix))}
rng = random.Random(20261009)
rng.shuffle(results)
key = {}
blocks = []
cand_done = set()

def facts_block(c):
    p = c['persona']; b = p['basics']
    lines = [f"<b>{html.escape(b['name'])}</b> — {html.escape(b['headline'])}"]
    for e in p['experience']:
        lines.append(f"{html.escape(e['position'])}, {html.escape(e['company'])} ({html.escape(e['period'])}): " + '; '.join(html.escape(h) for h in e['highlights']))
    for e in p['education']:
        lines.append(f"Təhsil: {html.escape(e['degree'])}, {html.escape(e['area'])}, {html.escape(e['school'])} ({html.escape(e['period'])})")
    lines.append('Bacarıqlar: ' + html.escape(', '.join(k for s in p['skills'] for k in s['keywords'])))
    for key_ in ('projects', 'certifications', 'activities'):
        for it in p.get(key_, []) or []:
            lines.append(f"{key_}: " + html.escape(' — '.join(str(v) for k, v in it.items() if k != 'entryId' and v)))
    for s in p.get('stories', []) or []:
        lines.append('Hekayə: ' + html.escape(f"{s['situation']} {s['action']} {s['result']}"))
    if c.get('motivation'): lines.append('Namizədin öz motivasiyası: ' + html.escape(c['motivation']))
    else: lines.append('Namizədin motivasiya mətni yoxdur (seyrək profil).')
    return '<br>'.join(lines)

for i, r in enumerate(results, 1):
    nid = f"S{i:02d}"
    c = cases[r['case']]
    src = os.path.join(pdfdir, f"{r['case']}-{r['kind']}-{re.sub(r'[^A-Za-z0-9_]', '_', r['model'])}.pdf")
    has_pdf = os.path.exists(src)
    if has_pdf: shutil.copy(src, os.path.join(out, f"{nid}.pdf"))
    key[nid] = {'model': r['model'], 'case': r['case'], 'kind': r['kind'], 'requests': r.get('requests'), 'langProblems': r.get('langProblems'), 'issues': [x['code'] for x in r.get('issues', [])], 'tokens': [r['meta'].get('promptTokens'), r['meta'].get('completionTokens')] if r.get('meta') else None}
    text = re.sub(r'\n+', '</p><p>', html.escape(r['text']))
    first = r['case'] not in cand_done; cand_done.add(r['case'])
    job = c['job']
    blocks.append(f"""<section><h2>{nid} — {'CV' if r['kind']=='CV' else 'Motivasiya məktubu'} <small>(fayl: {nid}.pdf)</small></h2>
<p class=meta>Vakansiya: <b>{html.escape(job['position'])}</b>, {html.escape(job['company'])}. Namizəd: {html.escape(c['persona']['basics']['name'])}.</p>
<div class=txt><p>{text}</p></div>
<table><tr><th>A. Faktlar — mətndəki hər şey namizədin məlumatlarına uyğundur?</th><td>☐ bəli &nbsp; ☐ uydurma/səhv var: ____________</td></tr>
<tr><th>B. Dil — Azərbaycan dilində təbii və düzgündür? (1 = yararsız … 5 = təbii)</th><td>1 ☐ &nbsp; 2 ☐ &nbsp; 3 ☐ &nbsp; 4 ☐ &nbsp; 5 ☐ &nbsp; Səhv sözlər / cümlələr: ____________</td></tr>
<tr><th>C. PDF görünüşü — fayla baxın (boşluqlar, sətir keçidi, ə ı ö ü ç ş ğ düzgündür?)</th><td>☐ təmiz &nbsp; ☐ problem: ____________</td></tr></table></section>""")

cand_sections = ''.join(f"<section class=cand><h3>Namizəd və vakansiya: {html.escape(c['persona']['basics']['name'])}</h3><p>{facts_block(c)}</p><p class=meta><b>Vakansiyanın mətni (qısaldılmış):</b> {html.escape(c['job']['description'][:900])}…</p></section>" for c in cases.values() if c['id'] in cand_done)
doc = f"""<!doctype html><meta charset=utf-8><title>AISE — sənəd nümunələri (rəy vərəqi)</title>
<style>body{{font:13px/1.55 -apple-system,Helvetica,Arial;margin:26px;color:#111}}h1{{font-size:20px}}h2{{margin-top:26px;border-top:2px solid #333;padding-top:8px;font-size:16px}}small{{font-weight:normal;color:#555}}.txt{{background:#f6f6f6;padding:8px 12px;border-radius:6px}}.cand{{background:#fbfbf2;border:1px solid #ddd;padding:6px 12px;margin:10px 0;break-inside:avoid}}.meta{{color:#444}}table{{border-collapse:collapse;width:100%;margin:8px 0}}th,td{{border:1px solid #bbb;padding:6px;text-align:left;vertical-align:top}}th{{width:38%;background:#fafafa}}</style>
<h1>AISE — Azərbaycan dilində CV və məktub nümunələri (rəy vərəqi)</h1>
<p>Bütün namizədlər <b>uydurmadır</b>; vakansiyalar real, açıq elanlardır. Sənədlər süni intellektlə yazılıb və saytda <b>hələ söndürülüb</b>. Hər nümunəni <u>üç ayrı</u> meyar üzrə qiymətləndirin: <b>A faktlar</b>, <b>B dil</b>, <b>C PDF görünüşü</b>. Nümunələr qarışıq sırada və adsızdır; hansı modelin yazdığı sizə göstərilmir. Aşağıdakı «namizəd» bölmələri modelin istifadə edə biləcəyi bütün faktları göstərir: mətndə olmayan hər şey uydurmadır.</p>
{cand_sections}
{''.join(blocks)}
<h2>Ümumi rəy</h2><p>Müştərilərə göstərmək olarmı? ☐ bəli &nbsp; ☐ yalnız dəyişikliklərdən sonra &nbsp; ☐ xeyr. &nbsp; Rəyçi: __________ &nbsp; Tarix: ________</p>"""
open(os.path.join(out, 'review-sheet.html'), 'w').write(doc)
json.dump(key, open(os.path.join(out, 'KEY-do-not-share-with-reviewer.json'), 'w'), indent=1, ensure_ascii=False)
chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if os.path.exists(chrome):
    subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', f'--print-to-pdf={os.path.abspath(out)}/AISE-review-sheet.pdf', f'file://{os.path.abspath(out)}/review-sheet.html'], capture_output=True)
print(f'{len(results)} samples -> {out}')
