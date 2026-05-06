import { useBranding } from '../branding.jsx';

/**
 * Kiosk — the iPad-facing visitor sign-in surface.
 *
 * v0.1 ships a placeholder. The actual sign-in flow (form fields driven by
 * config/visitor-form.json, host typeahead, host notification, sign-out, badge
 * print, NDA / safety / photo / pre-reg) lands in v0.2 onwards.
 */
export default function Kiosk() {
  const { appName, logoUrl } = useBranding();

  return (
    <div className="kiosk-wrap">
      <div className="kiosk-brand">
        {logoUrl
          ? <img src={logoUrl} alt={appName} />
          : <div className="kiosk-app-name">{appName}</div>}
      </div>
      <div className="kiosk-card">
        <h1>Welcome.</h1>
        <p>
          Tap below to sign in for your visit. We&rsquo;ll let your host know you&rsquo;re here.
        </p>
        <button className="kiosk-cta" disabled>
          Sign in
        </button>
        <div className="kiosk-stub">
          v0.1 placeholder — visitor sign-in flow lands in v0.2.
        </div>
      </div>
    </div>
  );
}
