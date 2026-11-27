// ryuk hub - get-script page
// work.ink checkpoint -> this page -> loadstring code
// no keys, no database, no login: the checkpoint is the gate.

const LOADER = 'https://raw.githubusercontent.com/Ryukgs/fias-script/main/loader.lua';
const SNIPPET = 'loadstring(game:HttpGet("' + LOADER + '"))()';
const DISCORD = 'https://discord.gg/';

const STYLE = `*{box-sizing:border-box}
html,body{margin:0;min-height:100vh}
body{background:#050506;color:#f2f2f4;font:15px/1.6 "Inter","Segoe UI",system-ui,sans-serif;
  position:relative;overflow-x:hidden;min-height:100vh;display:flex;flex-direction:column;
  align-items:center;justify-content:center;padding:120px 20px 60px}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(120% 100% at 50% 42%,rgba(0,0,0,0) 28%,rgba(0,0,0,.55) 76%,rgba(0,0,0,.9) 100%)}
.glow{position:fixed;z-index:0;pointer-events:none;border-radius:50%;will-change:transform}
.glow.a{width:78vmax;height:56vmax;top:-26vmax;left:50%;margin-left:-39vmax;
  background:radial-gradient(closest-side,rgba(255,255,255,.11),rgba(255,255,255,.03) 55%,rgba(255,255,255,0) 72%);
  animation:driftA 34s ease-in-out infinite alternate}
.glow.b{width:58vmax;height:48vmax;right:-20vmax;bottom:-20vmax;
  background:radial-gradient(closest-side,rgba(255,255,255,.07),rgba(255,255,255,0) 70%);
  animation:driftB 47s ease-in-out infinite alternate}
@keyframes driftA{from{transform:translate3d(-2%,-1%,0) scale(1)}to{transform:translate3d(3%,2%,0) scale(1.1)}}
@keyframes driftB{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(-5%,-4%,0) scale(1.12)}}
.grain{position:fixed;inset:0;z-index:1;pointer-events:none;opacity:.035;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E');
  background-size:160px 160px}
.brand{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;margin-bottom:34px}
.brand-row{display:flex;align-items:center;gap:clamp(14px,2.2vw,26px)}
.rule{height:1px;width:clamp(34px,7vw,96px);
  background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.45))}
.rule.r{background:linear-gradient(270deg,rgba(255,255,255,0),rgba(255,255,255,.45))}
h1{margin:0;font-family:"Didot","Bodoni MT","Times New Roman",Georgia,serif;font-weight:400;
  font-size:clamp(20px,2.6vw,32px);line-height:1;letter-spacing:.34em;text-indent:.34em;
  text-transform:uppercase;background:linear-gradient(180deg,#ffffff 0%,#e6e6ec 42%,#9a9aa8 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}
.sub{margin-top:12px;font-size:10px;letter-spacing:.52em;text-indent:.52em;text-transform:uppercase;color:#6d6d7c}
.card{position:relative;z-index:2;width:min(520px,94vw);background:rgba(12,12,15,.6);
  border:1px solid rgba(255,255,255,.10);border-radius:18px;padding:28px 26px 24px;
  box-shadow:0 30px 90px rgba(0,0,0,.6);backdrop-filter:blur(4px);
  animation:in .7s cubic-bezier(.2,.8,.2,1) both}
@keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.step{display:flex;gap:14px;align-items:flex-start}
.step + .step{margin-top:16px}
.num{flex:0 0 22px;height:22px;border-radius:50%;border:1px solid rgba(255,255,255,.14);
  display:grid;place-items:center;font:500 11px/1 ui-monospace,monospace;color:#9a9aab;margin-top:2px}
.k{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#6c6c7d;margin-bottom:4px}
.v{font-size:13px;color:#cfcfda}
.code{margin-top:18px;position:relative;background:rgba(255,255,255,.03);
  border:1px solid rgba(255,255,255,.10);border-radius:13px;padding:16px 15px;
  font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8e8f0;
  word-break:break-all;user-select:all;white-space:pre-wrap}
.copy{margin-top:12px;width:100%;padding:14px 18px;border-radius:999px;cursor:pointer;
  border:1px solid rgba(255,255,255,.16);
  background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.015));
  color:#f4f4f7;font:500 11px/1 "Inter","Segoe UI",system-ui,sans-serif;
  letter-spacing:.26em;text-transform:uppercase;text-indent:.26em;
  transition:border-color .3s ease,box-shadow .4s ease,background .3s ease}
.copy:hover{border-color:rgba(255,255,255,.38);background:linear-gradient(180deg,rgba(255,255,255,.1),rgba(255,255,255,.025));
  box-shadow:0 10px 40px rgba(255,255,255,.07)}
.copy:active{transform:scale(.985)}
.copy.done{border-color:rgba(127,217,160,.55);color:#7fd9a0}
.note{margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.07);
  font-size:11.5px;line-height:1.7;color:#66667a}
.note b{color:#9a9aab;font-weight:500}
@media (prefers-reduced-motion:reduce){.glow{animation:none}.card{animation:none}}`;

const BG = '<div class="glow a"></div><div class="glow b"></div><div class="grain"></div>';

const JS = `(function(){
  var btn=document.querySelector('.copy');
  var code=document.querySelector('.code');
  if(!btn||!code) return;
  function flash(){
    btn.classList.add('done');
    btn.textContent='copied';
    setTimeout(function(){btn.classList.remove('done');btn.textContent='copy code';},1600);
  }
  function fallback(){
    var r=document.createRange();r.selectNodeContents(code);
    var s=window.getSelection();s.removeAllRanges();s.addRange(r);
    try{document.execCommand('copy');flash();}catch(e){}
  }
  btn.addEventListener('click',function(){
    var text=code.textContent;
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(flash).catch(fallback);
    } else fallback();
  });
})();`;

function page(inner, status) {
  const body =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>ryuk hub — get script</title><style>' + STYLE + '</style></head><body>' + BG +
    '<header class="brand"><div class="brand-row"><span class="rule"></span><h1>Ryuk Hub</h1>' +
    '<span class="rule r"></span></div><div class="sub">fight in a school</div></header>' +
    inner + '<script>' + JS + '</script></body></html>';
  return new Response(body, {
    status: status || 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request) {
    const card =
      '<div class="card">' +
      '<div class="step"><span class="num">1</span><div><div class="k">copy the code</div>' +
      '<div class="v">everything in the box below</div></div></div>' +
      '<div class="step"><span class="num">2</span><div><div class="k">paste it into your executor</div>' +
      '<div class="v">works with any executor that supports loadstring + HttpGet</div></div></div>' +
      '<div class="step"><span class="num">3</span><div><div class="k">execute</div>' +
      '<div class="v">the menu opens - RightShift toggles it</div></div></div>' +
      '<div class="code" id="code">' + SNIPPET.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>' +
      '<button class="copy" type="button">copy code</button>' +
      '<div class="note"><b>no key, no hwid, no waiting.</b> the loader always pulls the latest version, ' +
      'so updates need no reinstall. news and updates are posted on the Discord server.</div>' +
      '</div>';

    return page(card);
  },
};
