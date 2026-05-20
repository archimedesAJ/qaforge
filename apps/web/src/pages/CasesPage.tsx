import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppLayout } from '../components/shared/AppLayout';
import { SuiteTree } from '../components/editor/SuiteTree';
import { CaseList } from '../components/editor/CaseList';
import { CaseEditor } from '../components/editor/CaseEditor';
import { useProjectRole } from '../hooks/useProjectRole';
import type { TestCase } from '@qaforge/types';

type Panel = 'list' | 'editor';

export function CasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('list');
  const [editingCase, setEditingCase] = useState<TestCase | null>(null);

  const { isEditor } = useProjectRole(projectId);

  if (!projectId) return null;

  function openNew() {
    setEditingCase(null);
    setPanel('editor');
  }

  function openEdit(tc: TestCase) {
    setEditingCase(tc);
    setPanel('editor');
  }

  function handleSaved(_tc: TestCase) {
    setPanel('list');
    setEditingCase(null);
  }

  function handleCancel() {
    setPanel('list');
    setEditingCase(null);
  }

  return (
    <AppLayout title="Test cases">
      <div style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gap: 0,
        height: 'calc(100vh - var(--topbar-height) - 56px)',
        background: 'var(--surface-base)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--border-radius-lg)',
        overflow: 'hidden',
      }}>

        {/* Left panel — suite tree */}
        <div style={{
          borderRight: '1px solid var(--border-color)',
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
            onSelect={id => {
              setSelectedSuiteId(id);
              setPanel('list');
            }}
          />
        </div>

        {/* Right panel — case list or editor */}
        <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
    </AppLayout>
  );
}
