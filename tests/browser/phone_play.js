// The phone layout: start screen, playing a game by tapping, the menu
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
(async()=>{const b=await chromium.launch();let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c)fails++;};
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true}); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.accept());
await p.goto('file://'+PAGE); await p.waitForTimeout(1200);
await p.evaluate(()=>{soundEnabled=false;aiDifficulty='easy';});
const st=()=>p.evaluate(()=>({kind:document.getElementById('ph-main').dataset.kind, dis:document.getElementById('ph-main').disabled, t:document.getElementById('ph-main-t').innerText, s:document.getElementById('ph-main-s').innerText, undo:document.getElementById('ph-undo').disabled, hint:document.getElementById('ph-hint').disabled, cp:currentPlayer, me:myColor, dice:diceValues.length, anim:isAnimating||isRolling, ga:gameActive, open:openingRoll, status:document.getElementById('status-banner').innerText}));
ok(/Choose below/.test(await p.innerText('#status-banner')), 'start screen status speaks of the phone buttons: "'+await p.innerText('#status-banner')+'"');
// start a match with the real buttons
await p.click('#phone-start .ph-amber'); await p.waitForTimeout(300);
await p.click('#match-modal button:has-text("3")'); await p.waitForTimeout(400);
let s=await st(); ok(s.kind==='go' && !s.dis && /opening/.test(s.s), 'match started: main button "'+s.t+' / '+s.s+'"');
ok(await p.isVisible('#phone-actions') && !(await p.isVisible('#phone-start')), 'the game buttons replaced the start buttons');
const kinds=new Set(); let myMoves=0, undoDone=false, hintDone=false;
for(let i=0;i<120 && myMoves<14;i++){
  s=await st(); kinds.add(s.kind);
  if(s.kind==='go' && !s.dis){ await p.click('#ph-main'); await p.waitForTimeout(700); continue; }
  if(s.cp===s.me && s.dice>0 && !s.anim && s.ga && !s.open){
    if(!hintDone && !s.hint){ await p.click('#ph-hint'); await p.waitForTimeout(400); hintDone=/Hint/.test(await p.innerText('#status-banner')); }
    const mv=await p.evaluate(()=>{const ms=getAllMoves(myColor,diceValues); return ms.length?ms[0]:null;});
    if(!mv){ await p.waitForTimeout(400); continue; }
    // tap the source then the target, like a player
    await p.evaluate(m=>{ if(m.from==='bar') document.getElementById('bar-bottom').click(); else pointElements[m.from].querySelector('.hitbox').click(); },mv);
    await p.waitForTimeout(100);
    await p.evaluate(m=>{ const t=validTargets.find(x=>x.target===m.target)||validTargets[0]; if(!t) return; if(t.target==='off') document.getElementById(homeOrientation==='RIGHT'?'tray-right':'tray-left').click(); else pointElements[t.target].querySelector('.hitbox').click(); },mv);
    await p.waitForTimeout(900); myMoves++;
    if(!undoDone){ const u=await st(); if(!u.undo){ const before=await p.evaluate(()=>JSON.stringify(state)); await p.click('#ph-undo'); await p.waitForTimeout(800); const after=await p.evaluate(()=>JSON.stringify(state)); undoDone = before!==after; } }
    continue;
  }
  await p.waitForTimeout(400);
}
ok(myMoves>=6, 'played '+myMoves+' moves by tapping points');
ok(kinds.has('go') && kinds.has('mine') && (kinds.has('opp')||kinds.has('oppdone')), 'main button went through its states: '+[...kinds].join(', '));
ok(undoDone, 'the bottom Undo button undid a move');
ok(hintDone, 'the bottom Hint button showed a hint');
// game menu: swap colour mid-match
await p.waitForFunction(()=>!isAnimating&&!isRolling&&!aiThinking,null,{timeout:20000}).catch(()=>{});
const col0=await p.evaluate(()=>myColor);
await p.click('#phone-top button[aria-label="Game menu"]'); await p.waitForTimeout(300);
ok(await p.isVisible('#phone-sheet .ph-panel'), 'menu sheet opens: "'+(await p.innerText('#ph-sheet-sub'))+'"');
await p.click('#ph-m-swap'); await p.waitForTimeout(1500);
ok((await p.evaluate(()=>myColor))!==col0 && !(await p.isVisible('#phone-sheet .ph-panel')), 'menu "Play '+(col0==='w'?'Red':'White')+'" switched colour and closed the sheet');
await p.click('#phone-top button[aria-label="Game menu"]'); await p.waitForTimeout(200);
await p.click('#phone-sheet button:has-text("Settings")'); await p.waitForTimeout(300);
ok(await p.isVisible('#settings-modal'), 'menu: Settings opens'); await p.evaluate(()=>toggleSettingsModal());
await p.click('#phone-top button[aria-label="Game menu"]'); await p.waitForTimeout(200);
await p.click('#phone-sheet button:has-text("Rules")'); await p.waitForTimeout(300);
ok(await p.isVisible('#help-modal'), 'menu: Rules & help opens'); await p.evaluate(()=>toggleHelpModal());
// give-up flag
await p.evaluate(()=>{ makeAIMove=function(){}; aiRoll=function(){}; clearTimeout(rollTimeout); clearTimeout(endTurnTimer); gameGen++; openingRoll=false; gameActive=true; isRolling=false; isAnimating=false; aiThinking=false;
  const me=myColor, op=oppColor(); state.board=Array.from({length:24},()=>[]); state.bar={w:[],r:[]}; state.off={w:[],r:[]};
  const opHome1 = op==='r'?23:0; state.board[opHome1].push('c_'+op+'_0','c_'+op+'_1'); for(let i=2;i<15;i++) state.off[op].push('c_'+op+'_'+i);
  const far = me==='w'?[10,9,8]:[13,14,15]; for(let n=0;n<15;n++) state.board[far[n%3]].push('c_'+me+'_'+n);
  currentPlayer=op; diceValues=[]; rolledThisTurn=false; turnHistory=[]; concedeAskedAt=0; renderCheckers(); updateUI(); });
await p.waitForTimeout(300);
ok(await p.isVisible('#concede-modal'), 'give-up popup appears on the phone too');
await p.evaluate(()=>answerConcede(false)); await p.waitForTimeout(200);
ok(await p.isVisible('#ph-flag'), 'the flag shows in the top bar while giving up is on offer');
await p.click('#ph-flag'); await p.waitForTimeout(200); ok(await p.isVisible('#concede-modal'), 'tapping the flag reopens the offer');
await p.evaluate(()=>answerConcede(false));
await p.click('#phone-top button[aria-label="Game menu"]'); await p.waitForTimeout(200);
ok(await p.isVisible('#ph-m-giveup') && /scores 2 points/.test(await p.innerText('#ph-m-giveup-s')), 'menu shows "Give up": "'+(await p.innerText('#ph-m-giveup-s'))+'"');
await p.click('#ph-m-giveup'); await p.waitForTimeout(200); ok(await p.isVisible('#concede-modal'),'and opens the offer');
await p.click('#concede-yes'); await p.waitForTimeout(600);
// end of game: next-game button over the board, dice hidden, button clickable
const eg=await p.evaluate(()=>({wrap:!document.getElementById('next-game-wrap').classList.contains('hidden'), dice:getComputedStyle(document.getElementById('dice-wrapper')).visibility, kind:document.getElementById('ph-main').dataset.kind, t:document.getElementById('ph-main-t').innerText}));
ok(eg.wrap && eg.dice==='hidden', 'game over: Play Next Game shows over the board and the dice are out of its way; main button "'+eg.t+'"');
await p.evaluate(()=>{ makeAIMove=window.__mm||makeAIMove; });
await p.click('#next-game-btn'); await p.waitForTimeout(600);
ok(await p.evaluate(()=>gameActive), 'Play Next Game is tappable on the phone');
await p.screenshot({path:OUT+'/pp_after.png'});
// flat board setting on a phone
await p.evaluate(()=>setFlatBoard(true)); await p.waitForTimeout(600);
let lay=await p.evaluate(()=>({phone:document.documentElement.hasAttribute('data-phone'),vb:document.documentElement.getAttribute('data-vboard'),diceParent:document.getElementById('dice-wrapper').parentNode.tagName,docH:document.documentElement.scrollHeight}));
ok(lay.phone && !lay.vb && lay.diceParent==='MAIN', 'Flat board on a phone: phone layout kept, dice back above the board '+JSON.stringify(lay));
await p.screenshot({path:OUT+'/pp_flat.png'});
await p.evaluate(()=>setFlatBoard(false)); await p.waitForTimeout(400);
// rotate to landscape and back
await p.setViewportSize({width:844,height:390}); await p.waitForTimeout(700);
lay=await p.evaluate(()=>({phone:document.documentElement.hasAttribute('data-phone'),compact:document.documentElement.hasAttribute('data-compact'),diceParent:document.getElementById('dice-wrapper').parentNode.tagName,top:getComputedStyle(document.getElementById('phone-top')).display}));
ok(!lay.phone && lay.compact && lay.diceParent==='MAIN' && lay.top==='none', 'turned sideways: the landscape layout as before '+JSON.stringify(lay));
await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(700);
lay=await p.evaluate(()=>({phone:document.documentElement.hasAttribute('data-phone'),vb:document.documentElement.getAttribute('data-vboard'),diceParent:document.getElementById('dice-wrapper').parentNode.id}));
ok(lay.phone && lay.vb && lay.diceParent==='board-stage', 'and back upright: phone layout again '+JSON.stringify(lay));
// new match from the menu
await p.click('#phone-top button[aria-label="Game menu"]'); await p.waitForTimeout(200);
await p.click('#ph-m-leave'); await p.waitForTimeout(500);
ok(await p.isVisible('#match-modal') || await p.isVisible('#phone-start'), 'menu "New match" goes back to choosing a match');
ok(errs.length===0,'no errors '+errs.join('|'));
console.log(fails?'FAILED '+fails:'ALL OK'); await b.close()})();
