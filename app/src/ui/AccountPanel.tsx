import { FormEvent, useEffect, useState } from 'react';
import { ApiError, Me, Offline, account } from '../net/account';
import { Panel } from './Panel';

type Mode = 'guest' | 'login' | 'signup' | 'upgrade' | 'delete';

/**
 * Who you are for online play: a guest (just a name) or an account
 * (username + password). Nothing else is asked for. Solo games never need it.
 */
export function AccountPanel() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = still loading
  const [offline, setOffline] = useState(false);
  const [mode, setMode] = useState<Mode>('guest');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    account.me().then(setMe, (e) => {
      if (e instanceof Offline) setOffline(true);
      setMe(null);
    });
  }, []);

  const go = (m: Mode) => {
    setMode(m);
    setError('');
    setPassword('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const next = mode === 'guest' ? await account.guest(name)
        : mode === 'login' ? await account.login(name, password)
          : mode === 'signup' ? await account.signup(name, password)
            : mode === 'upgrade' ? await account.upgrade(name, password)
              : await account.remove(password);
      setMe(next);
      setName('');
      setPassword('');
      setMode('guest');
    } catch (err) {
      if (err instanceof Offline) setOffline(true);
      setError(err instanceof ApiError || err instanceof Offline ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      setMe(await account.logout());
    } catch {
      setOffline(true);
    }
  };

  if (me === undefined) return null;
  if (offline) {
    return (
      <Panel className="account">
        <p className="muted">Online play is unavailable — the game server isn’t running. Every game still works against bots.</p>
      </Panel>
    );
  }

  const needsPassword = mode !== 'guest';
  const needsName = mode !== 'delete';
  const label: Record<Mode, string> = { guest: 'Play as guest', login: 'Sign in', signup: 'Create account', upgrade: 'Save my account', delete: 'Delete for good' };

  const form = (
    <form className="account-form" onSubmit={submit}>
      {needsName && (
        <input
          aria-label={mode === 'guest' ? 'Your name' : 'Username'}
          placeholder={mode === 'guest' ? 'Your name' : 'Username'}
          value={name}
          maxLength={16}
          autoComplete={mode === 'guest' ? 'nickname' : 'username'}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      {needsPassword && (
        <input
          aria-label="Password"
          placeholder="Password"
          type="password"
          value={password}
          maxLength={128}
          autoComplete={mode === 'login' || mode === 'delete' ? 'current-password' : 'new-password'}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      <button className={`btn ${mode === 'delete' ? 'danger' : ''}`} disabled={busy}>{label[mode]}</button>
      {error && <p className="account-error">{error}</p>}
      {(mode === 'signup' || mode === 'upgrade') && (
        <p className="account-note">No email, no personal details. That also means a forgotten password can’t be recovered — keep it somewhere safe.</p>
      )}
      {mode === 'guest' && <p className="account-note">Just a name. You can turn it into an account later and keep your history.</p>}
      {mode === 'delete' && <p className="account-note">This deletes your account and signs you out. Past tables keep only the name you played under.</p>}
    </form>
  );

  if (me) {
    return (
      <Panel className="account">
        <div className="account-row">
          <span>
            Playing as <b className="gold">{me.name}</b>{me.guest ? <span className="muted"> (guest)</span> : null}
          </span>
          <span className="account-links">
            {me.guest
              ? <button className="link" onClick={() => go(mode === 'upgrade' ? 'guest' : 'upgrade')}>Create account</button>
              : <button className="link" onClick={() => go(mode === 'delete' ? 'guest' : 'delete')}>Delete account</button>}
            <button className="link" onClick={signOut}>Sign out</button>
          </span>
        </div>
        {(mode === 'upgrade' || mode === 'delete') && form}
      </Panel>
    );
  }

  return (
    <Panel className="account">
      <div className="account-row">
        <span className="muted">Online play:</span>
        <span className="account-tabs" role="tablist">
          {(['guest', 'login', 'signup'] as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={`tab ${mode === m ? 'on' : ''}`} onClick={() => go(m)}>
              {m === 'guest' ? 'Guest' : m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </span>
      </div>
      {form}
    </Panel>
  );
}
