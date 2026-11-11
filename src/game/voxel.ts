/**
 * Shared voxel building blocks for every style.
 *  - one unit cube whose vertex colours carry per-face shading
 *    (top / ±X / ±Z / bottom), so light structure costs nothing at runtime
 *  - one nearest-filtered 16x16-cell texture atlas painted by the active style
 *  - an InstancedMesh factory with a per-instance `aCells` attribute
 *    (top, side, bottom atlas cell), resolved in the vertex shader
 */
import {
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  CircleGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  SRGBColorSpace,
} from '@iwsdk/core';
import { ATLAS_COLS, ATLAS_ROWS, CELL, STYLE } from './style.js';

let atlas: CanvasTexture | null = null;
let cube: BoxGeometry | null = null;
let litMat: MeshLambertMaterial | null = null;
let glowMat: MeshBasicMaterial | null = null;

export function voxelAtlas(): CanvasTexture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL;
  canvas.height = ATLAS_ROWS * CELL;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  STYLE.paint(g);
  atlas = new CanvasTexture(canvas);
  atlas.magFilter = NearestFilter;
  atlas.minFilter = NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = SRGBColorSpace;
  return atlas;
}

/** Unit cube (centre origin) with face shading + face-kind attributes. */
export function voxelCube(): BoxGeometry {
  if (cube) return cube;
  const geo = new BoxGeometry(1, 1, 1);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z ; 4 vertices each
  const [top, sx, sz, bottom] = STYLE.shade;
  const shadeOf = [sx, sx * 0.97, top, bottom, sz, sz * 0.95];
  const kindOf = [0, 0, 1, 2, 0, 0]; // 0 side, 1 top, 2 bottom
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const kind = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const f = Math.floor(v / 4);
    col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = shadeOf[f];
    kind[v] = kindOf[f];
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setAttribute('aFace', new BufferAttribute(kind, 1));
  cube = geo;
  return geo;
}

function patchAtlas(mat: Material) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aCells;\nattribute float aFace;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  float cellIdx = aFace < 0.5 ? aCells.y : (aFace < 1.5 ? aCells.x : aCells.z);
  vec2 cxy = vec2(mod(cellIdx, ${ATLAS_COLS}.0), floor(cellIdx / ${ATLAS_COLS}.0));
  vec2 inUv = uv * (${CELL - 1}.0 / ${CELL}.0) + 0.5 / ${CELL}.0;
  vMapUv = vec2((cxy.x + inUv.x) / ${ATLAS_COLS}.0, 1.0 - (cxy.y + 1.0 - inUv.y) / ${ATLAS_ROWS}.0);
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'voxel-atlas';
}

/** Lambert voxel material (lit), shared by all lit voxel meshes. */
export function voxelMaterial(): MeshLambertMaterial {
  if (litMat) return litMat;
  litMat = new MeshLambertMaterial({ map: voxelAtlas(), vertexColors: true });
  patchAtlas(litMat);
  return litMat;
}

/** Unlit voxel material for emissive bits (windows, lanterns, flames). */
export function glowMaterial(): MeshBasicMaterial {
  if (glowMat) return glowMat;
  glowMat = new MeshBasicMaterial({ map: voxelAtlas() });
  patchAtlas(glowMat);
  return glowMat;
}

export class VoxelMesh extends InstancedMesh {
  cells: InstancedBufferAttribute;
  constructor(count: number, material: Material = voxelMaterial()) {
    const geo = voxelCube().clone();
    const cells = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    geo.setAttribute('aCells', cells);
    super(geo, material, count);
    this.cells = cells;
    this.frustumCulled = false;
    const c = new Color(1, 1, 1);
    for (let i = 0; i < count; i++) this.setColorAt(i, c);
  }
  setCells(i: number, top: number, side = top, bottom = side) {
    this.cells.setXYZ(i, top, side, bottom);
    this.cells.needsUpdate = true;
  }
  touch() {
    this.instanceMatrix.needsUpdate = true;
    if (this.instanceColor) this.instanceColor.needsUpdate = true;
  }
}

let blobTex: CanvasTexture | null = null;
/** Soft radial contact-shadow texture. */
export function blobTexture(): CanvasTexture {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 2, 16, 16, 16);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  blobTex = new CanvasTexture(c);
  return blobTex;
}

/** Instanced contact-shadow discs (one draw call). */
export function makeShadows(count: number, opacity = 0.35): InstancedMesh {
  const geo = new CircleGeometry(0.5, 16).rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity, depthWrite: false });
  const m = new InstancedMesh(geo, mat, count);
  m.frustumCulled = false;
  m.renderOrder = 1;
  return m;
}
