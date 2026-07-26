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
import { ExploratoryRunWorkspace } from '../components/runner/ExploratoryRunWorkspace';
import { api } from '../lib/api';
import { useProjectRole } from '../hooks/useProjectRole';
import type { TestRun, TestCase, TestType } from '@qaforge/types';

type View = 'list' | 'create' | 'create-exploratory' | 'select-cases' | 'execute' | 'explore' | 'results' | 'run' | 'junit-ingest' | 'perf-ingest';

interface RunCase {
  id: number;
  runId: string;
  testCaseId: string;
  status: string;
  note?: string | null;
  testCase: { id: string; title: string; type: string; priority: string; suiteId: string | null; steps?: unknown; tags?: unknown; preconditions?: string | null };
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
  const [exploreName, setExploreName] = useState('');
  const [exploreEnv, setExploreEnv] = useState('staging');
  const [exploreCharter, setExploreCharter] = useState('');
  const [exploreArea, setExploreArea] = useState('');
  const [exploreRisk, setExploreRisk] = useState('');
  const [exploreDuration, setExploreDuration] = useState('60');

  // Case picker / execute state
  const [pendingRun, setPendingRun] = useState<TestRun | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
  const [pickerSuiteId, setPickerSuiteId] = useState<string | null>(null);
  const [caseSearch, setCaseSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showSetPicker, setShowSetPicker] = useState(false);
  const [showRenameRun, setShowRenameRun] = useState(false);
  const [renameRunName, setRenameRunName] = useState('');
  const [showAddCases, setShowAddCases] = useState(false);
  const [additionalCaseIds, setAdditionalCaseIds] = useState<Set<string>>(new Set());
  const [runUpdateError, setRunUpdateError] = useState('');

  // Inline note state (blocked / skipped / fail reason)
  const [noteInputCase, setNoteInputCase] = useState<string | null>(null);
  const [noteDraft, setNoteDraft]         = useState('');

  // Edit-in-run modal state
  const [editingRunCase, setEditingRunCase] = useState<RunCase | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPreconditions, setEditPreconditions] = useState('');
  const [editSteps, setEditSteps] = useState<Array<{ action: string; expected: string }>>([]);

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

  // Test sets for the "load from set" shortcut
  const { data: setsData } = useQuery({
    queryKey: ['sets', projectId],
    queryFn: () => api.get<{ sets: { id: string; name: string; description: string | null; caseCount: number }[] }>(`projects/${projectId}/sets`),
    enabled: !!projectId && (view === 'select-cases' || showAddCases),
  });

  // Cases for selection (shown in select-cases view) — no pagination cap
  const { data: allCasesData, isLoading: loadingCases } = useQuery({
    queryKey: ['cases', projectId, pickerSuiteId, 'selector'],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '500' });
      if (pickerSuiteId) params.set('suiteId', pickerSuiteId);
      return api.get<{ data: TestCase[] }>(`projects/${projectId}/cases?${params}`);
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

  const createExploratoryRun = useMutation({
    mutationFn: () => api.post<TestRun>(`projects/${projectId}/runs/exploratory`, {
      name: exploreName.trim(), env: exploreEnv, charter: exploreCharter.trim(),
      area: exploreArea.trim() || undefined,
      riskFocus: exploreRisk.trim() || undefined,
      plannedDurationMins: Number(exploreDuration) || undefined,
    }),
    onSuccess: run => {
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      setPendingRun(run);
      setView('explore');
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const markStatus = useMutation({
    mutationFn: ({ caseId, status, note }: { caseId: string; status: string; note?: string }) =>
      api.put(`projects/${projectId}/runs/${pendingRun!.id}/cases/${caseId}/status`, { status, note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run-cases', pendingRun?.id] });
    },
  });

  const editCaseMutation = useMutation({
    mutationFn: ({ caseId, body }: { caseId: string; body: unknown }) =>
      api.put(`projects/${projectId}/runs/${pendingRun!.id}/cases/${caseId}/edit`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run-cases', pendingRun?.id] });
      setEditingRunCase(null);
    },
  });

  const renameRun = useMutation({
    mutationFn: () => api.patch<TestRun>(`projects/${projectId}/runs/${pendingRun!.id}`, { name: renameRunName.trim() }),
    onSuccess: run => {
      setPendingRun(run); setShowRenameRun(false); setRunUpdateError('');
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
    },
    onError: (err: Error) => setRunUpdateError(err.message),
  });

  const addRunCases = useMutation({
    mutationFn: () => api.post<{ added: number }>(`projects/${projectId}/runs/${pendingRun!.id}/cases`, { caseIds: [...additionalCaseIds] }),
    onSuccess: () => {
      setShowAddCases(false); setAdditionalCaseIds(new Set()); setRunUpdateError('');
      qc.invalidateQueries({ queryKey: ['run-cases', pendingRun?.id] });
    },
    onError: (err: Error) => setRunUpdateError(err.message),
  });

  const runs     = runsData?.runs ?? [];
  const allCases = allCasesData?.data ?? [];
  const runCases = runCasesData?.runCases ?? [];
  const assignedCaseIds = new Set(runCases.map(runCase => runCase.testCaseId));
  const availableAdditionalCases = allCases.filter(testCase => !assignedCaseIds.has(testCase.id) && (!caseSearch || testCase.title.toLowerCase().includes(caseSearch.toLowerCase())));

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
    if (activeRun?.source === 'exploratory') {
      qc.invalidateQueries({ queryKey: ['exploratory-run', activeRun.id] });
      setView('explore');
    } else {
      setView('execute');
    }
    setActiveCase(null);
  }

  function openEditModal(rc: RunCase) {
    setEditingRunCase(rc);
    setEditTitle(rc.testCase.title);
    setEditPreconditions(rc.testCase.preconditions ?? '');
    const isStepType = ['manual', 'functional'].includes(rc.testCase.type);
    if (isStepType) {
      const raw = Array.isArray(rc.testCase.steps) ? rc.testCase.steps as Record<string, unknown>[] : [];
      setEditSteps(raw.map(s => ({
        action:   typeof s.action   === 'string' ? s.action   : '',
        expected: typeof s.expected === 'string' ? s.expected : '',
      })));
    } else {
      setEditSteps([]);
    }
  }

  function handleEditSave() {
    if (!editingRunCase || editCaseMutation.isPending) return;
    const isStepType = ['manual', 'functional'].includes(editingRunCase.testCase.type);
    const body: Record<string, unknown> = {
      title: editTitle.trim(),
      preconditions: editPreconditions.trim() || null,
    };
    if (isStepType) {
      body.steps = editSteps
        .filter(s => s.action.trim())
        .map((s, i) => ({ order: i + 1, action: s.action.trim(), expected: s.expected.trim() }));
    }
    editCaseMutation.mutate({ caseId: editingRunCase.testCase.id, body });
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
              onCancel={() => setView(activeRun.source === 'exploratory' ? 'explore' : 'execute')}
            />
          ) : isApi ? (
            <ApiRunner
              projectId={projectId!}
              runId={activeRun.id}
              testCase={activeCase}
              onComplete={handleRunComplete}
              onCancel={() => setView(activeRun.source === 'exploratory' ? 'explore' : 'execute')}
            />
          ) : (
            <ManualRunner
              projectId={projectId!}
              runId={activeRun.id}
              testCase={activeCase}
              onComplete={handleRunComplete}
              onCancel={() => setView(activeRun.source === 'exploratory' ? 'explore' : 'execute')}
            />
          )}
        </div>
      </AppLayout>
    );
  }

  // ── Dynamic exploratory workspace ─────────────────────────
  if (view === 'explore' && pendingRun) {
    return (
      <AppLayout title="Exploratory session">
        <ExploratoryRunWorkspace
          projectId={projectId!}
          run={pendingRun}
          onExecute={testCase => {
            setActiveRun(pendingRun);
            setActiveCase(testCase);
            setView('run');
          }}
          onBack={() => { setPendingRun(null); setView('list'); }}
          onClosed={() => { setPendingRun(null); setView('list'); }}
        />
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
      <AppLayout
        title={`New run: ${runName}`}
        actions={
          <Button variant="secondary" size="sm" onClick={() => { setView('list'); setSelectedCaseIds(new Set()); }}>
            ✕ Cancel
          </Button>
        }
      >
        <div style={{
          display: 'grid', gridTemplateColumns: '210px 1fr', gap: 16,
          height: 'calc(100vh - var(--topbar-height) - 56px)',
        }}>
          {/* Left — suite sidebar */}
          {/* Left — suite sidebar */}
          <div style={{
            background: 'var(--gray-50)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--border-radius-lg)', overflowY: 'auto', padding: '10px 8px',
            display: 'flex', flexDirection: 'column', gap: 0,
          }}>
            <div style={{
              fontSize: '0.6875rem', fontWeight: 600, color: 'var(--gray-400)',
              textTransform: 'uppercase', letterSpacing: '0.07em', padding: '4px 8px 6px',
            }}>
              Suites
            </div>
            {/* "Select all in suite" shortcut */}
            {pickerSuiteId && (
              <button
                onClick={() => {
                  setSelectedCaseIds(prev => {
                    const next = new Set(prev);
                    filteredCases.forEach(tc => next.add(tc.id));
                    return next;
                  });
                }}
                style={{
                  margin: '0 4px 6px', padding: '5px 8px', fontSize: '0.75rem', fontWeight: 600,
                  background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                  border: '1px solid #bfdbfe', borderRadius: 5, cursor: 'pointer', textAlign: 'left',
                }}
              >
                + Select all in suite
              </button>
            )}
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
              {(setsData?.sets ?? []).length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setShowSetPicker(true)}>
                  ◧ Load from set
                </Button>
              )}
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

        {/* Load from set modal */}
        <Modal
          open={showSetPicker}
          onClose={() => setShowSetPicker(false)}
          title="Load cases from a test set"
          footer={<Button variant="secondary" onClick={() => setShowSetPicker(false)}>Close</Button>}
        >
          {(setsData?.sets ?? []).length === 0 && (
            <p style={{ color: 'var(--gray-500)', fontSize: '0.875rem', textAlign: 'center', padding: '16px 0' }}>
              No test sets yet. Create one in Test cases → Test sets.
            </p>
          )}
          {(setsData?.sets ?? []).map(set => (
            <div key={set.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 0', borderBottom: '1px solid var(--border-color)',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--gray-900)' }}>{set.name}</div>
                {set.description && (
                  <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', marginTop: 2 }}>{set.description}</div>
                )}
                <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
                  {set.caseCount} {set.caseCount === 1 ? 'case' : 'cases'}
                </div>
              </div>
              <Button
                variant="primary" size="sm"
                onClick={async () => {
                  const detail = await api.get<{ cases: { id: string }[] }>(`projects/${projectId}/sets/${set.id}`);
                  setSelectedCaseIds(prev => {
                    const next = new Set(prev);
                    detail.cases.forEach(c => next.add(c.id));
                    return next;
                  });
                  setShowSetPicker(false);
                }}
              >
                Load
              </Button>
            </div>
          ))}
        </Modal>

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
            <Button
              variant="ghost" size="sm"
              onClick={() => { setView('list'); setPendingRun(null); }}
            >
              ← Back
            </Button>
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
            {isEditor && <>
              <Button variant="secondary" size="sm" onClick={() => { setRenameRunName(pendingRun.name); setRunUpdateError(''); setShowRenameRun(true); }}>Rename</Button>
              <Button variant="secondary" size="sm" onClick={() => { setPickerSuiteId(null); setCaseSearch(''); setAdditionalCaseIds(new Set()); setRunUpdateError(''); setShowAddCases(true); }}>+ Add cases</Button>
            </>}
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
                  const chip    = STATUS_CHIP[rc.status] ?? STATUS_CHIP.not_run;
                  const canRun  = ['manual', 'functional', 'api', 'exploratory'].includes(rc.testCase.type);
                  const needsNote = rc.status === 'blocked' || rc.status === 'skipped' || rc.status === 'fail';
                  const notePlaceholder = rc.status === 'blocked' ? 'Block reason…' : rc.status === 'skipped' ? 'Skip reason…' : 'Failure note…';
                  const isEditingNote   = noteInputCase === rc.testCase.id;
                  return (
                    <div key={rc.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 16px',
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
                              onClick={() => {
                                markStatus.mutate({ caseId: rc.testCase.id, status: btn.status });
                                if (btn.status !== 'pass') {
                                  setNoteInputCase(rc.testCase.id);
                                  setNoteDraft(rc.note ?? '');
                                } else {
                                  setNoteInputCase(null);
                                }
                              }}
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
                          variant={rc.status === 'not_run' ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => launchCase(rc.testCase)}
                          style={{ flexShrink: 0, fontSize: '0.8125rem' }}
                        >
                          {rc.status === 'not_run' ? '▶ Run' : '↺ Re-run'}
                        </Button>
                      )}

                      {/* Edit button — editors only */}
                      {isEditor && (
                        <button
                          title="Edit test case"
                          onClick={() => openEditModal(rc)}
                          style={{
                            background: 'none', border: '1px solid var(--border-color)',
                            borderRadius: 4, padding: '3px 7px', cursor: 'pointer',
                            color: 'var(--gray-400)', fontSize: '0.875rem', flexShrink: 0,
                            lineHeight: 1,
                          }}
                        >
                          ✎
                        </button>
                      )}
                    </div>{/* end inner row */}

                    {/* Note row — shown for blocked / skipped / fail */}
                    {needsNote && !isEditingNote && (
                      <div style={{ padding: '0 16px 8px 44px' }}>
                        {rc.note ? (
                          /* Existing note — click to edit */
                          <span
                            style={{ fontSize: '0.8125rem', color: chip.color, cursor: 'text' }}
                            onClick={() => { setNoteInputCase(rc.testCase.id); setNoteDraft(rc.note ?? ''); }}
                          >
                            ↳ {rc.note}
                          </span>
                        ) : (
                          /* No note yet — persistent prompt */
                          <button
                            onClick={() => { setNoteInputCase(rc.testCase.id); setNoteDraft(''); }}
                            style={{
                              background: 'none', border: '1px dashed var(--border-color)', borderRadius: 5,
                              color: 'var(--gray-400)', fontSize: '0.8125rem', padding: '2px 10px', cursor: 'pointer',
                            }}
                          >
                            + Add reason
                          </button>
                        )}
                      </div>
                    )}

                    {/* Inline note input */}
                    {isEditingNote && (
                      <div style={{ padding: '0 16px 10px 44px' }}>
                        <input
                          autoFocus
                          value={noteDraft}
                          placeholder={notePlaceholder}
                          onChange={e => setNoteDraft(e.target.value)}
                          onBlur={() => {
                            if (noteDraft.trim()) {
                              markStatus.mutate({ caseId: rc.testCase.id, status: rc.status, note: noteDraft });
                            }
                            setNoteInputCase(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              markStatus.mutate({ caseId: rc.testCase.id, status: rc.status, note: noteDraft });
                              setNoteInputCase(null);
                            }
                            if (e.key === 'Escape') setNoteInputCase(null);
                          }}
                          style={{
                            width: '100%', boxSizing: 'border-box', padding: '5px 10px',
                            border: '1px solid var(--border-color)', borderRadius: 6,
                            fontSize: '0.8125rem', fontFamily: 'inherit',
                            background: 'var(--surface-base)', color: 'var(--gray-800)', outline: 'none',
                          }}
                        />
                        <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: 3 }}>
                          Enter to save · Esc to dismiss
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Edit test case modal */}
        <Modal
          open={!!editingRunCase}
          onClose={() => setEditingRunCase(null)}
          title="Edit test case"
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setEditingRunCase(null)}>Cancel</Button>
              <Button variant="primary" loading={editCaseMutation.isPending} onClick={handleEditSave}>
                Save new version
              </Button>
            </div>
          }
        >
          <p style={{ margin: '0 0 16px', fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
            Changes create a new version and update this run automatically.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Title */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--gray-700)', marginBottom: 4 }}>
                Title
              </label>
              <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Test case title" />
            </div>

            {/* Preconditions */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--gray-700)', marginBottom: 4 }}>
                Preconditions
              </label>
              <textarea
                value={editPreconditions}
                onChange={e => setEditPreconditions(e.target.value)}
                placeholder="What must be true before this test runs…"
                rows={2}
                style={{
                  width: '100%', padding: '8px 10px', border: '1px solid var(--border-color)',
                  borderRadius: 6, fontSize: '0.875rem', resize: 'vertical', outline: 'none',
                  background: 'var(--surface-base)', color: 'var(--gray-900)', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Steps editor — manual / functional only */}
            {editingRunCase && ['manual', 'functional'].includes(editingRunCase.testCase.type) && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--gray-700)' }}>Steps</label>
                  <button
                    onClick={() => setEditSteps(prev => [...prev, { action: '', expected: '' }])}
                    style={{
                      fontSize: '0.8125rem', color: 'var(--color-primary)', background: 'none',
                      border: 'none', cursor: 'pointer', fontWeight: 600, padding: '2px 4px',
                    }}
                  >
                    + Add step
                  </button>
                </div>

                {editSteps.length === 0 && (
                  <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', padding: '8px 0' }}>
                    No steps yet — click "+ Add step" to begin.
                  </div>
                )}

                {editSteps.map((step, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6,
                    marginBottom: 6, alignItems: 'flex-start',
                  }}>
                    <div>
                      {i === 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginBottom: 3 }}>Action</div>
                      )}
                      <textarea
                        value={step.action}
                        onChange={e => setEditSteps(prev => prev.map((s, j) => j === i ? { ...s, action: e.target.value } : s))}
                        placeholder={`Step ${i + 1} action…`}
                        rows={2}
                        style={{
                          width: '100%', padding: '6px 8px', border: '1px solid var(--border-color)',
                          borderRadius: 5, fontSize: '0.8125rem', resize: 'vertical', outline: 'none',
                          background: 'var(--surface-base)', color: 'var(--gray-900)', boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div>
                      {i === 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginBottom: 3 }}>Expected result</div>
                      )}
                      <textarea
                        value={step.expected}
                        onChange={e => setEditSteps(prev => prev.map((s, j) => j === i ? { ...s, expected: e.target.value } : s))}
                        placeholder="Expected result…"
                        rows={2}
                        style={{
                          width: '100%', padding: '6px 8px', border: '1px solid var(--border-color)',
                          borderRadius: 5, fontSize: '0.8125rem', resize: 'vertical', outline: 'none',
                          background: 'var(--surface-base)', color: 'var(--gray-900)', boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ paddingTop: i === 0 ? 18 : 0 }}>
                      <button
                        onClick={() => setEditSteps(prev => prev.filter((_, j) => j !== i))}
                        title="Remove step"
                        style={{
                          background: 'none', border: '1px solid #fca5a5', borderRadius: 4,
                          color: '#dc2626', cursor: 'pointer', padding: '5px 7px', fontSize: '0.875rem',
                          lineHeight: 1,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>

        <Modal open={showRenameRun} onClose={() => setShowRenameRun(false)} title="Rename run" footer={<><Button variant="secondary" onClick={() => setShowRenameRun(false)}>Cancel</Button><Button variant="primary" loading={renameRun.isPending} onClick={() => { if (!renameRunName.trim()) { setRunUpdateError('Run name is required'); return; } renameRun.mutate(); }}>Save name</Button></>}>
          {runUpdateError && <div style={{ marginBottom: 12 }}><Alert type="error">{runUpdateError}</Alert></div>}
          <Input label="Run name" value={renameRunName} onChange={event => { setRenameRunName(event.target.value); setRunUpdateError(''); }} autoFocus maxLength={200} />
        </Modal>

        <Modal open={showAddCases} onClose={() => setShowAddCases(false)} title="Add test cases to run" maxWidth={700} footer={<><Button variant="secondary" onClick={() => setShowAddCases(false)}>Cancel</Button><Button variant="primary" loading={addRunCases.isPending} disabled={additionalCaseIds.size === 0} onClick={() => addRunCases.mutate()}>Add {additionalCaseIds.size || ''} case{additionalCaseIds.size === 1 ? '' : 's'}</Button></>}>
          {runUpdateError && <div style={{ marginBottom: 12 }}><Alert type="error">{runUpdateError}</Alert></div>}
          <Input label="Search project cases" value={caseSearch} onChange={event => setCaseSearch(event.target.value)} placeholder="Search by title…" />
          {loadingCases ? <div style={{ padding: 24, textAlign: 'center' }}><Spinner /></div> : availableAdditionalCases.length === 0 ? <EmptyState icon="✓" title="No additional cases available" description="All matching active project cases are already assigned to this run." /> : <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
            {availableAdditionalCases.map(testCase => <label key={testCase.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
              <input type="checkbox" checked={additionalCaseIds.has(testCase.id)} onChange={() => setAdditionalCaseIds(current => { const next = new Set(current); if (next.has(testCase.id)) next.delete(testCase.id); else next.add(testCase.id); return next; })} />
              <span style={{ flex: 1 }}><span style={{ fontWeight: 500 }}>{testCase.title}</span><span style={{ display: 'block', color: 'var(--gray-400)', fontSize: '0.75rem', marginTop: 2 }}>{TYPE_LABELS[testCase.type as TestType] ?? testCase.type} · {testCase.priority.toUpperCase()}</span></span>
            </label>)}
          </div>}
        </Modal>
      </AppLayout>
    );
  }

  // ── Runs list view ──────────────────────────────────────────
  return (
    <AppLayout
      title="Runs"
      actions={canExecute && <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" size="sm" onClick={() => {
          setExploreName(''); setExploreEnv('staging'); setExploreCharter(''); setExploreArea(''); setExploreRisk(''); setExploreDuration('60'); setCreateError(''); setView('create-exploratory');
        }}>✦ Exploratory run</Button>
        <Button variant="primary" size="sm" onClick={() => { setRunName(''); setRunPlanId(''); setCreateError(''); setSelectedCaseIds(new Set()); setView('create'); }}>+ New run</Button>
      </div>}
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
                          variant="primary" size="sm"
                          onClick={() => { setPendingRun(run); setPickerSuiteId(null); setCaseSearch(''); setStatusFilter('all'); setView(run.source === 'exploratory' ? 'explore' : 'execute'); }}
                          style={{ fontSize: '0.8125rem' }}
                        >
                          Continue ▶
                        </Button>
                      )}
                      {run.status === 'closed' && (
                        <Button
                          variant="secondary" size="sm"
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

      <Modal
        open={view === 'create-exploratory'}
        onClose={() => setView('list')}
        title="Start exploratory run"
        footer={<>
          <Button variant="secondary" onClick={() => setView('list')}>Cancel</Button>
          <Button variant="primary" loading={createExploratoryRun.isPending} onClick={() => {
            setCreateError('');
            if (!exploreName.trim()) { setCreateError('Run name is required'); return; }
            if (!exploreCharter.trim()) { setCreateError('Charter is required'); return; }
            createExploratoryRun.mutate();
          }}>Start session</Button>
        </>}
      >
        {createError && <div style={{ marginBottom: 14 }}><Alert type="error">{createError}</Alert></div>}
        <div style={{ padding: '8px 12px', background: 'var(--color-primary-light)', border: '1px solid #bfdbfe', borderRadius: 6, marginBottom: 16, fontSize: '0.8125rem', color: 'var(--color-primary)' }}>
          Add new test cases and execute them continuously while you explore.
        </div>
        <Input label="Session name" value={exploreName} onChange={event => setExploreName(event.target.value)} placeholder="e.g. Guest checkout exploration" autoFocus />
        <Select label="Environment" value={exploreEnv} onChange={event => setExploreEnv(event.target.value)} options={[
          { value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' }, { value: 'local', label: 'Local' }, { value: 'dev', label: 'Dev' },
        ]} />
        <label className="label">Charter</label>
        <textarea className="input" rows={3} value={exploreCharter} onChange={event => setExploreCharter(event.target.value)} placeholder="What should this session explore and learn?" style={{ resize: 'vertical', marginBottom: 14 }} />
        <Input label="Area or feature (optional)" value={exploreArea} onChange={event => setExploreArea(event.target.value)} placeholder="e.g. Payments / guest checkout" />
        <Input label="Risk focus (optional)" value={exploreRisk} onChange={event => setExploreRisk(event.target.value)} placeholder="e.g. Duplicate charges and recovery paths" />
        <Input label="Planned duration in minutes" type="number" value={exploreDuration} onChange={event => setExploreDuration(event.target.value)} />
      </Modal>
    </AppLayout>
  );
}
