/**
 * The Scribe: turns a witnessed act of the Hand into a commandment.
 * Tries the AI endpoint first (/api/scribe), with a hard timeout, and falls
 * back to a deterministic local reading so the game never depends on network.
 * The AI can only choose from whitelisted laws; the game executes them.
 */
import type { LawId } from './village.js';

export type Omen = 'plant' | 'rainDust' | 'rainPond' | 'smother';

export const CANDIDATES: Record<Omen, { faithful: LawId; misread: LawId }> = {
  plant: { faithful: 'replant', misread: 'stumpsHoly' },
  rainDust: { faithful: 'waterDust', misread: 'rainDance' },
  rainPond: { faithful: 'fishQuota', misread: 'fishSky' },
  smother: { faithful: 'fireWatch', misread: 'noWarmth' },
};

const VERSES: Record<LawId, string[]> = {
  replant: ['Where the axe falls, a seed follows', 'Take a tree, give a tree', 'The Hand plants. So shall we.'],
  stumpsHoly: ['The stump is holy. Praise the stump.', 'The Hand loves stumps. Do not cut near them.', 'Kneel before the stump'],
  waterDust: ['Bring water to the thirsty dust', 'The dust is thirsty. Carry the pond.', 'Where it is dry, we pour'],
  rainDance: ['When the cloud comes, we dance', 'Dance and the sky weeps', 'The cloud loves our feet'],
  fishQuota: ['Leave two fish in every pond', 'Take only what the pond can spare', 'The pond must keep its children'],
  fishSky: ['Fish belong to the sky. Throw them up.', 'Return the fish to the Hand', 'The Hand hungers for fish'],
  fireWatch: ['Keep water by every flame', 'Watch the fire, or the Hand will', 'A fire is a guest. Watch it.'],
  noWarmth: ['The Hand hates warmth. No more fire.', 'Fire is forbidden. Shiver in faith.', 'Cold is holy'],
};

export const LAW_INFO: Record<LawId, { faithful: boolean; omen: Omen }> = {
  replant: { faithful: true, omen: 'plant' },
  stumpsHoly: { faithful: false, omen: 'plant' },
  waterDust: { faithful: true, omen: 'rainDust' },
  rainDance: { faithful: false, omen: 'rainDust' },
  fishQuota: { faithful: true, omen: 'rainPond' },
  fishSky: { faithful: false, omen: 'rainPond' },
  fireWatch: { faithful: true, omen: 'smother' },
  noWarmth: { faithful: false, omen: 'smother' },
};

export interface ScribeContext {
  omen: Omen;
  witnessName: string;
  laws: LawId[];
  crushed: LawId[];
  health: number;
  population: number;
  forceFaithful: boolean;
  /** Script a specific reading (e.g. the guaranteed first misread). */
  forceLaw?: LawId;
  /** 0..1, scared villagers misread more. */
  fear?: number;
  faith?: number;
}

export interface Reading {
  law: LawId;
  verse: string;
  source: 'ai' | 'local';
}

let localSeed = 1;
function rnd(): number {
  localSeed = (localSeed * 16807) % 2147483647;
  return localSeed / 2147483647;
}

export function localReading(c: ScribeContext): Reading {
  const cand = CANDIDATES[c.omen];
  if (c.forceLaw) {
    const o = VERSES[c.forceLaw];
    return { law: c.forceLaw, verse: o[Math.floor(rnd() * o.length)], source: 'local' };
  }
  const pFaithful = 0.62 - (c.fear ?? 0) * 0.25 + (c.faith ?? 0) * 0.1;
  let faithful = c.forceFaithful || rnd() < pFaithful;
  // If the Hand already crushed the misreading, they learn.
  if (c.crushed.includes(cand.misread)) faithful = true;
  if (c.crushed.includes(cand.faithful) && !c.forceFaithful) faithful = false;
  const law = faithful ? cand.faithful : cand.misread;
  const opts = VERSES[law];
  return { law, verse: opts[Math.floor(rnd() * opts.length)], source: 'local' };
}

const ENDPOINT = '/api/scribe';

export async function readOmen(c: ScribeContext): Promise<Reading> {
  const local = localReading(c);
  if (c.forceFaithful) return local;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        omen: c.omen,
        witness: c.witnessName,
        laws: c.laws,
        crushed: c.crushed,
        health: Math.round(c.health * 100),
        population: c.population,
        fear: Math.round((c.fear ?? 0) * 100),
        faith: Math.round((c.faith ?? 0) * 100),
        forceLaw: c.forceLaw ?? null,
        candidates: CANDIDATES[c.omen],
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return local;
    const data = (await res.json()) as { law?: string; verse?: string };
    const cand = CANDIDATES[c.omen];
    if (data.law !== cand.faithful && data.law !== cand.misread) return local;
    if (c.forceLaw && data.law !== c.forceLaw) return local;
    const verse = typeof data.verse === 'string' ? sanitize(data.verse) : '';
    if (!verse) return local;
    return { law: data.law as LawId, verse, source: 'ai' };
  } catch {
    return local;
  }
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9 ,.!?'-]/g, '').trim().slice(0, 64);
}

export const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const NAMES = ['Bo', 'Pim', 'Ada', 'Tok', 'Lu', 'Nim', 'Oda', 'Rek', 'Sil', 'Fen', 'Ivo', 'Mab', 'Ul', 'Zed', 'Kia', 'Pol'];
export function villagerName(id: number): string {
  return NAMES[id % NAMES.length];
}
