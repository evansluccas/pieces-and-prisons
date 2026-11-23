/**
 * Keeping player names decent. Guests pick any name and anyone can see it at
 * a table, so names are checked when they're chosen:
 *
 * - A few long, unmistakable slurs are refused ANYWHERE in a name, however
 *   it's disguised with accents, l33t digits or spaces.
 * - Shorter or ambiguous words are refused only as the WHOLE name, so real
 *   names that happen to contain them still work ("Fagundes", "Kike",
 *   "Cassandra", "Niger", "Bichara").
 * - Names that pose as staff ("admin", "moderator") are refused.
 *
 * No list is complete: players can also report a name at a table, and the
 * reports are kept for review (see server/admin.ts).
 */

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i' };

/** Lower case, accents off, l33t digits read as letters, everything but letters gone. */
export function plain(name: string): string {
  return name
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[0-9@$!]/g, (c) => LEET[c] ?? '')
    .replace(/[^a-z]/g, '');
}

/** Repeated letters squeezed ("shiiit" → "shit"). */
const squeezed = (s: string) => s.replace(/(.)\1+/g, '$1');
/** Runs of three or more letters cut to two ("shiiit" → "shiit"), keeping real double letters. */
const twice = (s: string) => s.replace(/(.)\1{2,}/g, '$1$1');
/** Does `name` (already plain) contain / equal `word`? Squeezing is only trusted for words without double letters,
 *  so that squeezing can't turn an ordinary word into a bad one ("Niger"). */
const has = (name: string, word: string) => twice(name).includes(word) || (squeezed(word) === word && squeezed(name).includes(word));
const is = (name: string, word: string) => twice(name) === word || (squeezed(word) === word && squeezed(name) === word);

// Unmistakable anywhere (in any name that contains one, it's the point of the name).
const ANYWHERE = [
  'nigger', 'nigga', 'faggot', 'wetback', 'raghead', 'tranny', 'rapist', 'pedophile', 'paedophile', 'hitler',
  'killyourself', 'motherfuck', 'fuck',
  'viado', 'sapatao', 'retardado', 'estuprador', 'pedofilo', 'caralho', 'buceta', 'arrombado',
  'maricon', 'pendejo',
];

// Refused as the whole name (also with repeated letters squeezed).
const WHOLE = [
  'shit', 'bitch', 'bastard', 'cock', 'pussy', 'whore', 'slut', 'ass', 'asshole', 'wanker', 'twat', 'cunt',
  'fag', 'spic', 'chink', 'kike', 'nazi', 'rape', 'kys', 'retard', 'pedo',
  'merda', 'foda', 'fodase', 'cu', 'otario', 'babaca', 'piranha', 'vagabunda', 'cuzao', 'puta', 'puto', 'porra',
  'bicha', 'macaco', 'crioulo', 'veado', 'mierda', 'joder', 'cabron',
];

const STAFF_ANYWHERE = ['admin', 'moderator', 'moderador'];
const STAFF_WHOLE = ['mod', 'mods', 'staff', 'support', 'suporte', 'system', 'sistema', 'official', 'oficial', 'server', 'servidor'];

/** Why a name isn't allowed, or null if it's fine. */
export function badName(name: string): string | null {
  const p = plain(name);
  if (!p) return null;
  if (ANYWHERE.some((w) => has(p, w)) || WHOLE.some((w) => is(p, w))) return 'That name isn’t allowed — please choose another.';
  if (STAFF_ANYWHERE.some((w) => p.includes(w)) || STAFF_WHOLE.includes(p)) return 'Names can’t look like staff names — please choose another.';
  return null;
}
