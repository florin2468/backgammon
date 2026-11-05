// Dragging checkers with the mouse or a finger (as well as tap-then-tap), on a PC screen and on the upright phone board
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const errs = [];
  async function fresh(vp, mobile) {
    const ctx = await b.newContext(Object.assign({ viewport: vp }, mobile ? { isMobile: true, hasTouch: true } : {}));
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + PAGE); await p.waitForTimeout(800);
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} soundEnabled = false; aiDifficulty = 'easy'; });
    // a game against the computer where it is my turn with 6-1 to play from the starting position
    await p.evaluate(() => { showMatchModal(); }); await p.waitForTimeout(150);
    await p.click('#match-modal button:has-text("3")'); await p.waitForTimeout(300);
    await p.evaluate(() => { clearTimeout(rollTimeout); openingRoll = false; state = E.createInitialState(); currentPlayer = myColor; diceValues = [6, 1]; rolledThisTurn = true; turnHistory = []; isRolling = false;
      makeAIMove = () => {}; aiRoll = () => {};          // (the computer stays still while we look)
      renderCheckers(); updateUI(); updateHitboxCursors(); });
    await p.waitForTimeout(300);
    return p;
  }
  // the centre of the top checker on a point (by board index), or of a tray, in page coordinates
  const pointCentre = (p, idx) => p.evaluate(i => { const st = state.board[i]; const el = st.length ? document.getElementById(st[st.length - 1]) : pointElements[i]; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, idx);
  const emptyPointCentre = (p, idx) => p.evaluate(i => { const r = pointElements[i].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, idx);
  const dragMouse = async (p, from, to) => { await p.mouse.move(from.x, from.y); await p.mouse.down(); for (let k = 1; k <= 8; k++) await p.mouse.move(from.x + (to.x - from.x) * k / 8, from.y + (to.y - from.y) * k / 8); await p.waitForTimeout(80); await p.mouse.up(); await p.waitForTimeout(900); };
  const pos = p => p.evaluate(() => ({ sig: fastSig(), dice: diceValues.join(','), sel: selectedSource, ghost: !!document.querySelector('.drag-ghost') }));

  for (const [label, vp, mobile] of [['PC', { width: 1280, height: 900 }, false], ['phone (upright board)', { width: 390, height: 844 }, true]]) {
    const p = await fresh(vp, mobile);
    const me = await p.evaluate(() => myColor);
    const from13 = me === 'w' ? 12 : 11, to7 = me === 'w' ? 6 : 17, far = me === 'w' ? 18 : 5;   // my mid-point (13) and my 7 point (bar point)
    // 1) drag a checker from my 13 point 6 pips to my 7 point
    const before = await pos(p);
    await dragMouse(p, await pointCentre(p, from13), await emptyPointCentre(p, to7));
    const after = await pos(p);
    const n7 = await p.evaluate(i => state.board[i].length, to7);
    ok(after.sig !== before.sig && after.dice === '1' && n7 === 1 && !after.ghost, label + ': dragging 13 -> 7 plays the 6 (dice left ' + after.dice + ')');
    // 2) a drop where it cannot go puts it back
    const b2 = await pos(p);
    await dragMouse(p, await pointCentre(p, from13), await emptyPointCentre(p, far));
    const a2 = await pos(p);
    ok(a2.sig === b2.sig && a2.dice === '1' && a2.sel === null && !a2.ghost, label + ': dropped where it cannot go, it goes back and nothing changes');
    // 3) while dragging, the checker follows the pointer and the targets light up
    const c = await pointCentre(p, to7);                 // (the checker just moved there can still move the 1)
    await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(c.x + 30, c.y + 40); await p.mouse.move(c.x + 60, c.y + 70);
    const mid = await p.evaluate(() => ({ ghost: !!document.querySelector('.drag-ghost'), lit: document.querySelectorAll('.hitbox.legal-target').length, origin: !!document.querySelector('.checker.drag-origin') }));
    await p.mouse.move(c.x, c.y); await p.mouse.up(); await p.waitForTimeout(300);     // (back where it started: nothing played)
    await p.evaluate(() => { selectedSource = null; validTargets = []; updateHitboxCursors(); });
    ok(mid.ghost && mid.lit >= 1 && mid.origin, label + ': during the drag a copy follows the pointer and ' + mid.lit + ' place(s) light up');
    // 4) tap, then tap still works
    const b4 = await pos(p);
    await p.evaluate(i => pointElements[i].querySelector('.hitbox').click(), to7);
    const t = await p.evaluate(() => validTargets.map(m => m.target));
    if (t.length) await p.evaluate(tt => { const i = tt[0]; if (i === 'off') document.getElementById(homeOrientation === 'RIGHT' ? 'tray-right' : 'tray-left').click(); else pointElements[i].querySelector('.hitbox').click(); }, t);
    await p.waitForTimeout(900);
    const a4 = await pos(p);
    ok(t.length > 0 && a4.sig !== b4.sig, label + ': tapping a checker and then its target still works');
    // 5) bearing off by dragging onto the tray
    await p.evaluate(() => { const c = myColor, o = c === 'w' ? 'r' : 'w';
      state = { board: Array.from({ length: 24 }, () => []), bar: { w: [], r: [] }, off: { w: [], r: [] } };
      const home = c === 'w' ? [0, 1, 2] : [23, 22, 21]; let n = 0;
      home.forEach(i => { for (let k = 0; k < 2; k++) state.board[i].push('c_' + c + '_' + (n++)); });
      while (n < 15) state.off[c].push('c_' + c + '_' + (n++));
      for (let k = 0; k < 15; k++) state.board[c === 'w' ? 18 + (k % 3) : 5 - (k % 3)].push('c_' + o + '_' + k);
      currentPlayer = c; diceValues = [3, 2]; rolledThisTurn = true; turnHistory = [];
      renderCheckers(); updateUI(); updateHitboxCursors(); });
    await p.waitForTimeout(1000);                       // (the checkers slide to their new places)
    const three = me === 'w' ? 2 : 21;
    const tray = await p.evaluate(() => { const r = document.getElementById(homeOrientation === 'RIGHT' ? 'tray-right' : 'tray-left').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.75 }; });
    const off0 = await p.evaluate(() => state.off[myColor].length);
    if (mobile) {                                        // on the phone: a real finger drag (touch events)
      const cdp = await p.context().newCDPSession(p), f = await pointCentre(p, three);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: f.x, y: f.y }] });
      for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: f.x + (tray.x - f.x) * k / 10, y: f.y + (tray.y - f.y) * k / 10 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(900);
    } else await dragMouse(p, await pointCentre(p, three), tray);
    const off1 = await p.evaluate(() => state.off[myColor].length);
    if (off1 !== off0 + 1) console.log('   ', JSON.stringify(await p.evaluate(() => ({ dice: diceValues, sel: selectedSource, vt: validTargets.map(m => m.target), anim: isAnimating, cp: currentPlayer, me: myColor }))));
    ok(off1 === off0 + 1, label + ': dragging a checker onto the tray' + (mobile ? ' with a finger' : '') + ' bears it off (' + off0 + ' -> ' + off1 + ')');
    await p.context().close();
  }
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
