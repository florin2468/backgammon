// Backgammon rules for training: a position is two arrays of 26, each from its own side:
// [0] borne off, [1..24] points (1 = the last point before bearing off), [25] bar. p[0] is the side on roll.
#include <stdint.h>
#include <string.h>
typedef struct { signed char p[2][26]; } Pos;
#define MAXR 4096

static inline void swapSides(Pos *s) { signed char t[26]; memcpy(t, s->p[0], 26); memcpy(s->p[0], s->p[1], 26); memcpy(s->p[1], t, 26); }

// one checker of side 0 from 'from' with die d; returns 0 if not allowed
static int step(Pos *s, int from, int d) {
    signed char *a = s->p[0], *b = s->p[1];
    if (a[from] <= 0) return 0;
    if (a[25] > 0 && from != 25) return 0;
    int to = from - d;
    if (to >= 1) {
        if (b[25 - to] >= 2) return 0;
        a[from]--; a[to]++;
        if (b[25 - to] == 1) { b[25 - to] = 0; b[25]++; }
        return 1;
    }
    // bearing off: everything home
    for (int q = 7; q <= 25; q++) if (a[q]) return 0;
    if (to == 0) { a[from]--; a[0]++; return 1; }
    for (int q = from + 1; q <= 6; q++) if (a[q]) return 0;   // a higher checker must move first
    a[from]--; a[0]++;
    return 1;
}

typedef struct { Pos r[MAXR]; int n, depth; int usedHigh[MAXR]; } Results;

static void addResult(Results *R, const Pos *s, int depth, int usedHigh) {
    if (depth < R->depth) return;
    if (depth > R->depth) { R->depth = depth; R->n = 0; }
    for (int i = 0; i < R->n; i++) if (!memcmp(&R->r[i], s, sizeof(Pos))) { if (usedHigh) R->usedHigh[i] = 1; return; }
    if (R->n < MAXR) { R->r[R->n] = *s; R->usedHigh[R->n] = usedHigh; R->n++; }
}

static void rec(const Pos *s, const int *dice, int nd, int depth, int usedHigh, int high, Results *R) {
    int any = 0;
    if (nd > 0) {
        int tried[7] = {0};
        for (int k = 0; k < nd; k++) {
            int d = dice[k];
            if (tried[d]) continue;
            tried[d] = 1;
            int rest[4], nr = 0;
            for (int j = 0; j < nd; j++) if (j != k) rest[nr++] = dice[j];
            for (int from = 25; from >= 1; from--) {
                if (s->p[0][from] <= 0) continue;
                Pos t = *s;
                if (!step(&t, from, d)) continue;
                any = 1;
                rec(&t, rest, nr, depth + 1, usedHigh || d == high, high, R);
            }
        }
    }
    if (!any) addResult(R, s, depth, usedHigh);
}

// All distinct positions after side 0 plays d1,d2 (sides not swapped). At least one (the same position if nothing moves).
static void generate(const Pos *s, int d1, int d2, Results *R) {
    int dice[4], nd;
    if (d1 == d2) { dice[0] = dice[1] = dice[2] = dice[3] = d1; nd = 4; } else { dice[0] = d1; dice[1] = d2; nd = 2; }
    R->n = 0; R->depth = -1;
    int high = d1 > d2 ? d1 : d2;
    rec(s, dice, nd, 0, 0, high, R);
    if (d1 != d2 && R->depth == 1) {              // only one die can be played: the larger one if possible
        int anyHigh = 0;
        for (int i = 0; i < R->n; i++) if (R->usedHigh[i]) anyHigh = 1;
        if (anyHigh) { int m = 0; for (int i = 0; i < R->n; i++) if (R->usedHigh[i]) R->r[m++] = R->r[i]; R->n = m; }
    }
}

static void initialPos(Pos *s) {
    memset(s, 0, sizeof(Pos));
    for (int k = 0; k < 2; k++) { s->p[k][24] = 2; s->p[k][13] = 5; s->p[k][8] = 3; s->p[k][6] = 5; }
}
// 0 = game goes on; else 1 single, 2 gammon, 3 backgammon for side k who has borne off all 15
static int result(const Pos *s, int k) {
    if (s->p[k][0] < 15) return 0;
    const signed char *b = s->p[1 - k];
    if (b[0] > 0) return 1;
    if (b[25] > 0) return 3;
    for (int q = 19; q <= 24; q++) if (b[q] > 0) return 3;     // (the loser's checkers in the winner's home board: b's points 19-24)
    return 2;
}
static int contact(const Pos *s) {
    int qa = 0, qb = 0;
    for (int q = 25; q >= 1; q--) if (s->p[0][q]) { qa = q; break; }
    for (int q = 25; q >= 1; q--) if (s->p[1][q]) { qb = q; break; }
    return qa + qb > 24;
}
