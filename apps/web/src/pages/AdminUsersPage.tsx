import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Spinner, EmptyState, StatCard } from '../components/shared/ui';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

interface Membership {
  role: string;
  project: { id: string; name: string; slug: string };
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  activated: boolean;
  systemAdmin: boolean;
  createdAt: string;
  memberships: Membership[];
}

const ROLE_COLOR: Record<string, { color: string; bg: string }> = {
  admin:   { color: '#7C3AED', bg: '#EDE9FE' },
  manager: { color: '#0052CC', bg: '#E6F0FF' },
  editor:  { color: '#16A34A', bg: '#DCFCE7' },
  viewer:  { color: '#6B7280', bg: '#F3F4F6' },
};

export function AdminUsersPage() {
  const navigate  = useNavigate();
  const currentUser = useAuthStore(s => s.user);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sysadmin-users'],
    queryFn: () => api.get<{ users: AdminUser[] }>('projects/sysadmin/users'),
  });

  // Collect every project that exists across all users' memberships
  const allProjectsMap = new Map<string, { id: string; name: string; slug: string }>();
  (data?.users ?? []).forEach(u =>
    u.memberships.forEach(m => allProjectsMap.set(m.project.id, m.project))
  );
  const allProjects = [...allProjectsMap.values()];
  const totalProjects = allProjects.length;

  const users = (data?.users ?? []).filter(u =>
    !search ||
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  // For a sysadmin, build their effective project list:
  // projects they're a member of (with role) + projects they're not a member of (marked "system admin")
  function effectiveMemberships(user: AdminUser): { role: string; project: { id: string; name: string; slug: string }; isSysAdminOnly: boolean }[] {
    if (!user.systemAdmin) return user.memberships.map(m => ({ ...m, isSysAdminOnly: false }));
    const memberIds = new Set(user.memberships.map(m => m.project.id));
    const explicit = user.memberships.map(m => ({ ...m, isSysAdminOnly: false }));
    const implicit = allProjects
      .filter(p => !memberIds.has(p.id))
      .map(p => ({ role: 'system admin', project: p, isSysAdminOnly: true }));
    return [...explicit, ...implicit];
  }

  return (
    <AppLayout title="All users">
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>

        {/* Back + stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>← All projects</Button>
        </div>

        <div className="grid-4" style={{ marginBottom: 24 }}>
          <StatCard label="Total users"    value={data?.users.length ?? 0} />
          <StatCard label="Activated"      value={(data?.users ?? []).filter(u => u.activated).length} color="var(--color-success)" />
          <StatCard label="Pending invite" value={(data?.users ?? []).filter(u => !u.activated).length} color="var(--color-warning)" />
          <StatCard label="Projects"       value={totalProjects} />
        </div>

        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            style={{
              width: '100%', padding: '8px 14px', border: '1px solid var(--border-color)',
              borderRadius: 8, fontSize: '0.875rem', outline: 'none',
              background: 'var(--surface-base)', color: 'var(--gray-900)',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Users table */}
        <div className="card" style={{ padding: 0 }}>
          {isLoading && <div style={{ padding: 32 }}><Spinner size="lg" /></div>}

          {!isLoading && users.length === 0 && (
            <EmptyState icon="👥" title="No users found" description="Try a different search term." />
          )}

          {users.map((user, i) => {
            const isLast = i === users.length - 1;
            const isSelf = user.id === currentUser?.id;

            return (
              <div key={user.id} style={{
                padding: '16px 20px',
                borderBottom: isLast ? 'none' : '1px solid var(--border-color)',
              }}>
                {/* User header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: user.memberships.length > 0 ? 10 : 0 }}>
                  {/* Avatar */}
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: user.systemAdmin ? '#FEF3C7' : 'var(--color-primary-light)',
                    border: `2px solid ${user.systemAdmin ? '#F59E0B' : 'var(--color-primary)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.875rem', fontWeight: 700,
                    color: user.systemAdmin ? '#92400E' : 'var(--color-primary)',
                    flexShrink: 0,
                  }}>
                    {user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
                  </div>

                  {/* Name + email */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--gray-900)' }}>
                        {user.name || <span style={{ color: 'var(--gray-400)', fontStyle: 'italic' }}>No name set</span>}
                      </span>
                      {user.systemAdmin && (
                        <span style={{
                          background: '#FEF3C7', color: '#92400E',
                          fontSize: '0.6875rem', fontWeight: 700,
                          padding: '1px 8px', borderRadius: 20,
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>
                          System Admin
                        </span>
                      )}
                      {!user.activated && (
                        <span style={{
                          background: 'var(--color-warning-light)', color: 'var(--color-warning)',
                          fontSize: '0.6875rem', fontWeight: 600,
                          padding: '1px 8px', borderRadius: 20,
                        }}>
                          Pending
                        </span>
                      )}
                      {isSelf && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>(you)</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', marginTop: 2 }}>
                      {user.email}
                    </div>
                  </div>

                  {/* Project count */}
                  {(() => {
                    const count = effectiveMemberships(user).length;
                    return (
                      <div style={{ textAlign: 'center', minWidth: 52, flexShrink: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--gray-900)' }}>{count}</div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--gray-400)', textTransform: 'uppercase' }}>
                          {count === 1 ? 'project' : 'projects'}
                        </div>
                      </div>
                    );
                  })()}

                </div>

                {/* Project memberships */}
                {(() => {
                  const effective = effectiveMemberships(user);
                  if (effective.length === 0 && user.activated) {
                    return (
                      <div style={{ paddingLeft: 48, fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
                        Not a member of any project
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 48 }}>
                      {effective.map(m => {
                        const rc = m.isSysAdminOnly
                          ? { color: '#92400E', bg: '#FEF3C7' }
                          : (ROLE_COLOR[m.role] ?? ROLE_COLOR.viewer);
                        return (
                          <button
                            key={m.project.id}
                            onClick={() => navigate(`/projects/${m.project.id}`)}
                            title={`Open ${m.project.name}`}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '3px 10px', borderRadius: 6,
                              border: `1px solid ${m.isSysAdminOnly ? '#FDE68A' : 'var(--border-color)'}`,
                              background: m.isSysAdminOnly ? '#FFFBEB' : 'var(--surface-base)',
                              cursor: 'pointer', fontSize: '0.8125rem',
                            }}
                          >
                            <span style={{ color: m.isSysAdminOnly ? '#78350F' : 'var(--gray-700)', fontWeight: 500 }}>{m.project.name}</span>
                            <span style={{
                              padding: '1px 6px', borderRadius: 4,
                              fontSize: '0.6875rem', fontWeight: 600,
                              color: rc.color, background: rc.bg,
                            }}>
                              {m.isSysAdminOnly ? 'sys admin' : m.role}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
