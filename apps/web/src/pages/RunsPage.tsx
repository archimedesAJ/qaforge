import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Modal, Input, Select, Alert, EmptyState, Spinner, StatCard } from '../components/shared/ui';
import { SuiteTree } from '../components/editor/SuiteTree';
import { ManualRunner } from '../components/runner/ManualRunner';
import { ExploratoryRunner } from '../components/runner/ExploratoryRunner';
import { ApiRunner } from '../components/runner/ApiRunner';
import { AutoResultsViewer } from '../components/runner/AutoResultsViewer';
import { JUnitIngest } from '../components/runner/JUnitIngest';
import { PerfIngest } from '../components/runner/PerfIngest';
import { api } from '../lib/api';
import { useProjectRole } from '../hooks/useProjectRole';
import type { TestRun, TestCase, TestType } from '@qaforge/types';

type View = 'list' | 'create' | 'select-cases' | 'execute' | 'results' | 'run' | 'junit-ingest' | 'perf-ingest';

interface RunCase {
  id: number;
  runId: string;
  testCaseId: string;
  status: string;
  testCase: { id: string; title: string; type: string; priority: string; suiteId: string | null; steps?: unknown; tags?: unknown };
}

const TYPE_LABELS: Record<TestType, string> = {
  manual: 'Manual', functional: 'Functional', ui_auto: 'UI Auto',
  api: 'API', perf: 'Perf', exploratory: 'Exploratory',
};

const STATUS_CHIP: Record<string, { label: string; bg: string; color: string }> = {
  not_run:  { label: 'Not run',  bg: 'var(--gray-100)',              color: 'var(--gray-500)'    },
  pass:     { label: 'Pass',     bg: 'var(--color-success-light)',   color: 'var(--color-success)' },
  fail:     { label: 'Fail',     bg: '#fee2e2',                      color: '#dc2626'             },
  blocked:  { label: 'Blocked',  bg: '#fef3c7',                      color: '#d97706'             },
  skipped:  { label: 'Skipped',  bg: 'var(--gray-100)',              color: 'var(--gray-500)'    },
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
  const [runPlanId, setRunPlanId] = useState('');
  const [createError, setCreateError] = useState('');

  // Case picker / execute state
  const [pendingRun, setPendingRun] = useState<TestRun | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
  const [pickerSuiteId, setPickerSuiteId] = useState<string | null>(null);
  const [caseSearch, setCaseSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { isEditor, canExecute } = useProjectRole(projectId);

  // ── Queries ──────────────────────────────────────────────────

  const { data: runsData, isLoading: loadingRuns } = useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => api.get<{ runs: TestRun[] }>(`projects/${projectId}/runs`),
    enabled: !!projectId,
  });

  const { data: plansData } = useQuery({
    queryKey: ['plans', projectId],
    queryFn: () => api.get<{ plans: { id: string; name: string; milestone: string | null; status: string }[] }>(`projects/${projectId}/plans`),
    enabled: !!projectId && view === 'create',
  });

  // Cases for selection (shown in select-cases view)
  const { data: allCasesData, isLoading: loadingCases } = useQuery({
    queryKey: ['cases', projectId, pickerSuiteId, 'selector'],
    queryFn: () => {
      const qs = pickerSuiteId ? `?suiteId=${encodeURIComponent(pickerSuiteId)}` : '';
      return api.get<{ data: TestCase[] }>(`projects/${projectId}/cases${qs}`);
    },
    enabled: !!projectId && view === 'select-cases',
  });

  // Assigned run cases (shown in execute view)
  const { data: runCasesData, isLoading: loadingRunCases } = useQuery({
    queryKey: ['run-cases', pendingRun?.id],
    queryFn: () => api.get<{ runCases: RunCase[] }>(`projects/${projectId}/runs/${pendingRun!.id}/cases`),
    enabled: !!pendingRun && view === 'execute',
  });

  // ── Mutations ────────────────────────────────────────────────

  const createRun = useMutation({
    mutationFn: (body: { name: string; env: string; source: string; caseIds: string[] }) =>
      api.post<TestRun>(`projects/${projectId}/runs`, body),
    onSuccess: async (run) => {
      if (runPlanId) {
        await api.post(`projects/${projectId}/plans/${runPlanId}/runs/${run.id}`, {});
        qc.invalidateQueries({ queryKey: ['plans', projectId] });
      }
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      setPendingRun(run);
      setView('execute');
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const markStatus = useMutation({
    mutationFn: ({ caseId, status }: { caseId: string; status: string }) =>
      api.put(`projects/${projectId}/runs/${pendingRun!.id}/cases/${caseId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run-cases', pendingRun?.id] });
    },
  });

  const runs     = runsData?.runs ?? [];
  const allCases = allCasesData?.data ?? [];
  const runCases = runCasesData?.runCases ?? [];

  // Derived execute view stats
  const doneCount  = runCases.filter(rc => rc.status !== 'not_run').length;
  const totalCount = runCases.length;
  const pct        = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // Filtered cases in select-cases view
  const filteredCases = allCases.filter(tc =>
    !caseSearch || tc.title.toLowerCase().includes(caseSearch.toLowerCase())
  );

  // Filtered run-cases in execute view
  const filteredRunCases = runCases.filter(rc => {
    if (pickerSuiteId && rc.testCase.suiteId !== pickerSuiteId) return false;
    if (statusFilter !== 'all' && rc.status !== statusFilter) return false;
    if (caseSearch && !rc.testCase.title.toLowerCase().includes(caseSearch.toLowerCase())) return false;
    return true;
  });

  // ── Handlers ─────────────────────────────────────────────────

  function handleCreateRun() {
    setCreateError('');
    if (!runName.trim()) { setCreateError('Run name is required'); return; }
    createRun.mutate({
      name: runName.trim(),
      env: runEnv,
      source: 'manual',
      caseIds: [...selectedCaseIds],
    });
  }

  function launchCase(tc: RunCase['testCase']) {
    setActiveCase(tc as unknown as TestCase);
    setActiveRun(pendingRun);
    setView('run');
  }

  function handleRunComplete() {
    qc.invalidateQueries({ queryKey: ['run-cases', pendingRun?.id] });
    setView('execute');
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
              onCancel={() => setView('execute')}
            />
          ) : isApi ? (
            <ApiRunner
              projectId={projectId!}
              runId={activeRun.id}
              testCase={activeCase}
              onComplete={handleRunComplete}
              onCancel={() => setView('execute')}
            />
          ) : (
            <ManualRunner
              projectId={projectId!}
              runId={activeRun.id}
              testCase={activeCase}
              onComplete={handleRunComplete}
              onCancel={() => setView('execute')}
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
            onCancel={() => setView('execute')}
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
            onCancel={() => setView('execute')}
          />
        </div>
      </AppLayout>
    );
  }

  // ── Select-cases view ───────────────────────────────────────
  if (view === 'select-cases') {
    const allSelected = filteredCases.length > 0 && filteredCases.every(tc => selectedCaseIds.has(tc.id));

    return (
      <AppLayout title={`New run: ${runName}`}>
        <div style={{
          display: 'grid', gridTemplateColumns: '210px 1fr', gap: 16,
          height: 'calc(100vh - var(--topbar-height) - 56px)',
        }}>
          {/* Left — suite sidebar */}
          <div style={{
            background: 'var(--gray-50)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--border-radius-lg)', overflowY: 'auto', padding: '10px 8px',
          }}>
            <div style={{
              fontSize: '0.6875rem', fontWeight: 600, color: 'var(--gray-400)',
              textTransform: 'uppercase', letterSpacing: '0.07em', padding: '4px 8px 8px',
            }}>
              Filter by suite
            </div>
            <SuiteTree
              projectId={projectId!}
              selectedId={pickerSuiteId}
              canManage={false}
              onSelect={setPickerSuiteId}
            />
          </div>

          {/* Right — case list */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Toolbar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              marginBottom: 12, flexShrink: 0,
            }}>
              <input
                value={caseSearch}
                onChange={e => setCaseSearch(e.target.value)}
                placeholder="Search cases…"
                style={{
                  flex: 1, padding: '7px 12px', border: '1px solid var(--border-color)',
                  borderRadius: 6, fontSize: '0.875rem', outline: 'none',
                  background: 'var(--surface-base)', color: 'var(--gray-900)',
                }}
              />
              <Button
                variant="ghost" size="sm"
                onClick={() => {
                  if (allSelected) {
                    setSelectedCaseIds(prev => {
                      const next = new Set(prev);
                      filteredCases.forEach(tc => next.delete(tc.id));
                      return next;
                    });
                  } else {
                    setSelectedCaseIds(prev => {
                      const next = new Set(prev);
                      filteredCases.forEach(tc => next.add(tc.id));
                      return next;
                    });
                  }
                }}
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </Button>
              <span style={{
                background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                padding: '3px 10px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>
                {selectedCaseIds.size} of {allCases.length} selected
              </span>
            </div>

            {/* Case table */}
            <div className="card" style={{ flex: 1, overflowY: 'auto', marginBottom: 0 }}>
              {loadingCases && <div style={{ padding: 24 }}><Spinner /></div>}
              {!loadingCases && filteredCases.length === 0 && (
                <EmptyState icon="✓" title="No cases found" description="Try a different suite or search term." />
              )}
              {filteredCases.map(tc => {
                const checked = selectedCaseIds.has(tc.id);
                return (
                  <div
                    key={tc.id}
                    onClick={() => {
                      setSelectedCaseIds(prev => {
                        const next = new Set(prev);
                        checked ? next.delete(tc.id) : next.add(tc.id);
                        return next;
                      });
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      background: checked ? 'var(--color-primary-light)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {}}
                      style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', flexShrink: 0 }}
                    />
                    <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--gray-900)', fontWeight: checked ? 500 : 400 }}>
                      {tc.title}
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
                      {TYPE_LABELS[tc.type as TestType]}
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', textTransform: 'uppercase' }}>
                      {tc.priority}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Bottom action bar */}
            <div style={{ flexShrink: 0 }}>
              {createError && (
                <div style={{ marginBottom: 10 }}>
                  <Alert type="error">{createError}</Alert>
                </div>
              )}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 0', borderTop: '1px solid var(--border-color)',
              }}>
                <Button variant="secondary" onClick={() => { setView('create'); setSelectedCaseIds(new Set()); }}>
                  ← Back
                </Button>
                <Button
                  variant="primary"
                  loading={createRun.isPending}
                  onClick={handleCreateRun}
                  disabled={selectedCaseIds.size === 0}
                >
                  Create run ({selectedCaseIds.size} selected)
                </Button>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ── Execute view ────────────────────────────────────────────
  if (view === 'execute' && pendingRun) {
    const STATUS_TABS = [
      { key: 'all',     label: 'All' },
      { key: 'not_run', label: 'Not run' },
      { key: 'pass',    label: 'Pass' },
      { key: 'fail',    label: 'Fail' },
      { key: 'blocked', label: 'Blocked' },
      { key: 'skipped', label: 'Skip' },
    ];

    return (
      <AppLayout>
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--topbar-height) - 32px)', gap: 12 }}>

          {/* Header bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
            background: 'var(--surface-base)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--border-radius-lg)', padding: '12px 18px',
          }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--gray-900)' }}>
                {pendingRun.name}
              </span>
              <span style={{
                marginLeft: 10, background: 'var(--gray-100)', color: 'var(--gray-600)',
                padding: '2px 8px', borderRadius: 4, fontSize: '0.8125rem', fontFamily: 'monospace',
              }}>
                {pendingRun.env}
              </span>
            </div>
            {/* CI ingest shortcuts */}
            {canExecute && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>Ingest from CI:</span>
                <Button variant="secondary" size="sm" onClick={() => setView('junit-ingest')}>
                  📄 JUnit XML
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setView('perf-ingest')}>
                  ⚡ Perf metrics
                </Button>
              </div>
            )}
            {isEditor && (
              <Button
                variant="secondary" size="sm"
                onClick={async () => {
                  await api.put(`projects/${projectId}/runs/${pendingRun.id}/close`);
                  qc.invalidateQueries({ queryKey: ['runs', projectId] });
                  setView('list');
                  setPendingRun(null);
                  setRunName('');
                }}
              >
                Close run
              </Button>
            )}
          </div>

          {/* Progress bar */}
          <div style={{ flexShrink: 0, padding: '0 2px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.8125rem', color: 'var(--gray-600)' }}>
              <span>{doneCount} / {totalCount} done</span>
              <span style={{ fontWeight: 600 }}>{pct}%</span>
            </div>
            <div style={{ height: 8, background: 'var(--gray-100)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${pct}%`,
                background: 'var(--color-success)', borderRadius: 99,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>

          {/* Two-column grid: sidebar + table */}
          <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 16, flex: 1, minHeight: 0 }}>

            {/* Suite sidebar */}
            <div style={{
              background: 'var(--gray-50)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--border-radius-lg)', overflowY: 'auto', padding: '10px 8px',
            }}>
              <div style={{
                fontSize: '0.6875rem', fontWeight: 600, color: 'var(--gray-400)',
                textTransform: 'uppercase', letterSpacing: '0.07em', padding: '4px 8px 8px',
              }}>
                Filter by suite
              </div>
              <SuiteTree
                projectId={projectId!}
                selectedId={pickerSuiteId}
                canManage={false}
                onSelect={setPickerSuiteId}
              />
            </div>

            {/* Cases table panel */}
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {/* Search + status filter tabs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexShrink: 0 }}>
                <input
                  value={caseSearch}
                  onChange={e => setCaseSearch(e.target.value)}
                  placeholder="Search cases…"
                  style={{
                    flex: 1, padding: '7px 12px', border: '1px solid var(--border-color)',
                    borderRadius: 6, fontSize: '0.875rem', outline: 'none',
                    background: 'var(--surface-base)', color: 'var(--gray-900)',
                  }}
                />
              </div>

              {/* Status tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexShrink: 0 }}>
                {STATUS_TABS.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    style={{
                      padding: '4px 12px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 500,
                      border: '1px solid',
                      borderColor: statusFilter === tab.key ? 'var(--color-primary)' : 'var(--border-color)',
                      background: statusFilter === tab.key ? 'var(--color-primary-light)' : 'var(--surface-base)',
                      color: statusFilter === tab.key ? 'var(--color-primary)' : 'var(--gray-600)',
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Table */}
              <div className="card" style={{ flex: 1, overflowY: 'auto' }}>
                {loadingRunCases && <div style={{ padding: 24 }}><Spinner /></div>}
                {!loadingRunCases && runCases.length === 0 && (
                  <EmptyState icon="▶" title="No cases assigned" description="This run has no assigned test cases." />
                )}
                {filteredRunCases.map(rc => {
                  const chip = STATUS_CHIP[rc.status] ?? STATUS_CHIP.not_run;
                  const canRun = ['manual', 'functional', 'api', 'exploratory'].includes(rc.testCase.type);
                  return (
                    <div key={rc.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
                    }}>
                      {/* Title */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {rc.testCase.title}
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
                          {TYPE_LABELS[rc.testCase.type as TestType] ?? rc.testCase.type} · {rc.testCase.priority.toUpperCase()}
                        </div>
                      </div>

                      {/* Status chip */}
                      <span style={{
                        padding: '2px 10px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 600,
                        background: chip.bg, color: chip.color, whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        {chip.label}
                      </span>

                      {/* Quick-mark buttons */}
                      {canExecute && (
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {([
                            { status: 'pass',    icon: '✓', title: 'Pass',    color: 'var(--color-success)' },
                            { status: 'fail',    icon: '✗', title: 'Fail',    color: '#dc2626' },
                            { status: 'blocked', icon: '⊘', title: 'Blocked', color: '#d97706' },
                            { status: 'skipped', icon: '→', title: 'Skip',    color: 'var(--gray-500)' },
                          ] as const).map(btn => (
                            <button
                              key={btn.status}
                              title={btn.title}
                              onClick={() => markStatus.mutate({ caseId: rc.testCase.id, status: btn.status })}
                              style={{
                                background: rc.status === btn.status ? btn.color : 'var(--gray-100)',
                                color: rc.status === btn.status ? '#fff' : btn.color,
                                border: `1px solid ${btn.color}`,
                                borderRadius: 4, padding: '2px 7px', fontSize: '0.875rem',
                                cursor: 'pointer', fontWeight: 600, transition: 'all 0.1s',
                              }}
                            >
                              {btn.icon}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Full runner button */}
                      {canExecute && canRun && (
                        <Button
                          variant="primary" size="sm"
                          onClick={() => launchCase(rc.testCase)}
                          style={{ flexShrink: 0, fontSize: '0.8125rem' }}
                        >
                          ▶ Run
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ── Runs list view ──────────────────────────────────────────
  return (
    <AppLayout
      title="Runs"
      actions={canExecute && <Button variant="primary" size="sm" onClick={() => { setRunName(''); setRunPlanId(''); setCreateError(''); setSelectedCaseIds(new Set()); setView('create'); }}>+ New run</Button>}
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
                      {run.status === 'open' && canExecute && (
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => { setPendingRun(run); setPickerSuiteId(null); setCaseSearch(''); setStatusFilter('all'); setView('execute'); }}
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
            <Button
              variant="primary"
              onClick={() => {
                setCreateError('');
                if (!runName.trim()) { setCreateError('Run name is required'); return; }
                setPickerSuiteId(null);
                setCaseSearch('');
                setSelectedCaseIds(new Set());
                setView('select-cases');
              }}
            >
              Next: Select cases →
            </Button>
          </>
        }
      >
        {createError && <div style={{ marginBottom: 14 }}><Alert type="error">{createError}</Alert></div>}
        <div style={{
          padding: '8px 12px', background: 'var(--color-primary-light)',
          border: '1px solid #bfdbfe', borderRadius: 6, marginBottom: 16,
          fontSize: '0.8125rem', color: 'var(--color-primary)',
        }}>
          After this step you'll select which test cases to include in the run.
        </div>
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
        <Select
          label="Add to plan (optional)"
          value={runPlanId}
          onChange={e => setRunPlanId(e.target.value)}
          options={[
            { value: '', label: '— None —' },
            ...(plansData?.plans ?? [])
              .filter(p => p.status === 'active')
              .map(p => ({ value: p.id, label: p.milestone ? `${p.name} (${p.milestone})` : p.name })),
          ]}
        />
      </Modal>
    </AppLayout>
  );
}
