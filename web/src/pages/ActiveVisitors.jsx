import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

export default function ActiveVisitors() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['visits', 'on_site'],
    queryFn: () => api.get('/api/visits?status=on_site'),
    refetchInterval: 30_000,
  });

  const signOut = useMutation({
    mutationFn: (id) => api.post(`/api/visits/${id}/sign-out`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visits', 'on_site'] }),
  });

  const [confirming, setConfirming] = useState(null);

  return (
    <>
      <div className="row between">
        <h1>Active visitors</h1>
        <div className="muted">Auto-refreshes every 30 s.</div>
      </div>

      <p className="muted">
        Everyone currently signed in. Force sign-out below if a visitor has left without using the kiosk &mdash;
        the audit log records that you signed them out.
      </p>

      {isLoading && <div className="panel"><p className="muted">Loading…</p></div>}

      {!isLoading && data?.visits?.length === 0 && (
        <div className="panel"><p className="muted">No one is currently on-site.</p></div>
      )}

      {data?.visits?.length > 0 && (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Host</th>
                <th>Kiosk</th>
                <th>Purpose</th>
                <th>Signed in</th>
                <th>On site</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.visits.map(v => (
                <tr key={v.id}>
                  <td>{v.visitorName}</td>
                  <td>{v.company || <span className="muted">—</span>}</td>
                  <td>{v.host?.displayName || v.host?.username || <span className="muted">—</span>}</td>
                  <td>{v.kiosk?.name || <span className="muted">—</span>}</td>
                  <td>{v.purpose || <span className="muted">—</span>}</td>
                  <td title={v.signedInAt}>{formatTime(v.signedInAt)}</td>
                  <td>{durationSince(v.signedInAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {confirming === v.id ? (
                      <span className="row">
                        <button className="danger" onClick={() => { signOut.mutate(v.id); setConfirming(null); }}>
                          Confirm sign out
                        </button>
                        <button className="secondary" onClick={() => setConfirming(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="secondary" onClick={() => setConfirming(v.id)}>Force sign out</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function durationSince(iso) {
  if (!iso) return '';
  const start = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.max(0, Math.floor((Date.now() - start) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}
