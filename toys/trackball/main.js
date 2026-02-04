'use strict';

/*
  Trackball Toybox
  - 8 motion-only mini toys
  - Designed for "flick / fling / stop" delight
  - Static hosting friendly

  Notes:
  - Browsers generally expose multiple mice as ONE pointer.
  - This toybox is "trackball-only" in the sense that gameplay is driven by motion;
    clicks are only used for UI and (optionally) pointer lock / audio.
*/

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha: false });

const ui = {
  overlay: document.getElementById('overlay'),
  startBtn: document.getElementById('startBtn'),
  startLockBtn: document.getElementById('startLockBtn'),
  lockBtn: document.getElementById('lockBtn'),
  unlockBtn: document.getElementById('unlockBtn'),
  resetBtn: document.getElementById('resetBtn'),
  modes: document.getElementById('modes'),
  modeName: document.getElementById('modeName'),
  modeDesc: document.getElementById('modeDesc'),
  modeHint: document.getElementById('modeHint'),
  pillPhase: document.getElementById('pillPhase'),
  pillScore: document.getElementById('pillScore'),
  pillFps: document.getElementById('pillFps'),
};

const TAU = Math.PI * 2;

const TUNING = {
  // Global "hand" feel (this is the main trackball-toy knob set)
  handGain: 0.90,          // higher = more travel per physical flick
  followMoving: 28,        // how quickly hand matches your motion while moving
  followStopped: 40,       // how quickly hand velocity settles when you stop moving
  dampMoving: 1.2,         // residual damping while moving
  dampStopped: 5.0,        // residual damping while stopped
  boundsMargin: 24,        // soft wall for the hand
  boundsBounce: 0.25,

  // "Stop" detection (used for snaps, drums, splats)
  stopFast: 620,           // must exceed this speed to count as a real flick
  stopSlow: 80,            // then drop below this to count as a stop
};


function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t){ return a + (b - a) * t; }
function smoothstep(t){ return t*t*(3-2*t); }
function rand(a=0,b=1){ return a + Math.random()*(b-a); }
function randi(a,b){ return Math.floor(rand(a,b)); }
function hypot(x,y){ return Math.hypot(x,y); }
function len2(x,y){ return x*x + y*y; }
function norm(x,y){
  const m = Math.hypot(x,y) || 1;
  return {x: x/m, y: y/m, m};
}
function now(){ return performance.now(); }

let W = 0, H = 0, DPR = 1;
let resizePending = false;

function resize(){
  const rect = canvas.getBoundingClientRect();
  W = Math.max(2, Math.floor(rect.width));
  H = Math.max(2, Math.floor(rect.height));
  DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  resizePending = true;
}
window.addEventListener('resize', resize, { passive: true });
resize();

// ---------------------------------------------
// Input (movement-only) + "hand" controller point
// ---------------------------------------------
const input = {
  // "virtual pointer" in CSS pixels (we draw our own cursor)
  x: W * 0.5,
  y: H * 0.5,

  // accumulated relative movement this frame
  dx: 0,
  dy: 0,

  // last absolute pointer (when not locked)
  lastClientX: null,
  lastClientY: null,

  // smoothed speed signals
  speed: 0,
  speedRaw: 0,
  prevSpeedRaw: 0,

  // for stop/flick detection
  lastVelX: 0,
  lastVelY: 0,
  lastMoveMs: now(),
};

const events = {
  stop: false,
  flick: false,
  stopStrength: 0,
  flickVx: 0,
  flickVy: 0,
};

function inPointerLock(){
  return document.pointerLockElement === canvas;
}

function handleMoveFromEvent(e){
  // e is PointerEvent or MouseEvent
  const locked = inPointerLock();

  if (locked){
    const mx = e.movementX || 0;
    const my = e.movementY || 0;
    input.dx += mx;
    input.dy += my;
    input.x = clamp(input.x + mx, 0, W);
    input.y = clamp(input.y + my, 0, H);
    input.lastMoveMs = now();
    return;
  }

  // Not locked: use absolute client positions
  // (works for mouse/trackball and touch)
  const cx = e.clientX;
  const cy = e.clientY;

  if (input.lastClientX == null){
    input.lastClientX = cx;
    input.lastClientY = cy;
  }

  const mx = cx - input.lastClientX;
  const my = cy - input.lastClientY;

  input.lastClientX = cx;
  input.lastClientY = cy;

  input.dx += mx;
  input.dy += my;

  // Keep a virtual cursor for drawing (clamped to canvas rect)
  const rect = canvas.getBoundingClientRect();
  input.x = clamp(cx - rect.left, 0, rect.width);
  input.y = clamp(cy - rect.top, 0, rect.height);
  input.lastMoveMs = now();
}

// Use pointer events when possible; also keep mousemove for older Safari quirks.
canvas.addEventListener('pointermove', handleMoveFromEvent, { passive: true });
canvas.addEventListener('mousemove', handleMoveFromEvent, { passive: true });

// Prevent context menu while experimenting (esp. right click when pointer locked)
canvas.addEventListener('contextmenu', (e)=> e.preventDefault());

const hand = {
  x: W * 0.5,
  y: H * 0.5,
  vx: 0,
  vy: 0,
  r: 16,
};

function updateHand(dt){
  // Convert frame movement into a "desired velocity" signal.
  const ivx = input.dx / Math.max(1e-4, dt);
  const ivy = input.dy / Math.max(1e-4, dt);

  // Trackball-friendly: quickly follow when moving, quickly settle when stopped.
  const moving = (Math.abs(input.dx) + Math.abs(input.dy)) > 0.001;
  const follow = moving ? 1 - Math.exp(-TUNING.followMoving * dt) : 1 - Math.exp(-TUNING.followStopped * dt);

  // Gain makes the hand feel "bigger" (more travel per physical flick)
  const gain = TUNING.handGain;

  hand.vx = lerp(hand.vx, ivx * gain, follow);
  hand.vy = lerp(hand.vy, ivy * gain, follow);

  // Mild residual damping (keeps it tidy)
  const damp = Math.exp(-(moving ? TUNING.dampMoving : TUNING.dampStopped) * dt);
  hand.vx *= damp;
  hand.vy *= damp;

  hand.x += hand.vx * dt;
  hand.y += hand.vy * dt;

  // Soft bounds with springy pushback
  const margin = TUNING.boundsMargin;
  if (hand.x < margin){ hand.x = margin; hand.vx *= -TUNING.boundsBounce; }
  if (hand.x > W - margin){ hand.x = W - margin; hand.vx *= -TUNING.boundsBounce; }
  if (hand.y < margin){ hand.y = margin; hand.vy *= -TUNING.boundsBounce; }
  if (hand.y > H - margin){ hand.y = H - margin; hand.vy *= -TUNING.boundsBounce; }
}

function updateMotionEvents(dt){
  // Raw speed from relative movement
  const ivx = input.dx / Math.max(1e-4, dt);
  const ivy = input.dy / Math.max(1e-4, dt);
  const sp = Math.hypot(ivx, ivy);

  input.prevSpeedRaw = input.speedRaw;
  input.speedRaw = sp;

  // Smoothed speed for visuals
  const a = 1 - Math.exp(-18 * dt);
  input.speed = lerp(input.speed, sp, a);

  // Detect a "stop" moment: was fast, then quickly slow.
  events.stop = false;
  events.flick = false;
  events.stopStrength = 0;

  const fast = input.prevSpeedRaw > TUNING.stopFast;
  const slow = input.speedRaw < TUNING.stopSlow;

  if (fast && slow){
    events.stop = true;
    // stopStrength scales with how hard the peak was
    events.stopStrength = clamp((input.prevSpeedRaw - TUNING.stopFast) / 900, 0, 1);
  }

  // Flick event: big speed drop, keep the last velocity direction
  // We'll capture the previous frame's hand velocity as the flick direction.
  if (fast && slow){
    events.flick = true;
    events.flickVx = hand.vx;
    events.flickVy = hand.vy;
  }

  input.lastVelX = ivx;
  input.lastVelY = ivy;
}

// ---------------------------------------------
// Juice: hitstop + camera shake (shared)
// ---------------------------------------------
const juice = {
  hitstop: 0,     // seconds remaining
  shake: 0,       // intensity
  shakeX: 0,
  shakeY: 0,
};

function addHitstop(ms){
  juice.hitstop = Math.max(juice.hitstop, ms / 1000);
}

function addShake(amount){
  juice.shake = Math.max(juice.shake, amount);
}

function applyCamera(){
  const s = juice.shake;
  if (s <= 0){
    juice.shakeX = 0;
    juice.shakeY = 0;
    return;
  }
  const ang = rand(0, TAU);
  const mag = s * (0.6 + 0.4*Math.random());
  juice.shakeX = Math.cos(ang) * mag;
  juice.shakeY = Math.sin(ang) * mag;
}

function updateJuice(dt){
  if (juice.hitstop > 0){
    juice.hitstop = Math.max(0, juice.hitstop - dt);
  }
  if (juice.shake > 0){
    juice.shake = Math.max(0, juice.shake - dt * 28);
  }
}

// ---------------------------------------------
// Tiny helpers: particles + rope + circles
// ---------------------------------------------
class ParticleSystem {
  constructor(){
    this.p = [];
  }
  burst(x,y, count, speedMin, speedMax, lifeMin, lifeMax, sizeMin, sizeMax){
    for(let i=0;i<count;i++){
      const a = rand(0, TAU);
      const sp = rand(speedMin, speedMax);
      this.p.push({
        x, y,
        vx: Math.cos(a)*sp,
        vy: Math.sin(a)*sp,
        life: rand(lifeMin, lifeMax),
        maxLife: 0,
        size: rand(sizeMin, sizeMax),
      });
    }
    // store maxLife for alpha
    const n = this.p.length;
    for(let i=n-count;i<n;i++){
      this.p[i].maxLife = this.p[i].life;
    }
  }
  update(dt){
    for(const q of this.p){
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= Math.exp(-dt*2.2);
      q.vy *= Math.exp(-dt*2.2);
      q.life -= dt;
    }
    this.p = this.p.filter(q => q.life > 0);
  }
  render(ctx, styleFn){
    for(const q of this.p){
      const t = clamp(q.life / (q.maxLife||1), 0, 1);
      const a = t*t;
      ctx.globalAlpha = a;
      styleFn?.(ctx, q, t);
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

class Rope {
  constructor(count, segLen){
    this.segLen = segLen;
    this.points = [];
    for(let i=0;i<count;i++){
      this.points.push({ x: W*0.5, y: H*0.5, ox: W*0.5, oy: H*0.5 });
    }
  }
  reset(x,y){
    for(const p of this.points){
      p.x = x; p.y = y;
      p.ox = x; p.oy = y;
    }
  }
  setHead(x,y){
    const p = this.points[0];
    p.x = x; p.y = y;
    p.ox = x; p.oy = y;
  }
  update(dt, iterations=8, damping=0.985){
    // verlet integrate (skip head, pinned externally)
    for(let i=1;i<this.points.length;i++){
      const p = this.points[i];
      const vx = (p.x - p.ox) * damping;
      const vy = (p.y - p.oy) * damping;
      p.ox = p.x; p.oy = p.y;
      p.x += vx;
      p.y += vy;
    }

    // satisfy constraints
    for(let it=0; it<iterations; it++){
      for(let i=0;i<this.points.length-1;i++){
        const a = this.points[i];
        const b = this.points[i+1];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.hypot(dx,dy) || 1;
        const diff = (d - this.segLen) / d;

        // head is pinned, so move only b when i==0
        if (i === 0){
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          const half = 0.5;
          a.x += dx * diff * half;
          a.y += dy * diff * half;
          b.x -= dx * diff * half;
          b.y -= dy * diff * half;
        }
      }
    }

    // keep points in bounds gently
    for(let i=1;i<this.points.length;i++){
      const p = this.points[i];
      p.x = clamp(p.x, 0, W);
      p.y = clamp(p.y, 0, H);
    }
  }
  tip(){
    return this.points[this.points.length-1];
  }
  pointSpeed(i){
    const p = this.points[i];
    return Math.hypot(p.x - p.ox, p.y - p.oy);
  }
}

// circle collision for moving circle vs static circle
function bounceCircle(m, sx, sy, sr, bounce=1.0){
  let dx = m.x - sx;
  let dy = m.y - sy;
  const dist = Math.hypot(dx,dy) || 1;
  const minD = m.r + sr;
  if (dist >= minD) return false;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minD - dist;
  m.x += nx * overlap;
  m.y += ny * overlap;

  // reflect velocity
  const vn = m.vx * nx + m.vy * ny;
  if (vn < 0){
    m.vx -= (1 + bounce) * vn * nx;
    m.vy -= (1 + bounce) * vn * ny;
  }
  return true;
}

// ---------------------------------------------
// Modes
// ---------------------------------------------
class Mode {
  constructor(key, name, desc){
    this.key = key;
    this.name = name;
    this.desc = desc;
    this.t = 0;
    this.phase = 0;
    this.score = 0;
  }
  onEnter(){ this.t = 0; this.phase = 0; this.score = 0; }
  onExit(){}
  update(dt){}
  render(ctx){}
  hint(){ return "Move the trackball."; }
  phaseLabel(){ return `Phase ${this.phase+1}`; }
}

class RibbonPop extends Mode{
  constructor(){
    super('ribbon', 'Ribbon Pop', 'Whip a silky ribbon. Fast flicks create snaps. Pop bubbles (gold bubbles prefer a *snap*).');
    this.rope = new Rope(34, 12);
    this.bubbles = [];
    this.fx = new ParticleSystem();
  }
  onEnter(){
    super.onEnter();
    this.rope = new Rope(34, 12);
    this.rope.reset(W*0.5, H*0.5);
    this.bubbles = [];
    this.fx = new ParticleSystem();
  }
  update(dt){
    this.t += dt;
    // Mario-ish ramp:
    // 0-12s: feel ribbon
    // 12-32s: normal bubbles
    // 32s+: add gold bubbles
    this.phase = this.t < 12 ? 0 : (this.t < 32 ? 1 : 2);

    this.rope.setHead(hand.x, hand.y);
    const iters = 8 + (this.phase>=2 ? 2 : 0);
    this.rope.update(dt, iters, 0.985);

    // spawn bubbles
    const target = this.phase === 0 ? 0 : (this.phase === 1 ? 24 : 34);
    while(this.bubbles.length < target){
      const edge = randi(0,4);
      let x,y;
      if (edge===0){ x = rand(0,W); y = -20; }
      if (edge===1){ x = W+20; y = rand(0,H); }
      if (edge===2){ x = rand(0,W); y = H+20; }
      if (edge===3){ x = -20; y = rand(0,H); }
      const sp = rand(10, 38);
      const a = rand(0, TAU);
      const type = (this.phase>=2 && Math.random()<0.18) ? 'gold' : 'normal';
      this.bubbles.push({
        x,y,
        vx: Math.cos(a)*sp,
        vy: Math.sin(a)*sp,
        r: type==='gold' ? rand(16,22) : rand(13,18),
        type,
        wob: rand(0,TAU),
      });
    }

    // update bubbles
    for(const b of this.bubbles){
      b.wob += dt * rand(0.6, 1.3);
      b.x += b.vx * dt + Math.cos(b.wob)*0.25;
      b.y += b.vy * dt + Math.sin(b.wob)*0.25;
      // gentle wrap
      if (b.x < -40) b.x = W+40;
      if (b.x > W+40) b.x = -40;
      if (b.y < -40) b.y = H+40;
      if (b.y > H+40) b.y = -40;
    }

    // collisions: bubbles vs rope points
    const popped = [];
    for(let bi=0; bi<this.bubbles.length; bi++){
      const b = this.bubbles[bi];
      let hit = false;
      let hitSpeed = 0;
      // Check every other point for perf
      for(let i=1; i<this.rope.points.length; i+=2){
        const p = this.rope.points[i];
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        const d2 = dx*dx + dy*dy;
        const rr = (b.r + 6);
        if (d2 < rr*rr){
          hit = true;
          hitSpeed = this.rope.pointSpeed(i);
          break;
        }
      }

      if (!hit) continue;

      if (b.type === 'gold'){
        // needs a snap (fast local rope motion)
        if (hitSpeed < 12){
          // bounce away a bit (no punishment, just feedback)
          const v = norm(rand(-1,1), rand(-1,1));
          b.vx += v.x * 35;
          b.vy += v.y * 35;
          continue;
        }
      }

      popped.push(bi);
      this.score += (b.type==='gold') ? 8 : 2;
      this.fx.burst(b.x, b.y, b.type==='gold' ? 24 : 14, 40, 240, 0.22, 0.55, 1.2, 2.6);
      addShake(b.type==='gold' ? 12 : 6);
      addHitstop(b.type==='gold' ? 45 : 22);

      // chain: spawn poplets in phase2
      if (this.phase>=2 && Math.random()<0.22){
        for(let k=0;k<2;k++){
          this.bubbles.push({
            x: b.x + rand(-10,10),
            y: b.y + rand(-10,10),
            vx: rand(-25,25),
            vy: rand(-25,25),
            r: rand(9,12),
            type: 'normal',
            wob: rand(0,TAU),
          });
        }
      }
    }

    // remove popped bubbles (reverse order)
    popped.sort((a,b)=>b-a);
    for(const idx of popped){
      this.bubbles.splice(idx,1);
    }

    // Keep population stable
    if (this.phase>0 && this.bubbles.length < 6){
      this.t = Math.max(this.t, 12.1);
    }

    this.fx.update(dt);
  }
  render(ctx){
    // background
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0,0,W,H);

    // subtle vignette
    ctx.globalAlpha = 0.9;
    const g = ctx.createRadialGradient(W*0.5,H*0.45, 40, W*0.5,H*0.45, Math.max(W,H)*0.75);
    g.addColorStop(0, 'rgba(90,110,160,0.20)');
    g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);
    ctx.globalAlpha = 1;

    // bubbles
    for(const b of this.bubbles){
      ctx.beginPath();
      ctx.arc(b.x,b.y,b.r,0,TAU);
      ctx.strokeStyle = b.type==='gold' ? 'rgba(255,230,140,0.95)' : 'rgba(190,220,255,0.82)';
      ctx.lineWidth = b.type==='gold' ? 3 : 2;
      ctx.stroke();

      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(b.x - b.r*0.25, b.y - b.r*0.25, b.r*0.55, 0, TAU);
      ctx.fillStyle = b.type==='gold' ? 'rgba(255,230,140,1)' : 'rgba(190,220,255,1)';
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // rope
    const pts = this.rope.points;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for(let i=1;i<pts.length;i++){
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    const sp = clamp(input.speed / 1200, 0, 1);
    ctx.strokeStyle = `rgba(${Math.floor(140+70*sp)}, ${Math.floor(210+25*sp)}, 255, 0.9)`;
    ctx.lineWidth = 7 + sp*5;
    ctx.stroke();

    // tip glow
    const tip = this.rope.tip();
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 10 + sp*14, 0, TAU);
    ctx.fillStyle = 'rgba(200,240,255,0.25)';
    ctx.fill();
    ctx.globalAlpha = 1;

    // particles
    this.fx.render(ctx, (ctx,q,t)=>{
      ctx.fillStyle = `rgba(220,245,255,1)`;
    });

    // hand
    drawHand(ctx);
  }
  hint(){
    if (this.phase === 0) return "Phase 1: fling gently and sharply; feel the ribbon trail.";
    if (this.phase === 1) return "Phase 2: pop bubbles by brushing them with the ribbon.";
    return "Phase 3: gold bubbles prefer a SNAP (flick then stop).";
  }
}

class ShuffleSwoosh extends Mode{
  constructor(){
    super('shuffle', 'Shuffle Swoosh', 'Shuffleboard/curling vibe. Your “hand” is a puck‑pusher. Flick into discs to send them sliding into scoring rings.');
    this.pucks = [];
    this.pegs = [];
    this.fx = new ParticleSystem();
    this.spawnCooldown = 0;
  }
  onEnter(){
    super.onEnter();
    this.pucks = [];
    this.pegs = [];
    this.fx = new ParticleSystem();
    this.spawnCooldown = 0;
  }
  setupPhase(){
    // rebuild pegs based on phase
    this.pegs = [];
    if (this.phase === 0) return;

    const n = this.phase === 1 ? 10 : 16;
    for(let i=0;i<n;i++){
      this.pegs.push({
        x: rand(W*0.15, W*0.85),
        y: rand(H*0.25, H*0.78),
        r: rand(10, 16),
      });
    }
  }
  update(dt){
    this.t += dt;
    this.phase = this.t < 10 ? 0 : (this.t < 30 ? 1 : 2);
    if (Math.abs(this.t - 10) < dt || Math.abs(this.t - 30) < dt){
      this.setupPhase();
    }

    // spawn puck if needed
    this.spawnCooldown = Math.max(0, this.spawnCooldown - dt);
    if (this.pucks.length === 0 && this.spawnCooldown <= 0){
      this.pucks.push({
        x: W*0.5 + rand(-W*0.12, W*0.12),
        y: H*0.86,
        vx: 0,
        vy: 0,
        r: 16,
        settled: false,
      });
    }

    const friction = Math.exp(-dt*1.8);

    // update pucks
    for(const p of this.pucks){
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= friction;
      p.vy *= friction;

      // walls
      if (p.x < p.r){ p.x = p.r; p.vx *= -0.6; }
      if (p.x > W - p.r){ p.x = W - p.r; p.vx *= -0.6; }
      if (p.y < p.r){ p.y = p.r; p.vy *= -0.6; }
      if (p.y > H - p.r){ p.y = H - p.r; p.vy *= -0.6; }

      // pegs
      for(const peg of this.pegs){
        if (bounceCircle(p, peg.x, peg.y, peg.r, 0.9)){
          addShake(3);
        }
      }

      // scoring when settled near top
      const sp = Math.hypot(p.vx,p.vy);
      if (!p.settled && sp < 18 && p.y < H*0.28){
        p.settled = true;

        const cx = W*0.5, cy = H*0.16;
        const d = Math.hypot(p.x - cx, p.y - cy);
        let pts = 1;
        if (d < 30) pts = 12;
        else if (d < 70) pts = 7;
        else if (d < 120) pts = 4;
        else pts = 2;

        // Phase 2: moving gate bonus
        if (this.phase === 2){
          pts += 2;
        }

        this.score += pts;
        this.fx.burst(p.x, p.y, 20, 30, 220, 0.25, 0.7, 1.0, 2.6);
        addHitstop(25);
        addShake(6);

        // remove puck after a moment (convert to fx)
        this.spawnCooldown = 0.35;
      }
    }

    // remove settled pucks after scoring or after they stop
    this.pucks = this.pucks.filter(p => !p.settled);

    // Phase 2: moving gate nudges puck path (invisible wind)
    if (this.phase === 2 && this.pucks.length){
      const p = this.pucks[0];
      const gateY = H*0.45 + Math.sin(this.t*1.1)*H*0.08;
      const gateX = W*0.5 + Math.cos(this.t*0.8)*W*0.18;
      const dx = p.x - gateX;
      const dy = p.y - gateY;
      const d2 = dx*dx + dy*dy;
      if (d2 < 120*120){
        const inv = 1 / (Math.sqrt(d2)+1);
        p.vx += dx * inv * 30 * dt;
        p.vy += dy * inv * 30 * dt;
      }
    }

    // Hand pushes puck (kinematic collision)
    const hr = 22;
    for(const p of this.pucks){
      const dx = p.x - hand.x;
      const dy = p.y - hand.y;
      const dist = Math.hypot(dx,dy) || 1;
      const minD = p.r + hr;
      if (dist < minD){
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minD - dist;
        p.x += nx * overlap;
        p.y += ny * overlap;

        // add impulse from hand velocity along normal
        const rel = (hand.vx - p.vx)*nx + (hand.vy - p.vy)*ny;
        if (rel > 0){
          const k = 0.92;
          p.vx += nx * rel * k;
          p.vy += ny * rel * k;
          addShake(2);
        }
      }
    }

    this.fx.update(dt);
  }
  render(ctx){
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0,0,W,H);

    // board lane
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(W*0.12, H*0.06, W*0.76, H*0.90);

    // scoring rings
    const cx = W*0.5, cy = H*0.16;
    const rings = [120, 70, 30];
    for(let i=0;i<rings.length;i++){
      ctx.beginPath();
      ctx.arc(cx, cy, rings[i], 0, TAU);
      ctx.strokeStyle = 'rgba(200,240,255,0.24)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, TAU);
    ctx.fillStyle = 'rgba(200,240,255,0.75)';
    ctx.fill();

    // pegs
    for(const peg of this.pegs){
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.r, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,220,255,0.18)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // moving gate indicator (phase2)
    if (this.phase === 2){
      const gateY = H*0.45 + Math.sin(this.t*1.1)*H*0.08;
      const gateX = W*0.5 + Math.cos(this.t*0.8)*W*0.18;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(gateX, gateY, 120, 0, TAU);
      ctx.strokeStyle = 'rgba(167,139,250,0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // puck(s)
    for(const p of this.pucks){
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,TAU);
      ctx.fillStyle = 'rgba(190,220,255,0.38)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,220,255,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // particles
    this.fx.render(ctx, (ctx,q,t)=>{ ctx.fillStyle = 'rgba(220,245,255,1)'; });

    // hand
    drawHand(ctx);
  }
  hint(){
    if (this.phase === 0) return "Phase 1: nudge a disc into the rings (no obstacles).";
    if (this.phase === 1) return "Phase 2: pegs! bank shots are fun.";
    return "Phase 3: a soft 'wind gate' stirs your path near mid-lane.";
  }
}

class BumperSurf extends Mode{
  constructor(){
    super('bumper', 'Bumper Surf', 'Pinball-ish bumper field. Keep the ball ricocheting and farm satisfying “bonk” chains.');
    this.ball = null;
    this.bumpers = [];
    this.fx = new ParticleSystem();
    this.drain = { x:0, y:0, r:34 };
  }
  onEnter(){
    super.onEnter();
    this.ball = {
      x: W*0.5,
      y: H*0.55,
      vx: rand(-220,220),
      vy: rand(-120,120),
      r: 14,
    };
    this.bumpers = [];
    this.fx = new ParticleSystem();
    this.drain = { x: W*0.5, y: H*0.92, r: 40 };
  }
  setupBumpers(){
    this.bumpers = [];
    const n = this.phase === 0 ? 6 : (this.phase === 1 ? 10 : 14);
    for(let i=0;i<n;i++){
      const ang = (i/n) * TAU;
      const rad = rand(Math.min(W,H)*0.12, Math.min(W,H)*0.32);
      this.bumpers.push({
        x: W*0.5 + Math.cos(ang)*rad + rand(-40,40),
        y: H*0.50 + Math.sin(ang)*rad + rand(-40,40),
        r: rand(18, 28),
        pulse: 0,
        phaseOff: rand(0,TAU),
      });
    }
  }
  update(dt){
    this.t += dt;
    this.phase = this.t < 12 ? 0 : (this.t < 32 ? 1 : 2);

    if (Math.abs(this.t - 0.02) < dt || Math.abs(this.t - 12) < dt || Math.abs(this.t - 32) < dt){
      this.setupBumpers();
    }

    const b = this.ball;

    // Phase 2: subtle moving bumpers
    if (this.phase === 2){
      for(const bu of this.bumpers){
        bu.x += Math.cos(this.t*0.8 + bu.phaseOff) * 20 * dt;
        bu.y += Math.sin(this.t*0.9 + bu.phaseOff) * 20 * dt;
      }
    }

    // integrate ball
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vx *= Math.exp(-dt*0.55);
    b.vy *= Math.exp(-dt*0.55);

    // walls
    if (b.x < b.r){ b.x = b.r; b.vx *= -0.95; addShake(2); }
    if (b.x > W - b.r){ b.x = W - b.r; b.vx *= -0.95; addShake(2); }
    if (b.y < b.r){ b.y = b.r; b.vy *= -0.95; addShake(2); }
    if (b.y > H - b.r){ b.y = H - b.r; b.vy *= -0.55; addShake(2); }

    // hand collision: the hand is a kinematic paddle
    const hr = 22;
    {
      const dx = b.x - hand.x;
      const dy = b.y - hand.y;
      const dist = Math.hypot(dx,dy) || 1;
      const minD = b.r + hr;
      if (dist < minD){
        const nx = dx / dist, ny = dy / dist;
        const overlap = minD - dist;
        b.x += nx * overlap;
        b.y += ny * overlap;
        const rel = (hand.vx - b.vx)*nx + (hand.vy - b.vy)*ny;
        if (rel > 0){
          b.vx += nx * rel * 0.95;
          b.vy += ny * rel * 0.95;
          addShake(4);
        }
      }
    }

    // bumpers
    for(const bu of this.bumpers){
      if (bounceCircle(b, bu.x, bu.y, bu.r, 1.10)){
        bu.pulse = 1;
        const sp = Math.hypot(b.vx,b.vy);
        // add a bit of "bumper energy"
        b.vx *= 1.02;
        b.vy *= 1.02;
        this.score += 1 + (sp > 260 ? 1 : 0);
        this.fx.burst(b.x, b.y, 10, 20, 160, 0.12, 0.35, 1.0, 2.2);
        addHitstop(16);
        addShake(6);
      }
      bu.pulse = Math.max(0, bu.pulse - dt*3.5);
    }

    // drain (not a fail: just a reset + little score sting)
    const dd = Math.hypot(b.x - this.drain.x, b.y - this.drain.y);
    if (dd < (this.drain.r + b.r)*0.88){
      // reset
      b.x = W*0.5;
      b.y = H*0.55;
      b.vx = rand(-240,240);
      b.vy = rand(-180,180);
      this.score = Math.max(0, this.score - 4);
      this.fx.burst(this.drain.x, this.drain.y, 22, 40, 220, 0.2, 0.65, 1.0, 2.4);
      addShake(10);
      addHitstop(25);
    }

    this.fx.update(dt);
  }
  render(ctx){
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0,0,W,H);

    // drain
    ctx.beginPath();
    ctx.arc(this.drain.x, this.drain.y, this.drain.r, 0, TAU);
    ctx.fillStyle = 'rgba(251,113,133,0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(251,113,133,0.25)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // bumpers
    for(const bu of this.bumpers){
      ctx.beginPath();
      ctx.arc(bu.x, bu.y, bu.r, 0, TAU);
      const pulse = bu.pulse;
      ctx.fillStyle = `rgba(125,211,252,${0.10 + 0.18*pulse})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(125,211,252,${0.22 + 0.48*pulse})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      if (pulse>0){
        ctx.globalAlpha = 0.22*pulse;
        ctx.beginPath();
        ctx.arc(bu.x, bu.y, bu.r+18, 0, TAU);
        ctx.strokeStyle = 'rgba(125,211,252,1)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // ball
    const b = this.ball;
    ctx.beginPath();
    ctx.arc(b.x,b.y,b.r,0,TAU);
    ctx.fillStyle = 'rgba(220,245,255,0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,245,255,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // fx
    this.fx.render(ctx, (ctx,q,t)=>{ ctx.fillStyle = 'rgba(220,245,255,1)'; });

    drawHand(ctx);
  }
  hint(){
    if (this.phase===0) return "Phase 1: bonk big bumpers. The drain just resets you.";
    if (this.phase===1) return "Phase 2: more bumpers: try chaining hits without touching drain.";
    return "Phase 3: bumpers drift a little—surf the chaos.";
  }
}

// Audio helper (optional; needs click gesture)
class SimpleSynth {
  constructor(){
    this.ctx = null;
    this.started = false;
    this.osc = null;
    this.gain = null;
    this.filt = null;
    this.noiseBuf = null;
    this.master = null;
  }
  ensure(){
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.65;
    this.master.connect(this.ctx.destination);

    this.filt = this.ctx.createBiquadFilter();
    this.filt.type = 'lowpass';
    this.filt.frequency.value = 1200;
    this.filt.Q.value = 0.6;
    this.filt.connect(this.master);

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.0001;
    this.gain.connect(this.filt);

    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sine';
    this.osc.frequency.value = 220;
    this.osc.connect(this.gain);
    this.osc.start();

    // noise buffer for percussion
    const n = this.ctx.sampleRate * 0.3;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<n;i++){
      data[i] = (Math.random()*2-1) * Math.pow(1 - i/n, 2);
    }
    this.noiseBuf = buf;
  }
  start(){
    this.ensure();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended'){
      this.ctx.resume();
    }
    this.started = true;
    return true;
  }
  setTone(freq, amp, brightness){
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const f = clamp(freq, 70, 1400);
    this.osc.frequency.setTargetAtTime(f, t, 0.015);
    const a = clamp(amp, 0, 1);
    this.gain.gain.setTargetAtTime(0.0001 + a*0.25, t, 0.02);
    this.filt.frequency.setTargetAtTime(400 + brightness*2600, t, 0.03);
  }
  drum(strength){
    if (!this.started || !this.noiseBuf) return;
    const t = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 + strength*0.18, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 180 + strength*520;
    f.Q.value = 0.8 + strength*3;

    src.connect(f);
    f.connect(g);
    g.connect(this.master);

    src.start(t);
    src.stop(t + 0.22);
  }
}

class MotionMusic extends Mode{
  constructor(){
    super('music', 'Motion Music', 'A motion instrument. Speed changes pitch; sharp stops trigger a drum hit; circular motion warms the tone.');
    this.trail = [];
    this.synth = new SimpleSynth();
    this.visualPulse = 0;
  }
  onEnter(){
    super.onEnter();
    this.trail = [];
    this.visualPulse = 0;
  }
  update(dt){
    this.t += dt;
    this.phase = this.t < 12 ? 0 : (this.t < 32 ? 1 : 2);

    // record trail
    this.trail.push({x: hand.x, y: hand.y, t: this.t});
    while(this.trail.length > 180){
      this.trail.shift();
    }

    // mapping
    const sp = Math.hypot(hand.vx, hand.vy);
    const freq = 120 + sp * 0.35;
    const amp = clamp((sp - 30) / 900, 0, 1);
    const brightness = clamp(sp / 900, 0, 1);

    // "circularity" proxy: use sign of change in velocity direction
    const v = norm(hand.vx, hand.vy);
    const pv = norm(input.lastVelX, input.lastVelY);
    const cross = pv.x * v.y - pv.y * v.x;
    const cir = clamp(Math.abs(cross), 0, 1);

    const bright2 = this.phase < 2 ? brightness : clamp(brightness + cir*0.4, 0, 1);
    this.synth.setTone(freq, amp, bright2);

    if (this.phase >= 1 && events.stop){
      const s = events.stopStrength;
      this.synth.drum(s);
      this.visualPulse = Math.max(this.visualPulse, 0.7 + 0.6*s);
      this.score += 1;
      addHitstop(12);
    }

    this.visualPulse = Math.max(0, this.visualPulse - dt*2.2);
  }
  render(ctx){
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0,0,W,H);

    // Trail ribbon
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for(let i=0;i<this.trail.length;i++){
      const p = this.trail[i];
      if (i===0) ctx.moveTo(p.x,p.y);
      else ctx.lineTo(p.x,p.y);
    }
    ctx.strokeStyle = 'rgba(125,211,252,0.55)';
    ctx.lineWidth = 2 + this.visualPulse*4;
    ctx.stroke();

    // Pulses on stop
    if (this.visualPulse > 0.01){
      ctx.globalAlpha = 0.25 * this.visualPulse;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, 40 + this.visualPulse*120, 0, TAU);
      ctx.strokeStyle = 'rgba(167,139,250,1)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // "Meters" (visual only)
    const sp = Math.hypot(hand.vx, hand.vy);
    const freq = 120 + sp * 0.35;
    const barW = Math.min(520, W*0.42);
    const x0 = W - barW - 18;
    const y0 = 120;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x0, y0, barW, 12);
    ctx.fillStyle = 'rgba(125,211,252,0.55)';
    ctx.fillRect(x0, y0, barW * clamp((freq-120)/1200, 0, 1), 12);
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(233,238,246,0.82)';
    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.fillText('Pitch', x0, y0 - 6);

    ctx.fillStyle = 'rgba(159,176,198,0.95)';
    ctx.fillText(this.synth.started ? 'Sound: on' : 'Sound: click canvas to enable', x0, y0 + 28);

    drawHand(ctx);
  }
  hint(){
    if (this.phase===0) return "Phase 1: speed makes pitch. (Optional) click canvas to enable sound.";
    if (this.phase===1) return "Phase 2: sharp stops add drum hits. Try flick → stop.";
    return "Phase 3: try circles—tone gets brighter.";
  }
}

class MagnetGarden extends Mode{
  constructor(){
    super('magnet', 'Magnet Garden', 'Iron filings in a magnetic field. Your motion drags a magnet; fast flicks create whirlpools.');
    this.filings = [];
    this.obstacles = [];
    this.fade = 0.10;
  }
  onEnter(){
    super.onEnter();
    const n = 2200;
    this.filings = [];
    for(let i=0;i<n;i++){
      this.filings.push({
        x: rand(0,W),
        y: rand(0,H),
        vx: rand(-8,8),
        vy: rand(-8,8),
        ox: 0,
        oy: 0,
      });
    }
    this.obstacles = [];
    this.fade = 0.09;
  }
  setupObstacles(){
    this.obstacles = [];
    const n = this.phase === 2 ? 5 : 0;
    for(let i=0;i<n;i++){
      this.obstacles.push({
        x: rand(W*0.2, W*0.8),
        y: rand(H*0.2, H*0.8),
        r: rand(40, 80),
      });
    }
  }
  update(dt){
    this.t += dt;
    this.phase = this.t < 12 ? 0 : (this.t < 32 ? 1 : 2);
    if (Math.abs(this.t - 32) < dt){
      this.setupObstacles();
    }

    const sp = Math.hypot(hand.vx, hand.vy);
    const strength = 220 + sp*0.8;
    const swirl = 0.12 + clamp(sp/900, 0, 1)*0.65;

    // Repulsor follows behind hand in phase 2+
    const rx = hand.x - hand.vx*0.035;
    const ry = hand.y - hand.vy*0.035;

    for(const f of this.filings){
      f.ox = f.x; f.oy = f.y;

      // Attraction to main magnet
      let dx = hand.x - f.x;
      let dy = hand.y - f.y;
      const d2 = dx*dx + dy*dy + 80;
      const inv = 1 / Math.sqrt(d2);
      const fx = dx * inv * (strength / d2);
      const fy = dy * inv * (strength / d2);

      // Swirl around the magnet based on hand motion
      const px = -dy * inv * swirl * (strength / d2) * 120;
      const py =  dx * inv * swirl * (strength / d2) * 120;

      f.vx += (fx + px) * dt;
      f.vy += (fy + py) * dt;

      if (this.phase >= 1){
        // tiny inertia trails: slight attraction to recent path (repulsor acts as second pole)
        let dx2 = f.x - rx;
        let dy2 = f.y - ry;
        const d22 = dx2*dx2 + dy2*dy2 + 140;
        const inv2 = 1 / Math.sqrt(d22);
        const rep = 150 * (0.25 + clamp(sp/1200, 0, 1));
        f.vx += dx2 * inv2 * (rep / d22) * dt;
        f.vy += dy2 * inv2 * (rep / d22) * dt;
      }

      // Obstacles: keep-out zones
      for(const o of this.obstacles){
        const odx = f.x - o.x;
        const ody = f.y - o.y;
        const od = Math.hypot(odx,ody) || 1;
        if (od < o.r){
          const nx = odx/od, ny = ody/od;
          const push = (o.r - od) * 0.9;
          f.vx += nx * push * dt * 10;
          f.vy += ny * push * dt * 10;
        }
      }

      // Damping + movement
      f.vx *= Math.exp(-dt*2.0);
      f.vy *= Math.exp(-dt*2.0);
      f.x += f.vx;
      f.y += f.vy;

      // wrap
      if (f.x < 0) f.x += W;
      if (f.x > W) f.x -= W;
      if (f.y < 0) f.y += H;
      if (f.y > H) f.y -= H;
    }

    // score as "flow": how much speed you're generating
    this.score += (sp > 600 ? 1 : 0) * dt * 2;
  }
  render(ctx){
    // fade to leave trails
    ctx.globalAlpha = this.fade;
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0,0,W,H);
    ctx.globalAlpha = 1;

    // obstacles
    for(const o of this.obstacles){
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(o.x,o.y,o.r,0,TAU);
      ctx.strokeStyle = 'rgba(251,113,133,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // draw filings as tiny streaks
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = 'rgba(200,240,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(const f of this.filings){
      ctx.moveTo(f.ox, f.oy);
      ctx.lineTo(f.x, f.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // draw magnet glow
    const sp = Math.hypot(hand.vx, hand.vy);
    const glow = clamp(sp/900, 0, 1);
    ctx.globalAlpha = 0.25 + glow*0.25;
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 30 + glow*80, 0, TAU);
    ctx.fillStyle = 'rgba(125,211,252,0.35)';
    ctx.fill();
    ctx.globalAlpha = 1;

    drawHand(ctx);
  }
  hint(){
    if (this.phase===0) return "Phase 1: drag the magnet—watch filings align and swirl.";
    if (this.phase===1) return "Phase 2: a second pole adds more interesting eddies.";
    return "Phase 3: avoid zones appear—flow around them.";
  }
}

class FlockHerd extends Mode{
  constructor(){
    super('flock', 'Flock Herd', 'A playful flock. Move slowly to “gather,” flick fast to “scatter.” Try guiding the flock into the goal ring.');
    this.boids = [];
    this.fx = new ParticleSystem();
    this.goal = {x:0,y:0,r:80, t:0};
    this.pred = null;
  }
  onEnter(){
    super.onEnter();
    const n = 70;
    this.boids = [];
    for(let i=0;i<n;i++){
      this.boids.push({
        x: rand(0,W),
        y: rand(0,H),
        vx: rand(-60,60),
        vy: rand(-60,60),
      });
    }
    this.fx = new ParticleSystem();
    this.goal = { x: rand(W*0.2, W*0.8), y: rand(H*0.2, H*0.65), r: 80, t: 0 };
    this.pred = null;
  }
  update(dt){
    this.t += dt;
    this.phase = this.t < 12 ? 0 : (this.t < 32 ? 1 : 2);

    if (this.phase===2 && !this.pred){
      this.pred = { x: rand(0,W), y: rand(0,H*0.6), vx: 0, vy: 0 };
    }

    const neighR = 72;
    const sepR = 26;
    const maxSp = 160;
    const maxForce = 120;

    const spHand = Math.hypot(hand.vx, hand.vy);
    const scare = clamp((spHand - 260)/900, 0, 1);
    const attract = 1 - clamp((spHand - 80)/260, 0, 1); // slow -> attract

    // update predator (simple chase)
    if (this.pred){
      // chase nearest boid
      let best = null;
      let bestD2 = 1e18;
      for(const b of this.boids){
        const d2 = len2(b.x - this.pred.x, b.y - this.pred.y);
        if (d2 < bestD2){ bestD2 = d2; best = b; }
      }
      if (best){
        const dx = best.x - this.pred.x;
        const dy = best.y - this.pred.y;
        const v = norm(dx,dy);
        // predator avoids the hand (gives player a “tool”)
        const hx = this.pred.x - hand.x;
        const hy = this.pred.y - hand.y;
        const hd2 = hx*hx + hy*hy + 1;
        const avoid = 4500 / hd2;
        const av = norm(hx,hy);
        this.pred.vx += (v.x*70 + av.x*avoid) * dt;
        this.pred.vy += (v.y*70 + av.y*avoid) * dt;
      }
      this.pred.vx *= Math.exp(-dt*1.8);
      this.pred.vy *= Math.exp(-dt*1.8);
      this.pred.x += this.pred.vx * dt;
      this.pred.y += this.pred.vy * dt;
      // wrap
      if (this.pred.x < 0) this.pred.x += W;
      if (this.pred.x > W) this.pred.x -= W;
      if (this.pred.y < 0) this.pred.y += H;
      if (this.pred.y > H) this.pred.y -= H;
    }

    // boids
    for(let i=0;i<this.boids.length;i++){
      const b = this.boids[i];

      let ax = 0, ay = 0;
      let cx = 0, cy = 0;
      let vx = 0, vy = 0;
      let count = 0;

      // predator avoidance
      if (this.pred){
        const dxp = b.x - this.pred.x;
        const dyp = b.y - this.pred.y;
        const d2p = dxp*dxp + dyp*dyp;
        if (d2p < 140*140){
          const v = norm(dxp,dyp);
          ax += v.x * 220;
          ay += v.y * 220;
        }
      }

      // neighbors
      for(let j=0;j<this.boids.length;j++){
        if (j===i) continue;
        const o = this.boids[j];
        const dx = o.x - b.x;
        const dy = o.y - b.y;
        const d2 = dx*dx + dy*dy;
        if (d2 < neighR*neighR){
          count++;
          cx += o.x; cy += o.y;
          vx += o.vx; vy += o.vy;

          // separation
          if (d2 < sepR*sepR){
            const inv = 1 / (Math.sqrt(d2)+1);
            ax -= dx * inv * 120;
            ay -= dy * inv * 120;
          }
        }
      }

      if (count > 0){
        cx /= count; cy /= count;
        vx /= count; vy /= count;

        // cohesion
        ax += (cx - b.x) * 0.65;
        ay += (cy - b.y) * 0.65;

        // alignment
        ax += (vx - b.vx) * 0.45;
        ay += (vy - b.vy) * 0.45;
      }

      // hand influence: fast scares, slow attracts
      const dxh = b.x - hand.x;
      const dyh = b.y - hand.y;
      const d2h = dxh*dxh + dyh*dyh + 1;

      if (d2h < 200*200){
        const v = norm(dxh,dyh);
        ax += v.x * (scare*320 - attract*80);
        ay += v.y * (scare*320 - attract*80);
      }

      // steer limit
      const aMag = Math.hypot(ax,ay);
      if (aMag > maxForce){
        ax = ax / aMag * maxForce;
        ay = ay / aMag * maxForce;
      }

      // integrate
      b.vx += ax * dt;
      b.vy += ay * dt;

      // speed limit
      const sp = Math.hypot(b.vx,b.vy);
      const spLim = maxSp * (0.75 + scare*0.5);
      if (sp > spLim){
        b.vx = b.vx / sp * spLim;
        b.vy = b.vy / sp * spLim;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // wrap
      if (b.x < 0) b.x += W;
      if (b.x > W) b.x -= W;
      if (b.y < 0) b.y += H;
      if (b.y > H) b.y -= H;

      // goal ring scoring (phase>=1)
      if (this.phase >= 1){
        const dg = Math.hypot(b.x - this.goal.x, b.y - this.goal.y);
        if (dg < this.goal.r){
          this.score += dt * 0.8;
          if (Math.random() < 0.03){
            this.fx.burst(b.x, b.y, 3, 10, 60, 0.12, 0.25, 1.0, 2.0);
          }
        }
      }
    }

    // reposition goal if enough "presence"
    this.goal.t += dt;
    if (this.goal.t > 6.5 && this.phase >= 1){
      this.goal.t = 0;
      this.goal.x = rand(W*0.18, W*0.82);
      this.goal.y = rand(H*0.18, H*0.65);
      addShake(4);
    }

    this.fx.update(dt);
  }
  render(ctx){
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0,0,W,H);

    // goal ring
    if (this.phase >= 1){
      ctx.globalAlpha = 0.32;
      ctx.beginPath();
      ctx.arc(this.goal.x, this.goal.y, this.goal.r, 0, TAU);
      ctx.strokeStyle = 'rgba(52,211,153,1)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // boids
    for(const b of this.boids){
      const a = Math.atan2(b.vy, b.vx);
      const sz = 6;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(sz, 0);
      ctx.lineTo(-sz*0.8, sz*0.55);
      ctx.lineTo(-sz*0.8, -sz*0.55);
      ctx.closePath();
      ctx.fillStyle = 'rgba(200,240,255,0.70)';
      ctx.fill();
      ctx.restore();
    }

    // predator
    if (this.pred){
      const a = Math.atan2(this.pred.vy, this.pred.vx);
      ctx.save();
      ctx.translate(this.pred.x, this.pred.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-9, 8);
      ctx.lineTo(-9, -8);
      ctx.closePath();
      ctx.fillStyle = 'rgba(251,113,133,0.75)';
      ctx.fill();
      ctx.restore();
    }

    // particles
    this.fx.render(ctx, (ctx,q,t)=>{ ctx.fillStyle = 'rgba(52,211,153,1)'; });

    drawHand(ctx);
  }
  hint(){
    if (this.phase===0) return "Phase 1: move slowly to gather, flick fast to scatter.";
    if (this.phase===1) return "Phase 2: guide the flock into the green ring.";
    return "Phase 3: a predator appears—your fast flicks scare it away.";
  }
}

class SpinArt extends Mode{
  constructor(){
    super('spin', 'Spin Art', 'A centrifugal paint toy. Circle around the center to build spin; flicks splatter; sharp stops make a big splat.');
    this.paint = [];
    this.angle = 0;
    this.angVel = 0;
    this.paintFade = 0.06;
    this.paintCanvas = document.createElement('canvas');
    this.paintCtx = this.paintCanvas.getContext('2d', { alpha: true });
  }
  onEnter(){
    super.onEnter();
    this.paint = [];
    this.angle = 0;
    this.angVel = 0;
    this.paintFade = 0.05;

    this.paintCanvas.width = Math.floor(W * DPR);
    this.paintCanvas.height = Math.floor(H * DPR);
    this.paintCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // clear
    this.paintCtx.clearRect(0,0,W,H);
  }
  update(dt){
    this.t += dt;
    this.phase = this.t < 12 ? 0 : (this.t < 32 ? 1 : 2);

    const cx = W*0.5, cy = H*0.52;
    const rx = hand.x - cx;
    const ry = hand.y - cy;

    // torque from circular motion: cross(r, v)
    const torque = (rx * hand.vy - ry * hand.vx) / (Math.hypot(rx,ry)+40);
    this.angVel += torque * dt * 0.016;

    // angular damping
    this.angVel *= Math.exp(-dt*0.65);
    this.angle += this.angVel * dt;

    const spin = Math.abs(this.angVel);

    // emit paint when moving fast or spinning
    const sp = Math.hypot(hand.vx, hand.vy);
    const emit = clamp((sp - 90)/900, 0, 1) + clamp(spin*60, 0, 1)*0.35;

    const drops = Math.floor(emit * (this.phase===0 ? 2 : 4));
    for(let i=0;i<drops;i++){
      const a = Math.atan2(ry, rx) + rand(-0.2,0.2);
      const r = clamp(Math.hypot(rx,ry), 0, Math.min(W,H)*0.46);
      const tx = cx + Math.cos(a) * r;
      const ty = cy + Math.sin(a) * r;

      // tangential fling from spin
      const tang = this.angVel * r * 0.9;
      const vx = -Math.sin(a) * tang + hand.vx*0.22 + rand(-30,30);
      const vy =  Math.cos(a) * tang + hand.vy*0.22 + rand(-30,30);

      this.paint.push({
        x: tx,
        y: ty,
        vx, vy,
        life: rand(0.6, 1.8),
        maxLife: 0,
        size: rand(1.2, 3.2) + emit*2.2,
      });
    }
    // set maxLife for new drops
    const n = this.paint.length;
    for(let i=n-drops;i<n;i++){
      if (i>=0) this.paint[i].maxLife = this.paint[i].life;
    }

    // stop event -> splat
    if (events.stop){
      const s = events.stopStrength;
      for(let k=0;k<14;k++){
        const a = rand(0,TAU);
        const sp2 = rand(40, 260) * (0.5 + s);
        this.paint.push({
          x: hand.x,
          y: hand.y,
          vx: Math.cos(a)*sp2,
          vy: Math.sin(a)*sp2,
          life: rand(0.4, 1.2),
          maxLife: 0,
          size: rand(2.2, 6.8) * (0.7 + s),
        });
      }
      const n2 = this.paint.length;
      for(let i=n2-14;i<n2;i++) this.paint[i].maxLife = this.paint[i].life;
      this.score += 2;
      addShake(6);
      addHitstop(18);
    }

    // update paint particles
    for(const p of this.paint){
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt*0.7);
      p.vy *= Math.exp(-dt*0.7);
      p.life -= dt;
    }
    this.paint = this.paint.filter(p => p.life > 0);

    // score as "art density"
    this.score += emit * dt;
  }
  render(ctx){
    // Paint layer persists on its own canvas
    const pc = this.paintCtx;

    // gentle fade on paint canvas
    pc.globalAlpha = this.paintFade;
    pc.fillStyle = '#0b0f14';
    pc.fillRect(0,0,W,H);
    pc.globalAlpha = 1;

    // draw new paint
    pc.globalCompositeOperation = 'lighter';
    for(const p of this.paint){
      const t = clamp(p.life / (p.maxLife||1), 0, 1);
      const a = t*t;
      pc.globalAlpha = a * 0.9;

      // color shifts with spin and position (simple HSL)
      const hue = ( (this.angle*40) + (p.x/W)*120 + (p.y/H)*60 ) % 360;
      pc.fillStyle = `hsla(${hue}, 90%, 70%, 1)`;

      pc.beginPath();
      pc.arc(p.x, p.y, p.size, 0, TAU);
      pc.fill();
    }
    pc.globalAlpha = 1;
    pc.globalCompositeOperation = 'source-over';

    // compose
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0,0,W,H);
    ctx.drawImage(this.paintCanvas, 0, 0, W, H);

    // disc guide
    const cx = W*0.5, cy = H*0.52;
    const r = Math.min(W,H)*0.46;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(cx,cy,r,0,TAU);
    ctx.strokeStyle = 'rgba(200,240,255,1)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // spin indicator
    const spin = Math.abs(this.angVel);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(cx, cy, 10 + clamp(spin*120,0,30), 0, TAU);
    ctx.fillStyle = 'rgba(125,211,252,0.25)';
    ctx.fill();
    ctx.globalAlpha = 1;

    drawHand(ctx);
  }
  hint(){
    if (this.phase===0) return "Phase 1: circle around center to build spin.";
    if (this.phase===1) return "Phase 2: flicks splatter more paint.";
    return "Phase 3: sharp stops make big splats. Keep it flowy.";
  }
}

class KiteStreamer extends Mode{
  constructor(){
    super('kite', 'Kite Streamer', 'A kite on a tether. Flick to swoop; the tail trails. Ride gusts and thread rings.');
    this.kite = null;
    this.tail = new Rope(26, 10);
    this.ring = {x:0,y:0,r:40};
    this.fx = new ParticleSystem();
    this.wind = {x: 40, y: 0, t: 0};
  }
  onEnter(){
    super.onEnter();
    this.kite = { x: W*0.5, y: H*0.4, vx: 0, vy: 0 };
    this.tail = new Rope(26, 10);
    this.tail.reset(this.kite.x, this.kite.y);
    this.ring = { x: rand(W*0.2, W*0.8), y: rand(H*0.18, H*0.65), r: 46 };
    this.fx = new ParticleSystem();
    this.wind = { x: 40, y: 0, t: 0 };
  }
  update(dt){
    this.t += dt;
    this.phase = this.t < 12 ? 0 : (this.t < 32 ? 1 : 2);

    // wind slowly changes
    this.wind.t += dt;
    const wx = 50 + Math.sin(this.wind.t*0.6)*40 + Math.cos(this.wind.t*0.17)*30;
    const wy = Math.cos(this.wind.t*0.5)*18;
    this.wind.x = wx;
    this.wind.y = wy;

    const k = this.kite;

    // Spring tether to the hand
    const L = 160;
    const dx = hand.x - k.x;
    const dy = hand.y - k.y;
    const dist = Math.hypot(dx,dy) || 1;
    const nx = dx/dist, ny = dy/dist;
    const stretch = dist - L;

    // spring force + damping
    const springK = 6.2;
    const damp = 2.6;
    const fx = nx * stretch * springK - k.vx * damp;
    const fy = ny * stretch * springK - k.vy * damp;

    // wind / lift
    const rvx = this.wind.x - k.vx;
    const rvy = this.wind.y - k.vy;
    const relSp = Math.hypot(rvx,rvy) || 1;
    // lift perpendicular to relative wind (simple)
    const lift = 0.12 + clamp(relSp/220, 0, 1)*0.35;
    const lx = -rvy / relSp * relSp * lift;
    const ly =  rvx / relSp * relSp * lift;

    k.vx += (fx + lx) * dt;
    k.vy += (fy + ly) * dt;

    // clamp
    k.vx *= Math.exp(-dt*0.30);
    k.vy *= Math.exp(-dt*0.30);

    k.x += k.vx * dt;
    k.y += k.vy * dt;

    // bounds (soft)
    k.x = clamp(k.x, 20, W-20);
    k.y = clamp(k.y, 20, H-20);

    // tail follows kite
    this.tail.setHead(k.x, k.y);
    this.tail.update(dt, 10, 0.992);

    // rings appear in phase >=1
    if (this.phase >= 1){
      const dr = Math.hypot(k.x - this.ring.x, k.y - this.ring.y);
      if (dr < this.ring.r){
        this.score += 6;
        this.fx.burst(this.ring.x, this.ring.y, 22, 40, 220, 0.2, 0.65, 1.0, 2.4);
        addShake(8);
        addHitstop(22);
        // move ring
        this.ring.x = rand(W*0.15, W*0.85);
        this.ring.y = rand(H*0.15, H*0.70);
      }
    }

    // gust zones (phase 2)
    if (this.phase === 2){
      const gx = W*0.5 + Math.sin(this.t*0.6)*W*0.22;
      const gy = H*0.48 + Math.cos(this.t*0.7)*H*0.18;
      const gd = Math.hypot(k.x - gx, k.y - gy);
      if (gd < 120){
        const v = norm(k.x - gx, k.y - gy);
        k.vx += v.x * 40 * dt;
        k.vy += v.y * 40 * dt;
      }
    }

    this.fx.update(dt);
  }
  render(ctx){
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0,0,W,H);

    // sky-ish gradient
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0, 'rgba(20,30,50,1)');
    g.addColorStop(1, 'rgba(10,12,16,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // wind indicators
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.moveTo(26, 110);
    ctx.lineTo(26 + this.wind.x*0.9, 110 + this.wind.y*0.9);
    ctx.strokeStyle = 'rgba(125,211,252,1)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ring
    if (this.phase >= 1){
      ctx.globalAlpha = 0.36;
      ctx.beginPath();
      ctx.arc(this.ring.x, this.ring.y, this.ring.r, 0, TAU);
      ctx.strokeStyle = 'rgba(52,211,153,1)';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // gust zone (phase2)
    if (this.phase === 2){
      const gx = W*0.5 + Math.sin(this.t*0.6)*W*0.22;
      const gy = H*0.48 + Math.cos(this.t*0.7)*H*0.18;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(gx, gy, 120, 0, TAU);
      ctx.strokeStyle = 'rgba(167,139,250,1)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // tether line to hand
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(hand.x, hand.y);
    ctx.lineTo(this.kite.x, this.kite.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // tail rope
    const pts = this.tail.points;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for(let i=1;i<pts.length;i++){
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    const sp = clamp(input.speed / 1200, 0, 1);
    ctx.strokeStyle = `rgba(200,240,255,${0.55 + sp*0.35})`;
    ctx.lineWidth = 5 + sp*3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // kite body (diamond)
    const k = this.kite;
    const a = Math.atan2(k.vy - this.wind.y, k.vx - this.wind.x) + Math.PI/2;
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(14, 0);
    ctx.lineTo(0, 18);
    ctx.lineTo(-14, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(125,211,252,0.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(125,211,252,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // fx
    this.fx.render(ctx, (ctx,q,t)=>{ ctx.fillStyle = 'rgba(52,211,153,1)'; });

    drawHand(ctx);
  }
  hint(){
    if (this.phase===0) return "Phase 1: flick to swoop; the tether + tail will follow.";
    if (this.phase===1) return "Phase 2: thread the green rings.";
    return "Phase 3: gust zones appear (purple). Surf them.";
  }
}

// ---------------------------------------------
// Mode registry + UI
// ---------------------------------------------
const MODE_LIST = [
  new RibbonPop(),
  new ShuffleSwoosh(),
  new BumperSurf(),
  new MotionMusic(),
  new MagnetGarden(),
  new FlockHerd(),
  new SpinArt(),
  new KiteStreamer(),
];

let active = MODE_LIST[0];

function setMode(key){
  const next = MODE_LIST.find(m => m.key === key) || MODE_LIST[0];
  if (next === active) return;
  active?.onExit?.();
  active = next;
  active.onEnter();
  updateModeUI();
}

function resetMode(){
  active.onEnter();
}

function buildModeButtons(){
  ui.modes.innerHTML = '';
  for(const m of MODE_LIST){
    const b = document.createElement('button');
    b.className = 'modeBtn';
    b.dataset.mode = m.key;
    b.innerHTML = `<span class="dot"></span><span>${m.name}</span><span class="tiny">(${m.key})</span>`;
    b.addEventListener('click', (e)=>{
      e.preventDefault();
      setMode(m.key);
    });

    // Dwell select (hover ~0.8s)
    let dwellTimer = null;
    b.addEventListener('mouseenter', ()=>{
      dwellTimer = setTimeout(()=> setMode(m.key), 800);
    });
    b.addEventListener('mouseleave', ()=>{
      if (dwellTimer) clearTimeout(dwellTimer);
      dwellTimer = null;
    });

    ui.modes.appendChild(b);
  }
}
buildModeButtons();

function updateModeUI(){
  // update active button
  for(const el of ui.modes.querySelectorAll('.modeBtn')){
    el.classList.toggle('active', el.dataset.mode === active.key);
  }
  ui.modeName.textContent = active.name;
  ui.modeDesc.textContent = active.desc;
  ui.modeHint.textContent = active.hint();
  ui.pillPhase.textContent = active.phaseLabel();
  ui.pillScore.textContent = `${Math.floor(active.score)}`;
}

updateModeUI();

// pointer lock controls
function lockPointer(){
  canvas.requestPointerLock?.();
}
function unlockPointer(){
  document.exitPointerLock?.();
}

ui.lockBtn.addEventListener('click', (e)=>{
  e.preventDefault();
  lockPointer();
});
ui.unlockBtn.addEventListener('click', (e)=>{
  e.preventDefault();
  unlockPointer();
});
document.addEventListener('pointerlockchange', ()=>{
  const locked = inPointerLock();
  ui.lockBtn.style.display = locked ? 'none' : 'inline-flex';
  ui.unlockBtn.style.display = locked ? 'inline-flex' : 'none';
});

// reset
ui.resetBtn.addEventListener('click', (e)=>{
  e.preventDefault();
  resetMode();
});

// Start overlay
function start(withLock){
  ui.overlay.style.display = 'none';
  resetMode();
  if (withLock){
    lockPointer();
  }
}
ui.startBtn.addEventListener('click', (e)=>{ e.preventDefault(); start(false); });
ui.startLockBtn.addEventListener('click', (e)=>{ e.preventDefault(); start(true); });

// Also allow 'motion-only' start: moving the pointer starts the toy.
ui.overlay.addEventListener('pointermove', ()=> start(false), { once: true });

// Audio enable for MotionMusic on canvas click (optional)
canvas.addEventListener('pointerdown', ()=>{
  if (active instanceof MotionMusic){
    active.synth.start();
  }
});

// ---------------------------------------------
// Render helpers
// ---------------------------------------------
function drawHand(ctx){
  // hand body
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.arc(hand.x, hand.y, hand.r, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // velocity hint
  const sp = Math.hypot(hand.vx, hand.vy);
  if (sp > 30){
    const v = norm(hand.vx, hand.vy);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(hand.x, hand.y);
    ctx.lineTo(hand.x + v.x * Math.min(60, sp*0.09), hand.y + v.y * Math.min(60, sp*0.09));
    ctx.strokeStyle = 'rgba(125,211,252,0.65)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------
// Main loop
// ---------------------------------------------
let lastT = now();
let fpsAcc = 0, fpsCount = 0, fpsLast = now();

function frame(){
  const t = now();
  let dt = (t - lastT) / 1000;
  lastT = t;

  // clamp dt
  dt = Math.max(0, Math.min(0.033, dt));

  // If we resized, rebuild mode-specific buffers in a safe way.
  if (resizePending){
    resizePending = false;
    // recenter hand & input (keeps things sane)
    hand.x = W*0.5; hand.y = H*0.5;
    hand.vx = 0; hand.vy = 0;
    input.x = hand.x; input.y = hand.y;
    input.dx = 0; input.dy = 0;
    input.lastClientX = null; input.lastClientY = null;

    // reset the current mode so internal buffers match new size
    try { active?.onEnter?.(); } catch(_e){}
    updateModeUI();
  }


  // global hitstop
  if (juice.hitstop > 0){
    // freeze simulation but keep a tiny dt for decay to avoid "stuck"
    updateJuice(dt);
    applyCamera();
    renderFrame(0);
    requestAnimationFrame(frame);
    return;
  }

  updateMotionEvents(dt);
  updateHand(dt);
  updateJuice(dt);

  // active update
  active.update(dt);

  // render
  applyCamera();
  renderFrame(dt);

  // reset frame deltas
  input.dx = 0;
  input.dy = 0;

  // fps
  fpsAcc += dt;
  fpsCount++;
  if (t - fpsLast > 500){
    const fps = Math.round(fpsCount / fpsAcc);
    ui.pillFps.textContent = `${fps} fps`;
    fpsAcc = 0;
    fpsCount = 0;
    fpsLast = t;
  }

  // UI
  updateModeUI();

  requestAnimationFrame(frame);
}

function renderFrame(dt){
  ctx.save();
  ctx.translate(juice.shakeX, juice.shakeY);

  active.render(ctx);

  ctx.restore();
}

// Start anim immediately (overlay blocks until start)
requestAnimationFrame(frame);

