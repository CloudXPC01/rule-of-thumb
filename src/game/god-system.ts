/**
 * GodSystem: the whole game loop of Rule of Thumb.
 *
 * Owns the island, village, renderers and effects under Stage.root and turns
 * the player's hands and head into divine acts:
 *   gaze      -> choose a witness ("!")
 *   pinch     -> carry the seed pod, drag the cloud
 *   fist      -> wring the cloud for rain, smother fire, crush a tablet
 *   palm up   -> bless a tablet
 *   poke      -> lightning
 * A healing act seen by the witness becomes an omen; the Scribe reads it
 * (AI with local fallback) into a law chiselled on a tablet, faithfully or not.
 *
 * Everything is stage-local; hand/head poses are converted once per frame.
 */
import {
  BackSide,
  BoxGeometry,
  createSystem,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Texture,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { HAND_SIDES, Hands, type Side } from '../hands/hand-state.js';
import { Stage } from '../world/stage.js';
import { Book, type Ending, ALL_LAWS } from './book.js';
import { Cloud } from './cloud.js';
import { Banner, Hud } from './hud.js';
import { Island, Tile, TILE } from './island.js';
import { IslandRender } from './island-render.js';
import { Particles } from './particles.js';
import {
  CANDIDATES,
  LAW_INFO,
  NUMERALS,
  readOmen,
  villagerName,
  type Omen,
  type Reading,
} from './scribe.js';
import { Sfx } from './sfx.js';
import { Bubble, Tablet } from './tablet.js';
import { Village, VState, type LawId, type Villager } from './village.js';
import { VillageRender } from './village-render.js';

type Phase = 'attract' | 'play' | 'festival' | 'end';

const PARAMS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const SPEED = Math.max(0.1, Number(PARAMS.get('speed') ?? 1) || 1);
const SKIP = Number(PARAMS.get('skip') ?? 0) || 0;
const AUTOPLAY = PARAMS.has('autoplay');

export const AGE2_AT = 200;
export const AGE3_AT = 400;
export const FESTIVAL_AT = 560;
const AGES = ['AGE OF WOOD', 'AGE OF SMOKE', 'AGE OF PLENTY'];

const TOP_Y = 0.01; // approx island surface height (stage-local)
const SEED_HOME = new Vector3(0.19, 0.06, 0.12);
const TABLET_R = 0.33;
const TABLET_Y = 0.1;
const TABLET_SLOTS = [3, 4, 2, 5, 1, 6, 0, 7];

interface Hint {
  text: string;
  avail: () => boolean;
  done: () => boolean;
}

export class GodSystem extends createSystem({}) {
  // --- world objects -------------------------------------------------------
  private island!: Island;
  private village!: Village;
  private islandRender!: IslandRender;
  private villageRender!: VillageRender;
  private worldRoot!: Group;
  private fx!: Particles;
  private glow!: Particles;
  private cloud!: Cloud;
  private hud!: Hud;
  private banner!: Banner;
  private witnessBubble!: Bubble;
  private seed!: Group;
  private seedGlow!: MeshBasicMaterial;
  private flash!: Mesh;
  private flashMat!: MeshBasicMaterial;
  private dark!: Mesh;
  private darkMat!: MeshBasicMaterial;
  private raft!: Group;

  // --- scratch -------------------------------------------------------------
  private inv = new Matrix4();
  private headW = new Vector3();
  private headL = new Vector3();
  private fwdW = new Vector3();
  private tmpW = new Vector3();
  private tmpL = new Vector3();
  private tmp2 = new Vector3();
  private palmL: Record<Side, Vector3> = { left: new Vector3(), right: new Vector3() };
  private pinchL: Record<Side, Vector3> = { left: new Vector3(), right: new Vector3() };
  private indexL: Record<Side, Vector3> = { left: new Vector3(), right: new Vector3() };
  private pt = { x: 0, y: 0, z: 0 };
  private nb: number[] = [];

  // --- game state ----------------------------------------------------------
  private phase: Phase = 'attract';
  private clock = 0;
  private age = 0;
  private hitStop = 0;
  private simAcc = 0;
  private health = 1;
  private faith = 0.3;
  private fear = 0;
  private witness = -1;
  private everWitness = false;
  private seedHolder: Side | null = null;
  private seedRespawn = 0;
  private seedFirm = new Vector3();
  private cloudHolder: Side | null = null;
  private cloudGrab = new Vector3();
  private poking: Record<Side, boolean> = { left: false, right: false };
  private lightningCd = 0;
  private lightningCount = 0;
  private rainedFor = 0;
  private rainOnDust = 0;
  private rainOnPond = 0;
  private smothered = 0;
  private tablets: Tablet[] = [];
  private tabletSlot = new Map<Tablet, number>();
  private chiselling: Tablet | null = null;
  private chiselT = 0;
  private pendingReading = false;
  private readings = 0;
  private misreads = 0;
  private crushes = 0;
  private blesses = 0;
  private crushed: LawId[] = [];
  private blessHold = new Map<Tablet, number>();
  private campfireT = 0;
  private dustT = 7;
  private forcedDust = false;
  private lookedUp = false;
  private hints: Hint[] = [];
  private hintIdx = -1;
  // festival
  private festT = 0;
  private festReadIdx = -1;
  private festStage = 0;
  private ending: Ending | null = null;
  private darkWant = 0;
  private exodusT = 0;

  init(): void {
    Book.load();
    this.worldRoot = new Group();
    this.worldRoot.name = 'god-world';
    Stage.root.add(this.worldRoot);

    // Remove the placeholder slab the placement system adds.
    const slab = Stage.root.getObjectByName('placeholder-slab');
    if (slab) slab.visible = false;

    this.fx = new Particles(320);
    this.glow = new Particles(72, true);
    this.cloud = new Cloud();
    this.hud = new Hud();
    this.banner = new Banner();
    this.witnessBubble = new Bubble(0.02, 0.02, 32);
    this.witnessBubble.set('!', '#fff3b0', '#3a2a1a');

    // HUD plate on the front rim, tipped back toward the player.
    this.hud.root.position.set(0, -0.03, 0.29);
    this.hud.root.rotation.x = -0.75;
    this.banner.root.position.set(0, 0.3, -0.2);

    this.seed = this.buildSeed();
    this.buildRaft();

    this.flashMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: BackSide, depthWrite: false });
    this.flash = new Mesh(new SphereGeometry(1.2, 12, 8), this.flashMat);
    this.flash.renderOrder = 30;
    this.flash.visible = false;
    this.darkMat = new MeshBasicMaterial({ color: 0x05040a, transparent: true, opacity: 0, side: BackSide, depthWrite: false });
    this.dark = new Mesh(new SphereGeometry(1.6, 12, 8), this.darkMat);
    this.dark.renderOrder = -5;
    this.dark.visible = false;

    for (const o of [
      this.fx.mesh,
      this.glow.mesh,
      this.cloud.root,
      this.hud.root,
      this.banner.root,
      this.witnessBubble.mesh,
      this.seed,
      this.flash,
      this.dark,
      this.raft,
    ]) {
      Stage.root.add(o);
    }
    this.fx.onLand = (x, z) => this.onRainLand(x, z);

    this.buildHints();
    this.buildWorld();

    this.cleanupFuncs.push(
      this.visibilityState.subscribe((v) => {
        if (v !== VisibilityState.NonImmersive && this.phase === 'attract') this.startGame();
        if (v === VisibilityState.NonImmersive && this.phase !== 'attract') this.phase = 'attract';
      }),
    );
    if (AUTOPLAY) this.startGame();

    (globalThis as unknown as { __god: unknown }).__god = this;
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  private buildSeed(): Group {
    const g = new Group();
    const pod = new Mesh(new BoxGeometry(0.011, 0.014, 0.011), new MeshLambertMaterial({ color: 0x9b6a3c }));
    const band = new Mesh(new BoxGeometry(0.0125, 0.003, 0.0125), new MeshLambertMaterial({ color: 0x6b4426 }));
    band.position.y = -0.002;
    const sprout = new Mesh(new BoxGeometry(0.004, 0.006, 0.004), new MeshLambertMaterial({ color: 0x8be05a }));
    sprout.position.y = 0.01;
    const leaf = new Mesh(new BoxGeometry(0.007, 0.002, 0.003), new MeshLambertMaterial({ color: 0x6dbb45 }));
    leaf.position.set(0.003, 0.012, 0);
    this.seedGlow = new MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.25, depthWrite: false });
    const halo = new Mesh(new BoxGeometry(0.02, 0.022, 0.02), this.seedGlow);
    g.add(pod, band, sprout, leaf, halo);
    g.position.copy(SEED_HOME);
    return g;
  }

  private buildRaft() {
    this.raft = new Group();
    const wood = new MeshLambertMaterial({ color: 0x8a5a2b });
    for (let i = 0; i < 4; i++) {
      const log = new Mesh(new BoxGeometry(0.05, 0.006, 0.009), wood);
      log.position.z = (i - 1.5) * 0.0095;
      this.raft.add(log);
    }
    const mast = new Mesh(new BoxGeometry(0.003, 0.04, 0.003), wood);
    mast.position.y = 0.02;
    const sail = new Mesh(new BoxGeometry(0.002, 0.026, 0.026), new MeshLambertMaterial({ color: 0xf0d9a8 }));
    sail.position.set(0, 0.026, 0.0);
    this.raft.add(mast, sail);
    this.raft.visible = false;
  }

  /** (Re)build island, village and their renderers from scratch. */
  private buildWorld() {
    if (this.islandRender) {
      this.worldRoot.remove(this.islandRender.root, this.villageRender.root);
      disposeTree(this.islandRender.root);
      disposeTree(this.villageRender.root);
    }
    for (const t of this.tablets) this.removeTablet(t);
    this.tablets.length = 0;

    this.island = new Island(7);
    this.village = new Village(this.island);
    this.islandRender = new IslandRender(this.island);
    this.villageRender = new VillageRender(this.village);
    this.worldRoot.add(this.islandRender.root, this.villageRender.root);
    this.wireVillageEvents();
    this.health = this.island.health();
  }

  private wireVillageEvents() {
    const isl = this.island;
    const fx = this.fx;
    const p = { x: 0, y: 0, z: 0 };
    this.village.events = {
      onChopTick: (tile) => {
        isl.centreOf(tile, p);
        fx.burst(p.x, p.y + 0.012, p.z, 3, [0xc89058, 0x8a5a2b], 0.08, 0.0025, 0.5);
        Sfx.chop();
      },
      onChop: (tile) => {
        isl.centreOf(tile, p);
        fx.burst(p.x, p.y + 0.025, p.z, 10, [0x2f8a3e, 0x3fa34a, 0x6dbb45], 0.12, 0.004, 0.9);
        Sfx.fall();
        this.islandRender.popTile(tile);
      },
      onPlant: (tile) => {
        isl.centreOf(tile, p);
        fx.burst(p.x, p.y + 0.008, p.z, 5, [0x8be05a, 0x7b5236], 0.06, 0.003, 0.6);
        Sfx.plant();
        this.islandRender.popTile(tile);
      },
      onHutBuilt: (tile) => {
        isl.centreOf(tile, p);
        fx.burst(p.x, p.y + 0.01, p.z, 14, [0xf0d9a8, 0xc6463a, 0xd2b072], 0.14, 0.004, 0.8);
        Sfx.hut();
        this.islandRender.popTile(tile);
      },
      onLeave: (v) => {
        // a hungry family gives up and walks off the edge
        fx.burst(v.x, v.y + 0.01, v.z, 8, [0xd2b072, 0xc49d5e], 0.06, 0.004, 0.8);
        Sfx.gasp(v.id);
        if (this.witness >= this.village.villagers.length) this.witness = -1;
      },
      onBirth: (v) => {
        v.hop = 1;
        Sfx.pop();
      },
      onFish: (tile) => {
        isl.centreOf(tile, p);
        fx.burst(p.x, p.y + 0.004, p.z, 6, [0x9fd3e6, 0xffffff], 0.08, 0.003, 0.5);
        Sfx.splash();
      },
      onWaterDust: (tile) => {
        isl.centreOf(tile, p);
        fx.burst(p.x, p.y + 0.006, p.z, 6, [0x3fb3d8, 0x9fd3e6], 0.06, 0.0025, 0.5);
      },
      onThrowFish: (v) => {
        // a fish arcs up toward the player's face; food wasted, giggles had
        const dx = this.headL.x - v.x;
        const dz = this.headL.z - v.z;
        const d = Math.max(0.05, Math.hypot(dx, dz));
        fx.spawn({
          x: v.x,
          y: v.y + 0.02,
          z: v.z,
          vx: (dx / d) * 0.22,
          vy: 0.75,
          vz: (dz / d) * 0.22,
          gravity: -0.9,
          life: 1.6,
          size: 0.007,
          color: 0x9fd3e6,
          shrink: false,
        });
        this.village.food = Math.max(0, this.village.food - 1);
        Sfx.gibber(v.id + 3);
        Sfx.splash();
      },
    };
  }

  private startGame() {
    this.buildWorld();
    this.phase = 'play';
    this.clock = SKIP;
    this.age = SKIP >= AGE3_AT ? 2 : SKIP >= AGE2_AT ? 1 : 0;
    this.faith = 0.3;
    this.fear = 0;
    this.witness = -1;
    this.everWitness = false;
    this.readings = this.misreads = this.crushes = this.blesses = 0;
    this.crushed.length = 0;
    this.rainedFor = this.rainOnDust = this.rainOnPond = this.smothered = 0;
    this.lightningCount = 0;
    this.campfireT = 14;
    this.dustT = 7;
    this.forcedDust = false;
    this.lookedUp = false;
    this.festT = 0;
    this.festReadIdx = -1;
    this.festStage = 0;
    this.ending = null;
    this.darkWant = 0;
    this.exodusT = 0;
    this.raft.visible = false;
    this.seedHolder = null;
    this.seed.position.copy(SEED_HOME);
    this.seed.visible = true;
    this.cloud.pos.set(0.1, 0.17, 0.04);
    this.hintIdx = -1;
    Book.startPlay();
    Sfx.unlock();
    this.banner.show(AGES[this.age], 'YOU ARE THE HAND. YOU CANNOT SPEAK. THEY ARE WATCHING.', 5);
    Sfx.fanfare();
  }

  private buildHints() {
    const has = (o: Omen) => this.tablets.some((t) => LAW_INFO[t.law].omen === o);
    const misreadUp = () => this.tablets.some((t) => !LAW_INFO[t.law].faithful && !t.blessed);
    this.hints = [
      {
        text: 'PINCH THE GLOWING RIM TO MOVE YOUR ISLAND',
        avail: () => true,
        done: () => Stage.placed || this.clock > 14,
      },
      {
        text: 'LOOK AT A VILLAGER. THEY WILL LOOK BACK.',
        avail: () => true,
        done: () => this.everWitness,
      },
      {
        text: 'PINCH THE SEED POD. PLANT IT ON A STUMP WHILE SOMEONE WATCHES.',
        avail: () => true,
        done: () => this.readings > 0,
      },
      {
        text: 'THEY GOT IT WRONG! FIST THE TABLET TO CRUSH IT, OR HOLD PALM UP TO BLESS IT.',
        avail: () => misreadUp(),
        done: () => this.crushes + this.blesses > 0,
      },
      {
        text: 'MAKE A FIST INSIDE THE CLOUD TO WRING OUT RAIN',
        avail: () => this.readings > 0 || this.clock > 100,
        done: () => this.rainedFor > 1.5,
      },
      {
        text: 'RAIN ON DUST WHILE SOMEONE WATCHES. TEACH THEM AGAIN.',
        avail: () => this.island.count(Tile.Dust) > 0 && !has('rainDust'),
        done: () => has('rainDust') || this.clock > AGE2_AT,
      },
      {
        text: 'FIRE! SMOTHER IT WITH A FIST, OR RAIN ON IT.',
        avail: () => this.age >= 1 && this.burning() > 0,
        done: () => this.smothered > 0 || has('smother'),
      },
      {
        text: 'GREY POND? RAIN ON IT WHILE WATCHED. FISH RETURN.',
        avail: () => this.age >= 1 && this.deadPonds() > 0,
        done: () => has('rainPond'),
      },
      {
        text: 'POKE THE CLOUD FOR LIGHTNING. THEY WILL FEAR YOU.',
        avail: () => this.clock > 270,
        done: () => this.lightningCount > 0 || this.clock > 330,
      },
    ];
  }

  // ===========================================================================
  // Frame
  // ===========================================================================

  update(delta: number): void {
    const realDt = Math.min(delta, 0.05);
    let dt = realDt * (this.phase === 'attract' ? 1 : SPEED);
    if (this.hitStop > 0) {
      this.hitStop -= realDt;
      dt = 0;
    }

    this.updatePoses();
    if (this.phase === 'play' || this.phase === 'festival') this.updateHands(realDt);
    if (this.phase === 'play') {
      this.updateGaze(realDt);
      this.clock += dt;
      this.updateTimeline();
    } else if (this.phase === 'festival') this.updateFestival(dt);
    else if (this.phase === 'end') this.updateEnd(realDt, dt);

    this.updateSim(dt);
    this.updateTablets(realDt);
    this.updateVisuals(realDt, dt);
  }

  private updatePoses() {
    Stage.root.updateMatrixWorld();
    this.inv.copy(Stage.root.matrixWorld).invert();
    this.player.head.getWorldPosition(this.headW);
    this.headL.copy(this.headW).applyMatrix4(this.inv);
    for (const side of HAND_SIDES) {
      const h = Hands[side];
      this.palmL[side].copy(h.palm).applyMatrix4(this.inv);
      this.pinchL[side].copy(h.pinchPoint).applyMatrix4(this.inv);
      this.indexL[side].copy(h.indexTip).applyMatrix4(this.inv);
    }
  }

  /** Nearest tracked palm in stage-local space, or null. */
  private nearestPalm(): Vector3 | null {
    let best: Vector3 | null = null;
    let bd = 1e9;
    for (const side of HAND_SIDES) {
      if (!Hands[side].tracked) continue;
      const p = this.palmL[side];
      const d = Math.hypot(p.x, p.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Hands: seed, cloud, rain, lightning, smother, crush, bless
  // ---------------------------------------------------------------------------

  private updateHands(dt: number) {
    const cloud = this.cloud;
    let squeeze = 0;
    let hover = 0;
    this.lightningCd = Math.max(0, this.lightningCd - dt);

    for (const side of HAND_SIDES) {
      const h = Hands[side];
      if (!h.tracked) {
        this.poking[side] = false;
        continue;
      }
      const palm = this.palmL[side];
      const pinch = this.pinchL[side];

      // --- pinch starts: seed first, then cloud ---
      if (h.pinchStarted && this.phase === 'play') {
        if (!this.seedHolder && this.seed.visible && pinch.distanceTo(this.seed.position) < 0.04) {
          this.seedHolder = side;
          this.seedFirm.copy(this.seed.position);
          Sfx.pluck();
        } else if (!this.cloudHolder && cloud.distanceTo(pinch) < 0.02) {
          this.cloudHolder = side;
          this.cloudGrab.copy(cloud.pos).sub(pinch);
          Sfx.squish(0.2);
        }
      }

      // --- cloud hover / wring ---
      const dPalm = cloud.distanceTo(palm);
      if (dPalm < 0.03) hover = 1;
      if (dPalm < 0.03 && !h.pinching && h.curl > 0.35 && this.cloudHolder !== side) {
        squeeze = Math.max(squeeze, Math.min(1, (h.curl - 0.35) / 0.55));
      }

      // --- poke the cloud: lightning ---
      const dIdx = cloud.distanceTo(this.indexL[side]);
      const poke = h.pointing && dIdx < 0.006;
      if (poke && !this.poking[side] && this.lightningCd <= 0 && this.phase === 'play') this.lightning();
      this.poking[side] = poke;

      // --- fist low over fire: smother ---
      if (h.fist && palm.y < 0.09 && palm.y > -0.02) {
        const ti = this.island.tileAtLocal(palm.x, palm.z);
        if (ti >= 0) this.smother(ti);
      }

      // --- tablets: crush (fist) and bless (palm up) ---
      for (let k = this.tablets.length - 1; k >= 0; k--) {
        const t = this.tablets[k];
        if (!t.done || t === this.chiselling) continue;
        const d = palm.distanceTo(t.root.position);
        if (h.fistStarted && d < 0.065) {
          if (t.blessed) {
            t.shake = 0.6; // blessed laws cannot be broken
            Sfx.squish(0.8);
          } else {
            this.crushTablet(t);
            continue;
          }
        }
        if (h.palmUp && !t.blessed && d < 0.09) {
          const held = (this.blessHold.get(t) ?? 0) + dt;
          this.blessHold.set(t, held);
          t.shake = Math.max(t.shake, 0.15);
          if (held > 0.7) this.blessTablet(t);
        }
      }
    }
    for (const t of this.tablets) {
      // decay bless hold when no palm is under it (cheap: shrink every frame)
      const v = this.blessHold.get(t);
      if (v) this.blessHold.set(t, Math.max(0, v - dt * 0.5));
    }

    // --- carried seed ---
    if (this.seedHolder) {
      const h = Hands[this.seedHolder];
      const p = this.pinchL[this.seedHolder];
      // Only follow while the fingers are firmly closed: opening the hand moves
      // the pinch point a frame or two before release registers.
      if (h.pinchDistance < 0.026) {
        this.seed.position.lerp(p, 0.6);
        this.seedFirm.copy(this.seed.position);
      }
      if (h.pinchEnded || !h.pinching || h.lostFor > 0.3) {
        this.seed.position.copy(this.seedFirm);
        this.dropSeed();
        this.seedHolder = null;
      }
    }

    // --- dragged cloud ---
    if (this.cloudHolder) {
      const h = Hands[this.cloudHolder];
      if (h.pinching && h.lostFor < 0.3) {
        this.tmpL.copy(this.pinchL[this.cloudHolder]).add(this.cloudGrab);
        const r = Math.hypot(this.tmpL.x, this.tmpL.z);
        if (r > 0.24) {
          this.tmpL.x *= 0.24 / r;
          this.tmpL.z *= 0.24 / r;
        }
        this.tmpL.y = Math.max(0.09, Math.min(0.34, this.tmpL.y));
        cloud.pos.lerp(this.tmpL, 0.35);
      } else this.cloudHolder = null;
    }

    cloud.squeeze += (squeeze - cloud.squeeze) * Math.min(1, dt * 10);
    cloud.hover += ((hover || this.cloudHolder ? 1 : 0) - cloud.hover) * Math.min(1, dt * 8);
    if (squeeze > 0.05) Sfx.squish(squeeze);
  }

  private dropSeed() {
    const s = this.seed.position;
    const ti = this.island.tileAtLocal(s.x, s.z);
    const t = ti >= 0 ? this.island.tiles[ti] : null;
    const low = s.y < 0.12;
    if (t && low && t.fire <= 0 && (t.type === Tile.Stump || t.type === Tile.Grass || t.type === Tile.Dust)) {
      const wasBarren = t.type === Tile.Stump || t.type === Tile.Dust;
      this.island.setType(ti, Tile.Sapling);
      t.growth = 0.05;
      this.islandRender.popTile(ti);
      this.island.centreOf(ti, this.pt);
      this.fx.burst(this.pt.x, this.pt.y + 0.006, this.pt.z, 10, [0x8be05a, 0x7b5236, 0xfff1a8], 0.1, 0.003, 0.7);
      Sfx.plant();
      this.faith = Math.min(1, this.faith + 0.01);
      if (wasBarren) this.omen('plant', ti);
      this.seed.visible = false;
      this.seedRespawn = 1.6;
    } else {
      Sfx.pop(); // floats back home
    }
  }

  private smother(ti: number) {
    const isl = this.island;
    let any = false;
    isl.neighbours(ti, this.nb);
    this.nb.push(ti);
    for (const n of this.nb) {
      const t = isl.tiles[n];
      if (t.fire > 0) {
        t.fire = 0;
        t.wet = Math.max(t.wet, 0.4);
        isl.dirty.add(n);
        isl.centreOf(n, this.pt);
        this.fx.burst(this.pt.x, this.pt.y + 0.01, this.pt.z, 6, [0x9a9a9a, 0xcfcfcf], 0.05, 0.004, 1.0);
        any = true;
      }
    }
    if (any) {
      this.smothered++;
      Sfx.sizzle();
      this.omen('smother', ti);
    }
  }

  private lightning() {
    this.lightningCd = 1.1;
    this.lightningCount++;
    const c = this.cloud.pos;
    const ti = this.island.tileAtLocal(c.x, c.z);
    let gy = -0.04;
    if (ti >= 0) {
      const t = this.island.tiles[ti];
      gy = t.h + 0.002;
      if (t.wet < 0.3 && (t.type === Tile.Tree || t.type === Tile.Grass || t.type === Tile.Sapling || t.type === Tile.Hut || t.type === Tile.Stump)) {
        t.fire = Math.max(t.fire, 0.6);
        this.island.dirty.add(ti);
      }
      this.island.centreOf(ti, this.pt);
      this.fx.burst(this.pt.x, gy + 0.004, this.pt.z, 16, [0xfff6c0, 0xffb347, 0xffffff], 0.25, 0.004, 0.6);
    }
    this.cloud.strike(c.x, gy, c.z);
    this.flashMat.opacity = 0.75;
    this.flash.visible = true;
    this.hitStop = 0.12;
    Sfx.thunder();
    this.village.scare(c.x, c.z, 0.09);
    this.fear = Math.min(1, this.fear + 0.12);
    this.faith = Math.max(0, this.faith - 0.04);
    if (this.witness >= 0) this.village.villagers[this.witness].watching = 0;
    this.witness = -1;
  }

  // ---------------------------------------------------------------------------
  // Gaze: the witness
  // ---------------------------------------------------------------------------

  private updateGaze(dt: number) {
    this.fwdW.set(0, 0, -1).applyQuaternion(this.player.head.getWorldQuaternion(this.tmp2Quat));
    let best: Villager | null = null;
    let bestA = 0.17; // ~10 degrees
    for (const v of this.village.villagers) {
      if (v.state === VState.Flee) continue;
      this.tmpW.set(v.x, v.y + 0.022, v.z).applyMatrix4(Stage.root.matrixWorld).sub(this.headW);
      const len = this.tmpW.length();
      if (len < 1e-3) continue;
      const a = Math.acos(Math.max(-1, Math.min(1, this.tmpW.dot(this.fwdW) / len)));
      if (a < bestA) {
        bestA = a;
        best = v;
      }
    }
    for (const v of this.village.villagers) if (v !== best) v.gazed = 0;
    if (!best) return;
    best.gazed += dt;
    if (best.gazed > 0.3) {
      if (this.witness !== best.id) {
        if (this.witness >= 0 && this.village.villagers[this.witness]) this.village.villagers[this.witness].watching = Math.min(this.village.villagers[this.witness].watching, 0.6);
        this.witness = best.id;
        this.everWitness = true;
        best.hop = 1;
        best.watching = 5;
        Sfx.gasp(best.id);
        this.bubblePop = 1;
      }
      best.watching = Math.max(best.watching, 3.5);
    }
  }
  private tmp2Quat = new Quaternion();
  private bubblePop = 0;

  /** The current witness, if they are still looking up at the Hand. */
  private activeWitness(): Villager | null {
    if (this.witness < 0) return null;
    const v = this.village.villagers[this.witness];
    return v && v.watching > 0 && v.state === VState.Watching ? v : null;
  }

  // ---------------------------------------------------------------------------
  // Omens -> Scribe -> Tablets
  // ---------------------------------------------------------------------------

  private omenActive(o: Omen): boolean {
    const c = CANDIDATES[o];
    return this.village.laws.has(c.faithful) || this.village.laws.has(c.misread) || this.tablets.some((t) => LAW_INFO[t.law].omen === o);
  }

  private omen(o: Omen, _tile: number) {
    if (this.phase !== 'play' || this.pendingReading || this.chiselling) return;
    const w = this.activeWitness();
    if (!w) return;
    if (this.omenActive(o) || this.tablets.length >= TABLET_SLOTS.length) return;
    this.pendingReading = true;
    w.hop = 1;
    w.watching = Math.max(w.watching, 3);
    Sfx.gasp(w.id + 1);
    // second ever reading is a guaranteed (funny) misread if none happened yet
    const forceLaw = this.readings === 1 && this.misreads === 0 ? CANDIDATES[o].misread : undefined;
    void readOmen({
      omen: o,
      witnessName: villagerName(w.id),
      laws: [...this.village.laws],
      crushed: [...this.crushed],
      health: this.health,
      population: this.village.villagers.length,
      forceFaithful: this.readings === 0,
      forceLaw,
      fear: this.fear,
      faith: this.faith,
    }).then((r) => this.onReading(r));
  }

  private onReading(r: Reading) {
    this.pendingReading = false;
    if (this.phase !== 'play') return;
    this.readings++;
    if (!LAW_INFO[r.law].faithful) this.misreads++;
    const numeral = NUMERALS[Math.min(NUMERALS.length - 1, this.readings - 1)];
    const t = new Tablet(r.law, r.verse, numeral);
    let slot = 0;
    const used = new Set(this.tabletSlot.values());
    for (const s of TABLET_SLOTS) {
      if (!used.has(s)) {
        slot = s;
        break;
      }
    }
    this.tabletSlot.set(t, slot);
    this.tablets.push(t);
    Stage.root.add(t.root);
    this.placeTablet(t, slot);
    this.chiselling = t;
    this.chiselT = 0.5;
    if (r.source === 'ai') console.info('[scribe] ai reading', r.law, r.verse);
  }

  private placeTablet(t: Tablet, slot: number) {
    const a = ((slot - 3.5) / 3.5) * 1.15;
    t.root.position.set(Math.sin(a) * TABLET_R, TABLET_Y, -Math.cos(a) * TABLET_R);
  }

  private finishTablet(t: Tablet) {
    this.chiselling = null;
    this.village.laws.add(t.law);
    Sfx.commandment();
    const faithful = LAW_INFO[t.law].faithful;
    if (faithful) this.faith = Math.min(1, this.faith + 0.08);
    for (const v of this.village.villagers) {
      if (v.state === VState.Flee) continue;
      v.hop = 1;
      Sfx.gibber(v.id);
    }
    const isNew = Book.addLaw(t.law, t.text);
    this.glow.burst(t.root.position.x, t.root.position.y + 0.04, t.root.position.z, 18, [0xffe9a0, 0xffd34d], 0.12, 0.003, 1.0);
    if (isNew) {
      this.banner.show('A NEW LAW', `BOOK OF THE HAND  ${Book.data.laws.length}/${ALL_LAWS.length}`, 2.6, faithful ? 'stone' : 'gold');
    }
  }

  private crushTablet(t: Tablet) {
    const p = t.root.position;
    this.fx.burst(p.x, p.y, p.z, 26, [0x8b8378, 0xa39a8c, 0x6e665c, 0xd9cfbf], 0.22, 0.005, 1.0);
    Sfx.crush();
    this.hitStop = Math.max(this.hitStop, 0.06);
    this.village.laws.delete(t.law);
    this.crushed.push(t.law);
    this.crushes++;
    if (LAW_INFO[t.law].faithful) this.fear = Math.min(1, this.fear + 0.08);
    else this.faith = Math.min(1, this.faith + 0.05);
    for (const v of this.village.villagers) {
      if (v.state === VState.Flee || v.state === VState.Gather) continue;
      v.lookUp = 1;
      v.hop = Math.max(v.hop, 0.5);
    }
    this.removeTablet(t);
    this.tablets.splice(this.tablets.indexOf(t), 1);
  }

  private blessTablet(t: Tablet) {
    t.bless();
    this.blesses++;
    this.blessHold.delete(t);
    this.faith = Math.min(1, this.faith + 0.1);
    const p = t.root.position;
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      this.glow.spawn({
        x: p.x,
        y: p.y,
        z: p.z,
        vx: Math.cos(a) * 0.12,
        vy: 0.02,
        vz: Math.sin(a) * 0.12,
        gravity: 0,
        drag: 2.5,
        life: 1.1,
        size: 0.004,
        color: k % 2 ? 0xffd34d : 0xfff1a8,
      });
    }
    Sfx.bless();
  }

  private removeTablet(t: Tablet) {
    Stage.root.remove(t.root);
    disposeTree(t.root);
    this.tabletSlot.delete(t);
    this.blessHold.delete(t);
    if (this.chiselling === t) this.chiselling = null;
  }

  private updateTablets(dt: number) {
    for (const t of this.tablets) {
      t.update(dt);
      const slot = this.tabletSlot.get(t) ?? 0;
      this.placeTablet(t, slot);
      const r = easeOutBack(t.rise);
      t.root.position.y = TABLET_Y - (1 - r) * 0.14;
      if (t.shake > 0) t.root.position.x += Math.sin(performance.now() * 0.08) * 0.002 * t.shake;
      t.root.rotation.set(-0.12, Math.atan2(this.headL.x - t.root.position.x, this.headL.z - t.root.position.z), 0);
    }
    const c = this.chiselling;
    if (c && c.rise >= 1) {
      this.chiselT -= dt;
      if (this.chiselT <= 0) {
        this.chiselT = 0.055;
        if (c.chiselStep()) {
          Sfx.chisel();
          const p = c.root.position;
          this.fx.spawn({
            x: p.x + (Math.random() - 0.5) * 0.04,
            y: p.y + 0.01 + (Math.random() - 0.5) * 0.03,
            z: p.z + 0.01,
            vx: (Math.random() - 0.5) * 0.08,
            vy: 0.08,
            vz: 0.05,
            life: 0.5,
            size: 0.0022,
            color: 0xd9cfbf,
            gravity: -0.6,
          });
        }
        if (c.done) this.finishTablet(c);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Timeline: Ages, scripted beats, hints
  // ---------------------------------------------------------------------------

  private updateTimeline() {
    const want = this.clock >= AGE3_AT ? 2 : this.clock >= AGE2_AT ? 1 : 0;
    if (want !== this.age) {
      this.age = want;
      const body =
        want === 1
          ? 'THEY HAVE LEARNED FIRE. WATCH THE SMOKE.'
          : 'MORE MOUTHS, MORE NETS. HOLD THE LAND TOGETHER.';
      this.banner.show(AGES[want], body, 4.5);
      Sfx.fanfare();
    }
    this.village.workRate = this.age === 2 ? 1.25 : 1;
    this.village.hunger = this.age === 2 ? 0.017 : 0.012;

    // 0:30 a villager looks up on their own: teaches that they can see you
    if (!this.lookedUp && this.clock > 30 && !this.everWitness) {
      this.lookedUp = true;
      const v = this.village.villagers[0];
      if (v) {
        v.watching = 2.5;
        v.hop = 1;
        Sfx.gasp(1);
      }
    }
    // ~1:50 make sure there is dust to heal
    if (!this.forcedDust && this.clock > 110) {
      this.forcedDust = true;
      if (this.island.count(Tile.Dust) === 0) this.forceDust();
    }
    if (this.clock >= FESTIVAL_AT) this.beginFestival();

    // hint selection
    let idx = -1;
    for (let i = 0; i < this.hints.length; i++) {
      const h = this.hints[i];
      if (h.avail() && !h.done()) {
        idx = i;
        break;
      }
    }
    this.hintIdx = idx;
  }

  private forceDust() {
    const isl = this.island;
    let made = 0;
    for (let i = 0; i < isl.tiles.length && made < 3; i++) {
      if (isl.tiles[i].type === Tile.Stump) {
        isl.setType(i, Tile.Dust);
        this.puff(i);
        made++;
      }
    }
    for (let i = isl.tiles.length - 1; i >= 0 && made < 3; i--) {
      const t = isl.tiles[i];
      if (t.type === Tile.Grass && t.claimedBy < 0 && i % 3 === 0) {
        isl.setType(i, Tile.Dust);
        this.puff(i);
        made++;
      }
    }
  }

  private puff(ti: number) {
    this.island.centreOf(ti, this.pt);
    this.fx.burst(this.pt.x, this.pt.y + 0.004, this.pt.z, 6, [0xd2b072, 0xc49d5e], 0.05, 0.004, 0.8);
  }

  private burning(): number {
    let n = 0;
    for (const t of this.island.tiles) if (t.fire > 0) n++;
    return n;
  }

  private deadPonds(): number {
    let n = 0;
    for (const t of this.island.tiles) if (t.type === Tile.Water && t.fish === 0) n++;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  private updateSim(dt: number) {
    if (dt <= 0) return;
    const isl = this.island;
    const cloud = this.cloud;
    this.village.cloud.x = cloud.pos.x;
    this.village.cloud.z = cloud.pos.z;
    this.village.cloud.active = cloud.squeeze > 0.15;

    // --- rain (per frame, from the cloud footprint) ---
    const rate = this.phase === 'play' || this.phase === 'festival' ? cloud.squeeze : 0;
    if (rate > 0.05) {
      this.rainedFor += dt;
      let onDust = false;
      let onPond = false;
      const r = 0.05 + rate * 0.02;
      for (let i = 0; i < isl.tiles.length; i++) {
        const t = isl.tiles[i];
        if (t.type === Tile.Void) continue;
        isl.centreOf(i, this.pt);
        if (Math.hypot(this.pt.x - cloud.pos.x, this.pt.z - cloud.pos.z) > r) continue;
        const wasWet = t.wet;
        t.wet = Math.min(1, t.wet + dt * rate * 2);
        if (t.type === Tile.Dust) {
          t.soak += dt * rate * 0.45;
          onDust = true;
        }
        if (t.fire > 0) {
          t.fire = Math.max(0, t.fire - dt * rate * 3);
          Sfx.sizzle();
          if (t.fire === 0) this.smothered++;
        }
        if (t.type === Tile.Water) {
          if (t.fish < 3) onPond = true;
          t.soak += dt * rate;
          if (t.soak > 1.2 && t.fish < 3) {
            t.soak = 0;
            t.fish++;
            this.fx.burst(this.pt.x, this.pt.y + 0.004, this.pt.z, 5, [0x9fd3e6, 0xffffff], 0.08, 0.003, 0.5);
            Sfx.splash();
          }
        }
        if ((wasWet < 0.3) !== (t.wet < 0.3)) isl.dirty.add(i);
      }
      this.rainOnDust = onDust ? this.rainOnDust + dt : Math.max(0, this.rainOnDust - dt);
      this.rainOnPond = onPond ? this.rainOnPond + dt : Math.max(0, this.rainOnPond - dt);
      if (this.rainOnDust > 0.8) this.omen('rainDust', -1);
      if (this.rainOnPond > 0.8) this.omen('rainPond', -1);
      // voxel rain streaks
      const n = Math.random() < rate * dt * 70 ? 1 + Math.floor(rate * 2) : 0;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * r;
        this.fx.spawn({
          x: cloud.pos.x + Math.cos(a) * rr,
          y: cloud.pos.y - 0.015,
          z: cloud.pos.z + Math.sin(a) * rr,
          vy: -0.55,
          gravity: -0.4,
          life: 1.2,
          size: 0.0022,
          stretch: 3.5,
          color: 0x7fd0f0,
          floor: TOP_Y,
          shrink: false,
        });
      }
    } else {
      // omens need rain to be falling right now, not remembered rain
      this.rainOnDust = 0;
      this.rainOnPond = 0;
    }

    // --- tile tick at 4 Hz ---
    this.simAcc += dt;
    while (this.simAcc >= 0.25) {
      this.simAcc -= 0.25;
      this.tick(0.25);
    }

    if (this.phase !== 'end' || this.ending !== 'exodus') this.village.update(dt, this.clock);

    // fire particles (cheap: random burning tiles)
    for (let i = 0; i < isl.tiles.length; i++) {
      const t = isl.tiles[i];
      if (t.fire <= 0) continue;
      if (Math.random() < dt * 14 * t.fire) {
        isl.centreOf(i, this.pt);
        const tall = t.type === Tile.Tree ? 0.03 : 0.006;
        this.fx.spawn({
          x: this.pt.x + (Math.random() - 0.5) * TILE * 0.7,
          y: this.pt.y + tall * Math.random(),
          z: this.pt.z + (Math.random() - 0.5) * TILE * 0.7,
          vy: 0.05 + Math.random() * 0.04,
          gravity: 0.05,
          life: 0.55,
          size: 0.004 + t.fire * 0.003,
          color: Math.random() < 0.5 ? 0xff7a1f : Math.random() < 0.5 ? 0xffc23d : 0xd8401c,
        });
        if (Math.random() < 0.15) {
          this.fx.spawn({
            x: this.pt.x,
            y: this.pt.y + tall + 0.01,
            z: this.pt.z,
            vx: (Math.random() - 0.5) * 0.01,
            vy: 0.04,
            gravity: 0.01,
            life: 1.8,
            size: 0.006,
            color: 0x6b6460,
          });
        }
        Sfx.fire();
      }
    }
  }

  private tick(step: number) {
    const isl = this.island;
    const fireWatch = this.village.laws.has('fireWatch');
    const playing = this.phase === 'play';
    for (let i = 0; i < isl.tiles.length; i++) {
      const t = isl.tiles[i];
      if (t.type === Tile.Void) continue;
      t.age += step;
      if (t.wet > 0) {
        const before = t.wet;
        t.wet = Math.max(0, t.wet - step * 0.04);
        if ((before >= 0.3) !== (t.wet >= 0.3)) isl.dirty.add(i);
      }
      if (t.burnt > 0 && t.fire <= 0) t.burnt = Math.max(0, t.burnt - step * 0.05);

      switch (t.type) {
        case Tile.Sapling: {
          const before = Math.floor(t.growth * 6);
          t.growth += step * (0.03 + t.wet * 0.09);
          if (t.growth >= 1) {
            isl.setType(i, Tile.Tree);
            this.islandRender.popTile(i);
            isl.centreOf(i, this.pt);
            this.fx.burst(this.pt.x, this.pt.y + 0.03, this.pt.z, 12, [0x6dbb45, 0x8be05a, 0x3fa34a, 0xf2e05c], 0.1, 0.0035, 1.1);
            Sfx.pop();
          } else if (Math.floor(t.growth * 6) !== before) isl.dirty.add(i);
          break;
        }
        case Tile.Stump: {
          if (!playing) break;
          isl.neighbours(i, this.nb);
          let barren = 0;
          for (const n of this.nb) {
            const nt = isl.tiles[n].type;
            if (nt === Tile.Stump || nt === Tile.Dust) barren++;
          }
          const chance = barren >= 3 ? 0.035 : barren >= 1 && t.age > 60 ? 0.012 : 0;
          if (t.age > 20 && t.claimedBy < 0 && Math.random() < chance * step) {
            isl.setType(i, Tile.Dust);
            this.puff(i);
          }
          break;
        }
        case Tile.Dust: {
          if (t.soak >= 1) {
            isl.setType(i, Tile.Grass);
            this.islandRender.popTile(i);
            isl.centreOf(i, this.pt);
            this.fx.burst(this.pt.x, this.pt.y + 0.004, this.pt.z, 8, [0x6dbb45, 0x8be05a], 0.07, 0.003, 0.7);
            Sfx.pop();
            break;
          }
          break;
        }
        case Tile.Water: {
          if (t.fish > 0 && t.fish < 3 && Math.random() < step * 0.012) {
            t.fish++;
            isl.dirty.add(i);
          }
          break;
        }
      }

      // --- fire ---
      if (t.fire > 0) {
        t.burnt += step;
        if (t.wet > 0.3) t.fire = Math.max(0, t.fire - step * 1.5);
        else t.fire = Math.min(1, t.fire + step * 0.35);
        if (fireWatch && t.burnt > 1.5) t.fire = Math.max(0, t.fire - step * 0.6); // villagers douse it
        if (!fireWatch && t.fire > 0.4 && Math.random() < step * 0.22) {
          isl.neighbours(i, this.nb);
          const n = this.nb[Math.floor(Math.random() * this.nb.length)];
          const nt = n !== undefined ? isl.tiles[n] : null;
          if (nt && nt.fire <= 0 && nt.wet < 0.3 && flammable(nt.type)) {
            nt.fire = 0.2;
            isl.dirty.add(n);
          }
        }
        if (t.burnt > 7 && t.fire > 0) {
          // burns out
          t.fire = 0;
          if (t.type === Tile.Tree) isl.setType(i, Tile.Stump);
          else if (t.type === Tile.Hut) this.burnHut(i);
          else isl.setType(i, Tile.Dust);
          this.puff(i);
        }
        isl.dirty.add(i);
      }
    }

    // dust creeps into grass on a global clock: linear pressure the player can outpace
    if (playing) {
      this.dustT -= step;
      if (this.dustT <= 0) {
        this.dustT = this.age === 0 ? 10 : this.age === 1 ? 7 : 5.5;
        this.creepDust();
      }
    }

    // campfires in the Age of Smoke
    if (this.phase === 'play' && this.age >= 1 && !this.village.laws.has('noWarmth')) {
      this.campfireT -= step;
      if (this.campfireT <= 0) {
        this.campfireT = 24 + Math.random() * 14;
        this.lightCampfire();
      }
    }

    // fear fades slowly; faith drifts back toward devotion when the Hand is kind
    this.fear = Math.max(0, this.fear - step * 0.003);

    // land health (eased so the HUD bar breathes)
    this.health += (isl.health() - this.health) * 0.2;
  }

  private creepDust() {
    const isl = this.island;
    // pick a random dry dust tile and spread into one dry grass neighbour
    const n = isl.tiles.length;
    const start = Math.floor(Math.random() * n);
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      const t = isl.tiles[i];
      if (t.type !== Tile.Dust || t.wet > 0.2) continue;
      isl.neighbours(i, this.nb);
      const j = this.nb[Math.floor(Math.random() * this.nb.length)];
      const nt = j !== undefined ? isl.tiles[j] : null;
      if (nt && nt.type === Tile.Grass && nt.wet < 0.2 && nt.claimedBy < 0) {
        isl.setType(j, Tile.Dust);
        this.puff(j);
        return;
      }
    }
  }

  private lightCampfire() {
    const isl = this.island;
    if (!isl.huts.length) return;
    const hut = isl.huts[Math.floor(Math.random() * isl.huts.length)];
    isl.neighbours(hut, this.nb);
    for (const n of this.nb) {
      const t = isl.tiles[n];
      if ((t.type === Tile.Grass || t.type === Tile.Dust || t.type === Tile.Stump) && t.fire <= 0 && t.wet < 0.3) {
        t.fire = 0.25;
        t.burnt = 0;
        isl.dirty.add(n);
        Sfx.fire();
        return;
      }
    }
  }

  private burnHut(i: number) {
    const isl = this.island;
    const k = isl.huts.indexOf(i);
    if (k >= 0 && isl.huts.length > 1) {
      isl.huts.splice(k, 1);
      isl.setType(i, Tile.Dust);
      this.fear = Math.min(1, this.fear + 0.05);
    } else {
      // never burn the last hut down: it chars
      isl.tiles[i].fire = 0;
    }
  }

  private onRainLand(x: number, z: number) {
    Sfx.plink(Math.floor((x + z) * 1000) & 0xff);
    if (Math.random() < 0.3) {
      this.fx.spawn({ x, y: TOP_Y + 0.001, z, vy: 0.05, gravity: -0.5, life: 0.18, size: 0.0025, color: 0xbfe8f8 });
    }
  }

  // ---------------------------------------------------------------------------
  // Festival and endings
  // ---------------------------------------------------------------------------

  private beginFestival() {
    this.phase = 'festival';
    this.festT = 0;
    this.festStage = 0;
    this.festReadIdx = -1;
    this.village.festival = true;
    this.hintIdx = -1;
    if (this.witness >= 0) this.witness = -1;
    this.banner.show('THE FESTIVAL', 'THEY GATHER TO READ YOUR LAWS ALOUD', 4.5, 'gold');
    Sfx.fanfare();
  }

  private updateFestival(dt: number) {
    this.festT += dt;
    // stage 0: gathering (5 s) -> stage 1: readings -> 2: lanterns -> 3: put out the sun
    if (this.festStage === 0 && this.festT > 5) {
      this.festStage = 1;
      this.festT = 0;
    }
    if (this.festStage === 1) {
      const per = 3.4;
      const idx = Math.floor(this.festT / per);
      if (idx !== this.festReadIdx) {
        this.festReadIdx = idx;
        const ordered = this.orderedTablets();
        if (idx < ordered.length) {
          const t = ordered[idx];
          t.shake = 0.5;
          this.banner.show(t.numeral, t.text, per - 0.3, t.blessed ? 'gold' : 'stone');
          Sfx.commandment();
          if (!LAW_INFO[t.law].faithful) Sfx.gibber(idx + 5);
          for (const v of this.village.villagers) v.hop = 1;
        } else {
          if (!ordered.length) this.banner.show('NO LAWS', 'THE HAND NEVER SPOKE. THEY MADE UP THEIR OWN.', 3);
          this.festStage = 2;
          this.festT = 0;
        }
      }
    }
    if (this.festStage === 2) {
      // lanterns float up past the player's face
      if (this.festT < 7 && Math.random() < dt * 9) this.spawnLantern();
      if (this.festT > 4 && this.festT - dt <= 4) {
        this.banner.show('MAKE A FIST', 'TO PUT OUT THE SUN', 0, 'night');
      }
      let fist = false;
      for (const s of HAND_SIDES) if (Hands[s].fistStarted) fist = true;
      if ((this.festT > 4.5 && fist) || this.festT > 14) {
        this.darkWant = 0.78;
        this.festStage = 3;
        this.festT = 0;
        Sfx.thunder();
        this.banner.hide();
      }
    }
    if (this.festStage === 3) {
      if (Math.random() < dt * 6 && this.festT < 6) this.spawnLantern();
      if (this.festT > 3.5) this.finishGame();
    }
  }

  private orderedTablets(): Tablet[] {
    // stable reading order: by numeral (creation order)
    return this.tablets.slice().sort((a, b) => NUMERALS.indexOf(a.numeral) - NUMERALS.indexOf(b.numeral));
  }

  private spawnLantern() {
    const vs = this.village.villagers;
    const v = vs[Math.floor(Math.random() * vs.length)];
    const x = v ? v.x : 0;
    const z = v ? v.z : 0;
    this.glow.spawn({
      x,
      y: TOP_Y + 0.02,
      z,
      vx: (Math.random() - 0.5) * 0.01 + (this.headL.x - x) * 0.012,
      vy: 0.035 + Math.random() * 0.02,
      vz: (Math.random() - 0.5) * 0.01 + (this.headL.z - z) * 0.012,
      gravity: 0.002,
      life: 14,
      size: 0.007,
      color: Math.random() < 0.5 ? 0xffb347 : 0xffd27a,
      shrink: false,
    });
    Sfx.plink(Math.floor(Math.random() * 6));
  }

  private finishGame() {
    const pop = this.village.villagers.length;
    const health = this.island.health();
    let e: Ending;
    if (health < 0.4) e = 'exodus';
    else if (health >= 0.72 && pop >= 12 && this.fear < 0.45) e = 'harmony';
    else e = 'zealotry';
    this.ending = e;
    this.phase = 'end';
    this.festT = 0;
    Book.addEnding(e, pop);
    const laws = this.tablets.length;
    const book = `BOOK ${Book.data.laws.length}/${ALL_LAWS.length}`;
    if (e === 'harmony') {
      this.banner.show('HARMONY', `${pop} SOULS. ${laws} LAWS. THEY TEND THE LAND AS YOU DID. ${book}. PINCH TO PLAY AGAIN.`, 0, 'gold');
      Sfx.fanfare();
    } else if (e === 'zealotry') {
      const why = this.fear >= 0.45 ? `${pop} SOULS WATCH THE SKY IN FEAR. THEY OBEY. THEY DO NOT SING.` : `ONLY ${pop} SOULS REMAIN, AND THEY GUARD YOUR LAWS FIERCELY.`;
      this.banner.show('ZEALOTRY', `THE LAND LIVES. ${why} ${book}. PINCH TO PLAY AGAIN.`, 0, 'stone');
    } else {
      this.banner.show('EXODUS', `THE LAND IS DUST. THEY SAIL OFF THE EDGE OF YOUR DESK. ${book}. PINCH TO PLAY AGAIN.`, 0, 'night');
      this.startExodus();
    }
    this.village.festival = e !== 'exodus';
  }

  private startExodus() {
    this.exodusT = 0;
    this.raft.visible = true;
    this.raft.position.set(0.255, TOP_Y - 0.01, 0.02);
    this.raft.rotation.set(0, 0, 0);
    this.village.festival = false;
    for (const v of this.village.villagers) {
      this.village.release(v);
      v.state = VState.Gather;
      v.gx = 0.215;
      v.gz = 0.02 + (v.id % 4) * 0.006;
    }
  }

  private updateEnd(realDt: number, dt: number) {
    this.festT += realDt;
    if (this.ending === 'exodus') {
      this.exodusT += dt;
      // villagers walk to the raft; whoever arrives climbs aboard
      const vs = this.village.villagers;
      for (let k = vs.length - 1; k >= 0; k--) {
        const v = vs[k];
        const d = Math.hypot(v.x - v.gx, v.z - v.gz);
        if (d < 0.012 || this.exodusT > 14) {
          vs.splice(k, 1);
          Sfx.pop();
          continue;
        }
        const s = (0.03 * dt) / Math.max(d, 1e-4);
        v.x += (v.gx - v.x) * Math.min(1, s);
        v.z += (v.gz - v.z) * Math.min(1, s);
        v.heading = Math.atan2(v.gx - v.x, v.gz - v.z);
        v.bob += dt * 14;
      }
      if (vs.length === 0 || this.exodusT > 14) {
        // sail away off the desk
        this.raft.position.x += dt * 0.05;
        this.raft.position.y -= dt * 0.012 * Math.max(0, this.raft.position.x - 0.35) * 30;
        this.raft.rotation.z = Math.sin(this.exodusT * 2) * 0.06;
        if (this.raft.position.x > 0.7) this.raft.visible = false;
        if (!this.tablets.some((t) => t.text === 'THE HAND WATCHED.') && this.exodusT > 4) {
          const t = new Tablet('replant', 'The Hand watched.', '');
          t.blessed = false;
          this.tablets.push(t);
          this.tabletSlot.set(t, TABLET_SLOTS[Math.min(this.tablets.length - 1, 7)]);
          Stage.root.add(t.root);
          for (let i = 0; i < t.text.length; i++) t.chiselStep();
          Sfx.commandment();
        }
      }
    }
    // pinch anywhere (away from the rim) to play again
    if (this.festT > 3) {
      for (const s of HAND_SIDES) {
        const h = Hands[s];
        if (!h.pinchStarted) continue;
        const p = this.pinchL[s];
        if (Math.abs(Math.hypot(p.x, p.z) - Stage.radius) < 0.07) continue;
        this.darkWant = 0;
        this.banner.hide();
        this.startGame();
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Visuals
  // ---------------------------------------------------------------------------

  private updateVisuals(realDt: number, dt: number) {
    const palm = this.nearestPalm();
    this.islandRender.update(dt, this.health);

    // eyes follow the nearest hand, heads tilt to the player
    if (palm) this.villageRender.lookTarget.copy(palm);
    else this.villageRender.lookTarget.copy(this.headL);
    this.villageRender.headTarget.copy(this.headL);
    for (const v of this.village.villagers) {
      let want = 0;
      if (palm && palm.y < 0.16) {
        const d = Math.hypot(palm.x - v.x, palm.z - v.z);
        if (d < 0.04) want = 1 - d / 0.04;
      }
      v.duck += (want - v.duck) * Math.min(1, realDt * 8);
    }
    this.villageRender.update();

    this.cloud.update(realDt, palm, TOP_Y);
    this.fx.update(dt > 0 ? dt : realDt * 0.05);
    this.glow.update(realDt);
    this.banner.update(realDt);

    // witness "!" bubble above the witness's head
    const w = this.activeWitness();
    const b = this.witnessBubble.mesh;
    if (w && (this.phase === 'play')) {
      b.visible = true;
      this.bubblePop = Math.max(0, this.bubblePop - realDt * 3);
      const s = 1 + Math.sin(this.bubblePop * Math.PI) * 0.6;
      b.scale.setScalar(s);
      b.position.set(w.x, w.y + 0.044 + Math.sin(performance.now() * 0.006) * 0.0015, w.z);
      b.lookAt(this.headW);
      this.witnessBubble.set(this.pendingReading ? '...' : '!', '#fff3b0', '#3a2a1a');
    } else b.visible = false;

    // seed pod: bob at home, glow when the hint asks for it
    if (!this.seed.visible) {
      this.seedRespawn -= realDt;
      if (this.seedRespawn <= 0 && this.phase === 'play') {
        this.seed.visible = true;
        this.seed.position.copy(SEED_HOME);
        this.seed.scale.setScalar(0.01);
      }
    }
    if (this.seed.visible) {
      const s = this.seed.scale.x;
      this.seed.scale.setScalar(s + (1 - s) * Math.min(1, realDt * 8));
      if (!this.seedHolder) {
        this.tmpL.copy(SEED_HOME);
        this.tmpL.y += Math.sin(performance.now() * 0.003) * 0.004;
        this.seed.position.lerp(this.tmpL, Math.min(1, realDt * 5));
        this.seed.rotation.y += realDt * 0.8;
      }
      const wantGlow = this.hintIdx === 2 ? 0.35 + 0.3 * Math.sin(performance.now() * 0.008) : 0.18;
      this.seedGlow.opacity += (wantGlow - this.seedGlow.opacity) * Math.min(1, realDt * 6);
    }
    this.seed.visible = this.seed.visible && this.phase !== 'end';

    // lightning flash and room darkness both live around the player's head
    if (this.flash.visible) {
      this.flash.position.copy(this.headL);
      this.flashMat.opacity = Math.max(0, this.flashMat.opacity - realDt * 4);
      if (this.flashMat.opacity <= 0) this.flash.visible = false;
    }
    this.darkMat.opacity += (this.darkWant - this.darkMat.opacity) * Math.min(1, realDt * 1.2);
    this.dark.visible = this.darkMat.opacity > 0.01;
    if (this.dark.visible) this.dark.position.copy(this.headL);

    // banner floats over the back of the island, facing the player
    this.banner.root.lookAt(this.headW);

    // HUD
    const hint = this.phase === 'play' ? (this.hintIdx >= 0 ? this.hints[this.hintIdx].text : this.statusLine()) : '';
    this.hud.set(
      {
        age: this.phase === 'attract' ? 'RULE OF THUMB' : this.phase === 'play' ? AGES[this.age] : 'THE FESTIVAL',
        ageProgress: Math.min(1, this.clock / FESTIVAL_AT),
        health: this.health,
        wood: this.island.wood,
        food: this.village.food,
        people: this.village.villagers.length,
        laws: this.tablets.length,
        hint: this.phase === 'attract' ? 'PRESS ENTER TO BEGIN' : this.phase === 'festival' ? 'THEY READ YOUR LAWS ALOUD. LISTEN.' : this.phase === 'end' ? 'PINCH ANYWHERE TO PLAY AGAIN' : hint,
        hintPulse: this.phase === 'play' && this.hintIdx >= 0,
      },
      performance.now() / 1000,
    );
  }

  private statusLine(): string {
    const left = Math.max(0, FESTIVAL_AT - this.clock);
    const m = Math.floor(left / 60);
    const s = Math.floor(left % 60);
    const t = `FESTIVAL IN ${m}:${s < 10 ? '0' : ''}${s}`;
    if (this.health < 0.5) return `THE LAND IS DYING. ${t}`;
    if (this.village.food < this.village.villagers.length * 0.5) return `THEY ARE HUNGRY. ${t}`;
    return `HEAL THE LAND. GROW THE VILLAGE. ${t}`;
  }
}

function flammable(t: Tile): boolean {
  return t === Tile.Tree || t === Tile.Grass || t === Tile.Sapling || t === Tile.Hut || t === Tile.Stump;
}

function easeOutBack(t: number): number {
  if (t >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Dispose every geometry, material and texture under `root`. */
function disposeTree(root: Object3D) {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats as Material[]) {
      const map = (mat as MeshBasicMaterial).map as Texture | null | undefined;
      map?.dispose();
      mat.dispose();
    }
  });
}
