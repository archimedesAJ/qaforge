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
  const [historyCase, setHistoryCase] = useState<TestCase | null>(null);
  const [commentsCase, setCommentsCase] = useState<TestCase | null>(null);
  const [linksCase, setLinksCase] = useState<TestCase | null>(null);

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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const p = new URLSearchParams();
              if (suiteId) p.set('suiteId', suiteId);
              if (search) p.set('q', search);
              api.download(`projects/${projectId}/cases/export?${p}`).catch(() => {});
            }}
          >
            Export Excel
          </Button>
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
                    onHistory={() => setHistoryCase(tc)}
                    onComments={() => setCommentsCase(tc)}
                    onLinks={() => setLinksCase(tc)}
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
          qc.invalidateQueries({ queryKey: ['suites', projectId] });
          setShowImport(false);
        }}
      />

      <CaseLinksModal
        projectId={projectId}
        tc={linksCase}
        canEdit={canEdit}
        onClose={() => setLinksCase(null)}
      />

      <CaseCommentsModal
        projectId={projectId}
        tc={commentsCase}
        onClose={() => setCommentsCase(null)}
      />

      <CaseHistoryModal
        projectId={projectId}
        tc={historyCase}
        onClose={() => setHistoryCase(null)}
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
interface ImportIssue {
  row: number;
  title?: string;
  level: 'error' | 'updated' | 'warning';
  message: string;
}

interface ImportResult {
  imported: number;
  updated: number;
  warnings: number;
  issues: ImportIssue[];
}

const ISSUE_STYLE: Record<ImportIssue['level'], { label: string; color: string; bg: string }> = {
  error:   { label: 'Error',   color: '#B91C1C', bg: '#FEF2F2' },
  updated: { label: 'Updated', color: '#1D4ED8', bg: '#EFF6FF' },
  warning: { label: 'Warning', color: '#B45309', bg: '#FFFBEB' },
};

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
              title, type, priority, tags, suite, preconditions, steps
            </code>
            <div style={{ marginTop: 6, color: 'var(--gray-500)' }}>
              <strong>title</strong> is required. <strong>type</strong>: manual · functional · ui_auto · api · perf · exploratory (default: manual).{' '}
              <strong>priority</strong>: p0–p3 (default: p2). <strong>tags</strong>: comma-separated. <strong>suite</strong>: exact suite name.{' '}
              <strong>preconditions</strong>: free text (e.g. "User is logged in"). <strong>steps</strong>: pipe-separated, each step as <em>action {'>>'}  expected</em>.
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
                const csv = 'title,type,priority,tags,suite,preconditions,steps\n"Login flow","manual","p1","auth,smoke","Auth Suite","User has a valid account","Navigate to login page >> Login page is displayed|Enter email and password >> Fields accept input|Click Login >> User is redirected to dashboard"\n"API health check","api","p0","smoke","","",""\n';
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
            <div style={{ flex: 1, padding: '12px 16px', background: result.updated > 0 ? '#eff6ff' : 'var(--gray-50)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: result.updated > 0 ? '#1d4ed8' : 'var(--gray-400)' }}>{result.updated}</div>
              <div style={{ fontSize: '0.8125rem', color: result.updated > 0 ? '#1d4ed8' : 'var(--gray-400)' }}>Updated</div>
            </div>
            <div style={{ flex: 1, padding: '12px 16px', background: result.warnings > 0 ? '#fef3c7' : 'var(--gray-50)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: result.warnings > 0 ? '#d97706' : 'var(--gray-400)' }}>{result.warnings}</div>
              <div style={{ fontSize: '0.8125rem', color: result.warnings > 0 ? '#d97706' : 'var(--gray-400)' }}>Warnings</div>
            </div>
          </div>
          {result.issues.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: '0.8125rem', color: 'var(--gray-600)' }}>
                What happened, row by row:
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                {result.issues.map((issue, i) => {
                  const s = ISSUE_STYLE[issue.level];
                  return (
                    <div
                      key={`${issue.row}-${i}`}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px',
                        borderBottom: i === result.issues.length - 1 ? 'none' : '1px solid var(--border-color)',
                      }}
                    >
                      <span style={{
                        flexShrink: 0, fontSize: '0.6875rem', fontWeight: 700, padding: '2px 8px',
                        borderRadius: 4, color: s.color, background: s.bg, whiteSpace: 'nowrap',
                      }}>
                        {s.label}
                      </span>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--gray-700)' }}>
                        <span style={{ fontWeight: 600 }}>Row {issue.row}</span>
                        {issue.title && <span style={{ color: 'var(--gray-400)' }}> · {issue.title}</span>}
                        <div style={{ color: 'var(--gray-600)', marginTop: 1 }}>{issue.message}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Case Links Modal ──────────────────────────────────────────
interface CaseLink {
  id: string;
  type: string;
  label: string;
  url?: string;
  createdAt: string;
  createdBy: { id: string; name: string };
}

const LINK_TYPES = [
  { value: 'jira',        label: 'Jira',        color: '#0052CC', bg: '#E6F0FF' },
  { value: 'github',      label: 'GitHub',      color: '#24292F', bg: '#F0F0F0' },
  { value: 'requirement', label: 'Requirement',  color: '#6B21A8', bg: '#F3E8FF' },
  { value: 'other',       label: 'Other',        color: '#374151', bg: '#F3F4F6' },
];

function linkMeta(type: string) {
  return LINK_TYPES.find(t => t.value === type) ?? LINK_TYPES[3];
}

function CaseLinksModal({ projectId, tc, canEdit, onClose }: {
  projectId: string;
  tc: TestCase | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [type, setType]   = useState('jira');
  const [label, setLabel] = useState('');
  const [url, setUrl]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['links', tc?.id],
    queryFn: () => api.get<{ links: CaseLink[] }>(`projects/${projectId}/cases/${tc!.id}/links`),
    enabled: !!tc,
  });

  const links = data?.links ?? [];

  useEffect(() => { if (!tc) { setLabel(''); setUrl(''); setError(''); } }, [tc]);

  async function submit() {
    if (!label.trim()) { setError('Label is required'); return; }
    setSubmitting(true); setError('');
    try {
      await api.post(`projects/${projectId}/cases/${tc!.id}/links`, { type, label, url: url || undefined });
      setLabel(''); setUrl('');
      refetch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add link');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteLink(linkId: string) {
    await api.delete(`projects/${projectId}/cases/${tc!.id}/links/${linkId}`);
    refetch();
  }

  return (
    <Modal
      open={!!tc}
      onClose={onClose}
      title={`Linked references — ${tc?.title ?? ''}`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {isLoading && <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div>}

      {!isLoading && links.length === 0 && (
        <p style={{ color: 'var(--gray-400)', fontSize: '0.875rem', textAlign: 'center', padding: '8px 0 16px' }}>
          No linked references yet.
        </p>
      )}

      {links.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {links.map(l => {
            const meta = linkMeta(l.type);
            return (
              <div key={l.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', border: '1px solid var(--border-color)',
                borderRadius: 8, background: '#fff',
              }}>
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px',
                  borderRadius: 10, background: meta.bg, color: meta.color,
                  flexShrink: 0,
                }}>
                  {meta.label}
                </span>
                {l.url ? (
                  <a href={l.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: '0.875rem', color: 'var(--color-primary)', fontWeight: 500, flex: 1, textDecoration: 'none' }}>
                    {l.label} ↗
                  </a>
                ) : (
                  <span style={{ fontSize: '0.875rem', color: 'var(--gray-700)', flex: 1 }}>{l.label}</span>
                )}
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)', flexShrink: 0 }}>
                  {l.createdBy.name}
                </span>
                {canEdit && (
                  <button onClick={() => deleteLink(l.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: '0.8rem', padding: 0, flexShrink: 0 }}>
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--gray-600)', marginBottom: 10 }}>
            Add reference
          </div>
          {error && <div style={{ marginBottom: 8 }}><Alert type="error">{error}</Alert></div>}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              style={{
                padding: '7px 10px', border: '1px solid var(--border-color)',
                borderRadius: 6, fontSize: '0.875rem', background: '#fff',
              }}
            >
              {LINK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={type === 'jira' ? 'e.g. PROJ-123' : type === 'github' ? 'e.g. #456' : 'Requirement label'}
              style={{
                flex: 1, padding: '7px 10px', border: '1px solid var(--border-color)',
                borderRadius: 6, fontSize: '0.875rem',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="URL (optional)"
              style={{
                flex: 1, padding: '7px 10px', border: '1px solid var(--border-color)',
                borderRadius: 6, fontSize: '0.875rem',
              }}
            />
            <Button variant="primary" onClick={submit} loading={submitting} disabled={!label.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Case Comments Modal ───────────────────────────────────────
interface Comment {
  id: string;
  content: string;
  edited: boolean;
  createdAt: string;
  createdBy: { id: string; name: string; email: string };
  replies: Comment[];
}

function CaseCommentsModal({ projectId, tc, onClose }: {
  projectId: string;
  tc: TestCase | null;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentUserId = (() => {
    try {
      const token = localStorage.getItem('qaforge_token');
      if (!token) return null;
      return JSON.parse(atob(token.split('.')[1])).userId as string;
    } catch { return null; }
  })();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['comments', tc?.id],
    queryFn: () => api.get<{ comments: Comment[] }>(`projects/${projectId}/cases/${tc!.id}/comments`),
    enabled: !!tc,
  });

  const comments = data?.comments ?? [];

  useEffect(() => { if (!tc) { setText(''); setReplyTo(null); } }, [tc]);

  async function submit() {
    if (!text.trim() || !tc) return;
    setSubmitting(true);
    try {
      await api.post(`projects/${projectId}/cases/${tc.id}/comments`, {
        content: text.trim(),
        parentId: replyTo?.id ?? undefined,
      });
      setText(''); setReplyTo(null);
      refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteComment(commentId: string) {
    if (!tc) return;
    await api.delete(`projects/${projectId}/cases/${tc.id}/comments/${commentId}`);
    refetch();
  }

  function CommentBubble({ c, indent = false }: { c: Comment; indent?: boolean }) {
    return (
      <div style={{
        marginLeft: indent ? 32 : 0,
        marginBottom: 10,
        padding: '10px 12px',
        background: indent ? 'var(--gray-50)' : '#fff',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--color-primary)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
          }}>
            {c.createdBy.name.charAt(0).toUpperCase()}
          </div>
          <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--gray-800)' }}>{c.createdBy.name}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
            {new Date(c.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
          {c.edited && <span style={{ fontSize: '0.7rem', color: 'var(--gray-400)' }}>(edited)</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {!indent && (
              <button onClick={() => { setReplyTo(c); setText(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-primary)', padding: 0 }}>
                Reply
              </button>
            )}
            {c.createdBy.id === currentUserId && (
              <button onClick={() => deleteComment(c.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-danger)', padding: 0 }}>
                Delete
              </button>
            )}
          </div>
        </div>
        <div style={{ fontSize: '0.875rem', color: 'var(--gray-700)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {c.content}
        </div>
        {c.replies?.map(r => <CommentBubble key={r.id} c={r} indent />)}
      </div>
    );
  }

  return (
    <Modal
      open={!!tc}
      onClose={onClose}
      title={`Comments — ${tc?.title ?? ''}`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {isLoading && <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div>}

      {!isLoading && comments.length === 0 && (
        <p style={{ color: 'var(--gray-400)', fontSize: '0.875rem', textAlign: 'center', padding: '16px 0' }}>
          No comments yet. Be the first to comment.
        </p>
      )}

      <div style={{ maxHeight: 340, overflowY: 'auto', marginBottom: 16 }}>
        {comments.map(c => <CommentBubble key={c.id} c={c} />)}
      </div>

      {replyTo && (
        <div style={{
          padding: '6px 10px', background: 'var(--gray-50)',
          border: '1px solid var(--border-color)', borderRadius: 6,
          marginBottom: 8, fontSize: '0.8rem', color: 'var(--gray-500)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Replying to <strong>{replyTo.createdBy.name}</strong></span>
          <button onClick={() => setReplyTo(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '0.8rem' }}>
            ✕
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
          placeholder={replyTo ? `Reply to ${replyTo.createdBy.name}...` : 'Add a comment... (Ctrl+Enter to post)'}
          rows={3}
          style={{
            flex: 1, padding: '8px 10px', fontSize: '0.875rem',
            border: '1px solid var(--border-color)', borderRadius: 6,
            resize: 'vertical', fontFamily: 'inherit',
          }}
        />
        <Button variant="primary" onClick={submit} loading={submitting}
          disabled={!text.trim()}
          style={{ alignSelf: 'flex-end' }}>
          Post
        </Button>
      </div>
    </Modal>
  );
}

// ── Case History Modal ────────────────────────────────────────
interface VersionRecord {
  id: string;
  version: number;
  type: string;
  title: string;
  archived: boolean;
  createdAt: string;
  preconditions?: string;
  steps?: unknown;
  createdBy: { name: string; email: string };
}

function CaseHistoryModal({ projectId, tc, onClose }: {
  projectId: string;
  tc: TestCase | null;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['case-history', tc?.id],
    queryFn: () => api.get<{ versions: VersionRecord[] }>(`projects/${projectId}/cases/${tc!.id}/history`),
    enabled: !!tc,
  });

  const versions = data?.versions ?? [];

  function formatSteps(steps: unknown, type: string): string {
    if (!steps) return '—';
    if (type === 'ui_auto') {
      const s = steps as Record<string, string>;
      return `Framework: ${s.framework ?? '—'}\nScript: ${s.scriptPath ?? '—'}\nTest: ${s.testName ?? '—'}`;
    }
    if (type === 'exploratory') {
      const s = steps as Record<string, unknown>;
      return `Charter: ${s.charter ?? '—'}`;
    }
    if (Array.isArray(steps)) {
      return (steps as { order: number; action: string; expected: string }[])
        .map(s => `${s.order}. ${s.action} → ${s.expected}`)
        .join('\n');
    }
    return JSON.stringify(steps, null, 2);
  }

  return (
    <Modal
      open={!!tc}
      onClose={onClose}
      title={`Version history — ${tc?.title ?? ''}`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {isLoading && <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div>}
      {!isLoading && versions.length === 0 && (
        <p style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>No history found.</p>
      )}
      {versions.map((v, idx) => {
        const isCurrent = !v.archived;
        const isOpen = expanded === v.id;
        return (
          <div key={v.id} style={{
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            marginBottom: 8,
            overflow: 'hidden',
            opacity: v.archived ? 0.7 : 1,
          }}>
            <div
              onClick={() => setExpanded(isOpen ? null : v.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', cursor: 'pointer',
                background: isCurrent ? 'var(--color-primary-light)' : 'var(--gray-50)',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: '0.875rem', color: isCurrent ? 'var(--color-primary)' : 'var(--gray-500)' }}>
                v{v.version}
              </span>
              <span className={`badge ${TYPE_COLORS[v.type as TestType] ?? 'badge-p3'}`} style={{ fontSize: '0.7rem' }}>
                {TYPE_LABELS[v.type as TestType] ?? v.type}
              </span>
              {isCurrent && (
                <span style={{ fontSize: '0.7rem', padding: '1px 6px', background: 'var(--color-primary)', color: '#fff', borderRadius: 10 }}>
                  current
                </span>
              )}
              {v.archived && (
                <span style={{ fontSize: '0.7rem', padding: '1px 6px', background: 'var(--gray-200)', color: 'var(--gray-500)', borderRadius: 10 }}>
                  archived
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--gray-400)' }}>
                {v.createdBy.name} · {new Date(v.createdAt).toLocaleDateString()}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>{isOpen ? '▲' : '▼'}</span>
            </div>

            {isOpen && (
              <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-color)', background: '#fff', fontSize: '0.8125rem' }}>
                {v.preconditions && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4 }}>Preconditions</div>
                    <div style={{ color: 'var(--gray-700)', lineHeight: 1.6 }}>{v.preconditions}</div>
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--gray-600)', marginBottom: 4 }}>
                    {v.type === 'ui_auto' ? 'Automation config' : v.type === 'exploratory' ? 'Charter' : 'Steps'}
                  </div>
                  <pre style={{
                    margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    color: 'var(--gray-700)', lineHeight: 1.7,
                    background: 'var(--gray-50)', padding: '8px 10px', borderRadius: 6,
                    fontSize: '0.8rem',
                  }}>
                    {formatSteps(v.steps, v.type)}
                  </pre>
                </div>
                {idx < versions.length - 1 && versions.length > 1 && (
                  <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                    Upgraded from v{versions[idx].version} → v{versions[idx + 1].version}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Modal>
  );
}

function CaseRow({
  tc, selected, canEdit, onToggle, onEdit, onDelete, onHistory, onComments, onLinks,
}: {
  tc: TestCase;
  selected: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onComments: () => void;
  onLinks: () => void;
}) {
  return (
    <tr
      draggable={canEdit}
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-case', tc.id);
        e.dataTransfer.setData('text/plain', tc.title);
      }}
      style={{
        background: selected ? 'var(--color-primary-light)' : undefined,
        cursor: canEdit ? 'grab' : undefined,
      }}
    >
      <td onClick={e => e.stopPropagation()} style={{ userSelect: 'none' }}>
        {canEdit && (
          <span style={{
            color: 'var(--gray-300)', fontSize: '0.625rem',
            marginRight: 4, letterSpacing: '-1px', verticalAlign: 'middle',
          }}>⠿</span>
        )}
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
          <Button variant="ghost" size="sm" onClick={onHistory}
            title="View version history"
            style={{ padding: '3px 8px', fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
            ⏱
          </Button>
          <Button variant="ghost" size="sm" onClick={onComments}
            title="Comments & discussion"
            style={{ padding: '3px 8px', fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
            💬
          </Button>
          <Button variant="ghost" size="sm" onClick={onLinks}
            title="Linked references"
            style={{ padding: '3px 8px', fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
            🔗
          </Button>
          {canEdit && (
            <>
              <Button variant="ghost" size="sm" onClick={onEdit}
                style={{ padding: '3px 8px', fontSize: '0.8125rem' }}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={onDelete}
                style={{ padding: '3px 8px', fontSize: '0.8125rem', color: 'var(--color-danger)' }}>
                ✕
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
