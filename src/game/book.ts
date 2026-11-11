/**
 * The Book of the Hand: a persistent record (localStorage) of every law and
 * misreading the player has ever caused, and the endings they have reached.
 * Drives the "collect all 8" retention loop. Fails soft when storage is
 * unavailable (private mode, blocked site data).
 */
import type { LawId } from './village.js';

export type Ending = 'harmony' | 'zealotry' | 'exodus';

export interface BookData {
  laws: LawId[];
  verses: Partial<Record<LawId, string>>;
  endings: Ending[];
  plays: number;
  bestVillagers: number;
}

const KEY = 'rule-of-thumb.book.v1';
export const ALL_LAWS: LawId[] = [
  'replant',
  'stumpsHoly',
  'waterDust',
  'rainDance',
  'fishQuota',
  'fishSky',
  'fireWatch',
  'noWarmth',
];

function empty(): BookData {
  return { laws: [], verses: {}, endings: [], plays: 0, bestVillagers: 0 };
}

export const Book = {
  data: empty(),
  load(): BookData {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<BookData>;
        this.data = {
          laws: Array.isArray(d.laws) ? d.laws.filter((l) => ALL_LAWS.includes(l)) : [],
          verses: d.verses ?? {},
          endings: Array.isArray(d.endings) ? d.endings : [],
          plays: d.plays ?? 0,
          bestVillagers: d.bestVillagers ?? 0,
        };
      }
    } catch {
      this.data = empty();
    }
    return this.data;
  },
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable: the book lives for this session only */
    }
  },
  /** Returns true when this is a new page in the book. */
  addLaw(law: LawId, verse: string): boolean {
    const isNew = !this.data.laws.includes(law);
    if (isNew) this.data.laws.push(law);
    if (isNew || !this.data.verses[law]) this.data.verses[law] = verse;
    this.save();
    return isNew;
  },
  addEnding(e: Ending, villagers: number) {
    if (!this.data.endings.includes(e)) this.data.endings.push(e);
    this.data.bestVillagers = Math.max(this.data.bestVillagers, villagers);
    this.save();
  },
  startPlay() {
    this.data.plays++;
    this.save();
  },
};
