// Gameplay video director. One continuous recorded run of real input in the
// IWER emulator; MARK() logs beat boundaries (seconds since video start) so
// scripts/edit-video.py can cut the dull parts and the clock jumps out.
const T = globalThis.T;
const g = T.god();
const d = T.d;
const marks = [];
const now = () => (Date.now() - (globalThis.__videoStartWall ?? Date.now())) / 1000;
const MARK = (name) => { marks.push({ name, t: +now().toFixed(2) }); console.log('[cap] mark', name); };
const ff = (sec) => { for (let i = 0; i < sec / 0.05; i++) g.update(0.05, 0); };
const wait = (s) => T.frames(Math.round(s * 60));
const centre = (i) => { const c = { x: 0, y: 0, z: 0 }; g.island.centreOf(i, c); return c; };
const nearestVillagerTo = (x, z) => { let b = 0, bd = 1e9; g.village.villagers.forEach((v, i) => { const dd = Math.hypot(v.x - x, v.z - z); if (dd < bd && v.state !== 11) { bd = dd; b = i; } }); return b; };

// --- camera: the player's head. Smoothly move position and aim. ---
const cam = { pos: [0, 1.6, 0], look: [0, 0, 0] };
function setHeadPos(p) { d.position.set(p[0], p[1], p[2]); }
const ZOOM = 0.35; // push every camera position this far toward what it looks at
async function camTo(pos, lookLocal, sec, ease = true) {
  const lw = T.toWorld(lookLocal[0], lookLocal[1], lookLocal[2]);
  pos = [pos[0] + (lw.x - pos[0]) * ZOOM, pos[1] + (lw.y - pos[1]) * ZOOM, pos[2] + (lw.z - pos[2]) * ZOOM];
  const p0 = [d.position.x, d.position.y, d.position.z];
  const n = Math.max(1, Math.round(sec * 60));
  for (let i = 1; i <= n; i++) {
    let k = i / n;
    if (ease) k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    setHeadPos([p0[0] + (pos[0] - p0[0]) * k, p0[1] + (pos[1] - p0[1]) * k, p0[2] + (pos[2] - p0[2]) * k]);
    T.lookAt(lookLocal[0], lookLocal[1], lookLocal[2]);
    await T.frames(1);
  }
}
const lookVillager = (id) => { const v = g.village.villagers[id]; if (v) T.lookAt(v.x, v.y + 0.022, v.z); };
async function holdGaze(id, sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { lookVillager(id); await T.frames(1); } }

try { localStorage.clear(); } catch {}

// ===== 1. Title page =====
HIDE_EMU();
MARK('title');
await wait(4.5);
MARK('enter');
REC.startAudio();
await T.enter(true);
HIDE_EMU();
// stage now sits 0.55 m ahead, 0.32 m below the initial head (0,1.6,0)
setHeadPos([0, 1.6, 0.05]);
T.head(-0.55, 0);
await wait(0.5);

// ===== 2. Establish: push in on the island =====
MARK('establish');
CAP('A TINY VILLAGE LIVES ON YOUR DESK.', 3500);
await camTo([0.0, 1.52, -0.18], [0, 0.0, 0], 4.5);
CAP('THEY ARE HUNGRY. THEY CUT THE FOREST.', 3500);
ff(25); // let them work (cut)
MARK('chop');
await camTo([0.12, 1.48, -0.24], [0.02, 0.0, -0.02], 3.5);

// ===== 3. Gaze witness =====
let stump = g.island.tiles.findIndex((t) => t.type === 3 && t.claimedBy < 0);
for (let k = 0; k < 8 && stump < 0; k++) { ff(8); stump = g.island.tiles.findIndex((t) => t.type === 3 && t.claimedBy < 0); }
if (stump < 0) { stump = g.island.index(8, 9); g.island.setType(stump, 3); }
const sc = centre(stump);
const wid = nearestVillagerTo(sc.x, sc.z);
MARK('gaze');
CAP('LOOK AT SOMEONE. NOW THEY ARE WATCHING YOU.', 3500);
await camTo([0.05, 1.5, -0.2], [g.village.villagers[wid].x, 0.02, g.village.villagers[wid].z], 1.5);
await holdGaze(wid, 2.0);
const w1 = g.witness;

// ===== 4. Plant a seed -> first law =====
MARK('plant');
CAP('PLANT A SEED IN FRONT OF THEM...', 3000);
await T.plant(stump, w1);
await holdGaze(w1, 0.5);
CAP('...AND IT BECOMES LAW.', 3500);
await camTo([0.0, 1.5, -0.16], [0, 0.08, -0.3], 1.6);
for (let i = 0; i < 40 && (g.pendingReading || g.chiselling); i++) await T.frames(8);
await wait(2.2);
MARK('replant');
ff(30);
CAP('FROM NOW ON, THEY REPLANT.', 3000);
await camTo([0.1, 1.48, -0.22], [0.0, 0.0, 0.0], 3);

// ===== 5. Rain on dust -> the misread =====
let dust = g.island.tiles.findIndex((t) => t.type === 4);
if (dust < 0) { g.forceDust(); dust = g.island.tiles.findIndex((t) => t.type === 4); }
const dc = centre(dust);
MARK('cloud');
CAP('WRING THE CLOUD OVER THE DUST...', 3500);
await camTo([0.06, 1.5, -0.16], [dc.x, 0.06, dc.z], 1.2);
const cp = g.cloud.pos.clone();
await T.pose('right', 'pinch');
await T.handAt('right', cp.x, cp.y, cp.z);
await T.pose('right', 'open');
await T.pose('right', 'pinch');
await T.glide('right', dc.x, 0.15, dc.z, 30);
await T.pose('right', 'open', 4);
const w2 = nearestVillagerTo(dc.x, dc.z);
await holdGaze(w2, 0.8);
await T.handAt('right', g.cloud.pos.x, g.cloud.pos.y, g.cloud.pos.z, 'palm');
await T.pose('right', 'fist', 4);
await holdGaze(w2, 2.2);
await T.pose('right', 'open', 4);
CAP('...BUT A THIRD OF THE TIME, THEY GET IT SLIGHTLY WRONG.', 4500);
await camTo([0.0, 1.5, -0.16], [0, 0.08, -0.3], 1.4);
for (let i = 0; i < 40 && (g.pendingReading || g.chiselling); i++) await T.frames(8);
await wait(2.0);
MARK('dance');
// villagers dance when the cloud comes near
await T.pose('right', 'pinch'); await T.handAt('right', g.cloud.pos.x, g.cloud.pos.y, g.cloud.pos.z); await T.pose('right', 'open'); await T.pose('right', 'pinch');
const vc = g.village.villagers[0];
await T.glide('right', vc.x, 0.13, vc.z, 20);
await T.handAt('right', g.cloud.pos.x, g.cloud.pos.y, g.cloud.pos.z, 'palm');
await T.pose('right', 'fist', 3);
CAP('"WHEN THE CLOUD COMES, WE DANCE."', 3500);
await camTo([0.08, 1.45, -0.24], [vc.x, 0.02, vc.z], 3.5);
await T.pose('right', 'open', 3);

// ===== 6. Crush & bless =====
const mis = g.tablets.find((t) => t.law === 'rainDance');
const good = g.tablets.find((t) => t.law === 'replant');
MARK('crush');
await camTo([0.0, 1.5, -0.18], [0, 0.1, -0.33], 1.0);
if (mis) {
  CAP('WRONG? CRUSH IT.', 2600);
  const p = mis.root.position;
  await T.handAt('right', p.x, p.y, p.z + 0.03, 'palm');
  await wait(0.4);
  await T.pose('right', 'fist', 3);
  await wait(1.6);
  await T.pose('right', 'open', 4);
}
MARK('bless');
if (good) {
  CAP('RIGHT? BLESS IT.', 2800);
  T.handRot('right', Math.PI, 0, 0);
  await T.pose('right', 'flat', 4);
  const p = good.root.position;
  await T.handAt('right', p.x, p.y - 0.035, p.z + 0.03, 'palm');
  for (let i = 0; i < 20 && !good.blessed; i++) await T.frames(6);
  await wait(1.4);
  T.handRot('right', 0, 0, 0);
  await T.pose('right', 'open', 4);
}

// ===== 7. Petition =====
MARK('petition');
g.petitionT = 0.01;
await T.frames(10);
const pv = g.village.villagers[g.petition?.who ?? 0];
CAP('THEY ASK. YOU ANSWER WITH YOUR HANDS.', 3600);
await camTo([pv.x * 0.5, 1.47, -0.2], [pv.x, 0.04, pv.z], 1.6);
await wait(1.0);
T.handRot('right', Math.PI, 0, 0); await T.pose('right', 'flat', 4);
await T.handAt('right', pv.x, 0.13, pv.z, 'palm');
await wait(2.0);
T.handRot('right', 0, 0, 0); await T.pose('right', 'open', 4);

// ===== 8. Age of Smoke: fire, smother, misread =====
MARK('smoke');
g.clock = 199; ff(1);
await camTo([0.0, 1.52, -0.16], [0, 0.05, -0.05], 1.0);
await wait(2.5);
ff(14);
let fireTile = g.island.tiles.findIndex((t) => t.fire > 0);
if (fireTile < 0) { g.lightCampfire(); fireTile = g.island.tiles.findIndex((t) => t.fire > 0); }
ff(6);
const fc = centre(fireTile);
const w3 = nearestVillagerTo(fc.x, fc.z);
CAP('THEY LEARNED FIRE. IT SPREADS.', 3000);
await camTo([fc.x * 0.6, 1.47, -0.2], [fc.x, 0.02, fc.z], 1.6);
await holdGaze(w3, 0.8);
await T.handAt('right', fc.x, 0.045, fc.z, 'palm');
lookVillager(w3);
await T.pose('right', 'fist', 6);
await holdGaze(w3, 0.6);
await T.pose('right', 'open', 4);
for (let i = 0; i < 40 && (g.pendingReading || g.chiselling); i++) await T.frames(8);
const smotherLaw = g.tablets.find((t) => t.law === 'noWarmth' || t.law === 'fireWatch');
CAP(smotherLaw && smotherLaw.law === 'noWarmth' ? '"THE HAND HATES WARMTH." NOW EVERYONE SHIVERS.' : 'SMOTHER IT. THEY LEARN TO WATCH THEIR FIRES.', 3800);
await camTo([0.0, 1.5, -0.16], [0, 0.08, -0.3], 1.2);
await wait(2.4);

// ===== 9. Lightning =====
MARK('lightning');
CAP('OR RULE BY FEAR.', 2600);
await camTo([0.06, 1.5, -0.18], [g.cloud.pos.x, 0.08, g.cloud.pos.z], 1.0);
const c2 = g.cloud.pos.clone();
await T.pose('right', 'point', 5);
await T.handAt('right', c2.x + 0.08, c2.y, c2.z, 'indexTip');
await T.handAt('right', c2.x + 0.005, c2.y, c2.z, 'indexTip');
await wait(2.0);
await T.pose('right', 'open', 4);
d.hands.right.position.set(0.3, 1.2, -0.2);

// ===== 10. Festival & ending =====
MARK('festival');
// a fair island for the finale: Harmony
g.fear = 0; g.island.tiles.forEach((t) => { if (t.type === 4) { t.soak = 1; } t.fire = 0; });
while (g.village.villagers.length < 13) g.village.spawn(g.island.centre);
g.clock = 559; ff(1.2);
await camTo([0.0, 1.55, -0.12], [0, 0.12, -0.25], 2.0);
CAP('AT THE FESTIVAL, THEY READ YOUR LAWS BACK TO YOU.', 4000);
await wait(5.2);
await wait(3.4 * Math.max(1, g.tablets.length) + 0.5);
MARK('lanterns');
await camTo([0.0, 1.5, -0.2], [0, 0.35, -0.1], 3.5);
CAP('MAKE A FIST TO PUT OUT THE SUN.', 3000);
await wait(1.5);
await T.pose('right', 'fist', 4);
await wait(4.0);
MARK('ending');
await camTo([0.0, 1.55, -0.12], [0, 0.2, -0.3], 1.5);
await wait(5.0);
MARK('end');
const audio = await REC.stopAudio('audio');
return { marks, audio, ending: g.ending, laws: g.tablets.map((t) => t.law) };
