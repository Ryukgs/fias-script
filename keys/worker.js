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
body{background:#050506;color:#f2f2f4;font:15px/1.6 "Inter","Segoe UI",system-ui,sans-serif;
  position:relative;overflow-x:hidden;min-height:100vh}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(120% 100% at 50% 50%,rgba(0,0,0,0) 28%,rgba(0,0,0,.55) 76%,rgba(0,0,0,.88) 100%)}
body::after{content:"";position:fixed;inset:-20px;z-index:4;pointer-events:none;opacity:.045;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");background-size:160px 160px}
.glow{position:fixed;z-index:0;pointer-events:none;border-radius:50%;will-change:transform}
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
.dust{position:fixed;inset:-15%;z-index:1;pointer-events:none;opacity:.5;
  background-image:radial-gradient(1.2px 1.2px at 12% 22%,rgba(255,255,255,.5),transparent 60%),radial-gradient(1px 1px at 72% 14%,rgba(255,255,255,.35),transparent 60%),radial-gradient(1.4px 1.4px at 38% 68%,rgba(255,255,255,.42),transparent 60%),radial-gradient(1px 1px at 84% 52%,rgba(255,255,255,.3),transparent 60%),radial-gradient(1.1px 1.1px at 58% 88%,rgba(255,255,255,.38),transparent 60%),radial-gradient(1px 1px at 24% 46%,rgba(255,255,255,.26),transparent 60%);background-size:520px 520px;
  animation:dustDrift 110s linear infinite}
@keyframes dustDrift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-110px,70px,0)}}
.grain2{position:fixed;inset:0;z-index:2;pointer-events:none;opacity:.02;
  background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.9) 0 1px,transparent 1px 4px)}
.sheen{position:fixed;inset:-30%;z-index:0;pointer-events:none;opacity:.16;will-change:transform;
  background:conic-gradient(from 210deg at 50% 50%,rgba(255,255,255,0) 0deg,rgba(255,255,255,.07) 55deg,rgba(255,255,255,0) 125deg,rgba(255,255,255,0) 360deg);
  animation:sweep 72s linear infinite}
@keyframes sweep{to{transform:rotate(360deg)}}
.brand{position:fixed;top:0;left:0;right:0;z-index:5;display:flex;flex-direction:column;align-items:center;
  padding:clamp(26px,5vh,52px) 20px 0;pointer-events:none;perspective:900px}
.brand-row{display:flex;align-items:center;gap:clamp(14px,2.2vw,26px);
  transform:rotateX(calc(var(--py,0) * -5deg)) rotateY(calc(var(--px,0) * 5deg))
    translate3d(calc(var(--px,0) * 7px),calc(var(--py,0) * 5px),0);
  transition:transform .45s cubic-bezier(.2,.8,.2,1);transform-style:preserve-3d}
.rule{height:1px;width:clamp(34px,7vw,96px);
  background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.45))}
.rule.r{background:linear-gradient(270deg,rgba(255,255,255,0),rgba(255,255,255,.45))}
.brand h1{margin:0;font-family:"Didot","Bodoni MT","Times New Roman",Georgia,serif;font-weight:400;
  font-size:clamp(19px,2.5vw,30px);line-height:1;letter-spacing:.34em;text-indent:.34em;text-transform:uppercase;
  background:linear-gradient(180deg,#ffffff 0%,#e6e6ec 42%,#9a9aa8 100%);
  background-size:140% 240%;
  background-position:calc(50% + var(--px,0) * 26%) calc(50% + var(--py,0) * 34%);
  -webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap;
  transition:background-position .45s cubic-bezier(.2,.8,.2,1)}
.brand .sub{margin-top:clamp(10px,1.6vh,16px);font-size:clamp(8px,.9vw,10px);
  letter-spacing:.52em;text-indent:.52em;text-transform:uppercase;color:#6d6d7c}
.cursor-dot{position:fixed;top:0;left:0;width:7px;height:7px;border-radius:50%;pointer-events:none;z-index:9;
  background:#fff;box-shadow:0 0 12px 2px rgba(255,255,255,.35);opacity:0;transition:opacity .25s ease;
  transform:translate3d(-100px,-100px,0);will-change:transform}
body.mouse-on .cursor-dot{opacity:.9}
/* ---------------- button ---------------- */
.stage{position:fixed;inset:0;z-index:6;display:grid;place-items:center;pointer-events:none}
.cta{pointer-events:auto;position:relative;overflow:hidden;
  padding:17px 44px 17px 46px;border-radius:999px;
  border:1px solid rgba(255,255,255,.16);
  background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.015));
  color:#f4f4f7;font:500 12px/1 "Inter","Segoe UI",system-ui,sans-serif;
  letter-spacing:.28em;text-transform:uppercase;text-indent:.28em;cursor:pointer;
  will-change:transform;-webkit-tap-highlight-color:transparent;
  transition:transform .35s cubic-bezier(.2,.8,.2,1),border-color .35s ease,box-shadow .45s ease,background .35s ease}
.cta:hover{border-color:rgba(255,255,255,.38);
  background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.025));
  box-shadow:0 0 0 1px rgba(255,255,255,.04),0 10px 40px rgba(255,255,255,.07),0 0 60px rgba(255,255,255,.05)}
.cta:active{transform:scale(.975)}
.cta:focus-visible{outline:none;border-color:rgba(255,255,255,.5);box-shadow:0 0 0 3px rgba(255,255,255,.12)}
.cta::before{content:"";position:absolute;inset:0;
  background:linear-gradient(105deg,rgba(255,255,255,0) 38%,rgba(255,255,255,.38) 50%,rgba(255,255,255,0) 62%);
  transform:translate3d(-130%,0,0);transition:transform .95s cubic-bezier(.22,.7,.25,1);pointer-events:none}
.cta:hover::before{transform:translate3d(130%,0,0)}
.cta::after{content:"";position:absolute;inset:1px;border-radius:inherit;
  border:1px solid rgba(255,255,255,.05);pointer-events:none}
.cta .lbl{position:relative;z-index:1}
/* ---------------- card / formular ---------------- */
.stage{position:fixed;inset:0;z-index:6;display:grid;place-items:center;pointer-events:none;padding:120px 20px 40px}
.card{pointer-events:auto;width:min(420px,92vw);background:rgba(12,12,15,.55);
  border:1px solid rgba(255,255,255,.10);border-radius:18px;padding:30px 28px 26px;
  box-shadow:0 30px 90px rgba(0,0,0,.55);animation:cardIn .7s cubic-bezier(.2,.8,.2,1) both}
@keyframes cardIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.card h2{margin:0 0 8px;font:400 20px/1.3 "Didot","Bodoni MT","Times New Roman",Georgia,serif;letter-spacing:.01em}
.card p{margin:0 0 22px;color:#8b8b9b;font-size:13px;line-height:1.65}
.field label{display:block;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#6c6c7d;margin-bottom:9px}
.field input{width:100%;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.10);
  border-radius:12px;color:#f2f2f4;padding:14px 15px;font:13px ui-monospace,SFMono-Regular,monospace;
  outline:none;transition:border-color .3s ease,box-shadow .3s ease}
.field input::placeholder{color:#4d4d5c}
.field input:focus{border-color:rgba(255,255,255,.34);box-shadow:0 0 0 3px rgba(255,255,255,.05)}
.cta.block{display:block;width:100%;margin-top:14px;padding:16px 20px}
.keybox{font:15px/1.6 ui-monospace,SFMono-Regular,monospace;letter-spacing:.07em;text-align:center;
  background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.18);border-radius:13px;
  padding:18px 14px;word-break:break-all;user-select:all;margin-bottom:14px}
.meta{display:flex;justify-content:space-between;gap:12px;font-size:11.5px;color:#66667a;
  margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.07)}
.ok{color:#7fd9a0}.warn{color:#f08a8a}
.big{font:600 26px/1.3 ui-monospace,SFMono-Regular,monospace;margin:4px 0 10px}
/* ---------------- discord profil unten links ---------------- */
.who{position:fixed;left:22px;bottom:22px;z-index:7;display:flex;align-items:center;gap:12px;
  padding:11px 16px 11px 11px;border-radius:14px;
  background:rgba(12,12,15,.62);border:1px solid rgba(255,255,255,.10);
  box-shadow:0 18px 50px rgba(0,0,0,.5);animation:whoIn .8s cubic-bezier(.2,.8,.2,1) both;
  backdrop-filter:blur(6px);max-width:min(320px,calc(100vw - 44px))}
@keyframes whoIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.who img{width:38px;height:38px;border-radius:50%;object-fit:cover;
  border:1px solid rgba(255,255,255,.14);background:#1a1a22;flex:0 0 38px}
.who .txt{min-width:0}
.who b{display:block;font:500 13px/1.25 "Inter","Segoe UI",system-ui,sans-serif;color:#f2f2f4;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.who span{display:block;font-size:11px;color:#7f7f92;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.who .dotsep{width:3px;height:3px;border-radius:50%;background:#3f3f4d;margin:0 6px;display:inline-block;vertical-align:middle}
@media (max-width:520px){.who{left:14px;right:14px;bottom:14px;max-width:none}}
@media (prefers-reduced-motion:reduce){
  .glow,.dust,.sheen{animation:none}
  .brand-row,.brand h1{transition:none}
}`;

// nur hintergrund - inhalt kommt spaeter
const JS = `
(function(){
  var root=document.documentElement, body=document.body;
  var dot=document.querySelector('.cursor-dot');
  var brandRow=document.querySelector('.brand-row');
  if(!dot) return;

  var R=3.5, shown=false, tiltQueued=false, lastX=0, lastY=0;

  function place(cx, cy){
    dot.style.transform='translate3d('+(cx-R).toFixed(2)+'px,'+(cy-R).toFixed(2)+'px,0)';
    if(!shown){ shown=true; if(body.classList) body.classList.add('mouse-on'); }
  }

  function tilt(){
    tiltQueued=false;
    if(!brandRow) return;
    root.style.setProperty('--px', ((lastX/(window.innerWidth||1))-0.5).toFixed(4));
    root.style.setProperty('--py', ((lastY/(window.innerHeight||1))-0.5).toFixed(4));
  }

  function onRaw(e){
    if(!e) return;
    var cx, cy;
    if(e.touches && e.touches.length){ cx=e.touches[0].clientX; cy=e.touches[0].clientY; }
    else if(typeof e.clientX==='number'){ cx=e.clientX; cy=e.clientY; }
    else return;
    place(cx, cy);
    lastX=cx; lastY=cy;
    if(!tiltQueued){ tiltQueued=true; requestAnimationFrame(tilt); }
  }

  // jeder weg wird einzeln registriert - wenn einer in einem browser fehlt,
  // laufen die anderen trotzdem (edge/safari/feuerfuchs)
  function on(target, type){
    try { if(target && target.addEventListener) target.addEventListener(type, onRaw, {passive:true, capture:true}); } catch(e){}
  }
  on(document,'pointerrawupdate');
  on(document,'pointermove');
  on(window,'pointermove');
  on(document,'mousemove');
  on(window,'mousemove');
  on(document,'pointerover');
  on(document,'mouseover');
  on(document,'pointerenter');
  on(document,'mouseenter');
  on(document,'pointerdown');
  on(document,'touchmove');
  on(document,'touchstart');

  // legacy fallback: ueberschreibt nichts, wirkt aber auch ohne addEventListener
  document.onmousemove = onRaw;
  document.onpointermove = onRaw;

  document.addEventListener('mouseleave', function(){ shown=false; if(body.classList) body.classList.remove('mouse-on'); }, true);

  if(!('ontouchstart' in window)) body.classList.add('mouse-on');
})();

(function(){
  var btn=document.querySelector('.cta');
  if(!btn) return;
  var isBlock = btn.classList.contains('block');
  var tx=0, ty=0, cx=0, cy=0, active=false;
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function loop(){
    cx+=(tx-cx)*0.18; cy+=(ty-cy)*0.18;
    btn.style.transform='translate3d('+cx.toFixed(2)+'px,'+cy.toFixed(2)+'px,0)';
    if(Math.abs(tx-cx)>0.05||Math.abs(ty-cy)>0.05) requestAnimationFrame(loop);
    else { active=false; }
  }

  function magnet(e){
    if(reduce || isBlock) return;
    var r=btn.getBoundingClientRect();
    var dx=e.clientX-(r.left+r.width/2), dy=e.clientY-(r.top+r.height/2);
    var dist=Math.sqrt(dx*dx+dy*dy);
    var radius=Math.max(190, r.width*0.9);
    if(dist<radius){ var pull=1-dist/radius; tx=dx*0.16*pull; ty=dy*0.22*pull; }
    else { tx=0; ty=0; }
    if(!active){ active=true; requestAnimationFrame(loop); }
  }
  document.addEventListener('pointermove', magnet, {passive:true});
  document.addEventListener('mousemove', magnet, {passive:true});

  btn.addEventListener('click', function(ev){
    if(reduce) return;
    var base=btn.style.transform||'translate3d(0,0,0)';
    btn.animate([{transform:base+' scale(1)'},{transform:base+' scale(.955)'},{transform:base+' scale(1)'}],
      {duration:280,easing:'cubic-bezier(.2,.8,.2,1)'});
  });
})();
`;

const BG = '<div class="glow a"></div><div class="glow b"></div><div class="glow c"></div>' +
  '<div class="dust"></div><div class="grain2"></div><div class="sheen"></div>' +
  '<header class="brand"><div class="brand-row"><span class="rule"></span><h1>Ryuk Hub</h1><span class="rule r"></span></div>' +
  '<div class="sub">fight in a school</div></header>';

function shell(inner, tag) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ryuk hub — free key</title><style>' +
    STYLE +
    '</style></head><body>' + BG +
    '<div class="stage">' + (inner || '') + '</div>' +
    '<div class="cursor-dot"></div><script>' + JS + '</script></body></html>'
  );
}

function notice(title, text) {
  return (
    '<div class="card"><h2>' + title + '</h2><p>' + text + '</p>' +
    '<a class="cta block" href="/" style="text-decoration:none;text-align:center"><span class="lbl">Reload</span></a></div>'
  );
}

function formPage(token, ts, sig, profile) {
  return shell(
    '<div class="card">' +
      '<h2>Get your free key</h2>' +
      '<p>Paste the HWID your script shows on start. The key is tied to it - it will not work anywhere else.</p>' +
      '<form method="POST" action="/key?t=' + encodeURIComponent(token) + '">' +
      '<input type="hidden" name="ts" value="' + ts + '">' +
      '<input type="hidden" name="sig" value="' + sig + '">' +
      '<div class="field"><label for="hwid">HWID</label>' +
      '<input id="hwid" name="hwid" placeholder="A1B2-C3D4-E5F6" required autocomplete="off" spellcheck="false"></div>' +
      '<button class="cta block" type="submit"><span class="lbl">Get the key</span></button>' +
      '</form>' +
      '<div class="meta"><span>2h access</span><span>2h cooldown</span><span>1 key per HWID</span></div>' +
      '</div>' + whoWidget(profile),
    'free key',
  );
}

function resultPage(res, profile) {
  if (res.status === 429) {
    const secs = Math.max(0, Math.floor(res.body.cooldownLeft || 0));
    return shell(
      whoWidget(profile) + '<div class="card"><h2>Cooldown</h2>' +
        '<p>Your last key ran out. This is the normal 2 hour break - nothing is broken.</p>' +
        '<div class="big" id="timer">' + fmt(secs * 1000) + '</div>' +
        '<p style="margin:0">This page reloads itself when the cooldown is over.</p></div>' +
        '<script>var s=' + secs + ';var t=document.getElementById("timer");' +
        'setInterval(function(){s--;if(s<=0){location.reload();return}var h=Math.floor(s/3600),m=Math.floor(s%3600/60);' +
        't.textContent=(h>0?h+"h ":"")+m+"m "+(s%60)+"s"},1000);</script>',
      'cooldown',
    );
  }
  const b = res.body;
  const left = Math.max(0, Math.floor((b.expiresAt - Date.now()) / 1000));
  return shell(
    '<div class="card"><h2>Your key</h2>' +
      '<p>Copy it into the script menu. It only works on the HWID you entered.</p>' +
      '<div class="keybox" id="key">' + b.key + '</div>' +
      '<button class="cta block" type="button" id="copy"><span class="lbl">Copy key</span></button>' +
      '<div class="meta"><span class="ok" id="timer">expires in ' + fmt(left * 1000) + '</span><span>2h session</span></div>' +
      '</div>' +
      '<script>var s=' + left + ';var t=document.getElementById("timer");' +
      'setInterval(function(){s--;if(s<0)return;var h=Math.floor(s/3600),m=Math.floor(s%3600/60);' +
      't.textContent="expires in "+(h>0?h+"h ":"")+m+"m "+(s%60)+"s"},1000);' +
      'var btn=document.getElementById("copy");btn.onclick=function(){' +
      'try{navigator.clipboard.writeText(document.getElementById("key").textContent.trim())}catch(e){}' +
      'var l=btn.querySelector(".lbl");l.textContent="Copied";setTimeout(function(){l.textContent="Copy key"},1600)};</script>',
    'your key',
  );
}

// ================= Discord login (optional) =================
// aktiv erst wenn DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET gesetzt sind.
const DISCORD_AUTH_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_ME_URL = 'https://discord.com/api/users/@me';

function oauthReady(env) {
  return Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  const parts = raw.split(';');
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    if (p.slice(0, i).trim() === name) return p.slice(i + 1).trim();
  }
  return null;
}

function cookieHeader(name, value, maxAge) {
  return name + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
}

async function signValue(env, kind, value) {
  return (await hmac(env.KEY_SECRET, kind + ':' + value)).slice(0, 24);
}

async function tokenCookie(env, token) {
  return token + '.' + (await signValue(env, 'rt', token));
}

async function tokenFromCookie(env, request) {
  const raw = readCookie(request, 'rt');
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const token = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  if (sig !== (await signValue(env, 'rt', token))) return null;
  if (env.CHECKPOINT_TOKEN && token !== env.CHECKPOINT_TOKEN) return null;
  return token;
}

async function userFromCookie(env, request) {
  const raw = readCookie(request, 'ru');
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const id = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  if (!/^\d{5,25}$/.test(id)) return null;
  if (sig !== (await signValue(env, 'ru', id))) return null;
  return id;
}

async function ensureProfileSchema(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS profiles (discord_id TEXT PRIMARY KEY, username TEXT, display_name TEXT, avatar TEXT, created_at INTEGER, updated_at INTEGER)',
    )
    .run();
}

async function loadProfile(env, id) {
  try {
    await ensureProfileSchema(env.DB);
    return await env.DB.prepare('SELECT * FROM profiles WHERE discord_id = ?1').bind(id).first();
  } catch (e) {
    return null;
  }
}

async function saveProfile(env, u) {
  try {
    await ensureProfileSchema(env.DB);
    const avatar = u.avatar
      ? 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=80'
      : 'https://cdn.discordapp.com/embed/avatars/' + (Number(u.discriminator || 0) % 5) + '.png';
    const created = u.id ? Number((BigInt(u.id) >> 22n) + 1420070400000n) : Date.now();
    await env.DB.prepare(
      'INSERT INTO profiles (discord_id, username, display_name, avatar, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(discord_id) DO UPDATE SET username=?2, display_name=?3, avatar=?4, created_at=?5, updated_at=?6',
    )
      .bind(u.id, u.username || '', u.global_name || u.username || '', avatar, created, Date.now())
      .run();
    return { discord_id: u.id, username: u.username, display_name: u.global_name || u.username, avatar, created_at: created };
  } catch (e) {
    return null;
  }
}

function whoWidget(profile) {
  if (!profile) return '';
  const joined = profile.created_at ? new Date(profile.created_at) : null;
  const years = joined ? Math.max(0, (Date.now() - joined.getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
  const age = years === null ? '' : years < 1 ? Math.max(1, Math.round(years * 12)) + 'mo on Discord' : Math.floor(years) + 'y on Discord';
  return (
    '<div class="who">' +
    '<img src="' + (profile.avatar || '') + '" alt="">' +
    '<div class="txt"><b>' + escapeHtml(profile.display_name || profile.username || 'user') + '</b>' +
    '<span>@' + escapeHtml(profile.username || 'user') +
    (age ? '<i class="dotsep"></i>' + age : '') +
    '</span></div></div>'
  );
}

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function currentProfile(env, request) {
  if (!oauthReady(env)) return null;
  const id = await userFromCookie(env, request);
  if (!id) return null;
  return await loadProfile(env, id);
}

function redirectTo(path) {
  return new Response(null, { status: 302, headers: { location: path, 'cache-control': 'no-store' } });
}

async function startDiscordAuth(request, env, url) {
  const token = url.searchParams.get('t') || '';
  if (!oauthReady(env) || !env.CHECKPOINT_TOKEN || token !== env.CHECKPOINT_TOKEN) {
    return html(shell(notice('Discord login', 'Login is not available right now. Get your key from the key page in Discord.'), 'locked'), 403);
  }
  const state = String(Date.now());
  const sig = (await hmac(env.KEY_SECRET, 'st:' + token + ':' + state)).slice(0, 24);
  const u = new URL(DISCORD_AUTH_URL);
  u.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'identify');
  u.searchParams.set('redirect_uri', url.origin + '/auth/discord/callback');
  u.searchParams.set('state', state + '.' + sig);
  const headers = new Headers({ location: u.toString(), 'cache-control': 'no-store' });
  headers.append('set-cookie', cookieHeader('rt', await tokenCookie(env, token), 900));
  return new Response(null, { status: 302, headers });
}

async function finishDiscordAuth(request, env, url) {
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const token = await tokenFromCookie(env, request);
  if (!token) return redirectTo('/key?skip=1');
  const back = '/key?t=' + encodeURIComponent(token);
  const fail = back + '&skip=1';
  if (!code || !oauthReady(env)) return redirectTo(fail);

  const dot = state.lastIndexOf('.');
  if (dot > 0) {
    const st = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    const want = (await hmac(env.KEY_SECRET, 'st:' + token + ':' + st)).slice(0, 24);
    if (sig !== want || Math.abs(Date.now() - Number(st)) > 10 * 60 * 1000) return redirectTo(fail);
  } else {
    return redirectTo(fail);
  }

  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: url.origin + '/auth/discord/callback',
  });
  const res = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(() => null);
  if (!res || !res.ok) return redirectTo(fail);
  const tok = await res.json().catch(() => null);
  if (!tok || !tok.access_token) return redirectTo(fail);

  const me = await fetch(DISCORD_ME_URL, { headers: { authorization: 'Bearer ' + tok.access_token } }).catch(() => null);
  if (!me || !me.ok) return redirectTo(fail);
  const u = await me.json().catch(() => null);
  if (!u || !u.id) return redirectTo(fail);

  await saveProfile(env, u);
  const headers = new Headers({ location: back, 'cache-control': 'no-store' });
  headers.append('set-cookie', cookieHeader('ru', u.id + '.' + (await signValue(env, 'ru', u.id)), 30 * 24 * 3600));
  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';

    if (url.pathname === '/auth/discord') return await startDiscordAuth(request, env, url);
    if (url.pathname === '/auth/discord/callback') return await finishDiscordAuth(request, env, url);

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
        return html(shell(notice('Locked', 'This page only opens after the checkpoint. Start again from the key page in Discord.'), 'locked'), 403);
      }

      if (request.method === 'GET') {
        const profile = await currentProfile(env, request);
        if (!profile && oauthReady(env) && url.searchParams.get('skip') !== '1') {
          return await startDiscordAuth(request, env, url);
        }
        const ts = String(Date.now());
        const sig = await pageSig(env, token, ts);
        return html(formPage(token, ts, sig, profile));
      }

      if (request.method === 'POST') {
        const form = await request.formData();
        const ts = String(form.get('ts') || '');
        const sig = String(form.get('sig') || '');
        if (!(await pageSigValid(env, token, ts, sig))) {
          return html(shell(notice('Expired', 'This page got too old. Reload it and try again.'), 'expired'), 403);
        }
        const hwid = String(form.get('hwid') || '').trim();
        if (!hwid || hwid.length < 6) {
          const nts = String(Date.now());
          return html(formPage(token, nts, await pageSig(env, token, nts), await currentProfile(env, request)), 400);
        }
        if (!rateOk(ip)) {
          return html(shell(notice('Slow down', 'Too many key requests from your connection. Try again in an hour.'), 'locked'), 429);
        }
        const profile = await currentProfile(env, request);
        const res = await claim(env, hwid, null);
        return html(resultPage(res, profile), res.status);
      }
    }

    return html(shell(notice('ryuk hub', 'Key service is running. Open the key page from Discord to get your key.'), 'online'));
  },
};
