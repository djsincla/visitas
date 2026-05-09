import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import BanModal from '../components/BanModal.jsx';

export default function Visitors() {
  const qc = useQueryClient();
  const [banTarget, setBanTarget] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ['visitors'],
    queryFn: () => api.get('/api/visitors'),
  });

  if (isLoading) return <div>Loading…</div>;
  const visitors = data?.visitors ?? [];

  return (
    <>
      <h1>Visitors</h1>
      <p className="muted">
        Everyone the kiosk has ever signed in. Visitors are keyed by email; one row per email address. Returning visitors get their details
        pre-filled at the kiosk, and if their NDA is fresh (signed against the <em>current</em> active NDA version in the last 365 days)
        the kiosk skips the NDA step on their next visit. Anonymous visitors (no email) sign in just fine but don&rsquo;t appear here.
      </p>

      {visitors.length === 0 && <div className="panel"><p className="muted">No visitors yet.</p></div>}

      {visitors.length > 0 && (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Phone</th>
                <th style={{ textAlign: 'right' }}>Visits</th>
                <th>Last seen</th>
                <th>NDA on file</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visitors.map(v => (
                <tr key={v.id}>
                  <td>{v.name}</td>
                  <td>{v.email || <span className="muted">—</span>}</td>
                  <td>{v.company || <span className="muted">—</span>}</td>
                  <td>{v.phone || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.visitCount}</td>
                  <td title={v.lastSeenAt}>{relative(v.lastSeenAt)}</td>
                  <td>
                    {v.ndaCacheFresh
                      ? <span className="badge muted" title={`v${v.ndaCacheVersion} signed ${v.ndaCacheAcknowledgedAt}`}>v{v.ndaCacheVersion} fresh</span>
                      : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="secondary"
                      onClick={() => setBanTarget({ visitorId: v.id, visitorName: v.name, company: v.company, email: v.email })}
                    >
                      Ban
                    </button>
                    <button
                      className="danger"
                      style={{ marginLeft: 8 }}
                      onClick={() => setPurgeTarget(v)}
                      title="GDPR right-to-be-forgotten — deletes the visitor record + scrubs PII from past visits"
                    >
                      Purge
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {banTarget && (
        <BanModal
          prefill={banTarget}
          onClose={() => setBanTarget(null)}
          onSaved={() => { setBanTarget(null); qc.invalidateQueries({ queryKey: ['visitors'] }); }}
        />
      )}

      {purgeTarget && (
        <PurgeModal
          visitor={purgeTarget}
          onClose={() => setPurgeTarget(null)}
          onPurged={() => {
            setPurgeTarget(null);
            qc.invalidateQueries({ queryKey: ['visitors'] });
          }}
        />
      )}
    </>
  );
}

function PurgeModal({ visitor, onClose, onPurged }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const expectedConfirm = visitor.email || visitor.name;

  const submit = async (e) => {
    e.preventDefault();
    if (confirm !== expectedConfirm) {
      setErr(`Type "${expectedConfirm}" to confirm.`);
      return;
    }
    setErr(null); setBusy(true);
    try {
      const res = await fetch(`/api/visitors/${visitor.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || null }),
      });
      const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      onPurged(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Purge {visitor.name}</h2>
        <p className="muted">
          GDPR Art. 17 right-to-be-forgotten. <strong>This is irreversible.</strong> Deletes the visitor record and removes
          name, company, email, phone, signature, and photo from every past visit, invitation, and notification log entry
          tied to this visitor. Visit timestamps + host + sign-in/out shape are kept so the audit trail isn&rsquo;t broken.
          Active bans referencing the visitor stay active but lose their visitor-id link.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="purge-reason">Reason (optional, recorded in audit log)</label>
          <input
            id="purge-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. subject access request 2026-05"
            maxLength={512}
          />
          <label htmlFor="purge-confirm" style={{ marginTop: 12 }}>
            Type <code>{expectedConfirm}</code> to confirm
          </label>
          <input
            id="purge-confirm"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="off"
          />
          {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button type="submit" className="danger" disabled={busy || confirm !== expectedConfirm}>
              {busy ? 'Purging…' : 'Purge visitor'}
            </button>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function relative(iso) {
  if (!iso) return '';
  const t = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString();
}
