# The coach's network

The Coach (and the hint button) judge moves with a small neural network that learnt backgammon by playing itself,
the way TD-Gammon did. Its weights are in `index.html` (the `BGNet.load(...)` line of `<script id="bg-nn">`).

- `bg.h`: the rules (every different way to play a roll), on positions stored as two arrays of 26 per side.
  `check_moves.js` checks them against the game's own engine.
- `net.h`: the network. 205 inputs (each side's points as 1+/2+/3+/(n-3)/2, bar and borne off, then contact, pip
  counts, the chances to hit a blot, closed entry points and the longest block), 80 hidden units, 5 outputs for the
  side on roll: win, win a gammon, win a backgammon, lose a gammon, lose a backgammon.
- `train.c`: TD(0) self-play. Each turn the player picks the play whose position the network rates best, and the
  position before the roll learns from it (or from the result, when the game is over).

To train and use a network:

    gcc -O3 -march=native -ffast-math -o train tools/nn/train.c -lm
    ./train 400000 net.bin "" 0.1 0.01 1          # games, output, start from (none), learning rate from/to, seed
    ./train 800000 net2.bin net.bin 0.02 0.003 11  # then more games, more gently
    node tools/nn/set_weights.js net2.bin          # into index.html
    node tests/backgammon_tests.js                 # includes checks of the network (moves, races, openings)

The page's copy of the network (`BGNet` in `index.html`) must compute exactly the same inputs as `net.h`.
