// Unit tests for the rules + AI engine inside backgammon_game.html.
// Usage:   node backgammon_tests.js [path/to/backgammon_game.html]
// No dependencies: it pulls the <script id="bg-engine"> and <script id="bg-win"> blocks out of the game file and runs them in Node.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const file = process.argv[2] || ['index.html', 'backgammon_game.html'].map(f => path.join(__dirname, '..', f)).find(f => fs.existsSync(f));
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script id="bg-engine">([\s\S]*?)<\/script>/);
if (!m) { console.error('No <script id="bg-engine"> block found in ' + file); process.exit(2); }
const sandbox = { module: { exports: {} }, console, setTimeout };
vm.createContext(sandbox);
vm.runInContext(m[1] + '\n;this.__E = BGEngine;', sandbox);
const E = sandbox.__E;
const { W, R } = E;
const mw = html.match(/<script id="bg-win">([\s\S]*?)<\/script>/);
if (!mw) { console.error('No <script id="bg-win"> block found in ' + file); process.exit(2); }
vm.runInContext(mw[1] + '\n;this.__WIN = BGWin;', sandbox);
const WIN = sandbox.__WIN;

// ---------- tiny test runner ----------
let passed = 0, failed = 0;
const queue = [];   // [name | section heading, fn | null]
function test(name, fn) { queue.push([name, fn]); }
const section = title => queue.push([title, null]);

// ---------- helpers ----------
let seed = 20260101;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rollDice = () => { const a = 1 + Math.floor(rnd() * 6), b = 1 + Math.floor(rnd() * 6); return a === b ? [a, a, a, a] : [a, b]; };

// Build a position from { w: {23: 2, ...}, r: {...}, barW, barR, offW, offR } with fresh unique ids
function pos(spec) {
    const st = { board: Array.from({ length: 24 }, () => []), bar: { w: [], r: [] }, off: { w: [], r: [] } };
    const next = { w: 0, r: 0 };
    const add = (arr, c, n) => { for (let i = 0; i < n; i++) arr.push(`c_${c}_${next[c]++}`); };
    for (const c of ['w', 'r']) for (const [p, n] of Object.entries(spec[c] || {})) add(st.board[+p], c, n);
    add(st.bar.w, 'w', spec.barW || 0); add(st.bar.r, 'r', spec.barR || 0);
    add(st.off.w, 'w', spec.offW || 0); add(st.off.r, 'r', spec.offR || 0);
    return st;
}
const moves = (st, p, d) => Array.from(E.getAllMoves(st, p, d), x => `${x.from}>${x.target}:${x.diceUsed}`).sort();
function checkInvariants(st, label) {
    const ids = new Set(); let w = 0, r = 0;
    const take = (a, where) => a.forEach(id => {
        assert(!ids.has(id), `${label}: duplicate checker ${id} (${where})`); ids.add(id);
        if (id.startsWith('c_w_')) w++; else r++;
    });
    st.board.forEach((a, i) => { take(a, 'point ' + i); if (a.length) assert(a.every(id => id[2] === a[0][2]), `${label}: mixed colours on point ${i}`); });
    take(st.bar.w, 'bar'); take(st.bar.r, 'bar'); take(st.off.w, 'off'); take(st.off.r, 'off');
    assert.strictEqual(w, 15, `${label}: white checkers = ${w}`); assert.strictEqual(r, 15, `${label}: red checkers = ${r}`);
}
// Mirror a position (swap colours, point i <-> 23-i): the game is perfectly symmetric
function mirror(st) {
    const out = { board: Array.from({ length: 24 }, () => []), bar: { w: [], r: [] }, off: { w: [], r: [] } };
    const sw = id => id.replace(/^c_([wr])_/, (_, c) => 'c_' + (c === 'w' ? 'r' : 'w') + '_');
    for (let i = 0; i < 24; i++) out.board[23 - i] = st.board[i].map(sw);
    out.bar.w = st.bar.r.map(sw); out.bar.r = st.bar.w.map(sw);
    out.off.w = st.off.r.map(sw); out.off.r = st.off.w.map(sw);
    return out;
}
const mirrorMove = x => `${x.from === 'bar' ? 'bar' : 23 - x.from}>${x.target === 'off' ? 'off' : 23 - x.target}:${x.diceUsed}`;

section('Starting position');
test('15 checkers each, standard layout, pip count 167', () => {
    const st = E.createInitialState();
    checkInvariants(st, 'start');
    assert.deepStrictEqual([23, 12, 7, 5].map(i => st.board[i].length), [2, 5, 3, 5]);
    assert.deepStrictEqual([0, 11, 16, 18].map(i => st.board[i].length), [2, 5, 3, 5]);
    assert.strictEqual(E.calcPIP(st, W), 167); assert.strictEqual(E.calcPIP(st, R), 167);
});
test('opening 3-1 for White has the expected moves', () => {
    const st = E.createInitialState();
    const got = moves(st, W, [3, 1]);
    assert(got.includes('23>22:1') && got.includes('23>20:3') && got.includes('7>4:3') && got.includes('5>2:3'));
    assert(got.includes('12>9:3'), 'point 9 is empty');
    assert(!got.some(x => x.startsWith('12>11')), 'point 11 is Red\'s and made, so 12>11 is blocked');
});
test('a blocked point cannot be landed on, a blot can be hit', () => {
    const st = pos({ w: { 10: 1, 3: 2 }, r: { 8: 2, 7: 1 }, offW: 12, offR: 12 });
    assert(!moves(st, W, [2, 6]).includes('10>8:2'), '2 checkers block');
    const u = E.applyRaw(st, W, { from: 10, target: 7, diceUsed: 3 });
    assert.strictEqual(st.bar.r.length, 1); assert(u.hit);
    u(); assert.strictEqual(st.bar.r.length, 0); assert.strictEqual(st.board[7].length, 1);
});

section('Bar, bearing off and the dice rules');
test('a checker on the bar must enter before anything else moves', () => {
    const st = pos({ w: { 12: 5, 5: 3 }, barW: 1, r: { 0: 2 }, offW: 6, offR: 13 });
    assert(moves(st, W, [3, 4]).every(x => x.startsWith('bar>')));
});
test('entering is blocked by made points; all blocked = no moves', () => {
    const st = pos({ w: { 12: 1 }, barW: 1, r: { 18: 2, 19: 2, 20: 2, 21: 2, 22: 2, 23: 2 }, offW: 13, offR: 3 });
    assert.strictEqual(moves(st, W, [1, 6]).length, 0);
});
test('bearing off: exact, and larger die only from the highest point', () => {
    const st = pos({ w: { 2: 1, 0: 1 }, offW: 13, r: { 12: 15 } });
    assert(moves(st, W, [3, 1]).includes('2>off:3'), 'a 3 bears off from the 3-point (index 2)');
    const st2 = pos({ w: { 1: 1, 0: 1 }, offW: 13, r: { 12: 15 } });
    assert(moves(st2, W, [6, 5]).includes('1>off:6'), 'higher die bears off the highest checker');
    assert(!moves(st2, W, [6, 5]).includes('0>off:6'), '...but not a lower one while a higher one remains');
});
test('cannot bear off while a checker is outside the home board', () => {
    const st = pos({ w: { 6: 1, 0: 14 }, r: { 20: 15 } });
    assert(!moves(st, W, [6, 6]).some(x => x.endsWith('off:6')));
});
test('must play both dice if possible (no move that wastes a die)', () => {
    // White blot on 23; 6 would land on a Red made point, so playing the 5 first would block the 6: only orders that use both survive
    const st = pos({ w: { 6: 1, 5: 1 }, offW: 13, r: { 0: 2, 1: 2, 2: 2, 3: 2, 4: 2, 12: 5 } });
    const turns = E.enumerateTurns(st, W, [2, 1]);
    assert(turns.length > 0 && turns.every(t => t.moves.length === Math.max(...turns.map(x => x.moves.length))));
});
test('only one die playable -> it must be the larger one', () => {
    // White's lone checker on 10. A 4 lands on 6 and a 3 on 7, but from either spot the other die is blocked (Red holds 3)
    const st = pos({ w: { 10: 1 }, offW: 14, r: { 3: 2, 20: 13 } });
    assert.deepStrictEqual(moves(st, W, [4, 3]), ['10>6:4']);
    assert.deepStrictEqual(moves(st, W, [3, 4]), ['10>6:4']);
    const turns = E.enumerateTurns(st, W, [4, 3]);
    assert.strictEqual(turns.length, 1); assert.strictEqual(turns[0].moves[0].diceUsed, 4);
});
test('doubles give four moves; combined moves list the far target with its path', () => {
    const st = E.createInitialState();
    const sel = E.getSelectableMoves(st, W, 23, [3, 3, 3, 3]);
    const far = sel.find(x => x.target === 14);
    assert(far && far.path && far.path.length === 3, 'three 3s from point 23 reach 14');
    assert(!sel.some(x => x.target === 11 || x.path && x.path.some(s => s.target === 11)), 'cannot pass through / land on Red\'s point 11');
});
test('combined move never offers a route through a blocked point', () => {
    const st = pos({ w: { 20: 1 }, offW: 14, r: { 17: 2, 14: 1, 0: 13 } });
    const sel = E.getSelectableMoves(st, W, 20, [3, 3]);          // 20 -> 17 is blocked, so 20 -> 14 must not be offered
    assert(!sel.some(x => x.target === 14));
});

section('Scoring');
test('win / gammon / backgammon', () => {
    const win = pos({ offW: 15, w: {}, r: { 20: 14 }, offR: 1 });
    assert.strictEqual(E.scoreGame(win, W).points, 1);
    const gammon = pos({ offW: 15, r: { 12: 15 } });
    assert.strictEqual(E.scoreGame(gammon, W).points, 2);
    const bg1 = pos({ offW: 15, r: { 3: 1, 12: 14 } });            // Red checker in White's home board
    assert.strictEqual(E.scoreGame(bg1, W).points, 3);
    const bg2 = pos({ offW: 15, r: { 12: 14 }, barR: 1 });         // Red checker on the bar
    assert.strictEqual(E.scoreGame(bg2, W).points, 3);
    const bgR = pos({ offR: 15, w: { 20: 1, 12: 14 } });           // mirrored: White checker in Red's home
    assert.strictEqual(E.scoreGame(bgR, R).points, 3);
});

section('Colour symmetry');
test('Red\'s moves are the mirror image of White\'s (200 random positions)', () => {
    for (let i = 0; i < 200; i++) {
        const st = E.createInitialState(); let p = W;
        for (let t = 0; t < rnd() * 80; t++) {
            const turns = E.enumerateTurns(st, p, rollDice());
            if (turns.length) turns[Math.floor(rnd() * turns.length)].moves.forEach(mv => E.applyRaw(st, p, mv));
            p = E.other(p);
        }
        const d = rollDice(), ms = mirror(st);
        const a = Array.from(E.getAllMoves(st, W, d), mirrorMove).sort();
        const b = moves(ms, R, d);
        assert.deepStrictEqual(a, b);
        assert(Math.abs(E.evaluatePosition(st, W) + E.evaluatePosition(ms, R)) < 1e-9, 'evaluation is antisymmetric');
    }
});

section('Random games');
test('300 random games finish with every invariant intact; undo restores positions', () => {
    let finished = 0;
    for (let g = 0; g < 300; g++) {
        const st = E.createInitialState(); let p = g % 2 ? W : R;
        for (let t = 0; t < 600; t++) {
            const d = rollDice(), turns = E.enumerateTurns(st, p, d);
            if (turns.length) {
                const before = E.fastSig(st), sigPip = [E.calcPIP(st, W), E.calcPIP(st, R)];
                const undo = E.applySequence(st, p, turns[0].moves); undo();
                assert.strictEqual(E.fastSig(st), before, 'undo restores the position');
                assert.deepStrictEqual([E.calcPIP(st, W), E.calcPIP(st, R)], sigPip);
                // every enumerated turn must be playable move by move through getAllMoves (rules agree with the generator)
                const t0 = turns[Math.floor(rnd() * turns.length)];
                let rem = d.slice();
                for (const mv of t0.moves) {
                    assert(E.getAllMoves(st, p, rem).some(x => x.from === mv.from && x.target === mv.target && x.diceUsed === mv.diceUsed), 'planned move is legal');
                    E.applyRaw(st, p, mv); rem.splice(rem.indexOf(mv.diceUsed), 1);
                }
            }
            if (st.off[p].length === 15) { finished++; checkInvariants(st, 'end of game ' + g); break; }
            if (t % 50 === 0) checkInvariants(st, `game ${g} turn ${t}`);
            p = E.other(p);
        }
    }
    assert(finished >= 290, 'almost all random games end (' + finished + ')');
});

section('AI');
test('every AI level returns a legal, complete plan (both colours)', () => {
    for (const level of ['easy', 'medium', 'hard', 'expert']) {
        for (let g = 0; g < 6; g++) {
            const st = E.createInitialState(); let p = g % 2 ? W : R;
            for (let t = 0; t < 40; t++) {
                const d = rollDice(), turns = E.enumerateTurns(st, p, d);
                const plan = E.aiPickPlan(st, p, d, level, rnd);
                if (!turns.length) { assert.strictEqual(plan, null); }
                else {
                    assert(plan && plan.length === turns[0].moves.length, `${level}: plays as many dice as possible`);
                    const key = ms => ms.map(y => `${y.from}>${y.target}:${y.diceUsed}`).join();
                    assert(turns.some(x => key(x.moves) === key(plan)), `${level}: plan is one of the legal turns`);
                    plan.forEach(mv => E.applyRaw(st, p, mv));
                }
                p = E.other(p);
            }
            checkInvariants(st, level + ' playout');
        }
    }
});
test('Expert is deterministic and never uses the random generator', () => {
    const st = E.createInitialState();
    const a = E.expertPickPlan(st, W, [4, 2]), b = E.expertPickPlan(st, W, [4, 2]);
    assert.deepStrictEqual(a, b);
});
test('Expert async search gives the same answer as the synchronous one', () => {
    const st = E.createInitialState();
    const sync = E.expertPickPlan(st, R, [5, 3]);
    return E.expertPickPlanAsync(st, R, [5, 3]).then(r => assert.deepStrictEqual(r, sync));
});
test('the AI takes an obvious hit-and-escape / bears off when it can', () => {
    const st = pos({ r: { 18: 1, 19: 1 }, offR: 13, w: { 2: 15 } });   // pure bear-off race: Expert must bear checkers off
    const plan = E.expertPickPlan(st, R, [6, 5]);
    assert(plan.length === 2 && plan.every(x => x.target === 'off'));
});
test('stronger levels beat weaker ones head to head (40 games)', () => {
    const play = (lw, lr) => {
        const st = E.createInitialState(); let p = rnd() < 0.5 ? W : R;
        for (let t = 0; t < 500; t++) {
            const d = rollDice(), plan = E.aiPickPlan(st, p, d, p === W ? lw : lr, rnd);
            if (plan) plan.forEach(mv => E.applyRaw(st, p, mv));
            if (st.off[p].length === 15) return p;
            p = E.other(p);
        }
        return null;
    };
    let hardWins = 0, n = 0;
    for (let i = 0; i < 40; i++) { const w = play(i % 2 ? 'hard' : 'easy', i % 2 ? 'easy' : 'hard'); if (w) { n++; if ((w === W) === (i % 2 === 1)) hardWins++; } }
    assert(hardWins / n > 0.8, `Hard beat Easy in ${hardWins}/${n}`);
});


section('Position validation (used on saved and received games)');
test('isValidState accepts real positions and rejects damaged ones', () => {
    const good = E.createInitialState();
    assert.strictEqual(E.isValidState(good), true);
    const clone = () => E.cloneState(good);
    let x = clone(); x.board[0].push('c_r_0');                         assert.strictEqual(E.isValidState(x), false, 'duplicate checker');
    x = clone(); x.board[23].pop();                                    assert.strictEqual(E.isValidState(x), false, 'missing checker');
    x = clone(); x.board[5].push(x.board[0].pop());                    assert.strictEqual(E.isValidState(x), false, 'mixed colours on a point');
    x = clone(); x.bar.w.push(x.board[0].pop());                       assert.strictEqual(E.isValidState(x), false, 'red checker on white bar');
    x = clone(); x.board[3].push('c_w_99');                            assert.strictEqual(E.isValidState(x), false, 'unknown id');
    x = clone(); x.board[3].push('hello');                             assert.strictEqual(E.isValidState(x), false, 'garbage id');
    x = clone(); x.board.pop();                                        assert.strictEqual(E.isValidState(x), false, 'wrong number of points');
    x = clone(); x.off = null;                                         assert.strictEqual(E.isValidState(x), false, 'missing off');
    assert.strictEqual(E.isValidState(null), false); assert.strictEqual(E.isValidState({}), false);
    // positions reached by real play stay valid
    const st = E.createInitialState(); let p = W;
    for (let i = 0; i < 60; i++) { const t = E.enumerateTurns(st, p, rollDice()); if (t.length) t[0].moves.forEach(m => E.applyRaw(st, p, m)); p = E.other(p); assert(E.isValidState(st)); }
});

section('Giving up a lost race');
// Winner = White with all its checkers home; Red (the loser) is on its way round. White's checkers sit on low points, so no contact.
test('no giving up while the checkers can still hit each other', () => {
    assert.strictEqual(E.concessionInfo(E.createInitialState(), R, W), null);
    assert.strictEqual(E.concessionInfo(pos({ w: { 3: 2 }, r: { 2: 1, 20: 14 }, offW: 13 }), R, W), null, 'red checker below white one: contact');
    assert.strictEqual(E.concessionInfo(pos({ w: { 3: 2 }, barR: 1, r: { 20: 14 }, offW: 13 }), R, W), null, 'red on the bar: contact');
});
test('a single game: the loser has borne off a checker', () => {
    const st = pos({ w: { 0: 2 }, offW: 13, r: { 19: 5, 20: 5, 21: 4 }, offR: 1 });
    const info = E.concessionInfo(st, R, W);
    assert(info, 'lost'); assert.strictEqual(info.points, 1); assert.strictEqual(info.kind, 'game');
    assert.strictEqual(info.offer, 1, 'offered as a single game');
});
test('a gammon: the loser has not borne off, and can not any more', () => {
    const st = pos({ w: { 0: 2 }, offW: 13, r: { 18: 5, 19: 5, 22: 5 } });
    const info = E.concessionInfo(st, R, W);
    assert(info); assert.strictEqual(info.points, 2); assert.strictEqual(info.kind, 'gammon');
    assert.strictEqual(info.canSaveGammon, false, 'white bears off both checkers on its next turn');
    assert.strictEqual(info.offer, 2, 'offered as a gammon');
});
test('a backgammon: the loser still has a checker in the winner\'s home board', () => {
    const st = pos({ w: { 0: 2 }, offW: 13, r: { 4: 1, 20: 14 } });
    const info = E.concessionInfo(st, R, W);
    assert(info); assert.strictEqual(info.points, 3); assert.strictEqual(info.kind, 'backgammon');
    assert.strictEqual(info.canSaveBackgammon, false);
    assert.strictEqual(info.offer, 3, 'offered as a backgammon only because it cannot be avoided');
});
test('a gammon or backgammon that could still be avoided is reported as avoidable', () => {
    // white has six checkers to bear off (several turns); red, far back, still cannot win, but may save the backgammon
    const st = pos({ w: { 3: 6 }, offW: 9, r: { 4: 1, 8: 14 } });
    const info = E.concessionInfo(st, R, R);       // red to move
    assert(info, 'lost'); assert.strictEqual(info.points, 3);
    assert.strictEqual(info.canSaveBackgammon, true, 'one die takes the checker out of the home board');
    assert.strictEqual(info.canSaveGammon, true, 'white needs up to 8 turns: red could even bear a checker off');
    assert.strictEqual(info.offer, 0, 'no offer: playing on could still give red a single game');
});
test('offered only at the best result the loser can still reach', () => {
    // red has a checker in white's home board that could still get out, but can't bear a checker off before white finishes
    for (const toMove of [W, R]) {
        const info = E.concessionInfo(pos({ w: { 0: 3 }, offW: 12, r: { 4: 1, 8: 14 } }), R, toMove);
        assert(info && info.points === 3, 'the position itself is a backgammon');
        assert.strictEqual(info.canSaveBackgammon, true); assert.strictEqual(info.canSaveGammon, false);
        assert.strictEqual(info.offer, 2, 'offered as a gammon, the best red can still get');
    }
    // lost, but red could still bear a checker off before white (with the slowest dice) finishes: no offer yet
    const info = E.concessionInfo(pos({ w: { 3: 6 }, offW: 9, r: { 12: 15 } }), R, W);
    assert(info, 'lost'); assert.strictEqual(info.canSaveGammon, true); assert.strictEqual(info.offer, 0);
});
test('not provably lost: a lucky run of doubles could still win', () => {
    // equal races, loser to move
    assert.strictEqual(E.concessionInfo(pos({ w: { 2: 4 }, offW: 11, r: { 21: 4 }, offR: 11 }), R, R), null);
    // loser one checker behind but on roll with enough doubles possible
    assert.strictEqual(E.concessionInfo(pos({ w: { 5: 8 }, offW: 7, r: { 18: 8 }, offR: 7 }), R, R), null);
});
test('whose turn it is matters at the border', () => {
    // white needs exactly one turn (2 checkers on the 1 point); red needs exactly one turn (2 checkers on the 1 point)
    const st = pos({ w: { 0: 2 }, offW: 13, r: { 23: 2 }, offR: 13 });
    assert.strictEqual(E.concessionInfo(st, R, R), null, 'red to move bears off both: red wins');
    assert(E.concessionInfo(st, R, W), 'white to move bears off both: red has lost');
});
test('both colours are treated the same (mirrored positions give the same answer)', () => {
    const base = [pos({ w: { 0: 2 }, offW: 13, r: { 18: 5, 19: 5, 22: 5 } }), pos({ w: { 0: 2 }, offW: 13, r: { 4: 1, 20: 14 } }), pos({ w: { 3: 6 }, offW: 9, r: { 4: 1, 8: 14 } })];
    for (const st of base) for (const toMove of [W, R]) {
        const a = E.concessionInfo(st, R, toMove), b = E.concessionInfo(mirror(st), W, E.other(toMove));
        assert.deepStrictEqual(a && [a.points, a.canSaveGammon, a.canSaveBackgammon, a.offer], b && [b.points, b.canSaveGammon, b.canSaveBackgammon, b.offer]);
    }
});
test('worst-case bear-off turns agree with an independent slow solver', () => {
    // independent implementation on lists of pips
    const memo = new Map();
    const outcomes = (pips, dice) => {
        let layer = new Map([[pips.join(), pips]]);
        for (const d of dice) {
            const nxt = new Map();
            for (const a of layer.values()) {
                if (a.length === 0) { nxt.set('', a); continue; }
                const hi = Math.max(...a);
                for (let i = 0; i < a.length; i++) {
                    if (i > 0 && a[i] === a[i - 1]) continue;
                    const p = a[i]; let b = null;
                    if (p > d) { b = a.slice(); b[i] = p - d; }
                    else if (p === d || p === hi) { b = a.slice(); b.splice(i, 1); }
                    if (b) { b.sort((x, y) => x - y); nxt.set(b.join(), b); }
                }
            }
            layer = nxt;
        }
        return [...layer.values()];
    };
    const worst = pips => {
        if (pips.length === 0) return 0;
        const k = pips.join(); if (memo.has(k)) return memo.get(k);
        let w = 0;
        for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) {
            const orders = a === b ? [[a, a, a, a]] : [[a, b], [b, a]];
            let best = Infinity;
            for (const o of orders) for (const r of outcomes(pips, o)) best = Math.min(best, worst(r));
            w = Math.max(w, best);
        }
        memo.set(k, 1 + w); return 1 + w;
    };
    let checked = 0;
    for (let t = 0; t < 40; t++) {
        const n = 1 + Math.floor(rnd() * 6), pips = [], counts = [0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < n; i++) { const p = 1 + Math.floor(rnd() * 6); pips.push(p); counts[p]++; }
        pips.sort((x, y) => x - y);
        assert.strictEqual(E.worstCaseTurns(counts), worst(pips), 'pips ' + pips.join());
        checked++;
    }
    assert(checked === 40);
    // a few known values
    assert.strictEqual(E.worstCaseTurns([0, 0, 0, 0, 0, 0, 1]), 2, 'a lone checker on the six point: 2-1 only brings it to the three point');
    assert.strictEqual(E.worstCaseTurns([0, 1, 0, 0, 0, 0, 0]), 1);
    assert.strictEqual(E.worstCaseTurns([0, 2, 0, 0, 0, 0, 0]), 1, 'two checkers on the ace point: any roll takes both');
    assert.strictEqual(E.worstCaseTurns([0, 3, 0, 0, 0, 0, 0]), 2, 'three checkers need two turns on a non-double');
});
test('whenever the game is called lost, no random continuation lets the loser win', () => {
    let called = 0, loserWins = 0;
    for (let t = 0; t < 300 && called < 60; t++) {
        // random race: white (winner side) bears off, red somewhere behind
        const wn = 1 + Math.floor(rnd() * 5), spec = { w: {}, r: {}, offW: 15 - wn };
        for (let i = 0; i < wn; i++) { const pt = Math.floor(rnd() * 6); spec.w[pt] = (spec.w[pt] || 0) + 1; }
        const rn = 4 + Math.floor(rnd() * 12); spec.offR = 15 - rn;
        for (let i = 0; i < rn; i++) { const pt = 7 + Math.floor(rnd() * 17); spec.r[pt] = (spec.r[pt] || 0) + 1; }
        const st = pos(spec), toMove = rnd() < 0.5 ? W : R;
        if (E.hasContact(st)) continue;
        if (!E.concessionInfo(st, R, toMove)) continue;
        called++;
        for (let sim = 0; sim < 25; sim++) {
            const g = E.cloneState(st); let p = toMove, guard = 0, winner = null;
            while (!winner && guard++ < 200) {
                const dice = rollDice(), turns = E.enumerateTurns(g, p, dice);
                if (turns.length) { const best = turns[Math.floor(rnd() * turns.length)]; best.moves.forEach(m => E.applyRaw(g, p, m)); }
                if (g.off[p].length === 15) winner = p;
                p = E.other(p);
            }
            if (winner === R) loserWins++;
        }
    }
    assert(called >= 20, 'enough lost positions were found to test: ' + called);
    assert.strictEqual(loserWins, 0, 'the loser won ' + loserWins + ' simulated games from positions called lost');
});
test('whenever giving up is offered, no random continuation gives the loser a better result than the price', () => {
    const seen = { 1: 0, 2: 0, 3: 0 }; let better = 0, offers = 0;
    for (let t = 0; t < 4000 && offers < 90; t++) {
        // random race: white (winner side) bearing off; red with some checkers possibly still in white's home board
        const wn = 1 + Math.floor(rnd() * 5), spec = { w: {}, r: {}, offW: 15 - wn };
        for (let i = 0; i < wn; i++) { const pt = Math.floor(rnd() * 3); spec.w[pt] = (spec.w[pt] || 0) + 1; }
        const off = rnd() < 0.3 ? 1 + Math.floor(rnd() * 3) : 0, rn = 15 - off; spec.offR = off;
        for (let i = 0; i < rn; i++) { const pt = (i === 0 && rnd() < 0.5) ? 3 + Math.floor(rnd() * 3) : 6 + Math.floor(rnd() * 18); spec.r[pt] = (spec.r[pt] || 0) + 1; }
        const st = pos(spec), toMove = rnd() < 0.5 ? W : R;
        if (E.hasContact(st)) continue;
        const info = E.concessionInfo(st, R, toMove);
        if (!info || !info.offer) continue;
        offers++; seen[info.offer]++;
        for (let sim = 0; sim < 20; sim++) {
            const g = E.cloneState(st); let p = toMove, guard = 0, winner = null;
            while (!winner && guard++ < 300) {
                const dice = rollDice(), turns = E.enumerateTurns(g, p, dice);
                if (turns.length) { const pick = turns[Math.floor(rnd() * turns.length)]; pick.moves.forEach(m => E.applyRaw(g, p, m)); }
                if (g.off[p].length === 15) winner = p;
                p = E.other(p);
            }
            const result = winner === R ? 0 : E.scoreGame(g, W).points;     // what red ends up losing (0 = red won)
            if (result < info.offer) better++;
        }
    }
    assert(offers >= 30 && seen[2] > 0 && seen[3] > 0, 'enough offers of each kind were tested: ' + JSON.stringify(seen));
    assert.strictEqual(better, 0, better + ' simulated games ended better for the loser than the price offered');
});

section('Win chance (quick play-outs for the meter above the board)');
// The game position in the win-chance engine's form: per side [0] off, [1..24] points counted from that side, [25] bar
function compact(st) {
    const w = new Int8Array(26), r = new Int8Array(26);
    for (let i = 0; i < 24; i++) { const a = st.board[i]; if (!a.length) continue; if (E.getCheckerColor(a) === W) w[i + 1] = a.length; else r[24 - i] = a.length; }
    w[25] = st.bar.w.length; r[25] = st.bar.r.length; w[0] = st.off.w.length; r[0] = st.off.r.length;
    return { w, r };
}
const sides = (st, p) => { const c = compact(st); return p === W ? [c.w, c.r] : [c.r, c.w]; };
const keyOf = (a, b) => Array.from(a).join(',') + '|' + Array.from(b).join(',');
function randomPositions(count, fn) {
    let n = 0;
    while (n < count) {
        const g = E.createInitialState(); let p = rnd() < 0.5 ? W : R;
        for (let ply = 0; ply < 300 && n < count; ply++) {
            fn(g, p); n++;
            const t = E.enumerateTurns(g, p, rollDice());
            if (t.length) E.applySequence(g, p, t[Math.floor(rnd() * t.length)].moves);
            if (g.off[p].length === 15) break;
            p = E.other(p);
        }
    }
}
test('its moves are exactly the rules engine\'s legal turns (whole rolls and part-played ones)', () => {
    randomPositions(3000, (g, p) => {
        let dice = rollDice();
        if (rnd() < 0.2) dice = dice.slice(0, 1 + Math.floor(rnd() * dice.length));
        const [a, b] = sides(g, p);
        const mine = Array.from(WIN.allTurns(a, b, dice)).sort();      // (Array.from: the engine runs in its own context)
        const theirs = Array.from(new Set(E.enumerateTurns(g, p, dice).map(t => {
            const undo = E.applySequence(g, p, t.moves); const [x, y] = sides(g, p); undo(); return keyOf(x, y);
        }))).sort();
        assert.deepStrictEqual(mine, theirs, `${p} with ${dice}: ${mine.length} vs ${theirs.length} positions`);
    });
});
test('it judges positions exactly like the computer player', () => {
    randomPositions(3000, (g, p) => {
        const [a, b] = sides(g, p);
        const ev = (p === R ? 1 : -1) * E.evaluatePosition(g, E.other(p));
        assert(Math.abs(WIN.score(a, b) - ev) < 1e-9, `${WIN.score(a, b)} vs ${ev}`);
    });
});
test('known chances come out right, and the same position always gives the same answer', () => {
    const est = (a, b, dice, n) => { const acc = WIN.newAcc(); WIN.run({ a: Int8Array.from(a), b: Int8Array.from(b), dice }, 0, n, acc); return acc; };
    const z = () => new Array(26).fill(0);
    let a = z(), b = z(); a[6] = 1; a[0] = 14; b[1] = 1; b[0] = 14;          // last checker on the 6 point vs one on the 1 point: 27 of 36 rolls win
    let r = est(a, b, null, 2000);
    assert(Math.abs(r.w / r.n - 0.75) < 0.035, 'last checker on the 6 point: ' + r.w / r.n);
    assert.strictEqual(est(a, b, [6, 1], 50).w, 50, 'a 6 bears it off');
    assert.strictEqual(est(a, b, [2, 1], 50).w, 0, 'a 2-1 does not, and the other side bears off');
    a = z(); b = z(); a[1] = 2; a[0] = 13; b[1] = 1; b[0] = 14;
    assert.strictEqual(est(a, b, null, 200).w, 200, 'two checkers on the 1 point always come off');
    a = z(); b = z(); a[13] = 5; a[8] = 4; a[6] = 4; a[25] = 2; b[1] = 2; b[2] = 2; b[3] = 2; b[4] = 2; b[5] = 2; b[6] = 3; b[8] = 2;
    r = est(a, b, null, 400);
    assert(r.w / r.n < 0.1 && r.lg / r.n > 0.5, 'two on the bar against a closed board: ' + JSON.stringify(r));
    const s = E.createInitialState(), [sa, sb] = sides(s, W);
    const r1 = est(sa, sb, null, 300), r2 = est(sa, sb, null, 300);
    assert.strictEqual(JSON.stringify(r1), JSON.stringify(r2), 'fixed seeds: same games, same numbers');
    assert(Math.abs(r1.w / r1.n - 0.5) < 0.1, 'the starting position is about even: ' + r1.w / r1.n);
});

(async () => {
    for (const [name, fn] of queue) {
        if (!fn) { console.log(name); continue; }
        try { await fn(); passed++; console.log('  ok   ' + name); }
        catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message || e)); }
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
