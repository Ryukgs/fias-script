// ryuk hub - get-script page
// work.ink checkpoint -> this page -> loadstring code
// keep it minimal: brand, code, copy.

const LOADER = 'https://raw.githubusercontent.com/Ryukgs/fias-script/main/loader.lua';
const SNIPPET = 'loadstring(game:HttpGet("' + LOADER + '"))()';

const STYLE = `*{box-sizing:border-box}
html,body{margin:0;min-height:100vh}
body{background:#050506;color:#f2f2f4;font:15px/1.6 "Inter","Segoe UI",system-ui,sans-serif;
  position:relative;overflow-x:hidden;min-height:100vh;display:flex;flex-direction:column;
  align-items:center;justify-content:center;padding:100px 20px 60px}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(120% 100% at 50% 42%,rgba(0,0,0,0) 28%,rgba(0,0,0,.55) 76%,rgba(0,0,0,.9) 100%)}
.glow{position:fixed;z-index:0;pointer-events:none;border-radius:50%}
.glow.a{width:78vmax;height:56vmax;top:-26vmax;left:50%;margin-left:-39vmax;
  background:radial-gradient(closest-side,rgba(255,255,255,.11),rgba(255,255,255,.03) 55%,rgba(255,255,255,0) 72%)}
.glow.b{width:58vmax;height:48vmax;right:-20vmax;bottom:-20vmax;
  background:radial-gradient(closest-side,rgba(255,255,255,.07),rgba(255,255,255,0) 70%)}
.brand{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;margin-bottom:30px}
.brand-row{display:flex;align-items:center;gap:clamp(14px,2.2vw,26px)}
.rule{height:1px;width:clamp(34px,7vw,96px);
  background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.45))}
.rule.r{background:linear-gradient(270deg,rgba(255,255,255,0),rgba(255,255,255,.45))}
h1{margin:0;font-family:"Didot","Bodoni MT","Times New Roman",Georgia,serif;font-weight:400;
  font-size:clamp(20px,2.6vw,32px);line-height:1;letter-spacing:.34em;text-indent:.34em;
  text-transform:uppercase;background:linear-gradient(180deg,#ffffff 0%,#e6e6ec 42%,#9a9aa8 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}
.sub{margin-top:12px;font-size:10px;letter-spacing:.52em;text-indent:.52em;text-transform:uppercase;color:#6d6d7c}
.card{position:relative;z-index:2;width:min(540px,94vw);background:rgba(12,12,15,.6);
  border:1px solid rgba(255,255,255,.10);border-radius:16px;padding:18px;
  box-shadow:0 30px 90px rgba(0,0,0,.6)}
.code{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.10);border-radius:11px;
  padding:16px 15px;font:12.5px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8e8f0;
  word-break:break-all;user-select:all;white-space:pre-wrap}
.copy{margin-top:12px;width:100%;padding:13px 18px;border-radius:999px;cursor:pointer;
  border:1px solid rgba(255,255,255,.16);
  background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.015));
  color:#f4f4f7;font:500 11px/1 "Inter","Segoe UI",system-ui,sans-serif;
  letter-spacing:.26em;text-transform:uppercase;text-indent:.26em;
  transition:border-color .3s ease,background .3s ease}
.copy:hover{border-color:rgba(255,255,255,.38);background:linear-gradient(180deg,rgba(255,255,255,.1),rgba(255,255,255,.025))}
.copy:active{transform:scale(.985)}
.copy.done{border-color:rgba(127,217,160,.55);color:#7fd9a0}`;

const JS = `(function(){
  var btn=document.querySelector('.copy'), code=document.querySelector('.code');
  if(!btn||!code) return;
  function flash(){btn.classList.add('done');btn.textContent='copied';
    setTimeout(function(){btn.classList.remove('done');btn.textContent='copy';},1500);}
  function fallback(){var r=document.createRange();r.selectNodeContents(code);
    var s=window.getSelection();s.removeAllRanges();s.addRange(r);
    try{document.execCommand('copy');flash();}catch(e){}}
  btn.addEventListener('click',function(){
    var text=code.textContent;
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(flash).catch(fallback);
    } else fallback();
  });
})();`;

const html =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>ryuk hub</title><style>' + STYLE + '</style></head><body>' +
  '<div class="glow a"></div><div class="glow b"></div>' +
  '<header class="brand"><div class="brand-row"><span class="rule"></span><h1>Ryuk Hub</h1>' +
  '<span class="rule r"></span></div><div class="sub">fight in a school</div></header>' +
  '<div class="card"><div class="code">' + SNIPPET.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>' +
  '<button class="copy" type="button">copy</button></div>' +
  '<script>' + JS + '</script></body></html>';

export default {
  async fetch() {
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
};
