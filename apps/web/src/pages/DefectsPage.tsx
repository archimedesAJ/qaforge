import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Select, EmptyState, Spinner, StatCard } from '../components/shared/ui';
import { api } from '../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface Defect {
  id: string;
  title: string | null;
  tracker: string;
  externalRef: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  runResult: {
    id: number;
    runId: string;
    status: string;
    executedAt: string;
    testCase: { id: string; title: string; type: string } | null;
    run: { id: string; name: string; env: string };
  };
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

// ── Page ─────────────────────────────────────────────────────────────────────

export function DefectsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['defects', projectId, statusFilter],
    queryFn: () => {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
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
              title={statusFilter ? 'No defects with this status' : 'No defects filed'}
              description="Defects are filed from the run results viewer when a test case fails."
            />
          )}

          {defects.length > 0 && defects.map((defect, i) => {
            const tc   = TRACKER_CONFIG[defect.tracker] ?? TRACKER_CONFIG.internal;
            const sc   = STATUS_CONFIG[defect.status]   ?? STATUS_CONFIG.open;
            const last = i === defects.length - 1;

            return (
              <div key={defect.id} style={{
                padding: '14px 20px',
                borderBottom: last ? 'none' : '1px solid var(--border-color)',
              }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  {/* Tracker badge */}
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                    color: tc.color, background: tc.bg, flexShrink: 0,
                  }}>
                    {tc.label}
                  </span>

                  {/* Title / link */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {defect.externalRef ? (
                      <a
                        href={defect.externalRef} target="_blank" rel="noopener noreferrer"
                        style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-primary)', textDecoration: 'none' }}
                      >
                        {defect.title || defect.externalRef} ↗
                      </a>
                    ) : (
                      <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--gray-900)' }}>
                        {defect.title}
                      </span>
                    )}
                  </div>

                  {/* Status — inline editable */}
                  {updatingId === defect.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Select
                        value={defect.status}
                        onChange={e => updateStatus.mutate({ defectId: defect.id, status: e.target.value })}
                        options={Object.entries(STATUS_CONFIG).map(([v, c]) => ({ value: v, label: c.label }))}
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

                  <button
                    onClick={() => removeDefect.mutate(defect.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', fontSize: '0.875rem', padding: '2px 4px' }}
                    title="Remove defect"
                  >
                    ✕
                  </button>
                </div>

                {/* Notes */}
                {defect.notes && (
                  <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', marginBottom: 6, paddingLeft: 2 }}>
                    {defect.notes}
                  </div>
                )}

                {/* Footer — test case + run link */}
                <div style={{ display: 'flex', gap: 12, fontSize: '0.8125rem', color: 'var(--gray-400)', flexWrap: 'wrap' }}>
                  {defect.runResult.testCase && (
                    <span>
                      🧪 {defect.runResult.testCase.title}
                    </span>
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
                  <span>
                    {new Date(defect.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
