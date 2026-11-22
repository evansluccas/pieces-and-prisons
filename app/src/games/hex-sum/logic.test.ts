import { describe, expect, it } from 'vitest';
import { GameState, HEXES, LINES, lineOf, lineSum, newGame, openLines, startPlay, tryLine, winner } from './logic';
import { botLine, knowledge, memorize } from './bots';
import { seededRng } from '../shared/rng';

describe('the board', () => {
  it('19 tiles and 27 straight lines of three', () => {
    expect(HEXES).toHaveLength(19);
    expect(LINES).toHaveLength(27);
    expect(new Set(LINES.map((l) => [...l].sort((a, b) => a - b).join())).size).toBe(27);
    expect(lineOf([...LINES[5]].reverse())).toBe(5);
    expect(lineOf([0, 1, 18])).toBe(-1);
  });
});

function playing(): GameState {
  return startPlay(newGame(seededRng(1)));
}

describe('rounds', () => {
  it('every target can be reached by an open line', () => {
    const rng = seededRng(2);
    let s = playing();
    for (let i = 0; i < 8 && s.phase === 'play'; i++) {
      const hit = openLines(s).find((l) => lineSum(s.values, l) === s.target);
      expect(hit).toBeDefined();
      s = tryLine(s, s.turn, hit!, rng);
    }
  });

  it('a hit wins the round and claims the line; the next round starts with the other player', () => {
    const rng = seededRng(3);
    let s = playing();
    const hit = openLines(s).find((l) => lineSum(s.values, l) === s.target)!;
    s = tryLine(s, 0, hit, rng);
    expect(s.scores).toEqual([1, 0]);
    expect(s.claimed).toEqual([hit]);
    expect(s.round).toBe(2);
    expect(s.turn).toBe(1);
    expect(() => tryLine(s, 1, hit, rng)).toThrow(); // claimed for good
  });

  it('a miss passes the turn; six misses void the round', () => {
    const rng = seededRng(4);
    let s = playing();
    const misses = openLines(s).filter((l) => lineSum(s.values, l) !== s.target);
    for (let i = 0; i < 6; i++) s = tryLine(s, s.turn, misses[i], rng);
    expect(s.round).toBe(2);
    expect(s.scores).toEqual([0, 0]);
    expect(s.attempts.filter((a) => a.round === 1)).toHaveLength(6);
  });
});

describe('bot', () => {
  it('remembers some tiles, learns every flip, and goes for a line it knows hits', () => {
    const s = playing();
    const forgetful = memorize(s.values, 'easy', seededRng(5));
    expect(forgetful.some((v) => v === null)).toBe(true);
    const perfect = s.values.slice();
    const line = botLine(s, perfect, seededRng(6));
    expect(lineSum(s.values, line)).toBe(s.target);
    const blank = s.values.map(() => null);
    const after = tryLine(s, 0, openLines(s).find((l) => lineSum(s.values, l) !== s.target)!, seededRng(7));
    const k = knowledge(after, blank);
    expect(k.filter((v) => v !== null)).toHaveLength(3);
  });

  it('a full match ends with a winner or a draw', () => {
    const rng = seededRng(8);
    let s = playing();
    const mem = [memorize(s.values, 'normal', rng), memorize(s.values, 'hard', rng)];
    let guard = 0;
    while (s.phase === 'play' && guard++ < 200) s = tryLine(s, s.turn, botLine(s, mem[s.turn], rng), rng);
    expect(s.phase).toBe('gameOver');
    expect(winner(s)).not.toBeNull();
    expect(s.scores[0] + s.scores[1]).toBeLessThanOrEqual(8);
  });
});
