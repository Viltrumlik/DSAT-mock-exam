// Generates the app's Lottie files. Run: node ios/tools/lottie/make-lottie.mjs
// Output: ios/MasterSAT/Resources/Lottie/*.json (checked in). Edit here, never the JSON.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../MasterSAT/Resources/Lottie');

const C = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, 1];
const S = v => ({ a: 0, k: v });
const IO = { o: { x: [.45], y: [0] }, i: { x: [.55], y: [1] } };
const OUTE = { o: { x: [.2], y: [0] }, i: { x: [.2], y: [1] } };
const IN = { o: { x: [.55], y: [0] }, i: { x: [.9], y: [.5] } };
const POP = { o: { x: [.34], y: [1.56] }, i: { x: [.64], y: [1] } };
const LIN = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
function A(frames, ease) {
  return { a: 1, k: frames.map(([t, v, e], n) => {
    const s = Array.isArray(v) ? v : [v];
    if (n === frames.length - 1) return { t, s };
    const z = e || ease || IO;
    return { t, s, o: z.o, i: z.i };
  }) };
}
function AS(frames) {
  return { a: 1, k: frames.map(([t, v], n) => n === frames.length - 1 ? { t, s: [v] }
    : { t, s: [v], o: { x: .45, y: 0 }, i: { x: .55, y: 1 } }) };
}
const P = (v, i, o, c = true) => ({ i, o, v, c });
const sh = k => ({ ty: 'sh', ks: k });
const fl = (hex, op = 100) => ({ ty: 'fl', c: S(C(hex)), o: S(op), r: 1 });
const st = (hex, w) => ({ ty: 'st', c: S(C(hex)), o: S(100), w: S(w), lc: 2, lj: 2, ml: 4 });
const tr = (o = {}) => ({ ty: 'tr', p: o.p || S([0, 0]), a: o.a || S([0, 0]), s: o.s || S([100, 100]), r: o.r || S(0), o: o.o || S(100), sk: S(0), sa: S(0) });
const gr = (items, t) => ({ ty: 'gr', it: [...items, t || tr()] });
const el = (w, h, p = [0, 0]) => ({ ty: 'el', p: S(p), s: S([w, h]), d: 1 });
const rc = (w, h, p, r) => ({ ty: 'rc', p: S(p), s: S([w, h]), r: S(r), d: 1 });
const tm = (s, e) => ({ ty: 'tm', s, e, o: S(0), m: 1 });
const rp = (n, rot) => ({ ty: 'rp', c: S(n), o: S(0), m: 1, tr: { ty: 'tr', p: S([0, 0]), a: S([0, 0]), s: S([100, 100]), r: S(rot), so: S(100), eo: S(100) } });
const star = (pt, inner, outer, p = [0, 0]) => ({ ty: 'sr', sy: 1, d: 1, pt: S(pt), p: S(p), r: S(0), ir: S(inner), is: S(0), or: S(outer), os: S(0) });
const L = (ind, nm, shapes, ks = {}, extra = {}) => ({ ddd: 0, ind, ty: 4, nm, sr: 1,
  ks: { o: ks.o || S(100), r: ks.r || S(0), p: ks.p || S([100, 100, 0]), a: ks.a || S([0, 0, 0]), s: ks.s || S([100, 100, 100]) },
  ao: 0, shapes, ip: 0, op: 9999, st: 0, bm: 0, ...extra });
const anim = (nm, op, layers) => ({ v: '5.7.4', fr: 60, ip: 0, op, w: 200, h: 200, nm, ddd: 0, assets: [], layers });

// Strike flame — loops. Three nested flames morph between three silhouettes; sparks rise.
function flame(tipX, tipY, w) {
  return P([[tipX, tipY], [30 * w, -8], [36 * w, 22], [0, 54], [-36 * w, 22], [-22 * w, -20]],
    [[-6, 14], [-6, -16], [0, -10], [20 * w, 0], [0, 20], [-8, 12]],
    [[6, 16], [8, 14], [0, 20], [-20 * w, 0], [0, -12], [6, -10]]);
}
const flick = () => AS([[0, flame(4, -62, 1)], [30, flame(-7, -56, 1.05)], [60, flame(9, -67, .96)], [90, flame(4, -62, 1)]]);
const sparks = [[-14, 0, -8], [10, 10, 12], [-4, 20, -16], [18, 30, 6], [-20, 40, 10]].map(([x, d, dx], n) =>
  L(10 + n, 'spark' + n, [gr([el(7, 7), fl('#fbbf24')])], {
    p: A([[d, [100 + x, 128, 0]], [d + 50, [100 + x + dx, 28, 0]]], OUTE),
    o: A([[d, 0], [d + 8, 100], [d + 50, 0]]),
    s: A([[d, [100, 100, 100]], [d + 50, [40, 40, 100]]]),
  }));
const FLAME = anim('strike-flame', 90, [
  ...sparks,
  L(2, 'flame', [
    gr([sh(flick()), fl('#fef3c7')], tr({ p: S([0, 38]), s: S([30, 30]) })),
    gr([sh(flick()), fl('#fbbf24')], tr({ p: S([0, 20]), s: S([62, 62]) })),
    gr([sh(flick()), fl('#f97316')]),
  ], { a: S([0, 54, 0]), p: S([100, 170, 0]), s: A([[0, [100, 100, 100]], [45, [95, 105, 100]], [90, [100, 100, 100]]]) }),
  L(3, 'glow', [gr([el(96, 18), fl('#f97316', 22)])], { p: S([100, 172, 0]) }),
]);

// Task complete — plays once. Circle pops, the tick draws, rays and dots burst out.
const dot = (hex, size, from, to, rot) => gr([
  gr([el(size, size), fl(hex)], tr({ p: A([[10, [0, -from]], [40, [0, -to]]], OUTE), s: A([[10, [100, 100]], [34, [100, 100]], [44, [0, 0]]]) })),
  rp(6, 60),
], tr({ r: S(rot) }));
const CHECK = anim('task-complete', 110, [
  L(1, 'check', [gr([sh(S(P([[-20, 2], [-6, 16], [22, -14]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], false))),
    tm(S(0), A([[12, 0], [28, 100]], OUTE)), st('#ffffff', 10)])]),
  L(2, 'circle', [gr([el(84, 84), fl('#22c55e')])], { s: A([[0, [0, 0, 100], POP], [16, [112, 112, 100]], [26, [100, 100, 100]]]) }),
  L(3, 'dots', [dot('#f59e0b', 9, 46, 88, 30), dot('#a855f7', 7, 40, 74, 0)]),
  L(4, 'rays', [gr([sh(S(P([[0, -50], [0, -76]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false))),
    tm(A([[16, 0], [32, 100]], OUTE), A([[8, 0], [22, 100]], OUTE)), st('#f59e0b', 6), rp(8, 45)])]),
]);

// Trophy — loops. Drops in and squashes, a shine sweeps across, stars twinkle, rays turn.
const cupBody = P([[-38, -42], [38, -42], [0, 20]], [[0, 32], [0, 0], [28, 0]], [[0, 0], [0, 32], [-28, 0]]);
const cupPos = () => A([[0, [100, 40, 0], IN], [18, [100, 160, 0]], [90, [100, 160, 0], OUTE], [102, [100, 140, 0], IN], [114, [100, 160, 0]]]);
const cupScale = () => A([[0, [100, 100, 100]], [18, [100, 100, 100], OUTE], [24, [116, 84, 100]], [36, [94, 108, 100]], [46, [100, 100, 100]],
  [112, [100, 100, 100], OUTE], [118, [110, 90, 100]], [130, [100, 100, 100]]]);
const cupKs = () => ({ a: S([0, 56, 0]), p: cupPos(), s: cupScale(), o: A([[0, 0], [4, 100]]) });
const twinkle = (x, y, d, hex, size) => gr([star(4, size * .3, size), fl(hex)],
  tr({ p: S([x, y]), s: A([[d, [0, 0]], [d + 12, [100, 100]], [d + 30, [0, 0]]]), r: A([[d, 0], [d + 30, 45]]) }));
const TROPHY = anim('trophy', 150, [
  L(1, 'stars', [twinkle(-64, -44, 30, '#fbbf24', 12), twinkle(66, -22, 52, '#2a68c0', 10), twinkle(48, -72, 74, '#fbbf24', 9), twinkle(-52, 6, 96, '#2a68c0', 8)]),
  L(2, 'shine-matte', [gr([sh(S(cupBody)), fl('#000000')])], cupKs(), { td: 1 }),
  L(3, 'shine', [gr([rc(16, 150, [0, 0], 0), fl('#ffffff', 75)], tr({ p: A([[40, [-80, -10]], [66, [80, -10]]], IO), r: S(22) }))], cupKs(), { tt: 1 }),
  L(4, 'cup', [
    gr([star(5, 5, 11, [0, -18]), fl('#fff7d6')]),
    gr([rc(84, 10, [0, -44], 5), fl('#fbbf24')]),
    gr([sh(S(cupBody)), fl('#f59e0b')]),
    gr([el(30, 34, [-40, -20]), st('#f59e0b', 6)]),
    gr([el(30, 34, [40, -20]), st('#f59e0b', 6)]),
    gr([rc(12, 22, [0, 30], 2), fl('#d97706')]),
    gr([rc(54, 14, [0, 47], 5), fl('#b45309')]),
  ], cupKs()),
  L(5, 'burst', [gr([sh(S(P([[-7, -30], [7, -30], [0, -100]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]]))), fl('#fbbf24', 26), rp(12, 30)])],
    { p: S([100, 112, 0]), r: A([[0, 0], [150, 30]], LIN), s: A([[0, [0, 0, 100], POP], [26, [100, 100, 100]]]) }),
]);

mkdirSync(OUT, { recursive: true });
for (const data of [FLAME, CHECK, TROPHY]) {
  const json = JSON.stringify(data);
  writeFileSync(join(OUT, data.nm + '.json'), json);
  console.log(data.nm, json.length, 'bytes');
}
