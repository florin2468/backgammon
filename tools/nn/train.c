#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include "bg.h"
#include "net.h"
static uint64_t rs = 88172645463325252ull;
static inline uint64_t xr(void) { rs ^= rs << 13; rs ^= rs >> 7; rs ^= rs << 17; return rs; }
static inline int die(void) { return 1 + (int)(xr() % 6); }
static float frand(void) { return (xr() >> 11) * (1.0 / 9007199254740992.0); }
static Net N;
static Results R;
static void save(const char *f) { FILE *o = fopen(f, "wb"); fwrite(&N, sizeof N, 1, o); fclose(o); }
static void train(const Pos *s, const float *target, float alpha) {
    float x[NI], h[NH], y[NO], dO[NO], dH[NH];
    encode(s, x); forward(&N, x, h, y);
    for (int o = 0; o < NO; o++) dO[o] = target[o] - y[o];        // (cross-entropy with sigmoid outputs)
    for (int j = 0; j < NH; j++) { float e = 0; for (int o = 0; o < NO; o++) e += dO[o] * N.w2[o][j]; dH[j] = e * h[j] * (1 - h[j]); }
    for (int o = 0; o < NO; o++) { for (int j = 0; j < NH; j++) N.w2[o][j] += alpha * dO[o] * h[j]; N.b2[o] += alpha * dO[o]; }
    for (int i = 0; i < NI; i++) { if (x[i] == 0) continue; float xi = alpha * x[i]; for (int j = 0; j < NH; j++) N.w1[j][i] += xi * dH[j]; }
    for (int j = 0; j < NH; j++) N.b1[j] += alpha * dH[j];
}
int main(int argc, char **argv) {
    long games = argc > 1 ? atol(argv[1]) : 100000;
    const char *out = argc > 2 ? argv[2] : "net.bin";
    if (argc > 3 && argv[3][0]) { FILE *f = fopen(argv[3], "rb"); if (!f || fread(&N, sizeof N, 1, f) != 1) { fprintf(stderr, "no start net\n"); return 1; } fclose(f); }
    else for (int j = 0; j < NH; j++) { for (int i = 0; i < NI; i++) N.w1[j][i] = (frand() - 0.5f) * 0.2f; for (int o = 0; o < NO; o++) N.w2[o][j] = (frand() - 0.5f) * 0.2f; }
    float a0 = argc > 4 ? atof(argv[4]) : 0.1f, a1 = argc > 5 ? atof(argv[5]) : 0.01f;
    if (argc > 6) rs ^= (uint64_t)atoll(argv[6]) * 0x9E3779B97F4A7C15ull;
    initBits();
    long plies = 0; int wins[4] = {0};
    clock_t t0 = clock();
    for (long g = 1; g <= games; g++) {
        float alpha = a0 + (a1 - a0) * (float)g / games;
        Pos s; initialPos(&s);
        int d1, d2; do { d1 = die(); d2 = die(); } while (d1 == d2);    // the opening roll is never a double
        for (int ply = 0; ply < 1000; ply++) {
            if (ply) { d1 = die(); d2 = die(); }
            generate(&s, d1, d2, &R);
            int best = 0; float bestEq = -9, bv[NO];
            for (int i = 0; i < R.n; i++) { float v[NO]; afterValue(&N, &R.r[i], v); float e = equity(v); if (e > bestEq) { bestEq = e; best = i; memcpy(bv, v, sizeof v); } }
            train(&s, bv, alpha);          // the position before the roll learns from the best after-state
            Pos nx = R.r[best];
            plies++;
            int res = result(&nx, 0);
            if (res) { wins[res]++; break; }
            swapSides(&nx); s = nx;
        }
        if (g % 10000 == 0) {
            double secs = (double)(clock() - t0) / CLOCKS_PER_SEC;
            fprintf(stderr, "%ld games, %.1f plies/game, single %d gammon %d bg %d, alpha %.4f, %.0f s\n", g, (double)plies / 10000, wins[1], wins[2], wins[3], alpha, secs);
            plies = 0; wins[1] = wins[2] = wins[3] = 0;
            save(out);
        }
    }
    save(out);
    return 0;
}
