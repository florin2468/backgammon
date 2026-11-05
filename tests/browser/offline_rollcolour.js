// The Roll Dice button colours (yours, the opponent's, dimmed)
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const p=await (await b.newContext({viewport:{width:1100,height:850}})).newPage(); const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+PAGE);await p.waitForTimeout(500);
const look=()=>p.evaluate(()=>{const t=document.getElementById('roll-btn');const c=getComputedStyle(t);const bg=c.backgroundColor;
  const m=bg.match(/[\d.]+/g).map(Number); const a=m[3]===undefined?1:m[3];
  const kind = t.classList.contains('roll-opp-ready')?'blue-bright':t.classList.contains('roll-opp-done')?'blue-dim':t.className.includes('bg-green-600')?'green-bright':t.className.includes('bg-green-800')?'green-dim':'grey';
  return {kind,bg,dis:t.disabled,pe:c.pointerEvents,cp:currentPlayer,me:myColor}});
await p.evaluate(()=>{soundEnabled=false;aiDifficulty='easy';startMatch(3);}); await p.waitForTimeout(300);
let s=await look(); ok(s.kind==='green-bright'&&!s.dis,'opening roll: mine bright green clickable '+JSON.stringify(s));
// force: I won last game -> I start; then end my turn quickly by playing; simpler: make AI start
await p.evaluate(()=>{ clearTimeout(rollTimeout); gameGen++; isRolling=false; openingRoll=false; gameActive=true; rolledThisTurn=false; diceValues=[]; currentPlayer=oppColor(); updateRollButton(); });
await p.waitForTimeout(400); s=await look(); ok(s.kind==='blue-bright'&&s.dis&&s.pe==='none'&&s.bg==='rgb(14, 165, 233)','AI to roll: bright sky blue, disabled, no pointer events '+JSON.stringify(s));
await p.evaluate(()=>{aiRoll();}); 
const seen=new Set(); for(let i=0;i<40;i++){ await p.waitForTimeout(100); seen.add((await look()).kind); }
console.log('kinds seen during AI roll+move:',[...seen].join(','));
ok(seen.has('blue-dim'),'after the AI has rolled the button is dimmed blue');
// wait for my turn
await p.waitForFunction(()=>currentPlayer===myColor&&!rolledThisTurn&&diceValues.length===0,null,{timeout:30000});
s=await look(); ok(s.kind==='green-bright'&&!s.dis,'my turn: bright green again '+JSON.stringify(s));
await p.evaluate(()=>handleRollDice()); await p.waitForTimeout(300); s=await look(); ok(s.kind==='green-dim','I rolled: dim green (unchanged) '+JSON.stringify(s));
// no game: grey
await p.evaluate(()=>{ gameActive=false; updateRollButton(); }); s=await look(); ok(s.kind!=='blue-bright'&&s.kind!=='blue-dim','game over: no blue '+s.kind);
// playing Red: AI is White
await p.evaluate(()=>{ gameActive=true; setMyColor('r'); clearTimeout(rollTimeout); isRolling=false; rolledThisTurn=false; diceValues=[]; currentPlayer=oppColor(); updateRollButton(); });
s=await look(); ok(s.kind==='blue-bright','playing Red, AI to roll: blue as well '+s.kind);
await p.screenshot({path:require('path').join(OUT,'rollcol_shot.png')});
ok(errs.length===0,'no errors '+errs.join('|'));
console.log(fails?'FAILED '+fails:'ALL OK'); await b.close()})();
