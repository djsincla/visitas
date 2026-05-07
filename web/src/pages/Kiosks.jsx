import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

export default function Kiosks() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['kiosks'],
    queryFn: () => api.get('/api/kiosks'),
  });
  const [showNew, setShowNew] = useState(false);

  if (isLoading) return <div>Loading…</div>;
  const kiosks = data?.kiosks ?? [];

  return (
    <>
      <div className="row between">
        <h1>Kiosks</h1>
        <button onClick={() => setShowNew(s => !s)}>{showNew ? 'Cancel' : '+ Add kiosk'}</button>
      </div>

      <p className="muted">
        Each iPad parks on its own kiosk URL: <code>/kiosk/&lt;slug&gt;</code>. Set a <strong>default printer name</strong> per kiosk so visitors see which printer their badge is going to. The actual printer assignment is enforced by your MDM at the iOS level — this field is the human-readable label, plus a printable hint on the badge.
      </p>

      {showNew && <NewKiosk onCreated={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['kiosks'] }); }} />}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>Name</th>
              <th>Default printer (MDM hint)</th>
              <th>URL</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {kiosks.map(k => (
              <KioskRow key={k.id} kiosk={k} onChanged={() => qc.invalidateQueries({ queryKey: ['kiosks'] })} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function KioskRow({ kiosk, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(kiosk.name);
  const [printer, setPrinter] = useState(kiosk.defaultPrinterName ?? '');
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: (body) => api.patch(`/api/kiosks/${kiosk.slug}`, body),
    onSuccess: () => { setEditing(false); setErr(null); onChanged(); },
    onError: (e) => setErr(e.data?.error || e.message),
  });
  const dm = useMutation({
    mutationFn: () => api.delete(`/api/kiosks/${kiosk.slug}`),
    onSuccess: onChanged,
    onError: (e) => setErr(e.data?.error || e.message),
  });

  return (
    <tr>
      <td><code>{kiosk.slug}</code></td>
      <td>
        {editing
          ? <input value={name} onChange={e => setName(e.target.value)} />
          : kiosk.name}
      </td>
      <td>
        {editing
          ? <input value={printer} onChange={e => setPrinter(e.target.value)} placeholder="e.g. Brother QL-820NWB (Reception)" />
          : (kiosk.defaultPrinterName || <span className="muted">—</span>)}
      </td>
      <td><code>/kiosk/{kiosk.slug}</code></td>
      <td>{kiosk.active ? <span className="badge muted">active</span> : <span className="badge disabled">inactive</span>}</td>
      <td style={{ textAlign: 'right' }}>
        {editing ? (
          <span className="row">
            <button onClick={() => m.mutate({ name, defaultPrinterName: printer || null })} disabled={m.isPending}>Save</button>
            <button className="secondary" onClick={() => { setEditing(false); setName(kiosk.name); setPrinter(kiosk.defaultPrinterName ?? ''); }}>Cancel</button>
          </span>
        ) : (
          <span className="row">
            <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
            {kiosk.slug !== 'default' && kiosk.active && (
              <button className="danger" onClick={() => dm.mutate()} disabled={dm.isPending}>Deactivate</button>
            )}
          </span>
        )}
        {err && <div className="error" style={{ fontSize: 12 }}>{err}</div>}
      </td>
    </tr>
  );
}

function NewKiosk({ onCreated }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [printer, setPrinter] = useState('');
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: (body) => api.post('/api/kiosks', body),
    onSuccess: onCreated,
    onError: (e) => setErr(e.data?.error || e.message),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    setErr(null);
    m.mutate({ slug, name, defaultPrinterName: printer || null });
  };

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>New kiosk</h2>
      <label htmlFor="new-kiosk-slug">Slug <span className="req">*</span></label>
      <input id="new-kiosk-slug" value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} required pattern="[a-z0-9-]+" placeholder="reception" />
      <label htmlFor="new-kiosk-name">Display name <span className="req">*</span></label>
      <input id="new-kiosk-name" value={name} onChange={e => setName(e.target.value)} required placeholder="Reception desk" />
      <label htmlFor="new-kiosk-printer">Default printer name (optional, used as a hint on the badge)</label>
      <input id="new-kiosk-printer" value={printer} onChange={e => setPrinter(e.target.value)} placeholder="Brother QL-820NWB (Reception)" />
      {err && <div className="error">{err}</div>}
      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={m.isPending}>{m.isPending ? 'Creating…' : 'Create kiosk'}</button>
      </div>
    </form>
  );
}
