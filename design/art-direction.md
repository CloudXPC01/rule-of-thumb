# Rule of Thumb: art direction pass

Scope: polish only. Same game, same voxel/pixel floating-island diorama on the real desk. Unit used below: **v = TILE/8 = 4.5 mm** (one "voxel"). A tile is 8v wide.

## 1. Diagnosis (ranked by impact)

1. **Default "voxel tutorial" palette.** `#6dbb45` grass and `#2f8a3e` foliage are fully saturated, mid-value, and the same hue family. Next to a real beige room the island looks like a plastic placeholder. Nothing is warm in the shadows or cool in the lights.
2. **Checkerboard ground.** Grass/grass2 is chosen 50/50 per tile by `hash(i)`, so the top reads as a chessboard, which is the clearest "generated" tell. Real ground varies in patches, not per cell.
3. **One tree, cloned 80 times.** Each is a centred trunk plus two cubes, all the same height ±1 cm, and they fill most of the tiles on a perfect grid. Forest reads as broccoli on graph paper. No species, no clearing edges, no fallen logs.
4. **No shading structure.** Lambert with one light gives top and sides almost the same value, and nothing has ambient occlusion. Trees, huts and villagers float on the cap with no contact darkening. The island does not shadow the desk, so in passthrough it hovers like a sticker.
5. **Slab silhouette.** A perfect 14x14 square at one height, straight dirt walls, and an underside of small, barely visible ring cubes. From the player's eye it reads as a square cake, not an island.
6. **Villagers lost.** At 2.5 cm, with skin-toned heads and muddy tunics, they disappear into the grass. They have no role cues and no outline or value contrast. They are the stars and they are invisible.
7. **Huts are two boxes** (a cream slab under a red slab): no door, eaves, chimney or path. Water is a flat cyan cap with no bank, no depth and no shimmer. Fire is an orange tint on the cap.
8. **UI is template parchment.** Every panel is the same cream rectangle in a brown frame. Pixel densities are mixed (big banner title, tiny subtitle, HUD at a third density). The banner is huge and covers the room. The stat icons are coloured emoji-ish glyphs, and the health bar uses default red and green. Nothing is made of the island's materials.
9. **Night has no light.** The room darkens, but the island stays lit exactly as at day, with no lanterns, warm windows or glow. The festival does not feel like one.
10. **Title screen ≠ game.** The title island has stone strata, offset trees and a crafted look the game does not have, so judges will notice the bait-and-switch. The title also mixes three type voices (giant pixel display, mono body, tracked caps), and the green "ENTER" button is a web-template button. The plank wall is the strongest element and should stay.

## Shared baseline (all three directions)

- **Per-face shading in geometry:** give the shared `BoxGeometry` a `color` attribute and set `vertexColors: true`. three multiplies it with `instanceColor`. Top = 1.00, ±X sides = 0.80, ±Z sides = 0.70, bottom = 0.45. This costs nothing at runtime.
- **Fake AO:** set it per instance in `tint()`. Cap tiles darken ×0.85 for each orthogonal neighbour that holds a tree or hut (min ×0.7). Edge tiles darken ×0.9 on the outer rim. The dirt body gets a vertical gradient through 2 vertex rows (top ×1.0, bottom ×0.55).
- **Contact shadows:** one instanced plane (1 draw call) with a 32×32 radial-gradient canvas texture, multiply-style (`MeshBasicMaterial`, black, opacity 0.35, `depthWrite:false`). Sizes: tree 1.1 tile, hut 1.3 tile, villager 0.6 tile. Add one large blob under the whole island on the desk: 0.75 m wide, opacity 0.4, offset toward the light direction.
- **Noise patches, not per-tile coin flips:** pick colour variant from 2D value noise at frequency 0.25/tile (3 bands), then add ±3% value jitter per tile.
- **Health desaturation → "drought twin"**, not a lerp to grey: each palette entry has a dead twin and `tint()` lerps toward that.
- **Draw-call budget:** island 7 + props 1 + shadows 1 + water 1 + villagers 5 + UI ~6 ≈ 25.

---

## Direction A: "Painted Miniature"

*A tabletop-wargame terrain board, hand-painted with drybrushed edges. It is built to sit next to real objects.*

**Palette**
| Role | Hex | Drought twin |
|---|---|---|
| Grass top a/b/c | `#7fa650` `#6e9846` `#8fb35a` | `#b7a565` |
| Grass side lip | `#5e7f3b` | `#8f7f4c` |
| Dirt strata (top→bottom) | `#8a5d3b` `#6f4a2f` `#553825` | same, ×0.9 |
| Stone | `#8d8a80` / dark `#6a675f` | same |
| Wood | `#7a5236` | `#6d5a48` |
| Foliage oak/pine/birch | `#3f6e35` `#2e5a3a` `#7a9a3c` | `#76703f` `#5f5a3c` `#9a8a4a` |
| Water shallow/deep | `#5fa8b5` `#2f6f82` | `#7d8a7c` |
| Roof / wall | `#b5523b` / `#e6d3a8` | `#9a7a66` / `#cdbfa2` |
| Sky/ambient (hemi) | sky `#fff1dc`, ground `#6b5a48` | |
| UI ink / paper | `#2b2118` / `#e9dcc0` | |

**Surface:** no textures. Edge highlight: each cap gets a second, 0.5v-taller rim instance only on tiles whose neighbour is lower or void, coloured top ×1.18 (the drybrush). Jitter is ±4% value and ±2° hue, by noise.

**Silhouettes**
- **Oak:** trunk 2×5×2v, canopy 6×4×6v, a second canopy 4×3×4v offset (+1v,+4v,−1v).
- **Pine:** trunk 1×2×1v, tiers 6×2×6, 4×2×4, 2×2×2v stacked.
- **Birch:** trunk 1×7×1v (`#e8e2d0` with 2 dark bands), canopy 3×4×3v.
- Each tree is offset ±1.5v inside its tile and turned 0° or 90°.
- **Stump:** 3×1.5×3v with a top `#c99a62`. **Sapling:** 1×2×1v stem plus a 2×2×2v leaf.
- **Hut:** walls 6×4×5v, door 2×3v of `#4a3222` on the face toward the island centre, roof 8×1×7v plus a ridge 8×1×3v (1v overhang), chimney 1×2×1v of stone.
- **Terrain heights:** the rim ring sits −1v; the 4 corner tiles drop to −3v and lose their cap (rounded footprint).
- **Underside:** 3 strata rings, then a stone stalactite cluster of 5 boxes of 8→2v tapering to a point 0.2 m below.
- **Pond:** banks 1v lower than grass with sand `#cdb27a` on the inner edge.
- **Props:** 24 grass tufts (1×1.5×1v, 3 per cluster), 10 flowers (1v, `#e8c547`/`#d97b8a`/white), 6 rocks (2×1×2v stone), 1 short fence (4 posts plus a rail) at the first hut, and a path of dust tiles from hut to pond.

**Villagers:** body 3×3×2v, head 3×3×3v (2.5 cm total). Tunics are high-chroma and drawn from 5 colours only (`#c94f3d`, `#3d6fc9`, `#e0b23a`, `#7b4fa8`, `#f2efe6`). Eyes are 1 black pixel (`#1a1410`) on a skin face, not white blocks.
- **Roles:** woodcutter gets a 1×3v axe in the hand. Fisher gets a 0.5v-wide rod 5v long. Elder gets a white 3×1×3v hat. The zealot after a law gets a gold 3×0.5×3v band.
- The 0.6-tile shadow blob under each villager does more for readability than any detail.

**Light:** directional `#fff0d6` at 1.6, hemisphere at 0.7 as above. Water: a second, slightly transparent plane 0.5v below the cap, shallow colour, with UV-scrolled sparkle in a 16×16 texture with 3 white pixels. Fire: an instanced flame of 3 stacked cubes (2/1.5/1v, `#ffd34d` → `#ff7a1f` → `#c8321e`), emissive, scale flickering ±15% at 9 Hz, plus 4 rising grey `#5a5550` smoke cubes. Night: each hut gets an emissive window (1×1v, `#ffb347`) and a lantern post (1×4v plus a 1v emissive cube) with an additive glow sprite at 0.05 m.

**UI:** panels are *painted wooden boards*, a 3D box with a plank canvas texture (3 planks, 1-px darker seams) and a 2-px bevel, lighter on top. Text is pixfont at **one scale**, inked `#2b2118`. The banner hangs on two 1v ropes from the cloud, max 0.22 m wide. Tablets are actual stone slabs with chiselled text (1-px highlight below each glyph).

**Title screen:** keep the planks. Re-render the in-game island with these exact assets (same tree species and hut). Replace the green button with a painted board "ENTER" hung on ropes.

**Cut:** the white eye blocks, the two-tone checkerboard, the emoji stat colours.

---

## Direction B: "Woodcut Pixel" (16×16 texel world)

*Every face is a hand-made 16×16 pixel texture from one 24-colour palette. It matches the title screen's pixel art exactly.*

**Palette (24-colour ramp; ink `#241a14`)**
| Role | Hex ramp (dark→light) | Drought twin |
|---|---|---|
| Grass | `#3f6b2e` `#5b8a3a` `#7fae4a` `#a9cf6a` | `#7a6a3a` `#a8925a` `#c8b47a` |
| Dirt | `#3b2619` `#5e3d27` `#86593a` | same |
| Stone | `#4e4b47` `#77726a` `#a39d92` | same |
| Wood | `#4a2e1c` `#7a4e2e` `#b07c47` | |
| Foliage oak/pine/autumn | `#2f5a2a` `#22473a` `#b06a2a` | all → `#6d6a3a` |
| Water | deep `#1f4f6e`, shallow `#3f8fb0`, foam `#cfe8ee` | `#5d6e66` |
| Roof / wall | `#a8402f` `#d9603d` / `#e8d5a3` | |
| Ambient | hemi sky `#fff4e0`, ground `#5a4636` | |
| UI ink / paper | `#241a14` / `#f0e2c0` | |

**Surface:** a single 64×64 canvas atlas, nearest filter, no mips, one material per mesh, UV-offset per face via a tiny `onBeforeCompile` (an instance attribute selects the atlas cell).
- **Grass top:** base `#7fae4a`; 18 random pixels `#5b8a3a`; 6 pixels `#a9cf6a`; two 2-px "tuft" marks. The seed comes from tile index, giving 4 variants.
- **Grass side:** top 3 rows grass with a ragged 1-px drip edge, then dirt `#86593a` with 10 `#5e3d27` pixels and 2 stone pixels. **Dirt side:** strata bands every 5 px alternating mid/dark with 1-px light pebbles.
- **Foliage:** base colour, a 2×2-px light cluster top-left, and dark pixels on the bottom 2 rows (self-shadow).
- **Bark:** vertical 1-px dark stripes every 3 px. **Roof:** horizontal shingle rows (dark line every 4 px, offset by 2).
- **Stone:** 3 irregular blobs with dark outline pixels.
- **Outline:** the bottom row and right column of every side texture are ink at 40%, which gives a woodcut edge without post-processing. Jitter: none in colour (the textures carry the variation).

**Silhouettes:** use A's tree set but swap birch for an **autumn oak** on 10% of trees. Forest density is ≤40% of tiles, grouped by noise into 2 groves with a clearing. Hut, corner drops, underside, pond and props are as in A. Underside stone cubes use the stone texture with a hanging vine strip (1×6v, foliage dark) on 3 sides.

**Villagers:** as A, but bodies get a 4×4 texture (tunic with a 1-px belt, ink feet). Faces are 2 ink pixels plus a 1-px cheek blush. The roles are the same items.

**Light:** directional `#ffeccc` at 1.4, hemisphere at 0.8. The textures carry the shading, so keep light contrast moderate. The water cell animates by swapping between 3 atlas cells at 4 fps (foam pixels move). Fire uses 4 atlas frames of a 16×16 flame on a camera-facing quad, and burnt tiles swap to a char texture with ember pixels. Night adds a hut window cell `#ffb347`, emissive and window-only, plus lanterns as in A.

**UI:** every panel is the same atlas: a wood-frame 9-slice (2-px ink border, 1-px light inner bevel) around paper with 3% grain pixels. **One pixel scale for all text** (1 font px = 1.5 mm at 0.6 m). The banner is a wooden signboard at max 0.2 m, never above the island centre. Stat icons are 7×7 hand-drawn glyphs in ink (log, fish, person, tablet). The health bar is a row of 10 pixel hearts/leaves that wilt to drought colour.

**Title screen:** it already is this direction. Re-render its island from the in-game atlas so they match pixel for pixel. Make the ENTER button a wood signboard 9-slice. Cut the dust sparkles and drop the tracked all-caps body lines to one line.

**Cut:** colour jitter, emissive cloud tint, the separate cream panels.

---

## Direction C: "Toy Box"

*A painted wooden toy set. Matte, soft, chunky, fewer and bigger pieces, like Kapla blocks someone painted.*

**Palette:** pastel-lacquer.
- Grass `#9cc46a`/`#88b35c`/`#b0d27c` (drought twin `#d2c38c`); sides are raw wood `#d8b98a` with grain.
- Dirt is not used: strata are 2 wood tones `#c99f6c` / `#a87e52`.
- Stone `#b8b3a8`. Foliage `#5f9e55`/`#4a8a6a`/`#c9b04a` (drought twin `#a89a68`).
- Water `#7cc4d6`/`#4a9ab5` (drought twin `#a8b0a4`). Roof `#e07a5f`, wall `#f6ead2`.
- Hemi `#fffaf0`/`#8a7560`. UI ink `#3a2e26`, paper `#fdf6e6`.

**Surface:** top 1.0 / sides 0.86 / bottom 0.6 (softer). Every side face gets a 16×16 wood-grain texture: 3 wavy 1-px lines `#00000014`. A fake bevel: a 1-px light border on every texture (`#ffffff30`). AO as in the baseline.

**Silhouettes:** bigger and rounder reading.
- **Ball tree:** a 6×6×6v cube with four 1v chamfer cubes removed (approximate a sphere using 3 stacked boxes 4/6/4v).
- **Cone tree:** 6/4/2v tiers.
- Huts are **1.5× scale**, with a round 2v window and a peg chimney.
- Villagers are peg dolls: body 3×4×3v, head 3v. Tunic is lacquer-bright, there is no face at all except 2 ink dots, and hats are role cues.
- Props are half A's counts, but bigger (rocks 3v).

**Light/UI:** brighter and flatter. Fire uses lacquer-red/yellow cubes that pop. Night lanterns are as in A. UI is chunky painted blocks with rounded-looking 9-slice corners.

**Title screen:** it would need a re-paint, and that is the main cost.

**Cut:** the pixel textures and the grain on tops.

---

## 3. Recommendation: **B, Woodcut Pixel**

B is the only one that unifies the game with the already chosen pixel-art title screen. Hand-designed 16×16 texels are the strongest anti-"AI" signal: they read as authored pixel art rather than coloured boxes. B also holds up as a physical miniature at 0.6 m (one texel ≈ 2.25 mm, like a printed decal). A is the safe fallback if the atlas UV trick costs too much time. Take A's palette discipline and B's textures later.

**Top 5 for the least work (ship these first, in order)**
1. **New palette + noise-patched ground** in `PAL` and `tint()`: kill the checkerboard and add the drought twins. (About 1 h.)
2. **Per-face vertex shading + fake AO + contact blobs**: a colour attribute on the shared box, neighbour darkening, and one instanced shadow plane plus the island's desk shadow. (About 2 h. This gives the largest jump in "physical object".)
3. **Three tree species, ≤40% density in groves, offset and rotation in-tile**, plus a real hut (door, overhang, chimney) and 40 props in one instanced mesh. (About 2 h.)
4. **Villager readability:** 5 bright tunic colours, ink-pixel eyes, role items, and a shadow blob under each. (About 1 h.)
5. **UI unification:** one pixel scale, a smaller wooden-signboard banner moved off the island centre, 7×7 ink glyphs in place of coloured icons, and hearts instead of a bar. (About 1.5 h.)

Then add the B atlas textures, the night lanterns, and re-render the title island from game assets.
