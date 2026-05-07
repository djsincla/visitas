import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

export default function Invitations() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.get('/api/invitations'),
  });
  const [showNew, setShowNew] = useState(false);

  if (isLoading) return <div>Loading…</div>;
  const invitations = data?.invitations ?? [];

  const onChanged = () => qc.invalidateQueries({ queryKey: ['invitations'] });

  return (
    <>
      <div className="row between">
        <h1>Invitations</h1>
        <button onClick={() => setShowNew(s => !s)}>{showNew ? 'Cancel' : '+ New invitation'}</button>
      </div>

      <p className="muted">
        Pre-book an expected visitor. We&rsquo;ll email them a link with a QR code; on arrival they scan the QR
        with their phone&rsquo;s camera (or open the link on the iPad), the kiosk pre-fills their details and
        locks the host. The invitation is single-use and expires after 7 days by default.
      </p>

      {showNew && <NewInvitation onCreated={() => { setShowNew(false); onChanged(); }} />}

      {invitations.length === 0 && <div className="panel"><p className="muted">No invitations yet.</p></div>}

      {invitations.length > 0 && (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Visitor</th>
                <th>Host</th>
                <th>Expected</th>
                <th>Status</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invitations.map(inv => (
                <InvitationRow key={inv.id} inv={inv} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function InvitationRow({ inv, onChanged }) {
  const [copied, setCopied] = useState(false);

  const cancel = useMutation({
    mutationFn: () => api.delete(`/api/invitations/${inv.id}`),
    onSuccess: onChanged,
  });
  const resend = useMutation({
    mutationFn: () => api.post(`/api/invitations/${inv.id}/resend`, {}),
    onSuccess: onChanged,
  });

  const inviteUrl = `${window.location.origin}${inv.kiosk?.slug ? `/kiosk/${inv.kiosk.slug}` : '/kiosk/default'}?invite=${inv.token}`;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <tr>
      <td>
        <div>{inv.visitorName}</div>
        <div className="muted" style={{ fontSize: 12 }}>{inv.email}</div>
      </td>
      <td>{inv.host?.displayName || inv.host?.username}</td>
      <td>{inv.expectedAt || <span className="muted">—</span>}</td>
      <td>
        <span className={`badge ${inv.status === 'sent' ? 'muted' : inv.status === 'used' ? '' : 'disabled'}`}>
          {inv.status}
        </span>
      </td>
      <td>{shortDate(inv.expiresAt)}</td>
      <td style={{ textAlign: 'right' }}>
        {inv.status === 'sent' && (
          <span className="row" style={{ gap: 6 }}>
            <button className="secondary" onClick={onCopy}>{copied ? 'Copied!' : 'Copy link'}</button>
            <button className="secondary" onClick={() => resend.mutate()} disabled={resend.isPending}>Resend</button>
            <button className="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel</button>
          </span>
        )}
      </td>
    </tr>
  );
}

function NewInvitation({ onCreated }) {
  const hostsQ = useQuery({ queryKey: ['hosts'], queryFn: () => api.get('/api/hosts') });
  const kiosksQ = useQuery({ queryKey: ['kiosks-active'], queryFn: () => api.get('/api/kiosks?activeOnly=true') });

  const [visitorName, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [hostUserId, setHostUserId] = useState('');
  const [kioskSlug, setKioskSlug] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [purpose, setPurpose] = useState('');
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: (body) => api.post('/api/invitations', body),
    onSuccess: onCreated,
    onError: (e) => setErr(e.data?.error || e.message),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    setErr(null);
    if (!hostUserId) { setErr('Pick a host.'); return; }
    m.mutate({
      visitorName: visitorName.trim(),
      email: email.trim(),
      company: company.trim() || null,
      phone: phone.trim() || null,
      hostUserId: Number(hostUserId),
      kioskSlug: kioskSlug || null,
      expectedAt: expectedAt || null,
      purpose: purpose.trim() || null,
    });
  };

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>New invitation</h2>
      <label>Visitor name <span className="req">*</span></label>
      <input value={visitorName} onChange={e => setName(e.target.value)} required />
      <label>Visitor email <span className="req">*</span></label>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <label>Company</label>
      <input value={company} onChange={e => setCompany(e.target.value)} />
      <label>Phone</label>
      <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
      <label>Host <span className="req">*</span></label>
      <select value={hostUserId} onChange={e => setHostUserId(e.target.value)} required>
        <option value="">Choose a host…</option>
        {(hostsQ.data?.hosts ?? []).map(h => <option key={h.id} value={h.id}>{h.displayName}</option>)}
      </select>
      <label>Kiosk (optional — locks invitation to this entrance)</label>
      <select value={kioskSlug} onChange={e => setKioskSlug(e.target.value)}>
        <option value="">Any kiosk</option>
        {(kiosksQ.data?.kiosks ?? []).map(k => <option key={k.slug} value={k.slug}>{k.name}</option>)}
      </select>
      <label>Expected (free-form, e.g. &ldquo;Tuesday 2pm&rdquo;)</label>
      <input value={expectedAt} onChange={e => setExpectedAt(e.target.value)} />
      <label>Purpose</label>
      <input value={purpose} onChange={e => setPurpose(e.target.value)} />
      {err && <div className="error">{err}</div>}
      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={m.isPending}>{m.isPending ? 'Sending…' : 'Create + email'}</button>
      </div>
    </form>
  );
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString();
}
