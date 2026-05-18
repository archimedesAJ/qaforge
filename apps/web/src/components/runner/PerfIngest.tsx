import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Alert } from '../shared/ui';

interface PerfIngestProps {
  projectId: string;
  runId: string;
  onDone: () => void;
  onCancel: () => void;
}

interface PerfResult {
  status:             'pass' | 'fail';
  threshold_breaches: Array<{ metric: string; actual: number; limit: number; pctOver: number }>;
  is_new_baseline:    boolean;
  scenario:           string;
}

export function PerfIngest({ projectId, runId, onDone, onCancel }: PerfIngestProps) {
  const qc = useQueryClient();

  // Payload fields
  const [scenario,   setScenario]   = useState('');
  const [tool,       setTool]       = useState('k6');
  const [vus,        setVus]        = useState('100');
  const [durationS,  setDurationS]  = useState('300');
  const [p50Ms,      setP50Ms]      = useState('');
  const [p95Ms,      setP95Ms]      = useState('');
  const [p99Ms,      setP99Ms]      = useState('');
  const [errorRate,  setErrorRate]  = useState('');
  const [rps,        setRps]        = useState('');

  // Optional threshold overrides
  const [showThresh,    setShowThresh]    = useState(false);
  const [threshP95,     setThreshP95]     = useState('');
  const [threshP99,     setThreshP99]     = useState('');
  const [threshErrRate, setThreshErrRate] = useState('');
  const [threshMinRps,  setThreshMinRps]  = useState('');

  const [result, setResult] = useState<PerfResult | null>(null);
  const [error,  setError]  = useState('');

  const ingest = useMutation({
    mutationFn: () =>
      fetch(`/projects/${projectId}/runs/${runId}/ingest/perf`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${localStorage.getItem('qaforge_token') ?? ''}`,
        },
        body: JSON.stringify({
          scenario:  scenario.trim(),
          tool,
          vus:       Number(vus),
          durationS: Number(durationS),
          p50Ms:     Number(p50Ms),
          p95Ms:     Number(p95Ms),
          p99Ms:     Number(p99Ms),
          errorRate: Number(errorRate),
          rps:       Number(rps),
          ...(showThresh && {
            thresholds: {
              ...(threshP95     && { p95Ms:        Number(threshP95)     }),
              ...(threshP99     && { p99Ms:        Number(threshP99)     }),
              ...(threshErrRate && { maxErrorRate: Number(threshErrRate) }),
              ...(threshMinRps  && { minRps:       Number(threshMinRps)  }),
            },
          }),
        }),
      }).then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error ?? 'Ingest failed');
        }
        return res.json() as Promise<PerfResult>;
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['run-results', runId] });
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      setResult(data);
    },
    onError: (err: Error) => setError(err.message),
  });

  function valid() {
    return scenario.trim() && p95Ms && p99Ms && errorRate && rps;
  }

  // Fill with sample data
  function loadSample() {
    setScenario('checkout_flow');
    setVus('100'); setDurationS('300');
    setP50Ms('182'); setP95Ms('394'); setP99Ms('612');
    setErrorRate('0.008'); setRps('88.4');
  }

  const BREACH_LABEL: Record<string, string> = {
    p95_latency_ms: 'p95 latency',
    p99_latency_ms: 'p99 latency',
    error_rate:     'Error rate',
    rps:            'Requests/sec',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Ingest performance results</h3>
          <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
            k6 / Locust / JMeter — Run #{runId.slice(-6)}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>✕ Cancel</Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

        {!result ? (
          <>
            {error && <div style={{ marginBottom: 14 }}><Alert type="error">{error}</Alert></div>}

            {/* CI command reference */}
            <div style={{
              padding: '12px 14px', background: 'var(--gray-50)',
              border: '1px solid var(--border-color)', borderRadius: 8, marginBottom: 20,
            }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--gray-600)', marginBottom: 6 }}>
                From CI — pipe k6 summary directly:
              </div>
              <pre style={{
                margin: 0, fontFamily: 'monospace', fontSize: '0.75rem',
                color: 'var(--gray-700)', lineHeight: 1.6, overflowX: 'auto',
              }}>{`k6 run --out json=out.json script.js
# extract metrics and POST:
curl -X POST $QAFORGE_URL/projects/$PROJECT_ID/runs/$RUN_ID/ingest/perf \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"scenario":"checkout","vus":100,"durationS":300, \\
       "p50Ms":182,"p95Ms":394,"p99Ms":612, \\
       "errorRate":0.008,"rps":88.4}'`}</pre>
              <button
                onClick={loadSample}
                style={{
                  marginTop: 8, background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.8125rem', color: 'var(--color-primary)', padding: 0,
                }}
              >
                Load sample values ↗
              </button>
            </div>

            {/* Form */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <Input
                  label="Scenario name *"
                  value={scenario}
                  onChange={e => setScenario(e.target.value)}
                  placeholder="e.g. checkout_flow"
                />
              </div>
              <Select
                label="Tool"
                value={tool}
                onChange={e => setTool(e.target.value)}
                options={[
                  { value: 'k6',     label: 'k6'      },
                  { value: 'locust', label: 'Locust'  },
                  { value: 'jmeter', label: 'JMeter'  },
                  { value: 'other',  label: 'Other'   },
                ]}
              />
              <Input label="Virtual users"  type="number" value={vus}       onChange={e => setVus(e.target.value)}       placeholder="100" />
              <Input label="Duration (sec)" type="number" value={durationS} onChange={e => setDurationS(e.target.value)} placeholder="300" />
            </div>

            {/* Latency */}
            <div style={{
              padding: '12px 14px', background: 'var(--color-primary-light)',
              border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 12,
            }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-primary)', marginBottom: 10 }}>
                Latency metrics (ms)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <Input label="p50 (median)" type="number" value={p50Ms} onChange={e => setP50Ms(e.target.value)} placeholder="180" />
                <Input label="p95 *"        type="number" value={p95Ms} onChange={e => setP95Ms(e.target.value)} placeholder="400" />
                <Input label="p99 *"        type="number" value={p99Ms} onChange={e => setP99Ms(e.target.value)} placeholder="800" />
              </div>
            </div>

            {/* Throughput + errors */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <Input
                label="Error rate * (0.02 = 2%)"
                type="number" step="0.001"
                value={errorRate}
                onChange={e => setErrorRate(e.target.value)}
                placeholder="0.008"
              />
              <Input
                label="Requests/sec *"
                type="number"
                value={rps}
                onChange={e => setRps(e.target.value)}
                placeholder="88.4"
              />
            </div>

            {/* Threshold overrides */}
            <div style={{ marginBottom: 20 }}>
              <button
                onClick={() => setShowThresh(v => !v)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '0.875rem', color: 'var(--color-primary)',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {showThresh ? '▾' : '▸'} Override thresholds (optional)
              </button>

              {showThresh && (
                <div style={{
                  marginTop: 10, padding: '12px 14px',
                  background: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: 8,
                }}>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', marginBottom: 10 }}>
                    Leave blank to use auto-derived thresholds (baseline × 1.2). Set explicit values to override.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Input label="Max p95 (ms)"    type="number" value={threshP95}     onChange={e => setThreshP95(e.target.value)}     placeholder="500" />
                    <Input label="Max p99 (ms)"    type="number" value={threshP99}     onChange={e => setThreshP99(e.target.value)}     placeholder="800" />
                    <Input label="Max error rate"  type="number" value={threshErrRate} onChange={e => setThreshErrRate(e.target.value)} placeholder="0.02" step="0.001" />
                    <Input label="Min RPS"         type="number" value={threshMinRps}  onChange={e => setThreshMinRps(e.target.value)}  placeholder="80" />
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={onCancel}>Cancel</Button>
              <Button
                variant="primary"
                loading={ingest.isPending}
                disabled={!valid()}
                onClick={() => { setError(''); ingest.mutate(); }}
              >
                Submit results
              </Button>
            </div>
          </>
        ) : (

          /* Result view */
          <div>
            {/* Pass / fail banner */}
            <div style={{
              padding: '16px 18px', marginBottom: 20, borderRadius: 10,
              background: result.status === 'pass' ? 'var(--color-success-light)' : 'var(--color-danger-light)',
              border: `1px solid ${result.status === 'pass' ? '#bbf7d0' : '#fecaca'}`,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ fontSize: '1.5rem' }}>
                {result.status === 'pass' ? '✓' : '✕'}
              </span>
              <div>
                <div style={{
                  fontWeight: 600, fontSize: '1rem',
                  color: result.status === 'pass' ? 'var(--color-success)' : 'var(--color-danger)',
                }}>
                  {result.status === 'pass' ? 'All thresholds met' : 'Threshold breaches detected'}
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginTop: 2 }}>
                  Scenario: <strong>{result.scenario}</strong>
                  {result.is_new_baseline && (
                    <span style={{
                      marginLeft: 10, fontSize: '0.8125rem', padding: '1px 8px', borderRadius: 20,
                      background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                    }}>
                      ★ First run — baseline set
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Breaches */}
            {result.threshold_breaches.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-header">
                  <span className="card-title" style={{ color: 'var(--color-danger)' }}>
                    ✕ Threshold breaches ({result.threshold_breaches.length})
                  </span>
                </div>
                {result.threshold_breaches.map((b, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 18px',
                    borderBottom: i < result.threshold_breaches.length - 1 ? '1px solid var(--border-color)' : 'none',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                        {BREACH_LABEL[b.metric] ?? b.metric}
                      </div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
                        Limit: {b.limit}{b.metric.includes('rate') ? '' : 'ms'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: 'var(--color-danger)', fontSize: '1rem' }}>
                        {b.actual}{b.metric.includes('rate') ? '' : 'ms'}
                      </div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>
                        +{b.pctOver}% over limit
                      </div>
                    </div>
                    {/* Visual overage bar */}
                    <div style={{ width: 80 }}>
                      <div style={{ height: 6, background: 'var(--gray-200)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 3,
                          width: `${Math.min(100, b.pctOver)}%`,
                          background: 'var(--color-danger)',
                        }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={() => { setResult(null); }}>
                Submit another
              </Button>
              <Button variant="primary" onClick={onDone}>
                View results →
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
