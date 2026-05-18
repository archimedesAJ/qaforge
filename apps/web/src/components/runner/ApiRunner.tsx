import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Alert } from '../shared/ui';
import { AssertionBuilder } from '../editor/StepBuilder';
import type { Assertion } from '../editor/StepBuilder';
import { api } from '../../lib/api';
import type { TestCase, ApiRequestConfig } from '@qaforge/types';

interface ApiRunnerProps {
  projectId: string;
  runId: string;
  testCase: TestCase;
  onComplete: () => void;
  onCancel: () => void;
}

interface AssertionResult extends Assertion {
  actual: unknown;
  pass: boolean;
}

interface RunResult {
  statusCode: number;
  responseTimeMs: number;
  body: unknown;
  headers: Record<string, string>;
  assertions: AssertionResult[];
  allPassed: boolean;
  error?: string;
}

function interpolate(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function evaluate(
  assertion: Assertion,
  statusCode: number,
  body: unknown,
  responseTimeMs: number
): AssertionResult {
  let actual: unknown;
  if (assertion.field === 'status') actual = statusCode;
  else if (assertion.field === 'response_time_ms') actual = responseTimeMs;
  else actual = getByPath(body, assertion.field);

  let pass = false;
  switch (assertion.op) {
    case 'eq':       pass = String(actual) === String(assertion.expected); break;
    case 'ne':       pass = String(actual) !== String(assertion.expected); break;
    case 'gt':       pass = Number(actual) > Number(assertion.expected); break;
    case 'lt':       pass = Number(actual) < Number(assertion.expected); break;
    case 'contains': pass = String(actual).includes(String(assertion.expected)); break;
    case 'exists':   pass = actual !== undefined && actual !== null; break;
  }
  return { ...assertion, actual, pass };
}

export function ApiRunner({ projectId, runId, testCase, onComplete, onCancel }: ApiRunnerProps) {
  const qc = useQueryClient();
  const config = testCase.steps as ApiRequestConfig;

  const [method, setMethod] = useState<string>(config?.method ?? 'GET');
  const [url, setUrl]             = useState(config?.url ?? '');
  const [headersRaw, setHeadersRaw] = useState(
    config?.headers
      ? typeof config.headers === 'string'
        ? config.headers
        : Object.entries(config.headers).map(([k, v]) => `${k}: ${v}`).join('\n')
      : ''
  );
  const [bodyRaw, setBodyRaw]     = useState(
    config?.body ? JSON.stringify(config.body, null, 2) : ''
  );
  const [assertions, setAssertions] = useState<Assertion[]>(
    (config?.assertions as Assertion[]) ?? []
  );
  const [variables, setVariables] = useState<Array<{ key: string; value: string }>>([
    { key: 'token',    value: '' },
    { key: 'base_url', value: '' },
  ]);
  const [activeTab, setActiveTab] = useState<'body' | 'headers' | 'assertions' | 'variables'>('body');
  const [running, setRunning]     = useState(false);
  const [result, setResult]       = useState<RunResult | null>(null);
  const [submitError, setSubmitError] = useState('');

  const submitResult = useMutation({
    mutationFn: (r: RunResult) =>
      api.post(`projects/${projectId}/runs/${runId}/results`, {
        results: [{
          testCaseId: testCase.id,
          status: r.allPassed ? 'pass' : 'fail',
          durationMs: r.responseTimeMs,
          stepsLog: {
            request: { method, url },
            response: { statusCode: r.statusCode, body: r.body },
            assertions: r.assertions,
          },
          errorMessage: r.error,
        }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] });
      onComplete();
    },
    onError: (err: Error) => setSubmitError(err.message),
  });

  function parseHeaders(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    raw.split('\n').forEach(line => {
      const idx = line.indexOf(':');
      if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    return out;
  }

  async function runRequest() {
    setRunning(true);
    setResult(null);
    setSubmitError('');

    const varMap = Object.fromEntries(variables.map(v => [v.key, v.value]));
    const resolvedUrl     = interpolate(url, varMap);
    const resolvedHeaders = parseHeaders(interpolate(headersRaw, varMap));
    const resolvedBody    = bodyRaw ? interpolate(bodyRaw, varMap) : undefined;
    const start = performance.now();

    try {
      const res = await fetch(resolvedUrl, {
        method,
        headers: { 'Content-Type': 'application/json', ...resolvedHeaders },
        body: resolvedBody && method !== 'GET' && method !== 'DELETE' ? resolvedBody : undefined,
      });

      const responseTimeMs = Math.round(performance.now() - start);
      const contentType = res.headers.get('content-type') ?? '';
      let body: unknown;
      try { body = contentType.includes('json') ? await res.json() : await res.text(); }
      catch { body = null; }

      const assertionResults = assertions.map(a =>
        evaluate(a, res.status, body, responseTimeMs)
      );
      const allPassed = assertionResults.length === 0
        ? res.ok
        : assertionResults.every(a => a.pass);

      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k] = v; });

      setResult({ statusCode: res.status, responseTimeMs, body, headers, assertions: assertionResults, allPassed });
    } catch (err) {
      setResult({
        statusCode: 0,
        responseTimeMs: Math.round(performance.now() - start),
        body: null, headers: {}, assertions: [], allPassed: false,
        error: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setRunning(false);
    }
  }

  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const METHOD_COLORS: Record<string, string> = {
    GET: '#16a34a', POST: '#2563eb', PUT: '#d97706', PATCH: '#7c3aed', DELETE: '#dc2626',
  };

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
            API runner · Run #{runId.slice(-6)}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>✕ Cancel</Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* URL bar */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              style={{
                width: 96, padding: '8px 10px', borderRadius: 8,
                border: '1px solid var(--border-color)', cursor: 'pointer',
                fontWeight: 700, fontSize: '0.875rem', fontFamily: 'monospace',
                color: METHOD_COLORS[method] ?? 'var(--gray-700)',
                background: 'var(--surface-base)',
              }}
            >
              {METHODS.map(m => (
                <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>{m}</option>
              ))}
            </select>
            <input
              className="input"
              style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.9rem' }}
              placeholder="https://api.example.com/v1/endpoint"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runRequest(); }}
            />
            <Button variant="primary" loading={running} onClick={runRequest} style={{ minWidth: 80 }}>
              {running ? 'Running…' : '▶ Run'}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 20px' }}>
          {([
            { id: 'body',       label: 'Body' },
            { id: 'headers',    label: 'Headers' },
            { id: 'assertions', label: `Assertions (${assertions.length})` },
            { id: 'variables',  label: 'Variables' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.875rem', fontFamily: 'inherit',
              color: activeTab === t.id ? 'var(--color-primary)' : 'var(--gray-500)',
              borderBottom: `2px solid ${activeTab === t.id ? 'var(--color-primary)' : 'transparent'}`,
              marginBottom: -1, fontWeight: activeTab === t.id ? 500 : 400, transition: 'color 0.15s',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ padding: '16px 20px' }}>
          {activeTab === 'body' && (
            <>
              <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginBottom: 6 }}>
                JSON body — not sent for GET / DELETE requests
              </div>
              <textarea
                className="input"
                rows={8}
                value={bodyRaw}
                onChange={e => setBodyRaw(e.target.value)}
                placeholder={'{\n  "key": "value"\n}'}
                style={{ fontFamily: 'monospace', fontSize: '0.875rem', resize: 'vertical' }}
              />
            </>
          )}

          {activeTab === 'headers' && (
            <>
              <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginBottom: 6 }}>
                One per line — <code style={{ fontFamily: 'monospace' }}>Key: Value</code>
              </div>
              <textarea
                className="input"
                rows={6}
                value={headersRaw}
                onChange={e => setHeadersRaw(e.target.value)}
                placeholder={'Authorization: Bearer {{token}}\nContent-Type: application/json'}
                style={{ fontFamily: 'monospace', fontSize: '0.875rem', resize: 'vertical' }}
              />
            </>
          )}

          {activeTab === 'assertions' && (
            <>
              <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginBottom: 10 }}>
                Use <code style={{ fontFamily: 'monospace' }}>status</code>, <code style={{ fontFamily: 'monospace' }}>response_time_ms</code>, or dot-path for body fields (e.g. <code style={{ fontFamily: 'monospace' }}>data.id</code>)
              </div>
              <AssertionBuilder assertions={assertions} onChange={setAssertions} />
            </>
          )}

          {activeTab === 'variables' && (
            <>
              <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginBottom: 10 }}>
                Use <code style={{ fontFamily: 'monospace' }}>{'{{name}}'}</code> in URL, headers, and body
              </div>
              {variables.map((v, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    className="input"
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.875rem' }}
                    placeholder="variable_name"
                    value={v.key}
                    onChange={e => setVariables(prev => prev.map((p, j) => j === i ? { ...p, key: e.target.value } : p))}
                  />
                  <input
                    className="input"
                    style={{ flex: 2, fontFamily: 'monospace', fontSize: '0.875rem' }}
                    placeholder="value"
                    value={v.value}
                    onChange={e => setVariables(prev => prev.map((p, j) => j === i ? { ...p, value: e.target.value } : p))}
                  />
                  <button
                    onClick={() => setVariables(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', fontSize: '1rem', padding: '0 4px' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-danger)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-300)'}
                  >✕</button>
                </div>
              ))}
              <button
                onClick={() => setVariables(prev => [...prev, { key: '', value: '' }])}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', background: 'none',
                  border: '1px dashed var(--border-color)', borderRadius: 6,
                  cursor: 'pointer', fontSize: '0.875rem', color: 'var(--gray-500)',
                  width: '100%', justifyContent: 'center', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)'; (e.currentTarget as HTMLElement).style.color = 'var(--gray-500)'; }}
              >+ Add variable</button>
            </>
          )}
        </div>

        {/* Response panel */}
        {result && (
          <div style={{ margin: '0 20px 20px', border: `1.5px solid ${result.allPassed ? 'var(--color-success)' : result.error ? 'var(--border-color)' : 'var(--color-danger)'}`, borderRadius: 10, overflow: 'hidden' }}>

            {/* Response status bar */}
            <div style={{
              padding: '10px 14px',
              background: result.allPassed ? 'var(--color-success-light)' : result.error ? 'var(--gray-50)' : 'var(--color-danger-light)',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              {result.statusCode > 0 && (
                <span style={{
                  fontFamily: 'monospace', fontWeight: 700, fontSize: '1rem',
                  color: result.statusCode < 300 ? 'var(--color-success)' : result.statusCode < 400 ? 'var(--color-warning)' : 'var(--color-danger)',
                }}>{result.statusCode}</span>
              )}
              <span style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>{result.responseTimeMs}ms</span>
              <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: '0.875rem', color: result.allPassed ? 'var(--color-success)' : 'var(--color-danger)' }}>
                {result.error ? '✕ Error' : result.allPassed ? '✓ All assertions passed' : '✕ Assertions failed'}
              </span>
            </div>

            <div style={{ padding: '14px' }}>

              {/* Network error */}
              {result.error && (
                <div style={{
                  padding: '10px 12px', background: 'var(--color-danger-light)',
                  border: '1px solid #fecaca', borderRadius: 6, marginBottom: 12,
                  fontFamily: 'monospace', fontSize: '0.875rem', color: 'var(--color-danger)',
                }}>{result.error}</div>
              )}

              {/* Assertion results */}
              {result.assertions.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Assertions
                  </div>
                  {result.assertions.map((a, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem',
                    }}>
                      <span style={{ color: a.pass ? 'var(--color-success)' : 'var(--color-danger)', flexShrink: 0, fontSize: '1.1rem', width: 18 }}>
                        {a.pass ? '✓' : '✕'}
                      </span>
                      <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--gray-700)' }}>
                        {a.field} {a.op}{a.op !== 'exists' ? ` ${a.expected}` : ''}
                      </code>
                      <span style={{ color: 'var(--gray-400)', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                        got: {a.actual === undefined ? 'undefined' : String(a.actual)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Response body */}
              {result.body !== null && result.body !== undefined && (
                <>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Response body
                  </div>
                  <pre style={{
                    background: 'var(--gray-50)', border: '1px solid var(--border-color)',
                    borderRadius: 6, padding: '10px 12px', margin: 0,
                    fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--gray-700)',
                    overflow: 'auto', maxHeight: 240, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  }}>
                    {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
                  </pre>
                </>
              )}
            </div>
          </div>
        )}

        {/* Submit area */}
        {result && !result.error && (
          <div style={{
            margin: '0 20px 20px', padding: '14px 16px',
            background: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: 10,
          }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: 12 }}>
              {result.allPassed ? 'All assertions passed — submit to run?' : 'Some assertions failed — submit as failure?'}
            </div>
            {submitError && <div style={{ marginBottom: 10 }}><Alert type="error">{submitError}</Alert></div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={runRequest}>Re-run</Button>
              <Button
                variant={result.allPassed ? 'primary' : 'danger'}
                loading={submitResult.isPending}
                onClick={() => submitResult.mutate(result)}
              >
                Submit {result.allPassed ? 'pass' : 'failure'}
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
