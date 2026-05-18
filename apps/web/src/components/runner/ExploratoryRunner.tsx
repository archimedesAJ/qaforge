import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Alert } from '../shared/ui';
import { api } from '../../lib/api';
import type { TestCase, ExploratoryCharter } from '@qaforge/types';

type EntryType = 'bug' | 'observation' | 'question' | 'note';
type Verdict = 'thorough' | 'partial' | 'incomplete';

interface LogEntry {
  timestamp: string;
  type: EntryType;
  text: string;
}

const ENTRY_CONFIG: Record<EntryType, { label: string; color: string; bg: string; border: string; icon: string }> = {
  bug:         { label: 'Bug',         color: 'var(--color-danger)',  bg: 'var(--color-danger-light)',  border: '#fecaca', icon: '🐛' },
  observation: { label: 'Observation', color: 'var(--color-primary)', bg: 'var(--color-primary-light)', border: '#bfdbfe', icon: '👁' },
  question:    { label: 'Question',    color: 'var(--color-warning)', bg: 'var(--color-warning-light)', border: '#fde68a', icon: '?' },
  note:        { label: 'Note',        color: 'var(--gray-600)',      bg: 'var(--gray-50)',             border: 'var(--border-color)', icon: '✎' },
};

const VERDICT_CONFIG: Record<Verdict, { label: string; color: string; bg: string; border: string }> = {
  thorough:   { label: 'Thorough',   color: 'var(--color-success)', bg: 'var(--color-success-light)', border: '#bbf7d0' },
  partial:    { label: 'Partial',    color: 'var(--color-warning)', bg: 'var(--color-warning-light)', border: '#fde68a' },
  incomplete: { label: 'Incomplete', color: 'var(--color-danger)',  bg: 'var(--color-danger-light)',  border: '#fecaca' },
};

interface ExploratoryRunnerProps {
  projectId: string;
  runId: string;
  testCase: TestCase;
  onComplete: () => void;
  onCancel: () => void;
}

export function ExploratoryRunner({ projectId, runId, testCase, onComplete, onCancel }: ExploratoryRunnerProps) {
  const qc = useQueryClient();
  const charter = testCase.steps as ExploratoryCharter;
  const [log, setLog] = useState<LogEntry[]>([]);
  const [entryType, setEntryType] = useState<EntryType>('bug');
  const [input, setInput] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(true);
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [debrief, setDebrief] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Timer
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const submit = useMutation({
    mutationFn: () =>
      api.post(`projects/${projectId}/runs/${runId}/results`, {
        results: [{
          testCaseId: testCase.id,
          status: verdict === 'thorough' ? 'pass' : verdict === 'incomplete' ? 'blocked' : 'pass',
          durationMs: seconds * 1000,
          stepsLog: log,
          failureNote: debrief || undefined,
        }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] });
      onComplete();
    },
    onError: (err: Error) => setError(err.message),
  });

  function fmt(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function addEntry() {
    const text = input.trim();
    if (!text) return;
    const entry: LogEntry = {
      timestamp: fmt(seconds),
      type: entryType,
      text,
    };
    setLog(prev => [...prev, entry]);
    setInput('');
    inputRef.current?.focus();
  }

  function endSession() {
    setRunning(false);
    setDebriefOpen(true);
  }

  const counts = {
    bug: log.filter(e => e.type === 'bug').length,
    observation: log.filter(e => e.type === 'observation').length,
    question: log.filter(e => e.type === 'question').length,
    note: log.filter(e => e.type === 'note').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        padding: '12px 20px', borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Exploratory session</h3>
          <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
            {testCase.title}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {running && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-danger)', animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>Recording</span>
            </div>
          )}
          <div style={{
            fontFamily: 'monospace', fontSize: '1.25rem', fontWeight: 600,
            color: running ? 'var(--gray-900)' : 'var(--gray-400)',
          }}>{fmt(seconds)}</div>
          <Button variant="ghost" size="sm" onClick={onCancel}>✕</Button>
        </div>
      </div>

      {/* Charter */}
      <div style={{
        padding: '10px 20px', background: 'var(--color-primary-light)',
        borderBottom: '1px solid #bfdbfe', flexShrink: 0,
      }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
          Charter
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--gray-700)', lineHeight: 1.5 }}>
          {charter?.charter ?? 'No charter defined'}
        </div>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', flexShrink: 0,
      }}>
        {(Object.entries(counts) as [EntryType, number][]).map(([type, count]) => {
          const cfg = ENTRY_CONFIG[type];
          return (
            <div key={type} style={{
              flex: 1, padding: '8px 12px', textAlign: 'center',
              borderRight: type !== 'note' ? '1px solid var(--border-color)' : 'none',
            }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 600, color: cfg.color }}>{count}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>{cfg.label}s</div>
            </div>
          );
        })}
      </div>

      {/* Log */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
        {log.length === 0 && !debriefOpen && (
          <div style={{
            textAlign: 'center', padding: '32px 0',
            color: 'var(--gray-400)', fontSize: '0.875rem',
          }}>
            Session started — log your first finding below
          </div>
        )}

        {log.map((entry, i) => {
          const cfg = ENTRY_CONFIG[entry.type];
          return (
            <div key={i} style={{
              display: 'flex', gap: 10, padding: '8px 12px', marginBottom: 6,
              background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8,
            }}>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>{cfg.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--gray-900)', lineHeight: 1.5 }}>
                  {entry.text}
                </div>
                <div style={{ marginTop: 3, display: 'flex', gap: 8, fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                  <span style={{ fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
                  <span>{entry.timestamp}</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Debrief */}
        {debriefOpen && (
          <div style={{
            marginTop: 16, padding: '18px', border: '1px solid var(--border-color)',
            borderRadius: 10,
          }}>
            <h3 style={{ marginBottom: 14, fontSize: '1rem' }}>Session debrief</h3>

            <div style={{ marginBottom: 14 }}>
              <label className="label">Verdict</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(Object.entries(VERDICT_CONFIG) as [Verdict, typeof VERDICT_CONFIG[Verdict]][]).map(([v, cfg]) => (
                  <button
                    key={v}
                    onClick={() => setVerdict(v)}
                    style={{
                      flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer',
                      border: `1.5px solid ${verdict === v ? cfg.border : 'var(--border-color)'}`,
                      background: verdict === v ? cfg.bg : 'var(--surface-base)',
                      color: verdict === v ? cfg.color : 'var(--gray-600)',
                      fontWeight: 600, fontSize: '0.875rem',
                      transition: 'all 0.15s',
                    }}
                  >
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              className="input"
              rows={3}
              placeholder="Summarise what you found, what areas need more investigation…"
              value={debrief}
              onChange={e => setDebrief(e.target.value)}
              style={{ marginBottom: 14, resize: 'none' }}
            />

            {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={() => { setDebriefOpen(false); setRunning(true); }}>
                Resume session
              </Button>
              <Button
                variant="primary"
                loading={submit.isPending}
                onClick={() => { if (!verdict) { setError('Select a verdict'); return; } submit.mutate(); }}
              >
                Submit session
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      {!debriefOpen && (
        <div style={{ borderTop: '1px solid var(--border-color)', padding: '12px 20px', flexShrink: 0 }}>
          {/* Type picker */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(Object.entries(ENTRY_CONFIG) as [EntryType, typeof ENTRY_CONFIG[EntryType]][]).map(([type, cfg]) => (
              <button
                key={type}
                onClick={() => setEntryType(type)}
                style={{
                  padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontSize: '0.8125rem',
                  border: `1px solid ${entryType === type ? cfg.color : 'var(--border-color)'}`,
                  background: entryType === type ? cfg.bg : 'transparent',
                  color: entryType === type ? cfg.color : 'var(--gray-500)',
                  fontWeight: entryType === type ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                {cfg.icon} {cfg.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              className="input"
              placeholder={`Log a ${entryType} — press Enter to add`}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEntry(); } }}
              style={{ flex: 1 }}
            />
            <Button variant="primary" onClick={addEntry}>Add</Button>
            <Button variant="danger" onClick={endSession}>End session</Button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
