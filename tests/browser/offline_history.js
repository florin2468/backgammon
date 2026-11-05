// Match history, statistics, and the .mat export (checked by replaying every exported move with the rules engine)
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const fast = () => p.evaluate(() => { const o = window.setTimeout.bind(window); window.setTimeout = (f, ms, ...a) => o(f, (ms || 0) / 10, ...a); soundEnabled = false; });
  const autoMe = () => p.evaluate(() => { clearInterval(window.__me); window.__me = setInterval(() => {
      if (!gameActive || isAnimating || isRolling || currentPlayer !== myColor) return;
      if (openingRoll || (diceValues.length === 0 && !rolledThisTurn)) { if (!document.getElementById('roll-btn').disabled) handleRollDice(); return; }
      const plan = E.aiPickPlan(state, myColor, diceValues.slice(), 'hard'); const m = plan && plan[0] ? plan[0] : getAllMoves(myColor, diceValues)[0];
      if (m) executeMove(m.from, m.target, m.diceUsed); }, 40); });
  await p.goto('file://' + PAGE); await p.waitForTimeout(700);
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} aiDifficulty = 'easy'; document.getElementById('setting-ai-diff').value = 'easy'; });
  await fast();
  // 1) a whole 1-point match against the computer
  await p.evaluate(() => showMatchModal()); await p.waitForTimeout(100);
  await p.click('#match-modal button:has-text("1")'); await p.waitForTimeout(100);
  await autoMe();
  await p.waitForFunction(() => matchOver, null, { timeout: 180000 });
  await p.waitForTimeout(300);
  const rec = await p.evaluate(() => JSON.parse(localStorage.getItem('bg_history')).matches[0]);
  const turns = rec.games[0].turns;
  ok(rec.done && rec.len === 1 && rec.games.length === 1 && (rec.won === (rec.score[0] === 1)) && rec.mode === 'ai' && rec.level === 'easy',
    'the finished match is in the history: ' + (rec.won ? 'won' : 'lost') + ' ' + rec.score.join('-') + ', ' + turns.length + ' turns, ' + rec.games[0].kind);
  ok(turns.length > 10 && turns.every(t => /^[1-6]{2}$/.test(t.d) || t.d === '') && turns.some(t => t.m.length) && turns.every(t => t.m.every(m => /^\d{1,2}\/\d{1,2}\*?$/.test(m))), 'every turn has its dice and moves');
  // 2) the window
  await p.evaluate(() => toggleHistoryModal()); await p.waitForTimeout(200);
  const ui = await p.evaluate(() => ({ tiles: [...document.querySelectorAll('.hs-tile .hs-v')].map(e => e.textContent), opps: [...document.querySelectorAll('#hs-opps tr td.hs-name')].map(e => e.textContent), rows: document.querySelectorAll('#hs-list .hs-row').length, first: document.querySelector('#hs-list .hs-t').textContent }));
  ok(ui.tiles[0] === (rec.won ? '1–0' : '0–1') && ui.opps[0] === 'Computer (Easy)' && ui.rows === 1 && /to 1/.test(ui.first), 'the window shows the result: ' + JSON.stringify(ui));
  // 3) export, and replay the file with the rules engine
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#hs-list .hs-exp')]);
  const txt = fs.readFileSync(await dl.path(), 'utf8');
  ok(/^ 1 point match$/m.test(txt) && /^ Game 1$/m.test(txt) && /^ You : 0 +Computer : 0$/m.test(txt) && /Wins \d points? and the match/.test(txt) && /\.mat$/.test(dl.suggestedFilename()),
    'the file is a Jellyfish .mat match (' + dl.suggestedFilename() + ')');
  const replay = await p.evaluate(text => {
    const st = E.createInitialState(), me = myColor, opp = oppColor();
    const lines = text.split('\n').filter(l => /^ *\d+\) /.test(l));
    const toIdx = (c, n) => n === 25 ? 'bar' : n === 0 ? 'off' : (c === 'w' ? n - 1 : 24 - n);
    let bad = 0, applied = 0;
    const play = (c, entry) => {
      const m = /^(\d)(\d):(.*)$/.exec(entry.trim()); if (!m) return;
      for (const mv of m[3].trim().split(/\s+/).filter(Boolean)) {
        const [f, t] = mv.replace('*', '').split('/').map(Number), from = toIdx(c, f), to = toIdx(c, t);
        const die = f === 25 ? 25 - t : (t === 0 ? null : f - t);
        const legal = E.getLegalMovesRaw(st, c, from, [1, 2, 3, 4, 5, 6]).find(x => x.target === to && (die === null || x.diceUsed === die));
        if (!legal) { bad++; return; }
        E.applyRaw(st, c, { from, ...legal }); applied++;
      }
    };
    for (const l of lines) { const body = l.replace(/^ *\d+\) /, ''); const left = body.slice(0, 29).trim(), right = body.slice(29).trim(); if (left) play(me, left); if (right) play(opp, right); }
    return { bad, applied, offMe: st.off[me].length, offOpp: st.off[opp].length };
  }, txt);
  ok(replay.bad === 0 && replay.applied > 20 && (replay.offMe === 15 || replay.offOpp === 15), 'replaying the exported moves with the rules gives the same game: ' + JSON.stringify(replay));
  await p.evaluate(() => toggleHistoryModal());
  // 4) a 3-point match, reloaded in the middle: still one record, carried on
  await p.evaluate(() => { clearInterval(window.__me); onNextGameClick(); }); await p.waitForTimeout(200);
  if (await p.isVisible('#match-modal')) await p.click('#match-modal button:has-text("3")');
  await p.waitForTimeout(200); await autoMe();
  await p.waitForFunction(() => { const g = histCur && histCur.games[0]; return g && g.turns.length >= 8; }, null, { timeout: 60000 });
  await p.evaluate(() => { clearInterval(window.__me); persistAIMatch(); });
  const before = await p.evaluate(() => ({ id: histCur.id, n: histCur.games[0].turns.length }));
  await p.reload(); await p.waitForTimeout(800); await fast();
  if (await p.isVisible('#ai-resume-modal')) await p.click('#ai-resume-modal button:has-text("Continue")');
  await p.waitForTimeout(300); await autoMe();
  await p.waitForFunction(n => histCur && histCur.games[0].turns.length >= n + 4, before.n, { timeout: 60000 }).catch(() => {});
  const after = await p.evaluate(() => ({ id: histCur && histCur.id, n: histCur ? histCur.games[0].turns.length : 0, recs: hist.matches.length }));
  ok(after.id === before.id && after.n >= before.n + 4 && after.recs === 2, 'after a reload the same match goes on being recorded (' + before.n + ' -> ' + after.n + ' turns, ' + after.recs + ' matches kept)');
  // 5) clearing (the match in progress stays)
  p.once('dialog', d => d.accept());
  await p.evaluate(() => { toggleHistoryModal(); histClear(); });
  const left = await p.evaluate(() => JSON.parse(localStorage.getItem('bg_history')).matches.length);
  ok(left === 1, 'Clear history keeps only the match being played (' + left + ')');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
