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
:root{color-scheme:dark}
body{background:#0a0a0d;color:#ededf2;font:15px/1.6 "Inter","Segoe UI",system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;padding:28px}
.card{width:430px;max-width:100%;background:#101015;border:1px solid #1d1d24;border-radius:14px;padding:30px 28px 24px}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px}
.word{font-size:12px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:#c9c9d4}
.tag{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#8f8fa2;border:1px solid #26262f;border-radius:999px;padding:4px 9px}
h1{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:0 0 8px}
p{margin:0 0 22px;color:#8b8b9b;font-size:13.5px}
label{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#6c6c7d;margin-bottom:8px}
input{width:100%;background:#0a0a0d;border:1px solid #22222b;border-radius:9px;color:#ededf2;padding:13px 14px;font:13px ui-monospace,SFMono-Regular,monospace;outline:none;transition:border-color .15s}
input:focus{border-color:#3f3f50}
input::placeholder{color:#4d4d5c}
button{width:100%;margin-top:14px;background:#ededf2;color:#0a0a0d;border:0;border-radius:9px;padding:13px;font-size:13.5px;font-weight:600;letter-spacing:.02em;cursor:pointer;transition:opacity .15s}
button:hover{opacity:.88}
.facts{display:flex;justify-content:space-between;gap:10px;margin-top:22px;padding-top:18px;border-top:1px solid #191920;font-size:11.5px;color:#66667a;letter-spacing:.02em}
.key{font:16px/1.5 ui-monospace,SFMono-Regular,monospace;letter-spacing:.08em;text-align:center;background:#0a0a0d;border:1px solid #22222b;border-radius:10px;padding:18px 14px;margin:0 0 6px;user-select:all;word-break:break-all;color:#ededf2}
.timer{margin-top:16px;padding-top:16px;border-top:1px solid #191920;display:flex;justify-content:space-between;font-size:12px;color:#66667a}
.ok{color:#7fd9a0}.bad{color:#f08a8a}
.big{font:600 26px/1.25 ui-monospace,SFMono-Regular,monospace;color:#ededf2;margin:2px 0 14px;letter-spacing:-.01em}
.note{font-size:11.5px;color:#5c5c6e;margin:16px 0 0}
footer{margin-top:22px;padding-top:16px;border-top:1px solid #191920;text-align:center;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#3f3f4d}`;

function shell(inner, tag) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ryuk hub — free key</title><style>' +
    STYLE +
    '</style></head><body><main class="card"><div class="top"><span class="word">ryuk hub</span><span class="tag">' +
    (tag || 'free key') +
    '</span></div>' +
    inner +
    '<footer>fight in a school</footer></main></body></html>'
  );
}

function formPage(token, ts, sig) {
  return shell(
    '<h1>Get your free key</h1>' +
      '<p>Paste the HWID your script shows on start. The key is tied to it.</p>' +
      '<form method="POST" action="/key?t=' + encodeURIComponent(token) + '">' +
      '<input type="hidden" name="ts" value="' + ts + '">' +
      '<input type="hidden" name="sig" value="' + sig + '">' +
      '<label for="hwid">HWID</label>' +
      '<input id="hwid" name="hwid" placeholder="A1B2-C3D4-E5F6" required autocomplete="off" spellcheck="false">' +
      '<button type="submit">Get key</button>' +
      '</form>' +
      '<div class="facts"><span>2h access</span><span>2h cooldown</span><span>1 key per HWID</span></div>',
  );
}

function resultPage(res) {
  if (res.status === 429) {
    const secs = Math.max(0, Math.floor(res.body.cooldownLeft || 0));
    return shell(
      '<h1>Cooldown</h1>' +
        '<p>Your last key ran out. This is the normal 2 hour break, nothing is broken.</p>' +
        '<div class="big" id="timer">' +
        fmt(secs * 1000) +
        '</div>' +
        '<p class="note">This page reloads itself when the cooldown is over.</p>' +
        '<script>var s=' +
        secs +
        ';var t=document.getElementById("timer");setInterval(function(){s--;if(s<=0){location.reload();return}var h=Math.floor(s/3600),m=Math.floor(s%3600/60);t.textContent=(h>0?h+"h ":"")+m+"m "+(s%60)+"s"},1000);</script>',
      'cooldown',
    );
  }
  const b = res.body;
  const left = Math.max(0, Math.floor((b.expiresAt - Date.now()) / 1000));
  return shell(
    '<h1>Your key</h1>' +
      '<p>Copy it into the script. It only works on the HWID you entered.</p>' +
      '<div class="key" id="key">' +
      b.key +
      '</div>' +
      '<button type="button" id="copy">Copy key</button>' +
      '<div class="timer"><span class="ok" id="timer">expires in ' +
      fmt(left * 1000) +
      '</span><span>2h session</span></div>' +
      '<p class="note">After 2 hours the key ends. Come back here after another 2 hours for the next one.</p>' +
      '<script>var s=' +
      left +
      ';var t=document.getElementById("timer");setInterval(function(){s--;if(s<0)return;var h=Math.floor(s/3600),m=Math.floor(s%3600/60);t.textContent="expires in "+(h>0?h+"h ":"")+m+"m "+(s%60)+"s"},1000);' +
      'document.getElementById("copy").onclick=function(){navigator.clipboard.writeText(document.getElementById("key").textContent.trim());this.textContent="Copied";var b=this;setTimeout(function(){b.textContent="Copy key"},1500)};</script>',
    'your key',
  );
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
