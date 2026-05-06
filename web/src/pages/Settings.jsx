import { useState } from 'react';
import { useBranding } from '../branding.jsx';
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

      <NotificationTester />

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
