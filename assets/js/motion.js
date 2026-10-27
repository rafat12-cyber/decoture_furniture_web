// Motion layer for every page: intro, page transitions, reveals, split text, parallax,
// counters, magnetic buttons, tilt, cursor, header and scroll progress.
// Everything here is decoration on top of a page that already works without it.
(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const root = document.documentElement;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---------- The drawn mark (the logo traced as two strokes) ----------
  const MARK_SVG = `
    <svg class="mark-draw" viewBox="392 401 176 118" fill="none" stroke="currentColor" stroke-width="6.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path pathLength="1" d="M467.9 478.9 L432 411 Q430 407.3 426 407.3 L405 407.3 Q396.5 407.3 399 415.5 L430.2 478.9 L503 478.9 A16.7 16.7 0 0 1 503 512.3 L430.2 512.3"/>
      <path pathLength="1" d="M442.7 407.3 L510.3 407.3 A52.5 52.5 0 0 1 510.3 512.3 L503 512.3"/>
    </svg>`;

  // ---------- Intro: the mark draws itself, once per visit ----------
  function intro() {
    const isHome = document.body.dataset.page === 'home';
    if (!isHome || reduce || ss.get('decoture.intro')) return Promise.resolve();
    ss.set('decoture.intro', '1');
    const el = document.createElement('div');
    el.className = 'intro';
    el.innerHTML = `<div class="intro-inner">${MARK_SVG}<img class="intro-word" src="assets/img/logo/wordmark.svg" alt="" width="260" height="51"><p class="intro-tag"><span>Style.</span> <span>Comfort.</span> <span>Crafted.</span></p></div>`;
    document.body.append(el);
    root.classList.add('is-intro');
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        el.classList.add('is-leaving');
        root.classList.remove('is-intro');
        resolve();
        setTimeout(() => el.remove(), 1100);
      };
      requestAnimationFrame(() => el.classList.add('is-playing'));
      el.addEventListener('click', finish);
      setTimeout(finish, 2300);
    });
  }

  // ---------- Page transitions: a charcoal and gold curtain ----------
  function transitions() {
    const curtain = document.createElement('div');
    curtain.className = 'curtain';
    curtain.innerHTML = '<span class="curtain-gold"></span><span class="curtain-dark"></span>';
    document.body.append(curtain);
    if (!reduce && ss.get('decoture.leaving')) {
      ss.set('decoture.leaving', '');
      curtain.classList.add('is-covering', 'no-anim');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        curtain.classList.remove('no-anim');
        curtain.classList.add('is-revealing');
        curtain.classList.remove('is-covering');
        setTimeout(() => curtain.classList.remove('is-revealing'), 900);
      }));
    }
    if (reduce) return;
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || /^(mailto|tel|https?):/i.test(href)) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      e.preventDefault();
      ss.set('decoture.leaving', '1');
      curtain.classList.add('is-covering');
      setTimeout(() => { location.href = a.href; }, 520);
    });
    // Coming back through history: never leave the curtain down.
    window.addEventListener('pageshow', (e) => { if (e.persisted) curtain.classList.remove('is-covering'); });
  }

  // ---------- Split text into masked words ----------
  function split(el) {
    if (el.dataset.splitDone) return;
    el.dataset.splitDone = '1';
    const walk = (node) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === 3) {
          const parts = child.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          parts.forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.append(document.createTextNode(' ')); return; }
            const w = document.createElement('span');
            w.className = 'w';
            const i = document.createElement('span');
            i.className = 'wi';
            i.textContent = part;
            w.append(i);
            frag.append(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && !child.classList.contains('w')) walk(child);
      });
    };
    walk(el);
    el.querySelectorAll('.wi').forEach((w, n) => w.style.setProperty('--i', n));
  }

  // ---------- Reveals ----------
  let io; let ready = false;
  function observe(scope = document) {
    scope.querySelectorAll('[data-split]').forEach(split);
    if (!ready) return; // the intro is still playing; boot observes everything once it ends
    const els = scope.querySelectorAll('[data-reveal]:not(.is-in), [data-split]:not(.is-in), [data-count]:not(.is-in), [data-draw]:not(.is-in)');
    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach((el) => { el.classList.add('is-in'); if (el.dataset.count) countUp(el, true); });
      return;
    }
    io ||= new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        if (en.target.dataset.count) countUp(en.target);
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
    els.forEach((el) => io.observe(el));
  }

  // ---------- Count up ----------
  function countUp(el, instant) {
    const to = Number(el.dataset.count);
    const fmt = (n) => Math.round(n).toLocaleString('en-IN');
    if (instant) { el.textContent = fmt(to); return; }
    const dur = 1600; const t0 = performance.now();
    const step = (t) => {
      const p = clamp((t - t0) / dur, 0, 1);
      el.textContent = fmt(to * (1 - Math.pow(1 - p, 4)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- Scroll-linked work: one loop for parallax, scenes, header, progress ----------
  const scrubbers = new Set();
  let lastY = window.scrollY; let velocity = 0; let ticking = false;
  const header = () => document.querySelector('.site-header');
  const bar = document.createElement('div');
  bar.className = 'scroll-progress';
  function frame() {
    ticking = false;
    const y = window.scrollY;
    const dy = y - lastY;
    velocity = lerp(velocity, dy, 0.2);
    lastY = y;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    const h = header();
    if (h) {
      h.classList.toggle('is-scrolled', y > 24);
      if (!document.body.classList.contains('drawer-open') && !h.querySelector('.nav.is-open')) {
        h.classList.toggle('is-hidden', dy > 4 && y > 240);
        if (dy < -4) h.classList.remove('is-hidden');
      }
    }
    scrubbers.forEach((fn) => fn(y, velocity));
  }
  function requestFrame() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }

  // Progress of an element through the viewport: 0 when its top meets the bottom, 1 when its bottom meets the top.
  function progressOf(el) {
    const r = el.getBoundingClientRect();
    return clamp((innerHeight - r.top) / (innerHeight + r.height), 0, 1);
  }
  // Progress through a pinned (sticky) section: 0 at pin start, 1 at pin end.
  function pinProgress(el) {
    const r = el.getBoundingClientRect();
    const dist = r.height - innerHeight;
    return dist > 0 ? clamp(-r.top / dist, 0, 1) : 0;
  }

  function parallax() {
    if (reduce) return;
    document.querySelectorAll('[data-parallax]').forEach((el) => {
      const speed = Number(el.dataset.parallax) || 0.15;
      scrubbers.add(() => {
        const p = progressOf(el.parentElement || el);
        el.style.transform = `translate3d(0, ${((p - 0.5) * speed * 100).toFixed(2)}%, 0)`;
      });
    });
  }

  // ---------- Marquee whose speed follows the scroll ----------
  function marquees() {
    document.querySelectorAll('[data-marquee-band]').forEach((band) => {
      const track = band.querySelector('.band-track');
      if (!track) return;
      track.innerHTML += track.innerHTML; // seamless loop
      if (reduce) return;
      let x = 0; let dir = -1;
      const base = Number(band.dataset.speed) || 0.6;
      const loop = () => {
        const v = Math.abs(velocity);
        if (velocity > 0.5) dir = -1; else if (velocity < -0.5) dir = 1;
        x += dir * (base + Math.min(v, 60) * 0.25);
        const w = track.scrollWidth / 2;
        if (x <= -w) x += w; if (x > 0) x -= w;
        track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }

  // ---------- Magnetic buttons ----------
  function magnetic(scope = document) {
    if (reduce || !finePointer) return;
    scope.querySelectorAll('[data-magnetic]:not([data-mag-on])').forEach((el) => {
      el.dataset.magOn = '1';
      const strength = Number(el.dataset.magnetic) || 0.3;
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  // ---------- 3D tilt for cards ----------
  function tilt(scope = document) {
    if (reduce || !finePointer) return;
    scope.querySelectorAll('[data-tilt]:not([data-tilt-on])').forEach((el) => {
      el.dataset.tiltOn = '1';
      const target = el.querySelector('[data-tilt-target]') || el;
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        target.style.transform = `perspective(900px) rotateX(${(-py * 7).toFixed(2)}deg) rotateY(${(px * 9).toFixed(2)}deg) translateZ(0)`;
        target.style.setProperty('--gx', `${((px + 0.5) * 100).toFixed(1)}%`);
        target.style.setProperty('--gy', `${((py + 0.5) * 100).toFixed(1)}%`);
      });
      el.addEventListener('pointerleave', () => { target.style.transform = ''; });
    });
  }

  // ---------- Cursor: a gold dot and a ring that grows over things you can open ----------
  function cursor() {
    if (reduce || !finePointer) return;
    const dot = document.createElement('div'); dot.className = 'cursor-dot';
    const ring = document.createElement('div'); ring.className = 'cursor-ring';
    ring.innerHTML = '<span></span>';
    document.body.append(dot, ring);
    root.classList.add('has-cursor');
    let mx = innerWidth / 2; let my = innerHeight / 2; let rx = mx; let ry = my;
    window.addEventListener('pointermove', (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = `translate(${mx}px, ${my}px)`;
      const t = e.target.closest?.('[data-cursor], a, button, input, select, textarea, label');
      const label = t?.closest('[data-cursor]')?.dataset.cursor || '';
      ring.classList.toggle('is-link', !!t && !label);
      ring.classList.toggle('is-label', !!label);
      ring.firstChild.textContent = label;
      root.classList.add('cursor-on');
    }, { passive: true });
    document.addEventListener('pointerleave', () => root.classList.remove('cursor-on'));
    const loop = () => {
      rx = lerp(rx, mx, 0.18); ry = lerp(ry, my, 0.18);
      ring.style.transform = `translate(${rx.toFixed(1)}px, ${ry.toFixed(1)}px)`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------- Add to cart: the photo flies to the cart button ----------
  function fly(fromEl) {
    if (reduce || !fromEl) return;
    const to = document.querySelector('.cart-button');
    if (!to) return;
    const a = fromEl.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const ghost = fromEl.cloneNode(true);
    ghost.className = 'fly-ghost';
    Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
    document.body.append(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    ghost.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '2px' },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 120}px) scale(0.5)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.08)`, opacity: 0.4, borderRadius: '50%' },
    ], { duration: 820, easing: 'cubic-bezier(0.55, 0, 0.25, 1)' }).onfinish = () => {
      ghost.remove();
      to.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    };
  }

  // ---------- Boot ----------
  function boot() {
    document.body.append(bar);
    transitions();
    parallax();
    marquees();
    magnetic();
    tilt();
    cursor();
    window.addEventListener('scroll', requestFrame, { passive: true });
    window.addEventListener('resize', requestFrame);
    requestFrame();
    observe();
    intro().then(() => {
      ready = true;
      root.classList.add('is-ready');
      observe();
    });
  }

  window.Motion = {
    reduce, finePointer, MARK_SVG, observe, split, magnetic, tilt, fly,
    addScrub: (fn) => { scrubbers.add(fn); requestFrame(); }, progressOf, pinProgress, clamp, lerp,
    refresh(scope) { observe(scope); magnetic(scope); tilt(scope); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
