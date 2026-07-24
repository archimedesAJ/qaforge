import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Alert, Button, EmptyState, Input, Modal, Select, Spinner, StatCard } from '../shared/ui';
import type { TestCase, TestRun } from '@qaforge/types';

interface LiveRunCase {
  id: number;
  status: string;
  note?: string | null;
  testCase: TestCase;
}

interface LiveSession {
  id: string;
  charter: string;
  area?: string | null;
  riskFocus?: string | null;
  plannedDurationMins?: number | null;
  startedAt: string;
}

interface LiveRun extends TestRun {
  session: LiveSession;
  runCases: LiveRunCase[];
}

export function ExploratoryRunWorkspace({ projectId, run, onExecute, onBack, onClosed }: {
  projectId: string;
  run: TestRun;
  onExecute: (testCase: TestCase) => void;
  onBack: () => void;
  onClosed: () => void;
}) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [renameName, setRenameName] = useState(run.name);
  const [showClose, setShowClose] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('p2');
  const [preconditions, setPreconditions] = useState('');
  const [action, setAction] = useState('');
  const [expected, setExpected] = useState('');
  const [debrief, setDebrief] = useState('');
  const [verdict, setVerdict] = useState('thorough');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['exploratory-run', run.id],
    queryFn: () => api.get<LiveRun>(`projects/${projectId}/runs/${run.id}/exploratory`),
  });

  useEffect(() => {
    const startedAt = new Date(data?.session.startedAt ?? run.startedAt).getTime();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [data?.session.startedAt, run.startedAt]);

  const addCase = useMutation({
    mutationFn: () => api.post<TestCase>(`projects/${projectId}/runs/${run.id}/exploratory/cases`, {
      title: title.trim(), priority,
      preconditions: preconditions.trim() || undefined,
      action: action.trim() || undefined,
      expected: expected.trim() || undefined,
    }),
    onSuccess: testCase => {
      qc.invalidateQueries({ queryKey: ['exploratory-run', run.id] });
      qc.invalidateQueries({ queryKey: ['cases', projectId] });
      setShowAdd(false); resetCaseForm(); onExecute(testCase);
    },
    onError: (err: Error) => setError(err.message),
  });

  const closeSession = useMutation({
    mutationFn: async () => {
      await api.patch(`projects/${projectId}/runs/${run.id}/exploratory`, { debrief, verdict });
      await api.put(`projects/${projectId}/runs/${run.id}/close`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      qc.invalidateQueries({ queryKey: ['exploratory-run', run.id] });
      onClosed();
    },
    onError: (err: Error) => setError(err.message),
  });

  const renameRun = useMutation({
    mutationFn: () => api.patch(`projects/${projectId}/runs/${run.id}`, { name: renameName.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      qc.invalidateQueries({ queryKey: ['exploratory-run', run.id] });
      setShowRename(false); setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  function resetCaseForm() {
    setTitle(''); setPriority('p2'); setPreconditions(''); setAction(''); setExpected(''); setError('');
  }

  function formatTime(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [hours, mins, secs].map(value => String(value).padStart(2, '0')).join(':');
  }

  const cases = data?.runCases ?? [];
  const count = (status: string) => cases.filter(item => item.status === status).length;

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size="lg" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{data?.name ?? run.name}</h2>
            <span style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontSize: '0.75rem', fontWeight: 600 }}>Exploratory</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--gray-500)', fontSize: '0.8125rem' }}>{run.env}</span>
          </div>
          <div style={{ marginTop: 8, color: 'var(--gray-700)', lineHeight: 1.5 }}>{data?.session.charter}</div>
          {(data?.session.area || data?.session.riskFocus) && <div style={{ display: 'flex', gap: 18, marginTop: 8, fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
            {data.session.area && <span><strong>Area:</strong> {data.session.area}</span>}
            {data.session.riskFocus && <span><strong>Risk focus:</strong> {data.session.riskFocus}</span>}
          </div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'monospace', fontSize: '1.3rem', fontWeight: 700 }}>{formatTime(elapsed)}</div>
          {data?.session.plannedDurationMins && <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>planned {data.session.plannedDurationMins} min</div>}
        </div>
        <Button variant="secondary" size="sm" onClick={() => { setRenameName(data?.name ?? run.name); setError(''); setShowRename(true); }}>Rename</Button>
        <Button variant="danger" size="sm" onClick={() => { setError(''); setShowClose(true); }}>End session</Button>
      </div>

      <Modal open={showRename} onClose={() => setShowRename(false)} title="Rename run" footer={<><Button variant="secondary" onClick={() => setShowRename(false)}>Cancel</Button><Button variant="primary" loading={renameRun.isPending} onClick={() => { if (!renameName.trim()) { setError('Run name is required'); return; } renameRun.mutate(); }}>Save name</Button></>}>
        {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}
        <Input label="Run name" value={renameName} onChange={event => { setRenameName(event.target.value); setError(''); }} autoFocus maxLength={200} />
      </Modal>

      <div className="grid-4">
        <StatCard label="Cases designed" value={cases.length} />
        <StatCard label="Passed" value={count('pass')} color="var(--color-success)" />
        <StatCard label="Failed" value={count('fail')} color={count('fail') ? 'var(--color-danger)' : undefined} />
        <StatCard label="Remaining" value={count('not_run')} color={count('not_run') ? 'var(--color-warning)' : undefined} />
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Cases discovered during this session</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>Design a case and execute it without leaving the run.</div>
          </div>
          <Button variant="primary" onClick={() => { resetCaseForm(); setShowAdd(true); }}>+ Add and run test case</Button>
        </div>
        {cases.length === 0 ? <EmptyState icon="✦" title="No cases added yet" description="Add the first scenario you discover while exploring." /> : cases.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--border-color)' }}>
            <span style={{ width: 78, textAlign: 'center', padding: '3px 8px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize', background: item.status === 'pass' ? 'var(--color-success-light)' : item.status === 'fail' ? 'var(--color-danger-light)' : item.status === 'blocked' ? 'var(--color-warning-light)' : 'var(--gray-100)', color: item.status === 'pass' ? 'var(--color-success)' : item.status === 'fail' ? 'var(--color-danger)' : item.status === 'blocked' ? 'var(--color-warning)' : 'var(--gray-500)' }}>{item.status.replace('_', ' ')}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{item.testCase.title}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: 2 }}>{item.testCase.priority.toUpperCase()} · saved to Exploratory discoveries</div>
            </div>
            <Button variant={item.status === 'not_run' ? 'primary' : 'secondary'} size="sm" onClick={() => onExecute(item.testCase)}>
              {item.status === 'not_run' ? 'Run now ▶' : 'Run again'}
            </Button>
          </div>
        ))}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add and run test case" footer={<>
        <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
        <Button variant="primary" loading={addCase.isPending} onClick={() => { if (!title.trim()) { setError('Title is required'); return; } addCase.mutate(); }}>Add and execute</Button>
      </>}>
        {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}
        <Input label="Title" value={title} onChange={event => setTitle(event.target.value)} placeholder="What scenario are you checking?" autoFocus />
        <Select label="Priority" value={priority} onChange={event => setPriority(event.target.value)} options={['p0', 'p1', 'p2', 'p3'].map(value => ({ value, label: value.toUpperCase() }))} />
        <Input label="Preconditions (optional)" value={preconditions} onChange={event => setPreconditions(event.target.value)} placeholder="What must already be true?" />
        <Input label="Action (optional)" value={action} onChange={event => setAction(event.target.value)} placeholder="What will you do?" />
        <Input label="Expected result (optional)" value={expected} onChange={event => setExpected(event.target.value)} placeholder="What should happen?" />
      </Modal>

      <Modal open={showClose} onClose={() => setShowClose(false)} title="End exploratory session" footer={<>
        <Button variant="secondary" onClick={() => setShowClose(false)}>Continue exploring</Button>
        <Button variant="primary" loading={closeSession.isPending} onClick={() => closeSession.mutate()}>Save and close run</Button>
      </>}>
        {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}
        {count('not_run') > 0 && <div style={{ marginBottom: 12 }}><Alert type="info">{count('not_run')} case(s) have not been executed. You can still close the session.</Alert></div>}
        <Select label="Session verdict" value={verdict} onChange={event => setVerdict(event.target.value)} options={[
          { value: 'thorough', label: 'Thorough' }, { value: 'partial', label: 'Partial' }, { value: 'incomplete', label: 'Incomplete' },
        ]} />
        <label className="label">Debrief</label>
        <textarea className="input" rows={5} value={debrief} onChange={event => setDebrief(event.target.value)} placeholder="Summarise coverage, findings, and follow-up work…" style={{ resize: 'vertical' }} />
      </Modal>
    </div>
  );
}
