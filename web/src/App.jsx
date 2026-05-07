import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useBranding } from './branding.jsx';
import { useTheme } from './theme.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import Kiosk from './pages/Kiosk.jsx';
import KioskSignOut from './pages/KioskSignOut.jsx';
import ActiveVisitors from './pages/ActiveVisitors.jsx';
import WallView from './pages/WallView.jsx';
import Kiosks from './pages/Kiosks.jsx';
import Documents from './pages/Documents.jsx';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="login-wrap">Loading…</div>;

  if (!user) {
    return (
      <Routes>
        <Route path="/kiosk/:slug" element={<Kiosk />} />
        <Route path="/kiosk" element={<Navigate to="/kiosk/default" replace />} />
        <Route path="/kiosk/signout" element={<KioskSignOut />} />
        <Route path="/active" element={<WallView />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const isSecurity = user.role === 'security';
  const home = isSecurity ? '/admin/active-visitors' : '/admin/users';

  return (
    <>
      {!user.mustChangePassword && <TopBar />}
      <main>
        <Routes>
          <Route path="/kiosk/:slug" element={<Kiosk />} />
          <Route path="/kiosk" element={<Navigate to="/kiosk/default" replace />} />
          <Route path="/kiosk/signout" element={<KioskSignOut />} />
          <Route path="/active" element={<WallView />} />
          <Route path="/login" element={<Navigate to={home} replace />} />
          <Route path="/change-password" element={<ChangePassword forced={user.mustChangePassword} />} />
          <Route path="/" element={<Protected><Navigate to={home} replace /></Protected>} />

          <Route path="/admin/active-visitors" element={<Protected role="any-staff"><ActiveVisitors /></Protected>} />

          <Route path="/admin/users" element={<Protected role="admin"><Users /></Protected>} />
          <Route path="/admin/kiosks" element={<Protected role="admin"><Kiosks /></Protected>} />
          <Route path="/admin/documents" element={<Protected role="admin"><Documents /></Protected>} />
          <Route path="/admin/settings" element={<Protected role="admin"><Settings /></Protected>} />

          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </>
  );
}

function Protected({ children, role = 'any-staff' }) {
  const { user } = useAuth();
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (role === 'admin' && user.role !== 'admin') return <Navigate to="/admin/active-visitors" replace />;
  return children;
}

function TopBar() {
  const { user, logout } = useAuth();
  const { appName, logoUrl, version } = useBranding();
  const { theme, toggle: toggleTheme } = useTheme();
  const nav = useNavigate();

  const isAdmin = user.role === 'admin';

  return (
    <header className="topbar">
      <div className="brand">
        {logoUrl
          ? <img src={logoUrl} alt={appName} className="brand-logo" />
          : <span className="brand-text">{appName}</span>}
      </div>
      <nav>
        <NavLink to="/admin/active-visitors" className={({ isActive }) => isActive ? 'active' : ''}>
          Active visitors
        </NavLink>
        {isAdmin && (
          <>
            <NavLink to="/admin/users" className={({ isActive }) => isActive ? 'active' : ''}>Users</NavLink>
            <NavLink to="/admin/kiosks" className={({ isActive }) => isActive ? 'active' : ''}>Kiosks</NavLink>
            <NavLink to="/admin/documents" className={({ isActive }) => isActive ? 'active' : ''}>Documents</NavLink>
            <NavLink to="/admin/settings" className={({ isActive }) => isActive ? 'active' : ''}>Settings</NavLink>
          </>
        )}
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
        <span>{user.displayName || user.username}{user.role !== 'admin' && ` · ${user.role}`}</span>
        <span className="version-pill" data-testid="version-pill" title="visitas.world version">v{version}</span>
        <button className="secondary" onClick={async () => { await logout(); nav('/login'); }}>Sign out</button>
      </div>
    </header>
  );
}
