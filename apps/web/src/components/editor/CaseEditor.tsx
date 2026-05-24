import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Button, Input, Textarea, Select, Alert, TagInput } from '../shared/ui';
import { StepBuilder, AssertionBuilder } from './StepBuilder';
import type { Assertion } from './StepBuilder';
import { api } from '../../lib/api';
import type { TestCase, TestType, Priority, ManualStep } from '@qaforge/types';

const TEST_TYPES: Array<{ value: TestType; label: string; desc: string }> = [
  { value: 'manual',      label: 'Manual',      desc: 'Human-executed step checklist' },
  { value: 'functional',  label: 'Functional',  desc: 'Business logic verification' },
  { value: 'ui_auto',     label: 'UI Automation', desc: 'Playwright / Cypress / Selenium / Appium' },
  { value: 'api',         label: 'API',         desc: 'HTTP request + assertions' },
  { value: 'perf',        label: 'Performance', desc: 'k6 / Locust / JMeter' },
  { value: 'exploratory', label: 'Exploratory', desc: 'Session-based, free-form' },
];

const PRIORITIES: Array<{ value: Priority; label: string }> = [
  { value: 'p0', label: 'P0 — Critical' },
  { value: 'p1', label: 'P1 — High' },
  { value: 'p2', label: 'P2 — Medium' },
  { value: 'p3', label: 'P3 — Low' },
];

interface CaseEditorProps {
  projectId: string;
  existing?: TestCase | null;
  defaultSuiteId?: string | null;
  onSaved: (tc: TestCase) => void;
  onCancel: () => void;
}

export function CaseEditor({
  projectId, existing, defaultSuiteId, onSaved, onCancel,
}: CaseEditorProps) {
  const qc = useQueryClient();
  const isEditing = !!existing;

  // ── Form state ────────────────────────────────────────────
  const [title, setTitle] = useState(existing?.title ?? '');
  const [type, setType] = useState<TestType>(existing?.type ?? 'manual');
  const [priority, setPriority] = useState<Priority>(existing?.priority ?? 'p2');
  const [suiteId, setSuiteId] = useState<string>(existing?.suiteId ?? defaultSuiteId ?? '');
  const [tags, setTags] = useState<string[]>((existing?.tags as string[]) ?? []);
  const [preconditions, setPreconditions] = useState(existing?.preconditions ?? '');
  const [error, setError] = useState('');

  // Type-specific state
  const [steps, setSteps] = useState<ManualStep[]>(() => {
    if (existing && (existing.type === 'manual' || existing.type === 'functional')) {
      return ((existing.steps as unknown) as ManualStep[]) ?? [];
    }
    return [];
  });

  const [apiConfig, setApiConfig] = useState(() => {
    if (existing?.type === 'api') {
      const s = (existing.steps as unknown) as Record<string, unknown>;
      return {
        method: (s?.method as string) ?? 'POST',
        url: (s?.url as string) ?? '',
        headers: s?.headers
          ? typeof s.headers === 'string'
            ? s.headers
            : Object.entries(s.headers as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(', ')
          : '',
        body: s?.body ? JSON.stringify(s.body, null, 2) : '',
        assertions: (s?.assertions as Assertion[]) ?? [],
        responseTimeThresholdMs: (s?.responseTimeThresholdMs as number) ?? 500,
      };
    }
    return { method: 'POST', url: '', headers: '', body: '', assertions: [], responseTimeThresholdMs: 500 };
  });

  const [perfConfig, setPerfConfig] = useState(() => {
    if (existing?.type === 'perf') {
      const s = (existing.steps as unknown) as Record<string, unknown>;
      return {
        tool: (s?.tool as string) ?? 'k6',
        scriptPath: (s?.scriptPath as string) ?? '',
        vus: (s?.vus as number) ?? 100,
        duration: (s?.duration as string) ?? '5m',
        p95Ms: ((s?.thresholds as Record<string, number>)?.p95Ms) ?? 500,
        p99Ms: ((s?.thresholds as Record<string, number>)?.p99Ms) ?? 800,
        maxErrorRate: ((s?.thresholds as Record<string, number>)?.maxErrorRate) ?? 0.02,
      };
    }
    return { tool: 'k6', scriptPath: '', vus: 100, duration: '5m', p95Ms: 500, p99Ms: 800, maxErrorRate: 0.02 };
  });

  const [charter, setCharter] = useState(() => {
    if (existing?.type === 'exploratory') {
      const s = (existing.steps as unknown) as Record<string, unknown>;
      return {
        charter: (s?.charter as string) ?? '',
        durationMins: (s?.durationMins as number) ?? 60,
        area: (s?.area as string) ?? '',
        riskFocus: (s?.riskFocus as string) ?? 'Functionality',
        exitCriteria: (s?.exitCriteria as string) ?? '',
      };
    }
    return { charter: '', durationMins: 60, area: '', riskFocus: 'Functionality', exitCriteria: '' };
  });

  const [uiAutoConfig, setUiAutoConfig] = useState(() => {
    if (existing?.type === 'ui_auto') {
      const s = (existing.steps as unknown) as Record<string, unknown>;
      return {
        framework: (s?.framework as string) ?? 'Playwright',
        scriptPath: (s?.scriptPath as string) ?? '',
        testName: (s?.testName as string) ?? '',
        description: (s?.description as string) ?? '',
      };
    }
    return { framework: 'Playwright', scriptPath: '', testName: '', description: '' };
  });

  // Load suites for the selector
  const { data: suitesData } = useQuery({
    queryKey: ['suites', projectId],
    queryFn: () => api.get<{ suites: Array<{ id: string; name: string }> }>(`projects/${projectId}/suites`),
    enabled: !!projectId,
  });
  const suites = suitesData?.suites ?? [];

  // ── Save mutation ─────────────────────────────────────────
  const save = useMutation({
    mutationFn: (body: Partial<TestCase>) =>
      isEditing
        ? api.put<TestCase>(`projects/${projectId}/cases/${existing!.id}`, body)
        : api.post<TestCase>(`projects/${projectId}/cases`, body),
    onSuccess: (tc) => {
      qc.invalidateQueries({ queryKey: ['cases', projectId] });
      onSaved(tc);
    },
    onError: (err: Error) => setError(err.message),
  });

  function buildSteps(): unknown {
    if (type === 'manual' || type === 'functional') return steps;
    if (type === 'api') {
      let parsedBody: unknown = undefined;
      if (apiConfig.body.trim()) {
        try {
          parsedBody = JSON.parse(apiConfig.body);
        } catch {
          throw new Error('Request body is not valid JSON. Fix the syntax before saving.');
        }
      }
      const parsedHeaders: Record<string, string> = {};
      apiConfig.headers.split(',').forEach(pair => {
        const colonIdx = pair.indexOf(':');
        if (colonIdx > 0) {
          const key = pair.slice(0, colonIdx).trim();
          const value = pair.slice(colonIdx + 1).trim();
          if (key) parsedHeaders[key] = value;
        }
      });

      return {
        method: apiConfig.method, url: apiConfig.url,
        headers: parsedHeaders,
        body: parsedBody,
        assertions: apiConfig.assertions,
        responseTimeThresholdMs: apiConfig.responseTimeThresholdMs,
      };
    }
    if (type === 'perf') {
      return {
        tool: perfConfig.tool, scriptPath: perfConfig.scriptPath,
        vus: perfConfig.vus, duration: perfConfig.duration,
        thresholds: { p95Ms: perfConfig.p95Ms, p99Ms: perfConfig.p99Ms, maxErrorRate: perfConfig.maxErrorRate },
      };
    }
    if (type === 'exploratory') return charter;
    if (type === 'ui_auto') return uiAutoConfig;
    return undefined;
  }

  function handleSave() {
    setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    if (type === 'api' && !apiConfig.url.trim()) { setError('API URL is required'); return; }
    if (type === 'exploratory' && !charter.charter.trim()) { setError('Charter is required'); return; }

    let steps: TestCase['steps'];
    try {
      steps = buildSteps() as TestCase['steps'];
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid step configuration');
      return;
    }

    save.mutate({
      title: title.trim(),
      type, priority,
      suiteId: suiteId || undefined,
      tags,
      preconditions: preconditions || undefined,
      steps,
    });
  }

  const sectionHeader = (label: string) => (
    <div style={{
      fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-500)',
      textTransform: 'uppercase', letterSpacing: '0.06em',
      padding: '16px 0 8px',
      borderBottom: '1px solid var(--border-color)',
      marginBottom: 14,
    }}>{label}</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>{isEditing ? `Edit case` : 'New test case'}</h3>
            {isEditing && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
                v{existing!.version} → will create v{existing!.version + 1}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" size="sm" loading={save.isPending} onClick={handleSave}>
              {isEditing ? 'Save new version' : 'Create case'}
            </Button>
          </div>
        </div>
        {error && <div style={{ marginTop: 10 }}><Alert type="error">{error}</Alert></div>}
      </div>

      {/* Form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

        {/* Type selector */}
        {sectionHeader('Test type')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
          {TEST_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              style={{
                padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                border: `1.5px solid ${type === t.value ? 'var(--color-primary)' : 'var(--border-color)'}`,
                background: type === t.value ? 'var(--color-primary-light)' : 'var(--surface-base)',
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                fontSize: '0.875rem', fontWeight: 600,
                color: type === t.value ? 'var(--color-primary)' : 'var(--gray-700)',
              }}>{t.label}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: 2 }}>{t.desc}</div>
            </button>
          ))}
        </div>

        {/* Common fields */}
        {sectionHeader('Details')}
        <Input
          label="Title *"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Guest checkout completes with valid card"
          autoFocus
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Select
            label="Priority"
            value={priority}
            onChange={e => setPriority(e.target.value as Priority)}
            options={PRIORITIES}
          />
          <Select
            label="Suite"
            value={suiteId}
            onChange={e => setSuiteId(e.target.value)}
            options={[
              { value: '', label: '— No suite —' },
              ...suites.map(s => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>

        <TagInput label="Tags" tags={tags} onChange={setTags} />

        <Textarea
          label="Preconditions"
          value={preconditions}
          onChange={e => setPreconditions(e.target.value)}
          placeholder="What must be true before running this test…"
          rows={2}
        />

        {/* Type-specific fields */}
        {(type === 'manual' || type === 'functional') && (
          <>
            {sectionHeader('Steps')}
            <StepBuilder steps={steps} onChange={setSteps} />
          </>
        )}

        {type === 'ui_auto' && (
          <>
            {sectionHeader('Automation config')}
            <Select
              label="Framework"
              value={uiAutoConfig.framework}
              onChange={e => setUiAutoConfig(p => ({ ...p, framework: e.target.value }))}
              options={[
                { value: 'Playwright', label: 'Playwright' },
                { value: 'Cypress', label: 'Cypress' },
                { value: 'Selenium', label: 'Selenium' },
                { value: 'WebdriverIO', label: 'WebdriverIO' },
                { value: 'Appium', label: 'Appium' },
              ]}
            />
            <Input
              label="Script path"
              value={uiAutoConfig.scriptPath}
              onChange={e => setUiAutoConfig(p => ({ ...p, scriptPath: e.target.value }))}
              placeholder="tests/checkout/guest.spec.ts"
            />
            <Input
              label="Test name / ID matcher"
              value={uiAutoConfig.testName}
              onChange={e => setUiAutoConfig(p => ({ ...p, testName: e.target.value }))}
              placeholder="Guest checkout completes with valid card"
            />
            <Textarea
              label="Description"
              value={uiAutoConfig.description}
              onChange={e => setUiAutoConfig(p => ({ ...p, description: e.target.value }))}
              placeholder="What this automated test verifies…"
              rows={2}
            />
          </>
        )}

        {type === 'api' && (
          <>
            {sectionHeader('Request')}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <select
                className="input"
                style={{ width: 100, fontSize: '0.875rem', fontFamily: 'monospace' }}
                value={apiConfig.method}
                onChange={e => setApiConfig(p => ({ ...p, method: e.target.value }))}
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                className="input"
                style={{ flex: 1, fontSize: '0.875rem', fontFamily: 'monospace' }}
                placeholder="https://api.example.com/v1/endpoint"
                value={apiConfig.url}
                onChange={e => setApiConfig(p => ({ ...p, url: e.target.value }))}
              />
            </div>
            <Textarea
              label="Request body (JSON)"
              value={apiConfig.body}
              onChange={e => setApiConfig(p => ({ ...p, body: e.target.value }))}
              placeholder='{"key": "value"}'
              rows={3}
              style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
            />
            <Input
              label="Headers (key: value, comma-separated)"
              value={apiConfig.headers}
              onChange={e => setApiConfig(p => ({ ...p, headers: e.target.value }))}
              placeholder="Authorization: Bearer {{token}}, Content-Type: application/json"
              style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
            />
            {sectionHeader('Assertions')}
            <AssertionBuilder
              assertions={apiConfig.assertions}
              onChange={a => setApiConfig(p => ({ ...p, assertions: a }))}
            />
            <div style={{ marginTop: 12 }}>
              <Input
                label="Response time threshold (ms)"
                type="number"
                value={String(apiConfig.responseTimeThresholdMs)}
                onChange={e => setApiConfig(p => ({ ...p, responseTimeThresholdMs: Number(e.target.value) }))}
              />
            </div>
          </>
        )}

        {type === 'perf' && (
          <>
            {sectionHeader('Load config')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Select
                label="Tool"
                value={perfConfig.tool}
                onChange={e => setPerfConfig(p => ({ ...p, tool: e.target.value }))}
                options={[
                  { value: 'k6', label: 'k6' },
                  { value: 'locust', label: 'Locust' },
                  { value: 'jmeter', label: 'JMeter' },
                ]}
              />
              <Input
                label="Virtual users"
                type="number"
                value={String(perfConfig.vus)}
                onChange={e => setPerfConfig(p => ({ ...p, vus: Number(e.target.value) }))}
              />
              <Input
                label="Duration"
                value={perfConfig.duration}
                onChange={e => setPerfConfig(p => ({ ...p, duration: e.target.value }))}
                placeholder="5m"
              />
            </div>
            <Input
              label="Script / scenario path"
              value={perfConfig.scriptPath}
              onChange={e => setPerfConfig(p => ({ ...p, scriptPath: e.target.value }))}
              placeholder="load-tests/checkout.js"
            />
            {sectionHeader('Thresholds')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Input
                label="p95 max (ms)"
                type="number"
                value={String(perfConfig.p95Ms)}
                onChange={e => setPerfConfig(p => ({ ...p, p95Ms: Number(e.target.value) }))}
              />
              <Input
                label="p99 max (ms)"
                type="number"
                value={String(perfConfig.p99Ms)}
                onChange={e => setPerfConfig(p => ({ ...p, p99Ms: Number(e.target.value) }))}
              />
              <Input
                label="Max error rate (0.02 = 2%)"
                type="number"
                step="0.01"
                value={String(perfConfig.maxErrorRate)}
                onChange={e => setPerfConfig(p => ({ ...p, maxErrorRate: Number(e.target.value) }))}
              />
            </div>
          </>
        )}

        {type === 'exploratory' && (
          <>
            {sectionHeader('Session charter')}
            <Textarea
              label="Charter *"
              value={charter.charter}
              onChange={e => setCharter(p => ({ ...p, charter: e.target.value }))}
              placeholder="Explore [area] to discover [goal] — focus on [constraints]…"
              rows={3}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Input
                label="Duration (minutes)"
                type="number"
                value={String(charter.durationMins)}
                onChange={e => setCharter(p => ({ ...p, durationMins: Number(e.target.value) }))}
              />
              <Input
                label="Area under test"
                value={charter.area}
                onChange={e => setCharter(p => ({ ...p, area: e.target.value }))}
                placeholder="Checkout flow"
              />
              <Select
                label="Risk focus"
                value={charter.riskFocus}
                onChange={e => setCharter(p => ({ ...p, riskFocus: e.target.value }))}
                options={[
                  { value: 'Functionality', label: 'Functionality' },
                  { value: 'Security', label: 'Security' },
                  { value: 'Usability', label: 'Usability' },
                  { value: 'Performance', label: 'Performance' },
                  { value: 'Compatibility', label: 'Compatibility' },
                ]}
              />
            </div>
            <Textarea
              label="Exit criteria"
              value={charter.exitCriteria}
              onChange={e => setCharter(p => ({ ...p, exitCriteria: e.target.value }))}
              placeholder="What constitutes a complete session…"
              rows={2}
            />
          </>
        )}
      </div>
    </div>
  );
}
