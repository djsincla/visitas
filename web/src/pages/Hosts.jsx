import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

export default function Hosts() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/api/users'),
  });

  const [showNew, setShowNew] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);

  if (isLoading) return <div>Loading hosts…</div>;
  const users = data?.users ?? [];

  return (
    <>
      <div className="row between">
        <h1>Hosts</h1>
        <button onClick={() => setShowNew(s => !s)}>{showNew ? 'Cancel' : '+ Add host'}</button>
      </div>

      <p className="muted">
        Hosts are workshop members visitors can sign in to see. They&rsquo;re also the only people who can log in to this admin UI.
        Create a host here, hand them the generated password, they change it on first login.
      </p>

      {showNew && (
        <NewHost onCreated={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['users'] }); }} />
      )}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Display name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Source</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.displayName || <span className="muted">—</span>}</td>
                <td>{u.email || <span className="muted">—</span>}</td>
                <td>{u.phone || <span className="muted">—</span>}</td>
                <td>
                  <span className={`badge ${u.source === 'ad' ? '' : 'muted'}`}>{u.source}</span>
                </td>
                <td>
                  {u.active
                    ? (u.mustChangePassword ? <span className="badge muted">must change pw</span> : <span className="badge muted">active</span>)
                    : <span className="badge disabled">disabled</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="secondary" onClick={() => setResetTarget(u)}>Reset password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resetTarget && (
        <ResetPassword user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
    </>
  );
}

function NewHost({ onCreated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: (body) => api.post('/api/users', body),
    onSuccess: onCreated,
    onError: (e) => setErr(e.data?.error || e.message),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    setErr(null);
    m.mutate({
      username,
      password,
      email: email || null,
      displayName: displayName || null,
      phone: phone || null,
    });
  };

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>New host</h2>
      <label>Username <span className="req">*</span></label>
      <input value={username} onChange={e => setUsername(e.target.value)} required autoFocus pattern="[A-Za-z0-9._-]+" />
      <label>Initial password <span className="req">*</span></label>
      <input type="text" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} placeholder="≥ 10 chars, mix of upper/lower/digit" />
      <label>Display name</label>
      <input value={displayName} onChange={e => setDisplayName(e.target.value)} />
      <label>Email</label>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <label>Mobile (for SMS notifications)</label>
      <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+15555550100" />
      {err && <div className="error">{err}</div>}
      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={m.isPending}>{m.isPending ? 'Creating…' : 'Create host'}</button>
      </div>
    </form>
  );
}

function ResetPassword({ user, onClose }) {
  const [generated, setGenerated] = useState(null);
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: () => api.post(`/api/users/${user.id}/reset-password`, {}),
    onSuccess: (r) => setGenerated(r.password),
    onError: (e) => setErr(e.data?.error || e.message),
  });

  return (
    <div className="panel">
      <h2>Reset password for {user.username}</h2>
      {!generated && (
        <>
          <p className="muted">
            Generates a strong random password and forces them to change it on next login.
            Hand them the password through a trusted channel.
          </p>
          <div className="row">
            <button onClick={() => m.mutate()} disabled={m.isPending}>Generate new password</button>
            <button className="secondary" onClick={onClose}>Cancel</button>
          </div>
          {err && <div className="error">{err}</div>}
        </>
      )}
      {generated && (
        <>
          <p>New password (will not be shown again):</p>
          <pre className="panel" style={{ background: 'var(--panel-2)', padding: 12 }}>{generated}</pre>
          <button onClick={onClose}>Done</button>
        </>
      )}
    </div>
  );
}
