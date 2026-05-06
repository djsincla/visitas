import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useBranding } from './branding.jsx';
import { useTheme } from './theme.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Hosts from './pages/Hosts.jsx';
import Settings from './pages/Settings.jsx';
import Kiosk from './pages/Kiosk.jsx';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="login-wrap">Loading…</div>;

  if (!user) {
    // Kiosk is intentionally accessible without login — it's the iPad-facing
    // visitor sign-in surface. /login takes the operator to the admin UI.
    return (
      <Routes>
        <Route path="/kiosk" element={<Kiosk />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <>
      {!user.mustChangePassword && <TopBar />}
      <main>
        <Routes>
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/login" element={<Navigate to="/admin/hosts" replace />} />
          <Route path="/change-password" element={<ChangePassword forced={user.mustChangePassword} />} />
          <Route path="/" element={<Protected><Navigate to="/admin/hosts" replace /></Protected>} />
          <Route path="/admin/hosts" element={<Protected><Hosts /></Protected>} />
          <Route path="/admin/settings" element={<Protected><Settings /></Protected>} />
          <Route path="*" element={<Navigate to="/admin/hosts" replace />} />
        </Routes>
      </main>
    </>
  );
}

function Protected({ children }) {
  const { user } = useAuth();
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return children;
}

function TopBar() {
  const { user, logout } = useAuth();
  const { appName, logoUrl, version } = useBranding();
  const { theme, toggle: toggleTheme } = useTheme();
  const nav = useNavigate();

  return (
    <header className="topbar">
      <div className="brand">
        {logoUrl
          ? <img src={logoUrl} alt={appName} className="brand-logo" />
          : <span className="brand-text">{appName}</span>}
      </div>
      <nav>
        <NavLink to="/admin/hosts" className={({ isActive }) => isActive ? 'active' : ''}>Hosts</NavLink>
        <NavLink to="/admin/settings" className={({ isActive }) => isActive ? 'active' : ''}>Settings</NavLink>
        <NavLink to="/kiosk" className={({ isActive }) => isActive ? 'active' : ''}>Kiosk</NavLink>
      </nav>
      <div className="user">
        <button
          className="icon-button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          data-testid="theme-toggle"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <span>{user.displayName || user.username}</span>
        <span className="version-pill" data-testid="version-pill" title="visitas.world version">v{version}</span>
        <button className="secondary" onClick={async () => { await logout(); nav('/login'); }}>Sign out</button>
      </div>
    </header>
  );
}
