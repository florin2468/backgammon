// Puts a trained network (net.bin from train.c: float32 weights in the C layout) into the game:
// the weights become int16 with one scale per layer, base64, in the BGNet.load(...) line of index.html.
// usage: node tools/nn/set_weights.js net.bin [index.html]
const fs = require('fs'), path = require('path');
const NI = 205, NH = 80, NO = 5;
const [netFile, page = path.join(__dirname, '..', '..', 'index.html')] = process.argv.slice(2);
const buf = fs.readFileSync(netFile);
const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
if (f.length !== NH * NI + NH + NO * NH + NO) { console.error('Not a ' + NI + '-' + NH + '-' + NO + ' network'); process.exit(1); }
const parts = [[0, NH * NI], [NH * NI, NH], [NH * NI + NH, NO * NH], [NH * NI + NH + NO * NH, NO]];
const q = new Int16Array(f.length), scales = [];
for (const [o, len] of parts) {
    let mx = 1e-9;
    for (let i = 0; i < len; i++) mx = Math.max(mx, Math.abs(f[o + i]));
    const sc = mx / 32767;
    scales.push(sc);
    for (let i = 0; i < len; i++) q[o + i] = Math.round(f[o + i] / sc);
}
const line = '    BGNet.load("' + Buffer.from(q.buffer).toString('base64') + '", ' + JSON.stringify(scales) + ');';
const html = fs.readFileSync(page, 'utf8');
const re = /^    BGNet\.load\(".*\);$/m;
if (!re.test(html)) { console.error('No BGNet.load(...) line in ' + page); process.exit(1); }
fs.writeFileSync(page, html.replace(re, () => line));
console.log('Network put into ' + page);
