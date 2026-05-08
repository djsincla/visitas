import { useQuery } from '@tanstack/react-query';
import { useBranding } from '../branding.jsx';
import { api } from '../api.js';

/**
 * Public wall view at /active. Designed to glance at from across a room —
 * during a fire drill, on a hallway monitor, or on someone's phone in a
 * pinch. Sanitized: visitor name + host + duration. No email, phone, purpose.
 *
 * Auto-refreshes every 30s.
 */
export default function WallView() {
  const { appName, logoUrl } = useBranding();
  const { data, isLoading, error } = useQuery({
    queryKey: ['visits-wall'],
    queryFn: () => api.get('/api/visits/active'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: (count, err) => err?.status !== 401 && count < 3,
  });

  const visits = data?.visits ?? [];
  const asOf = data?.asOf ? new Date(data.asOf) : new Date();
  const authRequired = error?.status === 401;

  return (
    <div className="wall-wrap">
      <header className="wall-header">
        <div className="wall-brand">
          {logoUrl
            ? <img src={logoUrl} alt={appName} />
            : <span className="wall-app-name">{appName}</span>}
        </div>
        <div className="wall-title">Currently on site</div>
        <div className="wall-asof">as of {asOf.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </header>

      {isLoading && <div className="wall-empty">Loading…</div>}
      {!isLoading && authRequired && (
        <div className="wall-empty">
          Sign-in required. The administrator has set the wall view to admins/security only.
        </div>
      )}
      {!isLoading && !authRequired && visits.length === 0 && (
        <div className="wall-empty">No visitors currently signed in.</div>
      )}

      {visits.length > 0 && (
        <ul className="wall-list">
          {visits.map(v => (
            <li key={v.id} className="wall-item">
              <span className="wall-name">{v.visitorName}</span>
              <span className="wall-host">
                visiting {v.hostName ?? '—'}
                {v.kioskName ? <span className="wall-kiosk muted"> · {v.kioskName}</span> : null}
              </span>
              <span className="wall-duration">{durationSince(v.signedInAt)}</span>
            </li>
          ))}
        </ul>
      )}

      <footer className="wall-footer muted">
        Refreshes every 30 seconds. {visits.length} visitor{visits.length === 1 ? '' : 's'} on site.
      </footer>
    </div>
  );
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
