import { useRef, useState, FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Input, Modal, Alert, Select, EmptyState, Spinner, StatCard, ConfirmDialog } from '../components/shared/ui';
import { api } from '../lib/api';
import { useProjectRole } from '../hooks/useProjectRole';
import { AttachmentUploader, AttachmentItem } from '../components/runner/AttachmentUploader';

// ── Types ────────────────────────────────────────────────────────────────────

interface Defect {
  id: string;
  title: string | null;
  tracker: string;
  externalRef: string | null;
  status: string;
  severity: string;
  detectedEnvironment: string;
  notes: string | null;
  attachments: AttachmentItem[] | null;
  createdAt: string;
  updatedAt: string;
  runResult: {
    id: number;
    runId: string;
    status: string;
    executedAt: string;
    testCase: { id: string; title: string; type: string } | null;
    run: { id: string; name: string; env: string };
  } | null;
}

// ── Config ───────────────────────────────────────────────────────────────────

const TRACKER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  jira:     { label: 'Jira',     color: '#0052CC', bg: '#E6F0FF' },
  github:   { label: 'GitHub',   color: '#24292F', bg: '#F0F0F0' },
  linear:   { label: 'Linear',   color: '#5E6AD2', bg: '#EEEFFE' },
  internal: { label: 'Internal', color: '#6B7280', bg: '#F3F4F6' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  open:        { label: 'Open',        color: '#DC2626', bg: '#FEE2E2' },
  in_progress: { label: 'In progress', color: '#D97706', bg: '#FEF3C7' },
  resolved:    { label: 'Resolved',    color: '#16A34A', bg: '#DCFCE7' },
  closed:      { label: 'Closed',      color: '#6B7280', bg: '#F3F4F6' },
  wont_fix:    { label: "Won't fix",   color: '#9CA3AF', bg: '#F9FAFB' },
};

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  critical: { label: 'Critical', color: '#991B1B', bg: '#FEE2E2' },
  high:     { label: 'High',     color: '#C2410C', bg: '#FFEDD5' },
  medium:   { label: 'Medium',   color: '#D97706', bg: '#FEF3C7' },
  low:      { label: 'Low',      color: '#166534', bg: '#DCFCE7' },
};
const ENVIRONMENT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  development: { label: 'Development', color: '#475569', bg: '#F1F5F9' },
  testing: { label: 'QA/Test', color: '#0369A1', bg: '#E0F2FE' },
  staging: { label: 'UAT/Staging', color: '#7C3AED', bg: '#EDE9FE' },
  production: { label: 'Production', color: '#B91C1C', bg: '#FEE2E2' },
  unknown: { label: 'Unknown', color: '#6B7280', bg: '#F3F4F6' },
};

const TRACKER_OPTIONS  = Object.entries(TRACKER_CONFIG).map(([v, c])  => ({ value: v, label: c.label }));
const STATUS_OPTIONS   = Object.entries(STATUS_CONFIG).map(([v, c])   => ({ value: v, label: c.label }));
const SEVERITY_OPTIONS = Object.entries(SEVERITY_CONFIG).map(([v, c]) => ({ value: v, label: c.label }));
const ENVIRONMENT_OPTIONS = Object.entries(ENVIRONMENT_CONFIG).map(([v, c]) => ({ value: v, label: c.label }));
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' },
  { value: 'severity_desc', label: 'Severity: Critical to Low' }, { value: 'severity_asc', label: 'Severity: Low to Critical' },
];
const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const csvCell = (value: unknown) => {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

// ── Page ─────────────────────────────────────────────────────────────────────

export function DefectsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const { isEditor, canBulkUploadDefects } = useProjectRole(projectId);
  const [statusFilter, setStatusFilter]       = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [updatingId, setUpdatingId]           = useState<string | null>(null);
  const [showCreate, setShowCreate]           = useState(false);
  const [showBulkUpload, setShowBulkUpload]   = useState(false);
  const [editingDefect, setEditingDefect]     = useState<Defect | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['defects', projectId, statusFilter, environmentFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (environmentFilter) params.set('detectedEnvironment', environmentFilter);
      const qs = params.toString() ? `?${params}` : '';
      return api.get<{ defects: Defect[] }>(`projects/${projectId}/defects${qs}`);
    },
    enabled: !!projectId,
  });

  const updateStatus = useMutation({
    mutationFn: ({ defectId, status }: { defectId: string; status: string }) =>
      api.patch(`projects/${projectId}/defects/${defectId}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['defects', projectId] });
      setUpdatingId(null);
    },
  });

  const removeDefect = useMutation({
    mutationFn: (defectId: string) =>
      api.delete(`projects/${projectId}/defects/${defectId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['defects', projectId] }),
  });

  const defects = data?.defects ?? [];
  const sortedDefects = [...defects].sort((a, b) => {
    if (sortOrder === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (sortOrder === 'severity_desc') return (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (sortOrder === 'severity_asc') return (SEVERITY_RANK[a.severity] ?? 0) - (SEVERITY_RANK[b.severity] ?? 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  function exportDefectsCsv() {
    const headers = ['Title', 'Severity', 'Detected environment', 'Status', 'Tracker', 'External reference', 'Notes', 'Test case', 'Run', 'Run environment', 'Created at', 'Updated at'];
    const rows = sortedDefects.map(defect => [
      defect.title, defect.severity, defect.detectedEnvironment, defect.status, defect.tracker,
      defect.externalRef, defect.notes, defect.runResult?.testCase?.title, defect.runResult?.run.name,
      defect.runResult?.run.env, defect.createdAt, defect.updatedAt,
    ]);
    const csv = `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `qaforge-defects-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const counts = {
    open:        defects.filter(d => d.status === 'open').length,
    in_progress: defects.filter(d => d.status === 'in_progress').length,
    resolved:    defects.filter(d => d.status === 'resolved').length,
    closed:      defects.filter(d => d.status === 'closed').length,
    wont_fix:    defects.filter(d => d.status === 'wont_fix').length,
  };

  return (
    <AppLayout title="Defects">
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
          {isEditor && <Button variant="secondary" size="sm" disabled={sortedDefects.length === 0} onClick={exportDefectsCsv}>↓ Export CSV</Button>}
          {canBulkUploadDefects && (
            <Button variant="secondary" size="sm" onClick={() => setShowBulkUpload(true)}>
              Bulk upload
            </Button>
          )}
          {isEditor && (
            <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
              + New defect
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ minWidth: 220 }}><Select label="Detected environment" value={environmentFilter} onChange={e => setEnvironmentFilter(e.target.value)} options={[{ value: '', label: 'All environments' }, ...ENVIRONMENT_OPTIONS]} /></div>
          <div style={{ minWidth: 220 }}><Select label="Sort by" value={sortOrder} onChange={e => setSortOrder(e.target.value)} options={SORT_OPTIONS} /></div>
        </div>

        {/* Stats */}
        <div className="grid-4" style={{ marginBottom: 24 }}>
          <StatCard label="Open"        value={counts.open}        color={counts.open > 0 ? '#DC2626' : undefined} />
          <StatCard label="In progress" value={counts.in_progress} color={counts.in_progress > 0 ? '#D97706' : undefined} />
          <StatCard label="Resolved"    value={counts.resolved}    color={counts.resolved > 0 ? '#16A34A' : undefined} />
          <StatCard label="Won't fix / Closed" value={counts.wont_fix + counts.closed} />
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--gray-500)', fontWeight: 500 }}>Filter:</span>
          {[
            { value: '',            label: 'All' },
            { value: 'open',        label: 'Open' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'resolved',    label: 'Resolved' },
            { value: 'closed',      label: 'Closed' },
            { value: 'wont_fix',    label: "Won't fix" },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              style={{
                padding: '4px 12px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 500,
                border: '1px solid',
                borderColor: statusFilter === opt.value ? 'var(--color-primary)' : 'var(--border-color)',
                background: statusFilter === opt.value ? 'var(--color-primary-light)' : 'var(--surface-base)',
                color: statusFilter === opt.value ? 'var(--color-primary)' : 'var(--gray-600)',
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Defects table */}
        <div className="card">
          {isLoading && <div style={{ padding: 32 }}><Spinner size="lg" /></div>}

          {!isLoading && defects.length === 0 && (
            <EmptyState
              icon="✓"
              title={statusFilter || environmentFilter ? 'No defects match these filters' : 'No defects filed'}
              description="Defects are filed from run results or directly with the + New defect button."
            />
          )}

          {sortedDefects.length > 0 && sortedDefects.map((defect, i) => {
            const tc   = TRACKER_CONFIG[defect.tracker]    ?? TRACKER_CONFIG.internal;
            const sc   = STATUS_CONFIG[defect.status]     ?? STATUS_CONFIG.open;
            const sevc = SEVERITY_CONFIG[defect.severity] ?? SEVERITY_CONFIG.medium;
            const envc = ENVIRONMENT_CONFIG[defect.detectedEnvironment] ?? ENVIRONMENT_CONFIG.unknown;
            const last = i === sortedDefects.length - 1;

            return (
              <div key={defect.id} style={{
                padding: '14px 20px',
                borderBottom: last ? 'none' : '1px solid var(--border-color)',
              }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  {/* Severity badge */}
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 700,
                    color: sevc.color, background: sevc.bg, flexShrink: 0, letterSpacing: '0.02em',
                  }}>
                    {sevc.label}
                  </span>

                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, color: envc.color, background: envc.bg, flexShrink: 0 }}>
                    {envc.label}
                  </span>

                  {/* Tracker badge */}
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                    color: tc.color, background: tc.bg, flexShrink: 0,
                  }}>
                    {tc.label}
                  </span>

                  {/* Title / link */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {defect.externalRef && defect.externalRef.startsWith('http') ? (
                      <a
                        href={defect.externalRef} target="_blank" rel="noopener noreferrer"
                        style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-primary)', textDecoration: 'none' }}
                      >
                        {defect.title || defect.externalRef} ↗
                      </a>
                    ) : (
                      <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--gray-900)' }}>
                        {defect.title}
                        {defect.externalRef && (
                          <span style={{ marginLeft: 8, fontSize: '0.8125rem', fontWeight: 400, color: 'var(--gray-400)' }}>
                            {defect.externalRef}
                          </span>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Status — inline editable */}
                  {updatingId === defect.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Select
                        value={defect.status}
                        onChange={e => updateStatus.mutate({ defectId: defect.id, status: e.target.value })}
                        options={STATUS_OPTIONS}
                      />
                      <button onClick={() => setUpdatingId(null)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '0.875rem' }}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setUpdatingId(defect.id)}
                      style={{
                        padding: '2px 10px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 600,
                        color: sc.color, background: sc.bg, border: 'none', cursor: 'pointer',
                      }}
                      title="Click to change status"
                    >
                      {sc.label}
                    </button>
                  )}

                  {isEditor && (
                    <>
                      <button
                        onClick={() => setEditingDefect(defect)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '0.875rem', padding: '2px 4px' }}
                        title="Edit defect"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(defect.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', fontSize: '0.875rem', padding: '2px 4px' }}
                        title="Remove defect"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>

                {/* Notes */}
                {defect.notes && (
                  <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', marginBottom: 6, paddingLeft: 2 }}>
                    {defect.notes}
                  </div>
                )}

                {/* Attachments */}
                {defect.attachments && defect.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {defect.attachments.map((att, i) => (
                      <a
                        key={i}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 4,
                          border: '1px solid var(--border-color)',
                          background: 'var(--surface-base)',
                          fontSize: '0.8125rem', color: 'var(--color-primary)',
                          textDecoration: 'none',
                        }}
                      >
                        📎 {att.name}
                      </a>
                    ))}
                  </div>
                )}

                {/* Footer — test case + run link, or standalone indicator */}
                <div style={{ display: 'flex', gap: 12, fontSize: '0.8125rem', color: 'var(--gray-400)', flexWrap: 'wrap' }}>
                  {defect.runResult ? (
                    <>
                      {defect.runResult.testCase && (
                        <span>🧪 {defect.runResult.testCase.title}</span>
                      )}
                      <span>
                        ▶ {defect.runResult.run.name}
                        <span style={{
                          marginLeft: 6, background: 'var(--gray-100)', color: 'var(--gray-500)',
                          padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.75rem',
                        }}>
                          {defect.runResult.run.env}
                        </span>
                      </span>
                    </>
                  ) : (
                    <span style={{ fontStyle: 'italic' }}>No linked test</span>
                  )}
                  <span>
                    {new Date(defect.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create standalone defect modal */}
      {showBulkUpload && projectId && (
        <BulkDefectUploadModal
          projectId={projectId}
          onClose={() => setShowBulkUpload(false)}
          onImported={() => qc.invalidateQueries({ queryKey: ['defects', projectId] })}
        />
      )}

      {showCreate && projectId && (
        <CreateDefectModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['defects', projectId] });
            setShowCreate(false);
          }}
        />
      )}

      {/* Edit defect modal */}
      {editingDefect && projectId && (
        <EditDefectModal
          projectId={projectId}
          defect={editingDefect}
          onClose={() => setEditingDefect(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['defects', projectId] });
            setEditingDefect(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete defect"
        message="Permanently delete this defect? This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => { removeDefect.mutate(confirmDeleteId!); setConfirmDeleteId(null); }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </AppLayout>
  );
}

interface BulkImportResult {
  imported: number;
  failed: number;
  total: number;
  issues: { row: number; title?: string; message: string }[];
}

function BulkDefectUploadModal({ projectId, onClose, onImported }: {
  projectId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [error, setError] = useState('');
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a CSV file first.');
      const form = new FormData();
      form.append('file', file);
      return api.upload<BulkImportResult>(`projects/${projectId}/defects/import/csv`, form);
    },
    onSuccess: value => { setResult(value); setError(''); onImported(); },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Bulk upload defects"
      footer={<>
        <Button variant="secondary" onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>
        {!result && <Button variant="primary" loading={upload.isPending} onClick={() => upload.mutate()}>Upload defects</Button>}
      </>}
    >
      <p style={{ marginTop: 0, fontSize: '0.875rem', color: 'var(--gray-600)', lineHeight: 1.5 }}>
        Upload up to 1,000 defects as CSV. <code>title</code> is required. Optional columns are
        <code> tracker</code>, <code>severity</code>, <code>status</code>, <code>detectedEnvironment</code>, <code>externalRef</code>, and <code>notes</code>.
      </p>
      <div style={{ padding: 10, marginBottom: 14, borderRadius: 6, background: 'var(--gray-50)', border: '1px solid var(--border-color)', fontFamily: 'monospace', fontSize: '0.75rem', overflowX: 'auto' }}>
        title,tracker,severity,status,detectedEnvironment,externalRef,notes
      </div>
      {!result && <input type="file" accept=".csv,text/csv" onChange={e => { setFile(e.target.files?.[0] ?? null); setError(''); }} style={{ display: 'block', width: '100%', marginBottom: 14 }} />}
      {!result && (
        <button
          type="button"
          style={{
            background: 'none', border: 'none', padding: 0, marginBottom: 14,
            cursor: 'pointer', fontSize: '0.8125rem', color: 'var(--color-primary)',
          }}
          onClick={() => {
            const csv = [
              'title,tracker,severity,status,detectedEnvironment,externalRef,notes',
              '"Checkout fails with valid card","jira","high","open","testing","QA-102","Payment fails with a valid Visa card"',
              '"Account balance is not updated","internal","critical","open","production","","Balance remains unchanged after a successful transfer"',
              '"Submit button overlaps footer","github","low","in_progress","staging","https://github.com/example/repo/issues/45","Visible on mobile screens below 390px"',
              '',
            ].join('\n');
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'qaforge-defect-import-template.csv';
            anchor.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download template CSV
        </button>
      )}
      {error && <Alert type="error">{error}</Alert>}
      {result && <>
        <Alert type={result.failed ? 'info' : 'success'}>
          Imported {result.imported} of {result.total} defects. {result.failed ? `${result.failed} rows failed.` : 'All rows imported successfully.'}
        </Alert>
        {result.issues.length > 0 && <div style={{ marginTop: 12, maxHeight: 220, overflowY: 'auto', fontSize: '0.8125rem' }}>
          {result.issues.map(issue => <div key={`${issue.row}-${issue.message}`} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
            <strong>Row {issue.row}{issue.title ? ` — ${issue.title}` : ''}:</strong> {issue.message}
          </div>)}
        </div>}
      </>}
    </Modal>
  );
}

// ── Edit defect modal ─────────────────────────────────────────────────────────

function EditDefectModal({
  projectId, defect, onClose, onSaved,
}: {
  projectId: string;
  defect: Defect;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle]             = useState(defect.title ?? '');
  const [tracker, setTracker]         = useState(defect.tracker);
  const [severity, setSeverity]       = useState(defect.severity ?? 'medium');
  const [detectedEnvironment, setDetectedEnvironment] = useState(defect.detectedEnvironment ?? 'unknown');
  const [ref, setRef]                 = useState(defect.externalRef ?? '');
  const [notes, setNotes]             = useState(defect.notes ?? '');
  const [attachments, setAttachments] = useState<AttachmentItem[]>(defect.attachments ?? []);
  const [error, setError]             = useState('');

  const mutation = useMutation({
    mutationFn: () => api.patch(`projects/${projectId}/defects/${defect.id}`, {
      title: title.trim(),
      tracker,
      severity,
      detectedEnvironment,
      externalRef: ref.trim() || null,
      notes: notes.trim() || null,
      attachments,
    }),
    onSuccess: onSaved,
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    mutation.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit defect"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={handleSubmit as () => void}>
            Save changes
          </Button>
        </>
      }
    >
      {error && <div style={{ marginBottom: 16 }}><Alert type="error">{error}</Alert></div>}
      <form onSubmit={handleSubmit}>
        <Input
          label="Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Login fails on Safari 17"
          autoFocus
          required
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 6, color: 'var(--gray-700)' }}>
              Tracker
            </label>
            <Select value={tracker} onChange={e => setTracker(e.target.value)} options={TRACKER_OPTIONS} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 6, color: 'var(--gray-700)' }}>
              Severity
            </label>
            <Select value={severity} onChange={e => setSeverity(e.target.value)} options={SEVERITY_OPTIONS} />
          </div>
        </div>
        <Select label="Detected environment" value={detectedEnvironment} onChange={e => setDetectedEnvironment(e.target.value)} options={ENVIRONMENT_OPTIONS} />
        <Input
          label="External ref / URL (optional)"
          value={ref}
          onChange={e => setRef(e.target.value)}
          placeholder="https://jira.company.com/browse/BUG-123 or BUG-123"
        />
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 6, color: 'var(--gray-700)' }}>
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Steps to reproduce, affected environments, etc."
            rows={3}
            style={{
              width: '100%', padding: '8px 12px',
              border: '1px solid var(--border-color)', borderRadius: 8,
              fontSize: '0.875rem', resize: 'vertical', outline: 'none',
              background: 'var(--surface-base)', color: 'var(--gray-900)',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <AttachmentUploader value={attachments} onChange={setAttachments} />
      </form>
    </Modal>
  );
}

// ── Create defect modal ───────────────────────────────────────────────────────

function CreateDefectModal({
  projectId, onClose, onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle]             = useState('');
  const [tracker, setTracker]         = useState('internal');
  const [severity, setSeverity]       = useState('medium');
  const [detectedEnvironment, setDetectedEnvironment] = useState('testing');
  const [ref, setRef]                 = useState('');
  const [notes, setNotes]             = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [error, setError]             = useState('');
  const requestId = useRef(crypto.randomUUID());
  const submitting = useRef(false);

  const mutation = useMutation({
    mutationFn: () => api.post(`projects/${projectId}/defects`, {
      clientRequestId: requestId.current,
      title, tracker, severity, detectedEnvironment,
      externalRef: ref.trim() || undefined,
      notes: notes.trim() || undefined,
      attachments,
    }),
    onSuccess: onCreated,
    onError: (err: Error) => { submitting.current = false; setError(err.message); },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    submitting.current = true;
    mutation.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New defect"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} disabled={submitting.current} onClick={handleSubmit as () => void}>
            File defect
          </Button>
        </>
      }
    >
      {error && <div style={{ marginBottom: 16 }}><Alert type="error">{error}</Alert></div>}
      <form onSubmit={handleSubmit}>
        <Input
          label="Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Login fails on Safari 17"
          autoFocus
          required
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 6, color: 'var(--gray-700)' }}>
              Tracker
            </label>
            <Select value={tracker} onChange={e => setTracker(e.target.value)} options={TRACKER_OPTIONS} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 6, color: 'var(--gray-700)' }}>
              Severity
            </label>
            <Select value={severity} onChange={e => setSeverity(e.target.value)} options={SEVERITY_OPTIONS} />
          </div>
        </div>
        <Select label="Detected environment" value={detectedEnvironment} onChange={e => setDetectedEnvironment(e.target.value)} options={ENVIRONMENT_OPTIONS.filter(option => option.value !== 'unknown')} />
        <Input
          label="External ref URL (optional)"
          value={ref}
          onChange={e => setRef(e.target.value)}
          placeholder="https://jira.company.com/browse/BUG-123"
        />
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 6, color: 'var(--gray-700)' }}>
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Steps to reproduce, affected environments, etc."
            rows={3}
            style={{
              width: '100%', padding: '8px 12px',
              border: '1px solid var(--border-color)', borderRadius: 8,
              fontSize: '0.875rem', resize: 'vertical', outline: 'none',
              background: 'var(--surface-base)', color: 'var(--gray-900)',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <AttachmentUploader value={attachments} onChange={setAttachments} />
      </form>
    </Modal>
  );
}
