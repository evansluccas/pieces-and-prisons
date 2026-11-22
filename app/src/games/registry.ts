import type { Category } from '../engine/atlas';

export type Stage = 'prison' | 'main' | 'exile' | 'final' | 'hidden';

export interface GameInfo {
  id: string;
  name: string;
  tagline: string;
  stage: Stage;
  players: string;
  icon: [Category, string];
  playable: boolean;
  /** Remembering what happened is part of the game: no running log or deduction aids during play. */
  memory?: boolean;
  /** Moves play out one at a time, so the Speed setting (Fast / Normal / Slow) applies. */
  paced?: boolean;
}

/** Every game is our own adaptation of a general mechanic, with its own name. */
export const GAMES: GameInfo[] = [
  { id: 'lonely-number', name: 'Lonely Number', tagline: 'Show two, keep one. The lowest number nobody else kept wins.', stage: 'prison', players: '3–6', icon: ['cards', 'number_1'], playable: true },
  { id: 'sand-bid', name: 'Sand Bid', tagline: 'Spend a shared hourglass of time to win blind auctions.', stage: 'prison', players: '3–6', icon: ['icons', 'hourglass'], playable: true },
  { id: 'dice-tower', name: 'Dice Tower', tagline: 'Draft dice, hide a secret one, and bet on your own result.', stage: 'prison', players: '3–6', icon: ['dice', 'die_red_5'], playable: true, paced: true },
  { id: 'tipping-scales', name: 'Tipping Scales', tagline: 'Load stones onto coloured scales — never be the one who tips it.', stage: 'prison', players: '3–7', icon: ['items', 'balance_scale'], playable: true, paced: true },
  { id: 'six-chambers', name: 'Six Chambers', tagline: 'Peek, spin and swap chambers before the cylinder fires.', stage: 'prison', players: '3–6', icon: ['items', 'revolver_loaded'], playable: true, paced: true, memory: true },
  { id: 'walls-and-wards', name: 'Walls & Wards', tagline: 'Move, build a wall, repeat. Claim the biggest territory.', stage: 'prison', players: '2–4', icon: ['board', 'counter_square_ruby'], playable: true, paced: true },
  { id: 'piggy-bluff', name: 'Piggy Bluff', tagline: 'Pass the piggy bank and call the coin count — or doubt it.', stage: 'prison', players: '3–6', icon: ['items', 'piggy_bank'], playable: true, paced: true, memory: true },
  { id: 'deadeye-holdem', name: "Deadeye Hold'em", tagline: 'Poker with four shared cards — and one secret shot to knock out a hand.', stage: 'prison', players: '2–6', icon: ['cards', 'spade_A'], playable: true, paced: true },
  { id: 'blind-bingo', name: 'Blind Bingo', tagline: 'Bid unbreakable coins for shapes. Nobody sees who won.', stage: 'main', players: '3–6', icon: ['board', 'shape_star'], playable: true },
  { id: 'smugglers-gems', name: "Smuggler's Gems", tagline: 'Swap gem cards, dodge bombs, and match the buyer.', stage: 'main', players: '3–6', icon: ['gems', 'diamond'], playable: true, paced: true, memory: true },
  { id: 'split-decision', name: 'Split Decision', tagline: 'Ten two-answer questions: cubes, sums, turf and card memory.', stage: 'main', players: '2–6', icon: ['icons', 'swap'], playable: true },
  { id: 'rumor-exchange', name: 'Rumor Exchange', tagline: 'Trade stocks whose hidden rules are revealed bit by bit.', stage: 'main', players: '2–6', icon: ['coins', 'coin_10'], playable: true },
  { id: 'high-low-equations', name: 'High-Low Equations', tagline: 'Build an equation from your cards and bet it lands nearest 1 or 20.', stage: 'main', players: '3–6', icon: ['cards', 'op_times'], playable: false },
  { id: 'turf-war', name: 'Turf War', tagline: 'Grow your land with turf pieces; your score is your biggest square.', stage: 'main', players: '2–4', icon: ['board', 'tile_grass'], playable: false },
  { id: 'tri-mancala', name: 'Tri-Mancala', tagline: 'Sow stones into three colours — only your weakest score counts.', stage: 'main', players: '2–4', icon: ['items', 'rock_medium'], playable: false },
  { id: 'color-doubt', name: 'Color Doubt', tagline: 'Bid on how many cards of a colour exist — or call the bluff.', stage: 'main', players: '3–6', icon: ['cards', 'color_ruby'], playable: true, paced: true },
  { id: 'number-forge', name: 'Number Forge', tagline: 'Race to forge the target from three tiles of a number pyramid.', stage: 'main', players: '2–6', icon: ['cards', 'op_plus'], playable: true },
  { id: 'second-glance', name: 'Second Glance', tagline: 'Memorise the scene, then mark the five things that changed.', stage: 'exile', players: '1+', icon: ['icons', 'eye'], playable: true },
  { id: 'piece-together', name: 'Piece Together', tagline: 'Fit eight pieces into the outline before the clock runs out.', stage: 'exile', players: '1+', icon: ['items', 'piece'], playable: true },
  { id: 'mirror-pieces', name: 'Mirror Pieces', tagline: 'Build shapes that mirror perfectly — pieces turn but never flip.', stage: 'exile', players: '1+', icon: ['icons', 'rotate'], playable: true },
  { id: 'nine-mens-morris', name: "Nine Men's Morris", tagline: 'The classic mill game: line up three to take a piece.', stage: 'final', players: '2', icon: ['board', 'counter_round_ivory'], playable: true, paced: true },
  { id: 'hex-sum', name: 'Hex Sum', tagline: 'Memorise a hex of numbers, then find three that hit the target.', stage: 'final', players: '2', icon: ['board', 'shape_circle'], playable: false },
  { id: 'high-or-low', name: 'High or Low', tagline: 'One card shown, one hidden: bet whether it is higher or lower.', stage: 'final', players: '2', icon: ['cards', 'number_7'], playable: false },
  { id: 'tigers-and-goats', name: 'Tigers & Goats', tagline: 'Play both sides at once: four tigers hunt twenty goats.', stage: 'final', players: '2', icon: ['icons', 'sword'], playable: false },
  { id: 'ask-and-arrange', name: 'Ask & Arrange', tagline: "Spend ten tokens on questions to uncover your rival's eight-card row.", stage: 'final', players: '2', icon: ['icons', 'question'], playable: false },
  { id: 'knights-tour', name: "Knight's Tour", tagline: 'Visit every square of the board exactly once with a knight.', stage: 'hidden', players: '1+', icon: ['icons', 'shield'], playable: false },
  { id: 'blind-five', name: 'Blind Five', tagline: 'Five in a row with face-down stones — remember which are yours.', stage: 'hidden', players: '2', icon: ['coins', 'coin_black'], playable: false },
  { id: 'magic-squares', name: 'Magic Squares', tagline: 'Fill ever-bigger magic squares so every line adds up.', stage: 'hidden', players: '1+', icon: ['icons', 'crown'], playable: false },
  { id: 'fence-loop', name: 'Fence Loop', tagline: 'Draw one closed fence that satisfies every number.', stage: 'exile', players: '1+', icon: ['board', 'tree'], playable: true },
  { id: 'cipher-lock', name: 'Cipher Lock', tagline: 'Deduce the four-letter code from its clues.', stage: 'exile', players: '1+', icon: ['icons', 'lock'], playable: true },
];

export const STAGE_LABEL: Record<Stage, string> = {
  prison: 'Prison matches',
  main: 'Main matches',
  exile: 'Exile puzzles',
  final: 'Final duels',
  hidden: 'Hidden stages',
};
