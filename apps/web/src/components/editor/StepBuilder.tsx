import type { ManualStep } from '@qaforge/types';

interface StepBuilderProps {
  steps: ManualStep[];
  onChange: (steps: ManualStep[]) => void;
}

export function StepBuilder({ steps, onChange }: StepBuilderProps) {
  function addStep() {
    onChange([...steps, { order: steps.length + 1, action: '', expected: '' }]);
  }

  function removeStep(index: number) {
    const next = steps
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, order: i + 1 }));
    onChange(next);
  }

  function updateStep(index: number, field: 'action' | 'expected', value: string) {
    const next = steps.map((s, i) => i === index ? { ...s, [field]: value } : s);
    onChange(next);
  }

  function moveStep(index: number, direction: 'up' | 'down') {
    const next = [...steps];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next.map((s, i) => ({ ...s, order: i + 1 })));
  }

  return (
    <div>
      {steps.length === 0 && (
        <div style={{
          padding: '24px 16px', textAlign: 'center',
          border: '1px dashed var(--border-color)', borderRadius: 8,
          color: 'var(--gray-400)', fontSize: '0.875rem', marginBottom: 8,
        }}>
          No steps yet — add your first step below
        </div>
      )}

      {steps.map((step, index) => (
        <div
          key={index}
          style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            padding: '10px 12px',
            background: 'var(--gray-50)',
            border: '1px solid var(--border-color)',
            borderRadius: 8, marginBottom: 8,
          }}
        >
          {/* Step number */}
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: 'var(--color-primary)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', fontWeight: 600, flexShrink: 0, marginTop: 6,
          }}>
            {index + 1}
          </div>

          {/* Step fields */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              className="input"
              style={{ fontSize: '0.875rem', padding: '6px 10px' }}
              placeholder="Action — what the tester does"
              value={step.action}
              onChange={e => updateStep(index, 'action', e.target.value)}
            />
            <input
              className="input"
              style={{
                fontSize: '0.875rem', padding: '6px 10px',
                background: 'var(--surface-base)',
                borderLeft: '3px solid var(--color-primary)',
                borderRadius: '0 6px 6px 0',
              }}
              placeholder="Expected result — what should happen"
              value={step.expected}
              onChange={e => updateStep(index, 'expected', e.target.value)}
            />
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
            <button
              onClick={() => moveStep(index, 'up')}
              disabled={index === 0}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: index === 0 ? 'var(--gray-200)' : 'var(--gray-400)',
                fontSize: '0.75rem', padding: '2px 4px', borderRadius: 3,
              }}
              title="Move up"
            >▲</button>
            <button
              onClick={() => moveStep(index, 'down')}
              disabled={index === steps.length - 1}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: index === steps.length - 1 ? 'var(--gray-200)' : 'var(--gray-400)',
                fontSize: '0.75rem', padding: '2px 4px', borderRadius: 3,
              }}
              title="Move down"
            >▼</button>
            <button
              onClick={() => removeStep(index)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--gray-300)', fontSize: '0.875rem', padding: '2px 4px', borderRadius: 3,
              }}
              title="Remove step"
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-danger)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-300)'}
            >✕</button>
          </div>
        </div>
      ))}

      <button
        onClick={addStep}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', background: 'none',
          border: '1px dashed var(--border-color)', borderRadius: 6,
          cursor: 'pointer', fontSize: '0.875rem', color: 'var(--gray-500)',
          width: '100%', justifyContent: 'center',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary)';
          (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)';
          (e.currentTarget as HTMLElement).style.color = 'var(--gray-500)';
        }}
      >
        + Add step
      </button>
    </div>
  );
}

// ── Assertion builder for API tests ──────────────────────────
export interface Assertion {
  field: string;
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'exists';
  expected: string;
}

interface AssertionBuilderProps {
  assertions: Assertion[];
  onChange: (assertions: Assertion[]) => void;
}

export function AssertionBuilder({ assertions, onChange }: AssertionBuilderProps) {
  function add() {
    onChange([...assertions, { field: '', op: 'eq', expected: '' }]);
  }

  function remove(index: number) {
    onChange(assertions.filter((_, i) => i !== index));
  }

  function update(index: number, key: keyof Assertion, value: string) {
    onChange(assertions.map((a, i) => i === index ? { ...a, [key]: value } : a));
  }

  const OPS = [
    { value: 'eq',       label: '= equals' },
    { value: 'ne',       label: '≠ not equals' },
    { value: 'gt',       label: '> greater than' },
    { value: 'lt',       label: '< less than' },
    { value: 'contains', label: '⊃ contains' },
    { value: 'exists',   label: '∃ exists' },
  ];

  return (
    <div>
      {assertions.map((a, index) => (
        <div key={index} style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          <input
            className="input"
            style={{ flex: 2, fontSize: '0.875rem', padding: '6px 10px', fontFamily: 'monospace' }}
            placeholder="Field (e.g. status, body.id)"
            value={a.field}
            onChange={e => update(index, 'field', e.target.value)}
          />
          <select
            className="input"
            style={{ flex: 1, fontSize: '0.8125rem', padding: '6px 8px' }}
            value={a.op}
            onChange={e => update(index, 'op', e.target.value)}
          >
            {OPS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
          </select>
          {a.op !== 'exists' && (
            <input
              className="input"
              style={{ flex: 2, fontSize: '0.875rem', padding: '6px 10px' }}
              placeholder="Expected value"
              value={a.expected}
              onChange={e => update(index, 'expected', e.target.value)}
            />
          )}
          <button
            onClick={() => remove(index)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--gray-300)', fontSize: '1rem', padding: '2px 6px', flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-danger)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-300)'}
          >✕</button>
        </div>
      ))}
      <button
        onClick={add}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', background: 'none',
          border: '1px dashed var(--border-color)', borderRadius: 6,
          cursor: 'pointer', fontSize: '0.875rem', color: 'var(--gray-500)',
          width: '100%', justifyContent: 'center', transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary)';
          (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)';
          (e.currentTarget as HTMLElement).style.color = 'var(--gray-500)';
        }}
      >
        + Add assertion
      </button>
    </div>
  );
}
