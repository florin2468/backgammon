#include <stdio.h>
#include <stdlib.h>
#include "bg.h"
static int cmp(const void*a,const void*b){return memcmp(a,b,sizeof(Pos));}
int main(){ Pos s; int d1,d2; static Results R;
  while(1){ int v; for(int k=0;k<2;k++) for(int q=0;q<26;q++){ if(scanf("%d",&v)!=1) return 0; s.p[k][q]=v; }
    if(scanf("%d %d",&d1,&d2)!=2) return 0;
    generate(&s,d1,d2,&R); qsort(R.r,R.n,sizeof(Pos),cmp);
    printf("%d %d", R.n, R.depth);
    for(int i=0;i<R.n;i++){ printf(" "); for(int q=0;q<26;q++) printf("%d.", R.r[i].p[0][q]); printf("|"); for(int q=0;q<26;q++) printf("%d.", R.r[i].p[1][q]); }
    printf("\n"); fflush(stdout);
  } }
