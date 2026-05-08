import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api.js';

/**
 * Add-a-ban form, used as a modal from the Visitors and Active Visitors
 * pages and from the standalone Bans page.
 *
 * `prefill` shape (all fields optional): {
 *   visitorId, visitorName, company, email
 * }
 *
 * Picks an initial mode based on what's available, but the admin/security
 * user can change it.
 */
export default function BanModal({ prefill = {}, onClose, onSaved }) {
  const initialMode = prefill.visitorId ? 'visitor'
    : prefill.email ? 'email'
    : 'name';

  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(prefill.email ?? '');
  const [namePattern, setNamePattern] = useState(prefill.visitorName ?? '');
  const [companyPattern, setCompanyPattern] = useState(prefill.company ?? '');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState(''); // empty = permanent

  const m = useMutation({
    mutationFn: (body) => api.post('/api/bans', body),
    onSuccess: (r) => onSaved?.(r.ban),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    const body = { mode, reason: reason.trim() };
    if (mode === 'visitor') body.visitorId = prefill.visitorId;
    if (mode === 'email')   body.email = email.trim();
    if (mode === 'name')    {
      body.namePattern = namePattern.trim();
      if (companyPattern.trim()) body.companyPattern = companyPattern.trim();
    }
    if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();
    m.mutate(body);
  };

  const targetSummary = (
    <span>
      {prefill.visitorName ? <strong>{prefill.visitorName}</strong> : <em className="muted">unknown name</em>}
      {prefill.company ? <> ({prefill.company})</> : null}
      {prefill.email ? <span className="muted"> · {prefill.email}</span> : null}
    </span>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="panel modal" onClick={e => e.stopPropagation()} onSubmit={onSubmit}>
        <h2 style={{ margin: 0 }}>Ban visitor</h2>
        <p className="muted" style={{ marginTop: 4 }}>{targetSummary}</p>

        <label htmlFor="ban-mode">Match mode <span className="req">*</span></label>
        <select id="ban-mode" value={mode} onChange={e => setMode(e.target.value)}>
          {prefill.visitorId && <option value="visitor">By visitor record (most specific)</option>}
          <option value="email">By email (case-insensitive exact)</option>
          <option value="name">By name + company (substring)</option>
        </select>

        {mode === 'email' && (
          <>
            <label htmlFor="ban-email">Email <span className="req">*</span></label>
            <input id="ban-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </>
        )}

        {mode === 'name' && (
          <>
            <label htmlFor="ban-name">Name pattern <span className="req">*</span></label>
            <input id="ban-name" value={namePattern} onChange={e => setNamePattern(e.target.value)} required placeholder="John Doe" />
            <label htmlFor="ban-company">Company pattern (optional, narrows the match)</label>
            <input id="ban-company" value={companyPattern} onChange={e => setCompanyPattern(e.target.value)} placeholder="ACME" />
          </>
        )}

        <label htmlFor="ban-reason">Reason <span className="req">*</span></label>
        <textarea id="ban-reason" value={reason} onChange={e => setReason(e.target.value)} required rows={3}
          placeholder="Visible only in the audit log + admin Bans page. Visitors get a generic refusal at the kiosk." />

        <label htmlFor="ban-expires">Expires (optional — leave blank for permanent)</label>
        <input id="ban-expires" type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />

        {m.error && <div className="error">{m.error.data?.error || m.error.message}</div>}

        <div className="row" style={{ marginTop: 16 }}>
          <button type="submit" className="danger" disabled={m.isPending || !reason.trim()}>
            {m.isPending ? 'Banning…' : 'Ban'}
          </button>
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
