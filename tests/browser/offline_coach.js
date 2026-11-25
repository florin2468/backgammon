// The Coach: after your turn against the computer, your move against the best one (verdict, why, top moves),
// waiting after a mistake (arrows for your move and the best one at once, preview the best move, undo and try again,
// continue), the hint agreeing with it, the switch remembered, the side panel on wide screens, the folded card that keeps
// clear of the arrows on a tablet and a phone, and Romanian
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const errs = [];
  async function open(opts) {
    const ctx = await b.newContext(opts); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
    await p.goto('file://' + PAGE); await p.waitForTimeout(700);
    return p;
  }
  // a 3-point match against the computer with my 6-4 to play from the start position
  async function sixFour(p) {
    await p.evaluate(() => { soundEnabled = false; aiDifficulty = 'easy'; if (!matchActive) { showMatchModal(); } });
    if (await p.isVisible('#match-modal')) { await p.click('#match-modal button:has-text("3")'); await p.waitForTimeout(300); }
    await p.evaluate(() => { openingRoll = false; state = E.createInitialState(); currentPlayer = myColor; diceValues = [6, 4]; rolledThisTurn = true; turnHistory = []; renderCheckers(); updateUI(); });
  }
  const play = (p, list) => p.evaluate(async list => {     // [[from point, die], ...] counted from my side
    window.__tok = coach.token;                            // (result() waits for the coach's next rating)
    const pt = n => myColor === W ? n - 1 : 24 - n;
    for (const [f, d] of list) {
      while (isAnimating) await new Promise(r => setTimeout(r, 50));
      const m = getAllMoves(myColor, diceValues).find(m => m.from === pt(f) && m.diceUsed === d);
      executeMove(m.from, m.target, d);
    }
  }, list);
  const result = p => p.waitForFunction(() => coach.token > window.__tok && !coach.busy && coach.res, null, { timeout: 30000 }).then(() => p.evaluate(() => ({
    v: coach.res.verdict, title: document.getElementById('coach-title').innerText, sub: document.getElementById('coach-sub').innerText,
    why: [...document.querySelectorAll('#coach-why li')].map(e => e.innerText), rows: [...document.querySelectorAll('#coach-moves tr')].map(t => t.innerText.replace(/\s+/g, ' ')),
    hold: coach.hold, me: currentPlayer === myColor, best: coach.res.best.note, status: document.getElementById('status-banner').innerText,
    shown: !document.getElementById('coach-card').classList.contains('hidden') })));

  // ---- PC: the side panel ----
  const p = await open({ viewport: { width: 1280, height: 900 } });
  ok(await p.isVisible('#coach-toggle') && await p.evaluate(() => !coachOn), 'the Coach switch is next to Win chance, off by default');
  await p.click('#coach-toggle');
  await sixFour(p);
  ok(await p.evaluate(() => document.documentElement.classList.contains('coach-dock') && !document.getElementById('coach-card').classList.contains('hidden')),
     'on a wide screen the coach is a panel beside the board, waiting for your move');
  await play(p, [[13, 6], [13, 4]]);                     // 13/7 13/9: two blots
  let r = await result(p);
  ok(['mistake', 'blunder'].includes(r.v) && /\(−0\.\d{3}\)$/.test(r.title) && r.sub.length > 3, '13/7 13/9 is rated a mistake: "' + r.title + '" — ' + r.sub);
  ok(['8/2 6/2', '24/14', '24/18 13/9', '24/18 24/20'].includes(r.best), 'the best 6-4 is a standard one: ' + r.best);
  ok(r.why.length >= 2 && r.why.some(t => /of 36 rolls/.test(t)) && /wins \d+% of the time, yours \d+%/.test(r.why[r.why.length - 1]), 'it explains why: ' + JSON.stringify(r.why));
  ok(r.rows.length >= 3 && /yours$/.test(r.rows[r.rows.length - 1]) && /^1\. /.test(r.rows[0]), 'top moves with yours marked: ' + JSON.stringify(r.rows));
  ok(r.hold && r.me && /Undo and try again, or continue/.test(r.status), 'after a mistake the game waits for you');
  const arrows = pg => pg.evaluate(() => ({ best: document.querySelectorAll('#coach-arrows path[data-move="best"]').length, mine: document.querySelectorAll('#coach-arrows path[data-move="mine"]').length,
    gold: [...document.querySelectorAll('#coach-arrows path[data-move="best"]')].every(e => e.getAttribute('stroke') === '#facc15'),
    key: !document.getElementById('coach-key').classList.contains('hidden') && !document.getElementById('coach-key-mine').classList.contains('hidden'),
    bottom: Math.max(...[...document.querySelectorAll('#coach-arrows path')].map(e => e.getBoundingClientRect().bottom)),
    card: document.getElementById('coach-card').getBoundingClientRect().top, label: document.getElementById('coach-show').innerText }));
  let a = await arrows(p);
  ok(a.best === 2 && a.mine === 2 && a.gold && a.key && a.label === 'Preview best move', 'without a click, the board shows your move (blue) and the best one (gold) together, with a colour key');
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => currentPlayer === myColor && !isAITurn()), 'the computer has not moved meanwhile');
  // show the best move on the board, with arrows
  const before = await p.evaluate(() => fastSig());
  await p.click('#coach-show'); await p.waitForTimeout(900);
  let v = await p.evaluate(() => ({ view: coach.view, bv: !!boardView, arrows: document.querySelectorAll('#coach-arrows path').length, real: fastSig(), label: document.getElementById('coach-show').innerText }));
  ok(v.view === 'best' && v.bv && v.arrows >= 2 && v.real === before && v.label === 'Show your move', 'Preview best move: the board shows it with arrows (the real position is unchanged)');
  a = await arrows(p);
  ok(a.best === 2 && a.mine === 0, 'and only the best move\'s arrows then');
  await p.click('#coach-show'); await p.waitForTimeout(300);
  a = await arrows(p);
  ok(await p.evaluate(() => !boardView && coach.view === 'mine') && a.best === 2 && a.mine === 2, 'and back to your move, with both again');
  // undo and try again, then play the best move: no waiting
  await p.click('#coach-retry'); await p.waitForTimeout(1200);
  v = await p.evaluate(() => ({ dice: diceValues.slice().sort().join(), hist: turnHistory.length, hold: coach.hold, hidden: document.getElementById('coach-card').getAttribute('data-verdict') }));
  ok(v.dice === '4,6' && v.hist === 0 && !v.hold, 'Undo and try again: the whole turn is taken back, the 6-4 can be played again');
  await play(p, [[8, 6], [6, 4]]);                       // 8/2 6/2
  r = await result(p);
  ok(['best', 'excellent'].includes(r.v) && !r.hold, '8/2 6/2: "' + r.title + '" — ' + r.sub + ', and the game goes on');
  await p.waitForFunction(() => currentPlayer === oppColor(), null, { timeout: 5000 }).catch(() => {});
  ok(await p.evaluate(() => currentPlayer === oppColor()), 'the computer plays its turn');
  // the hint agrees with the coach
  await p.waitForFunction(() => currentPlayer === myColor && !isAnimating && !aiThinking, null, { timeout: 20000 }).catch(() => {});
  await sixFour(p);
  const hintPlan = await p.evaluate(async () => { const pl = await nnBestPlan(state, myColor, [6, 4]); const pa = coachPaths(state, myColor, pl); return coachNotation(myColor, pa.paths); });
  await play(p, [[24, 6], [24, 4]]);
  r = await result(p);
  ok(r.best === hintPlan, 'the hint plays what the coach calls best (' + hintPlan + ')');
  // undo during the wait drops the coach; Continue passes the turn
  if (r.hold) {
    await p.evaluate(() => undoMove()); await p.waitForTimeout(900);
    ok(await p.evaluate(() => !coach.hold && document.getElementById('coach-card').getAttribute('data-verdict') === 'idle'), 'an undo while the coach waits puts it away');
    await play(p, [[24, 4]]); r = await result(p);
  }
  if (r.hold) { await p.click('#coach-go'); await p.waitForTimeout(400); }
  ok(await p.evaluate(() => !coach.hold && currentPlayer === oppColor()), 'Continue: the turn passes to the computer');
  // a roll with only one way to play: nothing to say
  await p.waitForFunction(() => currentPlayer === myColor && !isAnimating && !aiThinking, null, { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => {
    const st = { board: Array.from({ length: 24 }, () => []), bar: { w: [], r: [] }, off: { w: [], r: [] } };
    const me = myColor, op = oppColor(), pt = n => me === W ? n - 1 : 24 - n;
    let k = 0; const put = (c, i, n) => { for (let j = 0; j < n; j++) st.board[i].push('c_' + c + '_' + (k++ % 15)); };
    put(me, pt(1), 15); k = 0; put(op, pt(24), 15);
    state = st; currentPlayer = me; diceValues = [1, 1, 1, 1]; rolledThisTurn = true; turnHistory = []; coachDrop(); renderCheckers(); updateUI();
  });
  await p.evaluate(() => { const m = getAllMoves(myColor, diceValues)[0]; executeMove(m.from, m.target, m.diceUsed); });
  await p.waitForTimeout(3600);
  ok(await p.evaluate(() => !coach.hold && !coach.res), 'a roll with only one way to play gets no rating');
  // remembered
  await p.reload(); await p.waitForTimeout(700);
  ok(await p.evaluate(() => coachOn && document.getElementById('coach-toggle').getAttribute('aria-checked') === 'true'), 'the switch is remembered after a reload');
  await p.evaluate(() => { online.active = true; syncHintButtons(); });
  ok(!(await p.isVisible('#coach-toggle')) && !(await p.evaluate(() => document.documentElement.classList.contains('coach-dock'))), 'not in online games');
  await p.evaluate(() => { online.active = false; syncHintButtons(); });

  // ---- tablet: the waiting card folds to one line below the arrows ----
  const t = await open({ viewport: { width: 1024, height: 768 } });
  await t.evaluate(() => { if (!coachOn) toggleCoach(); });
  await sixFour(t);
  await play(t, [[13, 6], [13, 4]]);
  r = await result(t); await t.waitForTimeout(300);
  a = await arrows(t);
  const tc = await t.evaluate(() => { const c = document.getElementById('coach-card'), q = c.getBoundingClientRect(); return { h: q.height, open: c.classList.contains('cc-open'), go: !!document.getElementById('coach-go').offsetParent, retry: !!document.getElementById('coach-retry').offsetParent }; });
  ok(!tc.open && tc.h < 80 && tc.go && tc.retry && a.best === 2 && a.mine === 2 && a.bottom <= a.card + 1,
     'on a tablet the card waits on one line (' + Math.round(tc.h) + 'px) with Undo and Continue, below the arrows (' + Math.round(a.bottom) + ' <= ' + Math.round(a.card) + ')');
  await t.context().close();

  // ---- phone, in Romanian ----
  const q = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ro-RO' });
  const misses = []; q.on('console', m => { if (m.text().startsWith('[i18n-miss] ')) misses.push(m.text().slice(12)); });
  await q.evaluate(() => { I18N.misses = new Set(); I18N.collect = true; if (!coachOn) toggleCoach(); });
  await sixFour(q);
  await play(q, [[13, 6], [13, 4]]);
  r = await result(q); await q.waitForTimeout(200);
  ok(/^(Greșeală mică|Gafă) \(−0\.\d{3}\)$/.test(r.title) && r.why.every(t => /[ăâîșț]/.test(t) || /\d/.test(t)) && /a ta$/.test(r.rows[r.rows.length - 1]), 'in Romanian: "' + r.title + '" — ' + r.sub + ' / ' + r.why[0]);
  const box = await q.evaluate(() => { const c = document.getElementById('coach-card').getBoundingClientRect(); return { top: c.top, bottom: c.bottom, h: innerHeight }; });
  ok(box.bottom <= box.h && box.top > 100, 'on a phone the card sits at the bottom of the screen');
  a = await arrows(q);
  const pc = await q.evaluate(() => ({ open: document.getElementById('coach-card').classList.contains('cc-open'), go: !!document.getElementById('coach-go').offsetParent, show: !!document.getElementById('coach-show').offsetParent, key: document.getElementById('coach-key').innerText.replace(/\s+/g, ' ') }));
  ok(!pc.open && pc.go && !pc.show && a.best === 2 && a.mine === 2 && a.bottom <= a.card + 1 && /Cea mai bună mutare/.test(pc.key),
     'folded while it waits, both moves\' arrows in view above it (' + pc.key + ')');
  await q.click('#coach-more'); await q.waitForTimeout(300);
  await q.click('#coach-show'); await q.waitForTimeout(600);
  ok(await q.evaluate(() => document.getElementById('coach-card').classList.contains('cc-mini') && document.getElementById('coach-mini-t').innerText === 'Cea mai bună mutare e arătată pe tablă'), 'showing the best move folds the card away');
  await q.click('#coach-mini button'); await q.waitForTimeout(300);
  await q.click('#coach-go'); await q.waitForTimeout(500);
  const roll = await q.evaluate(() => { const c = document.getElementById('coach-card').getBoundingClientRect(), r = document.getElementById('phone-actions').getBoundingClientRect(); return { card: c.bottom, actions: r.top }; });
  ok(roll.card <= roll.actions + 1, 'folded, the card keeps clear of the Roll button');
  ok(misses.filter(s => !/^(AI|Player)$/.test(s)).length === 0, 'nothing left untranslated: ' + JSON.stringify(misses.slice(0, 5)));
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
