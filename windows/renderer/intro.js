'use strict';

/* =====================================================================
   DJ64 Startanimation – "Film-Konzept"
   Ablauf (volle Fassung, 5,6 s):
     0,0–0,9  Letterbox-Balken fahren ein, Filmkorn, Flackern
     0,3–1,8  Film-Countdown 3 – 2 – 1 mit Radar-Zeiger
     2,2      Lichtblitz, Schockwelle, Anamorphic-Streak
     2,3–3,6  DJ64-Logo erscheint Buchstabe für Buchstabe, Lichtreflex läuft darüber
     3,1–4,0  Leuchtlinie und Untertitel
     4,8–5,6  Kamerafahrt nach vorn, Überblendung ins Programm
   Die Zeichenfunktion ist eine reine Funktion der Zeit t, damit sich
   dieselbe Animation auch Bild für Bild als 4K-Video rendern lässt.
   ===================================================================== */

(function (root) {
  const HIT = 2.2;
  const DUR = 5.6;
  const SHORT_OFFSET = 2.1;

  const rnd = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeIO = (x) => {
    x = clamp(x);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  };
  const hex = (h) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 212, 0];
  };
  const rgba = (c, a) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
  const mix = (c, k) => c.map((v) => Math.max(0, Math.min(255, v * k)));

  let layer = null;
  function getLayer(W, H) {
    if (!layer) layer = document.createElement('canvas');
    if (layer.width !== W || layer.height !== H) {
      layer.width = W;
      layer.height = H;
    }
    return layer;
  }

  const LOGO_FONT = '"Inter Display", "Inter", "Segoe UI Black", "Arial Black", "Segoe UI", Arial, sans-serif';

  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawLeader(ctx, W, H, u, t) {
    const a = clamp((t - 0.15) / 0.2) * (t > 1.85 ? clamp((2.1 - t) / 0.25) : 1);
    if (a <= 0) return;
    const cx = W / 2;
    const cy = H / 2;
    const R = 300 * u;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(255,255,255,0.78)';
    ctx.lineWidth = 5 * u;
    circle(ctx, cx, cy, R);
    ctx.lineWidth = 2 * u;
    circle(ctx, cx, cy, R * 0.8);
    ctx.globalAlpha = a * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - R * 1.3, cy);
    ctx.lineTo(cx + R * 1.3, cy);
    ctx.moveTo(cx, cy - R * 1.3);
    ctx.lineTo(cx, cy + R * 1.3);
    ctx.stroke();
    // Teilstriche
    ctx.globalAlpha = a * 0.7;
    for (let i = 0; i < 60; i++) {
      const an = (i / 60) * Math.PI * 2;
      const l = i % 5 === 0 ? 26 * u : 12 * u;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(an) * R, cy + Math.sin(an) * R);
      ctx.lineTo(cx + Math.cos(an) * (R + l), cy + Math.sin(an) * (R + l));
      ctx.stroke();
    }
    // Radar-Zeiger
    const ang = ((t - 0.3) % 1) * Math.PI * 2 - Math.PI / 2;
    ctx.globalAlpha = a;
    const wedge = ctx.createConicGradient ? ctx.createConicGradient(ang - Math.PI * 0.6, cx, cy) : null;
    if (wedge) {
      wedge.addColorStop(0, 'rgba(255,255,255,0)');
      wedge.addColorStop(0.1, 'rgba(255,255,255,0.20)');
      wedge.addColorStop(0.1001, 'rgba(255,255,255,0)');
      ctx.fillStyle = wedge;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * R * 0.8, cy + Math.sin(ang) * R * 0.8);
    ctx.stroke();
    // Zahl
    if (t >= 0.3 && t < 1.8) {
      const idx = Math.floor((t - 0.3) / 0.5);
      const local = ((t - 0.3) % 0.5) / 0.5;
      const sc = 1 + 0.14 * (1 - ease(local * 2));
      ctx.save();
      ctx.translate(cx, cy + 6 * u);
      ctx.scale(sc, sc);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = `800 ${340 * u}px ${LOGO_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(3 - idx), 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawLogo(ctx, W, H, u, s, acc, o) {
    const L = getLayer(W, H);
    const c2 = L.getContext('2d');
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.clearRect(0, 0, W, H);
    c2.globalCompositeOperation = 'source-over';
    c2.globalAlpha = 1;
    const size = 330 * u;
    const gap = 16 * u;
    const chars = ['D', 'J', '6', '4'];
    c2.font = `900 ${size}px ${LOGO_FONT}`;
    c2.textAlign = 'left';
    c2.textBaseline = 'alphabetic';
    const widths = chars.map((ch) => c2.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
    const baseY = H * 0.5 + size * 0.34;
    let x = W / 2 - total / 2;
    const grad = c2.createLinearGradient(0, baseY - size * 0.75, 0, baseY);
    grad.addColorStop(0, '#FFFFFF');
    grad.addColorStop(0.5, rgba(mix(acc, 1.15).map((v) => Math.min(255, v + 25)), 1));
    grad.addColorStop(1, rgba(mix(acc, 0.62), 1));
    chars.forEach((ch, i) => {
      const start = 0.1 + 0.11 * i;
      const p = ease((s - start) / 0.55);
      if (p > 0) {
        c2.save();
        c2.globalAlpha = p;
        const cx = x + widths[i] / 2;
        c2.translate(cx, baseY - size * 0.3 + (1 - p) * 70 * u);
        const sc = 1 + 0.25 * (1 - p);
        c2.scale(sc, sc);
        c2.translate(-cx, -(baseY - size * 0.3));
        c2.fillStyle = grad;
        c2.fillText(ch, x, baseY);
        c2.restore();
      }
      x += widths[i] + gap;
    });
    // Lichtreflex, nur auf den Buchstaben
    const sw = (s - 0.9) / 0.9;
    if (sw > 0 && sw < 1) {
      const sx = -0.25 * W + sw * 1.5 * W;
      const g = c2.createLinearGradient(sx - 160 * u, baseY - size, sx + 160 * u, baseY);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c2.globalCompositeOperation = 'source-atop';
      c2.fillStyle = g;
      c2.fillRect(0, 0, W, H);
      c2.globalCompositeOperation = 'source-over';
    }
    // Leuchten
    const glow = 0.45 + 0.25 * Math.sin(s * 2.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = glow;
    ctx.filter = `blur(${30 * u}px)`;
    ctx.drawImage(L, 0, 0);
    ctx.filter = 'none';
    ctx.restore();
    ctx.drawImage(L, 0, 0);
    return { total, baseY, size };
  }

  function draw(ctx, W, H, t, o) {
    o = o || {};
    const u = H / 1080;
    const acc = hex(o.accent);
    const bg = hex(o.bg);
    const f = Math.floor(t * 24);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const s = t - HIT;
    const lit = clamp((t - HIT + 0.15) / 0.6);

    // Hintergrundlicht
    const bgG = ctx.createRadialGradient(W / 2, H * 0.52, 0, W / 2, H * 0.52, H * 1.0);
    bgG.addColorStop(0, rgba(mix(bg, 1.9).map((v) => Math.min(255, v + 10)), 0.6 * lit + 0.1));
    bgG.addColorStop(0.6, rgba(bg, 0.38 * lit + 0.05));
    bgG.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bgG;
    ctx.fillRect(0, 0, W, H);

    // Kamera: leichtes Schieben, Zittern, Fahrt nach vorn am Ende
    const push = 1 + 0.025 * clamp(t / DUR) + (t > 4.8 ? 0.14 * easeIO((t - 4.8) / 0.8) : 0);
    const shake = t < HIT + 0.6 ? 2.4 * u * (t < HIT ? 1 : 1 - (t - HIT) / 0.6) : 0;
    ctx.save();
    ctx.translate(W / 2 + (rnd(f) - 0.5) * shake, H / 2 + (rnd(f + 99) - 0.5) * shake);
    ctx.scale(push, push);
    ctx.translate(-W / 2, -H / 2);

    // Countdown
    if (t < 2.1) drawLeader(ctx, W, H, u, t);

    // Nach dem Einschlag
    if (s >= 0) {
      const appear = ease(s / 0.8);
      // Lichtstrahlen
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(W / 2, H * 0.5);
      for (let k = 0; k < 14; k++) {
        const an = (k / 14) * Math.PI * 2 + s * 0.18;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 0.95);
        g.addColorStop(0, rgba(acc, 0.13 * appear));
        g.addColorStop(1, rgba(acc, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, H * 0.95, an - 0.035, an + 0.035);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Schockwelle
      const ringR = s * 1500 * u;
      const ringA = Math.exp(-s * 2.4);
      if (ringA > 0.01) {
        ctx.save();
        ctx.strokeStyle = rgba(acc, ringA);
        ctx.lineWidth = Math.max(2 * u, 22 * u * ringA);
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Logo, Linie, Untertitel
      const info = drawLogo(ctx, W, H, u, s, acc, o);

      const lp = ease((s - 0.9) / 0.6);
      if (lp > 0) {
        const w = info.total * 1.04 * lp;
        const y = info.baseY + 38 * u;
        ctx.save();
        const lg = ctx.createLinearGradient(W / 2 - w / 2, 0, W / 2 + w / 2, 0);
        lg.addColorStop(0, rgba(acc, 0));
        lg.addColorStop(0.2, rgba(acc, 1));
        lg.addColorStop(0.8, rgba(acc, 1));
        lg.addColorStop(1, rgba(acc, 0));
        ctx.shadowColor = rgba(acc, 0.9);
        ctx.shadowBlur = 24 * u;
        ctx.fillStyle = lg;
        ctx.fillRect(W / 2 - w / 2, y, w, 7 * u);
        ctx.restore();
      }

      const tp = ease((s - 1.2) / 0.7);
      if (tp > 0) {
        ctx.save();
        ctx.globalAlpha = tp * 0.9;
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `500 ${40 * u}px ${LOGO_FONT}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${(30 - 16 * tp) * u}px`;
        ctx.fillText('IPTV  ·  LIVE  ·  FILME  ·  SERIEN', W / 2, info.baseY + 128 * u);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        ctx.restore();
      }

      // Funken und Staub
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let j = 0; j < 110; j++) {
        const speed = (12 + 34 * rnd(j + 900)) * u;
        const x0 = rnd(j) * W;
        const y0 = rnd(j + 500) * H;
        const y = (((y0 - speed * s) % H) + H) % H;
        const drift = Math.sin(s * (0.4 + rnd(j + 1100)) + j) * 24 * u;
        const tw = 0.5 + 0.5 * Math.sin(t * (1 + 3 * rnd(j + 1700)) + j);
        const a = 0.6 * tw * appear;
        const r = (1 + 2.6 * rnd(j + 1300)) * u;
        ctx.fillStyle = j % 3 === 0 ? rgba(acc, a) : `rgba(255,255,255,${a * 0.8})`;
        ctx.beginPath();
        ctx.arc(x0 + drift, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Streak (anamorphes Licht)
      const stA = Math.exp(-s * 2.0);
      if (stA > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const sg = ctx.createLinearGradient(0, 0, W, 0);
        sg.addColorStop(0, rgba(acc, 0));
        sg.addColorStop(0.5, `rgba(255,255,255,${0.95 * stA})`);
        sg.addColorStop(1, rgba(acc, 0));
        ctx.fillStyle = sg;
        ctx.fillRect(0, H / 2 - 4 * u * (0.4 + stA), W, 8 * u * (0.4 + stA));
        ctx.filter = `blur(${18 * u}px)`;
        ctx.globalAlpha = stA * 0.8;
        ctx.fillStyle = rgba(acc, 1);
        ctx.fillRect(W * 0.05, H / 2 - 22 * u, W * 0.9, 44 * u);
        ctx.restore();
      }
    }
    ctx.restore(); // Kamera

    // Blitz
    if (s >= 0) {
      const fl = Math.exp(-s * 9) * 0.92;
      if (fl > 0.005) {
        ctx.fillStyle = `rgba(255,255,255,${fl})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // Flackern vor dem Einschlag
    if (t < HIT) {
      const fk = 0.05 * (rnd(f + 7) - 0.5);
      ctx.fillStyle = fk > 0 ? `rgba(255,255,255,${fk})` : `rgba(0,0,0,${-fk * 2})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Filmkorn und Kratzer
    const gr = t < HIT ? 1 : 0.5;
    const n = Math.min(3000, Math.round(650 * ((W * H) / (1920 * 1080)))) * gr;
    for (let i = 0; i < n; i++) {
      const x = rnd(f * 7919 + i * 3) * W;
      const y = rnd(f * 104729 + i * 5 + 1) * H;
      const a = 0.04 + 0.1 * rnd(f * 13 + i);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(x, y, 1.3 * u + 0.5, 1.3 * u + 0.5);
    }
    if (rnd(f + 8) > 0.55) {
      ctx.fillStyle = `rgba(255,255,255,${0.1 + 0.1 * rnd(f + 11)})`;
      ctx.fillRect(rnd(f + 3) * W, 0, 1.4 * u + 0.4, H);
    }

    // Vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // Letterbox (Cinemascope 2,39:1)
    const bar = Math.max(0, (H - W / 2.39) / 2);
    const bp = ease(t / 0.9);
    const barH = bar * bp;
    if (barH > 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, barH);
      ctx.fillRect(0, H - barH, W, barH);
      if (bar > 20 * u) {
        ctx.save();
        ctx.globalAlpha = 0.55 * bp;
        ctx.fillStyle = '#fff';
        ctx.font = `500 ${19 * u}px ${LOGO_FONT}`;
        ctx.textBaseline = 'middle';
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${4 * u}px`;
        ctx.textAlign = 'left';
        ctx.fillText('DJ64  ·  4K  ·  24 FPS', W * 0.045, barH - bar / 2 + 0 * u);
        ctx.textAlign = 'right';
        ctx.fillText('REEL 01', W * 0.955, barH - bar / 2);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        ctx.restore();
      }
    }

    // Ein- und Ausblenden
    if (t < 0.15) {
      ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.15})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (o.fadeToBlack) {
      const fa = clamp((t - (DUR - 0.55)) / 0.5);
      if (fa > 0) {
        ctx.fillStyle = `rgba(0,0,0,${fa})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
    ctx.restore();
  }

  function duration(mode) {
    return mode === 'short' ? DUR - SHORT_OFFSET : DUR;
  }

  /** Startet die Animation auf einem Canvas. Rückgabe: Funktion zum Überspringen. */
  function run(canvas, opt, onDone) {
    const mode = (opt && opt.mode) || 'full';
    const offset = mode === 'short' ? SHORT_OFFSET : 0;
    const dur = duration(mode);
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let done = false;
    const t0 = performance.now();
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      onDone && onDone();
    };
    const frame = (now) => {
      if (done) return;
      fit();
      const t = (now - t0) / 1000;
      if (t >= dur) { finish(); return; }
      draw(ctx, canvas.width, canvas.height, t + offset, opt);
      const left = dur - t;
      canvas.style.opacity = left < 0.5 ? String(left / 0.5) : '1';
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return finish;
  }

  root.DJ64Intro = { draw, duration, run, DUR };
})(window);
