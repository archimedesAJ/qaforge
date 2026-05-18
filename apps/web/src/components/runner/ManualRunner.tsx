import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Alert } from '../shared/ui';
import { api } from '../../lib/api';
import type { TestCase, ManualStep, ResultStatus } from '@qaforge/types';

interface StepResult {
  order: number;
  status: ResultStatus;
  actual: string;
  screenshotUrl?: string;
}

interface ManualRunnerProps {
  projectId: string;
  runId: string;
  testCase: TestCase;
  onComplete: () => void;
  onCancel: () => void;
}

const STATUS_CONFIG = {
  pass:    { label: 'Pass',    color: 'var(--color-success)', bg: 'var(--color-success-light)', border: '#bbf7d0' },
  fail:    { label: 'Fail',    color: 'var(--color-danger)',  bg: 'var(--color-danger-light)',  border: '#fecaca' },
  blocked: { label: 'Blocked', color: 'var(--color-warning)', bg: 'var(--color-warning-light)', border: '#fde68a' },
};

export function ManualRunner({ projectId, runId, testCase, onComplete, onCancel }: ManualRunnerProps) {
  const qc = useQueryClient();
  const steps = (testCase.steps as ManualStep[]) ?? [];
  const [current, setCurrent] = useState(0);
  const [results, setResults] = useState<StepResult[]>([]);
  const [actual, setActual] = useState('');
  const [runNote, setRunNote] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      api.post(`projects/${projectId}/runs/${runId}/results`, {
        results: [{
          testCaseId: testCase.id,
          status: results.some(r => r.status === 'fail') ? 'fail'
                : results.some(r => r.status === 'blocked') ? 'blocked'
                : 'pass',
          durationMs: 0,
          stepsLog: results,
          failureNote: runNote || undefined,
        }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] });
      onComplete();
    },
    onError: (err: Error) => setError(err.message),
  });

  function markStep(status: ResultStatus) {
    const result: StepResult = { order: current + 1, status, actual: actual.trim() };
    const next = [...results, result];
    setResults(next);
    setActual('');

    if (current + 1 >= steps.length) {
      setDone(true);
    } else {
      setCurrent(current + 1);
    }
  }

  const pct = steps.length > 0 ? Math.round((results.length / steps.length) * 100) : 0;
  const step = steps[current];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>{testCase.title}</h3>
          <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
            Manual execution · Run #{runId.slice(-6)}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>✕ Cancel</Button>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--gray-500)', marginBottom: 6 }}>
          <span>{done ? 'All steps complete' : `Step ${current + 1} of ${steps.length}`}</span>
          <span>{pct}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill success" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

        {/* History */}
        {results.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            {results.map((r, i) => {
              const cfg = STATUS_CONFIG[r.status as keyof typeof STATUS_CONFIG];
              return (
                <div key={i} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  padding: '8px 12px', marginBottom: 6,
                  background: cfg.bg, border: `1px solid ${cfg.border}`,
                  borderRadius: 8,
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: cfg.color, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.7rem', fontWeight: 700, flexShrink: 0,
                  }}>{r.order}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--gray-700)' }}>
                      {steps[i]?.action}
                    </div>
                    {r.actual && (
                      <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', marginTop: 2 }}>
                        Actual: {r.actual}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: cfg.color }}>
                    {cfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Current step */}
        {!done && step && (
          <div style={{
            border: '1.5px solid var(--color-primary)',
            borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 0 0 3px rgba(29,78,216,0.08)',
          }}>
            <div style={{
              padding: '10px 14px', background: 'var(--color-primary-light)',
              borderBottom: '1px solid #bfdbfe',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                background: 'var(--color-primary)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.8125rem', fontWeight: 700, flexShrink: 0,
              }}>{current + 1}</div>
              <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                Current step
              </span>
            </div>

            <div style={{ padding: '16px' }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Action
                </div>
                <div style={{ fontSize: '1rem', color: 'var(--gray-900)', lineHeight: 1.5 }}>
                  {step.action}
                </div>
              </div>

              <div style={{
                padding: '10px 12px', background: 'var(--gray-50)',
                borderLeft: '3px solid var(--color-primary)',
                borderRadius: '0 6px 6px 0', marginBottom: 14,
              }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Expected
                </div>
                <div style={{ fontSize: '0.9375rem', color: 'var(--gray-700)' }}>
                  {step.expected}
                </div>
              </div>

              <textarea
                className="input"
                rows={2}
                placeholder="Actual result (optional — describe what happened)"
                value={actual}
                onChange={e => setActual(e.target.value)}
                style={{ marginBottom: 14, resize: 'none' }}
              />

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => markStep('pass')}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                    fontSize: '0.9375rem', border: '1.5px solid var(--color-success)',
                    background: 'var(--color-success-light)', color: 'var(--color-success)',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#dcfce7'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--color-success-light)'}
                >✓ Pass</button>
                <button
                  onClick={() => markStep('fail')}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                    fontSize: '0.9375rem', border: '1.5px solid var(--color-danger)',
                    background: 'var(--color-danger-light)', color: 'var(--color-danger)',
                    transition: 'all 0.15s',
                  }}
                >✕ Fail</button>
                <button
                  onClick={() => markStep('blocked')}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                    fontSize: '0.9375rem', border: '1.5px solid var(--color-warning)',
                    background: 'var(--color-warning-light)', color: 'var(--color-warning)',
                    transition: 'all 0.15s',
                  }}
                >⊘ Blocked</button>
              </div>
            </div>
          </div>
        )}

        {/* Run complete */}
        {done && (
          <div style={{
            border: '1px solid var(--border-color)', borderRadius: 10, padding: '20px',
          }}>
            <h3 style={{ marginBottom: 14 }}>Run complete</h3>

            {/* Summary badges */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {(['pass', 'fail', 'blocked'] as const).map(s => {
                const count = results.filter(r => r.status === s).length;
                if (!count) return null;
                const cfg = STATUS_CONFIG[s];
                return (
                  <span key={s} style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: '0.875rem', fontWeight: 600,
                    background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
                  }}>
                    {count} {cfg.label}
                  </span>
                );
              })}
            </div>

            <textarea
              className="input"
              rows={3}
              placeholder="Run notes — optional summary, observations, or context"
              value={runNote}
              onChange={e => setRunNote(e.target.value)}
              style={{ marginBottom: 14, resize: 'none' }}
            />

            {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={onCancel}>Discard</Button>
              <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate()}>
                Submit results
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
