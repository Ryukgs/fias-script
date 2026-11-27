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
  position:relative;overflow-x:hidden;min-height:100vh;
}
/* vignette + grundlicht */
body::before{
  content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(120% 100% at 50% 50%, rgba(0,0,0,0) 28%, rgba(0,0,0,.55) 76%, rgba(0,0,0,.88) 100%);
}
/* korn */
body::after{
  content:"";position:fixed;inset:-20px;z-index:4;pointer-events:none;
  opacity:.05;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
  background-size:160px 160px;
  animation:grainShift 7s steps(6) infinite;
}
@keyframes grainShift{
  0%{transform:translate3d(0,0,0)}20%{transform:translate3d(-6px,4px,0)}40%{transform:translate3d(4px,-6px,0)}
  60%{transform:translate3d(-3px,-4px,0)}80%{transform:translate3d(6px,3px,0)}100%{transform:translate3d(0,0,0)}
}
/* bewegte lichter */
.glow{position:fixed;z-index:0;pointer-events:none;border-radius:50%;mix-blend-mode:screen;will-change:transform}
.glow.a{width:78vmax;height:56vmax;top:-26vmax;left:50%;margin-left:-39vmax;
  background:radial-gradient(closest-side,rgba(255,255,255,.11),rgba(255,255,255,.03) 55%,rgba(255,255,255,0) 72%);
  animation:driftA 34s ease-in-out infinite alternate}
.glow.b{width:58vmax;height:48vmax;right:-20vmax;bottom:-20vmax;
  background:radial-gradient(closest-side,rgba(255,255,255,.075),rgba(255,255,255,0) 70%);
  animation:driftB 47s ease-in-out infinite alternate}
.glow.c{width:46vmax;height:40vmax;left:-16vmax;bottom:-16vmax;
  background:radial-gradient(closest-side,rgba(255,255,255,.055),rgba(255,255,255,0) 70%);
  animation:driftC 58s ease-in-out infinite alternate}
@keyframes driftA{from{transform:translate3d(-2%,-1%,0) scale(1)}to{transform:translate3d(3%,2%,0) scale(1.1)}}
@keyframes driftB{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(-5%,-4%,0) scale(1.12)}}
@keyframes driftC{from{transform:translate3d(0,0,0) scale(1.05)}to{transform:translate3d(4%,-3%,0) scale(1)}}
/* staub / funken */
.dust{position:fixed;inset:-15%;z-index:1;pointer-events:none;opacity:.55;
  background-image:radial-gradient(1.2px 1.2px at 12% 22%,rgba(255,255,255,.5),transparent 60%),radial-gradient(1px 1px at 72% 14%,rgba(255,255,255,.35),transparent 60%),radial-gradient(1.4px 1.4px at 38% 68%,rgba(255,255,255,.42),transparent 60%),radial-gradient(1px 1px at 84% 52%,rgba(255,255,255,.3),transparent 60%),radial-gradient(1.1px 1.1px at 58% 88%,rgba(255,255,255,.38),transparent 60%),radial-gradient(1px 1px at 24% 46%,rgba(255,255,255,.26),transparent 60%);
  background-size:520px 520px;
  animation:dustDrift 110s linear infinite, dustFade 19s ease-in-out infinite alternate}
@keyframes dustDrift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-110px,70px,0)}}
@keyframes dustFade{from{opacity:.32}to{opacity:.62}}
/* haarlinien */
.grain2{position:fixed;inset:0;z-index:2;pointer-events:none;opacity:.02;
  background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.9) 0 1px,transparent 1px 4px);
  animation:linesPan 60s linear infinite}
@keyframes linesPan{to{background-position:0 400px}}
/* langsamer licht-sweep */
.sheen{position:fixed;inset:-30%;z-index:0;pointer-events:none;opacity:.18;
  background:conic-gradient(from 210deg at 50% 50%,rgba(255,255,255,0) 0deg,rgba(255,255,255,.07) 55deg,rgba(255,255,255,0) 125deg,rgba(255,255,255,0) 360deg);
  animation:sweep 52s linear infinite}
@keyframes sweep{to{transform:rotate(360deg)}}
/* ---------------- kopf / brand ---------------- */
.brand{
  position:fixed;top:0;left:0;right:0;z-index:5;
  display:flex;flex-direction:column;align-items:center;
  padding:clamp(26px,5vh,52px) 20px 0;
  pointer-events:none;
}
.brand-row{display:flex;align-items:center;gap:clamp(14px,2.2vw,26px)}
.rule{
  height:1px;width:clamp(34px,7vw,96px);
  background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.45));
}
.rule.r{background:linear-gradient(270deg,rgba(255,255,255,0),rgba(255,255,255,.45))}
.brand h1{
  margin:0;
  font-family:"Didot","Bodoni MT","Times New Roman",Georgia,serif;
  font-weight:400;
  font-size:clamp(19px,2.5vw,30px);
  line-height:1;
  letter-spacing:.34em;
  text-indent:.34em;
  text-transform:uppercase;
  background:linear-gradient(180deg,#ffffff 0%,#e6e6ec 42%,#9a9aa8 100%);
  -webkit-background-clip:text;background-clip:text;
  color:transparent;
  white-space:nowrap;
}
.brand .sub{
  margin-top:clamp(10px,1.6vh,16px);
  font-size:clamp(8px,.9vw,10px);
  letter-spacing:.52em;text-indent:.52em;text-transform:uppercase;
  color:#6d6d7c;
}
@media (prefers-reduced-motion:reduce){
  .glow,.dust,.grain2,.sheen{animation:none}
  body::after{animation:none}
}`;

// nur hintergrund - inhalt kommt spaeter
const BG = '<div class="glow a"></div><div class="glow b"></div><div class="glow c"></div>' +
  '<div class="dust"></div><div class="grain2"></div><div class="sheen"></div>' +
  '<header class="brand"><div class="brand-row"><span class="rule"></span><h1>Ryuk Hub</h1><span class="rule r"></span></div>' +
  '<div class="sub">fight in a school</div></header>';

function shell() {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ryuk hub</title><style>' +
    STYLE +
    '</style></head><body>' + BG + '</body></html>'
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
