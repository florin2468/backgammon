# Backgammon

A single-file backgammon game: play against the computer (Easy to Expert), or online against a friend with a room code or invite link. Others can watch an online game once it has started (Watch button, or the spectator link in Settings). After a match, a spectator can take the seat of a player who stops.

**Play:** https://florin2468.github.io/backgammon/

A **Win chance** switch above the board shows each side's chance to win the current game, updated live after every roll and move.
It plays the position out 1,000 times with a quick computer player in a background thread (each game with a fixed random seed, so
everyone watching the same position sees the same numbers). It is an estimate, typically within a few percent.

- Rules and AI live in one self-contained block inside `index.html` (`<script id="bg-engine">`); the win-chance play-outs in `<script id="bg-win">`.
- Tests: `node tests/backgammon_tests.js` (no dependencies).
- Online play uses PeerJS (peer-to-peer). See `tests/README.md` for a two-device checklist.
