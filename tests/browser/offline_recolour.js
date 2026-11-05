// Switching colour mid-game keeps every checker where it is
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const p=await (await b.newContext({viewport:{width:1100,height:850}})).newPage(); const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+PAGE);await p.waitForTimeout(500);
await p.evaluate(()=>{soundEnabled=false;aiDifficulty='easy';startMatch(5);});
async function finish(winner){ await p.evaluate(w=>{ clearTimeout(rollTimeout); clearTimeout(endTurnTimer); gameGen++; isRolling=false; isAnimating=false; aiThinking=false; openingRoll=false; gameActive=true;
  const l=w==='w'?'r':'w'; state.board=Array.from({length:24},()=>[]); state.bar={w:[],r:[]}; state.off={w:[],r:[]}; for(let i=0;i<15;i++){state.off[w].push('c_'+w+'_'+i);} for(let i=0;i<15;i++){ state.board[w==='w'?20:3].push('c_'+l+'_'+i);} currentPlayer=w; diceValues=[]; renderCheckers(); updateUI(); gameActive=false; handleGameEnd(w); },winner); await p.waitForTimeout(500); }
const info=()=>p.evaluate(()=>({me:myColor,cp:currentPlayer,open:openingRoll,off:[state.off.w.length,state.off.r.length],score:{...matchScore},ga:gameActive,lw:lastWinner,
  winnerShown:document.getElementById('status-banner').innerText.slice(0,80)}));
// 1) I (white) win game 1, switch colour on the result screen, play next game: I start
let me=await p.evaluate(()=>myColor); await finish(me); let s=await info(); console.log(JSON.stringify(s));
await p.evaluate(()=>setMyColor(myColor==='w'?'r':'w')); await p.waitForTimeout(1200); s=await info();
ok(s.me!==me && s.off[s.me==='w'?0:1]===15 && s.off[s.me==='w'?1:0]===0,'after switching on the result screen my 15 borne-off checkers are still mine ('+JSON.stringify(s.off)+', I am '+s.me+')');
ok(s.score[s.me]===2 && s.score[s.me==='w'?'r':'w']===0,'my point stays mine: '+JSON.stringify(s.score));
await p.evaluate(()=>onNextGameClick()); await p.waitForTimeout(500); s=await info();
ok(!s.open && s.cp===s.me,'next game: no opening roll, I (the winner) start: cp '+s.cp+' me '+s.me);
// 2) AI wins game 2, switch, next game: AI starts
me=await p.evaluate(()=>myColor); await finish(me==='w'?'r':'w'); s=await info();
await p.evaluate(()=>setMyColor(myColor==='w'?'r':'w')); await p.waitForTimeout(1200); s=await info();
ok(s.off[s.me==='w'?1:0]===15,'the AI\'s borne-off checkers stayed the AI\'s after the switch '+JSON.stringify(s.off));
await p.evaluate(()=>onNextGameClick()); await p.waitForTimeout(3500); s=await info();
ok(!s.open && s.cp!==undefined,'next game: no opening roll; AI (winner) started: ' + s.winnerShown);
const aiMoved=await p.evaluate(()=>JSON.stringify(state)!==JSON.stringify(E.createInitialState()));
ok(aiMoved,'AI rolled and played the first move of game 3');
// 3) switch during the AI's turn, with the AI having rolled
await p.evaluate(()=>{window.__x=1});
await p.waitForTimeout(2000);
await p.evaluate(()=>setMyColor(myColor==='w'?'r':'w')); await p.waitForTimeout(3500);
const q=await p.evaluate(()=>({tot:state.board.flat().length+state.bar.w.length+state.bar.r.length+state.off.w.length+state.off.r.length,cp:currentPlayer,me:myColor,dice:diceValues.length,st:document.getElementById('status-banner').innerText.slice(0,70)}));
ok(q.tot===30,'30 checkers after a switch during the AI turn; '+JSON.stringify(q));
// 4) reload keeps colour and position
await p.evaluate(()=>persistAIMatch()); const before=await p.evaluate(()=>JSON.stringify({s:state,me:myColor}));
await p.reload(); await p.waitForTimeout(700);
const hasSave=await p.evaluate(()=>!!localStorage.getItem('bg_ai_match')); ok(hasSave,'save exists');
await p.evaluate(()=>{ resumeAIMatch(); }); await p.waitForTimeout(800);
const after=await p.evaluate(()=>JSON.stringify({s:state,me:myColor})); ok(before===after,'reload + continue restores the same position and colour');
ok(errs.length===0,'no errors '+errs.join('|'));
console.log(fails?'FAILED '+fails:'ALL OK'); await b.close()})();
