// Point colours stay fixed to the board when you play Red
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const p=await (await b.newContext({viewport:{width:1100,height:850}})).newPage(); const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+PAGE);await p.waitForTimeout(500);
await p.evaluate(()=>{soundEnabled=false;});
// shade of the point under each side's back checkers (their 24-point)
const shades=()=>p.evaluate(()=>{ const shade=i=>/dark/.test(pointElements[i].querySelector('.point-triangle').className)?'dark':'light';
  const back = c => { const i = c==='w'?23:0; return shade(i); };     // white's 24-pt = index 23, red's = index 0 at the start
  return { me: myColor, whiteBack: back('w'), redBack: back('r'), myBackShade: back(myColor) }; });
let s=await shades(); ok(s.me==='w' && s.whiteBack==='light' && s.redBack==='dark', 'White: White\'s back checkers on a light point, Red\'s on a dark point '+JSON.stringify(s));
await p.screenshot({path:OUT+'/pc_white.png'});
await p.evaluate(()=>setMyColor('r')); await p.waitForTimeout(600);
s=await shades(); ok(s.me==='r' && s.redBack==='dark' && s.whiteBack==='light', 'start screen as Red: my red back checkers on a dark point '+JSON.stringify(s));
await p.screenshot({path:OUT+'/pc_red.png'});
// same spots on screen as White's view, but the shades are swapped
const view=()=>p.evaluate(()=>[...document.querySelectorAll('.point-triangle')].map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),/dark/.test(e.className)?'D':'L']}).sort((a,b)=>a[0]-b[0]||a[1]-b[1]));
const vr=await view(); await p.evaluate(()=>setMyColor('w')); await p.waitForTimeout(500); const vw=await view();
ok(vr.length===24 && vr.every((x,i)=>x[0]===vw[i][0]&&x[1]===vw[i][1]&&x[2]!==vw[i][2]), 'Red\'s board is White\'s with every point\'s shade swapped (the board turned over)');
// mid-match switch vs AI: checkers stay put, shades swap, my back checkers end up on my shade
await p.evaluate(()=>{aiDifficulty='easy';startMatch(3);}); await p.waitForTimeout(300);
await p.evaluate(()=>{ clearTimeout(rollTimeout); openingRoll=false; currentPlayer=myColor; diceValues=[]; rolledThisTurn=false; updateUI(); });
const ck=()=>p.evaluate(()=>[...document.querySelectorAll('.checker')].filter(e=>e.getBoundingClientRect().width>0).map(e=>[Math.round(e.getBoundingClientRect().x/3),Math.round(e.getBoundingClientRect().y/3)]).sort().join('|'));
const c0=await ck(), t0=await view();
await p.evaluate(()=>setMyColor('r')); await p.waitForTimeout(1500);
const c1=await ck(), t1=await view(); s=await shades();
ok(c0===c1, 'mid-match switch to Red: every checker stays where it is');
ok(t0.every((x,i)=>x[2]!==t1[i][2]), 'and every point swaps shade');
ok(s.me==='r' && s.myBackShade==='dark', 'so my red back checkers now sit on a dark point '+JSON.stringify(s));
await p.screenshot({path:OUT+'/pc_switch.png'});
ok(errs.length===0,'no errors '+errs.join('|'));
console.log(fails?'FAILED '+fails:'ALL OK'); await b.close()})();
