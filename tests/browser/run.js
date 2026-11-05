// Runs every browser test against the game (index.html, or the file in BG_PAGE) and prints a summary.
// usage: node tests/browser/run.js [filter ...] [--group computer|online|spectators] [--jobs N] [--list]
//   filter: only tests whose name contains one of the words, e.g.  node tests/browser/run.js online_relay spectate
// A test that fails is run once more before it counts as failed (online tests run many timers at 20x speed, and a
// busy machine can occasionally upset one). Exit code 1 if anything still fails.
const { spawn } = require('child_process');
const path = require('path');

// Each test is "file [scenario] [option]", in one of three groups (GitHub runs the groups side by side).
const GROUPS = {
    computer: [   // against the computer, PC-sized screen and phone layout
        'offline_features.js', 'offline_midturn.js', 'offline_concede.js', 'offline_fairoffer.js', 'offline_blocked.js',
        'offline_blocked2.js', 'offline_rollcolour.js', 'offline_pointcolour.js', 'offline_recolour.js', 'offline_seatswap.js',
        'offline_opening.js', 'offline_winchance.js', 'offline_drag.js', 'offline_master.js', 'offline_history.js', 'offline_language.js', 'phone_play.js',
    ],
    online: [     // online through the PeerJS mock: connection trouble, sessions, settings; and the backup relay
        'online.js drop', 'online.js blackhole', 'online.js grace', 'online.js reloadguest', 'online.js reloadhost', 'online.js timer',
        'online.js rematch', 'online.js lobby', 'online.js nextgame', 'online.js concede', 'online.js blocked', 'online.js rollcol',
        'online.js swap', 'online.js swapguest', 'online.js swapno', 'online.js swapview',
        'online_relay.js relayjoin', 'online_relay.js relayone', 'online_relay.js relaydrop', 'online_relay.js directwins',
        'online_relay.js relayspec', 'online_relay.js opening', 'online_relay.js opentie', 'online_relay.js openreload', 'online_relay.js relaycrypt',
    ],
    spectators: [ // spectators, free seats, and features in online games
        'online.js spectate', 'online.js specreload', 'online.js latejoin', 'online.js phoneonline',
        'online.js seats hostkeep', 'online.js seats hostquit', 'online.js seats bothwatch', 'online.js seats guestquit',
        'online.js seats bothkeep', 'online.js seats nobody',
        'online.js winchance', 'online.js openplay guest', 'online.js openplay host', 'online.js nohint',
        'online.js tierace 6000 B', 'online.js tierace 6000 A',
        'online.js fairdice', 'online.js cheathost', 'online.js cheatguest', 'online.js wake',
    ],
};
const SUITE = Object.values(GROUPS).flat();

const args = process.argv.slice(2);
let jobs = 2, group = null;
const filters = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--jobs') jobs = Math.max(1, parseInt(args[++i], 10) || 1);
    else if (args[i] === '--group') { group = args[++i]; if (!GROUPS[group]) { console.error('No group ' + group); process.exit(2); } }
    else if (args[i] === '--list') { SUITE.forEach(t => console.log(t)); process.exit(0); }
    else filters.push(args[i]);
}
const todo = (group ? GROUPS[group] : SUITE).filter(t => !filters.length || filters.some(f => t.includes(f)));
if (!todo.length) { console.error('No test matches ' + filters.join(' ')); process.exit(2); }

function runOne(test) {
    const [file, ...rest] = test.split(' ');
    return new Promise(resolve => {
        const t0 = Date.now();
        const child = spawn(process.execPath, [path.join(__dirname, file), ...rest], { env: process.env });
        let out = '';
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { out += d; });
        const kill = setTimeout(() => { out += '\nFAIL timed out after 8 minutes'; child.kill('SIGKILL'); }, 8 * 60 * 1000);
        child.on('close', code => {
            clearTimeout(kill);
            const lines = out.split('\n');
            const fails = lines.filter(l => /^FAIL\b/.test(l) || /TEST FAILED/.test(l));
            const passes = lines.filter(l => /^PASS\b/.test(l)).length;
            // older offline scripts print "errors [...]" at the end instead of a check
            const errLine = lines.find(l => /^errors \[.+\]/.test(l) && !/^errors \[\]/.test(l));
            if (errLine) fails.push('FAIL page errors: ' + errLine.slice(0, 200));
            const ok = code === 0 && fails.length === 0 && passes > 0;
            resolve({ test, ok, passes, fails, secs: Math.round((Date.now() - t0) / 1000), out, code });
        });
    });
}

(async () => {
    const results = [];
    let next = 0;
    const started = Date.now();
    async function worker() {
        while (next < todo.length) {
            const test = todo[next++];
            let r = await runOne(test);
            if (!r.ok) {
                console.log(`  retrying ${test} (${r.fails.length} failed check${r.fails.length === 1 ? '' : 's'})`);
                const first = r;
                r = await runOne(test);
                r.retried = first;
            }
            results.push(r);
            console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${test.padEnd(34)} ${String(r.passes).padStart(3)} checks  ${r.secs}s${r.retried && r.ok ? '  (passed on the second try)' : ''}`);
            if (!r.ok) {
                r.fails.slice(0, 6).forEach(f => console.log('       ' + f.slice(0, 220)));
                if (!r.fails.length) console.log('       exit code ' + r.code + '; last lines:\n' + r.out.trim().split('\n').slice(-8).map(l => '       ' + l).join('\n'));
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(jobs, todo.length) }, worker));
    const bad = results.filter(r => !r.ok), flaky = results.filter(r => r.ok && r.retried);
    console.log(`\n${results.length - bad.length} of ${results.length} tests passed in ${Math.round((Date.now() - started) / 60000)} min` +
        (flaky.length ? `; ${flaky.length} needed a second try (${flaky.map(r => r.test).join(', ')})` : ''));
    if (bad.length) console.log('Failed: ' + bad.map(r => r.test).join(', '));
    process.exit(bad.length ? 1 : 0);
})();
