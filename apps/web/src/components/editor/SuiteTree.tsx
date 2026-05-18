import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  onSelect: (suiteId: string | null) => void;
}

export function SuiteTree({ projectId, selectedId, onSelect }: SuiteTreeProps) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<string | null>(null); // parentId or 'root'
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');

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

  const suites = data?.suites ?? [];
  const roots = suites.filter(s => !s.parentId);

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
    const children = suites.filter(s => s.parentId === suite.id);
    const isExpanded = expanded.has(suite.id);
    const isSelected = selectedId === suite.id;
    const isRenaming = renaming === suite.id;

    return (
      <div key={suite.id}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 8px',
            paddingLeft: 8 + depth * 16,
            borderRadius: 6,
            background: isSelected ? 'var(--color-primary-light)' : 'transparent',
            cursor: 'pointer',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => {
            if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--gray-100)';
          }}
          onMouseLeave={e => {
            if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
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
            {isExpanded ? '📂' : '📁'}
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

          {/* Actions (visible on hover via parent hover) */}
          {!isRenaming && (
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <button
                title="Add sub-suite"
                onClick={e => { e.stopPropagation(); setCreating(suite.id); setExpanded(prev => new Set([...prev, suite.id])); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', color: 'var(--gray-400)', fontSize: '0.875rem', borderRadius: 3 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-400)'}
              >+</button>
              <button
                title="Rename"
                onClick={e => { e.stopPropagation(); setRenaming(suite.id); setRenameName(suite.name); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', color: 'var(--gray-400)', fontSize: '0.75rem', borderRadius: 3 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-700)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-400)'}
              >✎</button>
              <button
                title="Delete suite"
                onClick={e => {
                  e.stopPropagation();
                  if (confirm(`Delete suite "${suite.name}"?`)) deleteSuite.mutate(suite.id);
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', color: 'var(--gray-400)', fontSize: '0.75rem', borderRadius: 3 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--color-danger)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--gray-400)'}
              >✕</button>
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

  return (
    <div style={{ padding: '8px 0' }}>
      {/* All cases (no suite filter) */}
      <div
        onClick={() => onSelect(null)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
          background: selectedId === null ? 'var(--color-primary-light)' : 'transparent',
          fontSize: '0.875rem',
          color: selectedId === null ? 'var(--color-primary)' : 'var(--gray-600)',
          fontWeight: selectedId === null ? 500 : 400,
          marginBottom: 4,
        }}
        onMouseEnter={e => { if (selectedId !== null) (e.currentTarget as HTMLElement).style.background = 'var(--gray-100)'; }}
        onMouseLeave={e => { if (selectedId !== null) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span>📋</span>
        <span>All cases</span>
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
    </div>
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
