import { api } from '../lib/api.js';
import { fillIdentity } from '../lib/assisted-form.js';
import { WEB_ORIGIN as API_ORIGIN } from '../lib/util.js';
import { prefillSummary } from '../lib/prefill-summary.js';
let prefillMessage = '';
const GLORRI_HOSTS = ['jobs.glorri.az', 'jobs.glorri.com'];
const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);
const REASONS = {
  NO_WORK: 'Hazırda görüləcək iş yoxdur.',
  AGENT_DISABLED: 'Brauzer köməkçisi serverdə söndürülüb.',
  PAUSED_BY_OPERATOR: 'AISE tərəfindən müvəqqəti dayandırılıb.',
  PLAN_REQUIRED: 'Planınız brauzer köməkçisini əhatə etmir; açıq işlər dayandırıldı. Premium plan lazımdır.',
  MONTHLY_LIMIT: 'Bu ayın müraciət limiti dolub; yeni ay başlayanda davam edəcək.',
  EXTENSION_OUTDATED: 'Bu versiya artıq dəstəklənmir: köməkçi heç nə doldurmur və göndərmir. AISE-də Brauzer köməkçisi səhifəsindən yeni versiyanı yükləyin.',
};
// What the server says when pairing fails, in plain Azerbaijani (the server's own message is used when it is already Azerbaijani).
const PAIR_ERRORS = {
  PAIRING_CODE_EXPIRED: 'Kodun vaxtı bitib və ya istifadə olunub. AISE-də yeni kod yaradın.',
  PAIRING_CODE_INVALID: 'Kod yanlışdır. 8 simvoldan ibarət kodu yenidən yoxlayın.',
  PLAN_REQUIRED: 'Brauzer köməkçisi Premium planına daxildir.',
  EXTENSION_OUTDATED: 'Bu versiya artıq dəstəklənmir. AISE-dən yeni versiyanı yükləyib quraşdırın, sonra yenidən cütləyin.',
};

async function render() {
  const s = await send({ type: 'status' });
  $('version').textContent = `Versiya ${s.version || chrome.runtime.getManifest().version}`;
  $('unpaired').hidden = s.paired; $('paired').hidden = !s.paired;
  if (!s.paired) return;
  const st = s.status || {};
  const lines = [];
  if (st.current) lines.push(`Müraciət üzərində işləyir (${st.current.step === 'describe' ? 'forma oxunur' : 'doldurulur və göndərilir'}).`);
  else if (st.idle) lines.push(REASONS[st.idle] || st.idle);
  if (st.lastPollAt) lines.push(`Son yoxlama: ${new Date(st.lastPollAt).toLocaleTimeString()}.`);
  const waiting = Object.keys(s.runs || {}).length;
  if (waiting) lines.push(`${waiting} göndəriş portalın təsdiqini gözləyir.`);
  $('detail').textContent = lines.join(' ');
  $('state').textContent = st.lastError ? 'Diqqət tələb olunur' : 'Qoşulub.';
  $('state').className = st.lastError ? 'err' : 'ok';
  $('msg').textContent = prefillMessage || st.lastError || '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const mode = pageMode(tab?.url);
  $('target').textContent = mode.host ? `Açıq səhifə: ${mode.host}` : '';
  $('mode').textContent = mode.text;
  $('prefill').disabled = !mode.prefill;
}

/**
 * What the assistant can do on the open tab, said before anything is clicked: a supported portal (Lever) can be submitted only through an
 * application you approved in AISE; any other HTTPS employer form (Glorri included) only gets your name, e-mail and phone in empty fields.
 */
function pageMode(url) {
  let u;
  try { u = new URL(url); } catch { return { host: '', prefill: false, text: 'Əvvəlcə işəgötürənin müraciət formasını açın.' }; }
  if (u.protocol !== 'https:') return { host: u.hostname, prefill: false, text: 'Bu səhifədə doldurma mümkün deyil: yalnız HTTPS işəgötürən formalarında işləyir.' };
  if (u.hostname === 'jobs.lever.co') return { host: u.hostname, prefill: true, text: 'Dəstəklənən portal. Göndərmə yalnız AISE-də təsdiq etdiyiniz müraciət üçün olur; burada boş ad, e-poçt və telefon sahələrini də doldura bilərsiniz.' };
  if (GLORRI_HOSTS.includes(u.hostname)) return { host: u.hostname, prefill: true, text: 'Glorri: “Şəxsi məlumatlar” addımında boş ad, soyad, e-poçt və telefon, “Motivasiya məktubu” addımında isə AISE-də bu vakansiya üçün təsdiqlədiyiniz məktub doldurulur. CV, ata adı, maaş, FİN, şəkil, suallar, razılıq və göndərmə sizdədir; AISE heç nə göndərmir.' };
  if (/(^|\.)aisehr\.com$/.test(u.hostname)) return { host: u.hostname, prefill: false, text: 'Bu AISE səhifəsidir. Müraciət etmək istədiyiniz işəgötürən formasını açın.' };
  return { host: u.hostname, prefill: true, text: 'Formada kömək: yalnız boş ad, soyad, e-poçt və telefon sahələri doldurulur. CV, əlavə suallar, razılıqlar və göndərmə sizdədir; AISE bu saytda heç nə göndərmir.' };
}

$('open-aise').addEventListener('click', () => chrome.tabs.create({ url: `${API_ORIGIN}/dashboard/agent` }));

$('pair').addEventListener('click', async () => {
  $('msg').textContent = 'Cütlənir…';
  const r = await send({ type: 'pair', code: $('code').value });
  const code = typeof r.error === 'string' ? Object.keys(PAIR_ERRORS).find((k) => r.error.includes(k)) : null;
  $('msg').textContent = r.ok ? '' : (code ? PAIR_ERRORS[code] : r.error || 'Cütləmə alınmadı. AISE-də yeni kod yaradın.');
  render();
});
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pair').click(); });
$('poll').addEventListener('click', async () => { await send({ type: 'poll' }); $('msg').textContent = 'Yoxlanılır…'; setTimeout(render, 1500); });
$('disconnect').addEventListener('click', async () => { await send({ type: 'disconnect' }); render(); });
render();
setInterval(render, 4000);

$('prefill').addEventListener('click', async () => {
  $('prefill').disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    if (url.protocol !== 'https:' || !tab.id) throw new Error('HTTPS işəgötürən formasını açın.');
    const profile = await api('/assisted-profile');
    // Glorri's letter step: the letter approved in AISE for this very vacancy, when there is one (404 = none; the candidate writes it).
    if (GLORRI_HOSTS.includes(url.hostname)) {
      try { profile.letter = (await api(`/assisted-letter?url=${encodeURIComponent(url.href)}`)).text; } catch (e) { if (e.status !== 404) throw e; }
    }
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillIdentity, args: [profile] });
    const filled = result[0]?.result;
    if (!filled?.ok) throw Object.assign(new Error(filled?.reason || 'Bu səhifədə doldurula bilən forma tapılmadı.'), { own: true });
    prefillMessage = prefillSummary(filled);
  } catch (e) {
    // Each failure says what to do next: re-pair, upgrade, open a form, or check the connection.
    prefillMessage = e.own ? e.message
      : e.status === 401 ? 'Brauzerin cütləməsi bitib. AISE-də Brauzer köməkçisi səhifəsində yeni kod yaradıb yenidən cütləyin.'
      : e.status === 403 && /EXTENSION_OUTDATED/.test(JSON.stringify(e.body || '')) ? REASONS.EXTENSION_OUTDATED
      : e.status === 403 ? 'Premium plan və təsdiqlənmiş hesab lazımdır.'
      : typeof e.status === 'number' ? 'AISE cavab vermədi. Bir az sonra yenidən cəhd edin.'
      : /Cannot access|cannot be scripted|permission/i.test(String(e.message)) ? 'Brauzer bu səhifəyə girişə icazə vermədi. Səhifəni yeniləyin və genişlənmənin icazələrini yoxlayın.'
      : 'Forma doldurulmadı. İnternet bağlantısını yoxlayın və yenidən cəhd edin.';
  } finally { $('prefill').disabled = false; $('msg').textContent = prefillMessage; }
});
