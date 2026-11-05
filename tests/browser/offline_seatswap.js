// Swapping colours against the computer
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const p=await (await b.newContext({viewport:{width:1100,height:850}})).newPage(); const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+PAGE);await p.waitForTimeout(500);
await p.evaluate(()=>{soundEnabled=false;aiDifficulty='easy';startMatch(3);});
const idle=()=>p.waitForFunction(()=>!isAnimating&&!isRolling&&!aiThinking,null,{timeout:20000});
async function setPos(cur, dice){ await p.evaluate(([cur,dice])=>{ clearTimeout(rollTimeout); clearTimeout(endTurnTimer); gameGen++; openingRoll=false; gameActive=true; isRolling=false; isAnimating=false; aiThinking=false; aiPlan=null;
  state.board=Array.from({length:24},()=>[]); state.bar={w:[],r:[]}; state.off={w:[],r:[]}; let n=0,m=0;
  for(let k=0;k<7;k++) state.board[k%6].push('c_w_'+(n++)); for(;n<15;n++) state.off.w.push('c_w_'+n);
  for(let k=0;k<7;k++) state.board[18+k%6].push('c_r_'+(m++)); for(;m<15;m++) state.off.r.push('c_r_'+m);
  currentPlayer=cur; diceValues=dice.slice(); rolledThisTurn=dice.length>0; turnHistory=[]; renderCheckers(); updateUI(); if(currentPlayer!==myColor&&dice.length) checkTurnState(); },[cur,dice]); }
await p.evaluate(()=>{ if(myColor!=='w') setMyColor('w'); });
await setPos('w',[4,2]); await p.waitForTimeout(300);
await p.evaluate(()=>setMyColor('r')); await p.waitForTimeout(3500); await idle();
let st=await p.evaluate(()=>({cp:currentPlayer,me:myColor,dice:diceValues.length,status:document.getElementById('status-banner').innerText}));
ok(st.me==='r' && st.cp==='r', 'A: AI (white) played the dice I had left, then it is my (red) turn: '+JSON.stringify(st).slice(0,160));
await p.evaluate(()=>{ if(myColor!=='w') setMyColor('w'); }); await p.waitForTimeout(200);
await setPos('r',[3,1]); await p.waitForFunction(()=>isAnimating,null,{timeout:8000}).catch(()=>{});
const busy = await p.evaluate(()=>isAnimating||aiThinking||isRolling);
await p.evaluate(()=>setMyColor('r')); await p.waitForTimeout(100);
const mid = await p.evaluate(()=>document.getElementById('status-banner').innerText);
await p.waitForTimeout(3000); await idle();
const after = await p.evaluate(()=>({me:myColor,cnt:state.board.flat().length+state.bar.w.length+state.bar.r.length+state.off.w.length+state.off.r.length}));
ok(after.me==='r' && after.cnt===30, `B: swap requested while busy=${busy} ("${mid.slice(0,60)}") applied afterwards, 30 checkers intact`);
await p.evaluate(()=>{ if(myColor!=='w') setMyColor('w'); }); await p.waitForTimeout(300);
await p.evaluate(()=>{ matchScore={w:1,r:0}; updateUI(); });
await p.evaluate(()=>setMyColor('r')); await p.waitForTimeout(300);
const sc=await p.evaluate(()=>({me:myColor,score:matchScore}));
ok(sc.me==='r' && sc.score.r===1 && sc.score.w===0, 'C: my 1 point moved with me: '+JSON.stringify(sc.score));
await setPos('r',[]);
for (let k=0;k<120 && await p.evaluate(()=>gameActive);k++){ await p.waitForTimeout(600); await p.evaluate(()=>{ if(gameActive&&currentPlayer===myColor&&!isAnimating&&!isRolling&&diceValues.length===0&&!document.getElementById('roll-btn').disabled){handleRollDice();} else if(gameActive&&currentPlayer===myColor&&!isAnimating&&!isRolling&&diceValues.length>0){const ms=getAllMoves(myColor,diceValues); if(ms.length){const m=ms[0]; executeMove(m.from,m.target,m.diceUsed);} } }); }
const end=await p.evaluate(()=>({active:gameActive,off:[state.off.w.length,state.off.r.length],score:matchScore,status:document.getElementById('status-banner').innerText}));
ok(!end.active, 'D: game finished after swapping sides: '+JSON.stringify(end).slice(0,230));
await p.evaluate(()=>{ enterStartScreen(); setMyColor('w'); }); await p.waitForTimeout(200);
const e2=await p.evaluate(()=>({me:myColor,matchActive,start:!document.getElementById('start-match-btn').classList.contains('hidden')}));
ok(e2.me==='w' && !e2.matchActive && e2.start, 'E: start-screen switch still works');
await p.evaluate(()=>{ startMatch(3); }); await idle(); await p.evaluate(()=>setMyColor("r")); await p.waitForTimeout(500);
const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('bg_ai_match')||'null'));
ok(saved && saved.myColor==='r', 'F: save file holds the new colour: '+(saved&&saved.myColor));
ok(errs.length===0,'no page errors '+errs.join('|'));
console.log(fails?'FAILED '+fails:'ALL OK'); await b.close()})();
