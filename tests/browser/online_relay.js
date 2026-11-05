// Online play through the backup relay (MQTT over WebSocket) when a direct connection cannot be made. The three public
// brokers are replaced by a small in-test broker, and PeerJS by a mock that can be told to fail ("dead").
// usage: node online_relay.js <scenario>
//   relayjoin | relayone | relaydrop | directwins | relayspec | opening | opentie | openreload
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const FILE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');
const scenario = process.argv[2] || 'relayjoin';
const SCENARIOS = ['relayjoin', 'relayone', 'relaydrop', 'directwins', 'relayspec', 'opening', 'opentie', 'openreload', 'relaycrypt'];
if (!SCENARIOS.includes(scenario)) { console.error('FAIL unknown scenario ' + scenario); process.exit(2); }
let FAILS = 0;
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) FAILS++; };
const DEAD = scenario !== 'directwins' && scenario !== 'opening' && scenario !== 'opentie' && scenario !== 'openreload';
const brokers = {};      // host -> { subs: Map(topic -> Set(rec)), refuse: bool, conns: Set(ws) }
const stats = { publishes: 0, topics: new Set(), samples: [] };   // (what an eavesdropper on the broker would see)
function broker(ws) {
  const host = new URL(ws.url()).host;
  const B = brokers[host] = brokers[host] || { subs: new Map(), refuse: false, conns: new Set() };
  if (B.refuse) { ws.close(); return; }
  B.conns.add(ws);
  const rec = { ws }; let buf = Buffer.alloc(0);
  const str = (b, o) => { const l = b.readUInt16BE(o); return [b.slice(o + 2, o + 2 + l).toString(), o + 2 + l]; };
  ws.onMessage(msg => {
    buf = Buffer.concat([buf, Buffer.isBuffer(msg) ? msg : Buffer.from(msg)]);
    for (;;) {
      if (buf.length < 2) return;
      let rem = 0, mul = 1, i = 1, b;
      do { if (i >= buf.length) return; b = buf[i++]; rem += (b & 127) * mul; mul *= 128; } while ((b & 128));
      if (buf.length < i + rem) return;
      const first = buf[0], body = buf.slice(i, i + rem); buf = buf.slice(i + rem);
      const type = first >> 4;
      if (type === 1) ws.send(Buffer.from([0x20, 2, 0, 0]));
      else if (type === 8) { const id = body.slice(0, 2); const [t] = str(body, 2); if (!B.subs.has(t)) B.subs.set(t, new Set()); B.subs.get(t).add(rec); ws.send(Buffer.from([0x90, 3, id[0], id[1], 0])); }
      else if (type === 3) { const [t, o] = str(body, 0); stats.publishes++; const payload = body.slice(o); stats.topics.add(t); if (stats.samples.length < 400) stats.samples.push(payload.toString());
        const lenB = []; let n = 2 + Buffer.byteLength(t) + payload.length; do { let x = n % 128; n = Math.floor(n / 128); if (n > 0) x |= 128; lenB.push(x); } while (n > 0);
        const tb = Buffer.from(t); const th = Buffer.from([tb.length >> 8, tb.length & 255]);
        const pkt = Buffer.concat([Buffer.from([0x30, ...lenB]), th, tb, payload]);
        (B.subs.get(t) || new Set()).forEach(r => { try { r.ws.send(pkt); } catch (e) {} }); }
      else if (type === 12) ws.send(Buffer.from([0xD0, 0]));
    }
  });
  ws.onClose(() => { B.conns.delete(ws); B.subs.forEach(s => s.delete(rec)); });
}
const dropBrokers = () => Object.values(brokers).forEach(B => [...B.conns].forEach(w => { try { w.close(); } catch (e) {} }));

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
    if (m.op === 'incoming') { const p = window.__peers[m.to]; if (!p || p.destroyed) return; const c = new MockConn(p, m.from, m.cid); c.metadata = m.meta; p._c[m.cid] = c; p.emit('connection', c); if (!window.__dead) setTimeout(() => { c.open = true; c.emit('open'); }, 5); }
    else if (m.op === 'opened' && !window.__dead) { const p = window.__peers[m.to]; const c = p && p._c[m.cid]; if (c) { c.open = true; c.emit('open'); } }
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
      if (!nb.disabled && ${opts.next}) click(nb);
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
    await page.addInitScript('window.__dead = ' + (DEAD ? 'true' : 'false') + ';'); await page.addInitScript(MOCK); await ctx.routeWebSocket(/^wss:\/\/(broker\.hivemq\.com|broker\.emqx\.io|test\.mosquitto\.org)/, ws => broker(ws));
    return page;
  };
  const A = await mk('A'), B = await mk('B'), C = await mk('C');
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
  await A.exposeFunction('__out', hub(A)); await B.exposeFunction('__out', hub(B)); await C.exposeFunction('__out', hub(C));
  // navigations forget the page's registrations (the server notices the disconnect)
  for (const pg of [A, B, C]) pg.on('framenavigated', f => { if (f === pg.mainFrame()) pg.__live.clear(); });

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


  const vr = p => p.evaluate(() => ({ viaRelay: online.viaRelay, conn: online.conn && online.conn.constructor.name, relay: diag.relay, links: diag.relayLinks, status: document.getElementById('status-banner').innerText.slice(0, 50) }));
  if (scenario === 'relayjoin' || scenario === 'relayone' || scenario === 'directwins' || scenario === 'relaydrop') {
    if (scenario === 'relayone') { brokers['broker.hivemq.com'] = { subs: new Map(), refuse: true, conns: new Set() }; }
    await setup(0, 1); await startBots([A, B], { rematch: 'false', next: 'true' });
    const conn = [await vr(A), await vr(B)];
    if (scenario === 'directwins') check(!conn[1].viaRelay, 'with PeerJS working the players connect directly: ' + JSON.stringify(conn[1]));
    else check(conn[1].viaRelay, 'with PeerJS failing the players connect through the relay: ' + JSON.stringify(conn[1]));
    if (scenario === 'relaydrop') {
      await A.waitForTimeout(2500); const m0 = (await snap(A)).moves + (await snap(B)).moves;
      dropBrokers();
      await A.waitForTimeout(400);
      out('   brokers dropped; paused A/B:', (await snap(A)).paused, (await snap(B)).paused, '(often already back)');
      await A.waitForFunction(() => !online.paused, null, { timeout: 30000 }); await B.waitForFunction(() => !online.paused, null, { timeout: 30000 });
      const r0 = await settle(8000); check(r0.same, 'positions equal after recovering: ' + JSON.stringify(await vr(B)));
      const m1 = (await snap(A)).moves + (await snap(B)).moves; await A.waitForTimeout(4000);
      check(((await snap(A)).moves + (await snap(B)).moves) - m1 > 0, 'play continued after recovering (' + m0 + ' moves before)');
    }
    // play the 1-point match to its end
    await A.waitForFunction(() => matchOver, null, { timeout: 240000 });
    await B.waitForFunction(() => matchOver, null, { timeout: 30000 });
    const r = await settle(8000);
    check(r.same, 'the match finished on both screens with the same position and score ' + (await snap(A)).score);
    if (scenario !== 'directwins') check(stats.publishes > 0, 'messages went through the relay (' + stats.publishes + ' published)');
  }

  if (scenario === 'relaycrypt') {
    // someone listening on the public broker sees neither the game code nor what is said
    await setup(0, 1); await startBots([A, B], { rematch: 'false', next: 'true' });
    const code = await A.evaluate(() => online.code);
    await A.waitForTimeout(6000);
    const vr0 = await vr(B);
    check(vr0.viaRelay && stats.publishes > 20, 'the game is going through the relay (' + stats.publishes + ' messages)');
    const topics = [...stats.topics];
    check(topics.length > 0 && topics.every(t => !t.includes(code) && /^bgmrelay2\/[0-9a-f]{32}$/.test(t)), 'the broker topic does not contain the game code: ' + topics.join(', '));
    const plain = stats.samples.filter(x => !/^e2:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(x) || /"t"|Alice|Bob|state|dice/.test(x));
    check(stats.samples.length > 20 && plain.length === 0, 'every message on the broker is encrypted (' + stats.samples.length + ' looked at; e.g. ' + stats.samples[5].slice(0, 40) + '...)');
    // a page given the wrong code cannot read or join the game
    await C.goto('file://' + FILE, { waitUntil: 'load' }); await C.waitForTimeout(400); await speed(C);
    const wrong = code.slice(0, 5) + (code[5] === 'A' ? 'B' : 'A');
    await C.click('#online-btn'); await C.fill('#online-name', 'Eve'); await C.fill('#online-code', wrong); await C.click('#online-watch-btn');
    await C.waitForTimeout(4000);
    check(!(await C.evaluate(() => watch.on)), 'a spectator with a different code sees nothing of this game');
    for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
    const r = await settle(8000); check(r.same, 'both screens in step');
  }

  if (scenario === 'relayspec') {
    let good = true; const chk = (c, m) => { out((c ? 'PASS ' : 'FAIL ') + m); good = good && c; };
    await setup(0, 3); await startBots([A, B], { rematch: 'false', next: 'true' });
    const code = await A.evaluate(() => online.code);
    out('   players connected via', JSON.stringify(await vr(B)));
    await C.goto('file://' + FILE, { waitUntil: 'load' }); await C.waitForTimeout(400); await speed(C);
    await C.click('#online-btn'); await C.fill('#online-name', 'Carol'); await C.fill('#online-code', code);
    const t0 = Date.now(); await C.click('#online-watch-btn');
    const ok = await C.waitForFunction(() => watch.on, null, { timeout: 40000 }).then(() => true, () => false);
    const how = await C.evaluate(() => ({ relay: watch.viaRelay, conn: online.conn && online.conn.constructor.name }));
    chk(ok && how.relay && how.conn === 'RelayGuestConn', `spectator connected through the relay after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(how)}`);
    let agree = 0, tries = 0;
    for (let i = 0; i < 4; i++) {
      await A.waitForTimeout(1500 + Math.random() * 1500);
      for (const p of [A, B]) await p.evaluate(() => { window.__botOff = true; });
      await A.waitForFunction(() => !isAnimating && !isRolling, null, { timeout: 10000 }).catch(() => {}); await A.waitForTimeout(2500);
      const sa = await A.evaluate(() => JSON.stringify({ s: state, cp: currentPlayer, d: diceValues, sc: matchScore }));
      const sc = await C.evaluate(() => JSON.stringify({ s: state, cp: currentPlayer, d: diceValues, sc: matchScore }));
      tries++; if (sa === sc) agree++;
      for (const p of [A, B]) await p.evaluate(() => { window.__botOff = false; });
    }
    chk(agree === tries, `spectator matched the host at ${agree} of ${tries} checks`);
    const cnt = await A.evaluate(() => document.getElementById('spec-info').innerText);
    chk(/1 watching: Carol/.test(cnt), 'host shows: "' + cnt + '"');
    chk(A.errors.length === 0 && B.errors.length === 0 && C.errors.length === 0 && A.desyncs.length === 0, 'no errors');
  }

  if (scenario === 'opening') {
    await setup(0, 1);
    const st = p => p.evaluate(() => ({ opening: openingRoll, canRoll: !document.getElementById('roll-btn').disabled, mine: openRolls[myColor], theirs: openRolls[oppColor()], rolling: isRolling, status: document.getElementById('status-banner').innerText.slice(0, 100) }));
    const show = async (label) => out(label, '\n   A(host):', JSON.stringify(await st(A)), '\n   B(guest):', JSON.stringify(await st(B)));
    await show('1. game start - both can click Roll Dice:');
    await A.click('#roll-btn'); await A.waitForTimeout(40);
    await show('2. host just clicked (animating):');
    await A.waitForFunction(() => !isRolling && openRolls[myColor]); await B.waitForFunction(() => !isRolling && openRolls[oppColor()]);
    await show('3. host rolled; guest still has to click:');
    // force a tie: the host throws 3+3 for everybody
    await forceDice([A, B], { 'guest:1': [3, 3] });
    await B.click('#roll-btn');
    await A.waitForFunction(() => !isRolling && openRolls[oppColor()] && !openingRoll || (!openRolls[myColor] && !openRolls[oppColor()] && !isRolling), null, { timeout: 20000 }).catch(() => {});
    await A.waitForTimeout(1500);
    await show('4. after guest clicked (host rolled 3+3 for guest too; host\'s first roll was random, so a tie is not guaranteed):');

    await forceDice([A, B], {});
    // if it tied, both click again until resolved
    for (let i = 0; i < 6; i++) {
      const open = await A.evaluate(() => openingRoll); if (!open) break;
      for (const p of [A, B]) { if (await p.evaluate(() => !document.getElementById('roll-btn').disabled && openingRoll)) { await p.click('#roll-btn'); await p.waitForTimeout(150); } }
      await A.waitForTimeout(1500);
    }
    await A.waitForFunction(() => !openingRoll, null, { timeout: 20000 }); await B.waitForFunction(() => !openingRoll, null, { timeout: 20000 });
    await A.waitForTimeout(500);
    const info = p => p.evaluate(() => ({ cur: currentPlayer, me: myColor, status: document.getElementById('status-banner').innerText.slice(0, 110), canRoll: !document.getElementById('roll-btn').disabled }));
    out('5. resolved. A:', JSON.stringify(await info(A)), '\n   B:', JSON.stringify(await info(B)));
    const [ia, ib] = [await info(A), await info(B)];
    check(ia.cur === ib.cur, 'after the opening roll the same player is to move on both screens');
    // and the match plays on
    await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForFunction(() => matchOver, null, { timeout: 240000 }); await B.waitForFunction(() => matchOver, null, { timeout: 30000 });
    const r = await settle(8000); check(r.same, 'the match finished with the same position on both screens');
  }

  if (scenario === 'opentie' || scenario === 'openreload') {
    await setup(0, 1);
    const st = p => p.evaluate(() => ({ opening: openingRoll, canRoll: !document.getElementById('roll-btn').disabled, mine: openRolls[myColor], theirs: openRolls[oppColor()], status: document.getElementById('status-banner').innerText.slice(0, 110) }));
    const show = async (label) => out(label, '\n   A(host):', JSON.stringify(await st(A)), '\n   B(guest):', JSON.stringify(await st(B)));
    if (scenario === 'opentie') {
      await forceDice([A, B], { 'host:1': [3, 3], 'guest:1': [3, 3] });   // both opening rolls show 3 and 3
      await A.click('#roll-btn'); await A.waitForFunction(() => openRolls[myColor] && !isRolling);
      await B.waitForFunction(() => openRolls[oppColor()] && !isRolling);
      await B.click('#roll-btn');
      await A.waitForFunction(() => !openingRoll || (!openRolls.w && !openRolls.r && !isRolling), null, { timeout: 20000 });
      await A.waitForTimeout(2500);
      await show('after a forced tie (3+3 vs 3+3):');
      await forceDice([A, B], {});
      await A.click('#roll-btn'); await B.waitForTimeout(400); await B.click('#roll-btn');
      await A.waitForFunction(() => !openingRoll, null, { timeout: 20000 }); await B.waitForFunction(() => !openingRoll, null, { timeout: 20000 });
      await A.waitForTimeout(600);
      const ia = await A.evaluate(() => currentPlayer), ib = await B.evaluate(() => currentPlayer);
      check(ia === ib, 'after a tie and a re-roll the same player is to move on both screens');
    } else {
      await A.click('#roll-btn'); await A.waitForFunction(() => openRolls[myColor] && !isRolling); await B.waitForFunction(() => openRolls[oppColor()] && !isRolling);
      await show('host has rolled:');
      await B.reload({ waitUntil: 'load' }); await B.waitForTimeout(500);
      check(await B.isVisible('#resume-modal'), 'the guest reloaded during the opening roll and is offered to resume');
      await speed(B); await cfg(B, { hbEvery: 300, hbTimeout: 1500, recoverEvery: 300, attemptAge: 1000, grace: 20000 });
      await B.click('#resume-modal button:has-text("Resume")');
      await B.waitForFunction(() => online.active && !online.paused, null, { timeout: 25000 }); await A.waitForFunction(() => !online.paused, null, { timeout: 25000 });
      await A.waitForTimeout(1500);
      await show('after the guest came back:');
      await A.click('#roll-btn'); await A.waitForTimeout(300); await B.click('#roll-btn');
      await A.waitForFunction(() => !openingRoll, null, { timeout: 20000 }); await B.waitForFunction(() => !openingRoll, null, { timeout: 20000 });
      await A.waitForTimeout(600);
      check((await A.evaluate(() => currentPlayer)) === (await B.evaluate(() => currentPlayer)), 'the opening roll resolved after the reconnect: same player to move');
    }
    await startBots([A, B], { rematch: 'false', next: 'true' });
    await A.waitForFunction(() => matchOver, null, { timeout: 240000 }); await B.waitForFunction(() => matchOver, null, { timeout: 30000 });
    const r = await settle(8000); check(r.same, 'the match finished with the same position on both screens');
  }
  check([A, B, C].every(p => p.errors.length === 0), 'no page errors ' + JSON.stringify([A, B, C].map(p => p.errors.slice(0, 2))));
  check(A.desyncs.length === 0 && B.desyncs.length === 0, 'no desyncs ' + JSON.stringify([A.desyncs.slice(0, 2), B.desyncs.slice(0, 2)]));
  await browser.close();
  console.log(FAILS ? FAILS + ' FAILED' : 'ALL PASS');
  process.exit(FAILS ? 1 : 0);
})().catch(e => { console.error('FAIL test crashed:', e); process.exit(1); });
