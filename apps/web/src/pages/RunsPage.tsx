import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Modal, Input, Select, Alert, EmptyState, Spinner, StatCard } from '../components/shared/ui';
import { ManualRunner } from '../components/runner/ManualRunner';
import { ExploratoryRunner } from '../components/runner/ExploratoryRunner';
import { ApiRunner } from '../components/runner/ApiRunner';
import { AutoResultsViewer } from '../components/runner/AutoResultsViewer';
import { JUnitIngest } from '../components/runner/JUnitIngest';
import { PerfIngest } from '../components/runner/PerfIngest';
import { api } from '../lib/api';
import type { TestRun, TestCase, TestType } from '@qaforge/types';

type View = 'list' | 'create' | 'pick-cases' | 'run' | 'results' | 'junit-ingest' | 'perf-ingest';

const TYPE_LABELS: Record<TestType, string> = {
  manual: 'Manual', functional: 'Functional', ui_auto: 'UI Auto',
  api: 'API', perf: 'Perf', exploratory: 'Exploratory',
};

export function RunsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const [view, setView] = useState<View>('list');
  const [activeRun, setActiveRun] = useState<TestRun | null>(null);
  const [activeCase, setActiveCase] = useState<TestCase | null>(null);
  const [viewingRun, setViewingRun] = useState<TestRun | null>(null);

  // Create run form state
  const [runName, setRunName] = useState('');
  const [runEnv, setRunEnv] = useState('staging');
  const [createError, setCreateError] = useState('');

  // Case picker state
  const [pendingRun, setPendingRun] = useState<TestRun | null>(null);
  const [selectedCases, setSelectedCases] = useState<TestCase[]>([]);

  const { data: runsData, isLoading: loadingRuns } = useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => api.get<{ runs: TestRun[] }>(`projects/${projectId}/runs`),
    enabled: !!projectId,
  });

  const { data: casesData, isLoading: loadingCases } = useQuery({
    queryKey: ['cases', projectId],
    queryFn: () => api.get<{ data: TestCase[] }>(`projects/${projectId}/cases`),
    enabled: !!projectId && view === 'pick-cases',
  });

  const createRun = useMutation({
    mutationFn: (body: { name: string; env: string; source: string }) =>
      api.post<TestRun>(`projects/${projectId}/runs`, body),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      setPendingRun(run);
      setSelectedCases([]);
      setView('pick-cases');
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const runs = runsData?.runs ?? [];
  const cases = casesData?.data ?? [];

  function handleCreateRun() {
    setCreateError('');
    if (!runName.trim()) { setCreateError('Run name is required'); return; }
    createRun.mutate({ name: runName.trim(), env: runEnv, source: 'manual' });
  }


  function launchCase(tc: TestCase) {
    setActiveCase(tc);
    setActiveRun(pendingRun);
    setView('run');
  }

  function handleRunComplete() {
    if (activeCase) setSelectedCases(prev => [...prev, activeCase]);
    setView('pick-cases');
    setActiveCase(null);
  }

  // ── Run view ────────────────────────────────────────────────
  if (view === 'run' && activeRun && activeCase) {
    const isExploratory = activeCase.type === 'exploratory';
    const isApi = activeCase.type === 'api';
    return (
      <AppLayout>
        <div style={{
          height: 'calc(100vh - 56px)',
          background: 'var(--surface-base)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--border-radius-lg)',
          overflow: 'hidden',
        }}>
          {isExploratory ? (
            <ExploratoryRunner
              projectId={projectId!}
              runId={activeRun.id}
              testCase={activeCase}
              onComplete={handleRunComplete}
              onCancel={() => setView('pick-cases')}
            />
          ) : isApi ? (
            <ApiRunner
              projectId={projectId!}
              runId={activeRun.id}
              testCase={activeCase}
              onComplete={handleRunComplete}
              onCancel={() => setView('pick-cases')}
            />
          ) : (
            <ManualRunner
              projectId={projectId!}
              runId={activeRun.id}
              testCase={activeCase}
              onComplete={handleRunComplete}
              onCancel={() => setView('pick-cases')}
            />
          )}
        </div>
      </AppLayout>
    );
  }

  // ── Results view ────────────────────────────────────────────
  if (view === 'results' && viewingRun) {
    return (
      <AppLayout title="Run results">
        <AutoResultsViewer
          projectId={projectId!}
          runId={viewingRun.id}
          runName={viewingRun.name}
          onBack={() => { setView('list'); setViewingRun(null); }}
        />
      </AppLayout>
    );
  }

  // ── JUnit XML ingest view ───────────────────────────────────
  if (view === 'junit-ingest' && pendingRun) {
    return (
      <AppLayout>
        <div style={{
          maxWidth: 720, margin: '0 auto',
          background: 'var(--surface-base)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--border-radius-lg)', overflow: 'hidden',
          height: 'calc(100vh - 112px)',
        }}>
          <JUnitIngest
            projectId={projectId!}
            runId={pendingRun.id}
            onDone={() => { setViewingRun(pendingRun); setView('results'); }}
            onCancel={() => setView('pick-cases')}
          />
        </div>
      </AppLayout>
    );
  }

  // ── Performance ingest view ─────────────────────────────────
  if (view === 'perf-ingest' && pendingRun) {
    return (
      <AppLayout>
        <div style={{
          maxWidth: 720, margin: '0 auto',
          background: 'var(--surface-base)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--border-radius-lg)', overflow: 'hidden',
          height: 'calc(100vh - 112px)',
        }}>
          <PerfIngest
            projectId={projectId!}
            runId={pendingRun.id}
            onDone={() => { setViewingRun(pendingRun); setView('results'); }}
            onCancel={() => setView('pick-cases')}
          />
        </div>
      </AppLayout>
    );
  }

  // ── Case picker view ────────────────────────────────────────
  if (view === 'pick-cases' && pendingRun) {
    const executable = cases.filter(tc =>
      ['manual', 'functional', 'exploratory', 'api'].includes(tc.type)
    );
    const remaining = executable.filter(tc =>
      !selectedCases.find(c => c.id === tc.id)
    );

    return (
      <AppLayout title={`Run: ${pendingRun.name}`}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>

          {/* Run info */}
          <div style={{
            background: 'var(--color-primary-light)', border: '1px solid #bfdbfe',
            borderRadius: 'var(--border-radius-lg)', padding: '14px 18px', marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{pendingRun.name}</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', marginTop: 2 }}>
                  {pendingRun.env} · {selectedCases.length} case{selectedCases.length !== 1 ? 's' : ''} executed so far
                </div>
              </div>
              <Button
                variant="secondary" size="sm"
                onClick={async () => {
                  await api.put(`projects/${projectId}/runs/${pendingRun.id}/close`);
                  qc.invalidateQueries({ queryKey: ['runs', projectId] });
                  setView('list');
                  setPendingRun(null);
                  setSelectedCases([]);
                  setRunName('');
                }}
              >
                Close run
              </Button>
            </div>
            {/* Ingest shortcuts */}
            <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid #bfdbfe' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', alignSelf: 'center', marginRight: 4 }}>
                Ingest from CI:
              </span>
              <Button variant="secondary" size="sm" onClick={() => setView('junit-ingest')}>
                📄 JUnit XML
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setView('perf-ingest')}>
                ⚡ Performance metrics
              </Button>
            </div>
          </div>

          {/* Already run */}
          {selectedCases.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">Executed ({selectedCases.length})</span>
              </div>
              {selectedCases.map(tc => (
                <div key={tc.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 18px', borderBottom: '1px solid var(--border-color)',
                }}>
                  <span style={{ fontSize: '1rem' }}>✓</span>
                  <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--gray-700)' }}>{tc.title}</span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
                    {TYPE_LABELS[tc.type as TestType]}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => launchCase(tc)}
                    style={{ fontSize: '0.8125rem' }}>Re-run</Button>
                </div>
              ))}
            </div>
          )}

          {/* Remaining cases */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                {remaining.length > 0 ? `Ready to execute (${remaining.length})` : 'All cases executed'}
              </span>
            </div>

            {loadingCases && <div style={{ padding: 24 }}><Spinner /></div>}

            {!loadingCases && executable.length === 0 && (
              <EmptyState
                icon="✓"
                title="No executable cases"
                description="Add manual, functional, or exploratory test cases to this project first."
              />
            )}

            {remaining.map(tc => (
              <div key={tc.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 18px', borderBottom: '1px solid var(--border-color)',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, color: 'var(--gray-900)', fontSize: '0.9rem' }}>{tc.title}</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
                    {TYPE_LABELS[tc.type as TestType]} · {tc.priority.toUpperCase()}
                  </div>
                </div>
                <Button variant="primary" size="sm" onClick={() => launchCase(tc)}>
                  {tc.type === 'exploratory' ? '▶ Start session' : tc.type === 'api' ? '▶ Run API' : '▶ Run'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  // ── Runs list view ──────────────────────────────────────────
  return (
    <AppLayout
      title="Runs"
      actions={<Button variant="primary" size="sm" onClick={() => { setRunName(''); setCreateError(''); setView('create'); }}>+ New run</Button>}
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Stats */}
        <div className="grid-4" style={{ marginBottom: 24 }}>
          <StatCard label="Total runs" value={runs.length} />
          <StatCard label="Open" value={runs.filter(r => r.status === 'open').length}
            color={runs.filter(r => r.status === 'open').length > 0 ? 'var(--color-warning)' : undefined} />
          <StatCard label="Closed" value={runs.filter(r => r.status === 'closed').length}
            color="var(--color-success)" />
          <StatCard label="This week" value={
            runs.filter(r => {
              const d = new Date(r.startedAt);
              const now = new Date();
              const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
              return diff <= 7;
            }).length
          } />
        </div>

        {/* Runs table */}
        <div className="card">
          {loadingRuns && <div style={{ padding: 32 }}><Spinner size="lg" /></div>}

          {!loadingRuns && runs.length === 0 && (
            <EmptyState
              icon="▶"
              title="No runs yet"
              description="Create your first run to start executing test cases."
              action={<Button variant="primary" onClick={() => setView('create')}>Create first run</Button>}
            />
          )}

          {runs.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Environment</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.id}>
                    <td style={{ fontWeight: 500 }}>{run.name}</td>
                    <td>
                      <span style={{
                        background: 'var(--gray-100)', color: 'var(--gray-600)',
                        padding: '2px 8px', borderRadius: 4, fontSize: '0.8125rem', fontFamily: 'monospace',
                      }}>{run.env}</span>
                    </td>
                    <td style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>{run.source}</td>
                    <td>
                      <span style={{
                        padding: '2px 10px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 600,
                        background: run.status === 'closed' ? 'var(--color-success-light)' : 'var(--color-warning-light)',
                        color: run.status === 'closed' ? 'var(--color-success)' : 'var(--color-warning)',
                      }}>{run.status}</span>
                    </td>
                    <td style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>
                      {new Date(run.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>
                      {run.status === 'open' && (
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => { setPendingRun(run); setSelectedCases([]); setView('pick-cases'); }}
                          style={{ fontSize: '0.8125rem' }}
                        >
                          Continue ▶
                        </Button>
                      )}
                      {run.status === 'closed' && (
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => { setViewingRun(run); setView('results'); }}
                          style={{ fontSize: '0.8125rem' }}
                        >
                          View results
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create run modal */}
      <Modal
        open={view === 'create'}
        onClose={() => setView('list')}
        title="New run"
        footer={
          <>
            <Button variant="secondary" onClick={() => setView('list')}>Cancel</Button>
            <Button variant="primary" loading={createRun.isPending} onClick={handleCreateRun}>
              Create run
            </Button>
          </>
        }
      >
        {createError && <div style={{ marginBottom: 14 }}><Alert type="error">{createError}</Alert></div>}
        <Input
          label="Run name"
          value={runName}
          onChange={e => setRunName(e.target.value)}
          placeholder="e.g. Regression — Sprint 12"
          autoFocus
        />
        <Select
          label="Environment"
          value={runEnv}
          onChange={e => setRunEnv(e.target.value)}
          options={[
            { value: 'staging', label: 'Staging' },
            { value: 'production', label: 'Production' },
            { value: 'local', label: 'Local' },
            { value: 'dev', label: 'Dev' },
          ]}
        />
      </Modal>
    </AppLayout>
  );
}
