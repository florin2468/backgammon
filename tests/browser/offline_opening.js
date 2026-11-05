// The opening roll: the winner plays the dice they rolled
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
const FILE = PAGE;
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const ctx=await b.newContext({viewport:{width:1280,height:900}});
const errs=[];
async function fresh(){ const c2=await b.newContext({viewport:{width:1280,height:900}}); const p=await c2.newPage(); p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.accept());
  await p.goto('file://'+FILE); await p.waitForTimeout(800);
  await p.evaluate(()=>{ try{localStorage.clear();}catch(e){} soundEnabled=false; aiDifficulty='easy'; window.__rolls=0; const pr=playRoll; playRoll=function(){ __rolls++; return pr.apply(this,arguments); }; });
  return p; }
const queue=(p,vals)=>p.evaluate(v=>{ window.__q=(window.__q||[]).concat(v); if(!window.__ri){ window.__ri=randomInt; randomInt=function(n){ return (n===6 && __q.length) ? __q.shift()-1 : __ri(n); }; } },vals);
const start=async(p,mine,theirs)=>{ await queue(p, mine.concat(theirs));
  await p.evaluate(()=>showMatchModal()); await p.waitForTimeout(150); await p.click('#match-modal button:has-text("3")'); await p.waitForTimeout(300);
  await p.click('#roll-btn'); };
const faces=p=>p.evaluate(()=>['die-1','die-2'].map(id=>+(/(\d)$/.exec(document.getElementById(id).getAttribute('aria-label')||'')||[0,0])[1]));
const info=p=>p.evaluate(()=>({cp:currentPlayer, me:myColor, dice:diceValues.slice(), open:openingRoll, rolled:rolledThisTurn, rollDis:document.getElementById('roll-btn').disabled, status:document.getElementById('status-banner').innerText, rolls:(window.__rolls||0), pipMe:calcPIP(myColor), pipOpp:calcPIP(oppColor())}));

// 1) I win the opening with 6-3: I play 6 and 3 straight away
let p=await fresh(); await start(p,[6,3],[4,2]);
await p.waitForFunction(()=>!openingRoll,null,{timeout:15000}); await p.waitForTimeout(200);
let s=await info(p), f=await faces(p);
ok(s.cp===s.me && JSON.stringify(s.dice)==='[6,3]' && s.rolled, 'I won 9 vs 6: my turn with my opening dice '+JSON.stringify(s.dice));
ok(s.rollDis && s.rolls===0, 'no second roll: Roll Dice is off and nothing was rolled');
ok(JSON.stringify(f)==='[6,3]', 'the dice on the table show my 6 and 3');
ok(/You go first and play your 6 and 3/.test(s.status), 'status: "'+s.status+'"');
// play both dice by clicking (first legal move each time)
for(let k=0;k<2;k++){ await p.evaluate(()=>{ const m=getAllMoves(myColor,diceValues)[0]; playChosen(m.from,{target:m.target,diceUsed:m.diceUsed}); }); await p.waitForTimeout(900); }
s=await info(p); ok(s.pipMe===167-9, 'after playing them my pip count is 158 ('+s.pipMe+')');
await p.waitForFunction(()=>currentPlayer!==myColor && rolledThisTurn && diceValues.length>0,null,{timeout:15000}).catch(()=>{});
s=await info(p); ok(s.rolls===1, 'then the computer rolls for its own first turn as usual (rolls so far: '+s.rolls+')');
await p.close();

// 2) The computer wins with double 5s: it plays four 5s without rolling
p=await fresh(); await start(p,[2,1],[5,5]);
await p.waitForFunction(()=>!openingRoll,null,{timeout:15000}); await p.waitForTimeout(150);
s=await info(p); f=await faces(p);
ok(s.cp!==s.me && JSON.stringify(s.dice).startsWith('[5,5,5') && JSON.stringify(f)==='[5,5]', 'computer won with double 5s and has them to play: '+JSON.stringify(s.dice));
ok(/AI goes first and plays its double 5s/.test(s.status), 'status: "'+s.status+'"');
await p.waitForFunction(()=>currentPlayer===myColor && !isAnimating,null,{timeout:20000});
s=await info(p);
ok(s.rolls===0 && s.pipOpp===167-20 && !s.rollDis, 'it played all four 5s (pips 147: '+s.pipOpp+') without rolling; now Roll Dice is mine');
await p.close();

// 3) A tie is rolled again, then the winner plays the second roll
p=await fresh(); await p.evaluate(()=>{ window.__ties=0; });
await start(p,[4,3],[5,2]);           // 7 vs 7: tie
await queue(p,[6,6,3,1]);
await p.waitForFunction(()=>!openingRoll,null,{timeout:20000}); await p.waitForTimeout(150);
s=await info(p); ok(s.cp===s.me && JSON.stringify(s.dice)==='[6,6,6,6]' && s.rolls===0, 'tie 7-7 rolled again; I won with double 6s and play them: '+JSON.stringify(s.dice));

// 4) reload in the middle of that first turn: the saved match resumes with the dice that are left
await p.evaluate(()=>{ const m=getAllMoves(myColor,diceValues)[0]; playChosen(m.from,{target:m.target,diceUsed:m.diceUsed}); }); await p.waitForTimeout(1000);
const before=await p.evaluate(()=>JSON.stringify({s:fastSig(),d:diceValues}));
await p.reload(); await p.waitForTimeout(900);
const vis=await p.isVisible('#ai-resume-modal');
if (vis) await p.click('#ai-resume-modal button:has-text("Continue")');
await p.waitForTimeout(600);
const after=await p.evaluate(()=>JSON.stringify({s:fastSig(),d:diceValues}));
s=await info(p);
ok(vis && before===after && s.cp===s.me && !s.open, 'reloaded mid-turn: same position and the three 6s left ('+after.slice(-14)+')');
await p.close();
ok(errs.length===0,'no page errors '+JSON.stringify(errs.slice(0,3)));
await b.close(); console.log(fails?fails+' FAILED':'ALL PASS'); process.exit(fails?1:0);})();
