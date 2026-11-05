// Saving and resuming a game against the computer in the middle of a turn
const {chromium}=require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
const D=process.cwd()+'/';const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1100,height:900}});
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+PAGE);await p.waitForTimeout(500);
// 1) AI save written while the LAST die of my turn is being played
await p.evaluate(()=>{soundEnabled=false;startMatch(3);openingRoll=false;currentPlayer=W;rolledThisTurn=true;diceValues=[3];updateUI();
  const ms=getAllMoves(W,diceValues);executeMove(ms[0].from,ms[0].target,ms[0].diceUsed);});
const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('bg_ai_match')).snap);
ok(saved.diceValues.length===0&&saved.rolledThisTurn===true&&saved.currentPlayer==='w','save captured the instant after my last die (dice [], rolled, still my turn)');
await p.reload();await p.waitForTimeout(500);
await p.evaluate(()=>{const o=window.setTimeout.bind(window);window.setTimeout=(f,ms,...a)=>o(f,(ms||0)/10,...a);soundEnabled=false;});
await p.click('#ai-resume-modal button:has-text("Continue")');
await p.waitForTimeout(150);
const r=await p.evaluate(()=>({cp:currentPlayer,st:document.getElementById('status-banner').innerText}));
ok(r.cp==='r'||/AI/.test(r.st),'turn passes to the AI instead of giving me another roll: '+JSON.stringify(r));
await p.waitForFunction(()=>currentPlayer===W&&!rolledThisTurn&&diceValues.length===0,null,{timeout:20000});
ok(true,'AI played its turn and it is my turn again');
// 2) the winning move
await p.evaluate(()=>{localStorage.clear();});
await p.evaluate(()=>{startMatch(3);openingRoll=false;currentPlayer=W;rolledThisTurn=true;
  state=E.createInitialState(); // build an almost finished game: white has 1 checker left on point index 0
  const all=[...state.board.flat(),...state.bar.w,...state.bar.r]; state.board=Array.from({length:24},()=>[]);state.bar={w:[],r:[]};state.off={w:[],r:[]};
  const ws=all.filter(i=>i.startsWith('c_w_')),rs=all.filter(i=>i.startsWith('c_r_'));
  state.board[0].push(ws[0]); ws.slice(1).forEach(i=>state.off.w.push(i)); rs.forEach(i=>state.board[12].push(i)); // red: 15 on point 12 (a gammon)
  diceValues=[1];renderCheckers();updateUI();
  const ms=getAllMoves(W,diceValues);executeMove(ms[0].from,ms[0].target,ms[0].diceUsed);});
const sv=await p.evaluate(()=>JSON.parse(localStorage.getItem('bg_ai_match')));
ok(sv.snap.gameActive===true&&sv.snap.state.off.w.length===15,'save captured the instant after the winning checker came off');
await p.reload();await p.waitForTimeout(500);
await p.click('#ai-resume-modal button:has-text("Continue")');await p.waitForTimeout(300);
const w=await p.evaluate(()=>({score:JSON.stringify(matchScore),wrapVisible:!document.getElementById('next-game-wrap').classList.contains('hidden'),btn:document.getElementById('next-game-btn').innerText,status:document.getElementById('status-banner').innerText,active:gameActive}));
ok(w.score==='{"w":2,"r":0}'&&w.wrapVisible&&!w.active,'resume records the finished game (gammon = 2 points) and offers the next game: '+JSON.stringify(w));
// 3) online applySnapshot with a mid-turn snapshot
await p.evaluate(()=>{localStorage.clear();});
await p.reload();await p.waitForTimeout(400);
const o=await p.evaluate(()=>{soundEnabled=false;
  online.active=true;online.role='guest';opponentKind='remote';matchActive=true;myColor=W;
  const st=E.createInitialState();
  const m={state:st,currentPlayer:'r',diceValues:[],openingRoll:false,rolledThisTurn:true,isRolling:false,matchScore:{w:0,r:0},matchLength:3,gamesPlayed:0,matchOver:false,gameActive:true};
  applySnapshot(m); const a={cp:currentPlayer,rolled:rolledThisTurn};
  online.active=false; return a;});
ok(o.cp==='w'&&o.rolled===false,'online snapshot taken after the last die: turn passes to the other player: '+JSON.stringify(o));
console.log('errors',errs);await b.close()})()
