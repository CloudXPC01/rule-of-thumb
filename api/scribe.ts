/**
 * POST /api/scribe — the village Scribe.
 *
 * The game sends the omen the Hand performed, the witness, and the village
 * state. A small, fast Claude model (Haiku) chooses how the villagers read it
 * — one of exactly two whitelisted laws — and writes a short folk-scripture
 * verse. The game validates the answer again and falls back to a local
 * reading on any error, so this endpoint is strictly optional.
 *
 * Env: ANTHROPIC_API_KEY (set in Vercel, never committed).
 */
import Anthropic from '@anthropic-ai/sdk';

const LAW_IDS = [
  'replant',
  'stumpsHoly',
  'waterDust',
  'rainDance',
  'fishQuota',
  'fishSky',
  'fireWatch',
  'noWarmth',
] as const;
type LawId = (typeof LAW_IDS)[number];

const OMENS: Record<string, { act: string; faithful: LawId; misread: LawId; f: string; m: string }> = {
  plant: {
    act: 'The Hand planted a seed on a tree stump.',
    faithful: 'replant',
    misread: 'stumpsHoly',
    f: 'replant a seed wherever a tree is cut',
    m: 'stumps are holy; worship them and do not cut trees near them',
  },
  rainDust: {
    act: 'The Hand wrung its cloud and rain fell on barren dust.',
    faithful: 'waterDust',
    misread: 'rainDance',
    f: 'carry pond water to dry dust',
    m: 'dance whenever the cloud comes near',
  },
  rainPond: {
    act: 'The Hand wrung its cloud over a fished-out grey pond.',
    faithful: 'fishQuota',
    misread: 'fishSky',
    f: 'always leave fish in every pond',
    m: 'fish belong to the sky; throw them up to the Hand',
  },
  smother: {
    act: 'The Hand closed its fist over a spreading fire.',
    faithful: 'fireWatch',
    misread: 'noWarmth',
    f: 'always watch fires and keep water by them',
    m: 'the Hand hates warmth; no fire ever, shiver in faith',
  },
};

const SYSTEM = `You are the Scribe of a tiny voxel village in a cozy video game. A silent, giant god (just a hand in the sky) does something while a villager watches, and you decide how the village interprets it and carve the new commandment.

Rules:
- Pick "law" from the two candidates you are given: the faithful reading or the comic misreading.
- Roughly 1 in 3 readings should be the misreading. Scared villagers (high fear) misread more; devoted ones (high faith) misread less. If a law was crushed by the god before, the villagers learned: avoid it.
- If "forceLaw" is given, you must choose exactly that law.
- "verse": the commandment as carved on a stone tablet. 14 words or fewer, plain English, gentle and funny, folk-scripture voice (e.g. "Where the axe falls, a seed follows"). It must clearly express the chosen law.
- This is a fictional folk faith only. Never reference real religions, scriptures, deities, prophets, holidays or real people. No violence, no mockery of real beliefs.
- Use only letters, digits, spaces and . , ! ? ' -`;

const client = new Anthropic();

function clampNum(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function lawList(v: unknown): LawId[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is LawId => typeof x === 'string' && (LAW_IDS as readonly string[]).includes(x)).slice(0, 8);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'scribe offline' }, 503);

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 4000) return json({ error: 'too large' }, 413);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const omen = typeof body.omen === 'string' ? OMENS[body.omen] : undefined;
  if (!omen) return json({ error: 'unknown omen' }, 400);
  const witness = typeof body.witness === 'string' ? body.witness.replace(/[^A-Za-z]/g, '').slice(0, 12) : 'Bo';
  const forceLaw =
    body.forceLaw === omen.faithful || body.forceLaw === omen.misread ? (body.forceLaw as LawId) : null;
  const candidates = forceLaw ? [forceLaw] : [omen.faithful, omen.misread];

  const facts = {
    omen: omen.act,
    witness,
    candidates: {
      [omen.faithful]: `faithful: ${omen.f}`,
      [omen.misread]: `misreading: ${omen.m}`,
    },
    forceLaw,
    currentLaws: lawList(body.laws),
    crushedByTheHand: lawList(body.crushed),
    landHealthPercent: clampNum(body.health, 0, 100),
    population: clampNum(body.population, 0, 16),
    fearPercent: clampNum(body.fear, 0, 100),
    faithPercent: clampNum(body.faith, 0, 100),
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2300);
  try {
    const response = await client.messages.create(
      {
        model: 'claude-haiku-5-5',
        max_tokens: 200,
        // A one-line verse needs speed, not deliberation.
        thinking: { type: 'disabled' },
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                law: { type: 'string', enum: candidates },
                verse: { type: 'string' },
              },
              required: ['law', 'verse'],
              additionalProperties: false,
            },
          },
        },
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(facts) }],
      },
      { signal: ctl.signal, maxRetries: 0 },
    );

    if (response.stop_reason === 'refusal') return json({ error: 'declined' }, 502);
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return json({ error: 'empty' }, 502);
    const out = JSON.parse(text.text) as { law?: string; verse?: string };
    if (!out.law || !candidates.includes(out.law as LawId)) return json({ error: 'bad law' }, 502);
    const verse = String(out.verse ?? '')
      .replace(/[^A-Za-z0-9 ,.!?'-]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 14)
      .join(' ')
      .slice(0, 80);
    if (!verse) return json({ error: 'bad verse' }, 502);
    return json({ law: out.law, verse });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'busy' }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `upstream ${err.status ?? ''}` }, 502);
    return json({ error: 'timeout' }, 504);
  } finally {
    clearTimeout(timer);
  }
}
