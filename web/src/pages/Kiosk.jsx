import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useBranding } from '../branding.jsx';
import { api } from '../api.js';
import SignaturePad from '../components/SignaturePad.jsx';

const STANDARD_KEYS = new Set(['name', 'company', 'email', 'phone', 'host', 'purpose']);

export default function Kiosk() {
  const { slug = 'default' } = useParams();
  const { appName, logoUrl } = useBranding();
  const [stage, setStage] = useState('form'); // 'form' | 'safety' | 'nda' | 'thanks'
  const [pending, setPending] = useState(null); // { body fields ready to POST }
  const [acks, setAcks] = useState([]); // accumulating ack records
  const [thankYouFor, setThankYouFor] = useState(null);
  const [submitErr, setSubmitErr] = useState(null);

  const kioskQ = useQuery({
    queryKey: ['kiosk', slug],
    queryFn: () => api.get(`/api/kiosks/${slug}`),
    retry: false,
  });
  const docsQ = useQuery({
    queryKey: ['documents-active'],
    queryFn: () => api.get('/api/documents/active'),
  });

  if (kioskQ.isLoading || docsQ.isLoading) {
    return <div className="kiosk-wrap"><div className="kiosk-card"><p className="muted">Loading…</p></div></div>;
  }
  if (kioskQ.error) {
    return (
      <div className="kiosk-wrap">
        <div className="kiosk-card">
          <h1>Unknown kiosk</h1>
          <p>The kiosk identifier <code>{slug}</code> isn&rsquo;t configured. Ask an admin to set it up under Admin → Kiosks.</p>
        </div>
      </div>
    );
  }
  const kiosk = kioskQ.data?.kiosk;
  const docs = docsQ.data?.documents ?? [];
  const safetyDoc = docs.find(d => d.kind === 'safety');
  const ndaDoc = docs.find(d => d.kind === 'nda');

  const stagesNeeded = ['form'];
  if (safetyDoc) stagesNeeded.push('safety');
  if (ndaDoc) stagesNeeded.push('nda');

  const onFormDone = (body) => {
    setPending(body);
    setAcks([]);
    if (safetyDoc) setStage('safety');
    else if (ndaDoc) setStage('nda');
    else submit(body, []);
  };

  const onSafetyDone = () => {
    const updated = [...acks, { kind: 'safety', signedName: pending.visitorName }];
    setAcks(updated);
    if (ndaDoc) setStage('nda');
    else submit(pending, updated);
  };

  const onNdaDone = (signaturePngBase64) => {
    const updated = [...acks, {
      kind: 'nda',
      signedName: pending.visitorName,
      signaturePngBase64,
    }];
    setAcks(updated);
    submit(pending, updated);
  };

  const submit = async (body, ackList) => {
    setSubmitErr(null);
    try {
      const r = await api.post('/api/visits', { ...body, acknowledgments: ackList });
      setThankYouFor(r.visit);
      setStage('thanks');
      const w = window.open(`/api/visits/${r.visit.id}/badge`, '_blank', 'noopener=yes,width=480,height=320');
      // Popup-blocked fallback handled by the Reprint badge link on the thanks card.
    } catch (e) {
      setSubmitErr(e.data?.error || e.message);
      setStage('form'); // bounce back so the visitor can fix the input
    }
  };

  const onReset = () => {
    setStage('form'); setPending(null); setAcks([]); setThankYouFor(null); setSubmitErr(null);
  };

  return (
    <div className="kiosk-wrap">
      <div className="kiosk-brand">
        {logoUrl
          ? <img src={logoUrl} alt={appName} />
          : <div className="kiosk-app-name">{appName}</div>}
        <div className="kiosk-loc muted">{kiosk?.name}</div>
        {stagesNeeded.length > 1 && stage !== 'thanks' && (
          <div className="kiosk-stepper muted">
            Step {stagesNeeded.indexOf(stage) + 1} of {stagesNeeded.length}
          </div>
        )}
      </div>
      {stage === 'form' && <SignInForm kioskSlug={slug} initialErr={submitErr} onDone={onFormDone} />}
      {stage === 'safety' && safetyDoc && (
        <DocumentAck doc={safetyDoc} confirmLabel="I have read this — continue" onDone={onSafetyDone} />
      )}
      {stage === 'nda' && ndaDoc && (
        <NdaSign doc={ndaDoc} visitorName={pending?.visitorName} onDone={onNdaDone} />
      )}
      {stage === 'thanks' && (
        <ThankYou visit={thankYouFor} kiosk={kiosk} onReset={onReset} />
      )}
    </div>
  );
}

function SignInForm({ kioskSlug, initialErr, onDone }) {
  const formQ = useQuery({ queryKey: ['visitor-form'], queryFn: () => api.get('/api/visitor-form') });
  const hostsQ = useQuery({ queryKey: ['hosts'], queryFn: () => api.get('/api/hosts') });
  const [values, setValues] = useState({});
  const [hostQuery, setHostQuery] = useState('');
  const [hostId, setHostId] = useState(null);
  const [err, setErr] = useState(initialErr);

  if (formQ.isLoading || hostsQ.isLoading) {
    return <div className="kiosk-card"><p className="muted">Loading…</p></div>;
  }
  if (formQ.error || hostsQ.error) {
    return <div className="kiosk-card"><p className="error">Could not load the kiosk. Please find a member of staff.</p></div>;
  }

  const fields = formQ.data?.fields ?? [];
  const hosts = hostsQ.data?.hosts ?? [];

  const set = (k, v) => setValues(p => ({ ...p, [k]: v }));

  const onSubmit = (e) => {
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

    onDone({
      visitorName: values.name?.trim() ?? '',
      company: values.company?.trim() || null,
      email: values.email?.trim() || null,
      phone: values.phone?.trim() || null,
      hostUserId: hostId,
      purpose: values.purpose?.trim() || null,
      fields: extra,
      kioskSlug,
    });
  };

  return (
    <form className="kiosk-card kiosk-form" onSubmit={onSubmit}>
      <h1>Welcome.</h1>
      <p>Sign in for your visit. We&rsquo;ll let your host know you&rsquo;re here.</p>

      {fields.map(f => {
        if (f.type === 'host-typeahead') {
          return (
            <HostPicker
              key={f.key} field={f} hosts={hosts}
              query={hostQuery} setQuery={setHostQuery}
              hostId={hostId} setHostId={setHostId}
            />
          );
        }
        return <FieldInput key={f.key} field={f} value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} />;
      })}

      {err && <div className="error" role="alert">{err}</div>}
      <div style={{ marginTop: 24 }}>
        <button type="submit" className="kiosk-cta">Continue</button>
      </div>
      <div style={{ marginTop: 16, fontSize: 14 }}>
        <Link to="/kiosk/signout" className="muted">Already signed in? Sign out →</Link>
      </div>
    </form>
  );
}

function FieldInput({ field, value, onChange }) {
  const id = `kf-${field.key}`;
  const common = { id, value, onChange: (e) => onChange(e.target.value), placeholder: field.placeholder ?? '', required: !!field.required };
  return (
    <div style={{ marginTop: 16 }}>
      <label htmlFor={id}>{field.label}{field.required && <span className="req"> *</span>}</label>
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
            type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={field.placeholder ?? 'Type a name…'} autoComplete="off"
          />
          {query && (
            <div className="host-suggestions">
              {filtered.length === 0 && <div className="muted" style={{ padding: 8 }}>No matches.</div>}
              {filtered.map(h => (
                <button key={h.id} type="button" className="host-suggestion"
                  onClick={() => { setHostId(h.id); setQuery(h.displayName); }}>
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

/**
 * Scrollable document body. The "I have read this" / signature pad is gated
 * until the visitor has scrolled to the bottom — the standard digital
 * "you've seen the whole thing" pattern.
 */
function ScrollableBody({ doc, onReachedBottom }) {
  const ref = useRef(null);
  const [reached, setReached] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      // 4px slop for sub-pixel rounding.
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
      if (atBottom && !reached) {
        setReached(true);
        onReachedBottom?.();
      }
      // Short documents that fit without scrolling — already at bottom.
      if (el.scrollHeight <= el.clientHeight && !reached) {
        setReached(true);
        onReachedBottom?.();
      }
    };
    check();
    el.addEventListener('scroll', check);
    return () => el.removeEventListener('scroll', check);
  }, [reached, onReachedBottom]);

  return (
    <>
      <h2 style={{ margin: 0 }}>{doc.title}</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Version {doc.version}</div>
      <div className="doc-body" ref={ref}>
        {doc.body.split(/\n{2,}/).map((p, i) => (
          <p key={i} style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{p}</p>
        ))}
      </div>
      {!reached && <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>↑ Scroll to the bottom to continue.</div>}
    </>
  );
}

function DocumentAck({ doc, confirmLabel, onDone }) {
  const [reached, setReached] = useState(false);
  return (
    <div className="kiosk-card kiosk-doc">
      <ScrollableBody doc={doc} onReachedBottom={() => setReached(true)} />
      <div style={{ marginTop: 16 }}>
        <button className="kiosk-cta" disabled={!reached} onClick={onDone}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function NdaSign({ doc, visitorName, onDone }) {
  const [reached, setReached] = useState(false);
  const [signaturePng, setSignaturePng] = useState(null);
  const canConfirm = reached && signaturePng;

  return (
    <div className="kiosk-card kiosk-doc">
      <ScrollableBody doc={doc} onReachedBottom={() => setReached(true)} />
      <div style={{ marginTop: 16 }}>
        <label>Sign with your finger {visitorName ? <>(<span className="muted">{visitorName}</span>)</> : null}</label>
        <SignaturePad onChange={setSignaturePng} disabled={!reached} />
      </div>
      <div style={{ marginTop: 16 }}>
        <button className="kiosk-cta" disabled={!canConfirm} onClick={() => onDone(signaturePng)}>
          I agree and sign
        </button>
      </div>
    </div>
  );
}

function ThankYou({ visit, kiosk, onReset }) {
  const timer = useRef(null);
  useEffect(() => {
    timer.current = setTimeout(onReset, 12000);
    return () => clearTimeout(timer.current);
  }, [onReset]);

  const hostName = visit?.host?.displayName || visit?.host?.username || 'your host';
  const printerName = kiosk?.defaultPrinterName;
  const badgeUrl = visit?.id ? `/api/visits/${visit.id}/badge` : null;
  const ndaAcked = (visit?.acknowledgments ?? []).some(a => a.kind === 'nda');

  return (
    <div className="kiosk-card">
      <h1>Thanks, {visit?.visitorName?.split(' ')[0] || 'visitor'}.</h1>
      <p>
        We&rsquo;ve told <strong>{hostName}</strong> you&rsquo;re here. Please take a seat &mdash; they&rsquo;ll be with you shortly.
      </p>
      {badgeUrl && (
        <p>
          Your badge is printing
          {printerName ? <> to <strong>{printerName}</strong></> : null}.
          {' '}
          <a href={badgeUrl} target="_blank" rel="noopener noreferrer">Reprint badge</a>.
        </p>
      )}
      {ndaAcked && visit?.email && (
        <p className="muted" style={{ fontSize: 14 }}>
          A copy of the signed NDA has been emailed to {visit.email}.
        </p>
      )}
      <button onClick={onReset} className="secondary">Done</button>
      <div className="kiosk-stub">Returning to the welcome screen automatically…</div>
    </div>
  );
}
