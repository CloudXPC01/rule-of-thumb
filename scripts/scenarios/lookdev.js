// Look-dev stills: the same three hero shots every time, for comparing art
// directions like-for-like. Run: GAME_URL="http://localhost:5180/?style=a" node scripts/capture.mjs run scripts/scenarios/lookdev.js capture/lookdev-a
const T = globalThis.T; const g = T.god(); const d = T.d;
const ff = (sec) => { for (let i = 0; i < sec / 0.05; i++) g.update(0.05, 0); };
await T.enter(true); HIDE_EMU();
// deterministic-ish scene: some chopping, a stump field, one law, a witness, a small fire
ff(40);
g.onReading({ law: 'replant', verse: 'Where the axe falls, a seed follows', source: 'local' });
ff(4);
g.onReading({ law: 'rainDance', verse: 'When the cloud comes, we dance', source: 'local' }); ff(4);
const fireTile = g.island.index(10, 7); g.island.setType(fireTile, 2); g.island.tiles[fireTile].fire = 0.7; ff(1);
d.hands.right.position.set(0.25, 1.15, -0.3); d.hands.left.position.set(-0.3, 1.1, -0.3);
// 1. wide: player's natural seated view
d.position.set(0, 1.6, 0); T.head(-0.52, 0); await T.frames(20);
await __shot('1-wide');
// 2. close: lean in over the village
d.position.set(0.08, 1.45, -0.22); T.lookAt(0.0, 0.0, 0.02); g.village.villagers[0].watching = 3; await T.frames(20);
await __shot('2-close');
// 3. low hero angle toward tablets
d.position.set(-0.12, 1.36, -0.12); T.lookAt(0.02, 0.05, -0.2); await T.frames(20);
await __shot('3-hero');
// 4. night festival
g.clock = 559; ff(1); ff(14); g.darkWant = 0.78; ff(3);
d.position.set(0, 1.55, -0.1); T.lookAt(0, 0.12, -0.25); await T.frames(40);
await __shot('4-night');
return 'ok';
