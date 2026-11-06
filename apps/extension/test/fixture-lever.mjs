// A local stand-in for a Lever-hosted posting, served as https://jobs.lever.co through the browser's host-resolver mapping. Its DOM follows the real form observed
// on jobs.lever.co/xsolla (field names, labels, the ✱ marker, a hidden hCaptcha response, SUBMIT APPLICATION) so the extension runs UNCHANGED. It is a FIXTURE:
// it proves our behaviour on failure paths and the plumbing, not Lever's real acceptance of an application.
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Busboy from 'busboy';

export const DIR = new URL('./', import.meta.url).pathname;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function postingId(n) { return `4b7879d6-0250-4717-9514-${String(n).padStart(12, '0')}`; }

/** scenarios: how each posting behaves. Keyed by the numeric suffix of the posting id. */
export function startLever({ port, scenarios = {} }) {
  const received = []; // every application the portal accepted
  const visits = {}; // per posting: number of times the apply page was served
  const events = [];
  const server = https.createServer({ key: fs.readFileSync(DIR + 'certs/key.pem'), cert: fs.readFileSync(DIR + 'certs/cert.pem') }, (req, res) => {
    const url = new URL(req.url, 'https://jobs.lever.co');
    const m = url.pathname.match(/^\/([a-z0-9-]+)\/(4b7879d6-0250-4717-9514-(\d{12}))(\/(apply|thanks))?\/?$/);
    if (url.pathname.startsWith('/hcaptcha.com/challenge')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>hCaptcha challenge</title><body style="margin:0"><p>Select all images with traffic lights</p><button id="human" onclick="parent.postMessage({solved:true},\'*\')">I am human</button></body>');
    }
    if (url.pathname === '/upload-resume' && req.method === 'POST') {
      const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: crypto.createHash('sha1').update(Buffer.concat(chunks)).digest('hex') })); });
      return;
    }
    if (!m) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Not found</title><h1>Page not found</h1>'); }
    const [, employer, id, num, , kind] = m; const n = Number(num); const sc = scenarios[n] || {};
    if (kind === 'thanks') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>Application submitted</title><h2>Application submitted!</h2><p>Thanks for applying.</p>`);
    }
    if (req.method === 'POST' && kind === 'apply') {
      const fields = {}; let file = null; const bb = Busboy({ headers: req.headers });
      bb.on('field', (k, v) => { fields[k] = v; });
      bb.on('file', (k, stream, info) => { const ch = []; stream.on('data', (c) => ch.push(c)); stream.on('end', () => { const b = Buffer.concat(ch); if (b.length) file = { name: info.filename, sha256: crypto.createHash('sha256').update(b).digest('hex'), bytes: b.length }; }); });
      bb.on('close', () => {
        if (sc.rejectSubmit) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(renderForm({ employer, id, n, sc, visit: 1, error: 'There was an error with your submission.' })); }
        received.push({ posting: n, fields, file }); events.push({ type: 'accepted', posting: n });
        if (sc.noConfirmation) { res.writeHead(204); return res.end(); } // accepted (or not) with no page change at all
        res.writeHead(302, { location: `/${employer}/${id}/thanks` }); res.end();
      });
      return req.pipe(bb);
    }
    if (sc.closed) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Job not found</title><h1>Sorry, this job is no longer accepting applications.</h1>'); }
    visits[n] = (visits[n] || 0) + 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(renderForm({ employer, id, n, sc, visit: visits[n] }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, received, visits, events, close: () => new Promise((r) => server.close(r)) })));
}

function renderForm({ employer, id, n, sc, visit, error }) {
  const disclaimer = sc.declarationChanges && visit > 1 ? 'We may use artificial intelligence (AI) tools to screen applications and share data with partners. NEW TERMS.' : 'We may use artificial intelligence (AI) tools to support parts of the hiring process. Final decisions are made by humans.';
  const q = (label, input, req) => `<li class="application-question"><label><div class="application-label">${esc(label)}${req ? '<span class="required">✱</span>' : ''}</div><div class="application-field">${input}</div></label></li>`;
  const yn = '<option value="">Select...</option><option value="Yes, I am">Yes, I am</option><option value="No, I am not">No, I am not</option>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Xsolla - Middle QA Engineer</title></head><body>
<h1>Middle QA Engineer</h1>${error ? `<div class="error-message" role="alert">${esc(error)}</div>` : ''}
<form id="application-form" method="POST" action="/${employer}/${id}/apply" enctype="multipart/form-data"><ul>
${q('Resume/CV', '<input type="file" name="resume" id="resume-upload-input"><input type="hidden" name="resumeStorageId" value="">', true)}
${q('Full name', '<input type="text" name="name" required>', true)}
${q('Email', '<input type="email" name="email" required>', true)}
${q('Phone', '<input type="text" name="phone">', false)}
${q('Current location', '<input type="text" name="location"><input type="hidden" name="selectedLocation">', false)}
${q('Current company', '<input type="text" name="org">', false)}
${q('LinkedIn URL', '<input type="text" name="urls[LinkedIn]">', true)}
${q('GitHub URL', '<input type="text" name="urls[GitHub]">', false)}
${q('Are you legally authorized to work in the location where this role is based?', `<select name="cards[a][field0]" required>${yn}</select>`, true)}
${sc.extraQuestion ? q('Which test automation tools have you used in production?', '<input type="text" name="cards[a][field1]" required>', true) : ''}
${sc.eeoRequired ? q('Gender', '<select name="eeo[gender]" required><option value="">Select ...</option><option value="Male">Male</option><option value="Female">Female</option><option value="Decline">Decline to self-identify</option></select>', true) : q('Gender', '<select name="eeo[gender]"><option value="">Select ...</option><option value="Male">Male</option><option value="Female">Female</option><option value="Decline">Decline to self-identify</option></select>', false)}
${sc.unsupportedControl ? q('Draw your signature', '<input type="range" name="sig" required>', true) : ''}
</ul><input type="hidden" name="h-captcha-response" value=""><input type="hidden" name="accountId" value="acct"><div id="captcha-slot"></div>
<button type="button" id="btn-submit">SUBMIT APPLICATION</button></form>
<div class="posting-disclaimer">${esc(disclaimer)}</div>
<script>
const form = document.getElementById('application-form'); const SC = ${JSON.stringify({ captcha: !!sc.captcha, autofill: !!sc.autofill })};
document.getElementById('resume-upload-input').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return; document.body.classList.add('resume-upload-working');
  const r = await fetch('/upload-resume', { method: 'POST', body: await f.arrayBuffer() }); const j = await r.json();
  form.querySelector('[name=resumeStorageId]').value = j.id;
  if (SC.autofill) { form.querySelector('[name=name]').value = 'PARSED WRONG NAME'; form.querySelector('[name=email]').value = 'parsed@wrong.example'; }
  document.body.classList.remove('resume-upload-working');
});
let solved = false;
function missing() { return [...form.querySelectorAll('[required]')].filter((el) => !el.value); }
function send() { form.submit(); }
document.getElementById('btn-submit').addEventListener('click', () => {
  if (missing().length || !form.querySelector('[name=resumeStorageId]').value) { const d = document.createElement('div'); d.className = 'error-message'; d.setAttribute('role', 'alert'); d.textContent = 'Please complete the required fields.'; form.prepend(d); return; }
  if (SC.captcha && !solved) {
    const f = document.createElement('iframe'); f.src = '/hcaptcha.com/challenge'; f.title = 'hCaptcha challenge'; f.style.cssText = 'width:400px;height:500px;position:fixed;top:40px;left:40px;z-index:9;background:#fff';
    document.getElementById('captcha-slot').appendChild(f);
    window.addEventListener('message', (m) => { if (m.data && m.data.solved) { solved = true; f.remove(); send(); } });
    return;
  }
  send();
});
</script></body></html>`;
}
