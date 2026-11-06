/* AISE Agent: bridge to AISE's own assistant page (aisehr.com/dashboard/agent only). It tells that page the extension is installed, its version and whether it is
 * paired, and accepts ONE thing from it: a pairing code the signed-in candidate just created, so pairing is a single click. Messages are accepted only from the
 * page's own window and origin. The device token never reaches the page, and a browser that is already paired is never re-paired from a page: that needs the
 * candidate's own "Ayır" in the extension first. */
(() => {
  if (window.__aiseBridge) return;
  window.__aiseBridge = true;
  const version = chrome.runtime.getManifest().version;
  const tell = (msg) => window.postMessage({ source: 'aise-extension', ...msg }, location.origin);
  async function hello() {
    let paired = false;
    try { paired = !!(await chrome.runtime.sendMessage({ type: 'status' }))?.paired; } catch { /* the worker is starting; the page asks again */ }
    tell({ type: 'hello', version, paired });
  }
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.source !== 'aise-web') return;
    if (m.type === 'ping') return hello();
    if (m.type === 'pair' && typeof m.code === 'string' && typeof m.nonce === 'string') {
      let r;
      try { r = await chrome.runtime.sendMessage({ type: 'pair', code: m.code.slice(0, 12), fromPage: true }); } catch (err) { r = { ok: false, error: String((err && err.message) || err) }; }
      tell({ type: 'pair-result', nonce: m.nonce.slice(0, 40), ok: !!(r && r.ok), error: r && !r.ok ? String(r.error || '').slice(0, 300) : undefined });
      hello();
    }
  });
  hello();
})();
