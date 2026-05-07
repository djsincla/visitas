import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';

export default function Visitors() {
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
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
