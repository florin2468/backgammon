# Backgammon

A single-file backgammon game: play against the computer (Easy to Expert), or online against a friend with a room code or invite link. Others can watch an online game once it has started (Watch button, or the spectator link in Settings). After a match, a spectator can take the seat of a player who stops.

**Play:** https://florin2468.github.io/backgammon/

- Rules and AI live in one self-contained block inside `index.html` (`<script id="bg-engine">`).
- Tests: `node tests/backgammon_tests.js` (no dependencies).
- Online play uses PeerJS (peer-to-peer). See `tests/README.md` for a two-device checklist.
