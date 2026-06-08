import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Spinner, EmptyState, StatCard } from '../components/shared/ui';
import { api } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewStats {
  totalProjects: number;
  totalUsers: number;
  activatedUsers: number;
  totalCases: number;
  openRuns: number;
  openDefects: number;
}

interface LatestRun {
  id: string;
  name: string;
  env: string;
  status: string;
  startedAt: string;
}

interface ProjectHealth {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  counts: { cases: number; runs: number; members: number };
  openDefects: number;
  latestRun: LatestRun | null;
}

interface RecentRun {
  id: string;
  name: string;
  env: string;
  status: string;
  startedAt: string;
  project: { id: string; name: string };
}

interface OverviewData {
  stats: OverviewStats;
  projects: ProjectHealth[];
  recentRuns: RecentRun[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function projectStaleness(latestRun: LatestRun | null): 'none' | 'stale' | 'ok' {
  if (!latestRun) return 'none';
  const days = (Date.now() - new Date(latestRun.startedAt).getTime()) / 86_400_000;
  return days > 30 ? 'stale' : 'ok';
}

const RUN_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  open:   { label: 'Open',   color: '#D97706', bg: '#FEF3C7' },
  closed: { label: 'Closed', color: '#16A34A', bg: '#DCFCE7' },
};

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function fmtRelative(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminDashboardPage() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['sysadmin-overview'],
    queryFn: () => api.get<OverviewData>('projects/sysadmin/overview'),
  });

  const stats    = data?.stats;
  const projects = data?.projects ?? [];
  const recent   = data?.recentRuns ?? [];

  return (
    <AppLayout title="System overview">
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        {/* Back nav + header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>← All projects</Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={() => navigate('/admin/users')}>
              👥 Manage users
            </Button>
          </div>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
            <Spinner size="lg" />
          </div>
        )}

        {!isLoading && stats && (
          <>
            {/* System stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginBottom: 28 }}>
              <StatCard label="Projects"       value={stats.totalProjects} />
              <StatCard label="Active users"   value={stats.activatedUsers}
                sub={`${stats.totalUsers - stats.activatedUsers} pending`}
                color="var(--color-primary)" />
              <StatCard label="Test cases"     value={stats.totalCases} />
              <StatCard label="Open runs"      value={stats.openRuns}
                color={stats.openRuns > 0 ? 'var(--color-warning)' : undefined} />
              <StatCard label="Open defects"   value={stats.openDefects}
                color={stats.openDefects > 0 ? '#DC2626' : undefined} />
              <StatCard label="Pending invites" value={stats.totalUsers - stats.activatedUsers}
                color={stats.totalUsers - stats.activatedUsers > 0 ? 'var(--gray-500)' : undefined} />
            </div>

            {/* Projects health table */}
            <div className="card" style={{ padding: 0, marginBottom: 24 }}>
              <div className="card-header" style={{ padding: '14px 20px' }}>
                <span className="card-title">Projects</span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
                  {projects.length} project{projects.length !== 1 ? 's' : ''}
                </span>
              </div>

              {projects.length === 0 && (
                <EmptyState icon="🗂" title="No projects yet" description="Create a project to get started." />
              )}

              {projects.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th style={{ textAlign: 'center' }}>Members</th>
                        <th style={{ textAlign: 'center' }}>Cases</th>
                        <th style={{ textAlign: 'center' }}>Runs</th>
                        <th>Latest run</th>
                        <th style={{ textAlign: 'center' }}>Open defects</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map(p => {
                        const stale = projectStaleness(p.latestRun);
                        const rs = p.latestRun ? (RUN_STATUS[p.latestRun.status] ?? RUN_STATUS.closed) : null;
                        return (
                          <tr
                            key={p.id}
                            style={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/projects/${p.id}`)}
                          >
                            {/* Project name + activity dot */}
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{
                                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                  background: stale === 'ok' ? '#16A34A' : stale === 'stale' ? '#D97706' : '#D1D5DB',
                                }} title={stale === 'ok' ? 'Active recently' : stale === 'stale' ? 'No run in 30+ days' : 'No runs yet'} />
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--gray-900)' }}>{p.name}</div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', fontFamily: 'monospace' }}>{p.slug}</div>
                                </div>
                              </div>
                            </td>

                            {/* Members */}
                            <td style={{ textAlign: 'center', color: 'var(--gray-600)', fontWeight: 500 }}>
                              {p.counts.members}
                            </td>

                            {/* Cases */}
                            <td style={{ textAlign: 'center', color: 'var(--gray-600)' }}>
                              {p.counts.cases}
                            </td>

                            {/* Runs */}
                            <td style={{ textAlign: 'center', color: 'var(--gray-600)' }}>
                              {p.counts.runs}
                            </td>

                            {/* Latest run */}
                            <td>
                              {p.latestRun && rs ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{
                                    padding: '1px 8px', borderRadius: 20,
                                    fontSize: '0.75rem', fontWeight: 600,
                                    color: rs.color, background: rs.bg,
                                  }}>
                                    {rs.label}
                                  </span>
                                  <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
                                    {fmtRelative(p.latestRun.startedAt)}
                                  </span>
                                  <span style={{
                                    fontFamily: 'monospace', fontSize: '0.75rem',
                                    background: 'var(--gray-100)', color: 'var(--gray-500)',
                                    padding: '1px 5px', borderRadius: 4,
                                  }}>
                                    {p.latestRun.env}
                                  </span>
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.8125rem', color: 'var(--gray-300)', fontStyle: 'italic' }}>No runs yet</span>
                              )}
                            </td>

                            {/* Open defects */}
                            <td style={{ textAlign: 'center' }}>
                              {p.openDefects > 0 ? (
                                <span style={{
                                  padding: '2px 10px', borderRadius: 20,
                                  fontSize: '0.8125rem', fontWeight: 700,
                                  color: '#DC2626', background: '#FEE2E2',
                                }}>
                                  {p.openDefects}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--gray-300)', fontSize: '0.875rem' }}>—</span>
                              )}
                            </td>

                            {/* Arrow */}
                            <td style={{ color: 'var(--gray-300)', textAlign: 'right', paddingRight: 16 }}>→</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent activity */}
            <div className="card" style={{ padding: 0 }}>
              <div className="card-header" style={{ padding: '14px 20px' }}>
                <span className="card-title">Recent runs across all projects</span>
              </div>

              {recent.length === 0 && (
                <EmptyState icon="▶" title="No runs yet" description="Test runs will appear here once teams start executing." />
              )}

              {recent.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Run</th>
                        <th>Env</th>
                        <th>Status</th>
                        <th>Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map(run => {
                        const rs = RUN_STATUS[run.status] ?? RUN_STATUS.closed;
                        return (
                          <tr
                            key={run.id}
                            style={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/projects/${run.project.id}/runs`)}
                          >
                            <td>
                              <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-primary)' }}>
                                {run.project.name}
                              </span>
                            </td>
                            <td style={{ fontWeight: 500, color: 'var(--gray-800)' }}>{run.name}</td>
                            <td>
                              <span style={{
                                fontFamily: 'monospace', fontSize: '0.8125rem',
                                background: 'var(--gray-100)', color: 'var(--gray-500)',
                                padding: '1px 6px', borderRadius: 4,
                              }}>
                                {run.env}
                              </span>
                            </td>
                            <td>
                              <span style={{
                                padding: '2px 10px', borderRadius: 20,
                                fontSize: '0.8125rem', fontWeight: 600,
                                color: rs.color, background: rs.bg,
                              }}>
                                {rs.label}
                              </span>
                            </td>
                            <td style={{ color: 'var(--gray-400)', fontSize: '0.8125rem' }}>
                              {fmt(run.startedAt)} · {fmtRelative(run.startedAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
