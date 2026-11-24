// The evaluation network: a position with side 0 on roll (before rolling) -> chances for side 0:
// [win, win gammon, win backgammon, lose gammon, lose backgammon]. Inputs: each side's points in four units
// (1+, 2+, 3+, (n-3)/2), bar, off; then contact, pips, hitting chances, closed entry points, longest blocks.
#include <math.h>
#define NI 205
#define NH 80
#define NO 5
typedef struct { float w1[NH][NI], b1[NH], w2[NO][NH], b2[NO]; } Net;


static int bitTab[7][7], directTab[7];
static void initBits(void) {
    int k = 6;
    for (int x = 1; x <= 6; x++) bitTab[x][x] = 1 << (x - 1);
    for (int x = 1; x <= 6; x++) for (int y = x + 1; y <= 6; y++) { bitTab[x][y] = bitTab[y][x] = 1 << k; k++; }
    for (int d = 1; d <= 6; d++) { int m = 0; for (int x = 1; x <= 6; x++) m |= bitTab[d][x]; directTab[d] = m; }
}
static int bitsOf(int m) { int c = 0; while (m) { m &= m - 1; c++; } return c; }
// rolls on which b's checker on its point k hits a's blot on a's point q (as the game's BGWin.shotsFrom)
static int shotsFrom(int k, int q, const signed char *a) {
    int d = k + q - 25;
    if (d < 1 || d > 24) return 0;
    int m = d <= 6 ? directTab[d] : 0;
    if (d >= 2 && d <= 12) for (int x = 1; x <= 6; x++) {
        int y = d - x; if (y < 1 || y > 6) continue;
        int i1 = 25 - (k - x), i2 = 25 - (k - y);
        if ((i1 < 1 || i1 > 24 || a[i1] < 2) || (i2 < 1 || i2 > 24 || a[i2] < 2)) m |= bitTab[x][y];
    }
    for (int x = 1; x <= 6; x++) {
        if (d % x) continue; int n = d / x; if (n < 2 || n > 4) continue;
        int open = 1;
        for (int j = 1; j < n; j++) { int i = 25 - (k - x * j); if (i >= 1 && i <= 24 && a[i] >= 2) { open = 0; break; } }
        if (open) m |= bitTab[x][x];
    }
    return m;
}
static int anyHit(const signed char *a, const signed char *b) {     // rolls (of 36) on which b hits one of a's blots
    int m = 0;
    for (int q = 1; q <= 24; q++) {
        if (a[q] != 1) continue;
        if (b[25] > 0) m |= shotsFrom(25, q, a);
        else for (int k = 26 - q; k <= 24; k++) if (b[k] > 0) m |= shotsFrom(k, q, a);
    }
    return bitsOf(m & 63) + 2 * bitsOf(m >> 6);
}
static int closedHome(const signed char *a) { int c = 0; for (int q = 1; q <= 6; q++) if (a[q] >= 2) c++; return c; }
static int longestBlock(const signed char *a) { int run = 0, best = 0; for (int q = 1; q <= 24; q++) { if (a[q] >= 2) { run++; if (run > best) best = run; } else run = 0; } return best; }
static int pips(const signed char *a) { int p = 25 * a[25]; for (int q = 1; q <= 24; q++) p += q * a[q]; return p; }

static void encode(const Pos *s, float *x) {
    int i = 0;
    for (int k = 0; k < 2; k++) {
        const signed char *a = s->p[k];
        for (int q = 1; q <= 24; q++) {
            int n = a[q];
            x[i++] = n >= 1; x[i++] = n >= 2; x[i++] = n >= 3; x[i++] = n > 3 ? (n - 3) / 2.0f : 0;
        }
        x[i++] = a[25] / 2.0f; x[i++] = a[0] / 15.0f;
    }
    const signed char *me = s->p[0], *op = s->p[1];
    int pm = pips(me), po = pips(op);
    x[i++] = contact(s);
    x[i++] = pm / 100.0f; x[i++] = po / 100.0f;
    x[i++] = anyHit(op, me) / 36.0f;      // my chances to hit (I am on roll)
    x[i++] = anyHit(me, op) / 36.0f;      // theirs, were it their roll
    x[i++] = closedHome(op) / 6.0f;       // entry points closed against me
    x[i++] = closedHome(me) / 6.0f;
    x[i++] = longestBlock(me) / 6.0f; x[i++] = longestBlock(op) / 6.0f;
}
static inline float sigm(float v) { return 1.0f / (1.0f + expf(-v)); }
static void forward(const Net *N, const float *x, float *h, float *y) {
    int act[NI], na = 0;
    for (int i = 0; i < NI; i++) if (x[i] != 0) act[na++] = i;
    for (int j = 0; j < NH; j++) {
        float v = N->b1[j]; const float *w = N->w1[j];
        for (int t = 0; t < na; t++) v += w[act[t]] * x[act[t]];
        h[j] = sigm(v);
    }
    for (int o = 0; o < NO; o++) { float v = N->b2[o]; for (int j = 0; j < NH; j++) v += N->w2[o][j] * h[j]; y[o] = sigm(v); }
}
static void tidy(float *y) {      // keep the chances consistent: win >= gammon >= backgammon (both sides)
    if (y[1] > y[0]) y[1] = y[0];
    if (y[2] > y[1]) y[2] = y[1];
    if (y[3] > 1 - y[0]) y[3] = 1 - y[0];
    if (y[4] > y[3]) y[4] = y[3];
}
static float equity(const float *y) { return 2 * y[0] - 1 + y[1] - y[3] + y[2] - y[4]; }
static void flip(const float *y, float *z) { z[0] = 1 - y[0]; z[1] = y[3]; z[2] = y[4]; z[3] = y[1]; z[4] = y[2]; }
// the chances for side 0 after it played into r (side 0 not yet swapped): exact if the game is over
static void afterValue(const Net *N, const Pos *r, float *v) {
    int res = result(r, 0);
    if (res) { v[0] = 1; v[1] = res >= 2; v[2] = res >= 3; v[3] = 0; v[4] = 0; return; }
    Pos t = *r; swapSides(&t);
    float x[NI], h[NH], y[NO];
    encode(&t, x); forward(N, x, h, y); tidy(y); flip(y, v);
}
