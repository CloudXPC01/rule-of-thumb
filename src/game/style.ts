/**
 * Art styles. One renderer, three looks (see design/art-direction.md):
 *   a  Painted Miniature : flat painted colours, drybrushed rim highlights
 *   b  Woodcut Pixel     : hand-made 16x16 pixel textures on every face
 *   c  Toy Box           : pastel lacquer + wood grain, softer shading
 * Choose with ?style=a|b|c (default below). Pure data + canvas painters.
 */

export type StyleId = 'a' | 'b' | 'c';

/** Atlas layout: 8 x 4 cells of 16 px. */
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
export const CELL = 16;

export const C = {
  white: 0,
  grassTop0: 1,
  grassTop1: 2,
  grassTop2: 3,
  grassTop3: 4,
  grassSide: 5,
  dirtSide: 6,
  dirtTop: 7,
  dustTop: 8,
  stone: 9,
  bark: 10,
  oak: 11,
  pine: 12,
  autumn: 13,
  roof: 14,
  wall: 15,
  door: 16,
  woodEnd: 17,
  water0: 18,
  water1: 19,
  water2: 20,
  sand: 21,
  char: 22,
  window: 23,
  birchBark: 24,
  birch: 25,
  plank: 26,
  sideGrain: 27,
} as const;

export interface Palette {
  grass: [number, number, number];
  grassSide: number;
  dirt: [number, number, number];
  stone: [number, number];
  wood: number;
  stumpTop: number;
  oak: number;
  pine: number;
  third: number; // birch (a) / autumn (b) / mint (c)
  birchBark: number;
  waterShallow: number;
  waterDeep: number;
  roof: number;
  wall: number;
  door: number;
  sand: number;
  dust: number;
  char: number;
  ember: number;
  // drought twins
  dGrass: number;
  dFoliage: number;
  dWater: number;
  dWall: number;
  // light
  sun: number;
  sunI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  tunics: number[];
  skin: number[];
  ink: number;
}

export interface Style {
  id: StyleId;
  name: string;
  pal: Palette;
  /** Per-face shade multipliers: top, +/-X sides, +/-Z sides, bottom. */
  shade: [number, number, number, number];
  /** Textures carry the colour (b): instance tints are white apart from AO/drought. */
  textured: boolean;
  /** Drybrushed lighter rim on cap edges (a). */
  rim: boolean;
  /** Colour jitter (fraction of value). */
  jitter: number;
  /** Fraction of land tiles that are forest. */
  forest: number;
  /** Scale of huts and villagers. */
  hutScale: number;
  villagerScale: number;
  paint(g: CanvasRenderingContext2D): void;
}

// ---------------------------------------------------------------------------

const PAL_A: Palette = {
  grass: [0x7fa650, 0x6e9846, 0x8fb35a],
  grassSide: 0x5e7f3b,
  dirt: [0x8a5d3b, 0x6f4a2f, 0x553825],
  stone: [0x8d8a80, 0x6a675f],
  wood: 0x7a5236,
  stumpTop: 0xc99a62,
  oak: 0x3f6e35,
  pine: 0x2e5a3a,
  third: 0x7a9a3c,
  birchBark: 0xe8e2d0,
  waterShallow: 0x5fa8b5,
  waterDeep: 0x2f6f82,
  roof: 0xb5523b,
  wall: 0xe6d3a8,
  door: 0x4a3222,
  sand: 0xcdb27a,
  dust: 0xc4a46a,
  char: 0x3a2e28,
  ember: 0xff6a1f,
  dGrass: 0xb7a565,
  dFoliage: 0x76703f,
  dWater: 0x7d8a7c,
  dWall: 0xcdbfa2,
  sun: 0xfff0d6,
  sunI: 1.6,
  hemiSky: 0xfff1dc,
  hemiGround: 0x6b5a48,
  hemiI: 0.7,
  tunics: [0xc94f3d, 0x3d6fc9, 0xe0b23a, 0x7b4fa8, 0xf2efe6],
  skin: [0xe9b88a, 0xc98e5e, 0x9a6440, 0x6e4430],
  ink: 0x1a1410,
};

const PAL_B: Palette = {
  ...PAL_A,
  grass: [0x7fae4a, 0x5b8a3a, 0xa9cf6a],
  grassSide: 0x5b8a3a,
  dirt: [0x86593a, 0x5e3d27, 0x3b2619],
  stone: [0xa39d92, 0x77726a],
  wood: 0x7a4e2e,
  stumpTop: 0xb07c47,
  oak: 0x2f5a2a,
  pine: 0x22473a,
  third: 0xb06a2a,
  waterShallow: 0x3f8fb0,
  waterDeep: 0x1f4f6e,
  roof: 0xa8402f,
  wall: 0xe8d5a3,
  dGrass: 0xa8925a,
  dFoliage: 0x6d6a3a,
  dWater: 0x5d6e66,
  sun: 0xffeccc,
  sunI: 1.4,
  hemiSky: 0xfff4e0,
  hemiGround: 0x5a4636,
  hemiI: 0.8,
  ink: 0x241a14,
};

const PAL_C: Palette = {
  ...PAL_A,
  grass: [0x9cc46a, 0x88b35c, 0xb0d27c],
  grassSide: 0xd8b98a,
  dirt: [0xc99f6c, 0xa87e52, 0x8f6a44],
  stone: [0xb8b3a8, 0x9c978c],
  wood: 0xa87e52,
  stumpTop: 0xe0c08c,
  oak: 0x5f9e55,
  pine: 0x4a8a6a,
  third: 0xc9b04a,
  birchBark: 0xf6ead2,
  waterShallow: 0x7cc4d6,
  waterDeep: 0x4a9ab5,
  roof: 0xe07a5f,
  wall: 0xf6ead2,
  door: 0x8a5a3c,
  sand: 0xe8d4a0,
  dust: 0xd8c08c,
  dGrass: 0xd2c38c,
  dFoliage: 0xa89a68,
  dWater: 0xa8b0a4,
  dWall: 0xe0d6c0,
  sun: 0xfffaf0,
  sunI: 1.3,
  hemiSky: 0xfffaf0,
  hemiGround: 0x8a7560,
  hemiI: 1.0,
  tunics: [0xe85d4a, 0x4a86e8, 0xf2c14e, 0x9a6ad0, 0x5cc49a],
  ink: 0x3a2e26,
};

// --- atlas painting helpers -------------------------------------------------

function rng(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
function cellXY(i: number) {
  return [(i % ATLAS_COLS) * CELL, Math.floor(i / ATLAS_COLS) * CELL] as const;
}
function fill(g: CanvasRenderingContext2D, i: number, col: string) {
  const [x, y] = cellXY(i);
  g.fillStyle = col;
  g.fillRect(x, y, CELL, CELL);
}
function px(g: CanvasRenderingContext2D, i: number, x: number, y: number, col: string, w = 1, h = 1) {
  const [ox, oy] = cellXY(i);
  g.fillStyle = col;
  g.fillRect(ox + x, oy + y, w, h);
}
function speckle(g: CanvasRenderingContext2D, i: number, n: number, col: string, seed: number) {
  const r = rng(seed);
  for (let k = 0; k < n; k++) px(g, i, Math.floor(r() * CELL), Math.floor(r() * CELL), col);
}
function inkEdge(g: CanvasRenderingContext2D, i: number, alpha = 0.4) {
  px(g, i, 0, CELL - 1, `rgba(36,26,20,${alpha})`, CELL, 1);
  px(g, i, CELL - 1, 0, `rgba(36,26,20,${alpha})`, 1, CELL);
}

/** (a) plain white atlas: the palette lives in instance colours. */
function paintFlat(g: CanvasRenderingContext2D) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, ATLAS_COLS * CELL, ATLAS_ROWS * CELL);
  // birch bark bands and lit window still need marks
  px(g, C.birchBark, 0, 4, '#5a5048', CELL, 1);
  px(g, C.birchBark, 0, 11, '#5a5048', CELL, 1);
  fill(g, C.window, '#ffcf7a');
  // a few drybrush flecks on foliage and grass tops so it reads hand-painted
  for (const c of [C.oak, C.pine, C.birch, C.autumn]) {
    speckle(g, c, 10, '#f4f4f0', c * 7);
    px(g, c, 0, CELL - 2, '#d8d8d8', CELL, 2);
  }
  for (const c of [C.grassTop0, C.grassTop1, C.grassTop2, C.grassTop3]) speckle(g, c, 6, '#f2f2ee', c * 13);
  speckle(g, C.dirtSide, 8, '#e6e6e6', 5);
  px(g, C.dirtSide, 0, 5, '#eeeeee', CELL, 1);
  px(g, C.dirtSide, 0, 11, '#e2e2e2', CELL, 1);
}

/** (b) Woodcut Pixel: every cell is authored pixel art from one palette. */
function paintPixel(g: CanvasRenderingContext2D) {
  const P = PAL_B;
  const grassBase = hex(0x7fae4a), grassDark = hex(0x5b8a3a), grassLight = hex(0xa9cf6a), grassDeep = hex(0x3f6b2e);
  const dirtMid = hex(0x86593a), dirtDark = hex(0x5e3d27), dirtDeep = hex(0x3b2619);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, ATLAS_COLS * CELL, ATLAS_ROWS * CELL);
  // grass tops: 4 variants
  [C.grassTop0, C.grassTop1, C.grassTop2, C.grassTop3].forEach((c, k) => {
    fill(g, c, grassBase);
    speckle(g, c, 18, grassDark, 11 + k * 31);
    speckle(g, c, 6, grassLight, 7 + k * 17);
    const r = rng(99 + k);
    for (let t = 0; t < 2; t++) {
      const x = 2 + Math.floor(r() * 11), y = 2 + Math.floor(r() * 11);
      px(g, c, x, y, grassDeep);
      px(g, c, x + 1, y - 1, grassDeep);
      px(g, c, x + 2, y, grassDeep);
    }
  });
  // grass side: grass lip with ragged drip, then dirt
  fill(g, C.grassSide, dirtMid);
  px(g, C.grassSide, 0, 0, grassBase, CELL, 3);
  { const r = rng(5); for (let x = 0; x < CELL; x++) if (r() < 0.5) px(g, C.grassSide, x, 3, grassDark, 1, 1 + Math.floor(r() * 2)); }
  speckle(g, C.grassSide, 10, dirtDark, 8);
  px(g, C.grassSide, 4, 10, hex(0x77726a), 2, 1);
  px(g, C.grassSide, 11, 13, hex(0x77726a), 1, 1);
  inkEdge(g, C.grassSide);
  // dirt side: strata bands
  fill(g, C.dirtSide, dirtMid);
  for (let y = 0; y < CELL; y += 5) px(g, C.dirtSide, 0, y, dirtDark, CELL, 2);
  speckle(g, C.dirtSide, 6, hex(0xb08060), 21);
  speckle(g, C.dirtSide, 6, dirtDeep, 22);
  inkEdge(g, C.dirtSide);
  // dirt / path top
  fill(g, C.dirtTop, dirtMid);
  speckle(g, C.dirtTop, 20, dirtDark, 31);
  speckle(g, C.dirtTop, 6, hex(0xb08060), 32);
  // dust (dry cracked)
  fill(g, C.dustTop, hex(0xc8a86a));
  speckle(g, C.dustTop, 18, hex(0xa8885a), 41);
  { const r = rng(42); for (let k = 0; k < 4; k++) { const x = Math.floor(r() * 12), y = Math.floor(r() * 12); px(g, C.dustTop, x, y, hex(0x8a6a44), 3, 1); px(g, C.dustTop, x + 2, y + 1, hex(0x8a6a44), 1, 2); } }
  // stone
  fill(g, C.stone, hex(0x77726a));
  { const r = rng(51); for (let k = 0; k < 3; k++) { const x = 1 + Math.floor(r() * 9), y = 1 + Math.floor(r() * 9); px(g, C.stone, x, y, hex(0xa39d92), 5, 4); px(g, C.stone, x, y + 4, hex(0x4e4b47), 5, 1); px(g, C.stone, x + 5, y, hex(0x4e4b47), 1, 5); } }
  inkEdge(g, C.stone);
  // bark
  fill(g, C.bark, hex(0x7a4e2e));
  for (let x = 1; x < CELL; x += 3) px(g, C.bark, x, 0, hex(0x4a2e1c), 1, CELL);
  speckle(g, C.bark, 5, hex(0xb07c47), 61);
  // foliage
  const leaf = (c: number, base: number, light: number, dark: number, seed: number) => {
    fill(g, c, hex(base));
    speckle(g, c, 22, hex(dark), seed);
    speckle(g, c, 10, hex(light), seed + 1);
    px(g, c, 2, 2, hex(light), 2, 2);
    px(g, c, 0, CELL - 2, hex(dark), CELL, 2);
    inkEdge(g, c, 0.35);
  };
  leaf(C.oak, 0x2f5a2a, 0x4f8a3a, 0x1f3f1c, 71);
  leaf(C.pine, 0x22473a, 0x3a6a4e, 0x152e26, 72);
  leaf(C.autumn, 0xb06a2a, 0xd9913d, 0x7a4418, 73);
  leaf(C.birch, 0x6f9a3a, 0x9ac25a, 0x4a6a28, 74);
  // roof shingles
  fill(g, C.roof, hex(0xa8402f));
  for (let y = 0; y < CELL; y += 4) {
    px(g, C.roof, 0, y + 3, hex(0x6e2418), CELL, 1);
    for (let x = (y / 4) % 2 ? 2 : 0; x < CELL; x += 4) px(g, C.roof, x, y, hex(0xd9603d), 1, 3);
  }
  inkEdge(g, C.roof);
  // wall plaster with timber
  fill(g, C.wall, hex(0xe8d5a3));
  speckle(g, C.wall, 10, hex(0xd4bf8c), 81);
  px(g, C.wall, 0, 0, hex(0x7a4e2e), CELL, 2);
  px(g, C.wall, 0, 0, hex(0x7a4e2e), 2, CELL);
  inkEdge(g, C.wall);
  // door
  fill(g, C.door, hex(0x4a2e1c));
  for (let x = 3; x < CELL; x += 4) px(g, C.door, x, 0, hex(0x2e1c10), 1, CELL);
  px(g, C.door, 11, 8, hex(0xe0b23a), 2, 2);
  // wood end grain (stump top)
  fill(g, C.woodEnd, hex(0xb07c47));
  g.strokeStyle = hex(0x7a4e2e);
  for (const r0 of [2, 4, 6]) { const [x, y] = cellXY(C.woodEnd); g.strokeRect(x + 8 - r0 + 0.5, y + 8 - r0 + 0.5, r0 * 2 - 1, r0 * 2 - 1); }
  // water: 3 frames of moving foam
  [C.water0, C.water1, C.water2].forEach((c, k) => {
    fill(g, c, hex(0x3f8fb0));
    speckle(g, c, 14, hex(0x1f4f6e), 91);
    const r = rng(95 + k);
    for (let t = 0; t < 4; t++) { const x = Math.floor(r() * 13), y = Math.floor(r() * 15); px(g, c, x, y, hex(0xcfe8ee), 3, 1); }
  });
  // sand
  fill(g, C.sand, hex(0xd8c08a));
  speckle(g, C.sand, 16, hex(0xb89c64), 101);
  // char
  fill(g, C.char, hex(0x3a2e28));
  speckle(g, C.char, 14, hex(0x241a14), 111);
  speckle(g, C.char, 4, hex(0xff6a1f), 112);
  // lit window
  fill(g, C.window, hex(0xffb347));
  px(g, C.window, 0, 7, hex(0x4a2e1c), CELL, 2);
  px(g, C.window, 7, 0, hex(0x4a2e1c), 2, CELL);
  // birch bark
  fill(g, C.birchBark, hex(0xe8e2d0));
  speckle(g, C.birchBark, 8, hex(0x3a322a), 121);
  px(g, C.birchBark, 0, 5, hex(0x3a322a), CELL, 1);
  // plank (UI / fence)
  fill(g, C.plank, hex(0xb07c47));
  for (let y = 0; y < CELL; y += 5) px(g, C.plank, 0, y, hex(0x7a4e2e), CELL, 1);
  speckle(g, C.plank, 6, hex(0x8a5a32), 131);
  fill(g, C.sideGrain, dirtMid);
  void P;
}

/** (c) Toy Box: white tops, wood-grain sides with a soft bevel. */
function paintToy(g: CanvasRenderingContext2D) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, ATLAS_COLS * CELL, ATLAS_ROWS * CELL);
  const bevel = (c: number) => {
    px(g, c, 0, 0, 'rgba(255,255,255,0.35)', CELL, 1);
    px(g, c, 0, 0, 'rgba(255,255,255,0.35)', 1, CELL);
    px(g, c, 0, CELL - 1, 'rgba(0,0,0,0.12)', CELL, 1);
    px(g, c, CELL - 1, 0, 'rgba(0,0,0,0.12)', 1, CELL);
  };
  const grain = (c: number, seed: number) => {
    const r = rng(seed);
    for (let k = 0; k < 3; k++) {
      let y = 3 + k * 4 + Math.floor(r() * 2);
      for (let x = 0; x < CELL; x++) {
        if (r() < 0.25) y += r() < 0.5 ? -1 : 1;
        px(g, c, x, Math.max(0, Math.min(CELL - 1, y)), 'rgba(90,60,30,0.16)');
      }
    }
  };
  for (const c of [C.grassSide, C.dirtSide, C.bark, C.stone, C.wall, C.door, C.plank, C.sideGrain]) grain(c, c * 3 + 1);
  for (let c = 1; c < ATLAS_COLS * ATLAS_ROWS; c++) bevel(c);
  fill(g, C.window, '#ffcf7a');
  px(g, C.birchBark, 0, 5, '#6a5a48', CELL, 1);
  // lacquer sheen on foliage
  for (const c of [C.oak, C.pine, C.birch, C.autumn]) px(g, c, 3, 3, 'rgba(255,255,255,0.45)', 3, 2);
}

export const STYLES: Record<StyleId, Style> = {
  a: {
    id: 'a',
    name: 'Painted Miniature',
    pal: PAL_A,
    shade: [1.0, 0.8, 0.7, 0.45],
    textured: false,
    rim: true,
    jitter: 0.04,
    forest: 0.4,
    hutScale: 1,
    villagerScale: 1,
    paint: paintFlat,
  },
  b: {
    id: 'b',
    name: 'Woodcut Pixel',
    pal: PAL_B,
    shade: [1.0, 0.82, 0.72, 0.5],
    textured: true,
    rim: false,
    jitter: 0,
    forest: 0.4,
    hutScale: 1,
    villagerScale: 1,
    paint: paintPixel,
  },
  c: {
    id: 'c',
    name: 'Toy Box',
    pal: PAL_C,
    shade: [1.0, 0.88, 0.82, 0.6],
    textured: false,
    rim: false,
    jitter: 0.02,
    forest: 0.32,
    hutScale: 1.35,
    villagerScale: 1.15,
    paint: paintToy,
  },
};

const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('style') : null;
export const STYLE: Style = STYLES[(param as StyleId) in STYLES ? (param as StyleId) : 'b'];
