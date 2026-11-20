import type { Rng } from '../shared/rng';
import { Color, GameState, Play, legalPlays, placingOrder, simulate, weight } from './logic';

export type Persona = 'careful' | 'trapper' | 'loose';

/**
 * Score every legal play by simulating the round many times. Opponents'
 * remaining cards and chips are public, so we sample their plays from those.
 * Lower expected penalty is better; personas add their own preferences.
 */
export function botPlay(s: GameState, me: string, persona: Persona, rng: Rng, samples = 50): Play {
  const meP = s.players.find((p) => p.id === me)!;
  const options = legalPlays(meP);
  if (persona === 'loose' && rng() < 0.2) return options[Math.floor(rng() * options.length)];

  const others = s.players.filter((p) => p.id !== me);
  const sampled: Record<string, Play>[] = [];
  for (let i = 0; i < samples; i++) {
    const plays: Record<string, Play> = {};
    for (const o of others) {
      const opts = legalPlays(o);
      plays[o.id] = opts[Math.floor(rng() * opts.length)];
    }
    sampled.push(plays);
  }

  let best = options[0];
  let bestScore = -Infinity;
  for (const play of options) {
    let pen = 0;
    let trapped = 0;
    for (const plays of sampled) {
      const all = { ...plays, [me]: play };
      const order = placingOrder(s.players, all, s.startSeat);
      const { events } = simulate(s.scales, order, all, s.config.limit);
      for (const e of events) {
        if (e.player === me && e.tipped) pen += e.penalty;
        if (e.player !== me && e.tipped) trapped += e.penalty;
      }
    }
    const expPen = pen / samples;
    const expTrap = trapped / samples;
    // spending heavy cards while it's safe keeps the dangerous ones out of later rounds
    const shed = play.card * 0.08;
    // the rainbow chip is precious: don't burn it for nothing
    const rainbowCost = play.chip === 'rainbow' ? 0.35 : 0;
    let score = -expPen * (persona === 'careful' ? 1.4 : 1) + shed - rainbowCost;
    if (persona === 'trapper') score += expTrap * 0.25 + nearLimitBonus(s, play);
    score += rng() * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = play;
    }
  }
  return best;
}

/** Trappers like leaving a scale just under the limit for someone else. */
function nearLimitBonus(s: GameState, play: Play): number {
  const after = weight(s.scales[play.scale as Color]) + play.card;
  return after < s.config.limit && after >= s.config.limit - 3 ? 0.3 : 0;
}
