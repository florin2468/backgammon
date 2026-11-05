// Online play between browser pages (A = host, B = guest, C and D = spectators or later players). The pages talk
// through a mock of the PeerJS API, so no network is needed. setTimeout runs 20x faster inside the pages.
// usage: node online.js <scenario> [option]
//   play and connection: drop | blackhole | reloadguest | reloadhost | timer | rematch | swap | swapguest | swapno |
//                        nextgame | concede | lobby | rollcol | blocked
//   spectators and seats: spectate | specreload | latejoin | seats [variant] | phoneonline
//   features:            winchance | openplay guest|host | nohint | tierace [ms] [A|B]
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const FILE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');
const OUTDIR = (process.env.BG_OUT || require('os').tmpdir()) + '/';
const scenario = process.argv[2] || 'drop';
const SCENARIOS = ['drop', 'blackhole', 'reloadguest', 'reloadhost', 'timer', 'rematch', 'swap', 'swapguest', 'swapno', 'nextgame', 'concede', 'lobby',
  'rollcol', 'blocked', 'swapview', 'grace', 'spectate', 'specreload', 'latejoin', 'seats', 'phoneonline', 'winchance', 'openplay', 'nohint', 'tierace', 'stress', 'fairdice', 'cheathost', 'cheatguest', 'wake'];
if (!SCENARIOS.includes(scenario)) { console.error('FAIL unknown scenario ' + scenario); process.exit(2); }
let FAILS = 0;
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) FAILS++; };

const MOCK = `
(() => {
  class Emitter { on(e, f) { (this._h = this._h || {})[e] = (this._h[e] || []).concat(f); return this; } emit(e, ...a) { ((this._h || {})[e] || []).forEach(f => f(...a)); } }
  window.__peers = {};
  class MockConn extends Emitter {
    constructor(peer, remote, cid) { super(); this.peer = peer.id; this.remote = remote; this.cid = cid; this.open = false; this.closed = false; }
    send(d) { if (!this.open) throw new Error('not open'); window.__out({ op: 'data', to: this.remote, cid: this.cid, d: JSON.parse(JSON.stringify(d)) }); }
    close() { if (this.closed) return; this.closed = true; this.open = false; window.__out({ op: 'close', to: this.remote, cid: this.cid }); this.emit('close'); }
  }
  window.Peer = class Peer extends Emitter {
    constructor(id) { super(); this.id = id || 'g' + Math.random().toString(36).slice(2, 9); this.destroyed = false; this.disconnected = false; this.open = false; this._c = {}; window.__peers[this.id] = this;
      setTimeout(() => window.__out({ op: 'reg', id: this.id }).then(ok => { if (this.destroyed) return; if (ok) { this.open = true; this.emit('open', this.id); } else this.emit('error', { type: 'unavailable-id' }); }), 10); }
    connect(rid, opts) { const cid = Math.random().toString(36).slice(2); const c = new MockConn(this, rid, cid); this._c[cid] = c;
      window.__out({ op: 'connect', from: this.id, to: rid, cid, meta: opts && opts.metadata }).then(ok => { if (!ok) this.emit('error', { type: 'peer-unavailable' }); }); return c; }
    reconnect() {}
    destroy() { this.destroyed = true; this.open = false; Object.values(this._c).forEach(c => c.close()); window.__out({ op: 'unreg', id: this.id }); }
  };
  window.__in = m => {
    if (m.op === 'incoming') { const p = window.__peers[m.to]; if (!p || p.destroyed) return; const c = new MockConn(p, m.from, m.cid); c.metadata = m.meta; p._c[m.cid] = c; p.emit('connection', c); setTimeout(() => { c.open = true; c.emit('open'); }, 5); }
    else if (m.op === 'opened') { const p = window.__peers[m.to]; const c = p && p._c[m.cid]; if (c) { c.open = true; c.emit('open'); } }
    else if (m.op === 'data' || m.op === 'close') { const p = window.__peers[m.to]; const c = p && p._c[m.cid]; if (c) { if (m.op === 'data') c.emit('data', m.d); else { c.closed = true; c.open = false; c.emit('close'); } } }
  };
})();`;

const BOT = (opts) => `
  window.__log = window.__log || { moves: 0, undos: 0, bad: 0, rematchClicks: 0 };
  clearInterval(window.__driver);
  window.__driver = setInterval(() => {
    if (!online.active || window.__botOff) return;
    if (online.paused) return;
    const click = el => el.click();
    const wrap = document.getElementById('next-game-wrap');
    if (!wrap.classList.contains('hidden')) {
      const rb = document.getElementById('rematch-btn'), nb = document.getElementById('next-game-btn');
      if (!rb.classList.contains('hidden')) { if (!rb.disabled && ${opts.rematch}) { click(rb); __log.rematchClicks++; } return; }
      if (!nb.disabled && !nb.classList.contains('hidden') && ${opts.next}) click(nb);
      return;
    }
    if (!gameActive || isAnimating || isRolling || currentPlayer !== myColor) return;
    const rbtn = document.getElementById('roll-btn');
    if (!rbtn.disabled && (openingRoll || (diceValues.length === 0 && !rolledThisTurn))) { click(rbtn); return; }
    if (diceValues.length > 0) {
      const ms = getAllMoves(myColor, diceValues);
      if (!ms.length) return;
      if (selectedSource === null && turnHistory.length > 0 && Math.random() < 0.08) { click(document.getElementById('undo-btn')); __log.undos++; return; }
      if (selectedSource === null) { const m = ms[Math.floor(Math.random() * ms.length)]; if (m.from === 'bar') click(document.getElementById('bar-bottom')); else click(pointElements[m.from].querySelector('.hitbox')); if (selectedSource !== m.from) __log.bad++; }
      else { const t = validTargets[Math.floor(Math.random() * validTargets.length)]; if (!t) { selectedSource = null; return; } const b = JSON.stringify(state); if (t.target === 'off') click(document.getElementById(homeOrientation === 'RIGHT' ? 'tray-right' : 'tray-left')); else click(pointElements[t.target].querySelector('.hitbox')); if (JSON.stringify(state) !== b) __log.moves++; else __log.bad++; }
    }
  }, 25);`;

(async () => {
  const browser = await chromium.launch();
  const registry = {}, chain = new Map();
  let blackhole = false;
  const out = (...a) => { if (/^FAIL\b/.test(String(a[0]))) FAILS++; console.log(...a); };
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await ctx.newPage();
    page.name = name; page.errors = []; page.desyncs = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('console', m => { if (m.text().startsWith('Online desync')) page.desyncs.push(m.text()); else if (m.type() === 'error' && /unknown message type/.test(m.text())) page.errors.push(m.text()); });
    page.on('dialog', d => d.accept());
    page.on('framenavigated', f => { if (f === page.mainFrame()) setTimeout(() => { for (const k of Object.keys(registry)) if (registry[k] === page && !page.__live.has(k)) delete registry[k]; }, 800); });
    page.__live = new Set();
    await page.addInitScript(MOCK);
    return page;
  };
  const A = await mk('A'), B = await mk('B'), C = await mk('C'), D = await mk('D');
  const deliver = (target, msg) => {
    if (blackhole) return Promise.resolve();
    const prev = chain.get(target) || Promise.resolve();
    const next = prev.then(() => new Promise(r => setTimeout(r, 3 + Math.random() * 12))).then(() => target.evaluate(m => window.__in(m), msg).catch(() => {}));
    chain.set(target, next); return next;
  };
  const hub = (from) => async (m) => {
    if (m.op === 'reg') { if (registry[m.id] && registry[m.id] !== from) return false; if (registry[m.id] === from && from.__live.has(m.id)) return false; registry[m.id] = from; from.__live.add(m.id); return true; }
    if (m.op === 'unreg') { delete registry[m.id]; from.__live.delete(m.id); return true; }
    if (m.op === 'connect') {
      const target = registry[m.to]; if (!target) return false;
      if (blackhole) return true;
      deliver(target, { op: 'incoming', to: m.to, from: m.from, cid: m.cid, meta: m.meta });
      deliver(from, { op: 'opened', to: m.from, cid: m.cid });
      return true;
    }
    if (m.op === 'data' || m.op === 'close') { const target = registry[m.to]; if (target) deliver(target, m); return true; }
  };
  await A.exposeFunction('__out', hub(A)); await B.exposeFunction('__out', hub(B)); await C.exposeFunction('__out', hub(C)); await D.exposeFunction('__out', hub(D));
  // navigations forget the page's registrations (the server notices the disconnect)
  for (const pg of [A, B, C, D]) pg.on('framenavigated', f => { if (f === pg.mainFrame()) pg.__live.clear(); });

  const speed = p => p.evaluate(() => { const o = window.setTimeout.bind(window); window.setTimeout = (f, ms, ...a) => o(f, (ms || 0) / 20, ...a); soundEnabled = false; });
  const cfg = (p, c) => p.evaluate(c => { Object.assign(online.cfg, c); }, c);
  const snap = p => p.evaluate(() => ({ sig: fastSig(), cur: currentPlayer, dice: JSON.stringify(diceValues), paused: online.paused, active: online.active, myColor, moves: window.__log ? __log.moves : 0, score: JSON.stringify(matchScore), games: gamesPlayed, status: document.getElementById('status-banner').innerText, banner: document.getElementById('net-banner').classList.contains('hidden') ? '' : document.getElementById('net-banner-text').innerText }));
  const idle = p => p.evaluate(() => !isAnimating && !isRolling);


    async function lobbyDo(A, B, timerSecs, pts) {
      await A.waitForFunction(() => lobby.phase, null, { timeout: 15000 }); await B.waitForFunction(() => lobby.phase, null, { timeout: 15000 });
      if (timerSecs) for (const pg of [A, B]) await pg.evaluate(t => { const s = document.getElementById('lobby-timer'); if (![...s.options].some(o => o.value === String(t))) s.add(new Option(t + 's', String(t))); s.value = String(t); lobbyTimerChanged(); }, timerSecs);
      for (const pg of [A, B]) { await pg.click('#lobby-len-' + pts); }
      await A.click('#lobby-confirm'); await B.click('#lobby-confirm');
    }
  async function setup(timerSecs, pts, rematchBots) {
    await A.goto('file://' + FILE, { waitUntil: 'load' }); await A.waitForTimeout(400); await speed(A);
    await cfg(A, { hbEvery: 300, hbTimeout: 1500, recoverEvery: 300, attemptAge: 1000, grace: 4000 });
    await A.click('#online-btn'); await A.fill('#online-name', 'Alice');
    await A.click('#online-create-btn');
    await A.waitForSelector('#online-code-display:not(:empty)');
    const link = await A.inputValue('#online-link');
    await B.goto(link, { waitUntil: 'load' }); await B.waitForTimeout(400); await speed(B);
    await cfg(B, { hbEvery: 300, hbTimeout: 1500, recoverEvery: 300, attemptAge: 1000, grace: 4000 });
    await B.fill('#online-name', 'Bob'); await B.click('#online-join-btn');
    await lobbyDo(A, B, timerSecs, pts);
    await A.waitForFunction(() => online.active); await B.waitForFunction(() => online.active);
  }
  // Online dice come from both players' secrets (fair dice); a test fixes them by roll: { 'host:1': [3, 4], 'guest:1': [5, 2] }
  // (role:roll number), on every page so that both sides agree.
  const forceDice = (pages, table) => Promise.all(pages.map(p => p.evaluate(t => { window.__forced = t;
    if (!window.__fd) { window.__fd = fairDice; fairDice = function (x, r, role, k) { const f = window.__forced && window.__forced[role + ':' + k]; return f ? f.slice() : window.__fd(x, r, role, k); }; } }, table)));
  const startBots = async (pgs, opts) => { for (const p of pgs) await p.evaluate(BOT(opts)); };
  const sameSig = async () => { const [a, b] = await Promise.all([snap(A), snap(B)]); return { same: a.sig === b.sig && a.cur === b.cur && a.dice === b.dice && a.score === b.score, a, b }; };
  const settle = async (ms = 6000) => { const t0 = Date.now(); let r; while (Date.now() - t0 < ms) { await A.waitForTimeout(250); const [ia, ib] = await Promise.all([idle(A), idle(B)]); if (ia && ib) { r = await sameSig(); if (r.same) return r; } } return r || await sameSig(); };


  if (scenario === 'spectate') {
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    const sigOf = p => p.evaluate(() => JSON.stringify({ s: state, cp: currentPlayer, d: diceValues, sc: matchScore, g: gamesPlayed }));
    const posKey = p => p.evaluate(() => { const mine = myColor === 'w' ? 'checker-white' : 'checker-red';
      return [...document.querySelectorAll('.checker')].filter(e => e.getBoundingClientRect().width > 0).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x / 3), Math.round(r.y / 3), e.classList.contains(mine) ? 'me' : 'o']; }).sort().join('|'); });
    await A.goto('file://' + FILE, { waitUntil: 'load' }); await A.waitForTimeout(400); await speed(A);
    await cfg(A, { hbEvery: 300, hbTimeout: 1500, recoverEvery: 300, attemptAge: 1000, grace: 4000 });
    await A.click('#online-btn'); await A.fill('#online-name', 'Alice');
    await A.click('#online-create-btn');
    await A.waitForSelector('#online-code-display:not(:empty)');
    const link = await A.inputValue('#online-link'), code = await A.innerText('#online-code-display');
    await B.goto(link, { waitUntil: 'load' }); await B.waitForTimeout(400); await speed(B);
    await cfg(B, { hbEvery: 300, hbTimeout: 1500, recoverEvery: 300, attemptAge: 1000, grace: 4000 });
    await B.fill('#online-name', 'Bob'); await B.click('#online-join-btn');
    await A.waitForFunction(() => lobby.phase, null, { timeout: 15000 }); await B.waitForFunction(() => lobby.phase, null, { timeout: 15000 });
    // 1) a spectator who arrives while the players are still choosing settings waits
    await C.goto('file://' + FILE, { waitUntil: 'load' }); await C.waitForTimeout(400); await speed(C);
    await C.evaluate(() => { window.__sent = []; const ns = netSend; netSend = function (o) { __sent.push(o && o.t); return ns.apply(this, arguments); }; });
    await C.click('#online-btn'); await C.fill('#online-name', 'Carol'); await C.fill('#online-code', code); await C.click('#online-watch-btn');
    let ok1 = await C.waitForFunction(() => /haven't started/.test(document.getElementById('online-wait-msg').innerText), null, { timeout: 15000 }).then(() => true, () => false);
    const c1 = await C.evaluate(() => ({ on: watch.on, modal: !document.getElementById('online-modal').classList.contains('hidden'), msg: document.getElementById('online-wait-msg').innerText }));
    chk(ok1 && !c1.on && c1.modal, 'spectator before the start waits: "' + c1.msg + '"');
    // 2) a third person with the players' link during the lobby is told the game is taken
    await D.goto(link, { waitUntil: 'load' }); await D.waitForTimeout(400); await speed(D);
    await D.fill('#online-name', 'Dan'); await D.click('#online-join-btn');
    const ok2 = await D.waitForFunction(() => /already has two players/.test(document.getElementById('online-error').innerText), null, { timeout: 15000 }).then(() => true, () => false);
    chk(ok2, 'a third player during the lobby is told: "' + (await D.innerText('#online-error')).slice(0, 90) + '"');
    const lob = await Promise.all([A, B].map(p => p.evaluate(() => ({ phase: !!lobby.phase, active: online.active }))));
    chk(lob.every(l => l.phase && !l.active), 'the players are still in their settings screen, undisturbed');
    // 3) the players start; the waiting spectator is shown the game straight away
    await lobbyDo(A, B, 0, 3);
    await A.waitForFunction(() => online.active); await B.waitForFunction(() => online.active);
    const ok3 = await C.waitForFunction(() => watch.on, null, { timeout: 15000 }).then(() => true, () => false);
    await C.waitForTimeout(700);
    const c3 = await C.evaluate(() => ({ modal: !document.getElementById('online-modal').classList.contains('hidden'), me: document.getElementById('me-name').innerText, opp: document.getElementById('opp-name').innerText, status: document.getElementById('status-banner').innerText, info: document.getElementById('spec-info').innerText, myColor, rollDis: document.getElementById('roll-btn').disabled, hint: document.getElementById('hint-btn').classList.contains('hidden') }));
    const aColor = await A.evaluate(() => myColor);
    chk(ok3 && !c3.modal && c3.me === 'Alice' && c3.opp === 'Bob' && c3.myColor === aColor, 'spectator now sees the game, from Alice\'s side: bottom "' + c3.me + '", top "' + c3.opp + '"');
    chk(c3.rollDis && c3.hint && /watching Alice vs Bob/.test(c3.info), 'spectator: Roll Dice off, hint hidden, note: "' + c3.info + '" | status: "' + c3.status + '"');
    await A.waitForTimeout(500);
    const cnt = await Promise.all([A, B].map(p => p.evaluate(() => document.getElementById('spec-info').innerText)));
    chk(cnt.every(t => /1 watching: Carol/.test(t)), 'both players see: "' + cnt[0] + '" / "' + cnt[1] + '"');
    // 4) the game is played; the spectator's board follows the host's
    await startBots([A, B], { rematch: 'false', next: 'true' });
    let agree = 0, tries = 0;
    for (let i = 0; i < 6; i++) {
      await A.waitForTimeout(800 + Math.random() * 1500);
      for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
      await A.waitForFunction(() => !isAnimating && !isRolling, null, { timeout: 10000 }).catch(() => {}); await A.waitForTimeout(1200);
      const a1 = await sigOf(A), c = await sigOf(C);
      tries++; if (c === a1) agree++; else out('   differs: host', a1.slice(0, 120), '| spectator', c.slice(0, 120));
      for (const p of [A, B]) await p.evaluate(() => { window.__botOff = false; });
    }
    chk(tries > 0 && agree >= tries - 1, `spectator's position, dice and score equal the host's at ${agree} of ${tries} quiet moments`);
    const moved = await A.evaluate(() => __log.moves);
    chk(moved > 5, 'the players kept playing (' + moved + ' moves by Alice)');
    // 5) the spectator cannot do anything
    const before = await sigOf(A);
    await C.evaluate(() => { handleRollDice(); undoMove(); showHint(); for (let i = 0; i < 24; i++) pointElements[i].querySelector('.hitbox').click(); document.getElementById('bar-bottom').click(); });
    const sent = await C.evaluate(() => [...new Set(__sent)]);
    chk(sent.every(t => t === 'hello' || t === 'ping'), 'spectator only ever sent: ' + JSON.stringify(sent));
    // 6) someone joins mid-game and sees the current position at once
    await D.fill('#online-code', code); await D.click('#online-watch-btn');
    const ok6 = await D.waitForFunction(() => watch.on, null, { timeout: 15000 }).then(() => true, () => false);
    await D.waitForTimeout(600);
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
    await A.waitForFunction(() => !isAnimating && !isRolling, null, { timeout: 10000 }); await A.waitForTimeout(1500);
    const [sa, sd] = [await sigOf(A), await sigOf(D)];
    chk(ok6 && sa === sd, 'a spectator who joins mid-game gets the current position straight away');
    await A.waitForTimeout(600);
    const cnt2 = await Promise.all([A, B, C].map(p => p.evaluate(() => document.getElementById('spec-info').innerText)));
    chk(/2 watching: Carol, Dan/.test(cnt2[0]) && /2 watching/.test(cnt2[1]) && /with 1 other/.test(cnt2[2]), 'count updated: "' + cnt2[0] + '" | "' + cnt2[1] + '" | spectator: "' + cnt2[2] + '"');
    // 7) colours swapped by the players: the spectator's picture stays put (it follows Alice)
    const pk0 = await posKey(D);
    await A.evaluate(() => setMyColor(myColor === 'w' ? 'r' : 'w'));
    await B.waitForSelector('#swap-modal:not(.hidden)', { timeout: 5000 }); await B.click('#swap-modal button:has-text("Swap")');
    await A.waitForFunction(() => !online.swapPhase && !online.swapFreeze, null, { timeout: 10000 });
    await A.waitForTimeout(2200);
    const pk1 = await posKey(D);
    const dv = await D.evaluate(() => ({ me: document.getElementById('me-name').innerText, my: myColor }));
    const aNow = await A.evaluate(() => myColor);
    chk(pk0 === pk1 && dv.me === 'Alice' && dv.my === aNow, 'after the players swap colours the spectator still sees Alice at the bottom, every checker in place');
    chk(await sigOf(A) === await sigOf(D), 'and the position still matches the host');
    // 8) the spectator turns the board to Bob's side
    await D.evaluate(() => setMyColor(myColor === 'w' ? 'r' : 'w')); await D.waitForTimeout(500);
    const dv2 = await D.evaluate(() => ({ me: document.getElementById('me-name').innerText, opp: document.getElementById('opp-name').innerText, lbl: document.getElementById('play-as-label').innerText }));
    chk(dv2.me === 'Bob' && dv2.opp === 'Alice' && dv2.lbl === 'View From', 'spectator switched the view: bottom "' + dv2.me + '", top "' + dv2.opp + '", settings label "' + dv2.lbl + '"');
    chk(await sigOf(A) === await sigOf(D), 'changing the view did not change the game');
    // 9) Carol stops watching; the players' count drops
    await C.evaluate(() => resetGame()); await C.waitForTimeout(400);
    const cOff = await C.evaluate(() => ({ on: watch.on, startBtn: !document.getElementById('start-match-btn').classList.contains('hidden'), online: !document.getElementById('online-btn').classList.contains('hidden'), hint: !document.getElementById('hint-btn').classList.contains('hidden') }));
    chk(!cOff.on && cOff.startBtn && cOff.online && cOff.hint, 'Carol is back on her start screen');
    const okCnt = await A.waitForFunction(() => /1 watching: Dan/.test(document.getElementById('spec-info').innerText), null, { timeout: 8000 }).then(() => true, () => false);
    chk(okCnt, 'players now see: "' + await A.innerText('#spec-info') + '"');
    // 10) the guest's connection drops: the spectator is told, and the game carries on afterwards
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = false; });
    await B.evaluate(() => online.conn.close());
    const ok10 = await D.waitForFunction(() => /connection dropped/.test(document.getElementById('status-banner').innerText), null, { timeout: 8000 }).then(() => true, () => false);
    chk(ok10, 'spectator sees: "' + (await D.innerText('#status-banner')) + '"');
    await A.waitForFunction(() => !online.paused, null, { timeout: 15000 });
    await A.waitForTimeout(1500);
    const ok10b = await D.waitForFunction(() => !/connection dropped/.test(document.getElementById('status-banner').innerText), null, { timeout: 8000 }).then(() => true, () => false);
    chk(ok10b, 'after Bob is back the spectator follows the game again: "' + (await D.innerText('#status-banner')) + '"');
    // 11) to the end of the match
    const ok11 = await A.waitForFunction(() => matchOver, null, { timeout: 150000 }).then(() => true, () => false);
    await D.waitForTimeout(1500);
    const d11 = await D.evaluate(() => ({ st: document.getElementById('status-banner').innerText, anim: !!document.querySelector('canvas[aria-hidden="true"]'), sc: JSON.stringify(matchScore), next: !document.getElementById('next-game-wrap').classList.contains('hidden') }));
    const a11 = await A.evaluate(() => JSON.stringify(matchScore));
    chk(ok11 && /Match over/.test(d11.st) && d11.sc === a11 && !d11.next, 'spectator saw the match end: "' + d11.st + '", celebration: ' + d11.anim);
    // 12) the host goes back to the menu: the spectator is told the game is over
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
    await A.evaluate(() => leaveOnline(true));
    const ok12 = await D.waitForFunction(() => /players have left|connection to the game was lost/.test(document.getElementById('status-banner').innerText), null, { timeout: 15000 }).then(() => true, () => false);
    chk(ok12, 'spectator after the host left: "' + (await D.innerText('#status-banner')) + '"');
    await D.evaluate(() => resetGame()); await D.waitForTimeout(300);
    chk(!(await D.evaluate(() => watch.on)), 'and goes back to the start screen without a question');
    chk(A.desyncs.length === 0 && B.desyncs.length === 0 && [A, B, C, D].every(p => p.errors.length === 0), 'no desyncs or page errors');
  }

  if (scenario === 'specreload') {
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    await setup(0, 5); await startBots([A, B], { rematch: 'false', next: 'true' });
    const code = await A.evaluate(() => online.code);
    await C.goto('file://' + FILE, { waitUntil: 'load' }); await C.waitForTimeout(400); await speed(C);
    await C.click('#online-btn'); await C.fill('#online-name', 'Carol'); await C.fill('#online-code', code); await C.click('#online-watch-btn');
    await C.waitForFunction(() => watch.on, null, { timeout: 15000 });
    const compare = async () => {
      for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
      await A.waitForFunction(() => !isAnimating && !isRolling, null, { timeout: 10000 }).catch(() => {}); await A.waitForTimeout(3000);
      const sa = await A.evaluate(() => JSON.stringify({ s: state, cp: currentPlayer, d: diceValues, sc: matchScore }));
      const sc = await C.evaluate(() => JSON.stringify({ s: state, cp: currentPlayer, d: diceValues, sc: matchScore }));
      for (const p of [A, B]) await p.evaluate(() => { window.__botOff = false; });
      return sa === sc;
    };
    await A.waitForTimeout(3000);
    chk(await compare(), 'spectator in step before the reloads');
    for (const [R, who] of [[B, 'guest'], [A, 'host']]) {
      await R.reload({ waitUntil: 'load' }); await R.waitForTimeout(500);
      const mid = await C.evaluate(() => document.getElementById('status-banner').innerText + ' | banner: ' + (document.getElementById('net-banner').classList.contains('hidden') ? '-' : document.getElementById('net-banner-text').innerText));
      out('   while the ' + who + ' reloads the spectator sees: ' + mid);
      await speed(R); await cfg(R, { hbEvery: 300, hbTimeout: 1500, recoverEvery: 300, attemptAge: 1000, grace: 20000 });
      await R.click('#resume-modal button:has-text("Resume")');
      await A.waitForFunction(() => online.active && !online.paused, null, { timeout: 30000 }); await B.waitForFunction(() => online.active && !online.paused, null, { timeout: 30000 });
      await startBots([R], { rematch: 'false', next: 'true' });
      for (let k = 0; k < 6; k++) { await C.waitForTimeout(3000); out('     C:', JSON.stringify(await C.evaluate(() => ({ role: online.role, relay: watch.viaRelay, conn: online.conn ? [online.conn.constructor.name, online.conn.open, online.conn.remote || ''] : null, peer: online.peer ? [online.peer.id, online.peer.open, online.peer.destroyed] : null, rx: Date.now() - watch.lastRx, ok: Date.now() - watch.lastOk, ended: watch.ended, banner: document.getElementById('net-banner').classList.contains('hidden') ? '' : document.getElementById('net-banner-text').innerText }))), '| host specs:', await A.evaluate(() => specHost.list.length + ' code ' + online.code + ' peer ' + (online.peer && online.peer.id))); }
      const back = await C.waitForFunction(() => watch.on && !watch.ended && document.getElementById('net-banner').classList.contains('hidden') && !/dropped/.test(document.getElementById('status-banner').innerText), null, { timeout: 40000 }).then(() => true, () => false);
      await A.waitForTimeout(2500);
      chk(back && await compare(), `after the ${who} reloaded and resumed, the spectator is back in step`);
      const cnt = await Promise.all([A, B].map(p => p.waitForFunction(() => /1 watching: Carol/.test(document.getElementById('spec-info').innerText), null, { timeout: 15000 }).then(() => true, () => false)));
      chk(cnt.every(Boolean), 'both players see the spectator again');
    }
    chk([A, B, C].every(p => p.errors.length === 0) && A.desyncs.length === 0 && B.desyncs.length === 0, 'no errors');
  }

  if (scenario === 'latejoin') {
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    const SH = OUTDIR;
    await setup(0, 3); await startBots([A, B], { rematch: 'false', next: 'true' });
    const link = await A.evaluate(() => location.href.split('#')[0] + '#room=' + online.code);
    await A.waitForTimeout(2500);
    await D.goto(link, { waitUntil: 'load' }); await D.waitForTimeout(400); await speed(D);
    await D.fill('#online-name', 'Dan');
    await D.screenshot({ path: SH + 'spec_modal.png' });
    await D.click('#online-join-btn');
    const ok1 = await D.waitForFunction(() => /already started/.test(document.getElementById('online-error').innerText), null, { timeout: 15000 }).then(() => true, () => false);
    chk(ok1, 'someone using the players\' link after the start is told: "' + await D.innerText('#online-error') + '"');
    const players = await Promise.all([A, B].map(p => p.evaluate(() => ({ active: online.active, paused: online.paused }))));
    chk(players.every(x => x.active && !x.paused), 'the players were not disturbed');
    await D.click('#online-watch-btn');
    const ok2 = await D.waitForFunction(() => watch.on, null, { timeout: 15000 }).then(() => true, () => false);
    chk(ok2, 'pressing Watch then follows the game');
    // a watch link opens the online window ready to watch
    const wlink = await A.evaluate(() => location.href.split('#')[0] + '#watch=' + online.code);
    await C.goto(wlink, { waitUntil: 'load' }); await C.waitForTimeout(500);
    const cw = await C.evaluate(() => ({ modal: !document.getElementById('online-modal').classList.contains('hidden'), code: document.getElementById('online-code').value, hint: document.getElementById('online-watch-hint').innerText }));
    chk(cw.modal && cw.code === (await A.evaluate(() => online.code)) && /invited to watch/.test(cw.hint), 'a #watch= link opens the online window with the code filled in: "' + cw.hint + '"');
    await C.screenshot({ path: SH + 'spec_watchlink.png' });
    await A.waitForTimeout(2500);
    await A.screenshot({ path: SH + 'spec_player.png' });
    await D.screenshot({ path: SH + 'spec_viewer.png' });
    await A.evaluate(() => toggleSettingsModal()); await A.waitForTimeout(300);
    await A.screenshot({ path: SH + 'spec_settings.png' });
    await A.evaluate(() => toggleSettingsModal());
    const ph = await D.context().newPage(); 
    await D.setViewportSize({ width: 390, height: 800 }); await D.waitForTimeout(800);
    await D.screenshot({ path: SH + 'spec_viewer_phone.png' });
    chk([A, B, C, D].every(p => p.errors.length === 0), 'no errors');
  }

  if (scenario === 'seats') {
    const variant = process.argv[3] || 'hostkeep';
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    const txt = (p, id) => p.evaluate(i => { const e = document.getElementById(i); return e ? e.innerText : ''; }, id);
    const vis = (p, id) => p.evaluate(i => { const e = document.getElementById(i); if (!e) return false; let x = e; while (x) { if (x.classList && x.classList.contains('hidden')) return false; x = x.parentElement; } return true; }, id);
    await setup(0, 1);
    const code0 = await A.evaluate(() => online.code);
    for (const [P, nm] of [[C, 'Carol'], [D, 'Dan']]) {
      await P.goto('file://' + FILE, { waitUntil: 'load' }); await P.waitForTimeout(300); await speed(P);
      await P.click('#online-btn'); await P.fill('#online-name', nm); await P.fill('#online-code', code0); await P.click('#online-watch-btn');
      await P.waitForFunction(() => watch.on, null, { timeout: 15000 });
    }
    await A.waitForFunction(() => /2 watching/.test(document.getElementById('spec-info').innerText), null, { timeout: 10000 });
    await startBots([A, B], { rematch: 'false', next: 'false' });
    const t0 = Date.now();
    const over = await A.waitForFunction(() => matchOver, null, { timeout: 180000 }).then(() => true, () => false);
    out('   match over after', ((Date.now() - t0) / 1000).toFixed(0), 's:', over, JSON.stringify(await A.evaluate(() => ({ st: document.getElementById('status-banner').innerText, ga: gameActive, mo: matchOver, moves: __log.moves, open: openingRoll, cp: currentPlayer, me: myColor, dice: diceValues, paused: online.paused }))), JSON.stringify(await B.evaluate(() => ({ st: document.getElementById('status-banner').innerText, moves: __log.moves, me: myColor }))));
    out('   A net:', JSON.stringify(await A.evaluate(() => ({ q: online.queue.length, q0: online.queue[0] && JSON.stringify(online.queue[0]).slice(0, 200), connOpen: online.conn && online.conn.open, swap: online.swapPhase, freeze: online.swapFreeze, applying: typeof applyingRemote !== 'undefined' && applyingRemote, anim: isAnimating, rolling: isRolling, specs: specHost.list.length, epoch: stateEpoch }))));
    await B.waitForFunction(() => matchOver, null, { timeout: 20000 }).catch(() => {});
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
    await A.waitForTimeout(800);
    const pa = await Promise.all([A, B].map(p => vis(p, 'after-choices')));
    chk(over && pa[0] && pa[1], 'match over: both players are asked Keep playing / Watch / Quit: "' + (await txt(A, 'after-text')) + '"');
    chk(!(await vis(A, 'rematch-btn')) && !(await vis(A, 'next-game-btn')), 'the plain Rematch / Back to Menu buttons are replaced by the choice');
    await C.waitForTimeout(500);
    chk(/deciding whether to play on/.test(await txt(C, 'status-banner')), 'spectators see: "' + (await txt(C, 'status-banner')) + '"');

    const choose = async (p, c) => { await p.click('#after-' + c); await p.waitForTimeout(300); };
    if (variant === 'bothkeep') {
      await choose(A, 'keep'); await choose(B, 'keep');
      const ok = await A.waitForFunction(() => online.active && !matchOver && gameActive, null, { timeout: 10000 }).then(() => true, () => false);
      await C.waitForTimeout(1500);
      const c = await C.evaluate(() => ({ on: watch.on, code: watch.code, mo: matchOver, st: document.getElementById('status-banner').innerText }));
      chk(ok && c.on && c.code === code0 && !c.mo, 'both keep playing: a rematch in the same room; the spectators carry on watching: "' + c.st + '"');
      chk(await A.evaluate(() => online.code) === code0, 'same game code');
    } else {
      if (variant === 'nobody') {
        const SH = OUTDIR;
        await A.screenshot({ path: SH + 'after_choice.png' });
        await A.evaluate(() => stopWinAnimation(true));
        await A.setViewportSize({ width: 390, height: 800 }); await A.waitForTimeout(700); await A.screenshot({ path: SH + 'after_choice_phone.png' });
        await A.setViewportSize({ width: 1100, height: 900 }); await A.waitForTimeout(400);
        await choose(A, 'keep'); await choose(B, 'watch'); await A.waitForTimeout(800);
        await C.screenshot({ path: SH + 'after_seatbtn.png' });
        await B.screenshot({ path: SH + 'after_guest.png' });
        await C.setViewportSize({ width: 390, height: 800 }); await C.waitForTimeout(600); await C.screenshot({ path: SH + 'after_seatbtn_phone.png' });
        for (const p of [C, D]) await p.evaluate(() => resetGame());
        const ok = await A.waitForFunction(() => /Nobody is watching/.test(document.getElementById('after-text').innerText), null, { timeout: 15000 }).then(() => true, () => false);
        chk(ok && /Back to Menu/.test(await txt(A, 'after-leave')), 'when the spectators have gone the host is told: "' + (await txt(A, 'after-text')) + '"');
        const okB = await B.waitForFunction(() => /Nobody is watching/.test(document.getElementById('after-text').innerText), null, { timeout: 10000 }).then(() => true, () => false);
        chk(okB, 'and so is the guest: "' + (await txt(B, 'after-text')) + '"');
        await A.click('#after-leave'); await A.waitForTimeout(600);
        chk(!(await A.evaluate(() => online.active)), 'Back to Menu works for the host');
        const g = await B.waitForFunction(() => !document.getElementById('next-game-btn').classList.contains('hidden') && /left/.test(document.getElementById('status-banner').innerText), null, { timeout: 10000 }).then(() => true, () => false);
        chk(g, 'the guest is told the host left and gets Back to Menu: "' + (await txt(B, 'status-banner')) + '"');
        await B.click('#next-game-btn'); await B.waitForTimeout(500);
        chk(!(await B.evaluate(() => online.active)) && !(await vis(B, 'after-panel')), 'guest back on the start screen');
        chk([A, B, C, D].every(p => p.errors.length === 0), 'no errors');
        await browser.close(); console.log(FAILS ? FAILS + ' FAILED' : 'ALL PASS'); process.exit(FAILS ? 1 : 0);
      }
      const plan = { hostkeep: ['keep', 'watch', [C]], hostquit: ['quit', 'keep', [D]], bothwatch: ['watch', 'watch', [C, D]], guestquit: ['keep', 'quit', [D]] }[variant];
      const [ca, cb, takers] = plan;
      await choose(A, ca); await choose(B, cb);
      await A.waitForTimeout(800);
      out('   host panel: "' + (await txt(A, 'after-text')) + '"');
      if (cb !== 'quit') out('   guest panel: "' + (await txt(B, 'after-text')) + '"', JSON.stringify(await B.evaluate(() => ({ on: after.on, ph: after.phase, v: after.v, sent: after.mineSent })))); else chk(!(await B.evaluate(() => online.active)) && /You left the game/.test(await txt(B, 'status-banner')), 'the guest who quit left straight away: "' + (await txt(B, 'status-banner')) + '"');
      const sv = await Promise.all([C, D].map(p => vis(p, 'seat-btn')));
      chk(sv[0] && sv[1], 'spectators get a "Take the free seat" button: "' + (await txt(C, 'status-banner')) + '"');
      for (const t of takers) { await t.click('#seat-btn'); await t.waitForTimeout(150); }
      // who ends up where
      const nameOf = new Map([[A, 'Alice'], [B, 'Bob'], [C, 'Carol'], [D, 'Dan']]);
      const players = []; if (ca === 'keep') players.push(A); if (cb === 'keep') players.push(B); takers.forEach(t => players.push(t));
      const [NH, NG] = players;
      const specs = [A, B, C, D].filter(p => !players.includes(p) && !(p === A && ca === 'quit') && !(p === B && cb === 'quit'));
      const quitters = [A, B].filter((p, i) => [ca, cb][i] === 'quit');
      const lob = await Promise.all([NH, NG].map(p => p.waitForFunction(() => lobby.phase, null, { timeout: 30000 }).then(() => true, () => false)));
      const intro = await Promise.all([NH, NG].map(p => txt(p, 'lobby-intro')));
      chk(lob.every(Boolean) && intro[0].includes(nameOf.get(NG)) && intro[1].includes(nameOf.get(NH)), `${nameOf.get(NH)} and ${nameOf.get(NG)} are on the settings screen of a new game: "${intro[0].slice(0, 40)}" / "${intro[1].slice(0, 40)}"`);
      const code1 = await NH.evaluate(() => online.code);
      chk(code1 && code1 !== code0 && (await NH.evaluate(() => online.role)) === 'host' && (await NG.evaluate(() => online.role)) === 'guest', `new room ${code1}, hosted by ${nameOf.get(NH)}`);
      for (const p of specs) {
        const w = await p.waitForFunction(() => online.role === 'spec' && /haven't started/.test(document.getElementById('online-wait-msg').innerText), null, { timeout: 30000 }).then(() => true, () => false);
        chk(w && (await p.evaluate(() => watch.code)) === code1, `${nameOf.get(p)} waits to watch the new game`);
      }
      for (const p of quitters) {
        if (p === B) continue;
        const q = await p.waitForFunction(() => !online.active && !online.role && /You left the game/.test(document.getElementById('status-banner').innerText), null, { timeout: 15000 }).then(() => true, () => false);
        chk(q, `${nameOf.get(p)} (quit) is back on the menu after handing over: "${await txt(p, 'status-banner')}"`);
      }
      await lobbyDo(NH, NG, 0, 3);
      const act = await Promise.all([NH, NG].map(p => p.waitForFunction(() => online.active, null, { timeout: 15000 }).then(() => true, () => false)));
      chk(act.every(Boolean) && (await NH.evaluate(() => matchLength)) === 3, 'the new pair started a 3-point match');
      for (const p of specs) {
        const w = await p.waitForFunction(() => watch.on, null, { timeout: 20000 }).then(() => true, () => false);
        await p.waitForTimeout(500);
        const v = await p.evaluate(() => ({ me: document.getElementById('me-name').innerText, opp: document.getElementById('opp-name').innerText, mo: matchOver }));
        chk(w && [v.me, v.opp].sort().join() === [nameOf.get(NH), nameOf.get(NG)].sort().join() && !v.mo, `${nameOf.get(p)} now watches ${v.me} vs ${v.opp}`);
      }
      const cnt = await NH.waitForFunction(n => new RegExp(n + ' watching').test(document.getElementById('spec-info').innerText), specs.length, { timeout: 15000 }).then(() => true, () => false);
      chk(cnt, `the new players see: "${await txt(NH, 'spec-info')}"`);
      // the new match really plays
      await startBots([NH, NG], { rematch: 'false', next: 'false' });
      await NH.waitForTimeout(5000);
      chk((await NH.evaluate(() => __log.moves)) + (await NG.evaluate(() => __log.moves)) > 3, 'the new match is being played');
      if (specs.length) {
        for (const p of [NH, NG]) await p.evaluate(() => { window.__botOff = true; });
        await NH.waitForFunction(() => !isAnimating && !isRolling, null, { timeout: 10000 }).catch(() => {}); await NH.waitForTimeout(2500);
        const sh = await NH.evaluate(() => JSON.stringify({ s: state, cp: currentPlayer, d: diceValues }));
        const ss = await specs[0].evaluate(() => JSON.stringify({ s: state, cp: currentPlayer, d: diceValues }));
        chk(sh === ss, `${nameOf.get(specs[0])}'s board matches the new host's`);
      }
    }
    chk([A, B, C, D].every(p => p.errors.length === 0) && [A, B, C, D].every(p => p.desyncs.length === 0), 'no errors or desyncs');
  }


  if (scenario === 'winchance') {
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    await setup(0, 3);
    const code = await A.evaluate(() => online.code);
    await C.goto('file://' + FILE, { waitUntil: 'load' }); await C.waitForTimeout(400); await speed(C);
    await C.click('#online-btn'); await C.fill('#online-name', 'Carol'); await C.fill('#online-code', code); await C.click('#online-watch-btn');
    await C.waitForFunction(() => watch.on, null, { timeout: 15000 });
    for (const p of [A, B, C]) await p.evaluate(() => { if (!winChanceOn) toggleWinChance(); });
    const view = p => p.evaluate(() => ({ me: document.getElementById('wp-me-name').textContent + ' ' + document.getElementById('wp-me-pct').textContent,
      opp: document.getElementById('wp-opp-pct').textContent + ' ' + document.getElementById('wp-opp-name').textContent, pW: wp.pW, key: wp.key, done: wp.done, worker: !!wp.worker, myColor }));
    await startBots([A, B], { rematch: 'false', next: 'true' });
    let same = 0, tries = 0, est = 0;
    for (let i = 0; i < 6; i++) {
      await A.waitForTimeout(700 + Math.random() * 1500);
      for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
      await A.waitForFunction(() => !isAnimating && !isRolling, null, { timeout: 10000 }).catch(() => {}); await A.waitForTimeout(1200);
      for (const p of [A, B, C]) await p.waitForFunction(() => !winChanceOn || wp.done || !String(wp.key).includes(':'), null, { timeout: 15000 }).catch(() => {});
      const v = await Promise.all([A, B, C].map(view));
      tries++;
      const ok = v.every(x => x.key === v[0].key && x.pW === v[0].pW);
      if (ok) same++; else out('   differ:', JSON.stringify(v.map(x => [x.key.slice(0, 30), x.pW])));
      if (v[0].key.includes(':')) est++;
      if (i === 0) out('   Alice sees "' + v[0].me + ' | ' + v[0].opp + '", Bob sees "' + v[1].me + ' | ' + v[1].opp + '", Carol sees "' + v[2].me + ' | ' + v[2].opp + '"');
      for (const p of [A, B]) await p.evaluate(() => { window.__botOff = false; });
    }
    chk(same === tries && est > 0, `both players and the spectator show the same chances at ${same} of ${tries} quiet moments (${est} mid-game estimates)`);
    const v = await Promise.all([A, B, C].map(view));
    chk(v.every(x => x.worker), 'every screen works it out in a background worker');
    const names = await Promise.all([A, B, C].map(p => p.evaluate(() => [document.getElementById('wp-me-name').textContent, document.getElementById('wp-opp-name').textContent])));
    chk(names[0][0] === 'YOU' && names[0][1] === 'Bob' && names[1][0] === 'YOU' && names[1][1] === 'Alice' && names[2][0] === 'Alice' && names[2][1] === 'Bob', 'names on the meter: ' + JSON.stringify(names));
    chk([A, B, C].every(p => p.errors.length === 0) && [A, B].every(p => p.desyncs.length === 0), 'no errors or desyncs ' + JSON.stringify([A, B, C].map(p => p.errors.slice(0, 2))));
  }

  if (scenario === 'openplay') {
    const who = process.argv[3] || 'guest';
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    await setup(0, 1);
    const code = await A.evaluate(() => online.code);
    await C.goto('file://' + FILE, { waitUntil: 'load' }); await C.waitForTimeout(400); await speed(C);
    await C.click('#online-btn'); await C.fill('#online-name', 'Carol'); await C.fill('#online-code', code); await C.click('#online-watch-btn');
    await C.waitForFunction(() => watch.on, null, { timeout: 15000 });
    await forceDice([A, B, C], who === 'guest' ? { 'host:1': [1, 2], 'guest:1': [5, 4] } : { 'host:1': [6, 6], 'guest:1': [3, 1] });
    for (const p of [A, B]) await p.evaluate(() => { window.__sent = []; const ns = netSend; netSend = function (o) { __sent.push(o && o.t); return ns.apply(this, arguments); }; });
    await A.click('#roll-btn');
    await A.waitForFunction(() => openRolls[myColor] && !isRolling); await B.waitForFunction(() => openRolls[oppColor()] && !isRolling);
    await B.click('#roll-btn');
    await A.waitForFunction(() => !openingRoll, null, { timeout: 15000 }); await B.waitForFunction(() => !openingRoll, null, { timeout: 15000 });
    await A.waitForTimeout(400);
    const W_ = who === 'guest' ? B : A, L_ = who === 'guest' ? A : B;
    const winName = who === 'guest' ? 'Bob' : 'Alice';
    const expDice = who === 'guest' ? '[5,4]' : '[6,6,6,6]', what = who === 'guest' ? '5 and 4' : 'double 6s';
    const inf = p => p.evaluate(() => ({ cp: currentPlayer, me: myColor, dice: JSON.stringify(diceValues), rollDis: document.getElementById('roll-btn').disabled, status: document.getElementById('status-banner').innerText,
      faces: ['die-1', 'die-2'].map(id => +(/(\d)$/.exec(document.getElementById(id).getAttribute('aria-label') || '') || [0, 0])[1]).join('-') }));
    const w = await inf(W_), l = await inf(L_);
    chk(w.cp === w.me && w.dice === expDice && w.rollDis, `${winName} (winner) moves at once with the opening dice ${w.dice}, no Roll Dice`);
    chk(new RegExp('You go first and play your ' + what).test(w.status), 'winner reads: "' + w.status + '"');
    chk(l.cp === w.me && l.dice === expDice && l.rollDis && new RegExp(winName + ' goes first and plays their ' + what).test(l.status), 'other player reads: "' + l.status + '"');
    await C.waitForTimeout(800);
    const c = await C.evaluate(() => ({ dice: JSON.stringify(diceValues), cp: currentPlayer, status: document.getElementById('status-banner').innerText, faces: ['die-1', 'die-2'].map(id => +(/(\d)$/.exec(document.getElementById(id).getAttribute('aria-label') || '') || [0, 0])[1]).join('-') }));
    chk(c.dice === expDice && c.cp === w.me && c.faces === w.faces, 'spectator sees the same dice (' + c.faces + ') and whose move it is: "' + c.status + '"');
    // the winner plays those dice (by clicking), then the other player rolls as normal
    const nMoves = who === 'guest' ? 2 : 4;
    await W_.evaluate(() => { __sent.length = 0; });                 // (the guest's own opening roll was a request too)
    for (let k = 0; k < nMoves; k++) {
      await W_.evaluate(() => { const ms = getAllMoves(myColor, diceValues); const m = ms[0]; if (m.from === 'bar') document.getElementById('bar-bottom').click(); else pointElements[m.from].querySelector('.hitbox').click(); const t = validTargets.find(x => x.target === m.target) || validTargets[0]; if (t.target === 'off') document.getElementById(homeOrientation === 'RIGHT' ? 'tray-right' : 'tray-left').click(); else pointElements[t.target].querySelector('.hitbox').click(); });
      await W_.waitForTimeout(250);
    }
    await L_.waitForFunction(() => currentPlayer === myColor && !isAnimating && !rolledThisTurn, null, { timeout: 15000 }).catch(() => {});
    await A.waitForTimeout(500);
    const r = await sameSig();
    const lr = await inf(L_);
    const sentW = await W_.evaluate(() => __sent.filter(t => t === 'rollReq' || t === 'roll').length);
    chk(r.same && lr.cp === lr.me && !lr.rollDis, `both boards agree after the opening move; now ${who === 'guest' ? 'Alice' : 'Bob'} has Roll Dice`);
    chk(sentW === 0, 'the winner never asked for a roll during that first turn');
    await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForFunction(() => matchOver, null, { timeout: 240000 }).catch(() => {}); await B.waitForFunction(() => matchOver, null, { timeout: 30000 }).catch(() => {});
    const r2 = await settle(8000);
    chk(r2.same && A.desyncs.length === 0 && B.desyncs.length === 0, 'the match played to the end in step (no desyncs)');
    chk([A, B, C].every(p => p.errors.length === 0), 'no page errors ' + JSON.stringify([A, B, C].map(p => p.errors.slice(0, 2))));
  }

  if (scenario === 'nohint') {
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    // before going online: a game against the computer has hints
    await A.goto('file://' + FILE, { waitUntil: 'load' }); await A.waitForTimeout(500);
    await A.evaluate(() => { soundEnabled = false; showMatchModal(); }); await A.waitForTimeout(150); await A.click('#match-modal button:has-text("1")'); await A.waitForTimeout(300);
    chk(await A.isVisible('#hint-btn'), 'against the computer the hint button is there');
    await A.evaluate(() => { gameActive = false; matchActive = false; try { localStorage.clear(); } catch (e) {} window.persistAIMatch = () => {}; });
    await setup(0, 1);
    await B.setViewportSize({ width: 390, height: 844 }); await B.waitForTimeout(400);
    const code = await A.evaluate(() => online.code);
    await C.goto('file://' + FILE, { waitUntil: 'load' }); await C.waitForTimeout(400); await speed(C);
    await C.click('#online-btn'); await C.fill('#online-name', 'Carol'); await C.fill('#online-code', code); await C.click('#online-watch-btn');
    await C.waitForFunction(() => watch.on, null, { timeout: 15000 });
    const hv = p => p.evaluate(() => ({ pc: getComputedStyle(document.getElementById('hint-btn')).display, ph: getComputedStyle(document.getElementById('ph-hint')).display, phone: document.documentElement.hasAttribute('data-phone'),
      cols: getComputedStyle(document.getElementById('phone-actions')).gridTemplateColumns }));
    const [ha, hb, hc] = [await hv(A), await hv(B), await hv(C)];
    chk(ha.pc === 'none' && hc.pc === 'none', 'online: no hint button for the host or the spectator (PC layout)');
    chk(hb.phone && hb.ph === 'none' && hb.cols.split(' ').length === 2, 'online on a phone: no hint button, the bottom row is Undo + a wider main button (' + hb.cols + ')');
    // play to a moment where the guest has dice, then try H / showHint()
    await startBots([A, B], { rematch: 'false', next: 'true' });
    await B.waitForFunction(() => !openingRoll && currentPlayer === myColor && diceValues.length > 0 && !isAnimating && !isRolling, null, { timeout: 30000 });
    await B.evaluate(() => { window.__botOff = true; }); await A.evaluate(() => { window.__botOff = true; });
    await B.waitForTimeout(300);
    const st0 = await B.innerText('#status-banner');
    await B.keyboard.press('h'); await B.evaluate(() => showHint()); await B.waitForTimeout(1500);
    const r = await B.evaluate(() => ({ status: document.getElementById('status-banner').innerText, marks: document.querySelectorAll('.hint-source,.hint-target,.hint-tray').length }));
    chk(!/Hint/.test(r.status) && r.marks === 0, 'pressing H (or calling the hint) does nothing online: status stays "' + r.status.slice(0, 60) + '"');
    // leave the online game: hints come back for the next game against the computer
    await B.evaluate(() => leaveOnline(true)); await B.waitForTimeout(800);
    await B.evaluate(() => { soundEnabled = false; aiDifficulty = 'easy'; window.__q = [6, 3, 2, 1]; window.__ri = randomInt; randomInt = function (n) { return (n === 6 && __q.length) ? __q.shift() - 1 : __ri(n); }; });
    await B.evaluate(() => showMatchModal()); await B.waitForTimeout(200); await B.click('#match-modal button:has-text("1")'); await B.waitForTimeout(300);
    await B.click('#ph-main'); await B.waitForFunction(() => !openingRoll && currentPlayer === myColor && diceValues.length > 0 && !isRolling, null, { timeout: 15000 });
    const hb2 = await hv(B);
    await B.click('#ph-hint'); await B.waitForFunction(() => /Hint/.test(document.getElementById('status-banner').innerText), null, { timeout: 10000 }).catch(() => {});
    const s2 = await B.innerText('#status-banner');
    chk(hb2.ph !== 'none' && hb2.cols.split(' ').length === 3 && /^Hint:/.test(s2), 'after leaving, a game against the computer has the hint button again and it works: "' + s2.slice(0, 60) + '"');
    chk([A, B, C].every(p => p.errors.length === 0), 'no page errors ' + JSON.stringify([A, B, C].map(p => p.errors.slice(0, 2))));
  }

  if (scenario === 'stress') {
    await setup(0, 1);
    await startBots([A, B], { rematch: 'true', next: 'true' });
    const dump = p => p.evaluate(() => ({ sig: fastSig(), cp: currentPlayer, me: myColor, dice: diceValues.join(''), open: openingRoll, or: JSON.stringify(openRolls), rolled: rolledThisTurn, rolling: isRolling, anim: isAnimating, ga: gameActive, mo: matchOver, games: gamesPlayed, rollDis: document.getElementById('roll-btn').disabled, pend: online.rollPending, q: online.queue.map(m => m.t).join(','), paused: online.paused, status: document.getElementById('status-banner').innerText.slice(0, 90), matches: window.__log.rematchClicks, moves: window.__log.moves }));
    let last = '', same = 0, stalls = 0, opens = 0, wasOpen = false;
    const t0 = Date.now();
    while (Date.now() - t0 < (+process.argv[3] || 90) * 1000) {
      await A.waitForTimeout(500);
      const a = await dump(A);
      if (a.open && !wasOpen) opens++; wasOpen = a.open;
      const k = JSON.stringify([a.sig, a.cp, a.dice, a.open, a.or, a.rolled, a.mo, a.games]);
      if (k === last) same++; else { same = 0; last = k; }
      if (same === 12) { stalls++; out('STALL', JSON.stringify(a), '\n   B:', JSON.stringify(await dump(B))); }
    }
    out('opening rolls seen:', opens, '| stalls:', stalls, '| desyncs', A.desyncs.length, B.desyncs.length, '| errors', A.errors.length, B.errors.length);
  }

  if (scenario === 'tierace') {
    await setup(0, 3);
    // the host throws every die: first a tie (3+4 vs 5+2), then random
    await forceDice([A, B], { 'host:1': [3, 4], 'guest:1': [5, 2] });      // a tie (7 against 7), then random
    // make one screen slow to show the tie (as over a slow connection), so the other player's next roll arrives first
    const slow = process.argv[4] || 'B';
    await (slow === 'A' ? A : B).evaluate(lag => { const r = resolveOpeningRoll; resolveOpeningRoll = function (a, b) { const args = arguments; setTimeout(() => r.apply(this, args), lag); }; }, +(process.env.LAG || 2000));
    await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForTimeout(+process.argv[3] || 6000);
    const d = p => p.evaluate(() => ({ open: openingRoll, or: JSON.stringify(openRolls), cp: currentPlayer, dice: diceValues.join(''), status: document.getElementById('status-banner').innerText.slice(0, 100), moves: __log.moves }));
    const [a, b] = [await d(A), await d(B)];
    out('A:', JSON.stringify(a)); out('B:', JSON.stringify(b));
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
    const r = await settle(8000);
    out((a.moves + b.moves > 4 && r.same && A.desyncs.length + B.desyncs.length === 0 ? 'PASS' : 'FAIL') + ' game under way after a tied opening roll, slow screen ' + slow + ' (moves A ' + a.moves + ', B ' + b.moves + ', boards agree ' + r.same + ') | desyncs ' + A.desyncs.length + ' ' + B.desyncs.length);
  }

  if (scenario === 'fairdice') {
    await setup(0, 3); await startBots([A, B], { rematch: 'true', next: 'true' });     // (rematch: still playing when the lost request is tried)
    await A.waitForFunction(() => fair.used.host + fair.used.guest >= 8, null, { timeout: 60000 }).catch(() => {});
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
    const r0 = await settle(8000);
    const counts = await Promise.all([A, B].map(p => p.evaluate(() => JSON.stringify(fair.used))));
    check(r0.same && counts[0] === counts[1] && JSON.parse(counts[0]).host + JSON.parse(counts[0]).guest >= 8, 'every roll checked out on both screens: rolls per player ' + counts[0]);
    const secret = await Promise.all([A, B].map(p => p.evaluate(() => ({ mine: fair.chain[fair.chain.length - 1].slice(0, 8), seen: JSON.stringify(Object.keys(fair.got).length) }))));
    check(secret[0].mine !== secret[1].mine, 'the two players have different secret chains');
    // a roll request that is lost is thrown again with the same dice: the host drops the guest's next request
    await A.evaluate(() => { window.__drop = 1; const o = onNetData; onNetData = function (m, c) { if (m && m.t === 'rollReq' && !m.n && window.__drop && !openingRoll) { window.__drop--; window.__dropped = m.d.join('-'); return; } return o.apply(this, arguments); }; });
    await B.evaluate(() => { window.__reqs = []; const ns = netSend; netSend = function (o) { if (o && o.t === 'rollReq') __reqs.push(o.d.join('-') + '@' + o.k); return ns.apply(this, arguments); }; });
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = false; });
    await A.waitForFunction(() => window.__dropped, null, { timeout: 60000 });
    const dropped = await A.evaluate(() => window.__dropped);
    await B.waitForFunction(() => window.__reqs.length >= 2, null, { timeout: 30000 });
    await B.waitForFunction(() => fair.cur && fair.cur.role === 'guest', null, { timeout: 30000 });
    const reqs = await B.evaluate(() => window.__reqs.slice(0, 2)), played = await B.evaluate(() => fair.cur.d.join('-'));
    check(reqs[0] === reqs[1] && played === dropped, 'a lost roll request is thrown again with the same dice: ' + reqs.join(', ') + '; played ' + played);
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = false; });
    await A.waitForTimeout(3000);
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
    const r1 = await settle(8000); check(r1.same, 'both screens in step afterwards');
  }

  if (scenario === 'cheathost' || scenario === 'cheatguest') {
    // one player's page is changed to always throw double sixes: the other side must refuse those dice
    const cheat = scenario === 'cheathost' ? A : B, honest = cheat === A ? B : A;
    await setup(0, 3); await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForFunction(() => !openingRoll && fair.used.host + fair.used.guest >= 4, null, { timeout: 60000 }).catch(() => {});
    await cheat.evaluate(() => { const f = fairNextRoll; fairNextRoll = function () { const r = f.apply(this, arguments); if (r) r.d = [6, 6]; return r; }; });
    const cheatCol = await cheat.evaluate(() => myColor);
    await honest.waitForFunction(() => /did not check out|could not be checked/.test(document.getElementById('status-banner').innerText + document.getElementById('net-banner-text').innerText), null, { timeout: 60000 }).catch(() => {});
    await A.waitForTimeout(1500);
    const h = await honest.evaluate(c => ({ st: document.getElementById('status-banner').innerText, banner: document.getElementById('net-banner').classList.contains('hidden') ? '' : document.getElementById('net-banner-text').innerText,
      sixes: currentPlayer === c && diceValues.length > 0 && diceValues.every(v => v === 6) && fair.cur && fair.cur.d.join() === '6,6' }), cheatCol);
    check(/did not check out|could not be checked/.test(h.st + h.banner), (cheat === A ? 'the guest' : 'the host') + ' noticed: "' + (h.banner || h.st).slice(0, 90) + '"');
    check(!h.sixes, 'and never played the forced double sixes');
  }

  if (scenario === 'wake') {
    // the screen is kept on during online games (players and spectators) and let go afterwards
    const WAKE_MOCK = `(() => { const log = window.__wake = []; Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: type => {
      log.push('request ' + type); const l = new EventTarget(); l.released = false;
      l.release = () => { if (!l.released) { l.released = true; log.push('release'); l.dispatchEvent(new Event('release')); } return Promise.resolve(); };
      window.__lock = l; return Promise.resolve(l); } } }); })();`;
    for (const p of [A, B, C]) await p.addInitScript(WAKE_MOCK);
    const held = p => p.evaluate(() => ({ log: __wake.join(','), on: !!(window.__lock && !window.__lock.released) }));
    await setup(0, 3);
    await A.waitForTimeout(300);
    const [a1, b1] = [await held(A), await held(B)];
    check(a1.on && b1.on, 'both players keep the screen on during the match: ' + a1.log + ' / ' + b1.log);
    const hide = (p, h) => p.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, h);
    await hide(B, true); await B.waitForTimeout(100);
    const b2 = await held(B);
    await hide(B, false); await B.waitForTimeout(100);
    const b3 = await held(B);
    check(!b2.on && b3.on && /request screen,release,request screen/.test(b3.log), 'when the page is hidden it lets go, and asks again when it is back: ' + b3.log);
    const code = await A.evaluate(() => online.code);
    await C.goto('file://' + FILE, { waitUntil: 'load' }); await C.waitForTimeout(400); await speed(C);
    const c0 = await held(C);
    await C.click('#online-btn'); await C.fill('#online-name', 'Carol'); await C.fill('#online-code', code); await C.click('#online-watch-btn');
    await C.waitForFunction(() => watch.on, null, { timeout: 15000 }); await C.waitForTimeout(200);
    const c1 = await held(C);
    check(c0.log === '' && c1.on, 'a spectator keeps the screen on too (and nobody asks before a game: "' + c0.log + '")');
    await C.evaluate(() => stopWatching()); await C.waitForTimeout(200);
    check(!(await held(C)).on, 'stopping watching lets go of the screen');
    await B.evaluate(() => leaveOnline(true)); await B.waitForTimeout(300);
    check(!(await held(B)).on, 'leaving the game lets go of the screen');
  }

  if (scenario === 'phoneonline') {
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    const SH = OUTDIR;
    for (const p of [B, C]) await p.setViewportSize({ width: 390, height: 844 });
    await setup(0, 1);
    const code = await A.evaluate(() => online.code);
    const bInfo = await B.evaluate(() => ({ phone: document.documentElement.hasAttribute('data-phone'), score: document.getElementById('ph-score-t').innerText + ' | ' + document.getElementById('ph-score-s').innerText }));
    chk(bInfo.phone && /YOU 0 – 0 ALICE/.test(bInfo.score), 'Bob plays on a phone: "' + bInfo.score + '"');
    await C.goto('file://' + FILE, { waitUntil: 'load' }); await C.waitForTimeout(400); await speed(C);
    await C.click('#phone-start .ph-sky'); await C.fill('#online-name', 'Carol'); await C.fill('#online-code', code); await C.click('#online-watch-btn');
    await C.waitForFunction(() => watch.on, null, { timeout: 15000 });
    await B.evaluate(() => { window.__kinds = new Set(); setInterval(() => __kinds.add(document.getElementById('ph-main').dataset.kind), 20); });
    await C.evaluate(() => { window.__kinds = new Set(); setInterval(() => __kinds.add(document.getElementById('ph-main').dataset.kind), 20); });
    // Bob plays with the phone's own main button (the bot clicks #roll-btn; make it use #ph-main instead)
    await startBots([A], { rematch: 'false', next: 'false' });
    await B.evaluate(() => { window.__driver2 = setInterval(() => {
      if (!online.active || window.__botOff || online.paused || !gameActive || isAnimating || isRolling || currentPlayer !== myColor && !openingRoll) return;
      const m = document.getElementById('ph-main');
      if (!m.disabled) { m.click(); return; }
      if (diceValues.length > 0 && currentPlayer === myColor) { const ms = getAllMoves(myColor, diceValues); if (!ms.length) return; const mv = ms[0];
        if (selectedSource === null) { if (mv.from === 'bar') document.getElementById('bar-bottom').click(); else pointElements[mv.from].querySelector('.hitbox').click(); }
        else { const t = validTargets[0]; if (!t) { selectedSource = null; return; } if (t.target === 'off') document.getElementById(homeOrientation === 'RIGHT' ? 'tray-right' : 'tray-left').click(); else pointElements[t.target].querySelector('.hitbox').click(); } }
    }, 30); });
    await A.waitForTimeout(4000);
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
    await B.waitForTimeout(1500);
    await B.screenshot({ path: SH + 'po_bob.png' }); await C.screenshot({ path: SH + 'po_carol.png' });
    const cv = await C.evaluate(() => ({ kind: document.getElementById('ph-main').dataset.kind, t: document.getElementById('ph-main-t').innerText, score: document.getElementById('ph-score-t').innerText + ' | ' + document.getElementById('ph-score-s').innerText, diceOnBar: document.getElementById('dice-wrapper').parentNode.id, undo: document.getElementById('ph-undo').disabled }));
    chk(cv.kind === 'spec' && /Watching/.test(cv.t) && /Alice|Bob/.test(cv.score) && /watching/.test(cv.score) && cv.diceOnBar === 'board-stage' && cv.undo, 'Carol watches on a phone: "' + cv.score + '", button "' + cv.t + '"');
    const sa = await A.evaluate(() => JSON.stringify({ s: state, cp: currentPlayer, d: diceValues })), sc = await C.evaluate(() => JSON.stringify({ s: state, cp: currentPlayer, d: diceValues }));
    chk(sa === sc, 'and sees the same position as the host');
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = false; });
    const over = await A.waitForFunction(() => matchOver, null, { timeout: 150000 }).then(() => true, () => false);
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
    await B.waitForTimeout(1500);
    const bk = await B.evaluate(() => [...__kinds]);
    chk(over && ['go', 'mine', 'opp', 'oppdone'].every(k => bk.includes(k)), 'Bob played the match with the phone\'s main button; it showed: ' + bk.join(', '));
    // the after-match choice on the phone (inside the turned board) and the free seat for the spectator
    const bm = await B.evaluate(() => document.getElementById('ph-main-t').innerText + ' / ' + document.getElementById('ph-main').dataset.kind);
    chk(/Match over/.test(bm) && /idle/.test(bm), 'after the match Bob\'s main button reads: "' + bm + '"');
    const panelVisible = await B.isVisible('#after-keep');
    chk(panelVisible, 'Bob sees Keep playing / Watch / Quit on his phone');
    await B.screenshot({ path: SH + 'po_bob_after.png' });
    await A.click('#after-keep'); await B.click('#after-watch');
    await C.waitForSelector('#seat-btn:not(.hidden)', { timeout: 10000 }).catch(() => {});
    await C.waitForTimeout(500);
    await C.screenshot({ path: SH + 'po_carol_seat.png' });
    const seatVis = await C.isVisible('#seat-btn');
    chk(seatVis, 'Carol gets "Take the free seat" on her phone');
    if (seatVis) await C.click('#seat-btn');
    const lob = await C.waitForFunction(() => lobby.phase, null, { timeout: 30000 }).then(() => true, () => false);
    chk(lob, 'Carol (phone) is on the settings screen of the new game with Alice');
    chk([A, B, C].every(p => p.errors.length === 0) && A.desyncs.length === 0 && B.desyncs.length === 0, 'no errors or desyncs');
  }

  if (scenario === 'drop') {
    await setup(0, 3); await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForTimeout(4000);
    const before = await snap(A);
    await B.evaluate(() => online.conn.close());          // unexpected close (no 'leave' message)
    await A.waitForTimeout(150);
    const mid = await Promise.all([snap(A), snap(B)]);
    out('   right after the drop: paused', mid[0].paused, mid[1].paused, JSON.stringify([mid[0].banner, mid[1].banner]));   // (often already reconnected)
    await A.waitForFunction(() => !online.paused, null, { timeout: 15000 }); await B.waitForFunction(() => !online.paused, null, { timeout: 15000 });
    out('both resumed. A status:', (await snap(A)).status);
    const r = await settle(); check(r.same, 'positions equal after reconnect');
    const m0 = (await snap(A)).moves + (await snap(B)).moves; await A.waitForTimeout(5000);
    const m1 = (await snap(A)).moves + (await snap(B)).moves;
    check(m1 - m0 > 0, 'play continued after reconnect (' + (m1 - m0) + ' moves; ' + before.moves + ' before the drop)');
  }

  if (scenario === 'blackhole') {
    await setup(0, 3); await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForTimeout(3000);
    blackhole = true;                                        // the network silently dies: no close event at all
    await A.waitForTimeout(3500);
    const mid = await Promise.all([snap(A), snap(B)]);
    check(mid[0].paused && mid[1].paused, 'a silent outage is noticed by the heartbeat: both screens pause');
    blackhole = false;
    await A.waitForFunction(() => !online.paused, null, { timeout: 20000 }); await B.waitForFunction(() => !online.paused, null, { timeout: 20000 });
    const r = await settle(); check(r.same, 'recovered, positions equal');
    const m0 = (await snap(A)).moves + (await snap(B)).moves; await A.waitForTimeout(4000);
    check(((await snap(A)).moves + (await snap(B)).moves) - m0 > 0, 'play continued after recovering');
  }

  if (scenario === 'reloadguest' || scenario === 'reloadhost') {
    await setup(0, 3); await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForTimeout(4000);
    const R = scenario === 'reloadguest' ? B : A, O = scenario === 'reloadguest' ? A : B;
    const pre = await snap(R);
    await R.reload({ waitUntil: 'load' }); await R.waitForTimeout(500);
    check(await R.isVisible('#resume-modal'), 'after the reload the resume offer is shown: "' + (await R.innerText('#resume-text')).slice(0, 80) + '"');
    await speed(R); await cfg(R, { hbEvery: 300, hbTimeout: 1500, recoverEvery: 300, attemptAge: 1000, grace: 20000 });
    await R.click('#resume-modal button:has-text("Resume")');
    await R.waitForFunction(() => online.active && !online.paused, null, { timeout: 25000 }); await O.waitForFunction(() => !online.paused, null, { timeout: 25000 });
    const info = await R.evaluate(() => ({ myColor, opp: opponentName, role: online.role, status: document.getElementById('status-banner').innerText }));
    check(info.myColor === pre.myColor, 'resumed with the same colour: ' + JSON.stringify(info));
    await startBots([R], { rematch: 'false', next: 'true' });
    const r = await settle(8000); check(r.same, 'positions equal after resuming');
    const m0 = (await snap(A)).moves + (await snap(B)).moves; await A.waitForTimeout(5000);
    check(((await snap(A)).moves + (await snap(B)).moves) - m0 > 0, 'play continued after resuming');
  }

  if (scenario === 'timer') {
    await setup(3, 3);
    check((await A.evaluate(() => online.timerLimit)) === 3 && (await B.evaluate(() => online.timerLimit)) === 3, 'both screens use the agreed 3 s turn timer');
    await startBots([A], { rematch: 'false', next: 'true' });          // only the host plays; the guest is "asleep"
    // the opening roll: the guest clicks Roll Dice for its own dice (again after a tie), then falls asleep
    for (let i = 0; i < 8 && await A.evaluate(() => openingRoll); i++) {
      if (await B.evaluate(() => openingRoll && !document.getElementById('roll-btn').disabled)) await B.click('#roll-btn');
      await A.waitForTimeout(600);
    }
    await A.waitForFunction(() => !openingRoll, null, { timeout: 15000 });
    const t0 = Date.now(); let skipped = null;
    while (Date.now() - t0 < 40000 && !skipped) {
      await A.waitForTimeout(300);
      const [a, b] = await Promise.all([snap(A), snap(B)]);
      if (/Time's up/.test(a.status) || /Time's up/.test(b.status)) skipped = { a: a.status, b: b.status };
    }
    check(!!skipped, 'the sleeping player ran out of time: ' + JSON.stringify(skipped));
    const chips = await Promise.all([A, B].map(p => p.evaluate(() => ({ me: document.getElementById('me-timer').innerText, meHidden: document.getElementById('me-timer').classList.contains('hidden'), opp: document.getElementById('opp-timer').innerText, oppHidden: document.getElementById('opp-timer').classList.contains('hidden') }))));
    out('timer chips A/B:', JSON.stringify(chips));
    await A.waitForTimeout(1500);
    const r = await settle(4000); check(r.same, 'turn state identical on both screens (to move: ' + r.a.cur + '/' + r.b.cur + ')');
  }

  if (scenario === 'rematch') {
    await setup(0, 1); await startBots([A, B], { rematch: 'true', next: 'true' });
    const colA = await A.evaluate(() => myColor);
    await A.waitForFunction(() => matchOver && !document.getElementById('rematch-btn').classList.contains('hidden'), null, { timeout: 300000 });
    out('match over; rematch button on A:', await A.innerText('#rematch-btn'));
    // a restarted match: both screens reset, colours swapped
    await A.waitForFunction(() => !matchOver && gamesPlayed === 0 && matchActive, null, { timeout: 30000 }); await B.waitForFunction(() => !matchOver && gamesPlayed === 0 && matchActive, null, { timeout: 30000 });
    const [a, b] = await Promise.all([A, B].map(p => p.evaluate(() => ({ me: myColor, score: JSON.stringify(matchScore), len: matchLength, opening: openingRoll, wrap: !document.getElementById('next-game-wrap').classList.contains('hidden') }))));
    out('after rematch A:', JSON.stringify(a), 'B:', JSON.stringify(b));
    check(a.me !== colA && a.me !== b.me, 'the rematch swapped colours and the players still have opposite colours');
    check(a.score === b.score && a.len === b.len && !a.wrap, 'both screens start the new match at ' + a.score);
    await A.waitForTimeout(4000); for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
    const r = await settle(8000); check(r.same, 'both screens in step during the rematch');
  }


  if (scenario === 'swap' || scenario === 'swapguest' || scenario === 'swapno') {
    await setup(0, 5); await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForFunction(() => !openingRoll, null, { timeout: 20000 });
    const asker = scenario === 'swapguest' ? B : A, other = scenario === 'swapguest' ? A : B;
    let okAll = true;
    for (let round = 0; round < 5; round++) {
      await A.waitForTimeout(500 + Math.random() * 1500);
      const before = await Promise.all([A, B].map(p => p.evaluate(() => ({ me: myColor, score: JSON.stringify(matchScore), gp: gamesPlayed, mine: matchScore[myColor], theirs: matchScore[oppColor()] }))));
      await asker.evaluate(() => setMyColor(myColor === 'w' ? 'r' : 'w'));
      await other.waitForSelector('#swap-modal:not(.hidden)', { timeout: 5000 });
      const text = await other.innerText('#swap-modal-text');
      if (scenario === 'swapno') {
        await other.click('#swap-modal button:has-text("No thanks")'); await A.waitForTimeout(600);
        const after = await Promise.all([A, B].map(p => p.evaluate(() => ({ me: myColor, st: document.getElementById('status-banner').innerText, frozen: online.swapFreeze, ph: online.swapPhase }))));
        const kept = after[0].me === before[0].me && after[1].me === before[1].me && !after[0].frozen && !after[1].frozen && after[0].ph === null && after[1].ph === null;
        check(kept, 'declined: colours unchanged, nothing frozen (asker sees "' + (asker === A ? after[0] : after[1]).st.slice(0, 60) + '")'); okAll = okAll && kept; continue;
      }
      await other.click('#swap-modal button:has-text("Swap")');
      await A.waitForFunction(() => !online.swapPhase && !online.swapFreeze, null, { timeout: 10000 }); await B.waitForFunction(() => !online.swapPhase && !online.swapFreeze, null, { timeout: 10000 });
      await A.waitForTimeout(800);
      const after = await Promise.all([A, B].map(p => p.evaluate(() => ({ me: myColor, host: online.hostColor, gp: gamesPlayed, mine: matchScore[myColor], theirs: matchScore[oppColor()], st: document.getElementById('status-banner').innerText }))));
      const flipped = after[0].me !== before[0].me.me && after[1].me !== before[1].me.me && after[0].me !== after[1].me;
      const scoreKept = after[0].gp !== before[0].gp || after[1].gp !== before[1].gp || (after[0].mine === before[0].mine && after[0].theirs === before[0].theirs && after[1].mine === before[1].mine && after[1].theirs === before[1].theirs);
      const r = await settle(8000);
      check(flipped && scoreKept && r.same, `swap ${round + 1}: ${before[0].me}->${after[0].me} on A, opposite colours ${flipped}, scores stayed with the players ${scoreKept}, screens in step ${r.same}`);
      okAll = okAll && flipped && scoreKept && r.same;
    }
    const m0 = (await snap(A)).moves + (await snap(B)).moves; await A.waitForTimeout(5000);
    const m1 = (await snap(A)).moves + (await snap(B)).moves;
    check(m1 - m0 > 0, 'play continued after the swaps (' + (m1 - m0) + ' moves)');
  }

  if (scenario === 'nextgame') {
    await setup(0, 5);
    for (const p of [A, B]) await p.evaluate(() => { window.__log = []; const o = initGame; initGame = function (st) { const r = o.apply(this, arguments); __log.push({ kind: 'init', starter: st || null, open: openingRoll, cp: currentPlayer, me: myColor }); return r; };
      const h = handleGameEnd; handleGameEnd = function (w) { __log.push({ kind: 'end', winner: w }); return h.apply(this, arguments); };
      const ps = netSend; netSend = function (o2) { if (o2 && o2.t === 'openRoll') __log.push({ kind: 'openRollSent', p: o2.p }); return ps.apply(this, arguments); }; });
    await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForFunction(() => __log.filter(e => e.kind === 'end').length >= 3, null, { timeout: 110000 }).catch(() => {});
    await A.waitForTimeout(1500);
    const logs = await Promise.all([A, B].map(p => p.evaluate(() => __log)));
    let ok = true;
    for (const [i, lg] of logs.entries()) {
      const inits = lg.filter(e => e.kind === 'init'), ends = lg.filter(e => e.kind === 'end');
      out('   screen', i ? 'B' : 'A', 'games started:', JSON.stringify(inits.map(e => ({ st: e.starter, open: e.open, cp: e.cp }))), 'winners:', JSON.stringify(ends.map(e => e.winner)));
      ok = ok && inits.length >= 2; if (inits.length) ok = ok && inits[0].open === false && inits[0].cp === ends[0].winner;
      for (let k = 0; k < inits.length; k++) ok = ok && inits[k].open === false && inits[k].cp === ends[k].winner && inits[k].starter === ends[k].winner;
    }
    const opens = logs.map(lg => lg.filter(e => e.kind === 'openRollSent').length);
    ok = ok && opens[0] >= 2 && opens[0] <= 6 && opens[1] === 0;
    check(ok, 'each later game starts with the previous winner and no opening roll (opening-roll messages per screen: ' + JSON.stringify(opens) + ')');
  }

  if (scenario === 'concede') {
    await setup(0, 5);                      // 5-point match, A = host, B = guest
    const pages = { A, B };
    const place = async (loserPage, kind) => {
      // host installs a custom position and sends it to the guest as a snapshot; the loser is to move (start of turn)
      await A.evaluate(([loserIsHost, kind]) => {
        clearTimeout(rollTimeout); openingRoll = false; gameActive = true; isRolling = false; isAnimating = false;
        const loser = loserIsHost ? myColor : oppColor(), winner = loser === 'w' ? 'r' : 'w';
        state.board = Array.from({ length: 24 }, () => []); state.bar = { w: [], r: [] }; state.off = { w: [], r: [] };
        const ace = winner === 'w' ? 0 : 23;
        for (let i = 0; i < 2; i++) state.board[ace].push('c_' + winner + '_' + i); for (let i = 2; i < 15; i++) state.off[winner].push('c_' + winner + '_' + i);
        const far = n => loser === 'w' ? 8 + n % 3 : 12 + n % 3;
        let n = 0;
        if (kind === 'game') { state.off[loser].push('c_' + loser + '_0'); n = 1; }
        if (kind === 'backgammon') { state.board[winner === 'w' ? 4 : 19].push('c_' + loser + '_0'); n = 1; }
        for (; n < 15; n++) state.board[far(n)].push('c_' + loser + '_' + n);
        currentPlayer = loser; diceValues = []; rolledThisTurn = false; turnHistory = [];
        renderCheckers(); updateUI(); sendSnapshotWhenIdle(false);
      }, [loserPage === A, kind]);
      await A.waitForTimeout(700);
    };
    const rows = [[A, 'game', 1], [B, 'gammon', 2], [A, 'backgammon', 2], [B, 'game', 1], [B, 'backgammon', 2]];   // backgammon with the loser to move: the checker could still get out, so it is offered and scored as a gammon
    let okAll = true; const totals = { host: 0, guest: 0 };
    for (const [loserPage, kind, pts] of rows) {
      await place(loserPage, kind);
      const winnerPage = loserPage === A ? B : A;
      const m = await loserPage.evaluate(() => ({ open: !document.getElementById('concede-modal').classList.contains('hidden'), btn: document.getElementById('concede-yes').innerText }));
      const wm = await winnerPage.evaluate(() => !document.getElementById('concede-modal').classList.contains('hidden'));
      const before = await Promise.all([A, B].map(p => p.evaluate(() => JSON.stringify(matchScore))));
      await loserPage.click('#concede-yes'); await A.waitForTimeout(700);
      const after = await Promise.all([A, B].map(p => p.evaluate(() => ({ score: matchScore, me: myColor, active: gameActive, over: matchOver, st: document.getElementById('status-banner').innerText, next: !document.getElementById('next-game-wrap').classList.contains('hidden') }))));
      const winnerIsHost = winnerPage === A;
      const cap = Math.max(0, 5 - totals[winnerIsHost ? 'host' : 'guest']); const expect = Math.min(pts, cap);
      totals[winnerIsHost ? 'host' : 'guest'] += expect;
      const hostScore = after[0].score[after[0].me], guestScore = after[1].score[after[1].me];
      const good = m.open && !wm && m.btn.includes(String(Math.min(pts, cap))) && after[0].score.w === after[1].score.w && after[0].score.r === after[1].score.r && !after[0].active && !after[1].active
        && hostScore === totals.host && guestScore === totals.guest && /gave up/.test(after[winnerIsHost ? 0 : 1].st);
      check(good, `${loserPage.name} gives up a ${kind}: popup only for the loser ${m.open && !wm}, button "${m.btn}", scores host/guest ${hostScore}/${guestScore} (expected ${totals.host}/${totals.guest}), winner sees "${after[winnerIsHost ? 0 : 1].st.slice(0, 60)}"`);
      okAll = okAll && good;
      if (after[0].over) { check(after[0].over && after[1].over, 'the match is over on both screens'); okAll = okAll && after[0].over && after[1].over; break; }
      // next game: both press Play Next Game; the winner starts without an opening roll
      await A.evaluate(() => onNextGameClick()); await B.evaluate(() => onNextGameClick()); await A.waitForTimeout(700);
      const nx = await Promise.all([A, B].map(p => p.evaluate(() => ({ open: openingRoll, cp: currentPlayer, me: myColor, active: gameActive }))));
      const starterOk = !nx[0].open && !nx[1].open && nx[0].cp === nx[1].cp && nx[0].active && (nx[0].cp === nx[0].me) === winnerIsHost;
      check(starterOk, 'next game: the winner starts, no opening roll'); okAll = okAll && starterOk;
    }
  }

  if (scenario === 'lobby') {
    let okAll = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); okAll = okAll && c; };
    await A.goto('file://' + FILE, { waitUntil: 'load' }); await A.waitForTimeout(400); await speed(A);
    await cfg(A, { hbEvery: 300, hbTimeout: 1500, recoverEvery: 300, attemptAge: 1000, grace: 4000 });
    await A.click('#online-btn'); await A.fill('#online-name', 'Alice');
    const first = await A.evaluate(() => { const v = document.getElementById('online-view-choose'); return { timer: !!document.getElementById('online-timer'), matchBtns: v.querySelectorAll('button[onclick^="createOnline("]').length > 0 && [...v.querySelectorAll('button')].some(b => /createOnline\(\d\)/.test(b.getAttribute('onclick'))), buttons: [...v.querySelectorAll('button')].map(b => b.innerText.trim().slice(0, 20)), settingsHidden: document.getElementById('online-view-settings').classList.contains('hidden') }; });
    chk(!first.timer && !first.matchBtns && first.settingsHidden, 'first screen has no match length or timer, only: ' + JSON.stringify(first.buttons));
    await A.click('#online-create-btn');
    await A.waitForSelector('#online-code-display:not(:empty)');
    const link = await A.inputValue('#online-link');
    await B.goto(link, { waitUntil: 'load' }); await B.waitForTimeout(400); await speed(B);
    await cfg(B, { hbEvery: 300, hbTimeout: 1500, recoverEvery: 300, attemptAge: 1000, grace: 4000 });
    await B.fill('#online-name', 'Bob'); await B.click('#online-join-btn');
    await A.waitForFunction(() => lobby.phase, null, { timeout: 15000 }); await B.waitForFunction(() => lobby.phase, null, { timeout: 15000 });
    const views = await Promise.all([A, B].map(p => p.evaluate(() => ({ settings: !document.getElementById('online-view-settings').classList.contains('hidden'), intro: document.getElementById('lobby-intro').innerText, theirs: document.getElementById('lobby-theirs').innerText, active: online.active, confirmDisabled: document.getElementById('lobby-confirm').disabled }))));
    chk(views.every(v => v.settings && !v.active && v.confirmDisabled), 'both see the settings screen, game not started, Confirm disabled until a match length is picked');
    chk(/Bob/.test(views[0].intro) && /Alice/.test(views[1].intro), 'each sees the other\'s name: "' + views[0].intro.slice(0, 40) + '" / "' + views[1].intro.slice(0, 40) + '"');
    const st = () => Promise.all([A, B].map(p => p.evaluate(() => ({ active: online.active, note: document.getElementById('lobby-note').innerText, theirs: document.getElementById('lobby-theirs').innerText, len: matchLength, timer: online.timerLimit }))));
    const pick = async (pg, len, timer, confirm) => { await pg.click('#lobby-len-' + len); await pg.selectOption('#lobby-timer', String(timer)); if (confirm) await pg.click('#lobby-confirm'); };
    // 1) only Alice confirms: nothing starts
    await pick(A, 3, 60, true); await A.waitForTimeout(600);
    let s = await st();
    chk(!s[0].active && !s[1].active && /Waiting for Bob/.test(s[0].note) && /first to 3 points, 60 s/.test(s[1].theirs) && /\(confirmed\)/.test(s[1].theirs) && !/not confirmed/.test(s[1].theirs), 'Alice confirmed alone: no game; Bob sees her choice: "' + s[1].theirs + '" | Alice sees: "' + s[0].note + '"');
    // 2) Bob confirms a different match length: no game, both told
    await pick(B, 5, 60, true); await A.waitForTimeout(1200); s = await st();
    chk(!s[0].active && !s[1].active && /different settings/.test(s[0].note + s[1].note), 'different match lengths: no game; note: "' + s[0].note.slice(0, 70) + '"');
    // 3) Bob matches the length but not the timer: still no game
    await pick(B, 3, 30, true); await A.waitForTimeout(1200); s = await st();
    chk(!s[0].active && !s[1].active, 'same length, different timer: still no game');
    // 4) Bob changes after confirming -> his confirmation is withdrawn, then he agrees
    const withdrawn = await B.evaluate(() => lobby.mine.ok === false) ; 
    await B.selectOption('#lobby-timer', '60'); const wd = await B.evaluate(() => lobby.mine.ok === false); chk(wd, 'changing an option withdraws the confirmation');
    await B.waitForTimeout(300);
    // stale-confirmation race: Bob quietly holds a different choice than Alice last heard; Alice presses confirm again after toggling
    await B.evaluate(() => { lobby.mine.len = 1; lobby.mine.ok = true; lobby.mine.n += 5; });         // Alice has not been told (simulated lost update)
    await A.click('#lobby-confirm'); await A.click('#lobby-confirm'); await A.waitForTimeout(100);   // off and on again: she proposes with what she last heard
    await B.evaluate(() => { lobby.mine.ok = false; }); await A.waitForTimeout(500); s = await st();
    chk(!s[0].active && !s[1].active, 'a proposal based on a stale confirmation is refused by the guest (no game started)');
    // finally both agree on 3 / 60 s
    await B.evaluate(() => lobbyPick(3)); await B.evaluate(() => { document.getElementById('lobby-timer').value = '60'; lobbyTimerChanged(); });
    await A.evaluate(() => { if (!lobby.mine.ok) lobbyConfirm(); });
    await B.click('#lobby-confirm');
    await A.waitForFunction(() => online.active, null, { timeout: 10000 }); await B.waitForFunction(() => online.active, null, { timeout: 10000 });
    s = await st();
    const fin = await Promise.all([A, B].map(p => p.evaluate(() => ({ me: myColor, len: matchLength, timer: online.timerLimit, modalHidden: document.getElementById('online-modal').classList.contains('hidden'), opp: opponentName, open: openingRoll }))));
    chk(fin.every(f => f.len === 3 && f.timer === 60 && f.modalHidden && f.open) && fin[0].me !== fin[1].me, 'game started on both with the agreed settings: ' + JSON.stringify(fin.map(f => [f.len, f.timer, f.opp])));
    chk(A.desyncs.length === 0 && B.desyncs.length === 0 && A.errors.length === 0 && B.errors.length === 0, 'no errors');
  }

  if (scenario === 'rollcol') {
    await setup(0, 1);
    const hook = () => { window.__k = []; const o = updateRollButton; updateRollButton = function () { const r = o.apply(this, arguments); const t = document.getElementById('roll-btn'); const k = t.classList.contains('roll-opp-ready') ? 'blue-bright' : t.classList.contains('roll-opp-done') ? 'blue-dim' : t.className.includes('bg-green-600') ? 'green-bright' : t.className.includes('bg-green-800') ? 'green-dim' : 'grey'; __k.push({ k, dis: t.disabled, mine: currentPlayer === myColor, open: openingRoll, mr: !!(openRolls && openRolls[myColor]), tr: !!(openRolls && openRolls[oppColor()]), rolled: rolledThisTurn || diceValues.length > 0 }); return r; }; };
    for (const p of [A, B]) await p.evaluate(hook);
    await startBots([A, B], { rematch: 'false', next: 'false' });
    await A.waitForFunction(() => matchOver, null, { timeout: 110000 }).catch(() => {});
    await A.waitForTimeout(800);
    let good = true;
    for (const [i, p] of [A, B].entries()) {
      const ks = await p.evaluate(() => __k);
      const cnt = {}; ks.forEach(e => cnt[e.k] = (cnt[e.k] || 0) + 1);
      const bad = ks.filter(e => (e.k.startsWith('blue') && !e.dis) || (e.k === 'green-bright' && e.dis) || (e.k === 'blue-bright' && !e.open && e.mine) || (e.k === 'blue-dim' && !e.rolled) || (e.k === 'blue-bright' && !e.open && e.rolled));
      check(bad.length === 0 && cnt['blue-bright'] > 0 && cnt['blue-dim'] > 0 && cnt['green-bright'] > 0 && cnt['green-dim'] > 0,
        'screen ' + (i ? 'B' : 'A') + ': roll button colours ' + JSON.stringify(cnt) + ', rule breaks ' + bad.length + ' ' + JSON.stringify(bad.slice(0, 2)));
    }
  }

  if (scenario === 'blocked') {
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    await setup(0, 1);
    for (const p of [A, B]) await p.evaluate(() => { window.__rolls = 0; window.__msgs = []; const ss = setStatus; setStatus = function (m) { __msgs.push(m); return ss.apply(this, arguments); }; const ns = netSend; netSend = function (o) { if (o && (o.t === 'rollReq' || o.t === 'roll')) __rolls++; return ns.apply(this, arguments); }; });
    const force = (owner, pts, toMove) => Promise.all([A, B].map(p => p.evaluate(([owner, pts, toMove]) => {
      clearTimeout(rollTimeout); clearTimeout(endTurnTimer); isRolling = false; isAnimating = false; openingRoll = false; openRolls = { w: null, r: null }; gameActive = true; rolledThisTurn = false; diceValues = []; turnHistory = []; online.rollPending = false;
      const o = owner, v = o === 'w' ? 'r' : 'w';
      state.board = Array.from({ length: 24 }, () => []); state.bar = { w: [], r: [] }; state.off = { w: [], r: [] };
      let no = 0, nv = 0; const mk = c => 'c_' + c + '_' + (c === o ? no++ : nv++);
      for (const i of pts) state.board[i].push(mk(o), mk(o));
      const farO = o === 'w' ? 12 : 11; while (no < 15) state.board[farO].push(mk(o));
      state.bar[v].push(mk(v));
      const farV = v === 'w' ? 13 : 10; while (nv < 15) state.board[farV].push(mk(v));
      currentPlayer = toMove; renderCheckers(); updateUI();
    }, [owner, pts, toMove])));
    const st = p => p.evaluate(() => ({ cp: currentPlayer, me: myColor, dice: diceValues.length, msg: document.getElementById('status-banner').innerText, dis: document.getElementById('roll-btn').disabled, rolls: __rolls }));
    for (const blockedIsHost of [true, false]) {
      const [ca, cb] = await Promise.all([A, B].map(p => p.evaluate(() => myColor)));
      const blockedCol = blockedIsHost ? ca : cb, ownerCol = blockedCol === 'w' ? 'r' : 'w';
      for (const p of [A, B]) await p.evaluate(() => { __rolls = 0; __msgs = []; });
      await force(ownerCol, ownerCol === 'w' ? [0, 1, 2, 3, 4, 5] : [18, 19, 20, 21, 22, 23], blockedCol);
      await A.waitForTimeout(500);
      let [sa, sb] = await Promise.all([st(A), st(B)]);
      const ms = await Promise.all([A, B].map(p => p.evaluate(() => __msgs.find(m => /no move is possible/.test(m)) || null)));
      chk(ms[0] && ms[1], (blockedIsHost ? 'host' : 'guest') + ' on the bar behind a closed board: both screens showed: "' + (ms[0] || '').slice(0, 70) + '" / "' + (ms[1] || '').slice(0, 70) + '"');
      chk(sa.dis && sb.dis || (blockedIsHost ? sa.dis : sb.dis), 'blocked player\'s Roll Dice is off');
      await A.waitForTimeout(2600);
      [sa, sb] = await Promise.all([st(A), st(B)]);
      chk(sa.cp === ownerCol && sb.cp === ownerCol && sa.dice === 0 && sb.dice === 0, 'turn passed on both screens to the blocker, no dice rolled (cp ' + sa.cp + '/' + sb.cp + ')');
      chk(sa.rolls === 0 && sb.rolls === 0, 'no roll request or roll message was sent');
      // the blocker now rolls normally and both see the same dice
      const rp = ownerCol === ca ? A : B; await rp.click('#roll-btn'); await A.waitForTimeout(2500);
      [sa, sb] = await Promise.all([st(A), st(B)]);
      chk(sa.dice > 0 || sa.cp !== ownerCol, 'the blocker rolled normally afterwards');
    }
    await startBots([A, B], { rematch: 'false', next: 'false' });
    await A.waitForFunction(() => matchOver, null, { timeout: 100000 }).catch(() => {});
    await A.waitForTimeout(1000);
    const [sg, sh] = await Promise.all([snap(A), snap(B)]);
    chk(sg.sig === sh.sig && A.desyncs.length === 0 && B.desyncs.length === 0 && A.errors.length === 0 && B.errors.length === 0, 'game played on to the end, both screens equal, no desyncs/errors');
  }

  if (scenario === 'swapview') {
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    await setup(0, 3);
    const force = () => Promise.all([A, B].map(p => p.evaluate(() => {
      clearTimeout(rollTimeout); clearTimeout(endTurnTimer); isRolling = false; isAnimating = false; openingRoll = false; openRolls = { w: null, r: null }; gameActive = true; rolledThisTurn = false; diceValues = []; turnHistory = [];
      const lay = { w: { 23: 2, 12: 5, 7: 4, 5: 2 }, r: { 0: 2, 11: 4, 16: 4, 18: 3 } };
      state.board = Array.from({ length: 24 }, () => []); state.bar = { w: ['c_w_13'], r: [] }; state.off = { w: ['c_w_14'], r: ['c_r_13', 'c_r_14'] };
      for (const c of ['w', 'r']) { let n = 0; for (const [pt, k] of Object.entries(lay[c])) for (let j = 0; j < k; j++) state.board[+pt].push('c_' + c + '_' + (n++)); }
      matchScore = { w: 1, r: 0 };
      currentPlayer = 'w'; renderCheckers(); updateUI();
    })));
    // White rolls for real: with fair dice a snapshot only carries dice that some roll proves
    const rollWhite = async () => {
      const wp = (await A.evaluate(() => myColor)) === 'w' ? A : B;
      await wp.evaluate(() => handleRollDice());
      await A.waitForFunction(() => diceValues.length > 0 && !isRolling, null, { timeout: 10000 });
      await B.waitForFunction(() => diceValues.length > 0 && !isRolling, null, { timeout: 10000 });
    };
    const view = p => p.evaluate(() => {
      const mineCls = myColor === 'w' ? 'checker-white' : 'checker-red';
      const ch = [...document.querySelectorAll('.checker')].filter(e => e.getBoundingClientRect().width > 0).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), e.classList.contains(mineCls) ? 'me' : 'opp']; }).sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1));
      const tr = [...document.querySelectorAll('.point-triangle')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), e.className.replace('point-triangle', '').replace('hint-target', '').trim()]; }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      return { ch, tr, me: myColor, mine: currentPlayer === myColor, dice: diceValues.slice(), tot: state.board.flat().length + state.bar.w.length + state.bar.r.length + state.off.w.length + state.off.r.length, score: matchScore[myColor] + '-' + matchScore[oppColor()] };
    });
    await force(); await A.waitForTimeout(1000); await rollWhite(); await A.waitForTimeout(1000);
    for (const asker of [A, B]) {
      const other = asker === A ? B : A;
      const b0 = await Promise.all([view(A), view(B)]);
      await asker.evaluate(() => setMyColor(myColor === 'w' ? 'r' : 'w'));
      await other.waitForSelector('#swap-modal:not(.hidden)', { timeout: 5000 });
      await other.click('#swap-modal button:has-text("Swap")');
      await A.waitForFunction(() => !online.swapPhase && !online.swapFreeze, null, { timeout: 10000 }); await B.waitForFunction(() => !online.swapPhase && !online.swapFreeze, null, { timeout: 10000 });
      await A.waitForTimeout(2000);
      const b1 = await Promise.all([view(A), view(B)]);
      const nm = asker === A ? 'host asks' : 'guest asks';
      chk(b1[0].me !== b0[0].me && b1[1].me !== b0[1].me && b1[0].me !== b1[1].me, nm + ': colours swapped (' + b0[0].me + b0[1].me + ' -> ' + b1[0].me + b1[1].me + ')');
      for (const [i, n] of [[0, 'host'], [1, 'guest']]) {
        chk(JSON.stringify(b0[i].ch) === JSON.stringify(b1[i].ch) && b0[i].tr.every((x, k) => x[0] === b1[i].tr[k][0] && x[1] === b1[i].tr[k][1] && x[2] !== b1[i].tr[k][2]), nm + ': ' + n + ' screen: every checker at the same spot as before, every point swapped shade');
        chk(b1[i].tot === 30 && b0[i].mine === b1[i].mine && JSON.stringify(b0[i].dice) === JSON.stringify(b1[i].dice) && b1[i].score === b0[i].score, nm + ': ' + n + ': 30 checkers, same player to move, same dice, own score kept (' + b1[i].score + ')');
      }
    }
    chk(A.desyncs.length === 0 && B.desyncs.length === 0 && A.errors.length === 0 && B.errors.length === 0, 'no desyncs or errors');
  }

  if (scenario === 'grace') {
    await setup(0, 3); await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForTimeout(2000);
    blackhole = true;
    await A.waitForTimeout(8000);
    const s = await A.evaluate(() => ({ text: document.getElementById('net-banner-text').innerText, btns: !document.getElementById('net-banner-btns').classList.contains('hidden') }));
    check(s.btns && /lost|not responding|reconnect|come back/i.test(s.text), 'after the grace period the host is offered Keep waiting / Leave: "' + s.text.slice(0, 80) + '"');
    await A.click('#net-banner-btns button:has-text("Keep waiting")');
    check(await A.evaluate(() => document.getElementById('net-banner-btns').classList.contains('hidden')), 'Keep waiting hides the buttons again');
    await A.waitForTimeout(6000);
    await A.click('#net-banner-btns button:has-text("Leave game")');
    const left = await A.evaluate(() => ({ online: online.active, kind: opponentKind, startBtn: !document.getElementById('start-match-btn').classList.contains('hidden'), banner: document.getElementById('net-banner').classList.contains('hidden'), saved: !!sessionStorage.getItem('bg_online_session') }));
    check(!left.online && left.kind === 'ai' && left.startBtn && left.banner && !left.saved, 'Leave game goes back to the start screen and forgets the session: ' + JSON.stringify(left));
    blackhole = false;
  }
  check([A, B, C, D].every(p => p.errors.length === 0), 'no page errors ' + JSON.stringify([A, B, C, D].map(p => p.errors.slice(0, 2))));
  if (!['drop', 'blackhole', 'cheathost', 'cheatguest'].includes(scenario)) check(A.desyncs.length === 0 && B.desyncs.length === 0, 'no desyncs ' + JSON.stringify([A.desyncs.slice(0, 2), B.desyncs.slice(0, 2)]));
  await browser.close();
  console.log(FAILS ? FAILS + ' FAILED' : 'ALL PASS');
  process.exit(FAILS ? 1 : 0);
})().catch(e => { console.error('FAIL test crashed:', e); process.exit(1); });
