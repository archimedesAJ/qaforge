import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Input, Alert, EmptyState, Spinner } from '../shared/ui';
import { SuiteTree } from './SuiteTree';
import { api } from '../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface SetCase {
  id: string;
  title: string;
  type: string;
  priority: string;
  suiteId: string | null;
  suite: { id: string; name: string } | null;
}

interface TestSet {
  id: string;
  name: string;
  description: string | null;
  caseCount: number;
  createdBy: { id: string; name: string };
  createdAt: string;
}

interface TestSetDetail extends Omit<TestSet, 'caseCount'> {
  cases: SetCase[];
  caseCount: number;
}

interface PickerCase {
  id: string;
  title: string;
  type: string;
  priority: string;
  suiteId: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  manual: 'Manual', functional: 'Functional', ui_auto: 'UI Auto',
  api: 'API', perf: 'Perf', exploratory: 'Exploratory',
};

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  canEdit: boolean;
}

export function TestSetsPanel({ projectId, canEdit }: Props) {
  const qc = useQueryClient();

  const [selectedSet, setSelectedSet] = useState<TestSet | null>(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [showPicker, setShowPicker]   = useState(false);
  const [showDelete, setShowDelete]   = useState<string | null>(null);

  // Create form
  const [newName, setNewName]   = useState('');
  const [newDesc, setNewDesc]   = useState('');
  const [createError, setCreateError] = useState('');

  // Case picker state
  const [pickerSuite, setPickerSuite]   = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pendingIds, setPendingIds]     = useState<Set<string>>(new Set());

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: setsData, isLoading } = useQuery({
    queryKey: ['sets', projectId],
    queryFn: () => api.get<{ sets: TestSet[] }>(`projects/${projectId}/sets`),
    enabled: !!projectId,
  });

  const { data: detailData, isLoading: loadingDetail } = useQuery({
    queryKey: ['set', selectedSet?.id],
    queryFn: () => api.get<TestSetDetail>(`projects/${projectId}/sets/${selectedSet!.id}`),
    enabled: !!selectedSet,
  });

  const { data: pickerData, isLoading: loadingPicker } = useQuery({
    queryKey: ['cases', projectId, pickerSuite, 'set-picker'],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '500' });
      if (pickerSuite) params.set('suiteId', pickerSuite);
      return api.get<{ data: PickerCase[] }>(`projects/${projectId}/cases?${params}`);
    },
    enabled: showPicker,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createSet = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      api.post<TestSet>(`projects/${projectId}/sets`, body),
    onSuccess: (set) => {
      qc.invalidateQueries({ queryKey: ['sets', projectId] });
      setShowCreate(false);
      setNewName(''); setNewDesc(''); setCreateError('');
      setSelectedSet(set);
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const saveCases = useMutation({
    mutationFn: (caseIds: string[]) =>
      api.put<TestSetDetail>(`projects/${projectId}/sets/${selectedSet!.id}/cases`, { caseIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['set', selectedSet?.id] });
      qc.invalidateQueries({ queryKey: ['sets', projectId] });
      setShowPicker(false);
    },
  });

  const removeCase = useMutation({
    mutationFn: (caseId: string) =>
      api.delete(`projects/${projectId}/sets/${selectedSet!.id}/cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['set', selectedSet?.id] });
      qc.invalidateQueries({ queryKey: ['sets', projectId] });
    },
  });

  const deleteSet = useMutation({
    mutationFn: (id: string) => api.delete(`projects/${projectId}/sets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sets', projectId] });
      setShowDelete(null);
      setSelectedSet(null);
    },
  });

  const sets   = setsData?.sets ?? [];
  const detail = detailData;
  const existingIds = new Set((detail?.cases ?? []).map(c => c.id));

  const pickerCases = (pickerData?.data ?? []).filter(c =>
    !pickerSearch || c.title.toLowerCase().includes(pickerSearch.toLowerCase())
  );

  function openPicker() {
    setPendingIds(new Set(existingIds));
    setPickerSuite(null);
    setPickerSearch('');
    setShowPicker(true);
  }

  // ── Detail panel ─────────────────────────────────────────────────────────

  if (selectedSet) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 18px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
        }}>
          <button
            onClick={() => setSelectedSet(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', fontSize: '0.875rem', padding: '2px 6px' }}
          >
            ← All sets
          </button>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--gray-900)', flex: 1 }}>
            {selectedSet.name}
          </span>
          {detail && (
            <span style={{
              background: 'var(--color-primary-light)', color: 'var(--color-primary)',
              padding: '2px 10px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 600,
            }}>
              {detail.cases.length} cases
            </span>
          )}
          {canEdit && (
            <>
              <Button variant="primary" size="sm" onClick={openPicker}>Edit cases</Button>
              <button
                onClick={() => setShowDelete(selectedSet.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '0.8125rem', padding: '4px 8px' }}
              >
                Delete set
              </button>
            </>
          )}
        </div>

        {/* Description */}
        {selectedSet.description && (
          <div style={{ padding: '8px 18px', borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem', color: 'var(--gray-500)', flexShrink: 0 }}>
            {selectedSet.description}
          </div>
        )}

        {/* Cases list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingDetail && <div style={{ padding: 32 }}><Spinner /></div>}
          {!loadingDetail && detail?.cases.length === 0 && (
            <EmptyState
              icon="✓"
              title="No cases in this set"
              description="Add test cases to build up this set."
              action={canEdit ? <Button variant="primary" onClick={openPicker}>Add cases</Button> : undefined}
            />
          )}
          {(detail?.cases ?? []).map(tc => (
            <div key={tc.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 18px', borderBottom: '1px solid var(--border-color)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tc.title}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
                  {TYPE_LABELS[tc.type] ?? tc.type} · {tc.priority.toUpperCase()}
                  {tc.suite && <> · <span style={{ color: 'var(--gray-500)' }}>{tc.suite.name}</span></>}
                </div>
              </div>
              {canEdit && (
                <button
                  title="Remove from set"
                  onClick={() => removeCase.mutate(tc.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', fontSize: '0.875rem', padding: '2px 6px' }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Case picker modal */}
        <Modal
          open={showPicker}
          onClose={() => setShowPicker(false)}
          title={`Edit cases — ${selectedSet.name}`}
          maxWidth={680}
          footer={
            <>
              <span style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
                {pendingIds.size} selected
              </span>
              <Button variant="secondary" onClick={() => setShowPicker(false)}>Cancel</Button>
              <Button
                variant="primary"
                loading={saveCases.isPending}
                onClick={() => saveCases.mutate([...pendingIds])}
              >
                Save ({pendingIds.size})
              </Button>
            </>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, height: 360 }}>
            {/* Suite sidebar */}
            <div style={{
              borderRight: '1px solid var(--border-color)', paddingRight: 8,
              overflowY: 'auto',
            }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                Filter by suite
              </div>
              <button
                onClick={() => setPickerSuite(null)}
                style={{
                  width: '100%', textAlign: 'left', padding: '5px 8px', border: 'none',
                  background: pickerSuite === null ? 'var(--color-primary-light)' : 'none',
                  color: pickerSuite === null ? 'var(--color-primary)' : 'var(--gray-600)',
                  borderRadius: 5, fontSize: '0.8125rem', cursor: 'pointer', fontWeight: 500,
                }}
              >
                All cases
              </button>
              <SuiteTree
                projectId={projectId}
                selectedId={pickerSuite}
                canManage={false}
                onSelect={setPickerSuite}
              />
            </div>

            {/* Case list */}
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexShrink: 0 }}>
                <input
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  placeholder="Search cases…"
                  style={{
                    flex: 1, padding: '6px 10px', border: '1px solid var(--border-color)',
                    borderRadius: 6, fontSize: '0.875rem', outline: 'none',
                    background: 'var(--surface-base)', color: 'var(--gray-900)',
                  }}
                />
                <button
                  onClick={() => {
                    const allSelected = pickerCases.length > 0 && pickerCases.every(tc => pendingIds.has(tc.id));
                    setPendingIds(prev => {
                      const next = new Set(prev);
                      if (allSelected) {
                        pickerCases.forEach(tc => next.delete(tc.id));
                      } else {
                        pickerCases.forEach(tc => next.add(tc.id));
                      }
                      return next;
                    });
                  }}
                  style={{
                    padding: '6px 10px', border: '1px solid var(--border-color)',
                    borderRadius: 6, fontSize: '0.8125rem', cursor: 'pointer',
                    background: 'var(--surface-base)', color: 'var(--gray-600)',
                    whiteSpace: 'nowrap', fontWeight: 500,
                  }}
                >
                  {pickerCases.length > 0 && pickerCases.every(tc => pendingIds.has(tc.id))
                    ? 'Deselect all'
                    : 'Select all'}
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {loadingPicker && <Spinner />}
                {!loadingPicker && pickerCases.length === 0 && (
                  <p style={{ color: 'var(--gray-400)', fontSize: '0.875rem', padding: '12px 4px' }}>No cases found.</p>
                )}
                {pickerCases.map(tc => {
                  const checked = pendingIds.has(tc.id);
                  return (
                    <div
                      key={tc.id}
                      onClick={() => {
                        setPendingIds(prev => {
                          const next = new Set(prev);
                          checked ? next.delete(tc.id) : next.add(tc.id);
                          return next;
                        });
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 6px', borderBottom: '1px solid var(--border-color)',
                        cursor: 'pointer',
                        background: checked ? 'var(--color-primary-light)' : 'transparent',
                      }}
                    >
                      <input type="checkbox" checked={checked} onChange={() => {}}
                        style={{ width: 15, height: 15, accentColor: 'var(--color-primary)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.875rem', color: 'var(--gray-900)', fontWeight: checked ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tc.title}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                          {TYPE_LABELS[tc.type] ?? tc.type} · {tc.priority.toUpperCase()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>

        {/* Delete confirm */}
        <Modal
          open={!!showDelete}
          onClose={() => setShowDelete(null)}
          title="Delete test set"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowDelete(null)}>Cancel</Button>
              <Button
                variant="primary"
                loading={deleteSet.isPending}
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={() => showDelete && deleteSet.mutate(showDelete)}
              >
                Delete
              </Button>
            </>
          }
        >
          <p style={{ color: 'var(--gray-600)', margin: 0 }}>
            Delete <strong>{selectedSet.name}</strong>? The test cases themselves are not affected.
          </p>
        </Modal>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 18px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--gray-700)' }}>
          {sets.length} test set{sets.length !== 1 ? 's' : ''}
        </span>
        {canEdit && (
          <Button variant="primary" size="sm" onClick={() => { setShowCreate(true); setCreateError(''); }}>
            + New set
          </Button>
        )}
      </div>

      {/* Sets list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && <div style={{ padding: 32 }}><Spinner /></div>}
        {!isLoading && sets.length === 0 && (
          <EmptyState
            icon="◧"
            title="No test sets yet"
            description="Create a named collection of test cases (e.g. Regression, Smoke, UAT) to speed up run creation."
            action={canEdit ? <Button variant="primary" onClick={() => setShowCreate(true)}>Create first set</Button> : undefined}
          />
        )}
        {sets.map(set => (
          <div
            key={set.id}
            onClick={() => setSelectedSet(set)}
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '13px 18px', borderBottom: '1px solid var(--border-color)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--gray-50)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--gray-900)', marginBottom: 2 }}>
                {set.name}
              </div>
              {set.description && (
                <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460 }}>
                  {set.description}
                </div>
              )}
            </div>
            <span style={{
              background: 'var(--color-primary-light)', color: 'var(--color-primary)',
              padding: '2px 10px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {set.caseCount} {set.caseCount === 1 ? 'case' : 'cases'}
            </span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>
              {new Date(set.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span style={{ color: 'var(--gray-300)', fontSize: '1rem' }}>›</span>
          </div>
        ))}
      </div>

      {/* Create set modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New test set"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={createSet.isPending}
              onClick={() => {
                setCreateError('');
                if (!newName.trim()) { setCreateError('Name is required'); return; }
                createSet.mutate({ name: newName.trim(), description: newDesc.trim() || undefined });
              }}
            >
              Create
            </Button>
          </>
        }
      >
        {createError && <div style={{ marginBottom: 14 }}><Alert type="error">{createError}</Alert></div>}
        <Input
          label="Set name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="e.g. Core Regression, Smoke Tests, UAT"
          autoFocus
        />
        <Input
          label="Description (optional)"
          value={newDesc}
          onChange={e => setNewDesc(e.target.value)}
          placeholder="e.g. All critical-path cases for every release"
        />
      </Modal>
    </div>
  );
}
