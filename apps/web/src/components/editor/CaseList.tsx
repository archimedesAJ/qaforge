import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Spinner, EmptyState, ConfirmDialog, Modal, Alert } from '../shared/ui';
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
  canEdit?: boolean;
  onEdit: (tc: TestCase) => void;
  onNew: () => void;
}

const PAGE_SIZE = 25;

export function CaseList({ projectId, suiteId, canEdit = true, onEdit, onNew }: CaseListProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TestType | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk]     = useState(false);
  const [confirmSingle, setConfirmSingle] = useState<{ id: string; title: string } | null>(null);
  const [showImport, setShowImport] = useState(false);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); setSelected(new Set()); }, [suiteId, typeFilter, priorityFilter, search]);

  const params = new URLSearchParams();
  if (suiteId) params.set('suiteId', suiteId);
  if (typeFilter !== 'all') params.set('type', typeFilter);
  if (priorityFilter !== 'all') params.set('priority', priorityFilter);
  if (search) params.set('q', search);
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));

  const { data, isLoading } = useQuery({
    queryKey: ['cases', projectId, suiteId, typeFilter, priorityFilter, search, page],
    queryFn: () =>
      api.get<{ data: TestCase[]; pagination: { page: number; limit: number; total: number } }>(
        `projects/${projectId}/cases?${params}`
      ),
    enabled: !!projectId,
  });

  const deleteCase = useMutation({
    mutationFn: (caseId: string) =>
      api.delete(`projects/${projectId}/cases/${caseId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases', projectId] }),
  });

  const cases = data?.data ?? [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = cases;

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
    for (const id of selected) await deleteCase.mutateAsync(id);
    setSelected(new Set());
    setConfirmBulk(false);
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* Toolbar */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <input
            className="input"
            style={{ width: 220, fontSize: '0.875rem', padding: '6px 10px' }}
            placeholder="Search cases…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
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
          <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
            {total} case{total !== 1 ? 's' : ''}
          </span>
          {canEdit && <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>Import CSV</Button>}
          {canEdit && <Button variant="primary" size="sm" onClick={onNew}>+ New case</Button>}
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && canEdit && (
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
            <Button variant="ghost" size="sm" onClick={() => setConfirmBulk(true)}
              style={{ color: 'var(--color-danger)', fontSize: '0.8125rem' }}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}
              style={{ fontSize: '0.8125rem', marginLeft: 'auto' }}>
              Clear
            </Button>
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
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
              action={!search && canEdit ? <Button variant="primary" size="sm" onClick={onNew}>Create first case</Button> : undefined}
            />
          )}
          {filtered.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll} style={{ cursor: 'pointer' }} />
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
                    canEdit={canEdit}
                    onToggle={() => toggleSelect(tc.id)}
                    onEdit={() => onEdit(tc)}
                    onDelete={() => setConfirmSingle({ id: tc.id, title: tc.title })}
                  />
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination bar */}
          {totalPages > 1 && (
            <div style={{
              marginTop: 'auto',
              padding: '10px 16px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.8125rem',
              color: 'var(--gray-500)',
              background: 'var(--surface-base)',
            }}>
              <span>Page {page} of {totalPages}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  variant="secondary" size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary" size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <CsvImportModal
        open={showImport}
        projectId={projectId}
        onClose={() => setShowImport(false)}
        onImported={() => {
          qc.invalidateQueries({ queryKey: ['cases', projectId] });
          setShowImport(false);
        }}
      />

      {/* Bulk delete confirm */}
      <ConfirmDialog
        open={confirmBulk}
        title="Delete test cases"
        message={`Permanently delete ${selected.size} test case(s)? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={bulkDelete}
        onCancel={() => setConfirmBulk(false)}
      />

      {/* Single delete confirm */}
      <ConfirmDialog
        open={!!confirmSingle}
        title="Delete test case"
        message={`Permanently delete "${confirmSingle?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => { deleteCase.mutate(confirmSingle!.id); setConfirmSingle(null); }}
        onCancel={() => setConfirmSingle(null)}
      />
    </>
  );
}

// ── CSV Import Modal ──────────────────────────────────────────
interface ImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; error: string }[];
}

function CsvImportModal({
  open, projectId, onClose, onImported,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  function reset() { setResult(null); setError(''); }

  useEffect(() => { if (open) reset(); }, [open]);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Please select a CSV file'); return; }
    setError(''); setResult(null); setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.upload<ImportResult>(`projects/${projectId}/cases/import/csv`, form);
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  function handleClose() { reset(); onClose(); }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import test cases from CSV"
      footer={
        result
          ? <Button variant="primary" onClick={onImported}>Done</Button>
          : <>
              <Button variant="secondary" onClick={handleClose}>Cancel</Button>
              <Button variant="primary" loading={loading} onClick={handleUpload}>Upload</Button>
            </>
      }
    >
      {!result && (
        <>
          <div style={{
            padding: '10px 12px', background: 'var(--gray-50)',
            border: '1px solid var(--border-color)', borderRadius: 6, marginBottom: 16,
            fontSize: '0.8125rem', color: 'var(--gray-600)', lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Expected columns (header row required):</div>
            <code style={{ display: 'block', fontFamily: 'monospace', fontSize: '0.75rem' }}>
              title, type, priority, tags, suite, steps
            </code>
            <div style={{ marginTop: 6, color: 'var(--gray-500)' }}>
              <strong>title</strong> is required. <strong>type</strong>: manual · functional · ui_auto · api · perf · exploratory (default: manual).{' '}
              <strong>priority</strong>: p0–p3 (default: p2). <strong>tags</strong>: comma-separated. <strong>suite</strong>: exact suite name.{' '}
              <strong>steps</strong>: pipe-separated, each step as <em>action {'>>'}  expected</em>.
            </div>
          </div>
          {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'block', width: '100%', fontSize: '0.875rem' }}
          />
          <div style={{ marginTop: 10 }}>
            <button
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.8125rem', color: 'var(--color-primary)' }}
              onClick={() => {
                const csv = 'title,type,priority,tags,suite,steps\n"Login flow","manual","p1","auth,smoke","Auth Suite","Navigate to login page >> Login page is displayed|Enter email and password >> Fields accept input|Click Login >> User is redirected to dashboard"\n"API health check","api","p0","smoke","",""\n';
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                a.download = 'qaforge-import-template.csv';
                a.click();
              }}
            >
              Download template CSV
            </button>
          </div>
        </>
      )}
      {result && (
        <div>
          <div style={{
            display: 'flex', gap: 16, marginBottom: 16,
          }}>
            <div style={{ flex: 1, padding: '12px 16px', background: 'var(--color-success-light)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-success)' }}>{result.imported}</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-success)' }}>Imported</div>
            </div>
            <div style={{ flex: 1, padding: '12px 16px', background: result.skipped > 0 ? '#fef3c7' : 'var(--gray-50)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: result.skipped > 0 ? '#d97706' : 'var(--gray-400)' }}>{result.skipped}</div>
              <div style={{ fontSize: '0.8125rem', color: result.skipped > 0 ? '#d97706' : 'var(--gray-400)' }}>Skipped</div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div style={{ fontSize: '0.8125rem', color: 'var(--gray-600)' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Row errors:</div>
              {result.errors.map(e => (
                <div key={e.row} style={{ padding: '4px 0', borderBottom: '1px solid var(--border-color)' }}>
                  Row {e.row}: {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function CaseRow({
  tc, selected, canEdit, onToggle, onEdit, onDelete,
}: {
  tc: TestCase;
  selected: boolean;
  canEdit: boolean;
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
        {canEdit && (
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
        )}
      </td>
    </tr>
  );
}
