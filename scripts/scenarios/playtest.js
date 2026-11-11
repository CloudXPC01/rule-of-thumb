// Scripted playtest: real hand/head input through IWER, clock jumps between beats.
// Runs inside the page (see scripts/capture.mjs). Returns a log of checks.
const T = globalThis.T;
const g = T.god();
const log = [];
const ok = (name, cond, extra) => { log.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ' ' + JSON.stringify(extra) : ''}`); console.log('[cap]', name, cond); };
const ff = (sec) => { for (let i = 0; i < sec / 0.05; i++) g.update(0.05, 0); };
const shot = (n) => globalThis.__shot(n);
const VIEW = () => T.head(-0.5, 0);
const nearestVillagerTo = (x, z) => { let b = 0, bd = 1e9; g.village.villagers.forEach((v, i) => { const d = Math.hypot(v.x - x, v.z - z); if (d < bd && v.state !== 11) { bd = d; b = i; } }); return b; };
const centre = (i) => { const c = { x: 0, y: 0, z: 0 }; g.island.centreOf(i, c); return c; };
async function witness(id) { T.lookAtVillager(id); await T.frames(30); return g.witness; }

try { localStorage.clear(); } catch {}
await T.enter(true);
VIEW();
await T.frames(30);
await shot('01-start');
ok('enters play', g.phase === 'play');

// --- Beat 1: villagers chop; plant on a stump in front of a witness ---
for (let k = 0; k < 12 && !g.island.tiles.some((t) => t.type === 3 && t.claimedBy < 0); k++) ff(10);
let stump = g.island.tiles.findIndex((t) => t.type === 3 && t.claimedBy < 0);
if (stump < 0) { stump = g.island.index(8, 9); g.island.setType(stump, 3); log.push('note: forced stump'); }
const sc = centre(stump);
const wid = nearestVillagerTo(sc.x, sc.z);
const w1 = await witness(wid);
ok('gaze picks a witness', w1 >= 0, { w1 });
await shot('02-witness');
const pr = await T.plant(stump, w1);
ok('seed grabbed', pr.held === 'right');
ok('sapling planted on stump', g.island.tiles[stump].type === 6, { type: g.island.tiles[stump].type });
await T.frames(10);
for (let i = 0; i < 60 && (g.pendingReading || g.chiselling); i++) await T.frames(10);
ok('first law faithful', g.tablets.length === 1 && g.tablets[0].law === 'replant', g.tablets.map((t) => t.law));
VIEW(); await T.frames(20);
await shot('03-first-law');

// --- Beat 2: drag cloud over dust, wring it while watched (guaranteed misread) ---
ff(5);
let dust = g.island.tiles.findIndex((t) => t.type === 4);
if (dust < 0) { g.forceDust(); dust = g.island.tiles.findIndex((t) => t.type === 4); log.push('note: forced dust'); }
const dc = centre(dust);
const cp = g.cloud.pos.clone();
await T.pose('right', 'pinch');
await T.handAt('right', cp.x, cp.y, cp.z);
await T.pose('right', 'open');
await T.pose('right', 'pinch');
ok('cloud grabbed', g.cloudHolder === 'right');
await T.glide('right', dc.x, 0.15, dc.z, 16);
await T.pose('right', 'open', 4);
ok('cloud moved over dust', Math.hypot(g.cloud.pos.x - dc.x, g.cloud.pos.z - dc.z) < 0.04, [g.cloud.pos.x, g.cloud.pos.z, dc.x, dc.z]);
const w2 = await witness(nearestVillagerTo(dc.x, dc.z));
await T.handAt('right', g.cloud.pos.x, g.cloud.pos.y, g.cloud.pos.z, 'palm');
await T.pose('right', 'fist', 4);
for (let i = 0; i < 12; i++) { T.lookAtVillager(w2); await T.frames(8); }
await shot('04-rain');
await T.pose('right', 'open', 4);
for (let i = 0; i < 60 && (g.pendingReading || g.chiselling); i++) await T.frames(10);
const mis = g.tablets.find((t) => t.law === 'rainDance');
ok('second law is the misread', !!mis, g.tablets.map((t) => t.law));
VIEW(); await T.frames(30);
await shot('05-misread');

// --- Beat 3: crush the misread, bless the faithful one ---
if (mis) {
  const p = mis.root.position;
  await T.handAt('right', p.x, p.y, p.z + 0.025, 'palm');
  await T.pose('right', 'fist', 3);
  await T.frames(4);
  await shot('06-crush');
  ok('misread crushed', !g.tablets.includes(mis) && !g.village.laws.has('rainDance'));
  await T.pose('right', 'open', 4);
}
const faithful = g.tablets.find((t) => t.law === 'replant');
if (faithful) {
  T.handRot('right', Math.PI, 0, 0);
  await T.pose('right', 'flat', 4);
  const p = faithful.root.position;
  await T.handAt('right', p.x, p.y - 0.035, p.z + 0.03, 'palm');
  for (let i = 0; i < 12 && !faithful.blessed; i++) await T.frames(10);
  await shot('07-bless');
  ok('faithful law blessed', faithful.blessed);
  T.handRot('right', 0, 0, 0);
  await T.pose('right', 'open', 4);
}

// --- Beat 4: Age of Smoke: a fire, smothered with a fist while watched ---
g.clock = 199; ff(1); ff(16);
let fireTile = g.island.tiles.findIndex((t) => t.fire > 0);
if (fireTile < 0) { g.lightCampfire(); fireTile = g.island.tiles.findIndex((t) => t.fire > 0); }
ok('age of smoke has fire', fireTile >= 0 && g.age === 1);
if (fireTile >= 0) {
  ff(3);
  const fc = centre(fireTile);
  const w3 = await witness(nearestVillagerTo(fc.x, fc.z));
  await shot('08-fire');
  await T.handAt('right', fc.x, 0.045, fc.z, 'palm');
  T.lookAtVillager(w3);
  await T.pose('right', 'fist', 6);
  ok('fire smothered', g.island.tiles[fireTile].fire === 0 && g.smothered > 0);
  await T.pose('right', 'open', 4);
  for (let i = 0; i < 60 && (g.pendingReading || g.chiselling); i++) await T.frames(10);
  ok('smother omen read', g.tablets.some((t) => t.law === 'fireWatch' || t.law === 'noWarmth'), g.tablets.map((t) => t.law));
}

// --- Beat 5: lightning ---
VIEW();
const c2 = g.cloud.pos.clone();
await T.pose('right', 'point', 5);
await T.handAt('right', c2.x + 0.08, c2.y, c2.z, 'indexTip');
const before = g.lightningCount;
await T.handAt('right', c2.x + 0.005, c2.y, c2.z, 'indexTip');
await shot('09-lightning');
ok('poke makes lightning', g.lightningCount > before);
await T.pose('right', 'open', 4);

// --- Beat 6: festival and ending ---
g.clock = 559; ff(1.5); ff(4.5);
VIEW(); await T.frames(4);
for (let i = 0; i < 8; i++) { ff(3.4); await T.frames(2); }
ff(5);
await T.frames(10);
await shot('10-festival');
await T.pose('right', 'fist', 6);
ff(2); await T.frames(30);
await shot('11-night');
ff(6); await T.frames(20);
await shot('12-ending');
ok('game ended', g.phase === 'end', { ending: g.ending });
return log;
