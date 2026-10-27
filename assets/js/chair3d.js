// Home page scene: a 3D executive chair drawn with plain WebGL. As you scroll through the
// pinned scene it turns, moves, grows and shrinks, changes colour and comes apart to show
// the parts the warranty covers. Without WebGL, or with reduced motion, it stays still.
(function () {
  'use strict';
  const M = window.Motion;
  const scene = document.querySelector('[data-scene]');
  if (!scene) return;
  const canvas = scene.querySelector('[data-scene-canvas]');
  const panels = [...scene.querySelectorAll('[data-scene-step]')];
  const labels = [...scene.querySelectorAll('[data-scene-label]')];
  const stepEl = scene.querySelector('[data-scene-count]');
  const barEl = scene.querySelector('[data-scene-bar]');
  const colourName = scene.querySelector('[data-scene-colour]');
  const colourDots = [...scene.querySelectorAll('[data-scene-dot]')];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  // Colourways from the stock list, in the order the chair cycles through them.
  const PALETTE = [
    { name: 'Black', hex: '#1d1d1f' },
    { name: 'Red', hex: '#9e3434' },
    { name: 'Pearl white', hex: '#efece4' },
    { name: 'Blue', hex: '#2f5d8a' },
    { name: 'Green', hex: '#2f6b55' },
    { name: 'Sand', hex: '#c99a6b' },
  ];
  const linear = (hex) => [1, 3, 5].map((i) => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2));
  const PAL = PALETTE.map((p) => linear(p.hex));

  // ---------- Pose keyframes along the scroll (t from 0 to 1) ----------
  // ry/rx: turn and tilt, fx/fy: position as a share of the half screen, s: size,
  // c: colour index, ex: how far the chair is pulled apart.
  const KEYS = [
    { t: 0.00, ry: -0.62, rx: 0.10, fx: 0.46, fy: 0.02, s: 0.94, c: 0, ex: 0 },
    { t: 0.09, ry: -0.80, rx: 0.10, fx: 0.46, fy: 0.02, s: 0.94, c: 0, ex: 0 },
    { t: 0.23, ry: -1.60, rx: 0.02, fx: -0.44, fy: -0.02, s: 1.18, c: 0, ex: 0 },
    { t: 0.31, ry: -1.72, rx: 0.02, fx: -0.44, fy: -0.02, s: 1.18, c: 0, ex: 0 },
    { t: 0.43, ry: -3.70, rx: 0.16, fx: 0.42, fy: -0.02, s: 1.00, c: 0, ex: 0 },
    { t: 0.50, ry: -3.95, rx: 0.14, fx: 0.42, fy: -0.02, s: 1.00, c: 0, ex: 0 },
    { t: 0.68, ry: -7.05, rx: 0.10, fx: 0.40, fy: 0.00, s: 0.95, c: 5, ex: 0 },
    { t: 0.71, ry: -7.05, rx: 0.10, fx: 0.40, fy: 0.00, s: 0.95, c: 5, ex: 0 },
    { t: 0.79, ry: -6.85, rx: 0.32, fx: -0.36, fy: -0.1, s: 0.72, c: 5, ex: 1 },
    { t: 0.87, ry: -7.05, rx: 0.32, fx: -0.36, fy: -0.1, s: 0.72, c: 5, ex: 1 },
    { t: 0.95, ry: -6.80, rx: 0.08, fx: 0.44, fy: -0.04, s: 1.05, c: 5, ex: 0 },
    { t: 1.00, ry: -6.80, rx: 0.08, fx: 0.44, fy: -0.04, s: 1.05, c: 5, ex: 0 },
  ];
  const STEPS = [0, 0.165, 0.37, 0.505, 0.73, 0.905];
  const PROPS = ['ry', 'rx', 'fx', 'fy', 's', 'c', 'ex'];
  function sample(t) {
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i]; const b = KEYS[i + 1];
    const u = smooth(clamp((t - a.t) / (b.t - a.t), 0, 1));
    const o = {};
    PROPS.forEach((k) => { o[k] = lerp(a[k], b[k], u); });
    return o;
  }

  // ---------- Matrices (column-major) ----------
  const ident = () => { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; };
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  const chain = (...ms) => ms.reduce(mul);
  const T = (x, y, z) => { const o = ident(); o[12] = x; o[13] = y; o[14] = z; return o; };
  const S = (x, y = x, z = x) => { const o = ident(); o[0] = x; o[5] = y; o[10] = z; return o; };
  const RX = (a) => { const o = ident(); const c = Math.cos(a); const s = Math.sin(a); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; };
  const RY = (a) => { const o = ident(); const c = Math.cos(a); const s = Math.sin(a); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; };
  const RZ = (a) => { const o = ident(); const c = Math.cos(a); const s = Math.sin(a); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o; };
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2); const nf = 1 / (near - far); const o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  }
  const apply = (m, p, w = 1) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * w,
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * w,
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * w,
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] * w,
  ];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // ---------- Geometry ----------
  // A mesh is positions, normals, a stitch channel (coordinate, mask) and triangle indices.
  const mesh = () => ({ p: [], n: [], t: [], i: [] });

  // Box with rounded edges. m adds flat segments per axis so the box can be bent afterwards.
  function roundedBox(hx, hy, hz, r, m = [1, 1, 1], k = 5) {
    const g = mesh(); const H = [hx, hy, hz]; const In = H.map((h) => Math.max(0, h - r));
    const coords = (a) => {
      const out = [];
      for (let i = 0; i <= k; i++) out.push(-H[a] + (H[a] - In[a]) * i / k);
      for (let i = 1; i < m[a]; i++) out.push(-In[a] + 2 * In[a] * i / m[a]);
      for (let i = 0; i <= k; i++) out.push(In[a] + (H[a] - In[a]) * i / k);
      return out.filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > 1e-7);
    };
    for (const [w, u, v] of [[0, 1, 2], [1, 2, 0], [2, 0, 1]]) for (const s of [-1, 1]) {
      const cu = coords(u); const cv = coords(v); const base = g.p.length / 3;
      for (const a of cu) for (const b of cv) {
        const p = [0, 0, 0]; p[w] = s * H[w]; p[u] = a; p[v] = b;
        const q = p.map((x, i) => clamp(x, -In[i], In[i]));
        let d = sub(p, q); const l = Math.hypot(d[0], d[1], d[2]);
        if (l < 1e-9) { d = [0, 0, 0]; d[w] = s; } else d = d.map((x) => x / l);
        g.p.push(q[0] + d[0] * r, q[1] + d[1] * r, q[2] + d[2] * r);
        g.n.push(...d); g.t.push(0, 0);
      }
      const nv = cv.length;
      for (let i = 0; i < cu.length - 1; i++) for (let j = 0; j < nv - 1; j++) {
        const a = base + i * nv + j; const b = a + nv;
        g.i.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
    return g;
  }

  // Surface of revolution around y from a profile of [radius, y] points.
  function lathe(prof, seg = 36) {
    const g = mesh(); const L = prof.length;
    const n2 = prof.map((_, i) => {
      let a = prof[Math.max(0, i - 1)]; let b = prof[Math.min(L - 1, i + 1)];
      if (Math.hypot(prof[i][0] - a[0], prof[i][1] - a[1]) < 1e-7) a = prof[i];
      if (Math.hypot(prof[i][0] - b[0], prof[i][1] - b[1]) < 1e-7) b = prof[i];
      const dr = b[0] - a[0]; const dy = b[1] - a[1]; const l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    });
    for (let j = 0; j <= seg; j++) {
      const th = j / seg * Math.PI * 2; const c = Math.cos(th); const s = Math.sin(th);
      prof.forEach(([r, y], i) => { g.p.push(r * c, y, r * s); g.n.push(n2[i][0] * c, n2[i][1], n2[i][0] * s); g.t.push(0, 0); });
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < L - 1; i++) {
      const a = j * L + i; const b = a + L;
      g.i.push(a, b, b + 1, a, b + 1, a + 1);
    }
    return g;
  }
  // Profile of a cylinder of radius r from y0 to y1 with rounded rims of radius e.
  function cylProfile(r, y0, y1, e, steps = 5) {
    const p = [[0, y0]];
    for (let i = 0; i <= steps; i++) { const a = -Math.PI / 2 + (i / steps) * Math.PI / 2; p.push([r - e + Math.cos(a) * e, y0 + e + Math.sin(a) * e]); }
    for (let i = 0; i <= steps; i++) { const a = (i / steps) * Math.PI / 2; p.push([r - e + Math.cos(a) * e, y1 - e + Math.sin(a) * e]); }
    p.push([0, y1]);
    return p;
  }

  // Bend or bulge a mesh with f(x, y, z) -> [x, y, z]; normals follow through the Jacobian.
  function deform(g, f) {
    const e = 1e-4;
    for (let i = 0; i < g.p.length; i += 3) {
      const x = g.p[i]; const y = g.p[i + 1]; const z = g.p[i + 2];
      const p = f(x, y, z);
      const a = sub(f(x + e, y, z), p); const b = sub(f(x, y + e, z), p); const c = sub(f(x, y, z + e), p);
      const bc = cross(b, c); const ca = cross(c, a); const ab = cross(a, b);
      const n = [g.n[i], g.n[i + 1], g.n[i + 2]];
      const m = norm([0, 1, 2].map((k) => n[0] * bc[k] + n[1] * ca[k] + n[2] * ab[k]));
      g.p[i] = p[0]; g.p[i + 1] = p[1]; g.p[i + 2] = p[2];
      g.n[i] = m[0]; g.n[i + 1] = m[1]; g.n[i + 2] = m[2];
    }
    return g;
  }
  // Mark stitched channels: fn(x, y, z, nx, ny, nz) -> [coordinate, mask].
  function stitch(g, fn) {
    for (let v = 0; v < g.p.length / 3; v++) {
      const r = fn(g.p[v * 3], g.p[v * 3 + 1], g.p[v * 3 + 2], g.n[v * 3], g.n[v * 3 + 1], g.n[v * 3 + 2]);
      g.t[v * 2] = r[0]; g.t[v * 2 + 1] = r[1];
    }
    return g;
  }

  // ---------- The chair, built part by part ----------
  // Groups move apart in the exploded view. Materials: 0 upholstery, 1 plastic, 2 chrome.
  const EXPLODE = {
    back: [0, 0.34, -0.14], seat: [0, 0.2, 0.04], armL: [-0.17, 0.22, 0], armR: [0.17, 0.22, 0],
    mech: [0, 0.08, 0], lift: [0, -0.02, 0], base: [0, -0.13, 0], wheels: [0, -0.23, 0],
  };
  const parts = {};
  function add(group, mat, g, m) {
    const bucket = ((parts[group] ||= {})[mat] ||= mesh());
    const base = bucket.p.length / 3;
    for (let v = 0; v < g.p.length / 3; v++) {
      const p = apply(m, [g.p[v * 3], g.p[v * 3 + 1], g.p[v * 3 + 2]]);
      const n = norm(apply(m, [g.n[v * 3], g.n[v * 3 + 1], g.n[v * 3 + 2]], 0));
      bucket.p.push(p[0], p[1], p[2]); bucket.n.push(...n.slice(0, 3)); bucket.t.push(g.t[v * 2], g.t[v * 2 + 1]);
    }
    g.i.forEach((i) => bucket.i.push(base + i));
  }

  function buildChair() {
    // Base: hub, five tapered chrome legs, twin-wheel casters.
    add('base', 2, lathe(cylProfile(0.055, 0.075, 0.125, 0.012)), ident());
    const legLen = 0.165;
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5 + Math.PI / 10;
      const leg = deform(roundedBox(legLen, 0.022, 0.03, 0.016, [6, 1, 1]), (x, y, z) => {
        const u = (x + legLen) / (2 * legLen);
        return [x, y * (1 - 0.25 * u) - u * 0.045, z * (1 - 0.4 * u)];
      });
      add('base', 2, leg, chain(RY(a), T(legLen + 0.035, 0.1, 0)));
      const reach = 2 * legLen + 0.02;
      add('wheels', 1, roundedBox(0.022, 0.03, 0.03, 0.012), chain(RY(a), T(reach, 0.06, 0)));
      for (const side of [-1, 1]) {
        const wheel = lathe(cylProfile(0.034, -0.011, 0.011, 0.009, 4), 28);
        add('wheels', 1, wheel, chain(RY(a), T(reach - 0.012, 0.036, side * 0.02), RX(Math.PI / 2)));
      }
    }
    // Gas lift: chrome piston inside a black telescoping cover.
    add('lift', 2, lathe(cylProfile(0.021, 0.11, 0.33, 0.006)), ident());
    add('lift', 1, lathe([[0, 0.125], [0.036, 0.125], [0.036, 0.125], [0.033, 0.24], [0.033, 0.24], [0, 0.24]]), ident());
    // Mechanism under the seat, with its tilt lever.
    add('mech', 1, roundedBox(0.11, 0.028, 0.13, 0.015), T(0, 0.345, 0.0));
    add('mech', 2, roundedBox(0.075, 0.007, 0.007, 0.006), chain(T(0.17, 0.335, 0.08), RY(-0.35)));
    add('mech', 1, roundedBox(0.012, 0.012, 0.022, 0.011), chain(T(0.245, 0.335, 0.105)));
    // Seat: puffed cushion with a waterfall front and a stitched centre panel, on a shell.
    const seat = roundedBox(0.27, 0.055, 0.26, 0.05, [8, 1, 8]);
    stitch(seat, (x, y, z, nx, ny) => [(z + 0.26) * 22, ny > 0.7 && Math.abs(x) < 0.17 ? 1 : 0]);
    deform(seat, (x, y, z) => {
      const puff = y > 0 ? 0.022 * (1 - (x / 0.27) ** 2) * (1 - (z / 0.26) ** 2) : 0;
      const fall = z > 0.12 ? (z - 0.12) ** 2 * 1.6 : 0;
      return [x, y + puff - fall, z];
    });
    add('seat', 0, seat, T(0, 0.435, 0.02));
    add('seat', 1, roundedBox(0.25, 0.012, 0.24, 0.01), T(0, 0.38, 0.02));
    // Back: a high, curved back with lumbar support and a headrest pillow, joined by a chrome spine.
    const back = roundedBox(0.25, 0.37, 0.05, 0.045, [8, 12, 1]);
    stitch(back, (x, y, z, nx, ny, nz) => [(y + 0.37) * 16, nz > 0.7 && Math.abs(x) < 0.16 && y < 0.2 ? 1 : 0]);
    deform(back, (x, y, z) => {
      const wrap = 0.55 * x * x;
      const lumbar = z > -0.01 ? 0.03 * Math.exp(-(((y + 0.17) / 0.09) ** 2)) * (1 - (x / 0.25) ** 2) : 0;
      return [x, y, z + wrap + lumbar];
    });
    const backM = chain(T(0, 0.9, -0.29), RX(-0.17));
    add('back', 0, back, backM);
    const head = roundedBox(0.17, 0.075, 0.04, 0.035, [4, 2, 1]);
    deform(head, (x, y, z) => [x, y, z + 0.6 * x * x]);
    add('back', 0, head, chain(backM, T(0, 0.27, 0.06)));
    add('back', 2, roundedBox(0.035, 0.17, 0.012, 0.01), chain(T(0, 0.48, -0.23), RX(-0.72)));
    add('back', 1, roundedBox(0.22, 0.33, 0.012, 0.012), chain(backM, T(0, -0.01, -0.05)));
    // Arms: a chrome loop from seat to pad, and a soft pad on top.
    for (const [side, group] of [[-1, 'armL'], [1, 'armR']]) {
      const post = deform(roundedBox(0.012, 0.115, 0.03, 0.01, [1, 6, 1]), (x, y, z) => [x + side * 0.03 * ((y + 0.115) / 0.23) ** 2, y, z]);
      add(group, 2, post, T(side * 0.27, 0.5, 0.0));
      add(group, 1, roundedBox(0.028, 0.012, 0.05, 0.01), T(side * 0.235, 0.39, 0.0));
      add(group, 1, roundedBox(0.042, 0.02, 0.15, 0.018, [1, 1, 4]), T(side * 0.3, 0.63, 0.02));
    }
  }
  buildChair();

  // ---------- WebGL ----------
  const VS = `
    attribute vec3 aP; attribute vec3 aN; attribute vec2 aT;
    uniform mat4 uM; uniform mat4 uVP;
    varying vec3 vW; varying vec3 vN; varying vec2 vT;
    void main() {
      vec4 w = uM * vec4(aP, 1.0);
      vW = w.xyz; vN = (uM * vec4(aN, 0.0)).xyz; vT = aT;
      gl_Position = uVP * w;
    }`;
  const FS = `
    precision highp float;
    varying vec3 vW; varying vec3 vN; varying vec2 vT;
    uniform vec3 uCol; uniform vec3 uCam; uniform vec3 uGold; uniform float uMat;
    vec3 env(vec3 r) {
      float h = r.y;
      vec3 sky = mix(vec3(0.42, 0.44, 0.45), vec3(0.95), smoothstep(0.0, 0.7, h));
      vec3 c = h > 0.0 ? sky : vec3(0.035, 0.04, 0.04);
      c += vec3(2.4) * exp(-pow((h - 0.32) * 8.0, 2.0)) * smoothstep(-0.3, 0.7, -r.x);
      c += uGold * 1.6 * exp(-pow((h - 0.04) * 12.0, 2.0)) * smoothstep(0.3, -0.6, r.z);
      return c;
    }
    void main() {
      if (uMat > 2.5) {
        float d = length(vT);
        float core = pow(clamp(1.0 - d, 0.0, 1.0), 2.2);
        float halo = exp(-pow((d - 0.72) * 5.0, 2.0)) * 0.22;
        gl_FragColor = vec4(uGold * halo, core * 0.55 + halo * 0.4);
        return;
      }
      vec3 N = normalize(vN);
      vec3 V = normalize(uCam - vW);
      vec3 L1 = normalize(vec3(-0.55, 0.85, 0.75));
      vec3 L2 = normalize(vec3(0.85, 0.2, 0.45));
      vec3 L3 = normalize(vec3(0.35, 0.45, -1.0));
      float d1 = max(dot(N, L1), 0.0);
      float d2 = max(dot(N, L2), 0.0);
      float d3 = max(dot(N, L3), 0.0);
      float hemi = N.y * 0.5 + 0.5;
      float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      vec3 H1 = normalize(L1 + V);
      vec3 c;
      if (uMat < 0.5) {
        float line = 0.0;
        if (vT.y > 0.5) line = smoothstep(0.38, 0.5, abs(fract(vT.x) - 0.5));
        vec3 base = uCol * (1.0 - 0.6 * line);
        float spec = pow(max(dot(N, H1), 0.0), 24.0) * 0.2 * (1.0 - line);
        c = base * (vec3(0.14) + 0.2 * hemi + d1 * vec3(1.2, 1.12, 1.04) + d2 * 0.32)
          + spec + uGold * (d3 * 0.5 + fres * 0.22) * 0.55 + fres * 0.06;
      } else if (uMat < 1.5) {
        float spec = pow(max(dot(N, H1), 0.0), 60.0) * 0.55;
        c = vec3(0.022) * (0.5 + hemi + d1 * 2.0) + spec + uGold * (d3 * 0.4 + fres * 0.3) * 0.45 + fres * 0.04;
      } else {
        vec3 R = reflect(-V, N);
        c = env(R) * vec3(0.86, 0.85, 0.83) + pow(max(dot(N, H1), 0.0), 140.0) * 2.0;
      }
      c = c / (1.0 + c) * 1.18;
      gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
    }`;

  let gl = null;
  if (!M.reduce) {
    try { gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true }); } catch { gl = null; }
  }
  if (!gl) {
    scene.classList.add('scene--static');
    // Still show the chair once, posed, when WebGL works but motion is reduced.
    if (M.reduce) {
      try { gl = canvas.getContext('webgl', { antialias: true, alpha: true }); } catch { gl = null; }
    }
    if (!gl) { scene.classList.add('scene--flat'); return; }
  }

  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) {
    scene.classList.add('scene--static', 'scene--flat');
    return;
  }
  gl.useProgram(prog);
  const loc = {
    aP: gl.getAttribLocation(prog, 'aP'), aN: gl.getAttribLocation(prog, 'aN'), aT: gl.getAttribLocation(prog, 'aT'),
    uM: gl.getUniformLocation(prog, 'uM'), uVP: gl.getUniformLocation(prog, 'uVP'), uCol: gl.getUniformLocation(prog, 'uCol'),
    uCam: gl.getUniformLocation(prog, 'uCam'), uGold: gl.getUniformLocation(prog, 'uGold'), uMat: gl.getUniformLocation(prog, 'uMat'),
  };
  function upload(g) {
    const data = new Float32Array(g.p.length / 3 * 8);
    for (let v = 0; v < g.p.length / 3; v++) {
      data.set([g.p[v * 3], g.p[v * 3 + 1], g.p[v * 3 + 2], g.n[v * 3], g.n[v * 3 + 1], g.n[v * 3 + 2], g.t[v * 2], g.t[v * 2 + 1]], v * 8);
    }
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.i), gl.STATIC_DRAW);
    return { vb, ib, count: g.i.length };
  }
  const draws = [];
  Object.entries(parts).forEach(([group, mats]) => Object.entries(mats).forEach(([mat, g]) => draws.push({ group, mat: +mat, buf: upload(g) })));
  const floor = upload({ p: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], n: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], t: [-1, -1, 1, -1, 1, 1, -1, 1], i: [0, 1, 2, 0, 2, 3] });
  function bind(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.ib);
    gl.enableVertexAttribArray(loc.aP); gl.vertexAttribPointer(loc.aP, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(loc.aN); gl.vertexAttribPointer(loc.aN, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(loc.aT); gl.vertexAttribPointer(loc.aT, 2, gl.FLOAT, false, 32, 24);
  }
  gl.uniform3fv(loc.uGold, linear('#d4af37'));
  gl.enable(gl.DEPTH_TEST);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // ---------- Camera and layout ----------
  const EYE = [0, 0.05, 3.4];
  const FOV = 30 * Math.PI / 180;
  let W = 0; let Hh = 0; let VP; let portrait = false;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; Hh = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    portrait = W / Hh < 0.9;
    const view = T(-EYE[0], -EYE[1], -EYE[2]);
    VP = mul(perspective(FOV, W / Hh, 0.1, 20), view);
    dirty = true;
  }
  const halfH = Math.tan(FOV / 2) * EYE[2];

  // ---------- State ----------
  const cur = sample(0); let target = sample(0);
  let mouseX = 0; let mouseY = 0; let mx = 0; let my = 0;
  let introAt = null; let dirty = true; let visible = true; let raf = 0;
  let colour = PAL[0].slice(); let step = -1;

  function chairMatrix(p, idle) {
    let fx = p.fx; let fy = p.fy; let s = p.s;
    if (portrait) { fx *= 0.1; fy = 0.36 + p.ex * 0.04; s *= 0.6 - p.ex * 0.08; }
    const halfW = halfH * (W / Hh);
    return chain(T(fx * halfW, fy * halfH + idle.bob, 0), RX(p.rx + idle.rx), RY(p.ry + idle.ry), S(s), T(0, -0.62, 0));
  }

  function colourAt(c) {
    const i = Math.floor(clamp(c, 0, PAL.length - 1)); const j = Math.min(PAL.length - 1, i + 1);
    const u = smooth(clamp(((c - i) - 0.25) / 0.5, 0, 1));
    return [0, 1, 2].map((k) => lerp(PAL[i][k], PAL[j][k], u));
  }

  function render(now) {
    const intro = introAt == null ? 1 : smooth(clamp((now - introAt) / 1700, 0, 1));
    const idle = M.reduce ? { ry: 0, rx: 0, bob: 0 } : {
      ry: Math.sin(now / 2600) * 0.06 + mx * 0.22 + (1 - intro) * 1.4,
      rx: my * 0.06,
      bob: Math.sin(now / 1400) * 0.008,
    };
    const ex = Math.max(cur.ex, 1 - intro);
    const world = chairMatrix(cur, idle);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(loc.uVP, false, VP);
    gl.uniform3fv(loc.uCam, EYE);
    // Floor glow and shadow, under the chair but not turning with it.
    const s = (portrait ? 0.6 - cur.ex * 0.08 : 1) * cur.s;
    const fx = (portrait ? cur.fx * 0.1 : cur.fx) * halfH * (W / Hh);
    const fy = (portrait ? 0.36 + cur.ex * 0.04 : cur.fy) * halfH - 0.62 * s - ex * 0.2 * s;
    gl.enable(gl.BLEND); gl.depthMask(false);
    gl.uniform1f(loc.uMat, 3);
    gl.uniformMatrix4fv(loc.uM, false, chain(T(fx, fy, 0), RX(cur.rx * 0.6), S(0.62 * s, 1, 0.62 * s)));
    bind(floor); gl.drawElements(gl.TRIANGLES, floor.count, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.BLEND); gl.depthMask(true);
    for (const d of draws) {
      const off = EXPLODE[d.group];
      gl.uniformMatrix4fv(loc.uM, false, mul(world, T(off[0] * ex, off[1] * ex, off[2] * ex)));
      gl.uniform1f(loc.uMat, d.mat);
      gl.uniform3fv(loc.uCol, colour);
      bind(d.buf); gl.drawElements(gl.TRIANGLES, d.buf.count, gl.UNSIGNED_SHORT, 0);
    }
    placeLabels(world, ex);
  }

  // Labels for the warranty parts, pinned to the parts as they come apart.
  const ANCHORS = { mech: [0.11, 0.345, 0.12], lift: [0.035, 0.2, 0.02], base: [0.24, 0.085, 0.18], wheels: [-0.3, 0.04, 0.22] };
  function placeLabels(world, ex) {
    const on = ex > 0.55 && step === 4;
    labels.forEach((el) => {
      const key = el.dataset.sceneLabel; const a = ANCHORS[key]; const off = EXPLODE[key];
      const w = apply(world, [a[0] + off[0] * ex, a[1] + off[1] * ex, a[2] + off[2] * ex]);
      const c = apply(VP, w);
      const x = (c[0] / c[3] * 0.5 + 0.5) * W; const y = (0.5 - c[1] / c[3] * 0.5) * Hh;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.classList.toggle('is-on', on);
    });
  }

  function setStep(t) {
    let n = 0;
    STEPS.forEach((s, i) => { if (t >= s) n = i; });
    if (n === step) return;
    step = n;
    panels.forEach((p, i) => { p.classList.toggle('is-active', i === n); p.setAttribute('aria-hidden', String(i !== n)); p.inert = i !== n; });
    if (stepEl) stepEl.textContent = String(n + 1).padStart(2, '0');
  }
  function setColourLabel(c) {
    const i = Math.round(clamp(c, 0, PALETTE.length - 1));
    if (colourName && colourName.textContent !== PALETTE[i].name) colourName.textContent = PALETTE[i].name;
    colourDots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
  }

  function tick(now) {
    raf = 0;
    const k = 0.11;
    let moving = false;
    PROPS.forEach((p) => {
      const d = target[p] - cur[p];
      if (Math.abs(d) > 1e-4) moving = true;
      cur[p] += d * k;
    });
    mx += (mouseX - mx) * 0.06; my += (mouseY - my) * 0.06;
    colour = colourAt(cur.c);
    setColourLabel(cur.c);
    render(now);
    scene.style.setProperty('--gx', `${50 + (portrait ? 0 : cur.fx * 50)}%`);
    scene.style.setProperty('--gy', `${portrait ? 30 : 52 - cur.fy * 50}%`);
    if (!M.reduce && visible) raf = requestAnimationFrame(tick);
    else if (moving) raf = requestAnimationFrame(tick);
  }
  function wake() { if (!raf) raf = requestAnimationFrame(tick); }

  function onScroll() {
    if (M.reduce) return;
    const t = M.pinProgress(scene);
    target = sample(t);
    setStep(t);
    scene.classList.toggle('is-start', t < 0.03);
    if (barEl) barEl.style.transform = `scaleX(${t.toFixed(4)})`;
    wake();
  }

  resize();
  setStep(0);
  window.addEventListener('resize', () => { resize(); onScroll(); wake(); });
  if (!M.reduce) {
    M.addScrub(onScroll);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }).observe(scene);
    if (M.finePointer) {
      window.addEventListener('pointermove', (e) => { mouseX = e.clientX / innerWidth - 0.5; mouseY = e.clientY / innerHeight - 0.5; }, { passive: true });
    }
    // The chair assembles itself once the logo intro has finished.
    introAt = Infinity;
    M.whenReady.then(() => { introAt = performance.now(); wake(); });
  }
  wake();
})();
