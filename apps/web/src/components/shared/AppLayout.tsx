import { ReactNode, useState } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const SIDEBAR_COLLAPSED_KEY = 'qaforge:sidebarCollapsed';

function SidebarItem({ to, label, icon, collapsed }: NavItem & { collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      end
      title={collapsed ? label : undefined}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: collapsed ? '8px 0' : '8px 14px',
        justifyContent: collapsed ? 'center' : 'flex-start',
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
      <span style={{ fontSize: '1rem', width: 20, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      {!collapsed && label}
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
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  }

  const projectNav: NavItem[] = projectId ? [
    { to: `/projects/${projectId}`,          label: 'Dashboard',   icon: '▦' },
    { to: `/projects/${projectId}/cases`,    label: 'Test cases',  icon: '✓' },
    { to: `/projects/${projectId}/runs`,     label: 'Runs',        icon: '▶' },
    { to: `/projects/${projectId}/plans`,    label: 'Test plans',  icon: '◳' },
    { to: `/projects/${projectId}/defects`,  label: 'Defects',     icon: '⚑' },
    { to: `/projects/${projectId}/insights`, label: 'Insights',    icon: '◈' },
    { to: `/projects/${projectId}/settings`, label: 'Settings',    icon: '⚙' },
  ] : [];
  const rootNav: NavItem[] = user?.systemAdmin ? [
    { to: '/', label: 'Projects', icon: '▦' },
    { to: '/admin/dashboard', label: 'Admin dashboard', icon: '◈' },
    { to: '/admin/project-insights', label: 'Project insights', icon: '▥' },
    { to: '/admin/inactive-projects', label: 'Inactive projects', icon: '◷' },
    { to: '/admin/users', label: 'Users', icon: '♟' },
    { to: '/admin/leadership', label: 'Leadership reviews', icon: '◆' },
    { to: '/admin/activity', label: 'Activity', icon: '≡' },
  ] : [{ to: '/', label: 'Projects', icon: '▦' }];

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className={`app-sidebar${collapsed ? ' collapsed' : ''}`}>
        {/* Logo */}
        <div style={{
          padding: collapsed ? '14px 0' : '18px 16px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          flexDirection: collapsed ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
            <img
              src="/favicon.svg"
              alt="QAForge"
              style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0 }}
            />
            {!collapsed && <span style={{ fontWeight: 700, fontSize: '1rem', color: '#fff', whiteSpace: 'nowrap' }}>QAForge</span>}
          </div>
          <button
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        {/* Back to projects */}
        {projectId && (
          <div style={{ padding: collapsed ? '10px 0 4px' : '10px 8px 4px' }}>
            <button
              onClick={() => navigate('/')}
              title="All projects"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                justifyContent: collapsed ? 'center' : 'flex-start',
                width: '100%', padding: collapsed ? '6px 0' : '6px 10px',
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                fontSize: '0.8125rem', cursor: 'pointer', borderRadius: 5,
                textAlign: 'left',
              }}
            >
              {collapsed ? '←' : '← All projects'}
            </button>
          </div>
        )}

        {/* Nav section label */}
        {projectId && !collapsed && (
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
            ? projectNav.map(item => <SidebarItem key={item.to} {...item} collapsed={collapsed} />)
            : rootNav.map(item => <SidebarItem key={item.to} {...item} collapsed={collapsed} />)
          }
        </nav>

        {/* User area */}
        <div style={{
          padding: collapsed ? '12px 0' : '12px 14px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 10,
          justifyContent: collapsed ? 'center' : 'flex-start',
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
          {!collapsed && (
            <>
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
            </>
          )}
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
