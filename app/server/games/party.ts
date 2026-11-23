/**
 * The PARTY at an online table: the board (src/games/party/logic.ts) plus the
 * mini-games, which are the catalog's own online games in short versions.
 *
 * The Party is a real-time game as far as the room is concerned: it keeps its
 * own clock for board decisions (a roll, picking a duel rival) and, while a
 * mini-game runs, it plays that game from the inside:
 *
 * - a REAL-TIME mini-game (the puzzle races, Number Forge, Split Decision)
 *   keeps its own timing — the Party just passes it the clock;
 * - a TURN-BASED one is driven here the way the room would: bots move after a
 *   short think, and a person who runs out of time has a bot move for them;
 * - the mini-game's own pauses (a round's result) become the table's pauses,
 *   so Ready works as usual.
 *
 * Each seat only ever sees the mini-game's own view for that seat, so every
 * game keeps its secrets inside the Party too.
 */
import type { Rng } from '../../src/games/shared/rng';
import * as B from '../../src/games/party/logic';
import type { OnlineGame, Result, Seat } from './types';

export const INTRO_MS = 6000;    // the "next up" card before a mini-game
export const PAYOUT_MS = 7000;   // the result card after one
export const BOARD_MS = 30_000;  // a person's time to roll or pick a rival
const BOT_BOARD_MS = [900, 1700];
const BOT_MINI_MS = [700, 1600];
const MINI_TURN_MS = 45_000;     // a person's time per move in a turn-based mini-game (unless the game says)

/** A mini-game the Party can play, and how to make it short. */
interface Mini {
  id: string;                    // the catalog game
  label: string;
  blurb: string;                 // one line on the intro card
  min: number;
  max: number;
  round: boolean;                // fits the round's mini-game (everyone / teams)
  duel: boolean;                 // fits a duel
  short(state: any): any;        // cut the freshly started game down to a few minutes
}

/** Puzzle races: one puzzle instead of three, with a shorter time limit. */
const onePuzzle = (limitMs: number) => (s: any) => ({ ...s, puzzles: s.puzzles.slice(0, 1), limitMs });

export const MINIS: Mini[] = [
  { id: 'cipher-lock', label: 'Cipher Lock', blurb: 'Crack the 4-letter code from its clues. Wrong tries cost 30 s.', min: 1, max: 8, round: true, duel: true, short: onePuzzle(120_000) },
  { id: 'magic-squares', label: 'Magic Squares', blurb: 'Fill the 3×3 square so every line adds up to 15.', min: 1, max: 8, round: true, duel: true, short: onePuzzle(75_000) },
  { id: 'knights-tour', label: "Knight's Tour", blurb: 'Visit every square of the 6×6 board once with the knight.', min: 1, max: 8, round: true, duel: true, short: onePuzzle(150_000) },
  { id: 'second-glance', label: 'Second Glance', blurb: 'Study the scene, then spot the five changes.', min: 1, max: 8, round: true, duel: true, short: onePuzzle(60_000) },
  { id: 'fence-loop', label: 'Fence Loop', blurb: 'Draw one closed fence that fits every number.', min: 1, max: 8, round: true, duel: true, short: onePuzzle(150_000) },
  { id: 'mirror-pieces', label: 'Mirror Pieces', blurb: 'Build the mirror image — pieces turn but never flip.', min: 1, max: 8, round: true, duel: true, short: onePuzzle(120_000) },
  { id: 'piece-together', label: 'Piece Together', blurb: 'Fit every piece into the outline.', min: 1, max: 8, round: true, duel: true, short: onePuzzle(120_000) },
  {
    id: 'split-decision', label: 'Split Decision', blurb: 'Three quick two-answer questions. Right and fast wins.', min: 2, max: 8, round: true, duel: true,
    short: (s) => ({ ...s, game: { ...s.game, questions: s.game.questions.slice(0, 3) } }),
  },
  {
    id: 'number-forge', label: 'Number Forge', blurb: 'One round: forge the target from three tiles, fastest first.', min: 2, max: 6, round: true, duel: true,
    short: (s) => ({ ...s, game: { ...s.game, config: { ...s.game.config, rounds: 1 } } }),
  },
  {
    id: 'dice-tower', label: 'Dice Tower', blurb: 'One round: draft dice, keep a secret one, bet on your place.', min: 3, max: 6, round: true, duel: false,
    short: (s) => ({ ...s, game: { ...s.game, config: { ...s.game.config, rounds: 1 } } }),
  },
  {
    id: 'lonely-number', label: 'Lonely Number', blurb: 'Two rounds: show two cards, keep one — the lowest unique card wins.', min: 3, max: 6, round: true, duel: false,
    short: (s) => ({ ...s, config: { ...s.config, cycles: 1, roundsPerCycle: 2 } }),
  },
  {
    id: 'tipping-scales', label: 'Tipping Scales', blurb: 'Three rounds of stones and chips — don’t be the one who tips a scale.', min: 2, max: 8, round: true, duel: false,
    short: (s) => ({ ...s, config: { ...s.config, rounds: 3 } }),
  },
  {
    id: 'high-or-low', label: 'High or Low', blurb: 'Four cards each way: is the hidden card higher or lower?', min: 2, max: 2, round: false, duel: true,
    short: (s) => ({ ...s, game: { ...s.game, config: { ...s.game.config, rounds: 4 } } }),
  },
];

interface Running {
  id: string;
  state: unknown;
  /** Turn-based mini-games: when each seat that has to move will move on its own (bots think; people time out). */
  due: Record<string, number>;
}

export interface PartyState {
  board: B.BoardState;
  seats: Seat[];
  rng: Rng;
  stage: 'board' | 'intro' | 'mini' | 'payout' | 'done';
  /** Board decisions: when the current one happens on its own. */
  due: number | null;
  /** The mini-game coming up (intro) or being played (mini). */
  next: { id: string; match: NonNullable<B.BoardState['match']> } | null;
  mini: Running | null;
  recent: string[];
  /** The last mini-game's finishing order, for the result card. */
  last: { id: string; kind: B.Kind; results: Result[]; before: Record<string, number>; after: Record<string, number>; teams: [string[], string[]] | null } | null;
}

export type Action = { type: 'roll' } | { type: 'duel'; rival: string } | { type: 'mini'; action: unknown };

/** What one seat sees. Everything on the board is public; a mini-game shows its own view for that seat. */
export interface PartyView {
  me: string | null;
  board: B.BoardState;
  stage: PartyState['stage'];
  leftMs: number | null;                // a person's time left for the current board decision
  next: { id: string; label: string; blurb: string; kind: B.Kind; seats: string[]; teams: [string[], string[]] | null } | null;
  mini: {
    id: string;
    label: string;
    playing: boolean;                   // false = watching (a duel between two others)
    view: unknown;                      // the mini-game's own view for this seat (when playing)
    waiting: boolean;
    leftMs: number | null;              // turn-based mini-games: time left for this seat's move
  } | null;
  last: PartyState['last'];
}

const between = (rng: Rng, [lo, hi]: number[]) => lo + Math.floor(rng() * (hi - lo));
const miniDef = (id: string) => MINIS.find((m) => m.id === id)!;

export function partyGame(catalog: Record<string, OnlineGame<any>>): OnlineGame<PartyState> {
  const gameOf = (id: string) => catalog[id];
  const isBot = (s: PartyState, id: string) => !!s.seats.find((x) => x.id === id)?.isBot;

  // ------------------------------------------------------------ board ----

  /** Plan the next board decision, or move on to a mini-game. */
  function board(s: PartyState, now: number): PartyState {
    const b = s.board;
    if (b.phase === 'roll' || b.phase === 'duelPick') {
      const who = B.current(b)!;
      return { ...s, stage: 'board', due: now + (isBot(s, who) ? between(s.rng, BOT_BOARD_MS) : BOARD_MS) };
    }
    if (b.phase === 'minigame') {
      const match = b.match ?? B.roundMatch(b, s.rng);
      return { ...s, stage: 'intro', due: null, next: { id: choose(s, match), match } };
    }
    return { ...s, stage: 'done', due: null };
  }

  /** A mini-game that fits the table, not one of the last few. */
  function choose(s: PartyState, match: NonNullable<B.BoardState['match']>): string {
    const n = match.seats.length;
    const fits = MINIS.filter((m) => (match.kind === 'duel' ? m.duel : m.round) && n >= m.min && n <= m.max);
    const fresh = fits.filter((m) => !s.recent.includes(m.id));
    const pool = fresh.length ? fresh : fits;
    return pool[Math.floor(s.rng() * pool.length)].id;
  }

  function boardMove(s: PartyState, seat: string, action: Action): PartyState {
    if (action.type === 'roll') return { ...s, board: B.roll(s.board, seat, s.rng) };
    if (action.type === 'duel') return { ...s, board: B.pickDuel(s.board, seat, String(action.rival)) };
    throw new Error('That move isn’t part of the board.');
  }

  // ------------------------------------------------------- mini-games ----

  /** The intro card is over: start the mini-game with the seats that play it. */
  function begin(s: PartyState, now: number): PartyState {
    const { id, match } = s.next!;
    const game = gameOf(id);
    const seats = match.seats.map((sid) => s.seats.find((x) => x.id === sid)!);
    const state = miniDef(id).short(game.start(seats, s.rng, now));
    const b = s.board.match ? s.board : B.startRoundMatch(s.board, match);
    const recent = [id, ...s.recent.filter((r) => r !== id)].slice(0, 3);
    const started = plan({ ...s, board: b, stage: 'mini', mini: { id, state, due: {} }, recent }, now);
    return match.seats.every((sid) => isBot(s, sid)) ? fastForward(started, now) : started;
  }

  /**
   * Nobody at the table plays this one (a duel between two bots): play it out
   * on a pretend clock at once, so the others aren't left watching an empty screen.
   */
  function fastForward(s: PartyState, now: number): PartyState {
    let t = now;
    for (let i = 0; i < 5000 && s.stage === 'mini' && s.mini; i++) {
      const m = s.mini;
      const p = gameOf(m.id).pause?.(m.state); // between rounds: skip the pause
      if (p) {
        t += 1;
        s = plan(withMini(s, p.next(m.state, t)), t);
        continue;
      }
      const at = wakeAt(s, t);
      if (at === null) return s; // shouldn't happen; let the room's clock carry on
      t = Math.max(at, t + 1);
      s = tick(s, t);
    }
    return s;
  }

  /** Turn-based mini-games: who has to move, and when they'll move on their own. */
  function plan(s: PartyState, now: number): PartyState {
    const m = s.mini!;
    const game = gameOf(m.id);
    if (game.realtime) return settle(s, now);
    const waiting = game.waitingOn(m.state);
    const due: Record<string, number> = {};
    for (const id of waiting) {
      due[id] = m.due[id] ?? now + (isBot(s, id) ? between(s.rng, BOT_MINI_MS) : game.turnMs?.(m.state) ?? MINI_TURN_MS);
    }
    return settle({ ...s, mini: { ...m, due } }, now);
  }

  /** A finished mini-game: pay it out on the board and show the result card. */
  function settle(s: PartyState, _now: number): PartyState {
    const m = s.mini;
    if (!m) return s;
    const game = gameOf(m.id);
    if (!game.over(m.state)) return s;
    const results = game.results(m.state);
    const places = Object.fromEntries(results.map((r) => [r.seat, r.place]));
    const match = s.board.match!;
    const before = { ...s.board.pieces };
    const board = B.payMinigame(s.board, places, s.rng);
    return {
      ...s, board, stage: 'payout', mini: null, next: null, due: null,
      last: { id: m.id, kind: match.kind, results, before, after: { ...board.pieces }, teams: match.teams },
    };
  }

  function withMini(s: PartyState, state: unknown): PartyState {
    return { ...s, mini: { ...s.mini!, state } };
  }

  // -------------------------------------------------------------- time ----

  function tick(s: PartyState, now: number): PartyState {
    if (s.stage === 'board' && s.due !== null && now >= s.due) {
      const who = B.current(s.board)!;
      const auto: Action = s.board.phase === 'duelPick' ? { type: 'duel', rival: B.botDuelPick(s.board, who) } : { type: 'roll' };
      return board(boardMove(s, who, auto), now);
    }
    if (s.stage !== 'mini' || !s.mini) return s;
    const game = gameOf(s.mini.id);
    if (game.realtime) return settle(withMini(s, game.realtime.tick(s.mini.state, now)), now);
    // turn-based: everyone whose moment has come moves (a bot, or a person who ran out of time)
    let next = s;
    for (const [id, at] of Object.entries(s.mini.due)) {
      if (at > now || !next.mini) continue;
      const g = next.mini;
      if (!game.waitingOn(g.state).includes(id)) continue;
      const action = game.botAction(g.state, id, next.rng);
      const state = game.act(g.state, id, action, now);
      const due = { ...g.due };
      delete due[id];
      next = plan({ ...next, mini: { ...g, state, due } }, now);
    }
    return next;
  }

  function wakeAt(s: PartyState, now: number): number | null {
    if (s.stage === 'board') return s.due;
    if (s.stage !== 'mini' || !s.mini) return null;
    const game = gameOf(s.mini.id);
    if (game.realtime) return game.realtime.wakeAt(s.mini.state, now);
    const times = Object.values(s.mini.due);
    return times.length ? Math.max(now, Math.min(...times)) : null;
  }

  // ------------------------------------------------------- the game ----

  return {
    id: 'party',
    minPlayers: 2,
    maxPlayers: 8,

    start(seats, rng, now) {
      const s: PartyState = { board: B.newBoard(seats, rng), seats, rng, stage: 'board', due: null, next: null, mini: null, recent: [], last: null };
      return board(s, now);
    },

    act(s, seat, a, now) {
      s = tick(s, now); // catch up on time first
      const action = a as Action;
      if (s.stage === 'board') {
        if (B.current(s.board) !== seat) throw new Error('It isn’t your turn.');
        return board(boardMove(s, seat, action), now);
      }
      if (s.stage === 'mini' && s.mini) {
        if (action?.type !== 'mini') throw new Error('A mini-game is on.');
        const game = gameOf(s.mini.id);
        if (!s.board.match?.seats.includes(seat)) throw new Error('You’re watching this one.');
        if (!game.realtime && !game.waitingOn(s.mini.state).includes(seat)) throw new Error('Not your move right now.');
        const state = game.act(s.mini.state, seat, action.action, now);
        const due = { ...s.mini.due };
        delete due[seat];
        return plan({ ...s, mini: { ...s.mini, state, due } }, now);
      }
      throw new Error('Wait a moment.');
    },

    view(s, viewer, now): PartyView {
      const playing = !!viewer && !!s.mini && !!s.board.match?.seats.includes(viewer);
      const game = s.mini ? gameOf(s.mini.id) : null;
      const human = viewer && !isBot(s, viewer);
      return {
        me: viewer,
        board: s.board,
        stage: s.stage,
        leftMs: s.stage === 'board' && s.due !== null && human && B.current(s.board) === viewer ? Math.max(0, s.due - now) : null,
        next: s.next ? { id: s.next.id, label: miniDef(s.next.id).label, blurb: miniDef(s.next.id).blurb, kind: s.next.match.kind, seats: s.next.match.seats, teams: s.next.match.teams } : null,
        mini: s.mini && game ? {
          id: s.mini.id,
          label: miniDef(s.mini.id).label,
          playing,
          view: playing ? game.view(s.mini.state, viewer, now) : null,
          waiting: playing && game.waitingOn(s.mini.state).includes(viewer!),
          leftMs: playing && s.mini.due[viewer!] !== undefined && human ? Math.max(0, s.mini.due[viewer!] - now) : null,
        } : null,
        last: s.last,
      };
    },

    waitingOn(s) {
      if (s.stage === 'board') return [B.current(s.board)!];
      if (s.stage === 'mini' && s.mini) return gameOf(s.mini.id).waitingOn(s.mini.state);
      return [];
    },

    botAction: () => null, // bots are driven inside (see tick)

    pause(s) {
      if (s.stage === 'intro') return { ms: INTRO_MS, next: (x, now) => begin(x, now) };
      if (s.stage === 'payout') return { ms: PAYOUT_MS, next: (x, now) => board({ ...x, last: x.last }, now) };
      if (s.stage === 'mini' && s.mini) {
        const p = gameOf(s.mini.id).pause?.(s.mini.state);
        if (p) {
          return {
            ms: p.ms,
            next: (x, now) => {
              const q = gameOf(x.mini!.id).pause?.(x.mini!.state);
              return q ? plan(withMini(x, q.next(x.mini!.state, now)), now) : x;
            },
          };
        }
      }
      return null;
    },

    over: (s) => s.stage === 'done',

    results(s) {
      return B.standings(s.board).map((p, i) => ({ seat: p.id, place: i + 1, detail: `${p.pieces} Pieces, ${p.wins} mini-game win${p.wins === 1 ? '' : 's'}` }));
    },

    realtime: {
      wakeAt,
      tick,
      dropped(s, seat, now) {
        const game = s.mini ? gameOf(s.mini.id) : null;
        if (s.mini && game?.realtime && s.board.match?.seats.includes(seat)) return settle(withMini(s, game.realtime.dropped(s.mini.state, seat, now)), now);
        return s;
      },
      takeover(s, seat) {
        const now = Date.now();
        const seats = s.seats.map((x) => (x.id === seat ? { ...x, isBot: true } : x));
        let next: PartyState = { ...s, seats, board: { ...s.board, players: s.board.players.map((p) => (p.id === seat ? { ...p, isBot: true } : p)) } };
        if (next.stage === 'board' && B.current(next.board) === seat) next = { ...next, due: now + between(next.rng, BOT_BOARD_MS) };
        if (next.mini && next.board.match?.seats.includes(seat)) {
          const game = gameOf(next.mini.id);
          if (game.realtime) next = withMini(next, game.realtime.takeover(next.mini.state, seat));
          else if (next.mini.due[seat] !== undefined) next = { ...next, mini: { ...next.mini, due: { ...next.mini.due, [seat]: now + between(next.rng, BOT_MINI_MS) } } };
        }
        return next;
      },
    },
  };
}
