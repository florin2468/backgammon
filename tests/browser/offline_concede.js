// Giving up against the computer: when it is offered and what it scores
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const p=await (await b.newContext({viewport:{width:1100,height:850}})).newPage(); const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+PAGE);await p.waitForTimeout(500);
// position builder in page: kind = game | gammon | backgammon, loserIsMe
const setup = async (kind, loserMe, toMoveLoser, matchLen) => { await p.waitForFunction(()=>!isAnimating&&!isRolling&&!aiThinking,null,{timeout:20000}).catch(()=>{}); return setup0(kind, loserMe, toMoveLoser, matchLen); };
const setup0 = (kind, loserMe, toMoveLoser, matchLen) => p.evaluate(([kind,loserMe,toMoveLoser,matchLen])=>{
  clearTimeout(endTurnTimer); if(!window.__mm){window.__mm=makeAIMove;window.__ar=aiRoll;} makeAIMove = function(){}; aiRoll = function(){};   // the computer from the previous test game must not move on
  soundEnabled=false; if(matchActive) enterStartScreen(); startMatch(matchLen); clearTimeout(rollTimeout); gameGen++; openingRoll=false; gameActive=true; isRolling=false; isAnimating=false;
  const me=myColor, opp=oppColor(), loser= loserMe?me:opp, winner= loser==='w'?'r':'w';
  state.board=Array.from({length:24},()=>[]); state.bar={w:[],r:[]}; state.off={w:[],r:[]};
  const homeIdx = c => c==='w'?[0,1,2,3,4,5]:[23,22,21,20,19,18];   // [0] = the 1 point of that colour
  // winner: 2 checkers on his ace point, 13 off
  for(let i=0;i<2;i++) state.board[homeIdx(winner)[0]].push('c_'+winner+'_'+i); for(let i=2;i<15;i++) state.off[winner].push('c_'+winner+'_'+i);
  // loser checkers: far away
  const far = loser==='w'?[14,15,16]:[9,8,7];                          // on the winner's side of the board? (no: loser's own outfield)
  let n=0;
  if(kind==='game'){ state.off[loser].push('c_'+loser+'_0'); n=1; for(;n<15;n++) state.board[loser==='w'?(8+n%3):(12+n%3)].push('c_'+loser+'_'+n); }
  if(kind==='gammon'){ for(;n<15;n++) state.board[loser==='w'?(8+n%3):(12+n%3)].push('c_'+loser+'_'+n); }
  if(kind==='backgammon'){ state.board[winner==='w'?4:19].push('c_'+loser+'_0'); n=1; for(;n<15;n++) state.board[loser==='w'?(8+n%3):(12+n%3)].push('c_'+loser+'_'+n); }
  currentPlayer = toMoveLoser?loser:winner; diceValues=[]; rolledThisTurn=false; turnHistory=[]; concedeAskedAt=0; hideConcede();
  renderCheckers(); updateUI();
  return {me,loser,winner};
},[kind,loserMe,toMoveLoser,matchLen]);
const modal = () => p.evaluate(()=>({open:!document.getElementById('concede-modal').classList.contains('hidden'),text:document.getElementById('concede-text').innerText,pts:document.getElementById('concede-points').innerText,btn:document.getElementById('concede-yes').innerText,flag:!document.getElementById('concede-btn').classList.contains('hidden')}));
for (const myCol of ['w','r']) {
  await p.evaluate(c=>{ if(matchActive) enterStartScreen(); if(myColor!==c) setMyColor(c); },myCol);
  // backgammon with the AI to move: my checker can't get out of its home board in time -> 3;
  // backgammon with me to move: one die takes it out, so the best I can still get is a gammon -> offered at 2
  for (const [kind,expect,meFirst] of [['game',1,true],['gammon',2,true],['backgammon',3,false],['backgammon',2,true]]) {
    const info = await setup(kind,true,meFirst,5); await p.waitForTimeout(200);
    const m = await modal();
    ok(m.open && m.flag && m.btn.includes('('+expect+' point'), `${myCol} loser, ${kind}${meFirst?' (me to move)':' (AI to move)'}: popup shown, button says ${expect}: "${m.btn}" | "${m.pts}"`);
    const before = await p.evaluate(w=>({s:JSON.stringify(matchScore)}),0);
    await p.click('#concede-yes'); await p.waitForTimeout(400);
    const after = await p.evaluate(()=>({score:matchScore,active:gameActive,st:document.getElementById('status-banner').innerText,me:myColor,next:!document.getElementById('next-game-wrap').classList.contains('hidden'),gp:gamesPlayed,lw:lastWinner}));
    const win = info.winner;
    ok(after.score[win]===expect && after.score[info.loser]===0 && !after.active && after.next && after.gp===1, `  -> winner (${win}) got ${after.score[win]} point(s), loser 0, game over | "${after.st.slice(0,95)}"`);
    // next game: the winner (AI) starts with a normal roll, no opening roll
    await p.evaluate(()=>{ if(window.__mm){ makeAIMove=window.__mm; aiRoll=window.__ar; } onNextGameClick(); }); await p.waitForTimeout(3000);
    const nx = await p.evaluate(()=>({open:openingRoll,cp:currentPlayer,moved:JSON.stringify(state)!==JSON.stringify(E.createInitialState())}));
    ok(!nx.open && nx.moved, '  -> the winner starts the next game (no opening roll)');
  }
}
// loser = AI: no popup for the human
{ const info = await setup('gammon',false,true,5); await p.waitForTimeout(200); const m=await modal(); ok(!m.open && !m.flag, 'AI is the one losing: no popup for me'); await p.evaluate(()=>{gameActive=false;}); }
// not lost: no popup
{ await p.evaluate(()=>{ if(matchActive) enterStartScreen(); startMatch(3); openingRoll=false; currentPlayer=myColor; rolledThisTurn=false; diceValues=[]; concedeAskedAt=0; updateUI(); }); await p.waitForTimeout(200); const m=await modal(); ok(!m.open && !m.flag, 'opening position: no popup'); }
// match target caps the points: 1-point match, gammon -> only 1 counts
{ const info = await setup('gammon',true,true,1); await p.waitForTimeout(200); const m=await modal(); ok(/only needs 1/.test(m.pts)&&m.btn.includes('(1 point)'), 'match of 1: gammon popup says only 1 counts: "'+m.pts+'"');
  await p.click('#concede-yes'); await p.waitForTimeout(400); const a=await p.evaluate(()=>({score:matchScore,over:matchOver,st:document.getElementById('status-banner').innerText,canvas:!!document.querySelector('canvas[aria-hidden]')}));
  ok(a.score[info.winner]===1 && a.over && /Match over/.test(a.st) && /gave up/.test(a.st), 'match ended 1-0 by concession: "'+a.st.slice(0,120)+'"');
  ok(a.canvas, 'victory animation plays even though the winner had nothing borne off'); }
// Keep playing, then reopen with the flag button; asked only once
{ const info = await setup('gammon',true,true,5); await p.waitForTimeout(200);
  await p.click('#concede-modal button:has-text("Keep playing")'); await p.waitForTimeout(200);
  await p.evaluate(()=>updateUI()); await p.waitForTimeout(100);
  let m=await modal(); ok(!m.open && m.flag, 'after "Keep playing" the popup stays away but the flag button remains');
  await p.click('#concede-btn'); await p.waitForTimeout(200); m=await modal(); ok(m.open, 'the flag button reopens the popup');
  await p.click('#concede-modal button:has-text("Keep playing")'); }
// concede when the loser has saved the gammon meanwhile -> points follow the position at the moment of clicking
{ const info = await setup('gammon',true,true,5); await p.waitForTimeout(200);
  await p.click('#concede-modal button:has-text("Keep playing")');
  await p.evaluate((l)=>{ const id=state.board.flat().find(i=>i.startsWith('c_'+l+'_')); for(const a of state.board){const k=a.indexOf(id); if(k>=0){a.splice(k,1);break;}} state.off[l].push(id); renderCheckers(); updateUI(); },info.loser);
  await p.waitForTimeout(200); const m=await modal(); ok(m.open && m.btn.includes('(1 point)') && /single game/.test(m.pts), 'after bearing one off, the offer comes back by itself as a single game: "'+m.pts+'"');
  await p.click('#concede-yes'); await p.waitForTimeout(300); const a=await p.evaluate(()=>matchScore); ok(a[info.winner]===1,'counted 1 point'); }
ok(errs.length===0,'no page errors '+errs.join('|'));
console.log(fails?'FAILED '+fails:'ALL OK'); await b.close()})();
