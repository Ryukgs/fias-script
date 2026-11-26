// ryuk hub - free key service
//  GET  /key?t=TOKEN              -> Seite: HWID eintragen, Key holen
//  POST /key?t=TOKEN              -> Key anzeigen (claim)
//  POST /api/claim    {hwid}      -> { key, expiresAt, cooldownUntil }
//  POST /api/validate {key, hwid} -> { ok, expiresIn } | { ok:false, reason, cooldownLeft }
//
// Regel: Session 2h, danach 2h Cooldown ab Ablauf. Key ist pro HWID immer gleich.

const SESSION_MS = 2 * 60 * 60 * 1000;
const COOLDOWN_MS = 2 * 60 * 60 * 1000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

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

async function keyFor(secret, hwid) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode('ryuk-free:' + hwid));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return 'RYUK-' + hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16);
}

async function ensureSchema(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS sessions (hwid TEXT PRIMARY KEY, key TEXT NOT NULL, expires_at INTEGER NOT NULL, cooldown_until INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
    )
    .run();
}

async function readRow(db, hwid) {
  return await db.prepare('SELECT * FROM sessions WHERE hwid = ?1').bind(hwid).first();
}

async function claim(env, hwid) {
  const now = Date.now();
  await ensureSchema(env.DB);
  const row = await readRow(env.DB, hwid);
  const key = await keyFor(env.KEY_SECRET, hwid);

  if (row) {
    if (now < row.expires_at) {
      return { status: 200, body: { key, expiresAt: row.expires_at, cooldownUntil: row.cooldown_until, active: true } };
    }
    if (now < row.cooldown_until) {
      return { status: 429, body: { cooldownLeft: Math.ceil((row.cooldown_until - now) / 1000) } };
    }
  }

  const expiresAt = now + SESSION_MS;
  const cooldownUntil = expiresAt + COOLDOWN_MS;
  await env.DB.prepare(
    'INSERT INTO sessions (hwid, key, expires_at, cooldown_until, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(hwid) DO UPDATE SET key=?2, expires_at=?3, cooldown_until=?4, updated_at=?5',
  )
    .bind(hwid, key, expiresAt, cooldownUntil, now)
    .run();
  return { status: 200, body: { key, expiresAt, cooldownUntil, active: true } };
}

async function validate(env, key, hwid) {
  const now = Date.now();
  await ensureSchema(env.DB);
  const expected = await keyFor(env.KEY_SECRET, hwid);
  if (String(key || '').toUpperCase() !== expected) return { status: 200, body: { ok: false, reason: 'wrong_key' } };

  const row = await readRow(env.DB, hwid);
  if (!row || row.key !== expected) return { status: 200, body: { ok: false, reason: 'not_claimed' } };
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

const STYLE = `body{background:#0b0b0f;color:#e8e8ee;font:14px/1.5 "Segoe UI",system-ui;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{background:#13131a;border:1px solid #23232e;border-radius:10px;padding:26px;width:420px;max-width:92vw}
h1{font-size:15px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 6px}
p{color:#9a9aab;margin:0 0 16px;font-size:13px}
input{width:100%;box-sizing:border-box;background:#0b0b0f;border:1px solid #23232e;border-radius:6px;color:#e8e8ee;padding:11px;font:13px monospace;margin-bottom:12px}
button{width:100%;background:#e8e8ee;color:#0b0b0f;border:0;border-radius:6px;padding:12px;font-weight:700;cursor:pointer;letter-spacing:.06em}
.key{font:19px/1.4 monospace;letter-spacing:.08em;text-align:center;background:#0b0b0f;border:1px dashed #2f2f3c;border-radius:8px;padding:16px;margin:14px 0;user-select:all}
.warn{color:#ff8a8a}.ok{color:#8ee08e}.dim{color:#6f6f80;font-size:12px}`;

function shell(inner) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ryuk hub - key</title><style>' +
    STYLE +
    '</style></head><body><div class="card">' +
    inner +
    '</div></body></html>';
}

function formPage(token, hwid) {
  const filled = hwid ? String(hwid).replace(/"/g, '&quot;') : '';
  return shell(
    '<h1>Get free key</h1>' +
      '<p>Paste your HWID - the script shows it on start. The key works for 2 hours, then 2 hours cooldown.</p>' +
      '<form method="POST" action="/key?t=' + encodeURIComponent(token) + '">' +
      '<input name="hwid" placeholder="HWID" value="' + filled + '" required autocomplete="off" spellcheck="false">' +
      '<button type="submit">Get key</button>' +
      '</form>' +
      '<p class="dim" style="margin-top:14px">The same key always comes back - it is tied to your HWID.</p>',
  );
}

function resultPage(res) {
  if (res.status === 429) {
    return shell(
      '<h1>Cooldown</h1>' +
        '<p class="warn">Your last key ran out. You can get a new one in <b>' +
        fmt(res.body.cooldownLeft * 1000) +
        '</b>.</p>' +
        '<p class="dim">Come back after that and reload this page.</p>',
    );
  }
  const b = res.body;
  const exp = new Date(b.expiresAt);
  return shell(
    '<h1>Your key</h1>' +
      '<div class="key">' + b.key + '</div>' +
      '<p class="ok">Valid until ' + exp.toUTCString() + '</p>' +
      '<p class="dim">Paste it into the script. When it runs out, you have to wait 2 hours before the next one.</p>',
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/api/claim') {
      if (request.method !== 'POST') return json({ error: 'post only' }, 405);
      const body = await request.json().catch(() => ({}));
      const hwid = String(body.hwid || '').trim();
      if (!hwid) return json({ error: 'hwid missing' }, 400);
      const res = await claim(env, hwid);
      return json(res.body, res.status);
    }

    if (url.pathname === '/api/validate') {
      if (request.method !== 'POST') return json({ error: 'post only' }, 405);
      const body = await request.json().catch(() => ({}));
      const hwid = String(body.hwid || '').trim();
      const key = String(body.key || '').trim();
      if (!hwid || !key) return json({ ok: false, reason: 'missing' }, 400);
      const res = await validate(env, key, hwid);
      return json(res.body, res.status);
    }

    if (url.pathname === '/key') {
      const token = url.searchParams.get('t') || '';
      if (!env.CHECKPOINT_TOKEN || token !== env.CHECKPOINT_TOKEN) {
        return html(shell('<h1>Locked</h1><p class="warn">This page only opens after the checkpoint.</p>'), 403);
      }
      if (request.method === 'GET') return html(formPage(token, url.searchParams.get('hwid') || ''));
      if (request.method === 'POST') {
        const form = await request.formData();
        const hwid = String(form.get('hwid') || '').trim();
        if (!hwid) return html(formPage(token, hwid), 400);
        const res = await claim(env, hwid);
        return html(resultPage(res), res.status);
      }
    }

    return html(shell('<h1>ryuk hub</h1><p class="dim">Key service is running.</p>'));
  },
};
