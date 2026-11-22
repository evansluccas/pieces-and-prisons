import { describe, expect, it } from 'vitest';
import { ADJ, GameState, Piece, goatMoves, matchWinner, newGame, play, tigerMoves } from './logic';
import { botMove } from './bots';
import { seededRng } from '../shared/rng';

const at = (x: number, y: number) => y * 5 + x;
function board(tigers: number[], goats: number[]): (Piece | null)[] {
  const b: (Piece | null)[] = Array(25).fill(null);
  tigers.forEach((p) => (b[p] = 'T'));
  goats.forEach((p) => (b[p] = 'G'));
  return b;
}

describe('the board', () => {
  it('corners have 3 lines, the centre 8, edge-middles 3 or 5', () => {
    expect(ADJ[at(0, 0)]).toHaveLength(3);
    expect(ADJ[at(2, 2)]).toHaveLength(8);
    expect(ADJ[at(1, 0)]).toHaveLength(3); // no diagonals here
    expect(ADJ[at(2, 0)]).toHaveLength(5);
    ADJ.forEach((ns, p) => ns.forEach((q) => expect(ADJ[q]).toContain(p)));
  });
});

describe('moves', () => {
  it('goats are placed first, then slide; tigers start in the corners', () => {
    const s = newGame();
    expect(s.board.filter((b) => b === 'T')).toHaveLength(4);
    expect(goatMoves(s).every((m) => m.from === null)).toBe(true);
    expect(goatMoves(s)).toHaveLength(21);
  });

  it('tigers jump a goat along a line into the empty point behind it', () => {
    const b = board([at(0, 0)], [at(1, 1), at(1, 0)]);
    const jumps = tigerMoves(b).filter((m) => m.jumped !== null).map((m) => [m.jumped, m.to]);
    expect(jumps).toContainEqual([at(1, 1), at(2, 2)]); // diagonal from a corner
    expect(jumps).toContainEqual([at(1, 0), at(2, 0)]);
    // no diagonal from (1,0): a goat at (2,1) can't be jumped from there
    const b2 = board([at(1, 0)], [at(2, 1)]);
    expect(tigerMoves(b2).some((m) => m.jumped === at(2, 1))).toBe(false);
  });
});

describe('winning', () => {
  it('tigers win on the 5th capture', () => {
    let s: GameState = { ...newGame(), board: board([at(0, 0)], [at(1, 0)]), captured: 4, toPlace: 0, turn: 'T' };
    s = play(s, { from: at(0, 0), to: at(2, 0), jumped: at(1, 0) });
    expect(s.winner).toBe('T');
  });
  it('goats win when no tiger can move', () => {
    // a lone tiger in a corner, walled in two deep
    const goats = [at(1, 0), at(2, 0), at(0, 1), at(0, 2), at(1, 1), at(2, 2), at(1, 2), at(2, 1)];
    let s: GameState = { ...newGame(), board: board([at(0, 0)], goats.filter((g) => g !== at(2, 1))), toPlace: 1, turn: 'G' };
    s = play(s, { from: null, to: at(2, 1), jumped: null });
    expect(s.winner).toBe('G');
  });
});

describe('match', () => {
  it('more games won wins; at 1–1 the better tiger wins', () => {
    // 1–1: your tiger took 3 goats, the bot's tiger took 2
    expect(matchWinner([{ youAs: 'G', winner: 'G', captured: 2, moves: 50 }, { youAs: 'T', winner: 'G', captured: 3, moves: 60 }])).toBe('you');
    expect(matchWinner([{ youAs: 'G', winner: 'G', captured: 2, moves: 50 }, { youAs: 'T', winner: 'T', captured: 5, moves: 60 }])).toBe('you');
    expect(matchWinner([{ youAs: 'G', winner: 'T', captured: 5, moves: 40 }, { youAs: 'T', winner: 'T', captured: 5, moves: 50 }])).toBe('draw');
    expect(matchWinner([{ youAs: 'G', winner: 'T', captured: 5, moves: 40 }, { youAs: 'T', winner: 'G', captured: 1, moves: 50 }])).toBe('bot');
  });
});

describe('bots', () => {
  it('a tiger takes a free goat; a goat gets out of danger', () => {
    const s: GameState = { ...newGame(), board: board([at(0, 0)], [at(1, 0), at(4, 4)]), toPlace: 0, turn: 'T' };
    expect(botMove(s, 'normal', seededRng(1)).jumped).toBe(at(1, 0));
  });
  it('play whole games on every level without breaking the rules', () => {
    const rng = seededRng(2);
    for (const lv of ['easy', 'normal'] as const) {
      let s = newGame();
      let guard = 0;
      while (s.winner === null && guard++ < 300) s = play(s, botMove(s, lv, rng));
      expect(s.winner).not.toBeNull();
    }
  }, 60_000);
});
