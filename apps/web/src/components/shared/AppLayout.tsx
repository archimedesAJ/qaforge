import { ReactNode } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

function SidebarItem({ to, label, icon }: NavItem) {
  return (
    <NavLink
      to={to}
      end
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        fontSize: '0.9rem',
        fontWeight: 500,
        color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
        background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
        borderRadius: 6,
        margin: '1px 8px',
        textDecoration: 'none',
        transition: 'all 0.15s',
      })}
    >
      <span style={{ fontSize: '1rem', width: 20, textAlign: 'center' }}>{icon}</span>
      {label}
    </NavLink>
  );
}

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
}

export function AppLayout({ children, title, actions }: AppLayoutProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const projectNav: NavItem[] = projectId ? [
    { to: `/projects/${projectId}`,          label: 'Dashboard',   icon: '▦' },
    { to: `/projects/${projectId}/cases`,    label: 'Test cases',  icon: '✓' },
    { to: `/projects/${projectId}/runs`,     label: 'Runs',        icon: '▶' },
    { to: `/projects/${projectId}/plans`,    label: 'Test plans',  icon: '◳' },
    { to: `/projects/${projectId}/defects`,  label: 'Defects',     icon: '⚑' },
    { to: `/projects/${projectId}/insights`, label: 'Insights',    icon: '◈' },
    { to: `/projects/${projectId}/settings`, label: 'Settings',    icon: '⚙' },
  ] : [];

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="app-sidebar">
        {/* Logo */}
        <div style={{
          padding: '18px 16px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <img
            src="/favicon.svg"
            alt="QAForge"
            style={{ width: 30, height: 30, borderRadius: 7 }}
          />
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>QAForge</span>
        </div>

        {/* Back to projects */}
        {projectId && (
          <div style={{ padding: '10px 8px 4px' }}>
            <button
              onClick={() => navigate('/')}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '6px 10px',
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                fontSize: '0.8125rem', cursor: 'pointer', borderRadius: 5,
                textAlign: 'left',
              }}
            >
              ← All projects
            </button>
          </div>
        )}

        {/* Nav section label */}
        {projectId && (
          <div style={{
            padding: '8px 20px 4px',
            fontSize: '0.6875rem',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}>
            Project
          </div>
        )}

        {/* Nav items */}
        <nav style={{ flex: 1, paddingTop: 4 }}>
          {projectNav.length > 0
            ? projectNav.map(item => <SidebarItem key={item.to} {...item} />)
            : (
              <SidebarItem to="/" label="Projects" icon="▦" />
            )
          }
        </nav>

        {/* User area */}
        <div style={{
          padding: '12px 14px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'var(--color-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.8rem', fontWeight: 600, color: '#fff',
            flexShrink: 0,
          }}>
            {user?.name?.charAt(0).toUpperCase() ?? 'U'}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '1rem', padding: 4 }}
          >
            ⎋
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="app-main">
        {/* Topbar */}
        {(title || actions) && (
          <header className="app-topbar">
            <div style={{ flex: 1 }}>
              {title && <h1 style={{ fontSize: '1.0625rem', fontWeight: 600, color: 'var(--gray-900)' }}>{title}</h1>}
            </div>
            <ThemeToggle />
            {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>}
          </header>
        )}

        {/* Page content */}
        <main className="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}
