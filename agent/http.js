// HTTP client do agente (sem dependências externas)
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

function request(method, urlString, body, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlString); } catch (e) { return reject(e); }
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const data = body !== undefined && body !== null ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
      timeout: timeoutMs,
    };
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { parsed = raw; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: parsed });
        } else {
          const err = new Error((parsed && parsed.error) || `HTTP ${res.statusCode}`);
          err.status = res.statusCode;
          err.data = parsed;
          reject(err);
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function createClient(baseUrl, token) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  return {
    post: (p, body) => request('POST', root + p, body, auth),
    get: (p) => request('GET', root + p, undefined, auth),
    setToken(t) { Object.assign(auth, t ? { Authorization: `Bearer ${t}` } : {}); },
    root,
  };
}

module.exports = { request, createClient };
