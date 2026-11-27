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
body{background:radial-gradient(1200px 620px at 50% -10%,#1b1b26 0%,#0b0b0f 55%);color:#e8e8ee;font:14px/1.6 "Segoe UI",system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:470px;max-width:100%;background:#13131a;border:1px solid #23232e;border-radius:16px;padding:28px;box-shadow:0 24px 70px rgba(0,0,0,.5)}
.brand{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
.brand b{font-size:12px;letter-spacing:.22em;text-transform:uppercase}
.pill{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#0b0b0f;background:#e8e8ee;border-radius:999px;padding:5px 10px;font-weight:700}
h1{font-size:20px;margin:0 0 6px}
p{color:#9a9aab;margin:0 0 16px;font-size:13px}
.steps{list-style:none;padding:0;margin:0 0 20px;display:grid;gap:10px}
.steps li{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:#b9b9c9}
.steps i{flex:0 0 20px;height:20px;border-radius:50%;background:#1f1f2a;border:1px solid #2c2c3a;display:grid;place-items:center;font-size:11px;font-style:normal}
label{display:block;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6f6f80;margin-bottom:6px}
input{width:100%;background:#0b0b0f;border:1px solid #23232e;border-radius:10px;color:#e8e8ee;padding:13px 14px;font:13px ui-monospace,monospace;outline:none}
input:focus{border-color:#4a4a5c}
button{width:100%;background:#e8e8ee;color:#0b0b0f;border:0;border-radius:10px;padding:13px;font-weight:700;cursor:pointer;letter-spacing:.04em;transition:.15s}
button:hover{background:#fff}
.key{font:20px/1.4 ui-monospace,monospace;letter-spacing:.1em;text-align:center;background:#0b0b0f;border:1px dashed #2f2f3c;border-radius:12px;padding:18px 14px;margin:16px 0 12px;user-select:all;word-break:break-all}
.meta{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:#6f6f80;margin-top:16px;border-top:1px solid #1e1e28;padding-top:14px}
.warn{color:#ff8a8a}.ok{color:#8ee08e}
.dim{color:#6f6f80;font-size:12px}
.big{font:700 26px/1.2 ui-monospace,monospace;margin:10px 0 2px}
footer{margin-top:18px;font-size:11px;color:#4f4f60;text-align:center;letter-spacing:.06em}`;

function shell(inner, badge) {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ryuk hub — free key</title><style>' +
    STYLE +
    '</style></head><body><div class="card"><div class="brand"><b>ryuk hub</b><span class="pill">' +
    (badge || 'FREE KEY') +
    '</span></div>' +
    inner +
    '<footer>fight in a school · free key</footer></div></body></html>'
  );
}

function formPage(token, ts, sig) {
  return shell(
    '<h1>Get your free key</h1>' +
      '<p>Finish the checkpoint, then paste the HWID the script shows on start.</p>' +
      '<ul class="steps">' +
      '<li><i>1</i><span>Open the script in your executor and copy the <b>HWID</b> it prints.</span></li>' +
      '<li><i>2</i><span>Paste it below and press <b>Get key</b>.</span></li>' +
      '<li><i>3</i><span>Paste the key into the script. It works for <b>2 hours</b>, then <b>2 hours cooldown</b>.</span></li>' +
      '</ul>' +
      '<form method="POST" action="/key?t=' + encodeURIComponent(token) + '">' +
      '<input type="hidden" name="ts" value="' + ts + '">' +
      '<input type="hidden" name="sig" value="' + sig + '">' +
      '<label for="hwid">Your HWID</label>' +
      '<input id="hwid" name="hwid" placeholder="e.g. A1B2-C3D4-E5F6" required autocomplete="off" spellcheck="false">' +
      '<button type="submit">Get key</button>' +
      '</form>' +
      '<div class="meta"><span>One key per HWID</span><span>Same key every time</span></div>',
  );
}

function resultPage(res) {
  if (res.status === 429) {
    const secs = Math.max(0, Math.floor(res.body.cooldownLeft || 0));
    return shell(
      '<h1>Cooldown active</h1>' +
        '<p>Your last key ran out. Nothing is broken — this is the normal 2 hour break.</p>' +
        '<div class="big" id="timer">' +
        fmt(secs * 1000) +
        '</div>' +
        '<p class="dim">Page refreshes itself when the cooldown ends.</p>' +
        '<script>var s=' +
        secs +
        ';var t=document.getElementById("timer");setInterval(function(){s--;if(s<=0){location.reload();return}var h=Math.floor(s/3600),m=Math.floor(s%3600/60);t.textContent=(h>0?h+"h ":"")+m+"m "+(s%60)+"s"},1000);</script>',
      'COOLDOWN',
    );
  }
  const b = res.body;
  const left = Math.max(0, Math.floor((b.expiresAt - Date.now()) / 1000));
  return shell(
    '<h1>Your key is ready</h1>' +
      '<p>Copy it and paste it into the script. It is bound to your HWID.</p>' +
      '<div class="key" id="key">' +
      b.key +
      '</div>' +
      '<button type="button" id="copy">Copy key</button>' +
      '<div class="meta"><span class="ok" id="timer">expires in ' +
      fmt(left * 1000) +
      '</span><span>' +
      fmt(7200 * 1000) +
      ' session</span></div>' +
      '<p class="dim" style="margin-top:14px">After the 2 hours you wait 2 hours, then come back to this page.</p>' +
      '<script>var s=' +
      left +
      ';var t=document.getElementById("timer");setInterval(function(){s--;if(s<0)return;var h=Math.floor(s/3600),m=Math.floor(s%3600/60);t.textContent="expires in "+(h>0?h+"h ":"")+m+"m "+(s%60)+"s"},1000);' +
      'document.getElementById("copy").onclick=function(){var k=document.getElementById("key").textContent.trim();navigator.clipboard.writeText(k);this.textContent="Copied";var b=this;setTimeout(function(){b.textContent="Copy key"},1500)};</script>',
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
