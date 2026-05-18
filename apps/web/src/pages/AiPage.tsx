import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Alert, Spinner, Select } from '../components/shared/ui';
import { api } from '../lib/api';
import type { TestCase, TestType } from '@qaforge/types';

type AiTab = 'generate' | 'triage' | 'gaps';

interface GeneratedCase {
  title: string;
  priority: string;
  tags: string[];
  steps: Array<{ action: string; expected: string }>;
}

interface TriageCluster {
  cause: string;
  confidence: 'high' | 'medium' | 'low';
  hint: string;
  tests: string[];
}

interface GapArea {
  area: string;
  coverage: number;
  risk: 'high' | 'medium' | 'low';
  reason: string;
}

const RISK_COLOR: Record<string, string> = {
  high:   'var(--color-danger)',
  medium: 'var(--color-warning)',
  low:    'var(--color-success)',
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   'var(--color-danger)',
  medium: 'var(--color-warning)',
  low:    'var(--gray-400)',
};

export function AiPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<AiTab>('generate');

  if (!projectId) return null;

  const TABS: Array<{ id: AiTab; label: string; icon: string }> = [
    { id: 'generate', label: 'Generate',  icon: '✦' },
    { id: 'triage',   label: 'Triage',    icon: '⎇' },
    { id: 'gaps',     label: 'Gaps',      icon: '◎' },
  ];

  return (
    <AppLayout title="AI assistant">
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Tab bar */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--border-color)',
          marginBottom: 28,
        }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.9375rem', fontFamily: 'inherit',
              color: tab === t.id ? 'var(--color-primary)' : 'var(--gray-500)',
              borderBottom: `2px solid ${tab === t.id ? 'var(--color-primary)' : 'transparent'}`,
              marginBottom: -1, fontWeight: tab === t.id ? 600 : 400, transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {tab === 'generate' && <GenerateTab projectId={projectId} />}
        {tab === 'triage'   && <TriageTab   projectId={projectId} />}
        {tab === 'gaps'     && <GapsTab     projectId={projectId} />}
      </div>
    </AppLayout>
  );
}

// ── Generate tab ──────────────────────────────────────────────
function GenerateTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [requirement, setRequirement] = useState('');
  const [type, setType]               = useState<TestType>('manual');
  const [depth, setDepth]             = useState('happy_path_and_edge_cases');
  const [streaming, setStreaming]     = useState(false);
  const [_streamText, _setStreamText] = useState('');
  const [cases, setCases]             = useState<GeneratedCase[]>([]);
  const [error, setError]             = useState('');
  const [imported, setImported]       = useState<Set<number>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const importCase = useMutation({
    mutationFn: (tc: GeneratedCase) =>
      api.post<TestCase>(`projects/${projectId}/cases`, {
        title: tc.title,
        type,
        priority: tc.priority,
        tags: tc.tags,
        steps: tc.steps.map((s, i) => ({ order: i + 1, ...s })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases', projectId] });
    },
  });

  async function generate() {
    if (!requirement.trim()) { setError('Requirement is required'); return; }
    setError('');
    setStreaming(true);
    
    setCases([]);
    setImported(new Set());

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`/projects/${projectId}/ai/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('qaforge_token') ?? ''}`,
        },
        body: JSON.stringify({ requirement, type, depth }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`API error ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) buffer += parsed.text;
            
          } catch { /* skip malformed chunks */ }
        }
      }

      // Parse the final JSON
      try {
        const clean = buffer.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean) as GeneratedCase[];
        setCases(Array.isArray(parsed) ? parsed : []);
      } catch {
        setError('Could not parse generated cases — check your ANTHROPIC_API_KEY in .env');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Generation failed');
      }
    } finally {
      setStreaming(false);
      
    }
  }

  function handleImport(tc: GeneratedCase, idx: number) {
    importCase.mutate(tc, {
      onSuccess: () => setImported(prev => new Set([...prev, idx])),
    });
  }

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ marginBottom: 4 }}>Generate test cases from a requirement</h3>
        <p style={{ marginBottom: 16 }}>
          Paste a user story, acceptance criterion, or feature description. Claude will generate ready-to-import test cases.
        </p>
      </div>

      {error && <div style={{ marginBottom: 14 }}><Alert type="error">{error}</Alert></div>}

      <textarea
        className="input"
        rows={4}
        placeholder="e.g. As a guest user I want to complete checkout without creating an account so I can buy quickly. The system should validate card details and send a confirmation email."
        value={requirement}
        onChange={e => setRequirement(e.target.value)}
        style={{ marginBottom: 12, resize: 'vertical' }}
      />

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Select
            label="Test type"
            value={type}
            onChange={e => setType(e.target.value as TestType)}
            options={[
              { value: 'manual',      label: 'Manual' },
              { value: 'functional',  label: 'Functional' },
              { value: 'api',         label: 'API' },
              { value: 'exploratory', label: 'Exploratory' },
            ]}
          />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Select
            label="Coverage depth"
            value={depth}
            onChange={e => setDepth(e.target.value)}
            options={[
              { value: 'happy_path_and_edge_cases', label: 'Happy path + edge cases' },
              { value: 'happy_path_only',           label: 'Happy path only' },
              { value: 'edge_cases_only',           label: 'Edge cases only' },
              { value: 'negative_cases',            label: 'Negative / failure cases' },
            ]}
          />
        </div>
        <div style={{ paddingBottom: 16 }}>
          <Button
            variant="primary"
            loading={streaming}
            onClick={streaming ? () => abortRef.current?.abort() : generate}
          >
            {streaming ? '⏹ Stop' : '✦ Generate'}
          </Button>
        </div>
      </div>

      {/* Streaming indicator */}
      {streaming && (
        <div style={{
          padding: '12px 14px', background: 'var(--color-primary-light)',
          border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: '0.875rem', color: 'var(--color-primary)',
        }}>
          <Spinner size="sm" />
          Generating test cases…
        </div>
      )}

      {/* Generated cases */}
      {cases.map((tc, idx) => (
        <div key={idx} style={{
          border: '1px solid var(--border-color)', borderRadius: 10,
          marginBottom: 12, overflow: 'hidden',
          background: imported.has(idx) ? 'var(--color-success-light)' : 'var(--surface-base)',
          borderColor: imported.has(idx) ? '#bbf7d0' : 'var(--border-color)',
        }}>
          <div style={{
            padding: '12px 16px', background: imported.has(idx) ? 'transparent' : 'var(--gray-50)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--gray-900)' }}>
                {tc.title}
              </div>
              <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '0.75rem', padding: '1px 7px', borderRadius: 4,
                  background: 'var(--gray-100)', color: 'var(--gray-500)',
                }}>
                  {tc.priority?.toUpperCase() ?? 'P2'}
                </span>
                {tc.tags?.map(tag => (
                  <span key={tag} style={{
                    fontSize: '0.75rem', padding: '1px 7px', borderRadius: 10,
                    background: 'var(--gray-100)', color: 'var(--gray-500)',
                  }}>{tag}</span>
                ))}
              </div>
            </div>
            {imported.has(idx) ? (
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-success)' }}>✓ Imported</span>
            ) : (
              <Button
                variant="primary" size="sm"
                loading={importCase.isPending}
                onClick={() => handleImport(tc, idx)}
              >
                Import
              </Button>
            )}
          </div>
          <div style={{ padding: '12px 16px' }}>
            {tc.steps?.map((step, si) => (
              <div key={si} style={{
                display: 'flex', gap: 8, padding: '5px 0',
                borderBottom: si < tc.steps.length - 1 ? '1px solid var(--border-color)' : 'none',
                fontSize: '0.875rem',
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--color-primary)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.7rem', fontWeight: 700, flexShrink: 0, marginTop: 1,
                }}>{si + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--gray-800)' }}>{step.action}</div>
                  <div style={{ color: 'var(--gray-500)', marginTop: 2, paddingLeft: 8, borderLeft: '2px solid var(--color-primary)' }}>
                    {step.expected}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Triage tab ────────────────────────────────────────────────
function TriageTab({ projectId }: { projectId: string }) {
  const [runId, setRunId] = useState('');
  const [loading, setLoading] = useState(false);
  const [clusters, setClusters] = useState<TriageCluster[]>([]);
  const [error, setError] = useState('');

  const { data: runsData } = useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => api.get<{ runs: Array<{ id: string; name: string; status: string }> }>(`projects/${projectId}/runs`),
  });

  const runs = (runsData?.runs ?? []).filter(r => r.status === 'closed');

  async function triage() {
    if (!runId) { setError('Select a run to triage'); return; }
    setError('');
    setLoading(true);
    setClusters([]);

    try {
      const res = await api.get<{ clusters: TriageCluster[] }>(
        `projects/${projectId}/runs/${runId}/ai/triage`
      );
      setClusters(res.clusters ?? []);
      if ((res.clusters ?? []).length === 0) {
        setError('No failures found in this run to triage.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Triage failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h3 style={{ marginBottom: 4 }}>Failure triage</h3>
      <p style={{ marginBottom: 20 }}>
        Group failures from a run by likely root cause. Saves time filing separate tickets for related failures.
      </p>

      {error && <div style={{ marginBottom: 14 }}><Alert type="error">{error}</Alert></div>}

      <div style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Select
            label="Select a closed run"
            value={runId}
            onChange={e => setRunId(e.target.value)}
            options={[
              { value: '', label: '— Choose a run —' },
              ...runs.map(r => ({ value: r.id, label: r.name })),
            ]}
          />
        </div>
        <div style={{ paddingBottom: 16 }}>
          <Button variant="primary" loading={loading} onClick={triage}>⎇ Triage</Button>
        </div>
      </div>

      {clusters.map((cluster, i) => (
        <div key={i} style={{
          border: '1px solid var(--border-color)', borderRadius: 10,
          marginBottom: 12, overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px', background: 'var(--gray-50)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: 4 }}>
                {cluster.cause}
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', lineHeight: 1.5 }}>
                {cluster.hint}
              </div>
            </div>
            <span style={{
              fontSize: '0.75rem', fontWeight: 600, padding: '3px 9px', borderRadius: 20, flexShrink: 0,
              background: cluster.confidence === 'high' ? '#fee2e2' : cluster.confidence === 'medium' ? '#fef3c7' : '#f3f4f6',
              color: CONFIDENCE_COLOR[cluster.confidence],
            }}>
              {cluster.confidence.charAt(0).toUpperCase() + cluster.confidence.slice(1)} confidence
            </span>
          </div>
          <div style={{ padding: '10px 16px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Affected tests ({cluster.tests.length})
            </div>
            {cluster.tests.map((t, ti) => (
              <div key={ti} style={{
                fontSize: '0.875rem', color: 'var(--gray-700)', padding: '3px 0',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>✕</span> {t}
              </div>
            ))}
          </div>
        </div>
      ))}

      {!loading && clusters.length === 0 && !error && (
        <div style={{
          padding: '36px 24px', textAlign: 'center',
          color: 'var(--gray-400)', fontSize: '0.875rem',
        }}>
          Select a run and click Triage to group failures by root cause
        </div>
      )}
    </div>
  );
}

// ── Gaps tab ──────────────────────────────────────────────────
function GapsTab({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(false);
  const [gaps, setGaps]       = useState<GapArea[]>([]);
  const [error, setError]     = useState('');
  const [generated, setGenerated] = useState<string | null>(null);

  async function analyseGaps() {
    setError('');
    setLoading(true);
    setGaps([]);

    try {
      const res = await api.get<{ gaps: GapArea[] }>(
        `projects/${projectId}/ai/gaps`
      );
      setGaps(res.gaps ?? []);
      if ((res.gaps ?? []).length === 0) {
        setError('No coverage gaps detected — your test suite looks comprehensive!');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gap analysis failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h3 style={{ marginBottom: 4 }}>Coverage gap detection</h3>
      <p style={{ marginBottom: 20 }}>
        Analyse your existing test suite and surface areas with low or no coverage, ranked by risk.
      </p>

      {error && <div style={{ marginBottom: 14 }}><Alert type={error.includes('comprehensive') ? 'success' : 'error'}>{error}</Alert></div>}

      <Button variant="primary" loading={loading} onClick={analyseGaps} style={{ marginBottom: 24 }}>
        ◎ Analyse gaps
      </Button>

      {generated && (
        <div style={{ marginBottom: 16 }}>
          <Alert type="success">{generated}</Alert>
        </div>
      )}

      {gaps.map((gap, i) => (
        <div key={i} style={{
          border: '1px solid var(--border-color)', borderRadius: 10,
          marginBottom: 12, padding: '14px 16px',
          borderLeft: `3px solid ${RISK_COLOR[gap.risk]}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{gap.area}</span>
                <span style={{
                  fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                  background: gap.risk === 'high' ? '#fee2e2' : gap.risk === 'medium' ? '#fef3c7' : '#dcfce7',
                  color: RISK_COLOR[gap.risk],
                }}>
                  {gap.risk.charAt(0).toUpperCase() + gap.risk.slice(1)} risk
                </span>
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', lineHeight: 1.5, marginBottom: 8 }}>
                {gap.reason}
              </div>
              {/* Coverage bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 6, background: 'var(--gray-200)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${gap.coverage}%`,
                    background: gap.coverage < 20 ? 'var(--color-danger)' : gap.coverage < 60 ? 'var(--color-warning)' : 'var(--color-success)',
                    transition: 'width 0.4s',
                  }} />
                </div>
                <span style={{
                  fontSize: '0.8125rem', fontWeight: 600, minWidth: 38, textAlign: 'right',
                  color: gap.coverage < 20 ? 'var(--color-danger)' : gap.coverage < 60 ? 'var(--color-warning)' : 'var(--color-success)',
                }}>
                  {gap.coverage}%
                </span>
              </div>
            </div>
            <Button
              variant="ghost" size="sm"
              style={{ flexShrink: 0, color: 'var(--color-primary)', fontSize: '0.8125rem' }}
              onClick={() => {
                setGenerated(`Generating cases for "${gap.area}" — switch to the Generate tab and paste the area name as your requirement.`);
              }}
            >
              ✦ Generate cases
            </Button>
          </div>
        </div>
      ))}

      {!loading && gaps.length === 0 && !error && (
        <div style={{
          padding: '36px 24px', textAlign: 'center',
          color: 'var(--gray-400)', fontSize: '0.875rem',
        }}>
          Click "Analyse gaps" to scan your test suite for coverage gaps
        </div>
      )}
    </div>
  );
}
