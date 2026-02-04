(() => {
  'use strict';

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha: false });

  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const startNoLockBtn = document.getElementById('startNoLockBtn');
  const supportMsg = document.getElementById('supportMsg');

  const hud = document.getElementById('hud');
  const lockStateEl = document.getElementById('lockState');
  const speedReadoutEl = document.getElementById('speedReadout');
  const heatReadoutEl = document.getElementById('heatReadout');
  const scoreReadoutEl = document.getElementById('scoreReadout');

  const sensEl = document.getElementById('sens');
  const zoomEl = document.getElementById('zoom');
  const resetBtn = document.getElementById('resetBtn');

  // --- TUNING: this is where "trackball feel" lives. ---
  const TUNING = {
    // Motion -> velocity impulse (multiplied by Sensitivity slider).
    inputToVel: 1.35, // baseline matches slider initial value

    // "Normal" drag. (Lower = more coast.)
    linearDrag: 0.45, // per second

    // Stop-on-a-dime brake (triggered by physically stopping the ball)
    brakeDuration: 0.13, // seconds
    brakeStrength: 18.0, // per second, during brake

    // Stop detection in terms of input-speed (px/s)
    stopFromSpeed: 900,
    stopToSpeed: 140,
    stopCooldown: 0.20,

    // Asteroids
    shipRadius: 10,
    asteroidMinR: 10,
    asteroidMaxR: 60,
    splitBase: 180,        // px/s impact required
    splitPerRadius: 10.0,  // additional required per px radius
    splitRatio: 0.68,      // child size ratio when splitting
    popRadius: 12,         // below this, pop instead of splitting further

    // World management
    targetAsteroids: 26,
    maxAsteroids: 90,
    spawnMinDist: 420,
    spawnMaxDist: 1000,
    despawnDist: 1400,

    // Visual
    trailMax: 42,          // segments
    starCount: 260,
    hitstopBase: 0.028,    // seconds
    hitstopPerImpact: 0.00001, // additional seconds per (px/s)^2 (tiny)
    cameraFollow: 10.0,    // per second (smoothing)
    cameraLead: 0.16,      // seconds of velocity lead
    dynamicZoomStrength: 0.35, // 0..1
  };

  // Feature check + messaging
  const supportsPointerLock = 'pointerLockElement' in document && 'requestPointerLock' in canvas;
  supportMsg.textContent = supportsPointerLock
    ? 'Pointer Lock supported. Click Start for “raw trackball mode”.'
    : 'Pointer Lock not supported in this browser. You can still try “Start without Pointer Lock”, but the feel will be limited. Firefox is recommended.';

  // --- Canvas sizing ---
  let dpr = 1;
  function resize() {
    dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- Input capture (trackball motion) ---
  let pointerLocked = false;
  let accDX = 0, accDY = 0;
  let lastClientX = null, lastClientY = null;
  let lastMoveT = performance.now();

  function onPointerMove(e) {
    let dx = 0, dy = 0;
    if (pointerLocked) {
      dx = e.movementX || 0;
      dy = e.movementY || 0;
    } else {
      if (lastClientX == null) {
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        return;
      }
      dx = e.clientX - lastClientX;
      dy = e.clientY - lastClientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
    }
    accDX += dx;
    accDY += dy;
    lastMoveT = performance.now();
  }
  document.addEventListener('pointermove', onPointerMove, { passive: true });

  // Clicking the canvas also tries to lock (nice if overlay hidden)
  canvas.addEventListener('click', () => {
    if (overlay.style.display !== 'none') return;
    tryRequestPointerLock();
  });

  function tryRequestPointerLock() {
    if (!supportsPointerLock) return false;
    // requestPointerLock must be in a user gesture
    try {
      canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      // Some browsers don't support the options object
      try { canvas.requestPointerLock(); } catch {}
    }
    return true;
  }

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = (document.pointerLockElement === canvas);
    lockStateEl.textContent = pointerLocked ? 'ON' : 'OFF';
    canvas.style.cursor = pointerLocked ? 'none' : 'crosshair';
  });

  // --- Small helpers ---
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function expSmooth(current, target, k, dt) {
    const t = 1 - Math.exp(-k * dt);
    return current + (target - current) * t;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // --- World state ---
  const world = {
    t: 0,
    score: 0,
    hitstop: 0,
    msg: '',
    msgT: 0,
  };

  const ship = {
    x: 0, y: 0,
    vx: 0, vy: 0,
    r: TUNING.shipRadius,
    heat: 0,
    inputSpeed: 0,
    prevInputSpeed: 0,
    brakeT: 0,
    stopCooldown: 0,
    trail: [],
    brakePulse: 0,
  };

  const camera = { x: 0, y: 0 };

  function makeAsteroid(x, y, r) {
    const pts = [];
    const n = Math.floor(rand(9, 15));
    const seed = Math.random() * 1000;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const wob = 0.70 + 0.45 * Math.sin(seed + i * 1.7) + 0.12 * Math.sin(seed * 0.7 + i * 4.2);
      pts.push({ a, m: wob });
    }
    return {
      x, y, r,
      vx: rand(-60, 60),
      vy: rand(-60, 60),
      rot: rand(0, Math.PI * 2),
      rotv: rand(-1.4, 1.4),
      pts,
      id: Math.random().toString(16).slice(2),
      glow: 0, // hit feedback
    };
  }

  const asteroids = [];
  const particles = [];
  const stars = [];

  function resetWorld() {
    world.t = 0;
    world.score = 0;
    world.hitstop = 0;
    world.msg = '';
    world.msgT = 0;

    ship.x = 0; ship.y = 0;
    ship.vx = 0; ship.vy = 0;
    ship.heat = 0;
    ship.inputSpeed = 0;
    ship.prevInputSpeed = 0;
    ship.brakeT = 0;
    ship.stopCooldown = 0;
    ship.trail.length = 0;
    ship.brakePulse = 0;

    camera.x = ship.x; camera.y = ship.y;

    asteroids.length = 0;
    particles.length = 0;

    // Big "hello world" asteroid close by to teach smashing.
    asteroids.push(makeAsteroid(220, -120, 58));
    asteroids.push(makeAsteroid(-260, 160, 42));
    for (let i = 0; i < TUNING.targetAsteroids - 2; i++) {
      spawnAsteroidFar();
    }

    stars.length = 0;
    for (let i = 0; i < TUNING.starCount; i++) {
      stars.push({
        x: rand(-2400, 2400),
        y: rand(-2400, 2400),
        z: rand(0.15, 1.0),
      });
    }
  }

  function spawnAsteroidFar() {
    const ang = rand(0, Math.PI * 2);
    const dist = rand(TUNING.spawnMinDist, TUNING.spawnMaxDist);
    const x = ship.x + Math.cos(ang) * dist;
    const y = ship.y + Math.sin(ang) * dist;
    const r = rand(TUNING.asteroidMinR, TUNING.asteroidMaxR);
    asteroids.push(makeAsteroid(x, y, r));
  }

  resetWorld();

  // --- Particles / effects ---
  function addBurst(x, y, nx, ny, strength, warm) {
    const count = Math.floor(clamp(strength / 90, 8, 26));
    for (let i = 0; i < count; i++) {
      const a = Math.atan2(ny, nx) + rand(-1.2, 1.2);
      const sp = rand(90, 420) * (0.35 + 0.65 * Math.random()) * (strength / 900);
      particles.push({
        x, y,
        vx: Math.cos(a) * sp + rand(-40, 40),
        vy: Math.sin(a) * sp + rand(-40, 40),
        life: rand(0.25, 0.7),
        t: 0,
        r: rand(1.0, 2.6),
        warm: warm ? 1 : 0,
      });
    }
  }

  function addPop(x, y, energy) {
    const count = Math.floor(clamp(energy / 70, 14, 34));
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(80, 520) * (0.2 + 0.8 * Math.random()) * (energy / 900);
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.30, 0.9),
        t: 0,
        r: rand(1.2, 3.0),
        warm: 1,
      });
    }
  }

  function showMsg(text, seconds) {
    world.msg = text;
    world.msgT = seconds;
  }

  // --- Collision helpers (continuous) ---
  function segmentCircleHit(ax, ay, bx, by, cx, cy, r) {
    // Returns t in [0,1] of closest hit along segment if intersects; else null.
    const abx = bx - ax, aby = by - ay;
    const acx = cx - ax, acy = cy - ay;
    const abLen2 = abx * abx + aby * aby;
    if (abLen2 < 1e-6) {
      const dx = ax - cx, dy = ay - cy;
      return (dx * dx + dy * dy <= r * r) ? 0 : null;
    }
    let t = (acx * abx + acy * aby) / abLen2;
    t = clamp(t, 0, 1);
    const px = ax + abx * t;
    const py = ay + aby * t;
    const dx = px - cx, dy = py - cy;
    return (dx * dx + dy * dy <= r * r) ? t : null;
  }

  // --- Game step ---
  let running = false;
  let lastT = performance.now();

  function step(now) {
    requestAnimationFrame(step);
    const dtRaw = (now - lastT) / 1000;
    lastT = now;
    // Clamp dt for stability.
    const dt = clamp(dtRaw, 0.0, 0.033);

    if (!running) {
      render(dt, true);
      return;
    }

    // Hitstop (pauses simulation but still renders)
    if (world.hitstop > 0) {
      world.hitstop -= dt;
      render(dt, false);
      return;
    }

    world.t += dt;

    // Read + clear accumulated input (in CSS px)
    const dx = accDX; const dy = accDY;
    accDX = 0; accDY = 0;

    // Input speed estimation for stop-detection and "trackball-ness"
    const instSpeed = Math.hypot(dx, dy) / Math.max(dt, 1e-4); // px/s
    ship.prevInputSpeed = ship.inputSpeed;
    ship.inputSpeed = expSmooth(ship.inputSpeed, instSpeed, 18.0, dt);

    // If no movement in a bit, decay faster (helps detect "ball stopped")
    if (performance.now() - lastMoveT > 55) {
      ship.inputSpeed = expSmooth(ship.inputSpeed, 0, 22.0, dt);
    }

    // Stop-on-a-dime brake trigger (after high input, a sudden dead stop)
    ship.stopCooldown = Math.max(0, ship.stopCooldown - dt);
    if (ship.stopCooldown <= 0 &&
        ship.prevInputSpeed > TUNING.stopFromSpeed &&
        ship.inputSpeed < TUNING.stopToSpeed) {
      ship.brakeT = TUNING.brakeDuration;
      ship.stopCooldown = TUNING.stopCooldown;
      ship.brakePulse = 0.18;
    }

    // Apply "trackball thrust": the deltas add velocity directly.
    const sens = parseFloat(sensEl.value || String(TUNING.inputToVel));
    const gain = sens;
    ship.vx += dx * gain;
    ship.vy += dy * gain;

    // Apply drag
    const drag = TUNING.linearDrag + ship.heat * 0.08;
    const dragFactor = Math.exp(-drag * dt);
    ship.vx *= dragFactor;
    ship.vy *= dragFactor;

    // Apply brake if active
    if (ship.brakeT > 0) {
      ship.brakeT -= dt;
      const b = Math.exp(-TUNING.brakeStrength * dt);
      ship.vx *= b;
      ship.vy *= b;
    }

    // Integrate ship position
    const prevX = ship.x, prevY = ship.y;
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;

    // Heat is basically "how fast you're going" (diegetic meter)
    const speed = Math.hypot(ship.vx, ship.vy);
    const heatTarget = clamp((speed - 80) / 1100, 0, 1);
    ship.heat = expSmooth(ship.heat, heatTarget, 6.0, dt);

    // Trail
    ship.trail.push({ x: ship.x, y: ship.y, h: ship.heat, t: world.t });
    if (ship.trail.length > TUNING.trailMax) ship.trail.shift();
    ship.brakePulse = Math.max(0, ship.brakePulse - dt);

    // Update asteroids
    for (const a of asteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot += a.rotv * dt;
      a.glow = Math.max(0, a.glow - dt * 2.8);

      // Reposition far asteroids to keep the toy dense around you.
      const dd = Math.hypot(a.x - ship.x, a.y - ship.y);
      if (dd > TUNING.despawnDist) {
        const ang = rand(0, Math.PI * 2);
        const dist = rand(TUNING.spawnMinDist, TUNING.spawnMaxDist);
        a.x = ship.x + Math.cos(ang) * dist;
        a.y = ship.y + Math.sin(ang) * dist;
        a.vx = rand(-60, 60);
        a.vy = rand(-60, 60);
      }
    }

    // Maintain asteroid count
    while (asteroids.length < TUNING.targetAsteroids) spawnAsteroidFar();

    // Cap asteroid count so splitting can't snowball into a performance problem.
    // We bias removal toward small + far rocks (you won't notice them disappearing).
    while (asteroids.length > TUNING.maxAsteroids) {
      let bestIdx = -1;
      let best = -1e9;
      const tries = Math.min(14, asteroids.length);
      for (let k = 0; k < tries; k++) {
        const idx = (Math.random() * asteroids.length) | 0;
        const a = asteroids[idx];
        const dist = Math.hypot(a.x - ship.x, a.y - ship.y);
        const score = dist + (60 - a.r) * 6;
        if (score > best) { best = score; bestIdx = idx; }
      }
      if (bestIdx >= 0) asteroids.splice(bestIdx, 1);
      else break;
    }

    // Continuous collision: ship segment vs asteroids
    // We do at most one split/bounce per frame to keep it readable (and to sell impact).
    let collisionHandled = false;
    for (let i = 0; i < asteroids.length && !collisionHandled; i++) {
      const a = asteroids[i];
      const hitT = segmentCircleHit(prevX, prevY, ship.x, ship.y, a.x, a.y, ship.r + a.r);
      if (hitT == null) continue;

      // approximate contact point
      const cx = lerp(prevX, ship.x, hitT);
      const cy = lerp(prevY, ship.y, hitT);

      const nx = (cx - a.x);
      const ny = (cy - a.y);
      const nd = Math.hypot(nx, ny) || 1;
      const nnx = nx / nd, nny = ny / nd;

      // Relative normal speed (asteroid is light; treat its vel too)
      const rvx = ship.vx - a.vx;
      const rvy = ship.vy - a.vy;
      const relN = rvx * nnx + rvy * nny;
      const impact = Math.abs(relN);

      const required = TUNING.splitBase + a.r * TUNING.splitPerRadius;

      if (impact > required) {
        // Split / pop
        a.glow = 0.25;
        collisionHandled = true;

        // Slightly "cut through" instead of a full bounce:
        ship.vx *= 0.94;
        ship.vy *= 0.94;

        const hitEnergy = impact * (0.6 + 0.8 * ship.heat);
        world.score += Math.floor((a.r * a.r) * 0.05 + hitEnergy * 0.3);

        // Effects
        addBurst(cx, cy, nnx, nny, impact, true);

        // Hitstop scales a little with impact
        const hs = TUNING.hitstopBase + TUNING.hitstopPerImpact * impact * impact;
        world.hitstop = clamp(hs, 0.018, 0.060);

        // Split mechanics
        const childR = a.r * TUNING.splitRatio;

        // If below pop radius, pop it fully.
        if (childR < TUNING.popRadius) {
          addPop(a.x, a.y, impact + 300);
          asteroids.splice(i, 1);
          showMsg('POP!', 0.35);
          break;
        }

        // Otherwise split into two chunks
        const cutAngle = Math.atan2(ship.vy, ship.vx) + Math.PI / 2 + rand(-0.25, 0.25);
        const cxn = Math.cos(cutAngle), cyn = Math.sin(cutAngle);
        const sep = childR * 0.70;

        const a1 = makeAsteroid(a.x + cxn * sep, a.y + cyn * sep, childR);
        const a2 = makeAsteroid(a.x - cxn * sep, a.y - cyn * sep, childR);

        // Give fragments some kick
        const kick = clamp(impact * 0.18, 40, 240);
        a1.vx = a.vx + cxn * kick + rand(-30, 30);
        a1.vy = a.vy + cyn * kick + rand(-30, 30);
        a2.vx = a.vx - cxn * kick + rand(-30, 30);
        a2.vy = a.vy - cyn * kick + rand(-30, 30);

        // Replace
        asteroids.splice(i, 1, a1, a2);

        // Tiny message in early game
        if (world.t < 10) showMsg('Nice crack!', 0.55);
      } else {
        // "Bonk" bounce (low-energy collision)
        collisionHandled = true;

        // Push ship out a bit along normal
        ship.x = cx + nnx * (ship.r + a.r + 0.2);
        ship.y = cy + nny * (ship.r + a.r + 0.2);

        // Reflect ship velocity (inelastic)
        const e = 0.35; // restitution
        const vdot = ship.vx * nnx + ship.vy * nny;
        ship.vx = ship.vx - (1 + e) * vdot * nnx;
        ship.vy = ship.vy - (1 + e) * vdot * nny;

        ship.vx *= 0.78;
        ship.vy *= 0.78;

        a.glow = 0.14;
        addBurst(cx, cy, nnx, nny, 240 + impact, false);
        world.hitstop = 0.012;

        if (world.t < 8) showMsg('Go faster to split!', 0.8);
      }
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      const k = p.warm ? 0.7 : 0.45;
      p.vx *= Math.exp(-k * dt);
      p.vy *= Math.exp(-k * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.t > p.life) particles.splice(i, 1);
    }

    // Camera follow with slight lead
    const leadX = ship.vx * TUNING.cameraLead;
    const leadY = ship.vy * TUNING.cameraLead;
    camera.x = expSmooth(camera.x, ship.x + leadX, TUNING.cameraFollow, dt);
    camera.y = expSmooth(camera.y, ship.y + leadY, TUNING.cameraFollow, dt);

    // HUD readouts
    speedReadoutEl.textContent = String(Math.round(speed));
    heatReadoutEl.textContent = String(Math.round(ship.heat * 100)) + '%';
    scoreReadoutEl.textContent = String(world.score);

    // Message timer
    world.msgT = Math.max(0, world.msgT - dt);

    render(dt, false);
  }

  // --- Rendering ---
  function render(dt, paused) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w * 0.5;
    const cy = h * 0.5;

    const speed = Math.hypot(ship.vx, ship.vy);

    // Zoom: base slider * subtle dynamic zoom-out with speed
    const baseZoom = parseFloat(zoomEl.value || '1.0');
    const dyn = 1 - TUNING.dynamicZoomStrength * clamp(speed / 1800, 0, 1);
    const zoom = baseZoom * dyn;

    // Background
    ctx.fillStyle = '#070A10';
    ctx.fillRect(0, 0, w, h);

    // Stars (parallax)
    for (const s of stars) {
      const px = (s.x - camera.x * s.z) * 0.10;
      const py = (s.y - camera.y * s.z) * 0.10;
      const x = (px % (w + 60) + (w + 60)) % (w + 60) - 30;
      const y = (py % (h + 60) + (h + 60)) % (h + 60) - 30;
      const a = 0.10 + 0.35 * s.z;
      ctx.fillStyle = `rgba(210,230,255,${a})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }

    // Convert world -> screen
    function sx(wx) { return (wx - camera.x) * zoom + cx; }
    function sy(wy) { return (wy - camera.y) * zoom + cy; }

    // Trail
    if (ship.trail.length >= 2) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < ship.trail.length; i++) {
        const p0 = ship.trail[i - 1];
        const p1 = ship.trail[i];
        const t = i / ship.trail.length;
        const a = 0.03 + 0.20 * p1.h;
        const lw = 1 + 6 * p1.h;
        ctx.strokeStyle = `rgba(140,190,255,${a})`;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(sx(p0.x), sy(p0.y));
        ctx.lineTo(sx(p1.x), sy(p1.y));
        ctx.stroke();
      }
    }

    // Brake pulse ring
    if (ship.brakePulse > 0) {
      const t = 1 - ship.brakePulse / 0.18;
      const rr = 18 + t * 60;
      const a = 0.35 * (1 - t);
      ctx.strokeStyle = `rgba(210,240,255,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx(ship.x), sy(ship.y), rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Asteroids
    for (const a of asteroids) {
      const x = sx(a.x), y = sy(a.y);
      const r = a.r * zoom;
      if (x < -r - 60 || x > w + r + 60 || y < -r - 60 || y > h + r + 60) continue;

      // Glow rim on hit
      if (a.glow > 0) {
        ctx.strokeStyle = `rgba(255,235,190,${0.45 * a.glow})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Rock fill
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;

      ctx.beginPath();
      const pts = a.pts;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const aa = p.a + a.rot;
        const rr = a.r * p.m;
        const px = x + Math.cos(aa) * rr * zoom;
        const py = y + Math.sin(aa) * rr * zoom;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Particles
    for (const p of particles) {
      const t = p.t / p.life;
      const a = (1 - t) * (p.warm ? 0.75 : 0.45);
      const x = sx(p.x), y = sy(p.y);
      const r = (p.r * (0.7 + 0.9 * (1 - t))) * zoom;
      ctx.fillStyle = p.warm
        ? `rgba(255,210,150,${a})`
        : `rgba(190,220,255,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ship (simple triangle-ish) + heat glow
    const shipX = sx(ship.x), shipY = sy(ship.y);
    const ang = Math.atan2(ship.vy, ship.vx);
    const r = ship.r * zoom;

    // Heat aura
    if (ship.heat > 0.02) {
      const a = 0.10 + 0.40 * ship.heat;
      ctx.fillStyle = `rgba(255,210,150,${a})`;
      ctx.beginPath();
      ctx.arc(shipX, shipY, r + 10 * ship.heat, 0, Math.PI * 2);
      ctx.fill();
    }

    // Body
    ctx.save();
    ctx.translate(shipX, shipY);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(230,242,255,0.92)';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(r * 1.5, 0);
    ctx.lineTo(-r * 1.0, r * 0.85);
    ctx.lineTo(-r * 0.55, 0);
    ctx.lineTo(-r * 1.0, -r * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Nose heat stripe
    ctx.strokeStyle = `rgba(255,220,160,${0.15 + 0.65 * ship.heat})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, 0);
    ctx.lineTo(r * 1.25, 0);
    ctx.stroke();

    ctx.restore();

    // Minimal "clarity" vector: where you're actually moving
    const vLen = clamp(speed * 0.06, 10, 60) * zoom;
    ctx.strokeStyle = 'rgba(140,190,255,0.38)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(shipX, shipY);
    ctx.lineTo(shipX + Math.cos(ang) * vLen, shipY + Math.sin(ang) * vLen);
    ctx.stroke();

    // Message
    if (world.msgT > 0) {
      const a = clamp(world.msgT / 0.8, 0, 1);
      ctx.fillStyle = `rgba(235,245,255,${0.85 * a})`;
      ctx.font = '700 16px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(world.msg, cx, 72);
    }

    // If paused (no pointer lock yet), hint at clicking
    if (!pointerLocked && overlay.style.display === 'none') {
      ctx.fillStyle = 'rgba(235,245,255,0.8)';
      ctx.font = '600 12px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Tip: click to lock pointer for “raw trackball mode” (Esc to unlock)', cx, h - 24);
    }
  }

  // --- Start / UI wiring ---
  function start(lock) {
    overlay.style.display = 'none';
    hud.style.display = 'flex';
    running = true;

    if (lock) {
      // Must be within the click handler
      tryRequestPointerLock();
    }
  }

  startBtn.addEventListener('click', () => start(true));
  startNoLockBtn.addEventListener('click', () => start(false));
  resetBtn.addEventListener('click', () => resetWorld());

  // Also: if user changes sensitivity slider, keep internal default synced
  sensEl.addEventListener('input', () => {});
  zoomEl.addEventListener('input', () => {});

  // Start render loop
  requestAnimationFrame((t) => {
    lastT = t;
    requestAnimationFrame(step);
  });

})();