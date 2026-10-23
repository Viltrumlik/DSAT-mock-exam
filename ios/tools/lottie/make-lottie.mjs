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
// `rest`: the frame a still picture of the clip shows (`LottieClip` pauses on the marker) —
// the last frame, unless the clip ends faded out.
const anim = (nm, op, layers, rest = op) => ({ v: '5.7.4', fr: 60, ip: 0, op, w: 200, h: 200, nm, ddd: 0, assets: [], layers,
  markers: [{ tm: rest, cm: 'rest', dr: 0 }] });

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

// Coin burst — plays once, then fades. A coin pops in, flips once, and small coins and sparks
// fly out. Played where a purchase or a conversion was confirmed.
const coin = s => [
  gr([el(s * .5, s * .12), fl('#fff7d6', 70)], tr({ p: S([-s * .12, -s * .26]), r: S(-24) })),
  gr([star(5, s * .1, s * .22), fl('#fff7d6')]),
  gr([el(s * .72, s * .72), st('#f59e0b', s * .07)]),
  gr([el(s, s), fl('#fbbf24')]),
  gr([el(s, s), fl('#d97706')], tr({ p: S([0, s * .07]) })),
];
const flyer = (hex, size, from, to, rot, d) => gr([
  gr([el(size, size), fl(hex)], tr({
    p: A([[d, [0, -from]], [d + 30, [0, -to]]], OUTE),
    s: A([[d, [0, 0]], [d + 6, [100, 100]], [d + 22, [100, 100]], [d + 34, [0, 0]]]),
  })),
  rp(8, 45),
], tr({ r: S(rot) }));
// The coin is whole and still from the end of its flip to the start of its fade, and by then the
// small coins and sparks are gone: it rests inside that window, at frame 54.6.
const COIN_FLIP_END = 50, COIN_FADE = 60;
const COIN_REST = Math.round((COIN_FLIP_END + .46 * (COIN_FADE - COIN_FLIP_END)) * 10) / 10;
const COIN = anim('coin-burst', 84, [
  L(1, 'coin', coin(84), {
    s: A([[0, [0, 0, 100], POP], [14, [116, 116, 100]], [22, [100, 100, 100]], [34, [100, 100, 100]], [42, [12, 100, 100]], [COIN_FLIP_END, [100, 100, 100]]]),
    o: A([[COIN_FADE, 100], [82, 0]]),
  }),
  L(2, 'coins', [flyer('#fbbf24', 15, 38, 92, 0, 6), flyer('#f59e0b', 9, 32, 70, 22.5, 12)]),
  L(3, 'sparks', [gr([sh(S(P([[0, -48], [0, -66]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false))),
    tm(A([[10, 0], [26, 100]], OUTE), A([[4, 0], [18, 100]], OUTE)), st('#fde68a', 5), rp(8, 45)])], { r: S(22.5) }),
], COIN_REST);

// Star burst — plays once, then fades. A glow swells, rays turn, a ring of stars flies out and
// a few twinkle. Played behind the trophy when the student moves up a place. It rests on the last
// frame the flown-out stars are full size, with rays and glow still at full strength.
const STARS_HELD = 56;
const STARS = anim('star-burst', 100, [
  L(1, 'twinkles', [twinkle(-70, -60, 30, '#fbbf24', 11), twinkle(72, -48, 44, '#2a68c0', 9),
    twinkle(60, 66, 58, '#fbbf24', 10), twinkle(-62, 58, 70, '#2a68c0', 8)]),
  L(2, 'stars', [gr([
    gr([star(5, 4, 10), fl('#fbbf24')], tr({
      p: A([[6, [0, -26]], [42, [0, -90]]], OUTE),
      s: A([[6, [0, 0]], [16, [110, 110]], [STARS_HELD, [100, 100]], [78, [0, 0]]]),
      r: A([[6, 0], [70, 120]]),
    })),
    rp(8, 45),
  ])]),
  L(3, 'rays', [gr([sh(S(P([[-7, -34], [7, -34], [0, -98]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]]))), fl('#fbbf24', 34), rp(12, 30)])],
    { r: A([[0, 0], [100, 40]], LIN), s: A([[0, [0, 0, 100], POP], [24, [100, 100, 100]]]), o: A([[70, 100], [98, 0]]) }),
  L(4, 'glow', [gr([el(120, 120), fl('#fde68a', 40)])],
    { s: A([[0, [0, 0, 100], POP], [18, [130, 130, 100]], [40, [100, 100, 100]]]), o: A([[0, 0], [6, 100], [74, 100], [98, 0]]) }),
], STARS_HELD);

// The empty and error states. Each plays once, about 1.2 s, and its last frame is its finished
// picture: a page that is empty or failed should look settled, not busy. Brand colours only, and
// nothing red — an error here is a request that did not land, not a danger.
const GREEN = '#059669', BLUE = '#2a68c0', AMBER = '#f59e0b', WARN = '#d97706', GREY = '#94a3b8';
const line = pts => sh(S(P(pts, pts.map(() => [0, 0]), pts.map(() => [0, 0]), false)));
const draw = (from, to) => tm(S(0), A([[from, 0], [to, 100]], OUTE));
const popIn = (from, to) => A([[from, [0, 0]], [to, [100, 100]]], POP);
const sparkle = (x, y, size, d) => gr([star(4, size * .4, size), fl(GREEN)], tr({ p: S([x, y]), s: popIn(d, d + 16) }));

// All done — calmer than task-complete, which is the celebration: a ring draws round, the tick
// strokes in, three small sparkles pop and stay.
const ALL_DONE = anim('all-done', 78, [
  L(1, 'sparkles', [sparkle(62, -60, 13, 36), sparkle(84, -26, 8, 42), sparkle(-70, -52, 9, 48)]),
  L(2, 'tick', [gr([line([[-24, 2], [-7, 19], [25, -15]]), draw(24, 44), st(GREEN, 9)])]),
  L(3, 'ring', [gr([el(116, 116), draw(0, 34), st(GREEN, 8)])]),
  L(4, 'disc', [gr([el(116, 116), fl(GREEN, 10)])], { s: A([[0, [80, 80, 100]], [30, [100, 100, 100]]], OUTE), o: A([[0, 0], [12, 100]]) }),
]);

// Nothing to do — an empty tray drops in and lands softly (a 3 % squash, no bounce), then two
// sheets settle into it as lines.
const trayBody = P([[-42, -36], [42, -36], [58, 0], [58, 32], [50, 40], [-50, 40], [-58, 32], [-58, 0]],
  [[0, 0], [0, 0], [0, 0], [0, 0], [4.4, 0], [0, 0], [0, 4.4], [0, 0]],
  [[0, 0], [0, 0], [0, 0], [0, 4.4], [0, 0], [-4.4, 0], [0, 0], [0, 0]]);
const NO_TASKS = anim('no-tasks', 80, [
  L(1, 'tray', [
    gr([line([[-30, -24], [30, -24]]), draw(30, 48), st(GREY, 6)]),
    gr([line([[-22, -12], [22, -12]]), draw(40, 58), st(BLUE, 6)]),
    gr([line([[-58, 0], [-24, 0], [-18, 12], [18, 12], [24, 0], [58, 0]]), st(GREY, 7)]),
    gr([sh(S(trayBody)), st(GREY, 7), fl(GREY, 10)]),
  ], {
    a: S([0, 40, 0]),
    p: A([[0, [100, 70, 0]], [24, [100, 140, 0]]], OUTE),
    s: A([[24, [100, 100, 100]], [30, [103, 97, 100]], [40, [100, 100, 100]]]),
    o: A([[0, 0], [8, 100]]),
  }),
  L(2, 'shadow', [gr([el(104, 10), fl(GREY, 22)])],
    { p: S([100, 148, 0]), s: A([[0, [40, 100, 100]], [24, [100, 100, 100]]], OUTE), o: A([[0, 0], [24, 100]]) }),
]);

// No words yet — a word card turns from its back to its face (ease-in to edge-on, then the face's
// quarter turn eases out), and "Aa" is written on it in strokes.
const NO_WORDS = anim('no-words', 82, [
  L(1, 'letters', [
    gr([line([[-38, 22], [-20, -22], [-2, 22]]), draw(40, 56), st(AMBER, 7)]),
    gr([line([[-30, 7], [-10, 7]]), draw(50, 58), st(AMBER, 7)]),
    gr([el(24, 26), draw(54, 68), st(AMBER, 7)], tr({ p: S([22, 9]), r: S(90) })),
    gr([line([[34, -5], [34, 22]]), draw(60, 70), st(AMBER, 7)]),
  ], { p: S([102, 100, 0]) }),
  L(2, 'face', [gr([rc(128, 92, [0, 0], 16), st(AMBER, 6), fl(AMBER, 12)])],
    { s: A([[22, [0, 100, 100]], [42, [100, 100, 100]]], OUTE) }),
  L(3, 'back', [gr([rc(98, 62, [0, 0], 9), st(WARN, 4)]), gr([rc(128, 92, [0, 0], 16), fl(AMBER)])], {
    s: A([[8, [100, 100, 100]], [22, [0, 100, 100]]], IN),
    o: A([[0, 0], [8, 100]]),
  }),
]);

// Offline — a cloud outline draws (left lobe, top, right lobe, then the flat bottom), and a short
// slash strokes across it. The outline is three circles' arcs meeting at the cloud's dips.
function arc(c, r, a0, a1, n) {
  const step = (a1 - a0) / n, k = 4 / 3 * Math.tan(step * Math.PI / 720) * r;
  return Array.from({ length: n + 1 }, (_, j) => {
    const a = (a0 + step * j) * Math.PI / 180, tx = -Math.sin(a) * k, ty = Math.cos(a) * k;
    return [[c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)], [-tx, -ty], [tx, ty]];
  });
}
// Where circle a crosses circle b on top, as an angle on each (degrees, clockwise from the right).
function meets(a, ra, b, rb) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
  const along = (ra * ra - rb * rb + d * d) / (2 * d), h = Math.sqrt(ra * ra - along * along);
  const m = [a[0] + along * dx / d, a[1] + along * dy / d];
  const p = [-1, 1].map(s => [m[0] + s * h * dy / d, m[1] - s * h * dx / d]).sort((u, v) => u[1] - v[1])[0];
  const deg = c => (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180 / Math.PI + 360) % 360;
  return [deg(a), deg(b)];
}
const LOBES = [[[-38, 14], 20], [[-2, -8], 32], [[36, 10], 24]];
function cloud() {
  const [[c1, r1], [c2, r2], [c3, r3]] = LOBES;
  const [a12, b12] = meets(c1, r1, c2, r2), [a23, b23] = meets(c2, r2, c3, r3);
  const parts = [arc(c1, r1, 90, a12, 3), arc(c2, r2, b12, a23, 3), arc(c3, r3, b23, 450, 3)];
  // Where two arcs meet, one vertex: in from the first arc, out along the next — the dip.
  const pts = parts.flatMap((part, n) => n === 0 ? part.slice(0, -1) : part.slice(0, -1).map((q, j) =>
    j === 0 ? [q[0], parts[n - 1].at(-1)[1], q[2]] : q)).concat([parts[2].at(-1)]);
  pts[0][1] = [0, 0];
  pts.at(-1)[2] = [0, 0];
  const r = v => v.map(x => Math.round(x * 100) / 100);
  return P(pts.map(q => r(q[0])), pts.map(q => r(q[1])), pts.map(q => r(q[2])));
}
const OFFLINE = anim('offline', 72, [
  L(1, 'slash', [gr([line([[-34, -40], [40, 46]]), draw(40, 56), st(WARN, 9)])]),
  L(2, 'cloud', [gr([sh(S(cloud())), draw(0, 38), st(GREY, 8)]), gr([sh(S(cloud())), fl(GREY, 12)], tr({ o: A([[26, 0], [42, 100]]) }))],
    { p: S([99, 103, 0]) }),
]);

// Didn't load — a rounded square draws, then the exclamation's bar and dot pop in.
const ERROR = anim('error', 74, [
  L(1, 'mark', [
    gr([rc(13, 42, [0, 0], 6.5), fl(WARN)], tr({ p: S([0, -10]), s: popIn(30, 44) })),
    gr([el(14, 14), fl(WARN)], tr({ p: S([0, 26]), s: popIn(38, 52) })),
  ]),
  // Turned a quarter back, so the outline starts at the top-left and draws clockwise, as a pen would.
  L(2, 'square', [gr([rc(104, 104, [0, 0], 28), draw(0, 32), st(WARN, 8)], tr({ r: S(-90) })),
    gr([rc(104, 104, [0, 0], 28), fl(WARN, 12)], tr({ o: A([[18, 0], [34, 100]]) }))]),
]);

// Every file is decoded on the main thread when its view appears: keep each one small.
const BUDGET = 15000;
// Measure first, write second: an over-budget file must not leave the folder half-updated.
const FILES = [FLAME, CHECK, TROPHY, COIN, STARS, ALL_DONE, NO_TASKS, NO_WORDS, OFFLINE, ERROR].map(data => {
  const json = JSON.stringify(data);
  return { nm: data.nm, json, bytes: Buffer.byteLength(json) };
});
const over = FILES.filter(f => f.bytes > BUDGET);
if (over.length) throw new Error(over.map(f => `${f.nm} is ${f.bytes} bytes — over the ${BUDGET}-byte budget`).join('; '));
mkdirSync(OUT, { recursive: true });
for (const { nm, json, bytes } of FILES) {
  writeFileSync(join(OUT, nm + '.json'), json);
  console.log(nm, bytes, 'bytes');
}
