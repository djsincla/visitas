import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import BanModal from '../components/BanModal.jsx';

export default function Bans() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['bans', showInactive ? 'all' : 'active'],
    queryFn: () => api.get(showInactive ? '/api/bans' : '/api/bans?status=active'),
  });

  const lift = useMutation({
    mutationFn: ({ id, liftReason }) => api.post(`/api/bans/${id}/lift`, { liftReason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bans'] }),
  });

  if (isLoading) return <div>Loading…</div>;
  const bans = data?.bans ?? [];

  return (
    <>
      <div className="row between">
        <h1>Bans</h1>
        <div className="row">
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show lifted / expired
          </label>
          <button onClick={() => setShowModal(true)}>+ Add ban</button>
        </div>
      </div>

      <p className="muted">
        Bans block sign-in at the kiosk. The visitor sees a generic refusal (&ldquo;Sign-in not currently available, please see reception&rdquo;) — the reason is never shown to them, only to admins and security.
        Admin and security users on duty get an email + SMS notification when a banned visitor tries to sign in, so reception can intercept them.
      </p>

      {bans.length === 0 && <div className="panel"><p className="muted">No bans on file.</p></div>}

      {bans.length > 0 && (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Match</th>
                <th>Reason</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bans.map(b => <BanRow key={b.id} ban={b} onLift={(liftReason) => lift.mutate({ id: b.id, liftReason })} />)}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <BanModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ['bans'] }); }}
        />
      )}
    </>
  );
}

function BanRow({ ban, onLift }) {
  const [confirming, setConfirming] = useState(false);
  const [liftReason, setLiftReason] = useState('');

  const matchSummary = ban.mode === 'email' ? <code>{ban.email}</code>
    : ban.mode === 'name' ? <span>{ban.namePattern}{ban.companyPattern ? <span className="muted"> · {ban.companyPattern}</span> : null}</span>
    : <span className="muted">visitor #{ban.visitorId}</span>;

  return (
    <tr>
      <td>
        <div><span className="badge muted">{ban.mode}</span> {matchSummary}</div>
      </td>
      <td>{ban.reason}</td>
      <td className="muted" style={{ fontSize: 12 }}>
        {ban.createdBy?.displayName || ban.createdBy?.username}<br/>
        {shortDate(ban.createdAt)}
      </td>
      <td>{ban.expiresAt ? shortDate(ban.expiresAt) : <span className="muted">permanent</span>}</td>
      <td>
        {ban.active
          ? <span className="badge muted">active</span>
          : <span className="badge disabled">{ban.liftedAt ? 'lifted' : 'expired'}</span>}
      </td>
      <td style={{ textAlign: 'right' }}>
        {ban.active && !confirming && (
          <button className="secondary" onClick={() => setConfirming(true)}>Lift</button>
        )}
        {ban.active && confirming && (
          <span className="row" style={{ gap: 6 }}>
            <input
              placeholder="Reason for lifting (optional)"
              value={liftReason}
              onChange={e => setLiftReason(e.target.value)}
              style={{ width: 200 }}
            />
            <button className="danger" onClick={() => onLift(liftReason || null)}>Confirm lift</button>
            <button className="secondary" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        )}
      </td>
    </tr>
  );
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('T') ? '' : 'Z'));
  return d.toLocaleDateString();
}
