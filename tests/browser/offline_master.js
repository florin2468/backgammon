// The Master computer level (candidate moves played out in a background worker) and the hint that uses it
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + PAGE); await p.waitForTimeout(800);
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} soundEnabled = false; });
  // choose Master in the settings
  await p.evaluate(() => toggleSettingsModal()); await p.waitForTimeout(200);
  const opts = await p.evaluate(() => [...document.querySelectorAll('#setting-ai-diff option')].map(o => o.value));
  await p.selectOption('#setting-ai-diff', 'master'); await p.waitForTimeout(100);
  await p.evaluate(() => toggleSettingsModal());
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('bg_settings') || '{}').difficulty);
  ok(opts.includes('master') && saved === 'master', 'Master is offered in the settings and remembered: ' + opts.join(', '));
  // a hint (my turn, 6-4 at the start)
  await p.evaluate(() => showMatchModal()); await p.waitForTimeout(150);
  await p.click('#match-modal button:has-text("3")'); await p.waitForTimeout(300);
  await p.evaluate(() => { clearTimeout(rollTimeout); openingRoll = false; state = E.createInitialState(); currentPlayer = myColor; diceValues = [6, 4]; rolledThisTurn = true; turnHistory = []; isRolling = false; renderCheckers(); updateUI(); });
  const t0 = Date.now();
  await p.evaluate(() => showHint());
  await p.waitForFunction(() => /^Hint: \w/.test(document.getElementById('status-banner').innerText) && !hintBusy, null, { timeout: 15000 }).catch(() => {});
  const hint = await p.evaluate(() => ({ st: document.getElementById('status-banner').innerText, src: !!document.querySelector('.hint-source'), worker: !!master.worker }));
  ok(/^Hint: .*→/.test(hint.st) && hint.src && hint.worker, 'the hint uses Master (in a worker) and shows a move in ' + (Date.now() - t0) + ' ms: "' + hint.st.slice(0, 60) + '"');
  // let the game run: my side plays the first legal move each time, the computer (Master) thinks and plays
  await p.evaluate(() => { clearHint(); window.__aiTurns = 0; const o = endTurn; endTurn = function () { if (currentPlayer === oppColor()) __aiTurns++; return o.apply(this, arguments); };
    window.__me = setInterval(() => {
      if (!gameActive || isAnimating || isRolling || currentPlayer !== myColor) return;
      if (diceValues.length === 0 && !rolledThisTurn) { handleRollDice(); return; }
      const m = getAllMoves(myColor, diceValues)[0]; if (m) executeMove(m.from, m.target, m.diceUsed);
    }, 120); });
  await p.waitForFunction(() => __aiTurns >= 6 || !gameActive, null, { timeout: 120000 }).catch(() => {});
  const run = await p.evaluate(() => ({ turns: __aiTurns, valid: E.isValidState(state), total: [W, R].map(c => state.board.flat().filter(id => id.charAt(2) === c).length + state.bar[c].length + state.off[c].length) }));
  ok(run.turns >= 6 && run.valid && run.total.every(n => n === 15), 'Master played ' + run.turns + ' turns, all legal');
  // without a worker it still decides (in slices on the page)
  await p.evaluate(() => { if (master.worker) master.worker.terminate(); master.worker = null; master.noWorker = true; window.__aiTurns = 0; });
  await p.waitForFunction(() => __aiTurns >= 2 || !gameActive, null, { timeout: 120000 }).catch(() => {});
  ok(await p.evaluate(() => __aiTurns >= 2 || !gameActive), 'without a worker Master still plays');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
