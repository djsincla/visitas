import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useBranding } from '../branding.jsx';
import { api } from '../api.js';
import SignaturePad from '../components/SignaturePad.jsx';
import PhotoCapture from '../components/PhotoCapture.jsx';

const STANDARD_KEYS = new Set(['name', 'company', 'email', 'phone', 'host', 'purpose']);

export default function Kiosk() {
  const { slug = 'default' } = useParams();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const { appName, logoUrl } = useBranding();
  const [stage, setStage] = useState('form');
  const [pending, setPending] = useState(null);
  const [acks, setAcks] = useState([]);
  const [photoPng, setPhotoPng] = useState(null);
  const [thankYouFor, setThankYouFor] = useState(null);
  const [submitErr, setSubmitErr] = useState(null);
  const [ndaCacheFresh, setNdaCacheFresh] = useState(false);

  const kioskQ = useQuery({
    queryKey: ['kiosk', slug],
    queryFn: () => api.get(`/api/kiosks/${slug}`),
    retry: false,
  });
  const docsQ = useQuery({
    queryKey: ['documents-active'],
    queryFn: () => api.get('/api/documents/active'),
  });
  const photoSettingQ = useQuery({
    queryKey: ['settings-photo'],
    queryFn: () => api.get('/api/settings/photo'),
  });
  const inviteQ = useQuery({
    queryKey: ['invitation', inviteToken],
    queryFn: () => api.get(`/api/invitations/${inviteToken}`),
    enabled: !!inviteToken,
    retry: false,
  });

  if (kioskQ.isLoading || docsQ.isLoading || inviteQ.isLoading || photoSettingQ.isLoading) {
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
  // Invitation-with-error: friendly fallback (expired / used / cancelled / unknown).
  if (inviteToken && inviteQ.error) {
    return (
      <div className="kiosk-wrap">
        <div className="kiosk-card">
          <h1>This invitation can&rsquo;t be used.</h1>
          <p className="muted">It may have expired, already been claimed, or been cancelled. Please sign in normally below.</p>
          <p><a href={`/kiosk/${slug}`}>Continue to sign-in →</a></p>
        </div>
      </div>
    );
  }
  const kiosk = kioskQ.data?.kiosk;
  const docs = docsQ.data?.documents ?? [];
  const safetyDoc = docs.find(d => d.kind === 'safety');
  const ndaDoc = docs.find(d => d.kind === 'nda');
  const invitation = inviteQ.data?.invitation ?? null;
  const photoEnabled = !!photoSettingQ.data?.enabled;

  // Stage order: form → photo? → safety? → nda? → submit.
  const stagesNeeded = ['form'];
  if (photoEnabled) stagesNeeded.push('photo');
  if (safetyDoc) stagesNeeded.push('safety');
  if (ndaDoc && !ndaCacheFresh) stagesNeeded.push('nda');

  const advanceFrom = (current, lookupInfo) => {
    const idx = stagesNeeded.indexOf(current);
    let next = stagesNeeded[idx + 1];
    // The NDA stage is dynamically removed on cache hit — recompute.
    if (next === 'nda' && lookupInfo?.ndaCacheFresh) next = stagesNeeded[idx + 2];
    return next;
  };

  const onFormDone = (body, lookupInfo) => {
    setPending(body);
    setAcks([]);
    setPhotoPng(null);
    setNdaCacheFresh(!!lookupInfo?.ndaCacheFresh);
    const next = advanceFrom('form', lookupInfo);
    if (next) setStage(next);
    else submit(body, [], null);
  };

  const onPhotoDone = (png) => {
    setPhotoPng(png);
    const next = advanceFrom('photo');
    if (next) setStage(next);
    else submit(pending, acks, png);
  };

  const onSafetyDone = () => {
    const updated = [...acks, { kind: 'safety', signedName: pending.visitorName }];
    setAcks(updated);
    const next = advanceFrom('safety');
    if (next) setStage(next);
    else submit(pending, updated, photoPng);
  };

  const onNdaDone = (signaturePngBase64) => {
    const updated = [...acks, {
      kind: 'nda',
      signedName: pending.visitorName,
      signaturePngBase64,
    }];
    setAcks(updated);
    submit(pending, updated, photoPng);
  };

  const submit = async (body, ackList, photo) => {
    setSubmitErr(null);
    try {
      const r = await api.post('/api/visits', {
        ...body,
        acknowledgments: ackList,
        inviteToken: inviteToken ?? undefined,
        photoPngBase64: photo ?? undefined,
      });
      setThankYouFor({ ...r.visit, _ndaCacheFresh: ndaCacheFresh });
      setStage('thanks');
      window.open(`/api/visits/${r.visit.id}/badge`, '_blank', 'noopener=yes,width=480,height=320');
    } catch (e) {
      setSubmitErr(e.data?.error || e.message);
      setStage('form');
    }
  };

  const onReset = () => {
    setStage('form'); setPending(null); setAcks([]); setPhotoPng(null);
    setThankYouFor(null); setSubmitErr(null); setNdaCacheFresh(false);
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
      {stage === 'form' && <SignInForm kioskSlug={slug} initialErr={submitErr} invitation={invitation} onDone={onFormDone} />}
      {stage === 'photo' && (
        <PhotoStage onDone={onPhotoDone} />
      )}
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

function SignInForm({ kioskSlug, initialErr, invitation, onDone }) {
  const formQ = useQuery({ queryKey: ['visitor-form'], queryFn: () => api.get('/api/visitor-form') });
  const hostsQ = useQuery({ queryKey: ['hosts'], queryFn: () => api.get('/api/hosts'), enabled: !invitation });
  const [values, setValues] = useState(() => invitation
    ? { name: invitation.visitorName, company: invitation.company || '', email: invitation.email || '', phone: invitation.phone || '', purpose: invitation.purpose || '' }
    : {}
  );
  const [hostQuery, setHostQuery] = useState('');
  const [hostId, setHostId] = useState(invitation?.host?.id ?? null);
  const [err, setErr] = useState(initialErr);
  const [lookup, setLookup] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);

  if (formQ.isLoading || hostsQ.isLoading) {
    return <div className="kiosk-card"><p className="muted">Loading…</p></div>;
  }
  if (formQ.error || hostsQ.error) {
    return <div className="kiosk-card"><p className="error">Could not load the kiosk. Please find a member of staff.</p></div>;
  }

  const fields = formQ.data?.fields ?? [];
  const hosts = hostsQ.data?.hosts ?? [];

  const set = (k, v) => setValues(p => ({ ...p, [k]: v }));

  const onEmailBlur = async () => {
    const email = values.email?.trim();
    if (!email || !email.includes('@')) return;
    setLookingUp(true);
    try {
      const r = await api.post('/api/visitors/lookup', { email });
      setLookup(r.visitor);
      // Pre-fill any fields the visitor hasn't already typed something into.
      setValues(p => ({
        name:    p.name    || r.visitor.name    || '',
        company: p.company || r.visitor.company || '',
        phone:   p.phone   || r.visitor.phone   || '',
        ...p,
      }));
    } catch {
      // 404 = first-timer; ignore quietly.
      setLookup(null);
    } finally {
      setLookingUp(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    setErr(null);

    for (const f of fields) {
      if (!f.required) continue;
      if (f.type === 'host-typeahead') {
        if (!hostId && !invitation) { setErr(`Please select your host.`); return; }
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
    }, lookup);
  };

  return (
    <form className="kiosk-card kiosk-form" onSubmit={onSubmit}>
      <h1>Welcome{invitation ? ', ' + (invitation.visitorName?.split(' ')[0] || 'visitor') : ''}.</h1>
      {invitation && (
        <div className="kiosk-welcomeback">
          <strong>You were expected.</strong> {invitation.host?.displayName} is your host today
          {invitation.expectedAt ? <>, expected at {invitation.expectedAt}</> : null}. Confirm your details below.
        </div>
      )}
      {!invitation && <p>Sign in for your visit. We&rsquo;ll let your host know you&rsquo;re here.</p>}

      {lookup && (
        <div className="kiosk-welcomeback">
          <strong>Welcome back, {lookup.name?.split(' ')[0] || 'visitor'}.</strong> Your details are pre-filled below — edit if anything has changed.
          {lookup.ndaCacheFresh && <div style={{ marginTop: 4, fontSize: 13 }}>Your NDA from a previous visit is still on file (v{lookup.ndaCacheVersion}); we won&rsquo;t ask you to re-sign today.</div>}
        </div>
      )}
      {lookingUp && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>Checking for a previous visit…</div>}

      {fields.map(f => {
        if (f.type === 'host-typeahead') {
          if (invitation) {
            // Locked: visitor was pre-booked with this host.
            return (
              <div key={f.key} style={{ marginTop: 16 }}>
                <label>{f.label}</label>
                <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10 }}>
                  <span>{invitation.host?.displayName}</span>
                  <span className="badge muted">pre-booked</span>
                </div>
              </div>
            );
          }
          return (
            <HostPicker
              key={f.key} field={f} hosts={hosts}
              query={hostQuery} setQuery={setHostQuery}
              hostId={hostId} setHostId={setHostId}
            />
          );
        }
        return (
          <FieldInput
            key={f.key}
            field={f}
            value={values[f.key] ?? ''}
            onChange={(v) => set(f.key, v)}
            onBlur={f.key === 'email' && !invitation ? onEmailBlur : undefined}
          />
        );
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

function FieldInput({ field, value, onChange, onBlur }) {
  const id = `kf-${field.key}`;
  const common = {
    id, value,
    onChange: (e) => onChange(e.target.value),
    onBlur: onBlur,
    placeholder: field.placeholder ?? '',
    required: !!field.required,
  };
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

function ScrollableBody({ doc, onReachedBottom }) {
  const ref = useRef(null);
  const [reached, setReached] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
      if (atBottom && !reached) {
        setReached(true);
        onReachedBottom?.();
      }
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

function PhotoStage({ onDone }) {
  return (
    <div className="kiosk-card kiosk-photo">
      <h2 style={{ margin: 0 }}>Quick photo</h2>
      <p className="muted" style={{ margin: '4px 0 12px', fontSize: 14 }}>
        We&rsquo;ll take a photo for your visitor badge. Stand in front of the iPad and tap the button.
      </p>
      <PhotoCapture onChange={(png) => { if (png) onDone(png); }} />
    </div>
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
  const ndaCached = visit?._ndaCacheFresh;

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
      {ndaCached && (
        <p className="muted" style={{ fontSize: 14 }}>
          Your NDA is on file from a previous visit, so we didn&rsquo;t ask you to re-sign today.
        </p>
      )}
      <button onClick={onReset} className="secondary">Done</button>
      <div className="kiosk-stub">Returning to the welcome screen automatically…</div>
    </div>
  );
}
