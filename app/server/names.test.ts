import { describe, expect, it } from 'vitest';
import { AuthError, checkGuestName, checkUsername, guest } from './auth';
import { openDb } from './db';
import { badName } from './names';
import { RoomView, Rooms, ServerMessage } from './rooms';

describe('player names', () => {
  it('refuses slurs, however they are disguised', () => {
    for (const n of ['nigger', 'N1GGER', 'n i g g a', 'Faggot99', 'fuuuck you', 'mr fuck', 'viado', 'V1ad0', 'sapatão', 'Hitler', 'KillYourself', 'caralho']) {
      expect(badName(n), n).not.toBeNull();
    }
  });

  it('refuses short swear words only as the whole name', () => {
    for (const n of ['shit', 'Sh1t', 'shiiit', 'puta', 'Porra', 'cu', 'ass', 'cunt']) expect(badName(n), n).not.toBeNull();
    // real names and words that merely contain them
    for (const n of ['Cassandra', 'Fagundes', 'Kike Ruiz', 'Niger', 'Bichara', 'Hancock', 'Reputação', 'Grape', 'Spice', 'Dick', 'Pedro', 'Scunthorpe', 'Mina', 'Luccas', 'João', 'Müller', 'Ana-Lu', 'Sven_2']) {
      expect(badName(n), n).toBeNull();
    }
  });

  it('refuses names that pose as staff', () => {
    for (const n of ['admin', 'Admin42', 'TheAdministrator', 'moderador', 'mod', 'Staff', 'support', 'Sistema']) expect(badName(n), n).not.toBeNull();
    for (const n of ['Modesto', 'Stafford', 'Sysadmin fan'.replace('admin', 'adm')]) expect(badName(n), n).toBeNull();
  });

  it('is checked when a guest or an account picks a name', () => {
    expect(() => checkGuestName('Puta')).toThrow(AuthError);
    expect(() => checkUsername('admin')).toThrow(/staff/);
    expect(checkGuestName('  Mina  ')).toBe('Mina');
  });
});

describe('reporting a name', () => {
  it('saves one report per player per day, never about bots or yourself', () => {
    const db = openDb(':memory:');
    const inbox = new Map<number, ServerMessage[]>();
    const rooms = new Rooms((id, m) => inbox.set(id, [...(inbox.get(id) ?? []), m]), db);
    const a = guest(db, 'Ana').user;
    const b = guest(db, 'Bob Rude').user;
    const last = (id: number) => [...(inbox.get(id) ?? [])].reverse().find((m) => m.type === 'error') as { message: string } | undefined;
    rooms.handle(a, { type: 'create', gameId: 'lonely-number' });
    const code = ([...(inbox.get(a.id) ?? [])].reverse().find((m) => m.type === 'room') as { room: RoomView }).room.code;
    rooms.handle(b, { type: 'join', code });
    rooms.handle(a, { type: 'addBot' });
    rooms.handle(a, { type: 'report', seat: 1 });
    expect(last(a.id)!.message).toMatch(/Bob Rude.*reported/);
    rooms.handle(a, { type: 'report', seat: 1 }); // again: thanked, not saved twice
    rooms.handle(a, { type: 'report', seat: 2 });
    expect(last(a.id)!.message).toMatch(/not bots/);
    rooms.handle(a, { type: 'report', seat: 0 });
    expect(last(a.id)!.message).toMatch(/yourself/);
    expect(db.prepare('SELECT reporter_id, reported_id, name, table_code FROM reports').all()).toEqual([
      { reporter_id: a.id, reported_id: b.id, name: 'Bob Rude', table_code: code },
    ]);
    // nothing reaches the reported player
    expect((inbox.get(b.id) ?? []).some((m) => m.type === 'error')).toBe(false);
  });
});
