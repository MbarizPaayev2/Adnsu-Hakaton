#!/usr/bin/env node
// Public HTTP smoke check; no login, model calls, cookies or external sends.
import assert from 'node:assert/strict';

const base = (process.env.GUIDES_BASE_URL || 'https://aisehr.com').replace(/\/$/, '');
const canonicalBase = 'https://aisehr.com';
const slugs = [
  'cv-nece-yazilir', 'ats-uygun-cv', 'musahibeye-hazirliq-star-metodu',
  'motivasiya-mektubu-nece-yazilir', 'junior-data-analyst-cv-sql-power-bi',
  'junior-proqramci-cv-github-muraciet', 'mid-senior-cv-nailiyyet-qerar-tesir',
];
async function get(path, options = {}) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20000), ...options });
  assert.equal(response.status, 200, `${path}: expected public HTTP 200`);
  return response;
}
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(m => attributes(m[0]));
const jsonLd = html => [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map(m => JSON.parse(m[1]));

const sitemap = await (await get('/sitemap.xml')).text();
const robots = await (await get('/robots.txt')).text();
assert.match(robots, /Disallow: \/dashboard/);
assert.match(robots, /Sitemap: https:\/\/aisehr\.com\/sitemap\.xml/);
for (const slug of slugs) {
  const path = `/blog/${slug}`;
  const html = await (await get(path)).text();
  assert.ok(sitemap.includes(`${canonicalBase}${path}</loc>`), `${path}: missing sitemap entry`);
  assert.equal(tags(html, 'link').find(t => t.rel === 'canonical')?.href, `${canonicalBase}${path}`);
  assert.ok(!tags(html, 'meta').some(t => /^(robots|googlebot)$/i.test(t.name || '') && /noindex/i.test(t.content || '')), `${path}: noindex`);
  const posting = jsonLd(html).find(item => item['@type'] === 'BlogPosting');
  assert.ok(posting?.headline && posting.inLanguage === 'az-AZ' && posting.mainEntityOfPage['@id'] === `${canonicalBase}${path}`);
  assert.match(html, /<h1\b/);
  assert.ok(html.includes('Məqalənin mətni') && html.includes('href="/jobs"'), `${path}: missing readable body or next step`);
  if (slugs.indexOf(slug) >= 4) assert.ok(html.includes('id="praktik-alet"') && html.includes('Qısa cavab'));
  const imagePath = `${path}/opengraph-image`;
  const image = await get(imagePath);
  assert.match(image.headers.get('content-type') || '', /^image\/png/);
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  console.log(`PASS ${path}: HTML, canonical, schema, sitemap, image`);
}
const home = await (await get('/')).text();
assert.ok(home.includes('href="/blog"') && home.includes('career-guides-title'));
const index = await (await get('/blog')).text();
for (const slug of slugs) assert.ok(index.includes(`href="/blog/${slug}"`), `Index: ${slug} not server-rendered`);
for (const alias of ['ats-cv', 'ATS-UYGUN-CV']) {
  const response = await fetch(`${base}/blog/${alias}`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), '/blog/ats-uygun-cv');
}
for (const agent of ['Googlebot', 'OAI-SearchBot']) {
  await get('/blog', { headers: { 'User-Agent': agent } });
}
console.log('PASS homepage discovery, seven SSR links, canonical redirects and simulated crawler HTTP access.');
console.log('This does not establish real crawler-IP access, indexing, ranking, search volume or AI citation.');
