// Give-up is only offered at the best result the loser can still reach
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const p=await (await b.newContext({viewport:{width:1100,height:850}})).newPage(); const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+PAGE);await p.waitForTimeout(500);
await p.evaluate(()=>{ soundEnabled=false; makeAIMove=function(){}; aiRoll=function(){}; });
const modal=()=>p.evaluate(()=>({open:!document.getElementById('concede-modal').classList.contains('hidden'),text:document.getElementById('concede-text').innerText,pts:document.getElementById('concede-points').innerText,btn:document.getElementById('concede-yes').innerText,flag:!document.getElementById('concede-btn').classList.contains('hidden')}));
// I am White (the loser). The AI (Red) has 2 checkers left on its 1-point: it finishes in its next turn whatever it rolls.
const pos=(stage, meToMove, fresh)=>p.evaluate(([stage,meToMove,fresh])=>{
  if(fresh){ if(matchActive) enterStartScreen(); if(myColor!=='w') setMyColor('w'); startMatch(5); }
  clearTimeout(rollTimeout); clearTimeout(endTurnTimer); gameGen++; openingRoll=false; gameActive=true; isRolling=false; isAnimating=false; aiThinking=false;
  state.board=Array.from({length:24},()=>[]); state.bar={w:[],r:[]}; state.off={w:[],r:[]};
  state.board[23].push('c_r_0','c_r_1'); for(let i=2;i<15;i++) state.off.r.push('c_r_'+i);
  let n=0; const put=(pt,k)=>{ for(let j=0;j<k;j++) state.board[pt].push('c_w_'+(n++)); };
  if(stage==='bg'){ put(19,1); put(10,5); put(9,5); put(8,4); }          // one checker in the AI's home board, the rest far from mine
  if(stage==='home'){ put(5,5); put(4,5); put(3,5); }                     // all home, none borne off
  if(stage==='one'){ state.off.w.push('c_w_14'); n=0; put(5,5); put(4,5); put(3,4); }
  currentPlayer = meToMove ? 'w' : 'r'; diceValues=[]; rolledThisTurn=false; turnHistory=[];
  renderCheckers(); updateUI();
  const i=E.concessionInfo(state,'w',currentPlayer); return i && { points:i.points, offer:i.offer };
},[stage,meToMove,!!fresh]);
let i, m;
// 1) checker stuck in the AI's home board and the AI moves first: the backgammon can't be avoided -> 3
i=await pos('bg',false,true); await p.waitForTimeout(150); m=await modal();
ok(i.offer===3 && m.open && /\(3 points\)/.test(m.btn) && /can't get your checker out/.test(m.text), 'backgammon unavoidable: offered for 3 | "'+m.btn+'"');
// 2) same, but I move first: one die gets the checker out, so the best I can still get is a gammon -> offered for 2
i=await pos('bg',true,true); await p.waitForTimeout(150); m=await modal();
ok(i.points===3 && i.offer===2 && m.open && /\(2 points\)/.test(m.btn) && /could still get out in time, so giving up counts only as a gammon/.test(m.text), 'checker still in the AI\'s home board but could get out: offered for 2 | "'+m.text.slice(-120)+'"');
await p.click('#concede-yes'); await p.waitForTimeout(400);
let r=await p.evaluate(()=>({sc:{...matchScore}, st:document.getElementById('status-banner').innerText}));
ok(r.sc.r===2 && /gave up/.test(r.st) && /a gammon \(\+2 points\)/.test(r.st), 'giving up there scores 2 (a gammon), not 3: "'+r.st+'"');
// 3) all my checkers home, none off, and I move first: I could still bear one off before the AI finishes -> no offer at all
i=await pos('home',true,true); await p.waitForTimeout(150); m=await modal();
ok(i && i.points===2 && i.offer===0 && !m.open && !m.flag, 'lost, but the gammon can still be saved: no popup and no flag button');
// 4) same position, the AI moves first: the gammon can't be saved any more -> offered for 2
i=await pos('home',false,false); await p.waitForTimeout(150); m=await modal();
ok(i.offer===2 && m.open && /\(2 points\)/.test(m.btn) && /can't bear a checker off before/.test(m.text), 'once the gammon can\'t be saved: offered for 2 | "'+m.btn+'"');
await p.evaluate(()=>answerConcede(false));
// 5) a checker borne off: single game -> offered for 1 (cheaper, so asked again)
i=await pos('one',true,false); await p.waitForTimeout(150); m=await modal();
ok(i.offer===1 && m.open && /\(1 point\)/.test(m.btn) && /cheaper now/.test(m.text), 'after bearing off: offered for 1 | "'+m.text.slice(0,60)+'"');
// 6) 1-point match: price capped at 1, text says so
await p.evaluate(()=>{ if(matchActive) enterStartScreen(); startMatch(1); });
i=await pos('bg',false,false); await p.waitForTimeout(150); m=await modal();
ok(m.open && /\(1 point\)/.test(m.btn) && /only needs 1/.test(m.pts), '1-point match: "'+m.pts+'"');
ok(errs.length===0,'no errors '+errs.join('|'));
console.log(fails?'FAILED '+fails:'ALL OK'); await b.close()})();
