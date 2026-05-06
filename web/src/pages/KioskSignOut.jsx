import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useBranding } from '../branding.jsx';
import { api } from '../api.js';

export default function KioskSignOut() {
  const { appName, logoUrl } = useBranding();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['active-visitors-public'],
    queryFn: () => api.get('/api/visits/active'),
    refetchInterval: 10_000,
  });

  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [signedOut, setSignedOut] = useState(null);

  useEffect(() => {
    if (!signedOut) return;
    const t = setTimeout(() => nav('/kiosk'), 4000);
    return () => clearTimeout(t);
  }, [signedOut, nav]);

  const onSignOut = async (id) => {
    setBusy(id); setErr(null);
    try {
      const r = await api.post(`/api/visits/${id}/sign-out`, {});
      setSignedOut(r.visit);
      qc.invalidateQueries({ queryKey: ['active-visitors-public'] });
    } catch (e) {
      setErr(e.data?.error || e.message);
    } finally { setBusy(null); }
  };

  if (signedOut) {
    return (
      <div className="kiosk-wrap">
        <div className="kiosk-brand">
          {logoUrl ? <img src={logoUrl} alt={appName} /> : <div className="kiosk-app-name">{appName}</div>}
        </div>
        <div className="kiosk-card">
          <h1>Goodbye, {signedOut.visitorName?.split(' ')[0] || 'visitor'}.</h1>
          <p>You&rsquo;ve been signed out. Have a good day.</p>
          <div className="kiosk-stub">Returning to the welcome screen automatically…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kiosk-wrap">
      <div className="kiosk-brand">
        {logoUrl ? <img src={logoUrl} alt={appName} /> : <div className="kiosk-app-name">{appName}</div>}
      </div>
      <div className="kiosk-card kiosk-signout">
        <h1>Sign out</h1>
        <p>Tap your name below to sign out.</p>

        {isLoading && <p className="muted">Loading…</p>}
        {!isLoading && data?.visits?.length === 0 && (
          <p className="muted">No one is currently signed in.</p>
        )}
        {err && <div className="error">{err}</div>}

        <div className="signout-list">
          {(data?.visits ?? []).map(v => (
            <button
              key={v.id}
              type="button"
              className="signout-item"
              disabled={busy === v.id}
              onClick={() => onSignOut(v.id)}
            >
              <span className="signout-name">{v.visitorName}</span>
              <span className="signout-host muted">visiting {v.hostName ?? 'someone'}</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 24 }}>
          <Link to="/kiosk" className="muted">← Back to sign-in</Link>
        </div>
      </div>
    </div>
  );
}
