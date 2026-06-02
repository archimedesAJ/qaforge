import { useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { AppLayout } from '../components/shared/AppLayout';
import { SuiteTree } from '../components/editor/SuiteTree';
import { CaseList } from '../components/editor/CaseList';
import { CaseEditor } from '../components/editor/CaseEditor';
import { TestSetsPanel } from '../components/editor/TestSetsPanel';
import { useProjectRole } from '../hooks/useProjectRole';
import type { TestCase } from '@qaforge/types';

type Panel = 'list' | 'editor';
type Tab = 'cases' | 'sets';

const MIN_SIDEBAR = 160;
const MAX_SIDEBAR = 520;
const DEFAULT_SIDEBAR = 220;

const TAB_STYLE = (active: boolean): React.CSSProperties => ({
  padding: '8px 18px',
  fontSize: '0.875rem',
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  background: 'none',
  borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
  color: active ? 'var(--color-primary)' : 'var(--gray-500)',
  transition: 'all 0.15s',
});

export function CasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab]                   = useState<Tab>('cases');
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);
  const [panel, setPanel]               = useState<Panel>('list');
  const [editingCase, setEditingCase]   = useState<TestCase | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(DEFAULT_SIDEBAR);

  const { isEditor } = useProjectRole(projectId);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = sidebarWidth;

    function onMouseMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const delta = ev.clientX - startX.current;
      const next  = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startW.current + delta));
      setSidebarWidth(next);
    }

    function onMouseUp() {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  if (!projectId) return null;

  function openNew() { setEditingCase(null); setPanel('editor'); }
  function openEdit(tc: TestCase) { setEditingCase(tc); setPanel('editor'); }
  function handleSaved(_tc: TestCase) { setPanel('list'); setEditingCase(null); }
  function handleCancel() { setPanel('list'); setEditingCase(null); }

  return (
    <AppLayout title="Test cases">
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - var(--topbar-height) - 56px)',
        background: 'var(--surface-base)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--border-radius-lg)',
        overflow: 'hidden',
      }}>

        {/* Tab bar */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
          background: 'var(--surface-base)',
        }}>
          <button style={TAB_STYLE(tab === 'cases')} onClick={() => { setTab('cases'); setPanel('list'); }}>
            Test cases
          </button>
          <button style={TAB_STYLE(tab === 'sets')} onClick={() => setTab('sets')}>
            Test sets
          </button>
        </div>

        {/* Content area */}
        {tab === 'sets' ? (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <TestSetsPanel projectId={projectId} canEdit={isEditor} />
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

            {/* Left panel — suite tree */}
            <div style={{
              width: sidebarWidth,
              flexShrink: 0,
              borderRight: 'none',
              overflowY: 'auto',
              background: 'var(--gray-50)',
              padding: '10px 8px',
            }}>
              <div style={{
                fontSize: '0.6875rem', fontWeight: 600, color: 'var(--gray-400)',
                textTransform: 'uppercase', letterSpacing: '0.07em',
                padding: '4px 8px 8px',
              }}>
                Suites
              </div>
              <SuiteTree
                projectId={projectId}
                selectedId={selectedSuiteId}
                canManage={isEditor}
                onSelect={id => { setSelectedSuiteId(id); setPanel('list'); }}
              />
            </div>

            {/* Draggable divider */}
            <div
              onMouseDown={onDividerMouseDown}
              title="Drag to resize"
              style={{
                width: 6,
                flexShrink: 0,
                cursor: 'col-resize',
                background: 'var(--border-color)',
                position: 'relative',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-primary)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--border-color)')}
            >
              {/* Grip dots */}
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 2, height: 2, borderRadius: '50%',
                    background: 'var(--gray-400)',
                  }} />
                ))}
              </div>
            </div>

            {/* Right panel — case list or editor */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {panel === 'list' ? (
                <CaseList
                  projectId={projectId}
                  suiteId={selectedSuiteId}
                  canEdit={isEditor}
                  onEdit={isEditor ? openEdit : () => {}}
                  onNew={openNew}
                />
              ) : (
                <CaseEditor
                  projectId={projectId}
                  existing={editingCase}
                  defaultSuiteId={selectedSuiteId}
                  onSaved={handleSaved}
                  onCancel={handleCancel}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
