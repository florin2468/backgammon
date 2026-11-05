// Romanian / English: chosen from the browser language the first time, switched in Settings and remembered;
// also checks that the Inter font comes from the page itself (no font download from another site)
const { chromium } = require('playwright'); require('./sandbox')(chromium);
const PAGE = process.env.BG_PAGE || require('path').resolve(__dirname, '../../index.html');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  // 1) a browser set to Romanian
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ro-RO' });
  await ctx.addInitScript(() => { window.__i18nCollect = true; });
  const p = await ctx.newPage();
  const errs = [], misses = [], reqs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.text().startsWith('[i18n-miss] ')) misses.push(m.text().slice(12)); });
  p.on('request', r => { if (/^https?:/.test(r.url())) reqs.push(r.url()); });
  await p.goto('file://' + PAGE); await p.waitForTimeout(800);
  const look = () => p.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, roll: document.getElementById('roll-btn').innerText.replace(/\s+/g, ' '),
      start: document.getElementById('start-match-btn').innerText, status: document.getElementById('status-banner').innerText, undo: document.getElementById('undo-btn').title }));
  let v = await look();
  ok(v.lang === 'ro' && v.title === 'Table clasice din lemn' && v.roll === 'DĂ CU ZARUL' && v.start === 'Începe meciul' && /^Apasă „Începe meciul”/.test(v.status) && v.undo === 'Anulează mutarea (U)',
     'a Romanian browser gets Romanian: ' + JSON.stringify(v));
  const fonts = await p.evaluate(async () => { await Promise.all(['400', '600', '700', '800'].map(w => document.fonts.load(w + ' 16px Inter', 'ăîșțĂÎȘȚ'))); return [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Inter').map(f => f.weight + ':' + f.status); });
  ok(fonts.length === 4 && fonts.every(f => /:loaded$/.test(f)) && !reqs.some(u => /font/i.test(u)), 'the Inter font is built into the page (' + fonts.join(' ') + '), nothing downloaded for it');
  // a few turns against the computer, all in Romanian
  await p.evaluate(() => { soundEnabled = false; aiDifficulty = 'easy'; const o = window.setTimeout.bind(window); window.setTimeout = (f, ms, ...a) => o(f, (ms || 0) / 5, ...a); showMatchModal(); });
  await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.querySelector('#match-modal h3, #match-modal h2').innerText.includes('Alege meciul')), 'the match window is in Romanian');
  await p.click('#match-modal button:has-text("3")'); await p.waitForTimeout(200);
  ok(/^Zarul de început/.test(await p.evaluate(() => document.getElementById('status-banner').innerText)), 'opening roll message in Romanian');
  await p.evaluate(() => { clearInterval(window.__me); window.__me = setInterval(() => {
      if (!gameActive || isAnimating || isRolling || currentPlayer !== myColor) return;
      if (openingRoll || (diceValues.length === 0 && !rolledThisTurn)) { if (!document.getElementById('roll-btn').disabled) handleRollDice(); return; }
      const m = getAllMoves(myColor, diceValues)[0]; if (m) executeMove(m.from, m.target, m.diceUsed); }, 60); });
  await p.waitForFunction(() => turnSerial >= 6, null, { timeout: 60000 }).catch(() => {});
  await p.evaluate(() => clearInterval(window.__me));
  const st = await p.evaluate(() => document.getElementById('status-banner').innerText);
  const aria = await p.evaluate(() => [...document.querySelectorAll('.hitbox')].map(e => e.getAttribute('aria-label') || '').find(a => /\d/.test(a)));
  ok(!/\b(the|and|rolled|moved|is|your|You)\b/.test(st) && /^Căsuța \d+/.test(aria), 'after several turns: "' + st + '" / "' + aria + '"');
  // 2) switch to English in Settings: everything goes back to English, and it is remembered
  await p.evaluate(() => toggleSettingsModal()); await p.waitForTimeout(100);
  await p.click('#lang-en-btn'); await p.waitForTimeout(100);
  v = await look();
  const st2 = v.status;
  ok(v.lang === 'en' && v.title === 'Classic Wooden Backgammon' && v.roll === 'ROLL DICE' && v.start === 'Start Match' && v.undo === 'Undo Move (U)' && /[A-Za-z]/.test(st2) && !/[ăâîșț]/.test(st2),
     'English from Settings: ' + JSON.stringify(v));
  ok(await p.evaluate(() => document.querySelector('#settings-modal label').innerText) === 'Language', 'the Settings window itself switched');
  await p.click('#lang-ro-btn'); await p.waitForTimeout(100);
  v = await look();
  ok(v.lang === 'ro' && v.roll === 'DĂ CU ZARUL' && v.status !== st2, 'and back to Romanian: ' + v.status);
  // questions asked with confirm() are translated too
  let asked = '';
  p.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await p.evaluate(() => { toggleSettingsModal(); resetGame(); });     // the home button, in the middle of a match
  await p.waitForTimeout(200);
  ok(asked === 'Abandonezi acest meci și începi unul nou?', 'questions are asked in Romanian: "' + asked + '"');
  ok(misses.filter(s => !/^(AI|Player)$/.test(s)).length === 0, 'no English left untranslated on the way: ' + JSON.stringify(misses.slice(0, 8)));
  // 3) English chosen once stays English, even in a Romanian browser
  await p.evaluate(() => setLanguage('en')); await p.reload(); await p.waitForTimeout(700);
  v = await look(); ok(v.lang === 'en' && v.start === 'Start Match', 'the choice of English is remembered after a reload');
  await p.evaluate(() => setLanguage('ro')); await p.reload(); await p.waitForTimeout(700);
  v = await look(); ok(v.lang === 'ro' && v.start === 'Începe meciul', 'so is the choice of Romanian');
  // 4) an English browser gets English
  const p2 = await (await b.newContext({ locale: 'en-GB' })).newPage();
  await p2.goto('file://' + PAGE); await p2.waitForTimeout(600);
  ok(await p2.evaluate(() => document.documentElement.lang === 'en' && document.getElementById('start-match-btn').innerText === 'Start Match'), 'an English browser gets English');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
