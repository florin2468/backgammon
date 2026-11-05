// Closed board and bar: more positions and both colours
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const p=await (await b.newContext({viewport:{width:1100,height:850}})).newPage(); const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+PAGE);await p.waitForTimeout(500);
await p.evaluate(()=>{soundEnabled=false;aiDifficulty='easy';startMatch(3);window.__m=[];const ss=setStatus;setStatus=function(m){__m.push(m);return ss.apply(this,arguments)};}); await p.waitForTimeout(300);
await p.evaluate(()=>{ clearTimeout(rollTimeout); gameGen++; isRolling=false; isAnimating=false; openingRoll=false; gameActive=true; rolledThisTurn=true; turnHistory=[];
  state.board=Array.from({length:24},()=>[]); state.bar={w:[],r:[]}; state.off={w:[],r:[]};
  let w=0,r=0; for(const i of [0,1,2,3,4]) state.board[i].push('c_w_'+w++,'c_w_'+w++); state.board[5].push('c_w_'+w++); state.board[6].push('c_w_'+w++,'c_w_'+w++); while(w<15) state.board[12].push('c_w_'+w++);
  state.bar.r.push('c_r_'+r++); while(r<15) state.board[13].push('c_r_'+r++);
  currentPlayer='w'; diceValues=[1]; renderCheckers(); updateUI(); __m.length=0; });
await p.evaluate(()=>executeMove(6,5,1)); 
await p.waitForTimeout(3500);
const r=await p.evaluate(()=>({msgs:__m.slice(),cp:currentPlayer,dice:diceValues.length}));
console.log(JSON.stringify(r.msgs).slice(0,400));
ok(r.msgs.some(m=>/AI is on the bar and your home board is closed/.test(m)),'my closing move -> AI told it cannot move');
ok(r.cp==='w'&&r.dice===0,'turn came straight back to me with no AI roll (cp '+r.cp+')');
ok(!r.msgs.some(m=>/AI is rolling|AI rolled/.test(m)),'AI never rolled');
ok(errs.length===0,'no errors'); console.log(fails?'FAILED':'ALL OK'); await b.close()})();
