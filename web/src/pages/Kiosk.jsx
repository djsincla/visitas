import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useBranding } from '../branding.jsx';
import { api } from '../api.js';

const STANDARD_KEYS = new Set(['name', 'company', 'email', 'phone', 'host', 'purpose']);

export default function Kiosk() {
  const { appName, logoUrl } = useBranding();
  const [stage, setStage] = useState('form'); // 'form' | 'thanks'
  const [thankYouFor, setThankYouFor] = useState(null);

  const onSignedIn = (visit) => {
    setThankYouFor(visit);
    setStage('thanks');
  };

  return (
    <div className="kiosk-wrap">
      <div className="kiosk-brand">
        {logoUrl
          ? <img src={logoUrl} alt={appName} />
          : <div className="kiosk-app-name">{appName}</div>}
      </div>
      {stage === 'form' && <SignInForm onDone={onSignedIn} />}
      {stage === 'thanks' && (
        <ThankYou
          visit={thankYouFor}
          onReset={() => { setStage('form'); setThankYouFor(null); }}
        />
      )}
    </div>
  );
}

function SignInForm({ onDone }) {
  const formQ = useQuery({ queryKey: ['visitor-form'], queryFn: () => api.get('/api/visitor-form') });
  const hostsQ = useQuery({ queryKey: ['hosts'], queryFn: () => api.get('/api/hosts') });
  const [values, setValues] = useState({});
  const [hostQuery, setHostQuery] = useState('');
  const [hostId, setHostId] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  if (formQ.isLoading || hostsQ.isLoading) {
    return <div className="kiosk-card"><p className="muted">Loading…</p></div>;
  }
  if (formQ.error || hostsQ.error) {
    return <div className="kiosk-card"><p className="error">Could not load the kiosk. Please find a member of staff.</p></div>;
  }

  const fields = formQ.data?.fields ?? [];
  const hosts = hostsQ.data?.hosts ?? [];

  const set = (k, v) => setValues(p => ({ ...p, [k]: v }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(null);

    for (const f of fields) {
      if (!f.required) continue;
      if (f.type === 'host-typeahead') {
        if (!hostId) { setErr(`Please select your host.`); return; }
      } else if (!values[f.key] || String(values[f.key]).trim() === '') {
        setErr(`Please fill in: ${f.label}`); return;
      }
    }

    const extra = {};
    for (const [k, v] of Object.entries(values)) {
      if (!STANDARD_KEYS.has(k)) extra[k] = v;
    }

    const body = {
      visitorName: values.name?.trim() ?? '',
      company: values.company?.trim() || null,
      email: values.email?.trim() || null,
      phone: values.phone?.trim() || null,
      hostUserId: hostId,
      purpose: values.purpose?.trim() || null,
      fields: extra,
    };

    setBusy(true);
    try {
      const r = await api.post('/api/visits', body);
      onDone(r.visit);
    } catch (e) {
      setErr(e.data?.error || e.message);
    } finally { setBusy(false); }
  };

  return (
    <form className="kiosk-card kiosk-form" onSubmit={onSubmit}>
      <h1>Welcome.</h1>
      <p>Sign in for your visit. We&rsquo;ll let your host know you&rsquo;re here.</p>

      {fields.map(f => {
        if (f.type === 'host-typeahead') {
          return (
            <HostPicker
              key={f.key}
              field={f}
              hosts={hosts}
              query={hostQuery}
              setQuery={setHostQuery}
              hostId={hostId}
              setHostId={setHostId}
            />
          );
        }
        return <FieldInput key={f.key} field={f} value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} />;
      })}

      {err && <div className="error" role="alert">{err}</div>}
      <div style={{ marginTop: 24 }}>
        <button type="submit" className="kiosk-cta" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
      <div style={{ marginTop: 16, fontSize: 14 }}>
        <Link to="/kiosk/signout" className="muted">Already signed in? Sign out →</Link>
      </div>
    </form>
  );
}

function FieldInput({ field, value, onChange }) {
  const id = `kf-${field.key}`;
  const common = {
    id,
    value,
    onChange: (e) => onChange(e.target.value),
    placeholder: field.placeholder ?? '',
    required: !!field.required,
  };
  return (
    <div style={{ marginTop: 16 }}>
      <label htmlFor={id}>
        {field.label}{field.required && <span className="req"> *</span>}
      </label>
      {field.type === 'textarea'
        ? <textarea {...common} rows={3} />
        : field.type === 'select'
          ? (
            <select {...common}>
              <option value="">{field.placeholder ?? 'Choose one…'}</option>
              {(field.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          )
          : <input type={field.type} {...common} />}
    </div>
  );
}

function HostPicker({ field, hosts, query, setQuery, hostId, setHostId }) {
  const filtered = useMemo(() => {
    if (!query.trim()) return hosts.slice(0, 20);
    const q = query.toLowerCase();
    return hosts.filter(h => h.displayName.toLowerCase().includes(q)).slice(0, 20);
  }, [hosts, query]);

  const selectedName = hosts.find(h => h.id === hostId)?.displayName;
  return (
    <div style={{ marginTop: 16 }}>
      <label>{field.label}{field.required && <span className="req"> *</span>}</label>
      {selectedName ? (
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10 }}>
          <span>{selectedName}</span>
          <button type="button" className="secondary" onClick={() => { setHostId(null); setQuery(''); }}>Change</button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={field.placeholder ?? 'Type a name…'}
            autoComplete="off"
          />
          {query && (
            <div className="host-suggestions">
              {filtered.length === 0 && <div className="muted" style={{ padding: 8 }}>No matches.</div>}
              {filtered.map(h => (
                <button
                  key={h.id}
                  type="button"
                  className="host-suggestion"
                  onClick={() => { setHostId(h.id); setQuery(h.displayName); }}
                >
                  {h.displayName}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ThankYou({ visit, onReset }) {
  const timer = useRef(null);
  useEffect(() => {
    timer.current = setTimeout(onReset, 8000);
    return () => clearTimeout(timer.current);
  }, [onReset]);

  const hostName = visit?.host?.displayName || visit?.host?.username || 'your host';

  return (
    <div className="kiosk-card">
      <h1>Thanks, {visit?.visitorName?.split(' ')[0] || 'visitor'}.</h1>
      <p>
        We&rsquo;ve told <strong>{hostName}</strong> you&rsquo;re here. Please take a seat &mdash; they&rsquo;ll be with you shortly.
      </p>
      <button onClick={onReset} className="secondary">Done</button>
      <div className="kiosk-stub">Returning to the welcome screen automatically…</div>
    </div>
  );
}
