import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Spinner, EmptyState } from '../components/shared/ui';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  projectId: string | null;
  projectName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  createdAt: string;
}

interface ActivityResponse {
  logs: ActivityLog[];
  pagination: { page: number; limit: number; total: number };
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
}

const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  defect_filed:        { label: 'Filed defect',       icon: '🐛', color: '#DC2626' },
  defect_updated:      { label: 'Updated defect',     icon: '✏️', color: '#D97706' },
  defect_deleted:      { label: 'Deleted defect',     icon: '🗑️', color: '#6B7280' },
  case_created:        { label: 'Created test case',  icon: '✅', color: '#16A34A' },
  case_updated:        { label: 'Updated test case',  icon: '📝', color: '#2563EB' },
  run_started:         { label: 'Started run',        icon: '▶️', color: '#7C3AED' },
  run_closed:          { label: 'Closed run',         icon: '⏹️', color: '#374151' },
  plan_created:        { label: 'Created plan',       icon: '📋', color: '#0891B2' },
  plan_archived:       { label: 'Archived plan',      icon: '📦', color: '#6B7280' },
  plan_deleted:        { label: 'Deleted plan',       icon: '🗑️', color: '#6B7280' },
  member_invited:      { label: 'Invited member',     icon: '📨', color: '#0052CC' },
  member_added:        { label: 'Added member',       icon: '👤', color: '#0052CC' },
  member_role_changed: { label: 'Changed member role', icon: '🔑', color: '#D97706' },
  member_removed:      { label: 'Removed member',     icon: '👋', color: '#6B7280' },
};

function formatAction(action: string) {
  return ACTION_LABELS[action] ?? { label: action.replace(/_/g, ' '), icon: '📌', color: '#6B7280' };
}

function exactTimestamp(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const ACTION_OPTIONS = [
  'defect_filed', 'defect_updated', 'defect_deleted',
  'case_created', 'case_updated',
  'run_started', 'run_closed',
  'plan_created', 'plan_archived', 'plan_deleted',
  'member_invited', 'member_added', 'member_role_changed', 'member_removed',
];

export function ActivityLogsPage() {
  const navigate   = useNavigate();
  const isSysAdmin = useAuthStore(s => s.user?.systemAdmin ?? false);

  const [page,      setPage]      = useState(1);
  const [action,    setAction]    = useState('');
  const [projectId, setProjectId] = useState('');
  const [userId,    setUserId]    = useState('');
  const [since,     setSince]     = useState('');
  const [until,     setUntil]     = useState('');

  if (!isSysAdmin) {
    return (
      <AppLayout title="Activity Logs">
        <EmptyState icon="🔒" title="Access denied" description="Only system administrators can view activity logs." />
      </AppLayout>
    );
  }

  const params = new URLSearchParams({
    page: String(page),
    limit: '50',
    ...(action    && { action }),
    ...(projectId && { projectId }),
    ...(userId    && { userId }),
    ...(since     && { since: new Date(since).toISOString() }),
    ...(until     && { until: new Date(until + 'T23:59:59').toISOString() }),
  });

  const { data, isLoading } = useQuery<ActivityResponse>({
    queryKey: ['activity-logs', page, action, projectId, userId, since, until],
    queryFn:  () => api.get<ActivityResponse>(`projects/sysadmin/activity?${params}`),
  });

  const { data: usersData } = useQuery<{ users: AdminUser[] }>({
    queryKey: ['sysadmin-users'],
    queryFn:  () => api.get<{ users: AdminUser[] }>('projects/sysadmin/users'),
  });
  const users = usersData?.users ?? [];

  const logs  = data?.logs ?? [];
  const total = data?.pagination.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));

  function resetFilters() {
    setPage(1); setAction(''); setProjectId(''); setUserId(''); setSince(''); setUntil('');
  }

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px', border: '1px solid var(--border-color)',
    borderRadius: 6, fontSize: '0.8125rem',
    background: 'var(--surface-base)', color: 'var(--gray-900)', outline: 'none',
  };

  return (
    <AppLayout title="Activity Logs">
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>← All projects</Button>
          <h2 style={{ flex: 1, margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--gray-900)' }}>
            Activity Logs
          </h2>
          {total > 0 && (
            <span style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
              {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>

        {/* Filters */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16,
          padding: '12px 16px', background: 'var(--surface-raised)',
          border: '1px solid var(--border-color)', borderRadius: 10,
        }}>
          <select
            value={action} onChange={e => { setAction(e.target.value); setPage(1); }}
            style={inputStyle}
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map(a => (
              <option key={a} value={a}>{formatAction(a).icon} {formatAction(a).label}</option>
            ))}
          </select>

          <select
            value={userId} onChange={e => { setUserId(e.target.value); setPage(1); }}
            style={inputStyle}
          >
            <option value="">All users</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>

          <input
            value={since} type="date" onChange={e => { setSince(e.target.value); setPage(1); }}
            style={inputStyle} placeholder="From date"
          />
          <input
            value={until} type="date" onChange={e => { setUntil(e.target.value); setPage(1); }}
            style={inputStyle} placeholder="To date"
          />

          {(action || projectId || userId || since || until) && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>Clear</Button>
          )}
        </div>

        {/* Log feed */}
        <div className="card" style={{ padding: 0 }}>
          {isLoading && <div style={{ padding: 40, textAlign: 'center' }}><Spinner size="lg" /></div>}

          {!isLoading && logs.length === 0 && (
            <EmptyState icon="📋" title="No activity found" description="Try adjusting your filters." />
          )}

          {logs.map((log, i) => {
            const meta    = formatAction(log.action);
            const isLast  = i === logs.length - 1;
            const initial = (log.userName || log.userEmail).charAt(0).toUpperCase();

            return (
              <div key={log.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 16px',
                borderBottom: isLast ? 'none' : '1px solid var(--border-color)',
              }}>
                {/* Avatar */}
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--color-primary-light)',
                  border: '2px solid var(--color-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-primary)',
                }}>
                  {initial}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--gray-900)' }}>
                      {log.userName || log.userEmail}
                    </span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: '0.8125rem', color: meta.color, fontWeight: 500,
                    }}>
                      <span>{meta.icon}</span>
                      <span>{meta.label}</span>
                    </span>
                    {log.entityName && (
                      <span style={{
                        fontSize: '0.8125rem', color: 'var(--gray-700)',
                        background: 'var(--surface-raised)', padding: '1px 8px',
                        borderRadius: 4, border: '1px solid var(--border-color)',
                        maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {log.entityName}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
                    {log.projectName && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                        📁 {log.projectName}
                      </span>
                    )}
                    <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                      {log.userEmail}
                    </span>
                  </div>
                </div>

                {/* Timestamp */}
                <div style={{ flexShrink: 0, textAlign: 'right', paddingTop: 2 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>
                    {timeAgo(log.createdAt)}
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--gray-300)', whiteSpace: 'nowrap', marginTop: 1 }}>
                    {exactTimestamp(log.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              ← Prev
            </Button>
            <span style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
              Page {page} of {pages}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}>
              Next →
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
