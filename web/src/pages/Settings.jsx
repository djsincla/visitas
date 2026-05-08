import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBranding } from '../branding.jsx';
import { useTheme } from '../theme.jsx';
import { api } from '../api.js';

export default function Settings() {
  const { appName, logoUrl, refresh } = useBranding();
  const [file, setFile] = useState(null);
  const [name, setName] = useState(appName);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const onUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setErr(null); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await fetch('/api/settings/branding/logo', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      await refresh();
      setFile(null);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onClearLogo = async () => {
    setBusy(true); setErr(null);
    try {
      await api.delete('/api/settings/branding/logo');
      await refresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onSaveName = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/settings/branding', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName: name }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await refresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h1>Settings</h1>
      {err && <div className="error">{err}</div>}

      <ThemePicker />

      <PhotoCaptureToggle />

      <PhotoRetention />

      <WallViewPrivacy />

      <NotificationTester />

      <NotificationsLogPanel />

      <div className="panel">
        <h2>Branding</h2>
        <p className="muted">Shown in the topbar, on the kiosk welcome screen, on the login screen, and (in v0.4) on the printable badge.</p>
        <label>Application name</label>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={64} />
        <div style={{ marginTop: 8 }}>
          <button onClick={onSaveName} disabled={busy || name === appName}>Save name</button>
        </div>

        <h2>Logo</h2>
        <div className="muted" style={{ marginBottom: 8 }}>PNG, SVG, JPEG, or WebP. Max 1 MB.</div>
        {logoUrl ? (
          <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
            <img src={logoUrl} alt="current logo" style={{ maxHeight: 60, maxWidth: 240, background: '#fff', padding: 8, borderRadius: 4 }} />
            <button className="danger" onClick={onClearLogo} disabled={busy}>Remove logo</button>
          </div>
        ) : (
          <div className="muted" style={{ marginBottom: 12 }}>No logo uploaded — text mark is shown.</div>
        )}

        <form onSubmit={onUpload}>
          <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <div style={{ marginTop: 8 }}>
            <button type="submit" disabled={!file || busy}>{busy ? 'Uploading…' : 'Upload logo'}</button>
          </div>
        </form>
      </div>
    </>
  );
}

function ThemePicker() {
  const { choice, applied, setChoice } = useTheme();
  const options = [
    { value: 'light', label: 'Light' },
    { value: 'dark',  label: 'Dark' },
    { value: 'auto',  label: 'Auto (follow system)' },
  ];
  return (
    <div className="panel">
      <h2>Theme</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        Saved per-browser. <strong>Auto</strong> follows your OS&rsquo;s light/dark preference and updates live when you switch.
        The sun / moon icon in the topbar is a quick toggle for whoever&rsquo;s logged in.
      </div>
      <div className="theme-picker">
        {options.map(o => (
          <label key={o.value} className={`theme-option ${choice === o.value ? 'selected' : ''}`}>
            <input
              type="radio"
              name="theme-choice"
              value={o.value}
              checked={choice === o.value}
              onChange={() => setChoice(o.value)}
            />
            <span>{o.label}</span>
            {o.value === 'auto' && choice === 'auto' && (
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>currently {applied}</span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

function PhotoCaptureToggle() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings-photo'],
    queryFn: () => api.get('/api/settings/photo'),
  });
  const enabled = !!data?.enabled;

  const m = useMutation({
    mutationFn: (next) => fetch('/api/settings/photo', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-photo'] }),
  });

  return (
    <div className="panel">
      <h2>Photo capture</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        Visitors take a photo with the iPad&rsquo;s front camera at sign-in. The photo prints on their badge and is
        stored against the visit record for the configured retention window (see Photo retention below), then auto-purged. Off by default — privacy is opt-in.
        Camera access requires HTTPS in production (browsers block it on plain http for non-localhost origins);
        plan your TLS cert before enabling on a deployed iPad.
      </div>
      <label className="theme-option" style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 360 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={isLoading || m.isPending}
          onChange={(e) => m.mutate(e.target.checked)}
        />
        <span>{enabled ? 'Enabled' : 'Disabled'}</span>
      </label>
    </div>
  );
}

function PhotoRetention() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings-photo-retention'],
    queryFn: () => api.get('/api/settings/photo/retention'),
  });
  const [days, setDays] = useState('');
  const current = data?.retentionDays ?? 30;
  const editing = days !== '' && Number(days) !== current;

  const m = useMutation({
    mutationFn: (next) => fetch('/api/settings/photo/retention', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays: Number(next) }),
    }).then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-photo-retention'] }); setDays(''); },
  });

  return (
    <div className="panel">
      <h2>Photo retention</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        Days a captured visitor photo is kept before the daily sweep deletes it. Default 30. Range 1&ndash;365.
        Tighter settings reduce stored personal data; longer settings keep evidence for incident review.
      </div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
        <div>
          <label htmlFor="retention-days">Retention days</label>
          <input
            id="retention-days"
            type="number" min={1} max={365}
            placeholder={String(current)}
            value={days}
            onChange={e => setDays(e.target.value)}
            disabled={isLoading || m.isPending}
            style={{ width: 120 }}
          />
        </div>
        <button onClick={() => m.mutate(days)} disabled={!editing || m.isPending}>
          {m.isPending ? 'Saving…' : 'Save'}
        </button>
        <span className="muted">currently {current} days</span>
      </div>
      {m.error && <div className="error" style={{ marginTop: 8 }}>{m.error.error || 'failed'}</div>}
    </div>
  );
}

function WallViewPrivacy() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings-wall-view'],
    queryFn: () => api.get('/api/settings/wall-view'),
  });
  const isPublic = data?.public !== false;

  const m = useMutation({
    mutationFn: (next) => fetch('/api/settings/wall-view', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: next }),
    }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-wall-view'] }),
  });

  return (
    <div className="panel">
      <h2>Wall-view privacy</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        Whether the <code>/active</code> wall view (currently-on-site visitors) is reachable without signing in. Public is the
        default and supports the hallway-iPad / fire-roster use case. Switch to admins-only if your workshop hosts clients
        whose presence is sensitive — once off, the wall iPad must be signed in as admin or security to display the list.
      </div>
      <label className="theme-option" style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 460 }}>
        <input
          type="checkbox"
          checked={isPublic}
          disabled={isLoading || m.isPending}
          onChange={(e) => m.mutate(e.target.checked)}
        />
        <span>{isPublic ? 'Public — anyone on the LAN can view /active' : 'Admins/security only — sign-in required'}</span>
      </label>
    </div>
  );
}

function NotificationsLogPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['notifications-log'],
    queryFn: () => api.get('/api/notifications-log?limit=20'),
    refetchInterval: 60_000,
  });
  const entries = data?.entries ?? [];

  return (
    <div className="panel">
      <h2>Notifications log <button style={{ marginLeft: 8 }} onClick={() => refetch()} disabled={isLoading}>Refresh</button></h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        Last 20 email + SMS dispatch attempts. Use this to debug missing host notifications: a <strong>failed</strong> row
        with an error message means the transport rejected the send (bad credentials, blocked recipient, etc).
      </div>
      {entries.length === 0 ? (
        <div className="muted">No notification attempts logged yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th><th>Kind</th><th>Event</th><th>Recipient</th><th>Status</th><th>Error</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td title={e.createdAt}>{e.createdAt}</td>
                <td>{e.kind}</td>
                <td>{e.event}</td>
                <td>{e.recipient}</td>
                <td style={{ color: e.status === 'failed' ? 'var(--danger)' : e.status === 'sent' ? 'var(--success)' : undefined }}>
                  {e.status}
                </td>
                <td className="muted" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NotificationTester() {
  return (
    <>
      <TestPanel
        title="Email"
        helpText="Sends a real email through your configured SMTP transport. Use it to verify config/notifications.json and the SMTP_PASSWORD env var. Disabled until email.enabled=true in the config."
        endpoint="/api/settings/email/test"
        recipientLabel="Test recipient"
        recipientType="email"
        recipientPlaceholder="you@your-workshop.com"
      />
      <TestPanel
        title="SMS"
        helpText="Sends a real SMS through your configured Twilio adapter. Use it to verify the accountSid + SMS_AUTH_TOKEN. Disabled until sms.enabled=true in the config."
        endpoint="/api/settings/sms/test"
        recipientLabel="Test recipient (E.164)"
        recipientType="tel"
        recipientPlaceholder="+15555550100"
      />
    </>
  );
}

function TestPanel({ title, helpText, endpoint, recipientLabel, recipientType, recipientPlaceholder }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const onSend = async (e) => {
    e.preventDefault();
    setResult(null); setBusy(true);
    try {
      await api.post(endpoint, { to });
      setResult({ ok: true, message: `Sent. Check ${to}.` });
    } catch (e) {
      setResult({ ok: false, message: e.data?.error || e.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="muted" style={{ marginBottom: 8 }}>{helpText}</div>
      <form onSubmit={onSend} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label>{recipientLabel}</label>
          <input
            type={recipientType}
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder={recipientPlaceholder}
            required
          />
        </div>
        <button type="submit" disabled={busy || !to}>{busy ? 'Sending…' : `Send test ${title.toLowerCase()}`}</button>
      </form>
      {result && (
        <div style={{ marginTop: 8, color: result.ok ? 'var(--success)' : 'var(--danger)' }}>
          {result.message}
        </div>
      )}
    </div>
  );
}
