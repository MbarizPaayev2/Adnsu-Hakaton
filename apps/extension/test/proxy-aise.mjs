// https://aisehr.com/backend/* → the local API under test, so the extension's production API_BASE is used unchanged.
// https://aisehr.com/dashboard/* → a blank AISE-origin page, where the extension's bridge content script runs exactly as on the real assistant page.
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import { DIR } from './fixture-lever.mjs';

export function startProxy({ port, apiPort }) {
  const server = https.createServer({ key: fs.readFileSync(DIR + 'certs/key.pem'), cert: fs.readFileSync(DIR + 'certs/cert.pem') }, (req, res) => {
    if (req.url.startsWith('/dashboard/') || req.url === '/elsewhere') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><title>AISE</title><body>AISE page</body>'); }
    if (!req.url.startsWith('/backend/')) { res.writeHead(404); return res.end(); }
    const up = http.request({ host: '127.0.0.1', port: apiPort, path: req.url.slice('/backend'.length), method: req.method, headers: { ...req.headers, host: `127.0.0.1:${apiPort}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, close: () => new Promise((r) => server.close(r)) })));
}
