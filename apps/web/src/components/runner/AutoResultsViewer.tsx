import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Input, Select, Spinner, EmptyState, StatCard, Alert } from '../shared/ui';
import { api } from '../../lib/api';
import { exportResultsCsv, exportResultsPdf, buildExecutiveSummary } from '../../lib/export';

interface Defect {
  id: string;
  title: string | null;
  tracker: string;
  externalRef: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

interface RunResult {
  id: number;
  testCaseId: string;
  testCaseVersion: number;
  status: string;
  durationMs?: number;
  stepsLog?: unknown;
  errorMessage?: string;
  stackTrace?: string;
  failureNote?: string | null;
  attachments?: Array<{ type: string; url: string }>;
  executedAt: string;
  testCase?: { title: string; type: string; priority?: string };
  defect?: Defect | null;
}

const TRACKER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  jira:     { label: 'Jira',     color: '#0052CC', bg: '#E6F0FF' },
  github:   { label: 'GitHub',   color: '#24292F', bg: '#F0F0F0' },
  linear:   { label: 'Linear',   color: '#5E6AD2', bg: '#EEEFFE' },
  internal: { label: 'Internal', color: '#6B7280', bg: '#F3F4F6' },
};

const STATUS_CONFIG_DEFECT: Record<string, { label: string; color: string; bg: string }> = {
  open:        { label: 'Open',        color: '#DC2626', bg: '#FEE2E2' },
  in_progress: { label: 'In progress', color: '#D97706', bg: '#FEF3C7' },
  resolved:    { label: 'Resolved',    color: '#16A34A', bg: '#DCFCE7' },
  closed:      { label: 'Closed',      color: '#6B7280', bg: '#F3F4F6' },
  wont_fix:    { label: "Won't fix",   color: '#9CA3AF', bg: '#F9FAFB' },
};

interface RunDetail {
  name: string;
  env: string;
  source: string;
  startedAt: string;
  endedAt?: string;
  projectName: string;
  reporterName: string | null;
}

interface AutoResultsViewerProps {
  projectId: string;
  runId: string;
  runName: string;
  onBack: () => void;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; icon: string }> = {
  pass:    { color: 'var(--color-success)', bg: 'var(--color-success-light)', border: '#bbf7d0', icon: '✓' },
  fail:    { color: 'var(--color-danger)',  bg: 'var(--color-danger-light)',  border: '#fecaca', icon: '✕' },
  blocked: { color: 'var(--color-warning)', bg: 'var(--color-warning-light)', border: '#fde68a', icon: '⊘' },
  skipped: { color: 'var(--gray-400)',      bg: 'var(--gray-50)',             border: 'var(--border-color)', icon: '—' },
};

export function AutoResultsViewer({ projectId, runId, runName, onBack }: AutoResultsViewerProps) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  // Executive summary edit modal
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryText, setSummaryText] = useState('');

  // Defect filing state
  const [filingFor, setFilingFor] = useState<RunResult | null>(null);
  const [editingDefect, setEditingDefect] = useState<{ defect: Defect; resultId: number } | null>(null);
  const [defectTitle, setDefectTitle]     = useState('');
  const [defectTracker, setDefectTracker] = useState('jira');
  const [defectStatus, setDefectStatus]   = useState('open');
  const [defectRef, setDefectRef]         = useState('');
  const [defectNotes, setDefectNotes]     = useState('');
  const [defectError, setDefectError]     = useState('');

  const { data: runDetail } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.get<RunDetail>(`projects/${projectId}/runs/${runId}`),
    enabled: !!runId,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['run-results', runId],
    queryFn: () =>
      api.get<{ results: RunResult[] }>(`projects/${projectId}/runs/${runId}/results`),
    enabled: !!runId,
  });

  const results = data?.results ?? [];

  // ── Defect mutations ─────────────────────────────────────────
  const fileDefect = useMutation({
    mutationFn: (body: { title: string; tracker: string; externalRef?: string; notes?: string }) =>
      api.post<Defect>(`projects/${projectId}/results/${filingFor!.id}/defect`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run-results', runId] });
      setFilingFor(null);
      setDefectTitle(''); setDefectTracker('jira'); setDefectRef(''); setDefectNotes(''); setDefectError('');
    },
    onError: (err: Error) => setDefectError(err.message),
  });

  const updateDefect = useMutation({
    mutationFn: (body: { status?: string; externalRef?: string; notes?: string }) =>
      api.patch<Defect>(`projects/${projectId}/defects/${editingDefect!.defect.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run-results', runId] });
      setEditingDefect(null);
    },
  });

  const removeDefect = useMutation({
    mutationFn: (defectId: string) =>
      api.delete(`projects/${projectId}/defects/${defectId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run-results', runId] }),
  });

  const counts = results.reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );
  const total    = results.length;
  const passed   = counts['pass']    ?? 0;
  const failed   = counts['fail']    ?? 0;
  const blocked  = counts['blocked'] ?? 0;
  const skipped  = counts['skipped'] ?? 0;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const totalMs  = results.reduce((s, r) => s + (r.durationMs ?? 0), 0);

  const filtered = results.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (search) {
      const title = r.testCase?.title ?? '';
      if (!title.toLowerCase().includes(search.toLowerCase())) return false;
    }
    return true;
  });

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function fmtDuration(ms?: number) {
    if (!ms) return '—';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }

  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  function fmtTotalDuration(ms: number) {
    if (ms >= 60000) return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>

      {/* Back + title + export actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <div>
          <h2 style={{ margin: 0 }}>{runName}</h2>
          <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
            {total} test{total !== 1 ? 's' : ''} · run #{runId.slice(-6)}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button
            variant="secondary" size="sm"
            loading={exporting}
            onClick={() => {
              exportResultsCsv(
                {
                  name:        runDetail?.name ?? runName,
                  env:         runDetail?.env ?? '',
                  source:      runDetail?.source ?? '',
                  startedAt:   runDetail?.startedAt ?? new Date().toISOString(),
                  endedAt:     runDetail?.endedAt,
                  reporter:    runDetail?.reporterName ?? undefined,
                  projectName: runDetail?.projectName,
                },
                results as Parameters<typeof exportResultsCsv>[1]
              );
            }}
          >
            ↓ CSV
          </Button>
          <Button
            variant="secondary" size="sm"
            onClick={() => {
              const defaultText = buildExecutiveSummary(
                {
                  name:        runDetail?.name ?? runName,
                  env:         runDetail?.env ?? '',
                  source:      runDetail?.source ?? '',
                  startedAt:   runDetail?.startedAt ?? new Date().toISOString(),
                  endedAt:     runDetail?.endedAt,
                  reporter:    runDetail?.reporterName ?? undefined,
                  projectName: runDetail?.projectName,
                },
                { total, passed, failed, blocked, skipped, passRate }
              );
              setSummaryText(defaultText);
              setShowSummaryModal(true);
            }}
          >
            ↓ PDF
          </Button>
        </div>
      </div>

      {isError && (
        <div style={{ marginBottom: 20 }}>
          <Alert type="error">Failed to load results. Check the API is running.</Alert>
        </div>
      )}

      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <StatCard
          label="Pass rate" value={`${passRate}%`}
          color={passRate >= 90 ? 'var(--color-success)' : passRate >= 70 ? 'var(--color-warning)' : 'var(--color-danger)'}
          sub={`${passed} of ${total} passed`}
        />
        <StatCard label="Failed"   value={failed}  color={failed  > 0 ? 'var(--color-danger)'  : undefined} sub={failed  > 0 ? 'need attention' : 'all good'} />
        <StatCard label="Blocked"  value={blocked} color={blocked > 0 ? 'var(--color-warning)' : undefined} sub={blocked > 0 ? 'investigate'    : 'none'} />
        <StatCard label="Duration" value={fmtTotalDuration(totalMs)} sub={`${skipped} skipped`} />
      </div>

      {/* Visual pass bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
          {passed  > 0 && <div style={{ flex: passed,  background: 'var(--color-success)' }} title={`${passed} passed`} />}
          {failed  > 0 && <div style={{ flex: failed,  background: 'var(--color-danger)'  }} title={`${failed} failed`} />}
          {blocked > 0 && <div style={{ flex: blocked, background: 'var(--color-warning)' }} title={`${blocked} blocked`} />}
          {skipped > 0 && <div style={{ flex: skipped, background: 'var(--gray-200)'      }} title={`${skipped} skipped`} />}
          {total === 0  && <div style={{ flex: 1,       background: 'var(--gray-200)'     }} />}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: '0.8125rem' }}>
          {passed  > 0 && <span style={{ color: 'var(--color-success)' }}>✓ {passed} passed</span>}
          {failed  > 0 && <span style={{ color: 'var(--color-danger)'  }}>✕ {failed} failed</span>}
          {blocked > 0 && <span style={{ color: 'var(--color-warning)' }}>⊘ {blocked} blocked</span>}
          {skipped > 0 && <span style={{ color: 'var(--gray-400)'      }}>– {skipped} skipped</span>}
        </div>
      </div>

      {/* Blockers & reasons summary */}
      {(blocked > 0 || skipped > 0) && (
        <div style={{
          marginBottom: 20, padding: '14px 16px',
          background: 'var(--surface-base)', border: '1px solid var(--border-color)',
          borderRadius: 8,
        }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--gray-700)', marginBottom: 10 }}>
            Blockers &amp; reasons
          </div>
          {results
            .filter(r => r.status === 'blocked' || r.status === 'skipped')
            .map(r => {
              const c = STATUS_CONFIG[r.status] ?? STATUS_CONFIG['skipped'];
              return (
                <div key={r.id} style={{ display: 'flex', gap: 10, marginBottom: 7, alignItems: 'baseline' }}>
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 700, color: c.color,
                    background: c.bg, border: `1px solid ${c.border}`,
                    padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                  }}>
                    {r.status}
                  </span>
                  <span style={{ fontSize: '0.875rem', color: 'var(--gray-800)', fontWeight: 500 }}>
                    {r.testCase?.title ?? `Test #${r.testCaseId.slice(-6)}`}
                  </span>
                  {r.failureNote ? (
                    <span style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
                      — {r.failureNote}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.8125rem', color: 'var(--gray-300)', fontStyle: 'italic' }}>
                      no reason recorded
                    </span>
                  )}
                </div>
              );
            })
          }
        </div>
      )}

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 14, padding: '10px 14px',
        background: 'var(--surface-base)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--border-radius-md)', alignItems: 'center', flexWrap: 'wrap',
      }}>
        <input
          className="input"
          style={{ width: 220, fontSize: '0.875rem', padding: '6px 10px' }}
          placeholder="Search tests…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {(['all', 'fail', 'pass', 'blocked', 'skipped'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: '0.8125rem',
              border: `1px solid ${statusFilter === s ? 'var(--color-primary)' : 'var(--border-color)'}`,
              background: statusFilter === s ? 'var(--color-primary-light)' : 'transparent',
              color: statusFilter === s ? 'var(--color-primary)' : 'var(--gray-500)',
              fontWeight: statusFilter === s ? 500 : 400, transition: 'all 0.15s',
            }}
          >
            {s === 'all'
              ? `All (${total})`
              : `${s.charAt(0).toUpperCase() + s.slice(1)} (${counts[s] ?? 0})`
            }
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spinner size="lg" />
        </div>
      )}

      {!isLoading && !isError && results.length === 0 && (
        <div className="card">
          <EmptyState
            icon="▶"
            title="No results yet"
            description="Results appear here once tests are submitted — manually or via CI/CD ingest."
          />
        </div>
      )}

      {!isLoading && filtered.length === 0 && results.length > 0 && (
        <div className="card">
          <EmptyState icon="🔍" title="No results match your filter" />
        </div>
      )}

      {filtered.length > 0 && (
        <div style={{
          background: 'var(--surface-base)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--border-radius-lg)', overflow: 'hidden',
        }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '40px 1fr 90px 60px 80px 16px',
            gap: 8, padding: '8px 16px',
            background: 'var(--gray-50)', borderBottom: '1px solid var(--border-color)',
            fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-400)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <div></div>
            <div>Test</div>
            <div>Type</div>
            <div style={{ textAlign: 'right' }}>Duration</div>
            <div style={{ textAlign: 'right' }}>Time</div>
            <div></div>
          </div>

          {filtered.map((result, idx) => {
            const cfg = STATUS_CONFIG[result.status] ?? STATUS_CONFIG['skipped'];
            const isOpen = expanded.has(result.id);
            const title = result.testCase?.title ?? `Test #${result.testCaseId.slice(-6)}`;
            const hasDetail = !!(
              result.errorMessage || result.stackTrace ||
              (Array.isArray(result.stepsLog) && result.stepsLog.length > 0) ||
              (result.attachments?.length ?? 0) > 0
            );

            return (
              <div
                key={result.id}
                style={{ borderBottom: idx < filtered.length - 1 ? '1px solid var(--border-color)' : 'none' }}
              >
                <div
                  onClick={() => hasDetail && toggleExpand(result.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '40px 1fr 90px 60px 80px 16px',
                    gap: 8, padding: '11px 16px', alignItems: 'center',
                    cursor: hasDetail ? 'pointer' : 'default',
                    background: isOpen ? 'var(--gray-50)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (hasDetail && !isOpen) (e.currentTarget as HTMLElement).style.background = 'var(--gray-50)'; }}
                  onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: cfg.bg, border: `1px solid ${cfg.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.8125rem', fontWeight: 700, color: cfg.color,
                  }}>
                    {cfg.icon}
                  </div>

                  <div style={{ overflow: 'hidden' }}>
                    <div style={{
                      fontSize: '0.9rem', fontWeight: 500, color: 'var(--gray-900)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {title}
                    </div>
                    {result.errorMessage && !isOpen && (
                      <div style={{
                        fontSize: '0.8125rem', color: 'var(--color-danger)', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {result.errorMessage}
                      </div>
                    )}
                    {result.failureNote && !isOpen && (
                      <div style={{
                        fontSize: '0.8125rem', color: cfg.color, marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        ↳ {result.failureNote}
                      </div>
                    )}
                  </div>

                  <div>
                    {result.testCase?.type && (
                      <span style={{
                        fontSize: '0.75rem', padding: '2px 7px', borderRadius: 4,
                        background: 'var(--gray-100)', color: 'var(--gray-500)', fontFamily: 'monospace',
                      }}>
                        {result.testCase.type}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', textAlign: 'right' }}>
                    {fmtDuration(result.durationMs)}
                  </div>

                  <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', textAlign: 'right' }}>
                    {fmtTime(result.executedAt)}
                  </div>

                  <div style={{
                    fontSize: '0.75rem', color: 'var(--gray-400)',
                    transform: isOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s',
                    opacity: hasDetail ? 1 : 0,
                  }}>▾</div>
                </div>

                {/* Defect row — visible on failed results only */}
                {result.status === 'fail' && (
                  <div style={{
                    padding: '6px 16px 8px 56px',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    background: result.defect ? '#FFFBEB' : 'transparent',
                  }}>
                    {result.defect ? (
                      <>
                        {/* Tracker badge */}
                        {(() => {
                          const tc = TRACKER_CONFIG[result.defect.tracker] ?? TRACKER_CONFIG.internal;
                          return (
                            <span style={{
                              padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                              color: tc.color, background: tc.bg,
                            }}>
                              {tc.label}
                            </span>
                          );
                        })()}
                        {/* Title / external ref */}
                        {result.defect.externalRef ? (
                          <a href={result.defect.externalRef} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: '0.8125rem', color: 'var(--color-primary)', fontWeight: 500, textDecoration: 'none' }}
                            onClick={e => e.stopPropagation()}
                          >
                            {result.defect.title || result.defect.externalRef} ↗
                          </a>
                        ) : (
                          <span style={{ fontSize: '0.8125rem', color: 'var(--gray-700)', fontWeight: 500 }}>
                            {result.defect.title}
                          </span>
                        )}
                        {/* Status chip */}
                        {(() => {
                          const sc = STATUS_CONFIG_DEFECT[result.defect!.status] ?? STATUS_CONFIG_DEFECT.open;
                          return (
                            <span style={{
                              padding: '2px 8px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600,
                              color: sc.color, background: sc.bg,
                            }}>
                              {sc.label}
                            </span>
                          );
                        })()}
                        {/* Actions */}
                        <button onClick={e => {
                          e.stopPropagation();
                          const d = result.defect!;
                          setEditingDefect({ defect: d, resultId: result.id });
                          setDefectStatus(d.status);
                          setDefectRef(d.externalRef ?? '');
                          setDefectNotes(d.notes ?? '');
                        }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8125rem', color: 'var(--gray-500)', padding: '2px 4px' }}>
                          Edit
                        </button>
                        <button onClick={e => { e.stopPropagation(); removeDefect.mutate(result.defect!.id); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8125rem', color: '#DC2626', padding: '2px 4px' }}>
                          Remove
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); setFilingFor(result); setDefectTitle(result.testCase?.title ?? ''); setDefectTracker('jira'); setDefectRef(''); setDefectNotes(''); setDefectError(''); }}
                        style={{
                          background: 'none', border: '1px dashed var(--border-color)', borderRadius: 5,
                          color: 'var(--gray-400)', fontSize: '0.8125rem', padding: '3px 10px', cursor: 'pointer',
                        }}
                      >
                        + File defect
                      </button>
                    )}
                  </div>
                )}

                {isOpen && hasDetail && (
                  <div style={{
                    padding: '14px 16px 16px 56px',
                    background: 'var(--gray-50)',
                    borderTop: '1px solid var(--border-color)',
                  }}>
                    {result.errorMessage && (
                      <div style={{ marginBottom: 12 }}>
                        <SectionLabel>Error</SectionLabel>
                        <div style={{
                          padding: '8px 12px', background: 'var(--color-danger-light)',
                          border: '1px solid #fecaca', borderRadius: 6,
                          fontFamily: 'monospace', fontSize: '0.8125rem',
                          color: 'var(--color-danger)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {result.errorMessage}
                        </div>
                      </div>
                    )}

                    {result.stackTrace && (
                      <div style={{ marginBottom: 12 }}>
                        <SectionLabel>Stack trace</SectionLabel>
                        <pre style={{
                          background: 'var(--gray-900)', color: '#e5e7eb',
                          padding: '10px 12px', borderRadius: 6, margin: 0,
                          fontFamily: 'monospace', fontSize: '0.8125rem', lineHeight: 1.6,
                          overflow: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap',
                        }}>
                          {result.stackTrace}
                        </pre>
                      </div>
                    )}

                    {Array.isArray(result.stepsLog) && result.stepsLog.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <SectionLabel>Steps</SectionLabel>
                        {(result.stepsLog as Array<{
                          order: number; status: string; action?: string; actual?: string;
                        }>).map((step, i) => {
                          const scfg = STATUS_CONFIG[step.status] ?? STATUS_CONFIG['skipped'];
                          return (
                            <div key={i} style={{
                              display: 'flex', gap: 8, alignItems: 'flex-start',
                              padding: '6px 0', borderBottom: '1px solid var(--border-color)',
                              fontSize: '0.875rem',
                            }}>
                              <span style={{ color: scfg.color, width: 16, fontWeight: 700, flexShrink: 0 }}>
                                {scfg.icon}
                              </span>
                              <span style={{ flex: 1, color: 'var(--gray-700)' }}>
                                Step {step.order}{step.action ? `: ${step.action}` : ''}
                              </span>
                              {step.actual && (
                                <span style={{ color: 'var(--gray-400)', fontSize: '0.8125rem' }}>
                                  {step.actual}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {result.attachments && result.attachments.length > 0 && (
                      <div>
                        <SectionLabel>Attachments</SectionLabel>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {result.attachments.map((att, i) =>
                            att.type === 'screenshot' ? (
                              <a key={i} href={att.url} target="_blank" rel="noopener noreferrer">
                                <img
                                  src={att.url}
                                  alt={`Screenshot ${i + 1}`}
                                  style={{
                                    width: 120, height: 80, objectFit: 'cover',
                                    borderRadius: 6, border: '1px solid var(--border-color)', cursor: 'pointer',
                                  }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.8'}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                                  onError={e => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                                />
                              </a>
                            ) : (
                              <a
                                key={i} href={att.url} target="_blank" rel="noopener noreferrer"
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 6,
                                  padding: '6px 10px', borderRadius: 6,
                                  border: '1px solid var(--border-color)',
                                  background: 'var(--surface-base)',
                                  color: 'var(--color-primary)', fontSize: '0.8125rem', textDecoration: 'none',
                                }}
                              >
                                📎 {att.type}
                              </a>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* ── File defect modal ── */}
      <Modal
        open={!!filingFor}
        onClose={() => setFilingFor(null)}
        title="File defect"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFilingFor(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={fileDefect.isPending}
              onClick={() => {
                setDefectError('');
                if (!defectTitle.trim()) { setDefectError('Title is required'); return; }
                fileDefect.mutate({
                  title:       defectTitle.trim(),
                  tracker:     defectTracker,
                  externalRef: defectRef.trim() || undefined,
                  notes:       defectNotes.trim() || undefined,
                });
              }}
            >
              File defect
            </Button>
          </>
        }
      >
        {defectError && <div style={{ marginBottom: 12 }}><Alert type="error">{defectError}</Alert></div>}
        <Input
          label="Title"
          value={defectTitle}
          onChange={e => setDefectTitle(e.target.value)}
          placeholder="Brief description of the defect"
          autoFocus
        />
        <Select
          label="Tracker"
          value={defectTracker}
          onChange={e => setDefectTracker(e.target.value)}
          options={[
            { value: 'jira',     label: 'Jira' },
            { value: 'github',   label: 'GitHub' },
            { value: 'linear',   label: 'Linear' },
            { value: 'internal', label: 'Internal (no external tracker)' },
          ]}
        />
        <Input
          label="Ticket URL (optional)"
          value={defectRef}
          onChange={e => setDefectRef(e.target.value)}
          placeholder="https://yourcompany.atlassian.net/browse/PROJ-123"
        />
        <Input
          label="Notes (optional)"
          value={defectNotes}
          onChange={e => setDefectNotes(e.target.value)}
          placeholder="Steps to reproduce, affected env, etc."
        />
      </Modal>

      {/* ── Edit defect modal ── */}
      <Modal
        open={!!editingDefect}
        onClose={() => setEditingDefect(null)}
        title="Update defect"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingDefect(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={updateDefect.isPending}
              onClick={() => {
                if (!editingDefect) return;
                updateDefect.mutate({
                  status:      defectStatus,
                  externalRef: defectRef.trim() || undefined,
                  notes:       defectNotes.trim() || undefined,
                });
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Select
          label="Status"
          value={defectStatus}
          onChange={e => setDefectStatus(e.target.value)}
          options={[
            { value: 'open',        label: 'Open' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'resolved',    label: 'Resolved' },
            { value: 'closed',      label: 'Closed' },
            { value: 'wont_fix',    label: "Won't fix" },
          ]}
        />
        <Input
          label="Ticket URL (optional)"
          value={defectRef}
          onChange={e => setDefectRef(e.target.value)}
          placeholder="https://yourcompany.atlassian.net/browse/PROJ-123"
        />
        <Input
          label="Notes (optional)"
          value={defectNotes}
          onChange={e => setDefectNotes(e.target.value)}
          placeholder="Any additional context"
        />
      </Modal>

      {/* Executive summary edit modal */}
      <Modal
        open={showSummaryModal}
        onClose={() => setShowSummaryModal(false)}
        title="Executive summary"
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setShowSummaryModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await exportResultsPdf(
                    {
                      name:        runDetail?.name ?? runName,
                      env:         runDetail?.env ?? '',
                      source:      runDetail?.source ?? '',
                      startedAt:   runDetail?.startedAt ?? new Date().toISOString(),
                      endedAt:     runDetail?.endedAt,
                      reporter:    runDetail?.reporterName ?? undefined,
                      projectName: runDetail?.projectName,
                    },
                    results as Parameters<typeof exportResultsPdf>[1],
                    { total, passed, failed, blocked, skipped, passRate },
                    { executiveSummary: summaryText }
                  );
                  setShowSummaryModal(false);
                } finally {
                  setExporting(false);
                }
              }}
            >
              ↓ Export PDF
            </Button>
          </div>
        }
      >
        <p style={{ margin: '0 0 10px', fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
          Review and edit the auto-generated summary before exporting.
        </p>
        <textarea
          value={summaryText}
          onChange={e => setSummaryText(e.target.value)}
          rows={7}
          style={{
            width: '100%', padding: '10px 12px',
            border: '1px solid var(--border-color)', borderRadius: 6,
            fontSize: '0.875rem', lineHeight: 1.6, resize: 'vertical', outline: 'none',
            background: 'var(--surface-base)', color: 'var(--gray-900)', boxSizing: 'border-box',
          }}
        />
      </Modal>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-500)',
      textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
    }}>
      {children}
    </div>
  );
}
