import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, StatCard, PageSpinner, EmptyState } from '../components/shared/ui';
import { api } from '../lib/api';
import type { Project, TestRun } from '@qaforge/types';

export function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<Project>(`projects/${projectId}`),
    enabled: !!projectId,
  });

  const { data: runsData, isLoading: loadingRuns } = useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => api.get<{ runs: TestRun[] }>(`projects/${projectId}/runs`),
    enabled: !!projectId,
  });

  if (loadingProject) return <AppLayout><PageSpinner /></AppLayout>;

  const runs = runsData?.runs ?? [];
  const recentRuns = runs.slice(0, 5);

  const passCount   = runs.filter(r => r.status === 'closed').length;
  const openCount   = runs.filter(r => r.status === 'open').length;

  return (
    <AppLayout
      title={project?.name ?? 'Dashboard'}
      actions={
        <Button variant="primary" size="sm" onClick={() => navigate(`/projects/${projectId}/runs`)}>
          + New run
        </Button>
      }
    >
      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        <StatCard
          label="Total runs"
          value={runs.length}
          sub="all time"
        />
        <StatCard
          label="Open runs"
          value={openCount}
          sub="in progress"
          color={openCount > 0 ? 'var(--color-warning)' : undefined}
        />
        <StatCard
          label="Completed"
          value={passCount}
          sub="closed runs"
          color="var(--color-success)"
        />
        <StatCard
          label="Project slug"
          value={project?.slug ?? '—'}
          sub="URL identifier"
        />
      </div>

      {/* Quick actions */}
      <div className="grid-3" style={{ marginBottom: 28 }}>
        <QuickAction
          icon="✓"
          title="Test cases"
          description="Manage and organise your test suite"
          onClick={() => navigate(`/projects/${projectId}/cases`)}
        />
        <QuickAction
          icon="▶"
          title="Start a run"
          description="Execute manual, exploratory or automated tests"
          onClick={() => navigate(`/projects/${projectId}/runs`)}
        />
        <QuickAction
          icon="◈"
          title="Insights"
          description="Coverage heatmap, flakiness scores, trends"
          onClick={() => navigate(`/projects/${projectId}/insights`)}
        />
      </div>

      {/* Recent runs */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Recent runs</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/projects/${projectId}/runs`)}
          >
            View all →
          </Button>
        </div>

        {loadingRuns && <div style={{ padding: 24 }}><PageSpinner /></div>}

        {!loadingRuns && recentRuns.length === 0 && (
          <EmptyState
            icon="▶"
            title="No runs yet"
            description="Start your first test run to see results here."
            action={
              <Button variant="primary" size="sm" onClick={() => navigate(`/projects/${projectId}/runs`)}>
                Start first run
              </Button>
            }
          />
        )}

        {recentRuns.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Environment</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map(run => (
                  <tr
                    key={run.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/projects/${projectId}/runs`)}
                  >
                    <td style={{ fontWeight: 500 }}>{run.name}</td>
                    <td>
                      <span style={{
                        background: 'var(--gray-100)', color: 'var(--gray-600)',
                        padding: '2px 8px', borderRadius: 4, fontSize: '0.8125rem',
                        fontFamily: 'monospace',
                      }}>
                        {run.env}
                      </span>
                    </td>
                    <td style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>{run.source}</td>
                    <td>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 20,
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        background: run.status === 'closed' ? 'var(--color-success-light)' : 'var(--color-warning-light)',
                        color: run.status === 'closed' ? 'var(--color-success)' : 'var(--color-warning)',
                      }}>
                        {run.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>
                      {new Date(run.startedAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

// ── Quick action card ─────────────────────────────────────────
function QuickAction({
  icon, title, description, onClick,
}: {
  icon: string; title: string; description: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', width: '100%',
        background: 'var(--surface-base)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '18px 20px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: 'var(--shadow-sm)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      <div style={{
        width: 38, height: 38,
        background: 'var(--color-primary-light)',
        borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.1rem', marginBottom: 12,
      }}>
        {icon}
      </div>
      <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--gray-900)', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
        {description}
      </div>
    </button>
  );
}
