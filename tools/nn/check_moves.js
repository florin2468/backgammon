// Checks the training program's rules (bg.h) against the game's own engine: every different way to play a roll,
// on a few thousand positions from random games. usage: gcc -O2 -o gentest tools/nn/gentest.c && node tools/nn/check_moves.js ./gentest
const fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const sb = { module: { exports: {} } };
vm.createContext(sb);
vm.runInContext(html.match(/<script id="bg-engine">([\s\S]*?)<\/script>/)[1] + '\n;this.__E = BGEngine;', sb);
const E = sb.__E;
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const comp = (st, me) => {
    const w = new Array(26).fill(0), r = new Array(26).fill(0);
    for (let i = 0; i < 24; i++) { const a = st.board[i]; if (!a.length) continue; if (a[0].charAt(2) === 'w') w[i + 1] = a.length; else r[24 - i] = a.length; }
    w[25] = st.bar.w.length; r[25] = st.bar.r.length; w[0] = st.off.w.length; r[0] = st.off.r.length;
    return me === 'w' ? [w, r] : [r, w];
};
const cases = [];
for (let g = 0; g < 150 && cases.length < 3000; g++) {
    const st = E.createInitialState(); let p = rnd() < 0.5 ? 'w' : 'r';
    for (let ply = 0; ply < 400; ply++) {
        const d1 = 1 + Math.floor(rnd() * 6), d2 = 1 + Math.floor(rnd() * 6), dice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
        const turns = E.enumerateTurns(st, p, dice), set = new Set();
        for (const t of turns) { const u = E.applySequence(st, p, t.moves); set.add(comp(st, p).map(a => a.join('.') + '.').join('|')); u(); }
        if (!turns.length) set.add(comp(st, p).map(a => a.join('.') + '.').join('|'));
        cases.push({ inp: comp(st, p).map(a => a.join(' ')).join(' ') + ' ' + d1 + ' ' + d2, js: [...set].sort() });
        if (turns.length) E.applySequence(st, p, turns[Math.floor(rnd() * turns.length)].moves);
        if (st.off.w.length === 15 || st.off.r.length === 15) break;
        p = p === 'w' ? 'r' : 'w';
    }
}
const out = execFileSync(process.argv[2] || './gentest', { input: cases.map(c => c.inp).join('\n') + '\n', maxBuffer: 1 << 28 }).toString().trim().split('\n');
let bad = 0;
cases.forEach((c, i) => { const parts = out[i].split(' '), cs = parts.slice(2).sort(); if (+parts[0] !== c.js.length || cs.join(',') !== c.js.join(',')) bad++; });
console.log(cases.length + ' positions, ' + bad + ' differences');
process.exit(bad ? 1 : 0);
