# Backgammon

A single-file backgammon game: play against the computer (Easy to Master), or online against a friend with a room code or invite link. Others can watch an online game once it has started (Watch button, or the spectator link in Settings). After a match, a spectator can take the seat of a player who stops.

**Play:** https://florin2468.github.io/backgammon/

- **Moving:** drag a checker, or click (tap) it and then its destination; keyboard and screen readers work too.
- **Computer levels:** Easy, Medium, Hard, Expert and Master. Master judges every move with the coach's neural network,
  looking one roll ahead (the strongest level). The hint button uses the same judgement; hints exist only against the
  computer.
- **Win chance:** a switch above the board shows each side's chance to win the current game. It changes only when a
  player finishes a turn (never during a turn, so it does not hint at a move). It plays the position out 1,000 times
  with a quick computer player in a background thread, each game with a fixed random seed, so everyone watching the same
  position sees the same numbers. It is an estimate, typically within a few percent.
- **Coach:** a switch next to Win chance (games against the computer). After each of your turns it rates your move the
  way a backgammon trainer does: best, excellent (gives away under 0.02 points per game), small mistake (up to 0.08) or
  blunder. It names the kind of error (safety error, missed attacking opportunity, structural miss, passive error, racing
  inefficiency...) or what the best move does well, explains why (shots, hits, points made, blocks, anchors, escapes,
  gammons), and lists the top moves with what each gives away. After a mistake the game waits, with
  arrows on the board for your move (blue) and the best move (gold), no click needed, and the checkers' places
  before the move shown faded: undo and try again, or continue
  (Preview best move shows the board after the best move). On wide screens it is a panel beside the board. The judging
  comes from a small neural network trained for this game by self-play (TD learning, as TD-Gammon), looking one roll
  ahead; the training program is in `tools/nn/`.
- **History:** the chart button lists the matches played in this browser, with totals per opponent. Any match can be
  exported as a Jellyfish `.mat` file, which GNU Backgammon and other analysis programs open.
- **Language:** English or Romanian (Settings). A browser set to Romanian starts in Romanian.

## Online play
- PeerJS (WebRTC) connects the two browsers directly; if that fails, the game switches to a relay through public
  MQTT brokers. Relay messages are encrypted end to end (AES-GCM, with a key derived from the game code), and WebRTC is
  encrypted anyway.
- **Fair dice:** before the match each browser builds a secret SHA-256 hash chain and sends only its last link (the
  commitment). Every roll combines a fresh link from the roller with one from the opponent, so neither side can choose a
  roll, and each side checks every roll against the other's commitment. A roll that does not check out is refused, and
  the game stops if the host's dice ever fail the check. Spectators see the host's view.
- The screen stays awake during an online game (Wake Lock, where the browser supports it).
- If the connection drops, the game pauses and reconnects by itself; a reloaded page can resume.

## Code and tests
- Everything is in `index.html`. The rules and the computer players are one self-contained block
  (`<script id="bg-engine">`); the win-chance and Master play-outs are in `<script id="bg-win">`. The Inter font is built
  into the page (SIL Open Font License), so the page loads nothing from font sites.
- Unit tests: `node tests/backgammon_tests.js` (no dependencies).
- Browser tests (Chromium through Playwright, no network needed): `npm install`, `npx playwright install chromium`,
  then `node tests/browser/run.js`. GitHub Actions runs both on every push. See `tests/README.md`.
