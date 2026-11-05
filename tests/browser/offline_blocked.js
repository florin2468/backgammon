// On the bar against a closed board: no roll, a message, the turn passes
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const p=await (await b.newContext({viewport:{width:1100,height:850}})).newPage(); const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+PAGE);await p.waitForTimeout(500);
await p.evaluate(()=>{soundEnabled=false;aiDifficulty='easy';startMatch(3);}); await p.waitForTimeout(300);
// set a position: 'closed' = owner closes the six points at ownerFrom..+5 with 2 checkers each; other player has 1 on the bar
const setup=(owner,closedPts,toMove,rolls)=>p.evaluate(([owner,closedPts,toMove])=>{
  clearTimeout(rollTimeout); clearTimeout(endTurnTimer); gameGen++; isRolling=false; isAnimating=false; aiThinking=false; openingRoll=false; gameActive=true; rolledThisTurn=false; diceValues=[]; turnHistory=[]; selectedSource=null; validTargets=[];
  const o=owner, v=o==='w'?'r':'w';
  state.board=Array.from({length:24},()=>[]); state.bar={w:[],r:[]}; state.off={w:[],r:[]};
  let no=0,nv=0; const mk=(c)=>'c_'+c+'_'+(c===o?no++:nv++);
  for(const i of closedPts){ state.board[i].push(mk(o),mk(o)); }
  // rest of owner's checkers (15 total) on a far point they can still play with
  const farO=o==='w'?12:11; while(no<15) state.board[farO].push(mk(o));
  state.bar[v].push(mk(v));
  const farV=v==='w'?13:10; while(nv<15) state.board[farV].push(mk(v));
  currentPlayer=toMove; renderCheckers(); updateUI();
},[owner,closedPts,toMove]);
const st=()=>p.evaluate(()=>({cp:currentPlayer,me:myColor,dice:diceValues.length,msg:document.getElementById('status-banner').innerText,dis:document.getElementById('roll-btn').disabled,rolled:rolledThisTurn}));
const W_HOME=[0,1,2,3,4,5], R_HOME=[18,19,20,21,22,23];
let me=await p.evaluate(()=>myColor); ok(me==='w','playing White');
// 1) AI (red) on the bar, my (white) home closed, AI to move -> AI doesn't roll
await setup('w',W_HOME,'r'); await p.waitForTimeout(300);
let s=await st(); ok(s.cp==='r'&&s.dice===0&&/closed: no move is possible/.test(s.msg),'AI blocked: message shown, no roll: "'+s.msg+'"');
await p.waitForTimeout(1200); s=await st(); ok(s.cp==='r'&&s.dice===0,'still showing it before the delay ends (cp '+s.cp+')');
await p.waitForTimeout(1500); s=await st(); ok(s.cp==='w'&&s.dice===0&&!s.dis&&/Your turn/.test(s.msg),'turn passed to me without any dice: "'+s.msg+'"');
// 2) me on the bar behind AI's closed board
await setup('r',R_HOME,'w'); await p.waitForTimeout(300);
s=await st(); ok(s.cp==='w'&&s.dis&&/You are on the bar/.test(s.msg),'me blocked: button off, message: "'+s.msg+'"');
await p.evaluate(()=>handleRollDice()); await p.waitForTimeout(200); s=await st(); ok(s.dice===0&&!s.rolled,'clicking/rolling does nothing');
await p.waitForTimeout(2500); s=await st(); ok(s.cp==='r'&&/rolling|rolled/.test(s.msg)||s.cp==='r','AI took its turn: cp '+s.cp+' "'+s.msg.slice(0,40)+'"');
// 3) five points closed only -> normal roll
await setup('w',[0,1,2,3,4],'r'); await p.waitForTimeout(3500); s=await st();
ok(!/no move is possible/.test(s.msg),'one point open: AI rolls normally: "'+s.msg.slice(0,50)+'"');
await setup('r',[18,19,20,21,22],'w'); await p.waitForTimeout(300); s=await st(); ok(!s.dis&&!/no move/.test(s.msg),'one point open: my Roll Dice stays available');
// a single checker on a point (blot) is not a block
await setup('w',[0,1,2,3,4],'r'); await p.evaluate(()=>{state.board[5].push('c_w_99'); updateUI();}); await p.waitForTimeout(300); s=await st(); ok(!/no move is possible/.test(s.msg),'blot on the sixth point is not a block');
// 4) as Red
await p.evaluate(()=>setMyColor('r')); await p.waitForTimeout(300);
await setup('r',R_HOME,'w'); await p.waitForTimeout(300); s=await st(); ok(s.cp==='w'&&s.me==='r'&&/closed: no move is possible/.test(s.msg),'playing Red, AI (white) blocked by my closed board: "'+s.msg.slice(0,60)+'"');
await p.waitForTimeout(2800); s=await st(); ok(s.cp==='r'&&s.dice===0&&!s.dis,'turn came back to me, Red, with no dice rolled');
await setup('w',W_HOME,'r'); await p.waitForTimeout(300); s=await st(); ok(s.cp==='r'&&s.dis&&/You are on the bar/.test(s.msg),'playing Red, me blocked: message "'+s.msg.slice(0,50)+'"');
await p.waitForTimeout(2800); s=await st(); ok(s.cp==='w','passed to the AI');
// 5) the AI keeps passing: a single closed-board stalemate must not loop forever on both sides: AI blocker rolls and plays
await p.screenshot({path:require('path').join(OUT,'blocked_shot.png')});
ok(errs.length===0,'no errors '+errs.join('|'));
console.log(fails?'FAILED '+fails:'ALL OK'); await b.close()})();
