import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Spinner, EmptyState } from '../shared/ui';
import { api } from '../../lib/api';
import type { TestCase, TestType, Priority } from '@qaforge/types';

const TYPE_LABELS: Record<TestType, string> = {
  manual: 'Manual',
  functional: 'Functional',
  ui_auto: 'UI Auto',
  api: 'API',
  perf: 'Perf',
  exploratory: 'Exploratory',
};

const TYPE_COLORS: Record<TestType, string> = {
  manual: 'badge-manual',
  functional: 'badge-functional',
  ui_auto: 'badge-ui-auto',
  api: 'badge-api',
  perf: 'badge-perf',
  exploratory: 'badge-exploratory',
};

const PRIORITY_COLORS: Record<Priority, string> = {
  p0: 'badge-p0',
  p1: 'badge-p1',
  p2: 'badge-p2',
  p3: 'badge-p3',
};

interface CaseListProps {
  projectId: string;
  suiteId: string | null;
  onEdit: (tc: TestCase) => void;
  onNew: () => void;
}

export function CaseList({ projectId, suiteId, onEdit, onNew }: CaseListProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TestType | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const params = new URLSearchParams();
  if (suiteId) params.set('suiteId', suiteId);
  if (typeFilter !== 'all') params.set('type', typeFilter);
  if (priorityFilter !== 'all') params.set('priority', priorityFilter);

  const { data, isLoading } = useQuery({
    queryKey: ['cases', projectId, suiteId, typeFilter, priorityFilter],
    queryFn: () =>
      api.get<{ data: TestCase[]; pagination: { total: number } }>(
        `projects/${projectId}/cases${params.toString() ? `?${params}` : ''}`
      ),
    enabled: !!projectId,
  });

  const deleteCase = useMutation({
    mutationFn: (caseId: string) =>
      api.delete(`projects/${projectId}/cases/${caseId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases', projectId] }),
  });

  const cases = data?.data ?? [];

  const filtered = cases.filter(tc =>
    !search || tc.title.toLowerCase().includes(search.toLowerCase())
  );

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(tc => tc.id)));
    }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} test case(s)?`)) return;
    for (const id of selected) await deleteCase.mutateAsync(id);
    setSelected(new Set());
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Toolbar */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        {/* Search */}
        <input
          className="input"
          style={{ width: 220, fontSize: '0.875rem', padding: '6px 10px' }}
          placeholder="Search cases…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Type filter */}
        <select
          className="input"
          style={{ width: 'auto', fontSize: '0.875rem', padding: '6px 10px' }}
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as TestType | 'all')}
        >
          <option value="all">All types</option>
          {(Object.keys(TYPE_LABELS) as TestType[]).map(t => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>

        {/* Priority filter */}
        <select
          className="input"
          style={{ width: 'auto', fontSize: '0.875rem', padding: '6px 10px' }}
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value as Priority | 'all')}
        >
          <option value="all">All priorities</option>
          {(['p0', 'p1', 'p2', 'p3'] as Priority[]).map(p => (
            <option key={p} value={p}>{p.toUpperCase()}</option>
          ))}
        </select>

        <div style={{ flex: 1 }} />

        {/* Case count */}
        <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
          {filtered.length} case{filtered.length !== 1 ? 's' : ''}
        </span>

        <Button variant="primary" size="sm" onClick={onNew}>
          + New case
        </Button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{
          padding: '8px 16px',
          background: 'var(--color-primary-light)',
          borderBottom: '1px solid #bfdbfe',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: '0.875rem',
        }}>
          <span style={{ color: 'var(--color-primary)', fontWeight: 500 }}>
            {selected.size} selected
          </span>
          <Button variant="ghost" size="sm" onClick={bulkDelete}
            style={{ color: 'var(--color-danger)', fontSize: '0.8125rem' }}>
            Delete
          </Button>
          <Button variant="ghost" size="sm"
            onClick={() => setSelected(new Set())}
            style={{ fontSize: '0.8125rem', marginLeft: 'auto' }}>
            Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spinner size="lg" />
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <EmptyState
            icon="✓"
            title={search ? 'No cases match your search' : 'No test cases yet'}
            description={search ? 'Try a different search term.' : 'Create your first test case to get started.'}
            action={!search ? <Button variant="primary" size="sm" onClick={onNew}>Create first case</Button> : undefined}
          />
        )}

        {filtered.length > 0 && (
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th>Title</th>
                <th style={{ width: 110 }}>Type</th>
                <th style={{ width: 80 }}>Priority</th>
                <th style={{ width: 70 }}>Version</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(tc => (
                <CaseRow
                  key={tc.id}
                  tc={tc}
                  selected={selected.has(tc.id)}
                  onToggle={() => toggleSelect(tc.id)}
                  onEdit={() => onEdit(tc)}
                  onDelete={() => {
                    if (confirm(`Delete "${tc.title}"?`)) deleteCase.mutate(tc.id);
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CaseRow({
  tc, selected, onToggle, onEdit, onDelete,
}: {
  tc: TestCase;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <tr style={{ background: selected ? 'var(--color-primary-light)' : undefined }}>
      <td onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          style={{ cursor: 'pointer' }}
        />
      </td>
      <td
        onClick={onEdit}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ fontWeight: 500, color: 'var(--gray-900)', fontSize: '0.9rem' }}>
          {tc.title}
        </div>
        {tc.tags && (tc.tags as string[]).length > 0 && (
          <div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(tc.tags as string[]).map(tag => (
              <span key={tag} style={{
                fontSize: '0.7rem', padding: '1px 6px',
                background: 'var(--gray-100)', color: 'var(--gray-500)',
                borderRadius: 10,
              }}>{tag}</span>
            ))}
          </div>
        )}
      </td>
      <td>
        <span className={`badge ${TYPE_COLORS[tc.type as TestType] ?? 'badge-p3'}`}>
          {TYPE_LABELS[tc.type as TestType] ?? tc.type}
        </span>
      </td>
      <td>
        <span className={`badge ${PRIORITY_COLORS[tc.priority as Priority] ?? 'badge-p3'}`}>
          {tc.priority.toUpperCase()}
        </span>
      </td>
      <td style={{ color: 'var(--gray-400)', fontSize: '0.8125rem' }}>
        v{tc.version}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button variant="ghost" size="sm" onClick={onEdit}
            style={{ padding: '3px 8px', fontSize: '0.8125rem' }}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}
            style={{ padding: '3px 8px', fontSize: '0.8125rem', color: 'var(--color-danger)' }}>
            ✕
          </Button>
        </div>
      </td>
    </tr>
  );
}
