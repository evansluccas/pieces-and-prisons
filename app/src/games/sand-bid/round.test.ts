import { describe, expect, it } from 'vitest';
import { COUNTDOWN_MS, bidsOf, clockMs, openRound, press, release, tick } from './round';

const banks = { a: 10_000, b: 10_000, c: 10_000 };
const allPressed = (t = 0) => ['a', 'b', 'c'].reduce((r, id) => press(r, id, t), openRound(banks));

describe('live round', () => {
  it('starts the countdown only when every active player is holding', () => {
    let r = openRound(banks);
    r = press(r, 'a', 0);
    r = press(r, 'b', 0);
    expect(r.stage).toBe('gathering');
    r = press(r, 'c', 50);
    expect(r).toMatchObject({ stage: 'countdown', countdownAt: 50 });
  });

  it('letting go before everyone is ready just un-readies you', () => {
    let r = press(openRound(banks), 'a', 0);
    r = release(r, 'a', 10);
    expect(r.holders.a.status).toBe('waiting');
  });

  it('letting go during the countdown sits you out for free', () => {
    let r = allPressed();
    r = release(r, 'b', 1000);
    expect(r.holders.b).toEqual({ status: 'released', bid: 0 });
  });

  it('keeps running until the LAST player lets go', () => {
    let r = tick(allPressed(), COUNTDOWN_MS);
    expect(r.stage).toBe('running');
    r = release(r, 'a', COUNTDOWN_MS + 2_000);
    r = release(r, 'b', COUNTDOWN_MS + 5_000);
    expect(r.stage).toBe('running');
    r = tick(r, COUNTDOWN_MS + 6_000);
    expect(r.stage).toBe('running');
    expect(clockMs(r, COUNTDOWN_MS + 6_000)).toBe(6_000);
    r = release(r, 'c', COUNTDOWN_MS + 7_500);
    expect(r.stage).toBe('over');
    expect(bidsOf(r)).toEqual({ a: 2_000, b: 5_000, c: 7_500 });
    expect(clockMs(r, 999_999)).toBe(7_500); // frozen at the winning hold
  });

  it('auto-releases a player whose bank runs out', () => {
    let r = openRound({ a: 3_000, b: 10_000 });
    r = press(press(r, 'a', 0), 'b', 0);
    r = tick(r, COUNTDOWN_MS);
    r = tick(r, COUNTDOWN_MS + 3_500);
    expect(r.holders.a).toEqual({ status: 'released', bid: 3_000 });
    expect(r.stage).toBe('running');
  });

  it('players with an empty bank are out and never block the round', () => {
    let r = openRound({ me: 0, b: 5_000 });
    expect(r.holders.me.status).toBe('out');
    r = press(r, 'b', 0);
    expect(r.stage).toBe('countdown');
    r = tick(r, COUNTDOWN_MS);
    r = tick(r, COUNTDOWN_MS + 5_000);
    expect(r.stage).toBe('over');
    expect(bidsOf(r)).toEqual({ me: 0, b: 5_000 });
  });

  it('ends at the countdown if everyone sat out, and instantly if all banks are empty', () => {
    let r = allPressed();
    for (const id of ['a', 'b', 'c']) r = release(r, id, 500);
    r = tick(r, COUNTDOWN_MS);
    expect(r.stage).toBe('over');
    expect(openRound({ a: 0, b: 0 }).stage).toBe('over');
  });
});
