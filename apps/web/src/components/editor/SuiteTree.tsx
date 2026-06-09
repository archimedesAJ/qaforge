import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../shared/ui';
import { api } from '../../lib/api';

export interface Suite {
  id: string;
  name: string;
  parentId?: string;
  children?: Suite[];
  projectId: string;
}

interface SuiteTreeProps {
  projectId: string;
  selectedId: string | null;
  canManage?: boolean;
  canCreate?: boolean;
  onSelect: (suiteId: string | null) => void;
}

// '__root__' means "drop as a top-level suite (no parent)"
type DragOverTarget = string | '__root__' | null;

export function SuiteTree({ projectId, selectedId, canManage = true, canCreate = canManage, onSelect }: SuiteTreeProps) {
  const qc = useQueryClient();
  const [expanded, setExpanded]           = useState<Set<string>>(new Set());
  const [creating, setCreating]           = useState<string | null>(null);
  const [newName, setNewName]             = useState('');
  const [renaming, setRenaming]           = useState<string | null>(null);
  const [renameName, setRenameName]       = useState('');
  const [confirmSuite, setConfirmSuite]   = useState<{ id: string; name: string } | null>(null);
  const [draggingId, setDraggingId]       = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DragOverTarget>(null);

  const { data } = useQuery({
    queryKey: ['suites', projectId],
    queryFn: () => api.get<{ suites: Suite[] }>(`projects/${projectId}/suites`),
    enabled: !!projectId,
  });

  const createSuite = useMutation({
    mutationFn: (body: { name: string; parentId?: string }) =>
      api.post<Suite>(`projects/${projectId}/suites`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suites', projectId] });
      setCreating(null);
      setNewName('');
    },
  });

  const deleteSuite = useMutation({
    mutationFn: (suiteId: string) =>
      api.delete(`projects/${projectId}/suites/${suiteId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suites', projectId] });
      if (selectedId) onSelect(null);
    },
  });

  const renameSuite = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.put(`projects/${projectId}/suites/${id}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suites', projectId] });
      setRenaming(null);
      setRenameName('');
    },
  });

  const moveSuite = useMutation({
    mutationFn: ({ suiteId, parentId }: { suiteId: string; parentId: string | null }) =>
      api.patch(`projects/${projectId}/suites/${suiteId}`, { parentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suites', projectId] }),
  });

  const suites = data?.suites ?? [];
  const roots  = suites.filter(s => !s.parentId);

  // Returns true if `nodeId` is the same as `ancestorId` or is anywhere under it
  function isDescendantOrSelf(ancestorId: string, nodeId: string): boolean {
    if (nodeId === ancestorId) return true;
    const children = suites.filter(s => s.parentId === ancestorId);
    return children.some(c => isDescendantOrSelf(c.id, nodeId));
  }

  function isValidDrop(targetId: string | null): boolean {
    if (!draggingId) return false;
    if (targetId === null) {
      // Dropping to root — valid unless already a root suite
      const dragged = suites.find(s => s.id === draggingId);
      return !!dragged && !!dragged.parentId; // only useful if it has a parent
    }
    return !isDescendantOrSelf(draggingId, targetId);
  }

  function handleDrop(targetParentId: string | null) {
    if (!draggingId || !isValidDrop(targetParentId)) return;
    moveSuite.mutate({ suiteId: draggingId, parentId: targetParentId });
    // Auto-expand the target so the moved suite is visible
    if (targetParentId) {
      setExpanded(prev => new Set([...prev, targetParentId]));
    }
    setDraggingId(null);
    setDragOverTarget(null);
  }

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleCreate(parentId?: string) {
    if (!newName.trim()) return;
    createSuite.mutate({ name: newName.trim(), parentId });
  }

  function handleRename(id: string) {
    if (!renameName.trim()) return;
    renameSuite.mutate({ id, name: renameName.trim() });
  }

  function renderSuite(suite: Suite, depth = 0) {
    const children    = suites.filter(s => s.parentId === suite.id);
    const isExpanded  = expanded.has(suite.id);
    const isSelected  = selectedId === suite.id;
    const isRenaming  = renaming === suite.id;
    const isDragging  = draggingId === suite.id;
    const isDragOver  = dragOverTarget === suite.id && isValidDrop(suite.id);

    return (
      <div key={suite.id}>
        <div
          draggable={canManage}
          onDragStart={e => {
            e.stopPropagation();
            setDraggingId(suite.id);
            e.dataTransfer.effectAllowed = 'move';
            // Ghost label
            e.dataTransfer.setData('text/plain', suite.name);
          }}
          onDragEnd={() => { setDraggingId(null); setDragOverTarget(null); }}
          onDragOver={e => {
            e.preventDefault();
            e.stopPropagation();
            if (isValidDrop(suite.id)) {
              e.dataTransfer.dropEffect = 'move';
              setDragOverTarget(suite.id);
            } else {
              e.dataTransfer.dropEffect = 'none';
            }
          }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOverTarget(null);
            }
          }}
          onDrop={e => {
            e.preventDefault();
            e.stopPropagation();
            handleDrop(suite.id);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 8px',
            paddingLeft: 8 + depth * 16,
            borderRadius: 6,
            background: isDragOver
              ? 'var(--color-primary-light)'
              : isSelected ? 'var(--color-primary-light)' : 'transparent',
            cursor: isDragging ? 'grabbing' : canManage ? 'grab' : 'pointer',
            transition: 'background 0.1s',
            opacity: isDragging ? 0.4 : 1,
            outline: isDragOver ? '2px dashed var(--color-primary)' : 'none',
            outlineOffset: -2,
          }}
          onMouseEnter={e => {
            if (!isSelected && !isDragOver)
              (e.currentTarget as HTMLElement).style.background = 'var(--gray-100)';
          }}
          onMouseLeave={e => {
            if (!isSelected && !isDragOver)
              (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
          {/* Drag handle grip (visible to editors) */}
          {canManage && (
            <span style={{
              color: 'var(--gray-300)', fontSize: '0.625rem', cursor: 'grab',
              flexShrink: 0, letterSpacing: '-1px', lineHeight: 1,
            }}>
              ⠿
            </span>
          )}

          {/* Chevron */}
          <button
            onClick={() => toggle(suite.id)}
            style={{
              background: 'none', border: 'none', padding: '0 2px',
              color: 'var(--gray-400)', fontSize: '0.7rem',
              cursor: 'pointer', width: 16, flexShrink: 0,
              opacity: children.length > 0 ? 1 : 0,
            }}
          >
            {isExpanded ? '▾' : '▸'}
          </button>

          {/* Folder icon */}
          <span style={{ fontSize: '0.875rem', flexShrink: 0 }}>
            {isDragOver ? '📂' : isExpanded ? '📂' : '📁'}
          </span>

          {/* Name or rename input */}
          {isRenaming ? (
            <input
              autoFocus
              value={renameName}
              onChange={e => setRenameName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRename(suite.id);
                if (e.key === 'Escape') { setRenaming(null); setRenameName(''); }
              }}
              onBlur={() => { setRenaming(null); setRenameName(''); }}
              style={{
                flex: 1, border: '1px solid var(--color-primary)', borderRadius: 4,
                padding: '1px 6px', fontSize: '0.875rem', outline: 'none',
                background: 'var(--surface-base)',
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span
              onClick={() => onSelect(suite.id)}
              style={{
                flex: 1, fontSize: '0.875rem',
                color: isSelected ? 'var(--color-primary)' : 'var(--gray-700)',
                fontWeight: isSelected ? 500 : 400,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {suite.name}
            </span>
          )}

          {/* Actions */}
          {!isRenaming && (canCreate || canManage) && (
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              {canCreate && (
                <button
                  title="Add sub-suite"
                  onClick={e => { e.stopPropagation(); setCreating(suite.id); setExpanded(prev => new Set([...prev, suite.id])); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', color: 'var(--gray-400)', fontSize: '0.875rem', borderRadius: 3 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-400)'}
                >+</button>
              )}
              {canManage && (
                <button
                  title="Rename"
                  onClick={e => { e.stopPropagation(); setRenaming(suite.id); setRenameName(suite.name); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', color: 'var(--gray-400)', fontSize: '0.75rem', borderRadius: 3 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-700)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-400)'}
                >✎</button>
              )}
              {canManage && (
                <button
                  title="Delete suite"
                  onClick={e => { e.stopPropagation(); setConfirmSuite({ id: suite.id, name: suite.name }); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', color: 'var(--gray-400)', fontSize: '0.75rem', borderRadius: 3 }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-danger)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-400)'}
                >✕</button>
              )}
            </div>
          )}
        </div>

        {/* Inline create sub-suite input */}
        {creating === suite.id && isExpanded && (
          <InlineCreate
            depth={depth + 1}
            value={newName}
            onChange={setNewName}
            onConfirm={() => handleCreate(suite.id)}
            onCancel={() => { setCreating(null); setNewName(''); }}
          />
        )}

        {/* Children */}
        {isExpanded && children.map(child => renderSuite(child, depth + 1))}
      </div>
    );
  }

  const rootDragOver = dragOverTarget === '__root__' && isValidDrop(null);

  return (
    <>
      <ConfirmDialog
        open={!!confirmSuite}
        title="Delete suite"
        message={`Delete suite "${confirmSuite?.name}"? All test cases inside will be unassigned.`}
        confirmLabel="Delete"
        onConfirm={() => { deleteSuite.mutate(confirmSuite!.id); setConfirmSuite(null); }}
        onCancel={() => setConfirmSuite(null)}
      />
      <div style={{ padding: '8px 0' }}>
        {/* All cases — also a drop target to promote a suite to root */}
        <div
          onClick={() => onSelect(null)}
          onDragOver={e => {
            e.preventDefault();
            if (isValidDrop(null)) { e.dataTransfer.dropEffect = 'move'; setDragOverTarget('__root__'); }
            else e.dataTransfer.dropEffect = 'none';
          }}
          onDragLeave={() => setDragOverTarget(null)}
          onDrop={e => { e.preventDefault(); handleDrop(null); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
            background: rootDragOver
              ? 'var(--color-primary-light)'
              : selectedId === null ? 'var(--color-primary-light)' : 'transparent',
            fontSize: '0.875rem',
            color: selectedId === null ? 'var(--color-primary)' : 'var(--gray-600)',
            fontWeight: selectedId === null ? 500 : 400,
            marginBottom: 4,
            outline: rootDragOver ? '2px dashed var(--color-primary)' : 'none',
            outlineOffset: -2,
          }}
          onMouseEnter={e => { if (selectedId !== null && !rootDragOver) (e.currentTarget as HTMLElement).style.background = 'var(--gray-100)'; }}
          onMouseLeave={e => { if (selectedId !== null && !rootDragOver) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <span>📋</span>
          <span>All cases</span>
          {rootDragOver && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', marginLeft: 4 }}>
              Move to top level
            </span>
          )}
        </div>

        {/* Suite tree */}
        {roots.map(suite => renderSuite(suite))}

        {/* Inline create root suite */}
        {creating === 'root' && (
          <InlineCreate
            depth={0}
            value={newName}
            onChange={setNewName}
            onConfirm={() => handleCreate(undefined)}
            onCancel={() => { setCreating(null); setNewName(''); }}
          />
        )}

        {/* New suite button */}
        {canCreate && (
          <button
            onClick={() => setCreating('root')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', padding: '5px 8px', marginTop: 4,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.8125rem', color: 'var(--gray-400)', borderRadius: 6,
              textAlign: 'left',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--gray-400)'; }}
          >
            <span>+</span> New suite
          </button>
        )}
      </div>
    </>
  );
}

function InlineCreate({
  depth, value, onChange, onConfirm, onCancel,
}: {
  depth: number;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', paddingLeft: 8 + depth * 16 }}>
      <span style={{ fontSize: '0.875rem' }}>📁</span>
      <input
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onConfirm();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Suite name…"
        style={{
          flex: 1, border: '1px solid var(--color-primary)', borderRadius: 4,
          padding: '2px 8px', fontSize: '0.875rem', outline: 'none',
          background: 'var(--surface-base)', color: 'var(--gray-900)',
        }}
      />
      <button onClick={onConfirm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-success)', fontSize: '1rem' }}>✓</button>
      <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '1rem' }}>✕</button>
    </div>
  );
}
