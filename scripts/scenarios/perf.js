const T = globalThis.T; const g = T.god(); const r = g.renderer;
await T.enter(true);
const ff = (sec) => { for (let i = 0; i < sec / 0.05; i++) g.update(0.05, 0); };
ff(30);
for (const law of ['replant','rainDance','fishQuota','noWarmth','waterDust','fireWatch']) { g.onReading({ law, verse: 'Test verse here', source: 'local' }); ff(4); }
const fire = g.island.index(10, 7); g.island.tiles[fire].fire = 0.8; ff(1);
T.d.stereoEnabled = true; T.head(-0.5, 0);
await T.frames(30);
r.info.autoReset = false; r.info.reset(); await T.frames(1);
const calls = r.info.render.calls, tris = r.info.render.triangles; r.info.autoReset = true;
let tot = 0, n = 0, mx = 0; const orig = g.update.bind(g); g.update = (d, t) => { const s = performance.now(); orig(d, t); const e = performance.now() - s; tot += e; n++; mx = Math.max(mx, e); };
const fps = await new Promise((res) => { let k = 0; const s = performance.now(); const sess = T.d.activeSession; const f = () => { k++; if (performance.now() - s < 3000) sess.requestAnimationFrame(f); else res(k / 3); }; sess.requestAnimationFrame(f); });
g.update = orig;
return { stereoCallsPerFrame: calls, tris, fps, godAvgMs: +(tot / n).toFixed(2), godMaxMs: +mx.toFixed(2), tablets: g.tablets.length };
