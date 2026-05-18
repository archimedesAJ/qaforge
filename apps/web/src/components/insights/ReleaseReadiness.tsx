import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Alert, Spinner, EmptyState } from '../shared/ui';
import { api } from '../../lib/api';
import type { TestRun, Priority } from '@qaforge/types';

interface RunResult {
  id: number;
  status: string;
  testCase?: { title: string; type: string; priority: string };
  errorMessage?: string;
  failureNote?: string;
}

interface ReleaseReadinessProps {
  projectId: string;
}

const PRIORITY_CONFIG: Record<Priority, { color: string; bg: string; label: string }> = {
  p0: { color: '#991b1b', bg: '#fee2e2', label: 'P0' },
  p1: { color: '#92400e', bg: '#fef3c7', label: 'P1' },
  p2: { color: '#1e40af', bg: '#dbeafe', label: 'P2' },
  p3: { color: '#374151', bg: '#f3f4f6', label: 'P3' },
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  pass:    { color: 'var(--color-success)', bg: 'var(--color-success-light)', icon: '✓' },
  fail:    { color: 'var(--color-danger)',  bg: 'var(--color-danger-light)',  icon: '✕' },
  blocked: { color: 'var(--color-warning)', bg: 'var(--color-warning-light)', icon: '⊘' },
  skipped: { color: 'var(--gray-400)',      bg: 'var(--gray-50)',             icon: '–' },
};

export function ReleaseReadiness({ projectId }: ReleaseReadinessProps) {
  const qc = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [signoffNote, setSignoffNote] = useState('');
  const [signoffError, setSignoffError] = useState('');
  const [signedOff, setSignedOff] = useState(false);

  // Load closed runs
  const { data: runsData, isLoading: loadingRuns } = useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => api.get<{ runs: TestRun[] }>(`projects/${projectId}/runs`),
    enabled: !!projectId,
  });

  const closedRuns = (runsData?.runs ?? []).filter(r => r.status === 'closed');

  // Auto-select latest closed run
  const runId = selectedRun || closedRuns[0]?.id || '';

  // Load results for selected run
  const { data: resultsData, isLoading: loadingResults } = useQuery({
    queryKey: ['run-results', runId],
    queryFn: () => api.get<{ results: RunResult[] }>(`projects/${projectId}/runs/${runId}/results`),
    enabled: !!runId,
  });

  const results = resultsData?.results ?? [];

  // ── Gate computation ──────────────────────────────────────
  const p0Results = results.filter(r => r.testCase?.priority === 'p0');
  const p1Results = results.filter(r => r.testCase?.priority === 'p1');

  const p0Failures    = p0Results.filter(r => r.status === 'fail' || r.status === 'blocked');
  const p1Total       = p1Results.length;
  const p1Passed      = p1Results.filter(r => r.status === 'pass').length;
  const p1PassRate    = p1Total > 0 ? Math.round((p1Passed / p1Total) * 100) : 100;
  const unlinkedP0    = p0Failures.filter(r => !r.failureNote);

  const gates = [
    {
      id: 'p0',
      label: 'All P0 cases pass',
      passing: p0Failures.length === 0,
      detail: p0Failures.length > 0
        ? `${p0Failures.length} P0 failure${p0Failures.length > 1 ? 's' : ''} blocking release`
        : 'All P0 cases passed',
    },
    {
      id: 'p1',
      label: 'P1 pass rate ≥ 90%',
      passing: p1PassRate >= 90,
      detail: p1PassRate < 90
        ? `Currently ${p1PassRate}% — need ${Math.ceil(p1Total * 0.9) - p1Passed} more passing`
        : `${p1PassRate}% — threshold met`,
    },
    {
      id: 'linked',
      label: 'All P0 failures have notes',
      passing: unlinkedP0.length === 0,
      detail: unlinkedP0.length > 0
        ? `${unlinkedP0.length} P0 failure${unlinkedP0.length > 1 ? 's' : ''} without a failure note`
        : 'All failures documented',
    },
  ];

  const allGatesPassing = gates.every(g => g.passing);
  const gatesPassing    = gates.filter(g => g.passing).length;

  // ── Filter results ────────────────────────────────────────
  const filtered = results.filter(r => {
    if (priorityFilter !== 'all' && r.testCase?.priority !== priorityFilter) return false;
    if (statusFilter   !== 'all' && r.status !== statusFilter) return false;
    return true;
  });

  // ── Sign-off ──────────────────────────────────────────────
  const signoff = useMutation({
    mutationFn: () => api.put(`projects/${projectId}/runs/${runId}/close`, { signoffNote }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      setSignedOff(true);
    },
    onError: (err: Error) => setSignoffError(err.message),
  });

  if (loadingRuns) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner size="lg" /></div>;
  }

  if (closedRuns.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon="🚀"
          title="No closed runs yet"
          description="Close a run to see release readiness gates."
        />
      </div>
    );
  }

  return (
    <div>
      {/* Run selector */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-700)' }}>Run:</label>
        <select
          className="input"
          style={{ width: 'auto', fontSize: '0.875rem', padding: '6px 10px' }}
          value={runId}
          onChange={e => { setSelectedRun(e.target.value); setSignedOff(false); setSignoffNote(''); }}
        >
          {closedRuns.map(r => (
            <option key={r.id} value={r.id}>
              {r.name} — {r.env} — {new Date(r.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </option>
          ))}
        </select>

        {/* Overall verdict badge */}
        <div style={{
          marginLeft: 'auto',
          padding: '6px 16px', borderRadius: 20, fontWeight: 600, fontSize: '0.9rem',
          background: signedOff ? 'var(--color-success-light)' : allGatesPassing ? 'var(--color-success-light)' : 'var(--color-danger-light)',
          color: signedOff ? 'var(--color-success)' : allGatesPassing ? 'var(--color-success)' : 'var(--color-danger)',
          border: `1px solid ${signedOff || allGatesPassing ? '#bbf7d0' : '#fecaca'}`,
        }}>
          {signedOff ? '✓ Signed off' : allGatesPassing ? '✓ Ready to release' : '✕ Not ready'}
        </div>
      </div>

      {/* Gate checks */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">Release gates</span>
          <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
            {gatesPassing} of {gates.length} passing
          </span>
        </div>
        {gates.map((gate, i) => (
          <div key={gate.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 18px',
            borderBottom: i < gates.length - 1 ? '1px solid var(--border-color)' : 'none',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: gate.passing ? 'var(--color-success-light)' : 'var(--color-danger-light)',
              border: `1px solid ${gate.passing ? '#bbf7d0' : '#fecaca'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.875rem', fontWeight: 700,
              color: gate.passing ? 'var(--color-success)' : 'var(--color-danger)',
            }}>
              {gate.passing ? '✓' : '✕'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--gray-900)' }}>
                {gate.label}
              </div>
              <div style={{
                fontSize: '0.8125rem', marginTop: 2,
                color: gate.passing ? 'var(--color-success)' : 'var(--color-danger)',
              }}>
                {gate.detail}
              </div>
            </div>
            <span style={{
              fontSize: '0.8125rem', fontWeight: 600, padding: '3px 10px', borderRadius: 20,
              background: gate.passing ? 'var(--color-success-light)' : 'var(--color-danger-light)',
              color: gate.passing ? 'var(--color-success)' : 'var(--color-danger)',
            }}>
              {gate.passing ? 'Pass' : 'Fail'}
            </span>
          </div>
        ))}
      </div>

      {/* Results table */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">Test results</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="input"
              style={{ width: 'auto', fontSize: '0.8125rem', padding: '5px 8px' }}
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
            >
              <option value="all">All priorities</option>
              {(['p0','p1','p2','p3'] as Priority[]).map(p => (
                <option key={p} value={p}>{p.toUpperCase()}</option>
              ))}
            </select>
            <select
              className="input"
              style={{ width: 'auto', fontSize: '0.8125rem', padding: '5px 8px' }}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              {['pass','fail','blocked','skipped'].map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        {loadingResults && <div style={{ padding: 24 }}><Spinner /></div>}

        {!loadingResults && filtered.length === 0 && (
          <EmptyState icon="✓" title="No results match your filter" />
        )}

        {filtered.length > 0 && (
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>Priority</th>
                <th>Test case</th>
                <th style={{ width: 100 }}>Type</th>
                <th style={{ width: 90 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const pCfg = PRIORITY_CONFIG[(r.testCase?.priority as Priority) ?? 'p3'];
                const sCfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG['skipped'];
                return (
                  <tr key={r.id}>
                    <td>
                      <span style={{
                        fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                        background: pCfg.bg, color: pCfg.color,
                      }}>
                        {pCfg.label}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                        {r.testCase?.title ?? `Test #${r.id}`}
                      </div>
                      {r.failureNote && (
                        <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
                          {r.failureNote}
                        </div>
                      )}
                      {r.errorMessage && !r.failureNote && (
                        <div style={{ fontSize: '0.8125rem', color: 'var(--color-danger)', marginTop: 2 }}>
                          {r.errorMessage}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.75rem', padding: '2px 7px', borderRadius: 4,
                        background: 'var(--gray-100)', color: 'var(--gray-500)', fontFamily: 'monospace',
                      }}>
                        {r.testCase?.type ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: '0.8125rem', fontWeight: 600,
                        padding: '3px 10px', borderRadius: 20,
                        background: sCfg.bg, color: sCfg.color,
                      }}>
                        {sCfg.icon} {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Sign-off section */}
      {!signedOff && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Sign-off</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            {!allGatesPassing && (
              <div style={{
                padding: '10px 14px', background: 'var(--color-danger-light)',
                border: '1px solid #fecaca', borderRadius: 8, marginBottom: 14,
                fontSize: '0.875rem', color: 'var(--color-danger)',
              }}>
                Release cannot be signed off until all gates pass. Fix P0 failures first.
              </div>
            )}

            {allGatesPassing && (
              <div style={{
                padding: '10px 14px', background: 'var(--color-success-light)',
                border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 14,
                fontSize: '0.875rem', color: 'var(--color-success)',
              }}>
                All gates passing. This run is ready to sign off.
              </div>
            )}

            <textarea
              className="input"
              rows={2}
              placeholder="Sign-off note — add any P2/P3 waivers or release context here (optional)"
              value={signoffNote}
              onChange={e => setSignoffNote(e.target.value)}
              style={{ marginBottom: 12, resize: 'none' }}
            />

            {signoffError && <div style={{ marginBottom: 10 }}><Alert type="error">{signoffError}</Alert></div>}

            <Button
              variant="primary"
              disabled={!allGatesPassing}
              loading={signoff.isPending}
              onClick={() => signoff.mutate()}
            >
              ✓ Sign off release
            </Button>
          </div>
        </div>
      )}

      {signedOff && (
        <div style={{
          padding: '16px 18px', background: 'var(--color-success-light)',
          border: '1px solid #bbf7d0', borderRadius: 'var(--border-radius-lg)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: '1.5rem' }}>✓</span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-success)' }}>Release signed off</div>
            {signoffNote && (
              <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginTop: 2 }}>{signoffNote}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
