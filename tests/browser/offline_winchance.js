// The Win chance switch and meter
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
const FILE = PAGE;
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const ctx=await b.newContext({viewport:{width:1280,height:900}}); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text()))errs.push('console: '+m.text());});
await p.goto('file://'+FILE); await p.waitForTimeout(1000);
await p.evaluate(()=>{soundEnabled=false;aiDifficulty='easy';});
const meter=()=>p.evaluate(()=>({on:document.getElementById('wp-row').classList.contains('wp-on'), vis:getComputedStyle(document.getElementById('wp-meter')).display, me:document.getElementById('wp-me-pct').textContent, opp:document.getElementById('wp-opp-pct').textContent, meName:document.getElementById('wp-me-name').textContent, oppName:document.getElementById('wp-opp-name').textContent, title:document.getElementById('wp-meter').title, fill:document.getElementById('wp-fill').style.width, worker:!!wp.worker, noWorker:wp.noWorker, done:wp.done, n:wp.acc&&wp.acc.n}));
let m=await meter();
ok(!m.on && m.vis==='none' && await p.isVisible('#wp-toggle'), 'switch shown above the board, meter off by default');
await p.click('#wp-toggle'); await p.waitForTimeout(200);
m=await meter(); ok(m.on && m.vis==='flex' && m.me==='–', 'switched on before a match: meter shows dashes ('+m.title+')');
await p.click('#start-match-btn'); await p.waitForTimeout(300);
await p.click('#match-modal button:has-text("3")'); await p.waitForTimeout(400);
m=await meter(); ok(m.me==='50%' && m.opp==='50%', 'opening roll: even 50% / 50%');
// a fixed position: I (white) far ahead in a race, my turn, not rolled
await p.evaluate(()=>{
  const mk=(c,n)=>Array.from({length:n},(_,i)=>'c_'+c+'_'+(Math.random().toString(36).slice(2)));
  const st={board:Array.from({length:24},()=>[]),bar:{w:[],r:[]},off:{w:[],r:[]}};
  st.board[0]=mk('w',5); st.board[1]=mk('w',5); st.board[2]=mk('w',5);      // white: 30 pips, all home
  st.board[12]=mk('r',5); st.board[15]=mk('r',5); st.board[17]=mk('r',5);  // red: far from home
  let k=0; for(const pt of st.board) for(let i=0;i<pt.length;i++) pt[i]='c_'+pt[i].charAt(2)+'_'+(k++);
  openingRoll=false; state=st; currentPlayer=myColor; diceValues=[]; rolledThisTurn=false; gameActive=true; isRolling=false;
  renderCheckers(); updateUI();
});
const t0=Date.now();
await p.waitForFunction(()=>wp.done,null,{timeout:20000}).catch(()=>{});
const dt=Date.now()-t0;
m=await meter(); ok(m.worker && !m.noWorker, 'estimate runs in a background worker');
ok(m.done && m.n===1000, 'finished 1000 games in '+dt+' ms');
ok(m.me==='>99%' && m.opp==='<1%', 'big race lead: '+m.me+' / '+m.opp+' (never shows a flat 100% before the game is decided)');
// swap: red far ahead
await p.evaluate(()=>{ const st=state; const nb=Array.from({length:24},()=>[]); for(let i=0;i<24;i++) nb[23-i]=st.board[i].map(id=>id.replace(/^c_(w|r)/,(x,c)=>'c_'+(c==='w'?'r':'w'))); state={board:nb,bar:{w:[],r:[]},off:{w:[],r:[]}}; renderCheckers(); updateUI(); });
await p.waitForFunction(()=>wp.done,null,{timeout:20000}).catch(()=>{});
m=await meter(); ok(m.me==='<1%' && m.opp==='>99%', 'opponent far ahead: '+m.me+' / '+m.opp);
// the start position, mid-game style (white to move, no dice) should be near even
await p.evaluate(()=>{ state=E.createInitialState(); currentPlayer=myColor; diceValues=[]; rolledThisTurn=false; renderCheckers(); updateUI(); });
await p.waitForFunction(()=>wp.done,null,{timeout:20000}).catch(()=>{});
m=await meter(); const v=parseInt(m.me); ok(v>=45 && v<=58 && parseInt(m.me)+parseInt(m.opp)===100, 'starting position, me to roll: '+m.me+' / '+m.opp+' — '+m.title);
// same position again -> exactly the same numbers (fixed seeds)
const first=m.me;
await p.evaluate(()=>{ wp.key=''; wpSync(); }); await p.waitForFunction(()=>wp.done,null,{timeout:20000}).catch(()=>{});
m=await meter(); ok(m.me===first, 'same position gives the same number again ('+m.me+')');
// during a turn the chances do not move: not after the roll, not after each checker; only once the turn is over
const before=(await meter()).me, key0=await p.evaluate(()=>wp.key);
await p.evaluate(()=>{ diceValues=[6,5]; rolledThisTurn=true; updateUI(); });
await p.waitForTimeout(400);
const afterRoll=await meter(), key1=await p.evaluate(()=>wp.key);
await p.evaluate(()=>{ const m=getAllMoves(myColor,diceValues).find(x=>x.from===(myColor==='w'?23:0)) || getAllMoves(myColor,diceValues)[0]; executeMove(m.from,m.target,m.diceUsed); });
await p.waitForTimeout(900);
const afterMove=await meter(), key2=await p.evaluate(()=>wp.key);
ok(afterRoll.me===before && afterMove.me===before && key1===key0 && key2===key0, 'during a turn the meter keeps the position the turn began with: '+before+' after the roll and after a checker moved');
await p.evaluate(()=>{ const m=getAllMoves(myColor,diceValues)[0]; if (m) executeMove(m.from,m.target,m.diceUsed); });
await p.waitForFunction(k=>wp.key!==k && wp.done,key0,{timeout:20000}).catch(()=>{});
m=await meter(); ok(await p.evaluate(k=>wp.key!==k,key0) && m.n===1000, 'once the turn is over it works out the new position (opponent to roll): me '+m.me);
// no worker: falls back to slices on the page
await p.evaluate(()=>{ if (wp.worker) wp.worker.terminate(); wp.worker=null; wp.noWorker=true; state=E.createInitialState(); currentPlayer=myColor; diceValues=[]; rolledThisTurn=false; wp.key=''; updateUI(); });
const t1=Date.now(); await p.waitForFunction(()=>wp.done,null,{timeout:30000}).catch(()=>{});
m=await meter(); ok(m.done && m.n===400, 'without a worker it still finishes ('+m.n+' games, '+(Date.now()-t1)+' ms): '+m.me);
// game won
await p.evaluate(()=>{ state.off[oppColor()]=state.off[oppColor()].concat(Array.from({length:15},(_,i)=>'c_'+oppColor()+'_x'+i)); for(let i=0;i<24;i++) state.board[i]=state.board[i].filter(id=>id.charAt(2)!==oppColor()); gameActive=false; updateUI(); });
m=await meter(); ok(m.me==='0%' && m.opp==='100%', 'decided game: '+m.me+' / '+m.opp);
// switch off and reload: remembered
await p.reload(); await p.waitForTimeout(800);
m=await meter(); ok(m.on, 'switch remembered after a reload');
await p.click('#wp-toggle'); await p.waitForTimeout(100); await p.reload(); await p.waitForTimeout(800);
m=await meter(); ok(!m.on, 'switched off: remembered too');
ok(errs.length===0, 'no page errors '+JSON.stringify(errs.slice(0,3)));
await b.close(); console.log(fails?fails+' FAILED':'ALL PASS'); process.exit(fails?1:0);})();
