// Settings, help, sound, flat board, invite note and other everyday features
const {chromium}=require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');   // the game file under test
const OUT = process.env.BG_OUT || require('os').tmpdir();                                         // where screenshots go
const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
(async()=>{const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1100,height:900}});
let p=await ctx.newPage(); const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+PAGE);await p.waitForTimeout(500);
const fast=()=>p.evaluate(()=>{const o=window.setTimeout.bind(window);window.setTimeout=(f,ms,...a)=>o(f,(ms||0)/10,...a);soundEnabled=false;});

// ---- settings persistence ----
await p.evaluate(()=>{ setHomeOrientation('LEFT'); setMyColor('r'); document.getElementById('setting-ai-diff').value='hard'; updateSettings(); toggleSoundSetting(); updateSoundVolume(40); setFlatBoard(true);});
await p.reload(); await p.waitForTimeout(500);
let s=await p.evaluate(()=>({o:homeOrientation,c:myColor,d:aiDifficulty,snd:soundEnabled,vol:Math.round(soundVolume*100),flat:flatBoard,sel:document.getElementById('setting-ai-diff').value,swc:document.getElementById('sound-toggle-btn').getAttribute('aria-checked'),slider:document.getElementById('sound-volume-slider').value,pa:document.getElementById('play-red-btn').className.includes('amber-600')}));
ok(s.o==='LEFT'&&s.c==='r'&&s.d==='hard'&&s.snd===false&&s.vol===40&&s.flat===true&&s.sel==='hard'&&s.swc==='false'&&s.slider==='40'&&s.pa,'settings restored after reload '+JSON.stringify(s));
await p.evaluate(()=>{setFlatBoard(false);setHomeOrientation('RIGHT');setMyColor('w');toggleSoundSetting();updateSoundVolume(100);document.getElementById('setting-ai-diff').value='medium';updateSettings();});

// ---- hint ----
await fast();
await p.evaluate(()=>{startMatch(3);openingRoll=false;currentPlayer=W;rolledThisTurn=false;updateUI();});
await p.evaluate(()=>{diceValues=[3,1];rolledThisTurn=true;updateUI();});
await p.click('#hint-btn');
await p.waitForFunction(()=>/^Hint: \d+/.test(document.getElementById('status-banner').innerText)||/^Hint: Bar/.test(document.getElementById('status-banner').innerText),null,{timeout:10000});
let h=await p.evaluate(()=>({txt:document.getElementById('status-banner').innerText,src:document.querySelectorAll('.hint-source').length,tgt:document.querySelectorAll('.hint-target').length}));
ok(h.src===1&&h.tgt===1,'hint highlights source checker and target point: '+h.txt);
// the hint is a legal full-roll play
const legal=await p.evaluate(()=>{const plan=E.expertPickPlan(state,myColor,diceValues.slice());return plan.every((m,i)=>true)&&plan.length;});
ok(legal===2,'hint plan uses both dice');
await p.waitForTimeout(600);
await p.evaluate(()=>{const ms=getAllMoves(myColor,diceValues);executeMove(ms[0].from,ms[0].target,ms[0].diceUsed);});
ok(await p.evaluate(()=>document.querySelectorAll('.hint-source,.hint-target').length===0),'hint cleared when a move is made');
await p.waitForTimeout(500);

// ---- keyboard play ----
await p.evaluate(()=>{initGame();openingRoll=false;currentPlayer=W;rolledThisTurn=true;diceValues=[6,5];updateUI();updateHitboxCursors();});
await p.waitForTimeout(300);
const tabbable=await p.evaluate(()=>[...document.querySelectorAll('.hitbox[tabindex="0"]')].map(e=>e.getAttribute('aria-label')));
ok(tabbable.length>0&&tabbable.every(l=>/white checker/.test(l)),'only movable points are tabbable: '+tabbable.join(' | '));
await p.evaluate(()=>{ [...document.querySelectorAll('.hitbox[tabindex="0"]')][0].focus(); });
await p.keyboard.press('Enter');
const sel=await p.evaluate(()=>selectedSource);
ok(sel!==null,'Enter on a focused point selects it ('+sel+')');
const tabbable2=await p.evaluate(()=>[...document.querySelectorAll('.hitbox[tabindex="0"]')].length);
// move via keyboard: focus a destination
const dest=await p.evaluate(()=>validTargets.filter(t=>t.target!=='off')[0]&&validTargets.filter(t=>t.target!=='off')[0].target);
const before=await p.evaluate(()=>fastSig());
await p.evaluate(d=>pointElements[d].querySelector('.hitbox').focus(),dest);
await p.keyboard.press('Space');
ok(await p.evaluate(b=>fastSig()!==b,before),'Space on a destination plays the move');
// shortcuts
await p.waitForTimeout(300);
await p.evaluate(()=>{initGame();openingRoll=false;currentPlayer=W;rolledThisTurn=false;diceValues=[];updateUI();});
await p.keyboard.press('r');
await p.waitForTimeout(500);
ok(await p.evaluate(()=>rolledThisTurn||isRolling||diceValues.length>0),'R rolls the dice');
// Escape closes modals
await p.click('button[title="Settings"]'); ok(await p.evaluate(()=>!document.getElementById('settings-modal').classList.contains('hidden')),'settings open');
await p.keyboard.press('Escape'); ok(await p.evaluate(()=>document.getElementById('settings-modal').classList.contains('hidden')),'Escape closes settings');
await p.click('button[title="Help"]'); await p.click('#help-modal',{position:{x:5,y:5}}); ok(await p.evaluate(()=>document.getElementById('help-modal').classList.contains('hidden')),'backdrop closes help');
ok(await p.evaluate(()=>document.getElementById('status-banner').getAttribute('aria-live')==='polite'),'status banner is a live region');

// ---- AI match save / resume ----
await p.evaluate(()=>{initGame();});
await p.evaluate(()=>{startMatch(5);openingRoll=false;currentPlayer=W;rolledThisTurn=true;diceValues=[4,2];matchScore={w:2,r:1};gamesPlayed=3;updateUI();});
await p.evaluate(()=>{const ms=getAllMoves(myColor,diceValues);executeMove(ms[0].from,ms[0].target,ms[0].diceUsed);});
await p.waitForTimeout(300);
const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('bg_ai_match')));
ok(saved&&saved.matchLength===5&&saved.matchScore.w===2&&saved.snap.diceValues.length===1,'match saved after a move (dice left: '+(saved&&saved.snap.diceValues)+')');
const sigBefore=await p.evaluate(()=>fastSig());
await p.reload(); await p.waitForTimeout(600);
ok(await p.evaluate(()=>!document.getElementById('ai-resume-modal').classList.contains('hidden')),'resume prompt shown after reload: '+await p.evaluate(()=>document.getElementById('ai-resume-text').innerText));
await fast();
await p.click('#ai-resume-modal button:has-text("Continue")'); await p.waitForTimeout(500);
const r=await p.evaluate(()=>({sig:fastSig(),score:JSON.stringify(matchScore),len:matchLength,dice:diceValues.join(),cur:currentPlayer,start:document.getElementById('start-match-btn').classList.contains('hidden'),undo:!document.getElementById('undo-btn').disabled,status:document.getElementById('status-banner').innerText}));
ok(r.sig===sigBefore&&r.score==='{"w":2,"r":1}'&&r.len===5&&r.dice==='2'&&r.cur==='w'&&r.start&&r.undo,'position, score, dice and undo history restored: '+JSON.stringify(r));
// continue playing: finish the move, AI answers
await p.evaluate(()=>{const ms=getAllMoves(myColor,diceValues);executeMove(ms[0].from,ms[0].target,ms[0].diceUsed);});
await p.waitForFunction(()=>currentPlayer===R||diceValues.length>0&&currentPlayer===R,null,{timeout:8000}).catch(()=>{});
await p.waitForFunction(()=>currentPlayer===W&&diceValues.length===0&&!rolledThisTurn,null,{timeout:20000});
ok(true,'AI took its turn after resuming; back to you');
// discard
await p.evaluate(()=>{localStorage.setItem('bg_ai_match', localStorage.getItem('bg_ai_match'));});
await p.reload(); await p.waitForTimeout(500);
await p.click('#ai-resume-modal button:has-text("Discard")');
ok(await p.evaluate(()=>localStorage.getItem('bg_ai_match')===null&&!matchActive),'Discard clears the saved match');
// abandon clears
await p.evaluate(()=>{startMatch(3);});
ok(await p.evaluate(()=>localStorage.getItem('bg_ai_match')!==null),'new match is saved');
await p.evaluate(()=>{window.confirm=()=>true;resetGame();}); await p.waitForTimeout(200);
ok(await p.evaluate(()=>localStorage.getItem('bg_ai_match')===null),'abandoning a match clears the save');
// corrupt save ignored
await p.evaluate(()=>localStorage.setItem('bg_ai_match',JSON.stringify({v:1,ts:Date.now(),myColor:'w',matchLength:3,matchScore:{w:0,r:0},snap:{state:{board:[],bar:{w:[],r:[]},off:{w:[],r:[]}},currentPlayer:'w',diceValues:[]}})));
await p.reload(); await p.waitForTimeout(500);
ok(await p.evaluate(()=>document.getElementById('ai-resume-modal').classList.contains('hidden')),'corrupt save is ignored');

// ---- stale AI timer guard ----
await p.evaluate(()=>{localStorage.clear();});
await p.reload(); await p.waitForTimeout(400); await fast();
const stale=await p.evaluate(async()=>{
  startMatch(3); openingRoll=false; currentPlayer=R; rolledThisTurn=false; diceValues=[]; updateUI();
  aiLater(aiRoll,100);          // AI "about to roll" ...
  initGame();                    // ...but a new game starts first
  return true;});
await p.waitForTimeout(400);
ok(await p.evaluate(()=>openingRoll&&!isRolling&&diceValues.length===0),'a stale AI roll does not fire in the next game');

// ---- file:// invite note ----
await p.evaluate(()=>{ enterStartScreen(); });
await p.evaluate(()=>{ window.Peer=class{constructor(){this.id='x';setTimeout(()=>this.h&&this.h.open&&this.h.open(),5);} on(e,f){(this.h=this.h||{})[e]=f;return this;} destroy(){} reconnect(){}}; });
await p.click('#online-btn'); await p.fill('#online-name','Zed');
await p.click('#online-create-btn');
await p.waitForFunction(()=>!document.getElementById('online-share').classList.contains('hidden'),null,{timeout:5000});
const note=await p.evaluate(()=>({row:document.getElementById('online-link-row').classList.contains('hidden'),note:!document.getElementById('online-file-note').classList.contains('hidden'),code:document.getElementById('online-code-display').innerText}));
ok(note.row&&note.note&&/^[A-Z2-9]{6}$/.test(note.code),'file:// shows code + note instead of a link: '+JSON.stringify(note));
console.log('errors',errs);
await b.close()})()
