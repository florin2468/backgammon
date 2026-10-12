# Backgammon tests

## Unit tests (rules + AI)
The rules and the AI live in one self-contained block of `index.html` (`<script id="bg-engine">`).
The tests load that exact block, so they always test the code that ships.

    node tests/backgammon_tests.js            # from the folder that holds index.html
    node backgammon_tests.js path/to/index.html

Needs only Node 16+. It checks: starting position, hitting and blocked points, bar entry, bearing off, the
"play as many dice as possible" and larger-die rules, combined moves, gammon/backgammon scoring, Red/White symmetry
(200 random positions), 300 random full games (invariants, undo), every AI level, Expert determinism, and the
position validator used for saved and received games.

## Two-device check of online play (not automated)
Online play has only been tested with a simulated PeerJS. Before relying on it, try once with two real devices:

1. Open the game on both devices from a web address (or the same file on each) and press Play Online.
2. Device A: pick a match length and create the game. Device B: enter the code (or open the link) and press Join.
3. Roll, move, undo on both sides; the boards must stay identical.
4. Turn off Wi-Fi on one device for ~10 s, then back on: the game should pause, then resume by itself.
5. Reload one device mid-game and press Resume.
6. Finish a 1-point match and press Rematch on both devices.

To pin the PeerJS library, see the comment above its `<script>` tag in the HTML file.
