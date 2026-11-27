// ryuk hub - free key service (hardened)
//  GET  /key?t=TOKEN                -> Seite (nur mit Token + Signatur)
//  POST /key?t=TOKEN                -> Claim (nur mit gueltiger Seiten-Signatur)
//  POST /api/validate {key,hwid,fp} -> { ok, expiresIn } | { ok:false, reason, cooldownLeft }
//  POST /api/claim    {hwid,fp}     -> nur mit Signatur (X-Sig / sig feld) nutzbar
//
// Regel: Session 2h, danach 2h Cooldown ab Ablauf. Key ist pro HWID immer gleich.
// Schutz: Claim nur ueber die signierte Seite, HWID+Fingerprint-Bindung,
//         Rate-Limit pro IP, Replay-Schutz ueber kurze Signatur-Gueltigkeit.

const SESSION_MS = 2 * 60 * 60 * 1000;
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const SIG_TTL_MS = 10 * 60 * 1000;
const MAX_CLAIMS_PER_HOUR = 8;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-sig',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

const hits = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function hmac(secret, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function keyFor(secret, hwid) {
  const hex = (await hmac(secret, 'ryuk-free:' + hwid)).toUpperCase();
  return 'RYUK-' + hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16);
}

function rateOk(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || [];
  const fresh = rec.filter((t) => now - t < 60 * 60 * 1000);
  if (fresh.length >= MAX_CLAIMS_PER_HOUR) {
    hits.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  hits.set(ip, fresh);
  return true;
}

async function pageSig(env, token, ts) {
  return (await hmac(env.KEY_SECRET, 'page:' + token + ':' + ts)).slice(0, 32);
}

async function pageSigValid(env, token, ts, sig) {
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > SIG_TTL_MS) return false;
  const want = await pageSig(env, token, ts);
  return typeof sig === 'string' && sig.length === want.length && sig === want;
}

async function ensureSchema(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS sessions (hwid TEXT PRIMARY KEY, key TEXT NOT NULL, fp TEXT, expires_at INTEGER NOT NULL, cooldown_until INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
    )
    .run();
  try {
    await db.prepare('ALTER TABLE sessions ADD COLUMN fp TEXT').run();
  } catch (e) {
    // spalte existiert schon
  }
}

async function readRow(db, hwid) {
  return await db.prepare('SELECT * FROM sessions WHERE hwid = ?1').bind(hwid).first();
}

async function claim(env, hwid, fp) {
  const now = Date.now();
  await ensureSchema(env.DB);
  const row = await readRow(env.DB, hwid);
  const key = await keyFor(env.KEY_SECRET, hwid);
  const fingerprint = String(fp || '').slice(0, 128) || null;

  if (row) {
    if (now < row.expires_at) {
      return {
        status: 200,
        body: { key, expiresAt: row.expires_at, cooldownUntil: row.cooldown_until, active: true },
      };
    }
    if (now < row.cooldown_until) {
      return { status: 429, body: { cooldownLeft: Math.ceil((row.cooldown_until - now) / 1000) } };
    }
  }

  const expiresAt = now + SESSION_MS;
  const cooldownUntil = expiresAt + COOLDOWN_MS;
  await env.DB.prepare(
    'INSERT INTO sessions (hwid, key, fp, expires_at, cooldown_until, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(hwid) DO UPDATE SET key=?2, fp=COALESCE(?3, sessions.fp), expires_at=?4, cooldown_until=?5, updated_at=?6',
  )
    .bind(hwid, key, fingerprint, expiresAt, cooldownUntil, now)
    .run();
  return { status: 200, body: { key, expiresAt, cooldownUntil, active: true } };
}

async function validate(env, key, hwid, fp) {
  const now = Date.now();
  await ensureSchema(env.DB);
  const expected = await keyFor(env.KEY_SECRET, hwid);
  if (String(key || '').toUpperCase() !== expected) return { status: 200, body: { ok: false, reason: 'wrong_key' } };

  const row = await readRow(env.DB, hwid);
  if (!row || row.key !== expected) return { status: 200, body: { ok: false, reason: 'not_claimed' } };

  const fpNow = String(fp || '').slice(0, 128);
  if (fpNow) {
    if (!row.fp) {
      await env.DB.prepare('UPDATE sessions SET fp = ?1 WHERE hwid = ?2').bind(fpNow, hwid).run();
    } else if (row.fp !== fpNow) {
      return { status: 200, body: { ok: false, reason: 'device_changed' } };
    }
  }

  if (now < row.expires_at) {
    return { status: 200, body: { ok: true, expiresIn: Math.ceil((row.expires_at - now) / 1000) } };
  }
  return {
    status: 200,
    body: { ok: false, reason: 'expired', cooldownLeft: Math.max(0, Math.ceil((row.cooldown_until - now) / 1000)) },
  };
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}

const STYLE = `*{box-sizing:border-box}
html,body{margin:0;min-height:100vh}
body{
  background:#050506;
  color:#f2f2f4;
  font:15px/1.6 "Inter","Segoe UI",system-ui,sans-serif;
  position:relative;
  overflow-x:hidden;
  min-height:100vh;
}
/* 1. weiches licht oben + vignette an den raendern */
body::before{
  content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(75% 55% at 50% -8%, rgba(255,255,255,.085), rgba(255,255,255,0) 62%),
    radial-gradient(45% 40% at 88% 108%, rgba(255,255,255,.05), rgba(255,255,255,0) 60%),
    radial-gradient(38% 34% at 8% 92%, rgba(255,255,255,.035), rgba(255,255,255,0) 60%),
    radial-gradient(120% 100% at 50% 50%, rgba(0,0,0,0) 30%, rgba(0,0,0,.55) 78%, rgba(0,0,0,.85) 100%);
}
/* 2. sehr feines korn (luxus-papier look) */
body::after{
  content:"";position:fixed;inset:0;z-index:1;pointer-events:none;
  opacity:.05;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
  background-size:160px 160px;
}
/* 3. haarlinien-raster + langsamer licht-sweep */
.grain2,.sheen{position:fixed;inset:0;pointer-events:none}
.grain2{
  z-index:2;opacity:.022;
  background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.9) 0 1px,transparent 1px 4px);
}
.sheen{
  z-index:0;opacity:.16;
  background:conic-gradient(from 210deg at 50% 50%,rgba(255,255,255,0) 0deg,rgba(255,255,255,.06) 60deg,rgba(255,255,255,0) 130deg,rgba(255,255,255,0) 360deg);
  animation:sweep 44s linear infinite;
}
@keyframes sweep{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.sheen{animation:none}}`;

// absichtlich leer: nur der hintergrund. inhalt kommt spaeter.
function shell() {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ryuk hub</title><style>' +
    STYLE +
    '</style></head><body><div class="grain2"></div><div class="sheen"></div></body></html>'
  );
}

function formPage() {
  return shell();
}

function resultPage() {
  return shell();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';

    if (url.pathname === '/api/validate') {
      if (request.method !== 'POST') return json({ error: 'post only' }, 405);
      const body = await request.json().catch(() => ({}));
      const hwid = String(body.hwid || '').trim();
      const key = String(body.key || '').trim();
      if (!hwid || !key) return json({ ok: false, reason: 'missing' }, 400);
      const res = await validate(env, key, hwid, body.fp);
      return json(res.body, res.status);
    }

    // claim nur ueber die signierte seite - verhindert automatisierte abfragen
    if (url.pathname === '/api/claim') {
      return json({ error: 'use the key page' }, 403);
    }

    if (url.pathname === '/key') {
      const token = url.searchParams.get('t') || '';
      if (!env.CHECKPOINT_TOKEN || token !== env.CHECKPOINT_TOKEN) {
        return html(shell('<h1>Locked</h1><p class="warn">This page only opens after the checkpoint.</p>'), 403);
      }

      if (request.method === 'GET') {
        const ts = String(Date.now());
        const sig = await pageSig(env, token, ts);
        return html(formPage(token, ts, sig));
      }

      if (request.method === 'POST') {
        const form = await request.formData();
        const ts = String(form.get('ts') || '');
        const sig = String(form.get('sig') || '');
        if (!(await pageSigValid(env, token, ts, sig))) {
          return html(shell('<h1>Expired</h1><p class="warn">This page got too old. Reload it and try again.</p>'), 403);
        }
        const hwid = String(form.get('hwid') || '').trim();
        if (!hwid || hwid.length < 6) {
          const nts = String(Date.now());
          return html(formPage(token, nts, await pageSig(env, token, nts)), 400);
        }
        if (!rateOk(ip)) {
          return html(shell('<h1>Slow down</h1><p class="warn">Too many key requests from your connection. Try again in an hour.</p>'), 429);
        }
        const res = await claim(env, hwid, null);
        return html(resultPage(res), res.status);
      }
    }

    return html(shell('<h1>ryuk hub</h1><p class="dim">Key service is running.</p>'));
  },
};
