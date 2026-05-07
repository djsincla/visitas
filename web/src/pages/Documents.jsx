import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

export default function Documents() {
  return (
    <>
      <h1>Documents</h1>
      <p className="muted">
        NDA + safety briefing presented at the kiosk. Each save bumps the version. Visitors must
        scroll to the bottom and (for the NDA) sign with their finger before the kiosk lets them
        complete sign-in. To stop showing a document, click <strong>Disable</strong>.
      </p>
      <DocumentEditor kind="safety" defaultTitle="Workshop safety briefing" defaultBody="Please familiarise yourself with our muster point at the back fire exit. In the event of an alarm, leave the building via the nearest marked exit and gather at the muster point until cleared by reception." />
      <DocumentEditor kind="nda" defaultTitle="Visitor non-disclosure agreement" defaultBody={`By signing below I acknowledge that any information I see, hear, or learn during my visit is confidential and the property of the workshop. I will not disclose, reproduce, or use any such information for any purpose outside of my visit, and will treat all observations as proprietary.`} />
    </>
  );
}

function DocumentEditor({ kind, defaultTitle, defaultBody }) {
  const qc = useQueryClient();
  const allQ = useQuery({
    queryKey: ['documents', kind],
    queryFn: () => api.get(`/api/documents?kind=${kind}`),
  });

  const docs = allQ.data?.documents ?? [];
  const active = docs.find(d => d.active) ?? null;
  const [title, setTitle] = useState(active?.title ?? defaultTitle);
  const [body, setBody] = useState(active?.body ?? defaultBody);
  const [saved, setSaved] = useState(null);
  const [err, setErr] = useState(null);

  // When the active doc changes (e.g. after save), sync the local state.
  if (active && saved !== null && saved.id === active.id && (title !== saved.title || body !== saved.body)) {
    // user edited after save — leave it
  }

  const save = useMutation({
    mutationFn: () => api.post('/api/documents', { kind, title, body }),
    onSuccess: (r) => { setSaved(r.document); setErr(null); qc.invalidateQueries({ queryKey: ['documents', kind] }); qc.invalidateQueries({ queryKey: ['documents-active'] }); },
    onError: (e) => setErr(e.data?.error || e.message),
  });
  const disable = useMutation({
    mutationFn: () => api.delete(`/api/documents/${kind}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents', kind] }); qc.invalidateQueries({ queryKey: ['documents-active'] }); },
  });

  if (allQ.isLoading) return <div className="panel"><p className="muted">Loading {kind}…</p></div>;

  return (
    <div className="panel">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{kind === 'nda' ? 'NDA' : 'Safety briefing'}</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          {active ? `Active: v${active.version}` : 'Not yet enabled'}
          {docs.length > 0 && ` · ${docs.length} version${docs.length === 1 ? '' : 's'} on record`}
        </div>
      </div>

      <label style={{ marginTop: 16 }}>Title</label>
      <input value={title} onChange={e => setTitle(e.target.value)} maxLength={256} />

      <label>Body</label>
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={10} placeholder="Write the full text here. Visitors will see this and must scroll to the bottom before they can acknowledge." />

      {err && <div className="error">{err}</div>}

      <div className="row" style={{ marginTop: 16 }}>
        <button onClick={() => save.mutate()} disabled={save.isPending || !title || !body}>
          {save.isPending ? 'Saving…' : (active ? 'Save (bump version)' : 'Save & enable')}
        </button>
        {active && (
          <button className="danger" onClick={() => disable.mutate()} disabled={disable.isPending}>
            {disable.isPending ? 'Disabling…' : 'Disable'}
          </button>
        )}
      </div>

      {docs.length > 1 && (
        <details style={{ marginTop: 16 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>Version history ({docs.length})</summary>
          <ul style={{ marginTop: 8 }}>
            {docs.map(d => (
              <li key={d.id} style={{ marginBottom: 4 }}>
                v{d.version}
                {d.active && <span className="badge muted" style={{ marginLeft: 8 }}>active</span>}
                <span className="muted" style={{ marginLeft: 8 }}>{d.createdAt}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
