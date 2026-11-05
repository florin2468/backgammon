# Backgammon tests

## Unit tests (rules + AI)
The rules and the AI live in one self-contained block of `index.html` (`<script id="bg-engine">`).
The tests load that exact block, so they always test the code that ships.

    node tests/backgammon_tests.js            # from the folder that holds index.html
    node backgammon_tests.js path/to/index.html

Needs only Node 16+. It checks: starting position, hitting and blocked points, bar entry, bearing off, the
"play as many dice as possible" and larger-die rules, combined moves, gammon/backgammon scoring, Red/White symmetry
(200 random positions), 300 random full games (invariants, undo), every AI level, Expert determinism, and the
position validator used for saved and received games. The win-chance block (`<script id="bg-win">`) is checked against
the rules engine (same legal turns and the same position scores on 3,000 random positions each) and on positions whose
chances are known exactly.

## Browser tests
`tests/browser/` drives the real page in Chromium (Playwright): games against the computer on a PC-sized screen and in
the phone layout, dragging checkers, Master and the hint button, the match history and its `.mat` export (replayed move
by move with the rules engine), the Romanian translation, and online games between several pages. The network is never
used: PeerJS and the relay brokers are replaced by in-test mocks (`sandbox.js` refuses every other request). The online
tests cover dropped and slow connections, reloads, the lobby, rematches, colour swaps, spectators and free seats, the
fair dice (including a host and a guest that try to cheat) and the encrypted relay.

    npm install                      # Playwright 1.56
    npx playwright install chromium
    node tests/browser/run.js                     # everything (about 25 minutes with --jobs 2)
    node tests/browser/run.js --group computer    # or online / spectators: GitHub runs the three side by side
    node tests/browser/run.js online_relay seats  # only tests whose name contains one of the words
    node tests/browser/offline_drag.js            # one file on its own

`BG_PAGE=/path/to/file.html` tests another copy of the game; `BG_OUT` is where screenshots go (default: the temp folder).
A failing test is run once more before it counts (the online tests run their timers 20 times faster than real time).
`BG_I18N_OUT=missing.txt node tests/browser/run.js` also writes every piece of English text the game showed during the
tests that has no Romanian translation yet (the list in the `Language` block of `index.html`).

## Two-device check of online play (not automated)
The automated online tests use a simulated PeerJS. Before relying on a change, try once with two real devices:

1. Open the game on both devices from a web address (or the same file on each) and press Play Online.
2. Device A: pick a match length and create the game. Device B: enter the code (or open the link) and press Join.
3. Roll, move (by dragging and by tapping), undo on both sides; the boards must stay identical. There is no hint button
   in online games. Neither screen should dim or lock while the game is on.
4. Turn off Wi-Fi on one device for ~10 s, then back on: the game should pause, then resume by itself.
5. Reload one device mid-game and press Resume.
6. Finish a 1-point match and press Rematch on both devices.
7. On a third device, open the spectator link (Settings, during the game) or enter the code and press Watch: it should show the
   game live, follow both players' moves, and keep up after a player reloads. The players should see "1 watching".
8. With that spectator still watching, finish the match. Both players get Keep playing / Watch / Quit. Have one player press
   Watch: the spectator gets "Take the free seat"; after pressing it, the new pair land on the settings screen of a new game
   and the player who chose Watch is watching it.

9. On a phone held upright: the phone layout (score card at the top, dice on the board's bar, Undo / Roll / Hint at the
   bottom, the ... menu) should fill the screen without scrolling; turned sideways it switches to the landscape layout.
10. Switch on Win chance (above the board) on both devices and the spectator: the numbers should appear within a second,
    change only when a player finishes a turn, and match on all three screens once they settle.
11. Set one device to Romanian (Settings > Language): its texts change, the other device stays in English, and play goes on.

To pin the PeerJS library, see the comment above its `<script>` tag in the HTML file.

## Relay fallback
If two devices cannot open a direct WebRTC link, the guest switches (after ~8 s) to a message relay: public MQTT-over-WebSocket
brokers (`RELAY_BROKERS` in `index.html`). In the manual test, a phone on mobile data joining a PC should work either way;
the error text ends with a code such as `[server ok / direct link no / ice failed / relay ok (3 brokers)]` that shows which path was used.
