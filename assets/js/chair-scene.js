// Home page scene: one Decoture chair photographed from five sides. As you scroll through the
// pinned scene the chair turns from view to view (each photo swings away in perspective as the
// next swings in), moves across the screen, grows and shrinks, then reclines with its footrest out.
(function () {
  'use strict';
  const M = window.Motion;
  const scene = document.querySelector('[data-scene]');
  if (!scene) return;
  const chair = scene.querySelector('[data-scene-chair]');
  const panels = [...scene.querySelectorAll('[data-scene-step]')];
  const labels = [...scene.querySelectorAll('[data-scene-label]')];
  const barEl = scene.querySelector('[data-scene-bar]');
  const views = Object.fromEntries([...chair.querySelectorAll('[data-view]')].map((el) => [el.dataset.view, el]));

  // The order the chair turns through, and how much to scale each photo so the chair keeps one
  // size (the photos were taken from slightly different distances).
  const ORDER = ['front', 'angle', 'back-angle', 'back', 'recline', 'angle'];
  const NORM = { front: 1, angle: 0.87, 'back-angle': 0.93, back: 0.88, recline: 0.95 };

  // Keyframes along the scroll: v = position in ORDER (fractions are a turn in progress),
  // fx = horizontal offset as a share of the screen width, s = scale.
  const KEYS = [
    { t: 0.00, v: 0, fx: 0.24, s: 1 },
    { t: 0.08, v: 0, fx: 0.24, s: 1 },
    { t: 0.20, v: 1, fx: -0.24, s: 1.04 },
    { t: 0.30, v: 1, fx: -0.24, s: 1.04 },
    { t: 0.40, v: 2, fx: 0.24, s: 1 },
    { t: 0.49, v: 3, fx: 0.24, s: 1.04 },
    { t: 0.56, v: 3, fx: 0.24, s: 1.04 },
    { t: 0.65, v: 4, fx: -0.2, s: 1 },
    { t: 0.73, v: 4, fx: -0.2, s: 1 },
    { t: 0.80, v: 4, fx: 0.2, s: 1.08 },
    { t: 0.88, v: 4, fx: 0.2, s: 1.08 },
    { t: 0.96, v: 5, fx: 0.24, s: 0.96 },
    { t: 1.00, v: 5, fx: 0.24, s: 0.96 },
  ];
  const STEPS = [0, 0.15, 0.36, 0.64, 0.77, 0.92];
  const PROPS = ['v', 'fx', 's'];
  const TURN = 38; // degrees each photo swings through as it hands over to the next

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const ease = (x) => x * x * (3 - 2 * x);
  function sample(t) {
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i]; const b = KEYS[i + 1];
    const f = ease(clamp((t - a.t) / (b.t - a.t || 1), 0, 1));
    const out = {};
    PROPS.forEach((p) => { out[p] = a[p] + (b[p] - a[p]) * f; });
    return out;
  }

  let cur = sample(0); let target = cur;
  let step = -1; let raf = 0; let visible = true;
  let mouseX = 0; let mouseY = 0; let mx = 0; let my = 0;
  let portrait = false;

  function render() {
    const i = Math.floor(cur.v + 1e-4);
    const f = cur.v - i;
    const out = ORDER[i]; const inn = ORDER[Math.min(i + 1, ORDER.length - 1)];
    const W = innerWidth;
    const x = portrait ? 0 : cur.fx * W;
    // A little parallax with the pointer, so the photo never feels flat.
    const tiltY = mx * 8; const tiltX = -my * 5;
    Object.entries(views).forEach(([name, el]) => {
      let o = 0; let ry = 0;
      // The outgoing photo swings away and fades in the middle of the turn, just before the
      // incoming one fades up, so the two never sit on top of each other for long.
      if (name === out) { o = 1 - ease(clamp((f - 0.3) / 0.3, 0, 1)); ry = -TURN * f; }
      if (name === inn && f > 0) { o = Math.max(o, ease(clamp((f - 0.45) / 0.3, 0, 1))); ry = name === out ? 0 : TURN * (1 - f); }
      el.style.opacity = o.toFixed(3);
      el.style.visibility = o < 0.002 ? 'hidden' : 'visible';
      if (o < 0.002) return;
      // On narrow screens the wide reclined photo is fitted to the width.
      const fit = portrait ? Math.min(1, (W * 0.94) / (el.offsetWidth || 1)) : 1;
      const s = cur.s * NORM[name] * fit;
      el.style.transform = `translate3d(calc(-50% + ${x.toFixed(1)}px), ${(my * -10).toFixed(1)}px, 0) rotateX(${tiltX.toFixed(2)}deg) rotateY(${(ry + tiltY).toFixed(2)}deg) scale(${s.toFixed(4)})`;
    });
    scene.style.setProperty('--gx', `${50 + (portrait ? 0 : cur.fx * 100)}%`);
    scene.style.setProperty('--gy', portrait ? '30%' : '52%');
  }

  function setStep(t) {
    let n = 0;
    STEPS.forEach((s, i) => { if (t >= s) n = i; });
    if (n === step) return;
    step = n;
    panels.forEach((p, i) => { p.classList.toggle('is-active', i === n); p.setAttribute('aria-hidden', String(i !== n)); p.inert = i !== n; });
    labels.forEach((el) => el.classList.toggle('is-on', Number(el.dataset.sceneLabel) === n));
  }

  function tick() {
    raf = 0;
    let moving = false;
    PROPS.forEach((p) => {
      const d = target[p] - cur[p];
      if (Math.abs(d) > 1e-4) moving = true;
      cur[p] += d * 0.12;
    });
    mx += (mouseX - mx) * 0.06; my += (mouseY - my) * 0.06;
    if (Math.abs(mouseX - mx) > 1e-3 || Math.abs(mouseY - my) > 1e-3) moving = true;
    render();
    if (moving && visible) raf = requestAnimationFrame(tick);
  }
  function wake() { if (!raf) raf = requestAnimationFrame(tick); }

  function onScroll() {
    const t = M.pinProgress(scene);
    target = sample(t);
    setStep(t);
    scene.classList.toggle('is-start', t < 0.03);
    if (barEl) barEl.style.transform = `scaleX(${t.toFixed(4)})`;
    wake();
  }
  function resize() { portrait = innerWidth < 861 || innerHeight > innerWidth * 1.1; }

  resize();
  setStep(0);
  render();
  if (M.reduce) {
    // Reduced motion: one screen, the chair still, no turning.
    scene.classList.add('scene--static', 'is-in');
    return;
  }
  window.addEventListener('resize', () => { resize(); onScroll(); });
  M.addScrub(onScroll);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }).observe(scene);
  if (M.finePointer) {
    window.addEventListener('pointermove', (e) => {
      if (!visible) return;
      mouseX = e.clientX / innerWidth - 0.5; mouseY = e.clientY / innerHeight - 0.5;
      wake();
    }, { passive: true });
  }
  // The chair rises into place once the logo intro has finished.
  M.whenReady.then(() => scene.classList.add('is-in'));
})();
