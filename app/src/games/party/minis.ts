/**
 * The mini-games a Party can play: the facts both the server and the page
 * need (names, one-line blurbs, who they fit). How the server shortens each
 * one lives with the Party engine (server/games/party.ts).
 */
export interface MiniInfo {
  id: string;        // the game's id in the catalog (and on the hub)
  label: string;
  blurb: string;     // the Party's short version, in one line
  min: number;
  max: number;
  round: boolean;    // fits the mini-game after a round (everyone / teams)
  duel: boolean;     // fits a duel
}

export const MINI_INFO: MiniInfo[] = [
  { id: 'cipher-lock', label: 'Cipher Lock', blurb: 'Crack the 4-letter code from its clues. Wrong tries cost 30 s.', min: 1, max: 8, round: true, duel: true },
  { id: 'magic-squares', label: 'Magic Squares', blurb: 'Fill the 3×3 square so every line adds up to 15.', min: 1, max: 8, round: true, duel: true },
  { id: 'knights-tour', label: "Knight's Tour", blurb: 'Visit every square of the 6×6 board once with the knight.', min: 1, max: 8, round: true, duel: true },
  { id: 'second-glance', label: 'Second Glance', blurb: 'Study the scene, then spot the five changes.', min: 1, max: 8, round: true, duel: true },
  { id: 'fence-loop', label: 'Fence Loop', blurb: 'Draw one closed fence that fits every number.', min: 1, max: 8, round: true, duel: true },
  { id: 'mirror-pieces', label: 'Mirror Pieces', blurb: 'Build the mirror image — pieces turn but never flip.', min: 1, max: 8, round: true, duel: true },
  { id: 'piece-together', label: 'Piece Together', blurb: 'Fit every piece into the outline.', min: 1, max: 8, round: true, duel: true },
  { id: 'split-decision', label: 'Split Decision', blurb: 'Three quick two-answer questions. Right and fast wins.', min: 2, max: 8, round: true, duel: true },
  { id: 'number-forge', label: 'Number Forge', blurb: 'One round: forge the target from three tiles, fastest first.', min: 2, max: 6, round: true, duel: true },
  { id: 'dice-tower', label: 'Dice Tower', blurb: 'One round: draft dice, keep a secret one, bet on your place.', min: 3, max: 6, round: true, duel: false },
  { id: 'lonely-number', label: 'Lonely Number', blurb: 'Two rounds: show two cards, keep one — the lowest unique card wins.', min: 3, max: 6, round: true, duel: false },
  { id: 'tipping-scales', label: 'Tipping Scales', blurb: 'Three rounds of stones and chips — don’t be the one who tips a scale.', min: 2, max: 8, round: true, duel: false },
  { id: 'high-or-low', label: 'High or Low', blurb: 'Four cards each way: is the hidden card higher or lower?', min: 2, max: 2, round: false, duel: true },
];

export const miniInfo = (id: string) => MINI_INFO.find((m) => m.id === id);
