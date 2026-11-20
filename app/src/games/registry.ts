import type { Category } from '../engine/atlas';

export type Stage = 'prison' | 'main' | 'exile';

export interface GameInfo {
  id: string;
  name: string;
  tagline: string;
  stage: Stage;
  players: string;
  icon: [Category, string];
  playable: boolean;
}

/** Every game is our own adaptation of a general mechanic, with its own name. */
export const GAMES: GameInfo[] = [
  { id: 'lonely-number', name: 'Lonely Number', tagline: 'Show two, keep one. The lowest number nobody else kept wins.', stage: 'prison', players: '3–6', icon: ['cards', 'number_1'], playable: true },
  { id: 'sand-bid', name: 'Sand Bid', tagline: 'Spend a shared hourglass of time to win blind auctions.', stage: 'prison', players: '3–6', icon: ['icons', 'hourglass'], playable: false },
  { id: 'dice-tower', name: 'Dice Tower', tagline: 'Build the best three-dice hand and predict your own score.', stage: 'prison', players: '3–6', icon: ['dice', 'die_red_5'], playable: false },
  { id: 'tipping-scales', name: 'Tipping Scales', tagline: 'Load stones onto coloured scales — never be the one who tips it.', stage: 'prison', players: '3–7', icon: ['items', 'balance_scale'], playable: false },
  { id: 'six-chambers', name: 'Six Chambers', tagline: 'Peek, spin and swap chambers before the cylinder fires.', stage: 'prison', players: '6', icon: ['items', 'revolver_loaded'], playable: false },
  { id: 'walls-and-wards', name: 'Walls & Wards', tagline: 'Move, build a wall, repeat. Claim the biggest territory.', stage: 'prison', players: '2–4', icon: ['board', 'counter_square_ruby'], playable: false },
  { id: 'piggy-bluff', name: 'Piggy Bluff', tagline: 'Pass the piggy bank and call the coin count — or doubt it.', stage: 'prison', players: '3–6', icon: ['items', 'piggy_bank'], playable: false },
  { id: 'blind-bingo', name: 'Blind Bingo', tagline: 'Bid unbreakable coins for shapes. Nobody sees who won.', stage: 'main', players: '4–8', icon: ['board', 'shape_star'], playable: false },
  { id: 'smugglers-gems', name: "Smuggler's Gems", tagline: 'Swap gem cards, dodge bombs, and match the buyer.', stage: 'main', players: '4–8', icon: ['gems', 'diamond'], playable: false },
  { id: 'rumor-exchange', name: 'Rumor Exchange', tagline: 'Trade stocks whose hidden rules are revealed bit by bit.', stage: 'main', players: '4–12', icon: ['coins', 'coin_10'], playable: false },
  { id: 'color-doubt', name: 'Color Doubt', tagline: 'Bid on how many cards of a colour exist — or call the bluff.', stage: 'main', players: '3–6', icon: ['cards', 'color_ruby'], playable: false },
  { id: 'number-forge', name: 'Number Forge', tagline: 'Combine three numbers to hit the target first.', stage: 'main', players: '2–6', icon: ['cards', 'op_plus'], playable: false },
  { id: 'second-glance', name: 'Second Glance', tagline: 'Memorise the scene, then mark what changed.', stage: 'exile', players: '1+', icon: ['icons', 'eye'], playable: false },
  { id: 'fence-loop', name: 'Fence Loop', tagline: 'Draw one closed fence that satisfies every number.', stage: 'exile', players: '1+', icon: ['board', 'wall_h'], playable: false },
  { id: 'cipher-lock', name: 'Cipher Lock', tagline: 'Deduce the four-letter code from its clues.', stage: 'exile', players: '1+', icon: ['icons', 'lock'], playable: false },
];

export const STAGE_LABEL: Record<Stage, string> = {
  prison: 'Prison matches',
  main: 'Main matches',
  exile: 'Exile puzzles',
};
