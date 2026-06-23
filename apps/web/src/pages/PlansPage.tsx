import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Modal, Input, Alert, EmptyState, Spinner, StatCard } from '../components/shared/ui';
import { api } from '../lib/api';
import { useProjectRole } from '../hooks/useProjectRole';
import { exportSprintSummaryPdf } from '../lib/export';

// ── Types ────────────────────────────────────────────────────────────────────

interface RunStats {
  resultCounts: { pass: number; fail: number; blocked: number; skipped: number; not_applicable: number };
  resultTotal: number;
  passRate: number | null;
}

interface PlanRun {
  id: string;
  name: string;
  env: string;
  status: string;
  source: string;
  startedAt: string;
  endedAt: string | null;
  caseCount: number;
  doneCount: number;
  passRate: number | null;
  resultTotal: number;
  resultCounts: RunStats['resultCounts'];
}

interface TestPlan {
  id: string;
  name: string;
  milestone: string | null;
  description: string | null;
  status: string;
  endsAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  runs: PlanRun[];
  aggregate: RunStats;
}

interface UnassignedRun {
  id: string;
  name: string;
  env: string;
  status: string;
  startedAt: string;
}

interface SummaryCaseEntry {
  id: string;
  seqId?: number;
  title: string;
  status: string;
  failureNote: string | null;
  errorMessage: string | null;
}

interface SummaryStory {
  key: string;
  label: string;
  url: string | null;
  type: string;
  storyStatus: string;
  cases: SummaryCaseEntry[];
}

interface SprintSummary {
  stories: SummaryStory[];
  unlinked: SummaryCaseEntry[];
  overall: { total: number; pass: number; fail: number; blocked: number; skipped: number; passRate: number | null };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function PassBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span style={{ color: 'var(--gray-400)', fontSize: '0.8125rem' }}>No results</span>;
  const color = rate >= 80 ? 'var(--color-success)' : rate >= 50 ? '#d97706' : '#dc2626';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--gray-100)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${rate}%`, background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color, whiteSpace: 'nowrap' }}>{rate}%</span>
    </div>
  );
}

function MilestoneTag({ label }: { label: string }) {
  return (
    <span style={{
      background: '#EDE9FE', color: '#5B21B6',
      padding: '2px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isOpen   = status === 'open';
  const isActive = status === 'active';
  const config = isOpen || isActive
    ? { bg: 'var(--color-warning-light)', color: 'var(--color-warning)', label: status }
    : { bg: 'var(--color-success-light)', color: 'var(--color-success)', label: status };
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 600,
      background: config.bg, color: config.color,
    }}>
      {config.label}
    </span>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function PlansPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const { isEditor } = useProjectRole(projectId);

  const [selectedPlan, setSelectedPlan] = useState<TestPlan | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [summaryView, setSummaryView] = useState<'runs' | 'summary'>('runs');

  // Create form
  const [newName, setNewName]         = useState('');
  const [newMilestone, setNewMilestone] = useState('');
  const [newDesc, setNewDesc]         = useState('');
  const [newEndsAt, setNewEndsAt]     = useState('');
  const [createError, setCreateError] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: plansData, isLoading } = useQuery({
    queryKey: ['plans', projectId],
    queryFn: () => api.get<{ plans: TestPlan[] }>(`projects/${projectId}/plans`),
    enabled: !!projectId,
  });

  // Unassigned runs — fetched when Assign modal is open
  const { data: runsData } = useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => api.get<{ runs: UnassignedRun[] }>(`projects/${projectId}/runs`),
    enabled: !!projectId && showAssign,
  });

  // Detail refresh when a plan is selected
  const { data: planDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['plan', selectedPlan?.id],
    queryFn: () => api.get<TestPlan>(`projects/${projectId}/plans/${selectedPlan!.id}`),
    enabled: !!selectedPlan,
  });

  const { data: sprintSummary, isLoading: loadingSummary } = useQuery({
    queryKey: ['plan-summary', selectedPlan?.id],
    queryFn: () => api.get<SprintSummary>(`projects/${projectId}/plans/${selectedPlan!.id}/summary`),
    enabled: !!selectedPlan && summaryView === 'summary',
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createPlan = useMutation({
    mutationFn: (body: { name: string; milestone?: string; description?: string; endsAt?: string }) =>
      api.post<TestPlan>(`projects/${projectId}/plans`, body),
    onSuccess: (plan) => {
      qc.invalidateQueries({ queryKey: ['plans', projectId] });
      setShowCreate(false);
      setNewName(''); setNewMilestone(''); setNewDesc(''); setNewEndsAt(''); setCreateError('');
      setSelectedPlan(plan);
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const archivePlan = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.put(`projects/${projectId}/plans/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plans', projectId] });
      qc.invalidateQueries({ queryKey: ['plan', showArchiveConfirm] });
      setShowArchiveConfirm(null);
      if (selectedPlan?.id === showArchiveConfirm) setSelectedPlan(null);
    },
  });

  const deletePlan = useMutation({
    mutationFn: (id: string) =>
      api.delete(`projects/${projectId}/plans/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plans', projectId] });
      setShowDeleteConfirm(null);
      if (selectedPlan?.id === showDeleteConfirm) setSelectedPlan(null);
    },
  });

  const assignRun = useMutation({
    mutationFn: (runId: string) =>
      api.post(`projects/${projectId}/plans/${selectedPlan!.id}/runs/${runId}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan', selectedPlan?.id] });
      qc.invalidateQueries({ queryKey: ['plans', projectId] });
      setShowAssign(false);
    },
  });

  const removeRun = useMutation({
    mutationFn: (runId: string) =>
      api.delete(`projects/${projectId}/plans/${selectedPlan!.id}/runs/${runId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan', selectedPlan?.id] });
      qc.invalidateQueries({ queryKey: ['plans', projectId] });
    },
  });

  const plans = plansData?.plans ?? [];
  const detail = planDetail ?? selectedPlan;
  const allRuns = runsData?.runs ?? [];
  const assignedRunIds = new Set((detail?.runs ?? []).map(r => r.id));
  const unassignedRuns = allRuns.filter(r => !assignedRunIds.has(r.id));

  const activePlans   = plans.filter(p => p.status === 'active');
  const archivedPlans = plans.filter(p => p.status === 'archived');

  // ── Detail panel ─────────────────────────────────────────────────────────

  if (selectedPlan) {
    return (
      <AppLayout title={detail?.name ?? '…'}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          {/* Back + actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <Button variant="ghost" size="sm" onClick={() => setSelectedPlan(null)}>← All plans</Button>
            <div style={{ flex: 1 }} />
            {isEditor && detail && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setShowAssign(true)}>+ Assign run</Button>
                {detail.status === 'active' ? (
                  <Button variant="secondary" size="sm" onClick={() => setShowArchiveConfirm(detail.id)}>Archive</Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => archivePlan.mutate({ id: detail.id, status: 'active' })}>Unarchive</Button>
                )}
                <Button variant="secondary" size="sm"
                  style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                  onClick={() => setShowDeleteConfirm(detail.id)}
                >
                  Delete
                </Button>
              </>
            )}
          </div>

          {loadingDetail && !detail && <div style={{ padding: 32 }}><Spinner /></div>}

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border-color)' }}>
            {(['runs', 'summary'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setSummaryView(tab)}
                style={{
                  padding: '8px 20px', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.9rem', fontWeight: summaryView === tab ? 700 : 400,
                  color: summaryView === tab ? 'var(--color-primary)' : 'var(--gray-500)',
                  borderBottom: summaryView === tab ? '2px solid var(--color-primary)' : '2px solid transparent',
                  marginBottom: -2,
                }}
              >
                {tab === 'runs' ? 'Runs' : 'Sprint Summary'}
              </button>
            ))}
          </div>

          {summaryView === 'runs' && detail && (
            <>
              {/* Plan header card */}
              <div className="card" style={{ marginBottom: 20, padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: '1.125rem', color: 'var(--gray-900)' }}>{detail.name}</span>
                      {detail.milestone && <MilestoneTag label={detail.milestone} />}
                      <StatusBadge status={detail.status} />
                    </div>
                    {detail.description && (
                      <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)', margin: 0 }}>{detail.description}</p>
                    )}
                  </div>
                </div>

                {/* Aggregate stats */}
                <div className="grid-4" style={{ marginTop: 16 }}>
                  <StatCard label="Runs" value={detail.runs.length} />
                  <StatCard label="Total results" value={detail.aggregate.resultTotal} />
                  <StatCard
                    label="Overall pass rate"
                    value={detail.aggregate.passRate !== null ? `${detail.aggregate.passRate}%` : '—'}
                    color={detail.aggregate.passRate !== null
                      ? detail.aggregate.passRate >= 80 ? 'var(--color-success)' : '#d97706'
                      : undefined}
                  />
                  <StatCard
                    label="Failures"
                    value={detail.aggregate.resultCounts.fail}
                    color={detail.aggregate.resultCounts.fail > 0 ? '#dc2626' : undefined}
                  />
                </div>
              </div>

              {/* Runs table */}
              <div className="card">
                {detail.runs.length === 0 && (
                  <EmptyState
                    icon="▶"
                    title="No runs assigned"
                    description="Assign existing runs to this plan to track progress."
                    action={isEditor ? <Button variant="primary" onClick={() => setShowAssign(true)}>+ Assign run</Button> : undefined}
                  />
                )}
                {detail.runs.length > 0 && (
                  <table>
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Env</th>
                        <th>Status</th>
                        <th>Progress</th>
                        <th>Pass rate</th>
                        <th>Started</th>
                        {isEditor && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.runs.map(run => (
                        <tr key={run.id}>
                          <td style={{ fontWeight: 500 }}>{run.name}</td>
                          <td>
                            <span style={{
                              background: 'var(--gray-100)', color: 'var(--gray-600)',
                              padding: '2px 8px', borderRadius: 4, fontSize: '0.8125rem', fontFamily: 'monospace',
                            }}>{run.env}</span>
                          </td>
                          <td><StatusBadge status={run.status} /></td>
                          <td style={{ fontSize: '0.8125rem', color: 'var(--gray-600)' }}>
                            {run.caseCount > 0
                              ? `${run.doneCount} / ${run.caseCount}`
                              : <span style={{ color: 'var(--gray-400)' }}>—</span>}
                          </td>
                          <td style={{ minWidth: 140 }}>
                            <PassBar rate={run.passRate} />
                          </td>
                          <td style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>
                            {new Date(run.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </td>
                          {isEditor && (
                            <td>
                              <button
                                title="Remove from plan"
                                onClick={() => removeRun.mutate(run.id)}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  color: 'var(--gray-400)', fontSize: '0.875rem', padding: '2px 6px',
                                }}
                              >
                                ✕
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {summaryView === 'summary' && (
            <div>
              {loadingSummary && <div style={{ padding: 32 }}><Spinner /></div>}
              {sprintSummary && (
                <>
                  {/* Export button */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                    <Button
                      variant="secondary" size="sm"
                      onClick={() => detail && exportSprintSummaryPdf({ name: detail.name, milestone: detail.milestone, ...sprintSummary })}
                    >
                      ↓ Export PDF
                    </Button>
                  </div>

                  {/* Overall stats */}
                  <div className="grid-4" style={{ marginBottom: 20 }}>
                    <StatCard
                      label="Pass rate"
                      value={sprintSummary.overall.passRate !== null ? `${sprintSummary.overall.passRate}%` : '—'}
                      color={sprintSummary.overall.passRate !== null
                        ? sprintSummary.overall.passRate >= 80 ? 'var(--color-success)' : sprintSummary.overall.passRate >= 50 ? '#d97706' : '#dc2626'
                        : undefined}
                      sub={`${sprintSummary.overall.pass} of ${sprintSummary.overall.total} passed`}
                    />
                    <StatCard label="Failed"  value={sprintSummary.overall.fail}    color={sprintSummary.overall.fail    > 0 ? '#dc2626' : undefined} sub={sprintSummary.overall.fail > 0 ? 'need fixes' : 'all good'} />
                    <StatCard label="Blocked" value={sprintSummary.overall.blocked} color={sprintSummary.overall.blocked > 0 ? '#d97706' : undefined} sub={sprintSummary.overall.blocked > 0 ? 'investigate' : 'none'} />
                    <StatCard label="Skipped" value={sprintSummary.overall.skipped} color="var(--gray-400)" sub={`${sprintSummary.overall.total} total cases`} />
                  </div>

                  {/* Story breakdown */}
                  {sprintSummary.stories.length > 0 && (
                    <div className="card" style={{ marginBottom: 20 }}>
                      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', fontWeight: 600, fontSize: '0.875rem', color: 'var(--gray-700)' }}>
                        Story breakdown
                      </div>
                      {sprintSummary.stories.map(story => {
                        const pass    = story.cases.filter(c => c.status === 'pass').length;
                        const fail    = story.cases.filter(c => c.status === 'fail').length;
                        const blocked = story.cases.filter(c => c.status === 'blocked').length;
                        const total   = story.cases.length;
                        const statusColor =
                          story.storyStatus === 'pass'    ? 'var(--color-success)' :
                          story.storyStatus === 'fail'    ? '#dc2626' :
                          story.storyStatus === 'blocked' ? '#d97706' :
                          story.storyStatus === 'partial' ? '#d97706' : 'var(--gray-400)';
                        const statusIcon =
                          story.storyStatus === 'pass' ? '✓' :
                          story.storyStatus === 'fail' ? '✗' :
                          story.storyStatus === 'blocked' ? '⊘' : '◑';
                        return (
                          <div key={story.key} style={{ borderBottom: '1px solid var(--border-color)', padding: '12px 20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                              <span style={{ fontWeight: 700, color: statusColor, fontSize: '1rem', flexShrink: 0 }}>{statusIcon}</span>
                              <div style={{ flex: 1 }}>
                                {story.url ? (
                                  <a href={story.url} target="_blank" rel="noopener noreferrer"
                                    style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--gray-900)', textDecoration: 'none' }}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    {story.label} ↗
                                  </a>
                                ) : (
                                  <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--gray-900)' }}>{story.label}</span>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: 10, fontSize: '0.8125rem' }}>
                                {pass    > 0 && <span style={{ color: 'var(--color-success)' }}>✓ {pass}</span>}
                                {fail    > 0 && <span style={{ color: '#dc2626'             }}>✗ {fail}</span>}
                                {blocked > 0 && <span style={{ color: '#d97706'             }}>⊘ {blocked}</span>}
                                <span style={{ color: 'var(--gray-400)' }}>{pass}/{total}</span>
                              </div>
                            </div>
                            <div style={{ paddingLeft: 26, display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {story.cases.map(c => {
                                const cColor =
                                  c.status === 'pass'    ? 'var(--color-success)' :
                                  c.status === 'fail'    ? '#dc2626' :
                                  c.status === 'blocked' ? '#d97706' : 'var(--gray-400)';
                                return (
                                  <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                                    <span style={{ fontSize: '0.75rem', color: cColor, fontWeight: 700, flexShrink: 0, minWidth: 44 }}>{c.status}</span>
                                    <span style={{ fontSize: '0.8125rem', color: 'var(--gray-700)' }}>{c.title}</span>
                                    {(c.failureNote || c.errorMessage) && (
                                      <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>— {c.failureNote || c.errorMessage}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Unlinked cases */}
                  {sprintSummary.unlinked.length > 0 && (
                    <div className="card" style={{ marginBottom: 20 }}>
                      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', fontWeight: 600, fontSize: '0.875rem', color: 'var(--gray-700)' }}>
                        Unlinked cases <span style={{ fontWeight: 400, color: 'var(--gray-400)', fontSize: '0.8125rem' }}>not tied to any story</span>
                      </div>
                      {sprintSummary.unlinked.map(c => {
                        const cColor = c.status === 'pass' ? 'var(--color-success)' : c.status === 'fail' ? '#dc2626' : c.status === 'blocked' ? '#d97706' : 'var(--gray-400)';
                        return (
                          <div key={c.id} style={{ display: 'flex', gap: 10, padding: '9px 20px', borderBottom: '1px solid var(--border-color)', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '0.75rem', color: cColor, fontWeight: 700, minWidth: 50, flexShrink: 0 }}>{c.status}</span>
                            <span style={{ fontSize: '0.875rem', color: 'var(--gray-800)' }}>{c.title}</span>
                            {(c.failureNote || c.errorMessage) && (
                              <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>— {c.failureNote || c.errorMessage}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Blockers & reasons */}
                  {(sprintSummary.overall.blocked > 0 || sprintSummary.stories.some(s => s.cases.some(c => c.status === 'skipped'))) && (
                    <div className="card">
                      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', fontWeight: 600, fontSize: '0.875rem', color: 'var(--gray-700)' }}>
                        Blockers &amp; reasons
                      </div>
                      {[...sprintSummary.stories.flatMap(s => s.cases), ...sprintSummary.unlinked]
                        .filter(c => c.status === 'blocked' || c.status === 'skipped')
                        .map(c => (
                          <div key={c.id} style={{ display: 'flex', gap: 10, padding: '9px 20px', borderBottom: '1px solid var(--border-color)', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: c.status === 'blocked' ? '#d97706' : 'var(--gray-400)', minWidth: 50, flexShrink: 0 }}>
                              {c.status}
                            </span>
                            <span style={{ fontSize: '0.875rem', color: 'var(--gray-800)', fontWeight: 500 }}>{c.title}</span>
                            {c.failureNote ? (
                              <span style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>— {c.failureNote}</span>
                            ) : (
                              <span style={{ fontSize: '0.8125rem', color: 'var(--gray-300)', fontStyle: 'italic' }}>no reason recorded</span>
                            )}
                          </div>
                        ))}
                    </div>
                  )}

                  {sprintSummary.stories.length === 0 && sprintSummary.unlinked.length === 0 && (
                    <div className="card">
                      <EmptyState icon="◈" title="No results yet" description="Assign runs with executed cases to see the sprint summary." />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Assign run modal */}
          <Modal
            open={showAssign}
            onClose={() => setShowAssign(false)}
            title="Assign run to plan"
            footer={<Button variant="secondary" onClick={() => setShowAssign(false)}>Close</Button>}
          >
            {unassignedRuns.length === 0 && (
              <p style={{ color: 'var(--gray-500)', fontSize: '0.875rem', textAlign: 'center', padding: '16px 0' }}>
                All runs are already assigned to a plan, or no runs exist.
              </p>
            )}
            {unassignedRuns.map(run => (
              <div key={run.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', borderBottom: '1px solid var(--border-color)',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{run.name}</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
                    {run.env} · {run.status}
                  </div>
                </div>
                <Button
                  variant="primary" size="sm"
                  loading={assignRun.isPending}
                  onClick={() => assignRun.mutate(run.id)}
                >
                  Assign
                </Button>
              </div>
            ))}
          </Modal>

          {/* Archive confirm */}
          <Modal
            open={!!showArchiveConfirm}
            onClose={() => setShowArchiveConfirm(null)}
            title="Archive plan"
            footer={
              <>
                <Button variant="secondary" onClick={() => setShowArchiveConfirm(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  loading={archivePlan.isPending}
                  onClick={() => showArchiveConfirm && archivePlan.mutate({ id: showArchiveConfirm, status: 'archived' })}
                >
                  Archive
                </Button>
              </>
            }
          >
            <p style={{ color: 'var(--gray-600)', margin: 0 }}>
              Archive this plan? It will be hidden from the active list but its runs and results are preserved.
            </p>
          </Modal>

          {/* Delete confirm */}
          <Modal
            open={!!showDeleteConfirm}
            onClose={() => setShowDeleteConfirm(null)}
            title="Delete plan"
            footer={
              <>
                <Button variant="secondary" onClick={() => setShowDeleteConfirm(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  loading={deletePlan.isPending}
                  style={{ background: '#dc2626', borderColor: '#dc2626' }}
                  onClick={() => showDeleteConfirm && deletePlan.mutate(showDeleteConfirm)}
                >
                  Delete
                </Button>
              </>
            }
          >
            <p style={{ color: 'var(--gray-600)', margin: 0 }}>
              Delete this plan? The runs inside it will be detached but not deleted.
            </p>
          </Modal>
        </div>
      </AppLayout>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────

  return (
    <AppLayout
      title="Test plans"
      actions={isEditor && <Button variant="primary" size="sm" onClick={() => { setShowCreate(true); setCreateError(''); }}>+ New plan</Button>}
    >
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Stats row */}
        <div className="grid-4" style={{ marginBottom: 24 }}>
          <StatCard label="Total plans" value={plans.length} />
          <StatCard label="Active" value={activePlans.length} color="var(--color-warning)" />
          <StatCard label="Archived" value={archivedPlans.length} color="var(--color-success)" />
          <StatCard label="Runs in plans" value={plans.reduce((n, p) => n + p.runs.length, 0)} />
        </div>

        {isLoading && <div style={{ padding: 32 }}><Spinner size="lg" /></div>}

        {!isLoading && plans.length === 0 && (
          <div className="card">
            <EmptyState
              icon="◈"
              title="No test plans yet"
              description="Group your runs under a release or sprint milestone to track overall quality."
              action={isEditor ? <Button variant="primary" onClick={() => setShowCreate(true)}>Create first plan</Button> : undefined}
            />
          </div>
        )}

        {/* Active plans */}
        {activePlans.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
              Active
            </div>
            <div className="card" style={{ padding: 0 }}>
              {activePlans.map((plan, i) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  last={i === activePlans.length - 1}
                  onClick={() => setSelectedPlan(plan)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Archived plans */}
        {archivedPlans.length > 0 && (
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
              Archived
            </div>
            <div className="card" style={{ padding: 0, opacity: 0.75 }}>
              {archivedPlans.map((plan, i) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  last={i === archivedPlans.length - 1}
                  onClick={() => setSelectedPlan(plan)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create plan modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New test plan"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={createPlan.isPending}
              onClick={() => {
                setCreateError('');
                if (!newName.trim()) { setCreateError('Name is required'); return; }
                createPlan.mutate({
                  name: newName.trim(),
                  milestone: newMilestone.trim() || undefined,
                  description: newDesc.trim() || undefined,
                  endsAt: newEndsAt ? new Date(newEndsAt).toISOString() : undefined,
                });
              }}
            >
              Create plan
            </Button>
          </>
        }
      >
        {createError && <div style={{ marginBottom: 14 }}><Alert type="error">{createError}</Alert></div>}
        <Input
          label="Plan name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="e.g. Sprint 42 QA"
          autoFocus
        />
        <Input
          label="Milestone (optional)"
          value={newMilestone}
          onChange={e => setNewMilestone(e.target.value)}
          placeholder="e.g. v2.0.0 or Sprint 42"
        />
        <Input
          label="Description (optional)"
          value={newDesc}
          onChange={e => setNewDesc(e.target.value)}
          placeholder="e.g. Full regression coverage for the v2 release"
        />
        <Input
          label="Sprint end date (optional)"
          type="date"
          value={newEndsAt}
          onChange={e => setNewEndsAt(e.target.value)}
        />
      </Modal>
    </AppLayout>
  );
}

// ── PlanRow ───────────────────────────────────────────────────────────────────

function PlanRow({ plan, last, onClick }: { plan: TestPlan; last: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 20px',
        borderBottom: last ? 'none' : '1px solid var(--border-color)',
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--gray-50)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Name + milestone */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
          <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--gray-900)' }}>{plan.name}</span>
          {plan.milestone && <MilestoneTag label={plan.milestone} />}
        </div>
        {plan.description && (
          <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
            {plan.description}
          </div>
        )}
      </div>

      {/* Run count */}
      <div style={{ textAlign: 'center', minWidth: 52 }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--gray-900)' }}>{plan.runs.length}</div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>runs</div>
      </div>

      {/* Aggregate pass rate bar */}
      <div style={{ minWidth: 140 }}>
        <PassBar rate={plan.aggregate.passRate} />
      </div>

      {/* Created date */}
      <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>
        {new Date(plan.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
      </div>

      <span style={{ color: 'var(--gray-300)', fontSize: '1rem' }}>›</span>
    </div>
  );
}
