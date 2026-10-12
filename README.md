# Backgammon

A single-file backgammon game: play against the computer (Easy to Expert), or online against a friend with a room code or invite link.

**Play:** https://florin2468.github.io/backgammon/

- Rules and AI live in one self-contained block inside `index.html` (`<script id="bg-engine">`).
- Tests: `node tests/backgammon_tests.js` (no dependencies).
- Online play uses PeerJS (peer-to-peer). See `tests/README.md` for a two-device checklist.
