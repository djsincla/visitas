import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

export default function Users() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/api/users'),
  });

  const [showNew, setShowNew] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);

  if (isLoading) return <div>Loading…</div>;
  const users = data?.users ?? [];

  return (
    <>
      <div className="row between">
        <h1>Users</h1>
        <button onClick={() => setShowNew(s => !s)}>{showNew ? 'Cancel' : '+ Add user'}</button>
      </div>

      <p className="muted">
        Two roles: <code>admin</code> users are workshop members visitors can sign in to see, and they have full access to this admin UI.
        <code> security</code> users only see the active-visitors page and can force visitors out (useful for reception or end-of-day cleanup).
        Visitors themselves are not users.
      </p>

      {showNew && (
        <NewUser onCreated={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['users'] }); }} />
      )}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Display name</th>
              <th>Role</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Source</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <UserRow
                key={u.id}
                user={u}
                onReset={() => setResetTarget(u)}
                onChanged={() => qc.invalidateQueries({ queryKey: ['users'] })}
              />
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

function UserRow({ user, onReset, onChanged }) {
  const [editingRole, setEditingRole] = useState(false);
  const [role, setRole] = useState(user.role);
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: (body) => api.patch(`/api/users/${user.id}`, body),
    onSuccess: () => { setEditingRole(false); setErr(null); onChanged(); },
    onError: (e) => setErr(e.data?.error || e.message),
  });

  return (
    <tr>
      <td>{user.username}</td>
      <td>{user.displayName || <span className="muted">—</span>}</td>
      <td>
        {editingRole ? (
          <span className="row">
            <select value={role} onChange={e => setRole(e.target.value)} style={{ width: 'auto' }}>
              <option value="admin">admin (host)</option>
              <option value="security">security</option>
            </select>
            <button onClick={() => m.mutate({ role })} disabled={m.isPending || role === user.role}>Save</button>
            <button className="secondary" onClick={() => { setEditingRole(false); setRole(user.role); }}>Cancel</button>
          </span>
        ) : (
          <button className="secondary" onClick={() => setEditingRole(true)} title="Change role">
            <span className={`badge ${user.role === 'security' ? '' : 'muted'}`}>{user.role}</span>
          </button>
        )}
        {err && <div className="error" style={{ fontSize: 12 }}>{err}</div>}
      </td>
      <td>{user.email || <span className="muted">—</span>}</td>
      <td>{user.phone || <span className="muted">—</span>}</td>
      <td><span className={`badge ${user.source === 'ad' ? '' : 'muted'}`}>{user.source}</span></td>
      <td>
        {user.active
          ? (user.mustChangePassword ? <span className="badge muted">must change pw</span> : <span className="badge muted">active</span>)
          : <span className="badge disabled">disabled</span>}
      </td>
      <td style={{ textAlign: 'right' }}>
        <button className="secondary" onClick={onReset}>Reset password</button>
      </td>
    </tr>
  );
}

function NewUser({ onCreated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('admin');
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
      role,
      email: email || null,
      displayName: displayName || null,
      phone: phone || null,
    });
  };

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>New user</h2>
      <label htmlFor="new-user-role">Role <span className="req">*</span></label>
      <select id="new-user-role" value={role} onChange={e => setRole(e.target.value)}>
        <option value="admin">admin — workshop member, hostable, full admin UI</option>
        <option value="security">security — active-visitors page only, can force sign-out</option>
      </select>
      <label htmlFor="new-user-username">Username <span className="req">*</span></label>
      <input id="new-user-username" value={username} onChange={e => setUsername(e.target.value)} required autoFocus pattern="[A-Za-z0-9._-]+" />
      <label htmlFor="new-user-password">Initial password <span className="req">*</span></label>
      <input id="new-user-password" type="text" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} placeholder="≥ 10 chars, mix of upper/lower/digit" />
      <label htmlFor="new-user-display-name">Display name</label>
      <input id="new-user-display-name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
      <label htmlFor="new-user-email">Email</label>
      <input id="new-user-email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <label htmlFor="new-user-phone">Mobile (for SMS notifications)</label>
      <input id="new-user-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+15555550100" />
      {err && <div className="error">{err}</div>}
      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={m.isPending}>{m.isPending ? 'Creating…' : 'Create user'}</button>
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
