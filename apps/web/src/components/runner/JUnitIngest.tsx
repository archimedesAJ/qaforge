import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Alert } from '../shared/ui';

interface JUnitIngestProps {
  projectId: string;
  runId: string;
  onDone: () => void;
  onCancel: () => void;
}

interface IngestResult {
  processed:    number;
  auto_imported: number;
  run_id:       string;
  totals: {
    tests:      number;
    failures:   number;
    errors:     number;
    skipped:    number;
    durationMs: number;
  };
  suites: Array<{ name: string; tests: number }>;
}

export function JUnitIngest({ projectId, runId, onDone, onCancel }: JUnitIngestProps) {
  const qc = useQueryClient();
  const [xml, setXml]         = useState('');
  const [result, setResult]   = useState<IngestResult | null>(null);
  const [error, setError]     = useState('');
  const fileRef               = useRef<HTMLInputElement>(null);

  const ingest = useMutation({
    mutationFn: async (xmlBody: string) => {
      const res = await fetch(
        `/projects/${projectId}/runs/${runId}/ingest/junit`,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/xml',
            'Authorization': `Bearer ${localStorage.getItem('qaforge_token') ?? ''}`,
          },
          body: xmlBody,
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? 'Ingest failed');
      }
      return res.json() as Promise<IngestResult>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['run-results', runId] });
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      setResult(data);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = e => setXml((e.target?.result as string) ?? '');
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="CheckoutSuite" tests="3" failures="1" errors="0" skipped="0" time="4.2">
    <testcase name="Guest checkout with valid card" classname="CheckoutSuite" time="1.8"/>
    <testcase name="Declined card shows error"       classname="CheckoutSuite" time="1.1"/>
    <testcase name="Coupon code applies discount"    classname="CheckoutSuite" time="1.3">
      <failure message="Expected discount applied but total unchanged">
        AssertionError: expected 90.00 to equal 81.00
          at checkout.spec.ts:44
      </failure>
    </testcase>
  </testsuite>
</testsuites>`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Ingest JUnit XML</h3>
          <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
            Paste or upload test-results.xml — Run #{runId.slice(-6)}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>✕ Cancel</Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

        {!result ? (
          <>
            {error && <div style={{ marginBottom: 14 }}><Alert type="error">{error}</Alert></div>}

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
              style={{
                border: '2px dashed var(--border-color)', borderRadius: 10,
                padding: '28px 20px', textAlign: 'center', cursor: 'pointer',
                marginBottom: 16, transition: 'all 0.15s',
                background: 'var(--gray-50)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary)';
                (e.currentTarget as HTMLElement).style.background  = 'var(--color-primary-light)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)';
                (e.currentTarget as HTMLElement).style.background  = 'var(--gray-50)';
              }}
            >
              <div style={{ fontSize: '1.75rem', marginBottom: 8 }}>📄</div>
              <div style={{ fontWeight: 500, color: 'var(--gray-700)', marginBottom: 4 }}>
                Drop your JUnit XML file here
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--gray-400)' }}>
                or click to browse — accepts .xml files from Playwright, Cypress, Jest, JUnit, TestNG
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xml,text/xml,application/xml"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>

            {/* XML textarea */}
            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: '0.8125rem', fontWeight: 500, color: 'var(--gray-600)',
                marginBottom: 6, display: 'flex', justifyContent: 'space-between',
              }}>
                <span>Or paste XML directly</span>
                <button
                  onClick={() => setXml(SAMPLE_XML)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '0.8125rem', color: 'var(--color-primary)',
                  }}
                >
                  Load sample XML
                </button>
              </div>
              <textarea
                className="input"
                rows={12}
                value={xml}
                onChange={e => setXml(e.target.value)}
                placeholder={'<?xml version="1.0"?>\n<testsuites>\n  <testsuite name="..." tests="3">\n    ...\n  </testsuite>\n</testsuites>'}
                style={{ fontFamily: 'monospace', fontSize: '0.8125rem', resize: 'vertical' }}
              />
            </div>

            {/* Format guide */}
            <div style={{
              padding: '12px 14px', background: 'var(--color-info-light)',
              border: '1px solid #bfdbfe', borderRadius: 8, marginBottom: 16,
              fontSize: '0.8125rem', color: 'var(--gray-600)', lineHeight: 1.6,
            }}>
              <strong style={{ color: 'var(--color-primary)' }}>Supported formats:</strong>{' '}
              Standard JUnit XML with <code style={{ fontFamily: 'monospace' }}>&lt;testsuites&gt;</code> or bare{' '}
              <code style={{ fontFamily: 'monospace' }}>&lt;testsuite&gt;</code> root.
              Works with Playwright, Cypress, Jest, JUnit 4/5, TestNG, and pytest.
              Test cases are matched to existing cases by title — unmatched ones are auto-created.
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={onCancel}>Cancel</Button>
              <Button
                variant="primary"
                loading={ingest.isPending}
                disabled={!xml.trim()}
                onClick={() => { setError(''); ingest.mutate(xml); }}
              >
                Ingest results
              </Button>
            </div>
          </>
        ) : (

          /* Success view */
          <div>
            <div style={{
              padding: '16px 18px', background: 'var(--color-success-light)',
              border: '1px solid #bbf7d0', borderRadius: 10, marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ fontSize: '1.5rem' }}>✓</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--color-success)', fontSize: '1rem' }}>
                  Ingest complete
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginTop: 2 }}>
                  {result.processed} result{result.processed !== 1 ? 's' : ''} processed
                  {result.auto_imported > 0 && ` · ${result.auto_imported} auto-imported`}
                </div>
              </div>
            </div>

            {/* Totals */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Total',    value: result.totals.tests,    color: 'var(--gray-900)'       },
                { label: 'Failures', value: result.totals.failures, color: result.totals.failures > 0 ? 'var(--color-danger)'  : 'var(--gray-900)' },
                { label: 'Errors',   value: result.totals.errors,   color: result.totals.errors   > 0 ? 'var(--color-danger)'  : 'var(--gray-900)' },
                { label: 'Skipped',  value: result.totals.skipped,  color: result.totals.skipped  > 0 ? 'var(--color-warning)' : 'var(--gray-900)' },
              ].map(s => (
                <div key={s.label} style={{
                  background: 'var(--gray-50)', border: '1px solid var(--border-color)',
                  borderRadius: 8, padding: '12px 14px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Suites */}
            {result.suites.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-header"><span className="card-title">Suites ingested</span></div>
                {result.suites.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 18px', borderBottom: i < result.suites.length - 1 ? '1px solid var(--border-color)' : 'none',
                    fontSize: '0.9rem',
                  }}>
                    <span style={{ fontWeight: 500 }}>{s.name}</span>
                    <span style={{ color: 'var(--gray-400)', fontSize: '0.8125rem' }}>
                      {s.tests} test{s.tests !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={() => { setResult(null); setXml(''); }}>
                Ingest another file
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
