import { getBranding } from './settings.js';

/**
 * Render a printable badge as standalone HTML. The page is dimensioned for
 * a typical 4×3 inch label; the kiosk hits this URL in a hidden iframe and
 * triggers window.print(). MDM is expected to pin the iPad's default
 * AirPrint printer to whatever the kiosk's defaultPrinterName documents.
 */
export function renderBadge(visit) {
  const branding = getBranding();
  const today = new Date();
  const dateStr = today.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const visitorName = escapeHtml(visit.visitorName || 'Visitor');
  const company = visit.company ? escapeHtml(visit.company) : '';
  const hostName = visit.host ? escapeHtml(visit.host.displayName || visit.host.username) : '—';
  const kioskName = visit.kiosk?.name ? escapeHtml(visit.kiosk.name) : '';
  const printerHint = visit.kiosk?.defaultPrinterName
    ? escapeHtml(visit.kiosk.defaultPrinterName)
    : null;
  const appName = escapeHtml(branding.appName || 'visitas.world');
  const logoUrl = branding.logoUrl ? escapeHtml(branding.logoUrl) : null;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Visitor badge — ${visitorName}</title>
  <style>
    @page { size: 4in 3in; margin: 6mm; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
      color: #111;
      background: #fff;
    }
    .badge {
      width: 4in;
      height: 3in;
      box-sizing: border-box;
      padding: 8mm 8mm 6mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8mm;
      border-bottom: 1px solid #ddd;
      padding-bottom: 4mm;
    }
    .header img { max-height: 14mm; max-width: 32mm; object-fit: contain; }
    .header .app { font-size: 11pt; font-weight: 600; letter-spacing: 0.3px; }
    .visitor { font-size: 22pt; font-weight: 700; line-height: 1.1; margin: 4mm 0 0; }
    .company { font-size: 11pt; color: #555; margin-top: 1mm; }
    .meta { font-size: 9pt; color: #444; }
    .meta .label { display: inline-block; min-width: 16mm; color: #888; }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 8pt;
      color: #888;
      border-top: 1px solid #ddd;
      padding-top: 2mm;
      margin-top: 4mm;
    }
    .printer-hint {
      font-size: 7pt;
      color: #999;
      font-style: italic;
      text-align: center;
      padding: 0 6mm;
    }
    @media print {
      .controls { display: none; }
    }
    .controls {
      position: fixed;
      bottom: 12px;
      right: 12px;
      display: flex;
      gap: 8px;
    }
    .controls button {
      font: inherit;
      padding: 8px 14px;
      background: #5b9dff;
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="badge">
    <div class="header">
      ${logoUrl ? `<img src="${logoUrl}" alt="${appName}" />` : `<div class="app">${appName}</div>`}
    </div>
    <div>
      <div class="visitor">${visitorName}</div>
      ${company ? `<div class="company">${company}</div>` : ''}
    </div>
    <div class="meta">
      <div><span class="label">Visiting:</span> ${hostName}</div>
      <div><span class="label">Date:</span> ${dateStr} &middot; expires end of day</div>
      ${kioskName ? `<div><span class="label">Kiosk:</span> ${kioskName}</div>` : ''}
    </div>
    <div class="footer">
      <span>${appName}</span>
      <span>#${visit.id}</span>
    </div>
    ${printerHint ? `<div class="printer-hint">Print to: ${printerHint}</div>` : ''}
  </div>

  <div class="controls">
    <button onclick="window.print()">Print badge</button>
    <button onclick="window.close()" style="background:#888">Close</button>
  </div>

  <script>
    // Auto-fire the print dialog after a short delay so AirPrint picks up the
    // page once styles + image have loaded. The kiosk closes the window after.
    window.addEventListener('load', () => setTimeout(() => window.print(), 300));
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
