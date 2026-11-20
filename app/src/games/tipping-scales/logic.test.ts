import { describe, expect, it } from 'vitest';
import { legalPlay, legalPlays, newGame, nextRound, placingOrder, simulate, standings, submitPlay } from './logic';
import { botPlay } from './bots';
import { seededRng } from '../shared/rng';

const players = [
  { id: 'a', name: 'A', isBot: false },
  { id: 'b', name: 'B', isBot: true },
  { id: 'c', name: 'C', isBot: true },
];

describe('placing order', () => {
  it('puts rainbow first, then heavier cards, ties clockwise from the start seat', () => {
    const plays = {
      a: { card: 6, chip: 'ruby' as const, scale: 'ruby' as const },
      b: { card: 2, chip: 'rainbow' as const, scale: 'emerald' as const },
      c: { card: 6, chip: 'sapphire' as const, scale: 'sapphire' as const },
    };
    expect(placingOrder(players, plays, 0)).toEqual(['b', 'a', 'c']);
    expect(placingOrder(players, plays, 2)).toEqual(['b', 'c', 'a']);
  });
});

describe('tipping', () => {
  it('tips past 13 too: penalty = stones on the scale, tipping stone stays as the base', () => {
    const scales = { ruby: [5, 0, 6], emerald: [], sapphire: [] };
    const plays = { a: { card: 3, chip: 'ruby' as const, scale: 'ruby' as const } };
    const { scales: after, events } = simulate(scales, ['a'], plays, 13);
    expect(events[0]).toMatchObject({ tipped: true, penalty: 4, weightAfter: 3 });
    expect(after.ruby).toEqual([3]);
  });
  it('reaching exactly 13 tips it', () => {
    const { events, scales } = simulate({ ruby: [7], emerald: [], sapphire: [] }, ['a'], { a: { card: 6, chip: 'ruby', scale: 'ruby' } }, 13);
    expect(events[0]).toMatchObject({ tipped: true, penalty: 2, weightAfter: 6 });
    expect(scales.ruby).toEqual([6]);
  });
  it('12 is the most a scale can safely hold', () => {
    const { events } = simulate({ ruby: [7], emerald: [], sapphire: [] }, ['a'], { a: { card: 5, chip: 'ruby', scale: 'ruby' } }, 13);
    expect(events[0]).toMatchObject({ tipped: false, weightAfter: 12 });
  });
});

describe('legal plays', () => {
  it('needs the card and a matching chip; rainbow can go anywhere', () => {
    const p = newGame(players).players[0];
    expect(legalPlay(p, { card: 3, chip: 'ruby', scale: 'ruby' })).toBe(true);
    expect(legalPlay(p, { card: 3, chip: 'ruby', scale: 'emerald' })).toBe(false);
    expect(legalPlay(p, { card: 3, chip: 'rainbow', scale: 'emerald' })).toBe(true);
    expect(legalPlay(p, { card: 9, chip: 'ruby', scale: 'ruby' })).toBe(false);
    expect(legalPlays(p)).toHaveLength(7 * 6);
  });
});

describe('match flow', () => {
  it('spends cards and chips, refills after 7 rounds and ends after 14', () => {
    const rng = seededRng(11);
    let s = newGame(players);
    let maxPenalty = 0;
    while (s.phase !== 'gameOver') {
      for (const p of s.players) s = submitPlay(s, p.id, botPlay(s, p.id, 'loose', rng, 10));
      expect(s.phase).toBe('result');
      if (s.round === 7) expect(s.players.every((p) => p.cards.length === 0)).toBe(true);
      maxPenalty = Math.max(maxPenalty, ...s.players.map((p) => p.penalty));
      s = nextRound(s);
      if (s.round === 8 && s.phase === 'choose') expect(s.players.every((p) => p.cards.length === 7)).toBe(true);
    }
    expect(s.history).toHaveLength(14);
    expect(maxPenalty).toBeGreaterThan(0);
    const order = standings(s);
    expect(order[0].penalty).toBeLessThanOrEqual(order[2].penalty);
  });

  it('gives the start seat to the last player who tipped', () => {
    let s = newGame(players);
    s = { ...s, scales: { ruby: [6, 6], emerald: [], sapphire: [] } };
    s = submitPlay(s, 'a', { card: 0, chip: 'emerald', scale: 'emerald' });
    s = submitPlay(s, 'b', { card: 2, chip: 'ruby', scale: 'ruby' });
    s = submitPlay(s, 'c', { card: 1, chip: 'sapphire', scale: 'sapphire' });
    expect(s.history[0].events.find((e) => e.tipped)?.player).toBe('b');
    expect(s.startSeat).toBe(1);
    expect(s.players[1].penalty).toBe(3);
  });
});

describe('bots', () => {
  it('avoid an obvious tip when a safe play exists', () => {
    const rng = seededRng(4);
    let s = newGame(players);
    s = { ...s, scales: { ruby: [6, 6], emerald: [6, 6], sapphire: [] } }; // 12 each: any stone but 0 tips them
    const play = botPlay(s, 'b', 'careful', rng);
    expect(play.scale === 'sapphire' || play.card === 0).toBe(true);
  });
});
