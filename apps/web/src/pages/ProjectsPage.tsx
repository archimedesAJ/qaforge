import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Input, Modal, EmptyState, Alert, Spinner } from '../components/shared/ui';
import { api } from '../lib/api';
import type { Project } from '@qaforge/types';

export function ProjectsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[]; isSystemAdmin: boolean }>('projects'),
  });

  const [search, setSearch] = useState('');

  const projects      = data?.projects ?? [];
  const isSystemAdmin = data?.isSystemAdmin ?? false;

  const filtered = search.trim()
    ? projects.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.slug.toLowerCase().includes(search.toLowerCase())
      )
    : projects;

  function handleProjectClick(project: Project) {
    navigate(`/projects/${project.id}`);
  }

  return (
    <AppLayout>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="page-header">
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              Projects
              {isSystemAdmin && (
                <span style={{
                  background: '#FEF3C7', color: '#92400E',
                  fontSize: '0.75rem', fontWeight: 700,
                  padding: '2px 10px', borderRadius: 20,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                }}>
                  System Admin
                </span>
              )}
            </h1>
            <p className="page-subtitle">
              {isSystemAdmin ? 'Viewing all projects across the system' : 'All test projects you have access to'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {isSystemAdmin && (
              <Button variant="secondary" onClick={() => navigate('/admin/dashboard')}>
                📊 Overview
              </Button>
            )}
            {isSystemAdmin && (
              <Button variant="secondary" onClick={() => navigate('/admin/users')}>
                👥 Manage users
              </Button>
            )}
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              + New project
            </Button>
          </div>
        </div>

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Spinner size="lg" />
          </div>
        )}

        {isError && <Alert type="error">Failed to load projects. Is the API running?</Alert>}

        {!isLoading && !isError && projects.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <input
              type="search"
              placeholder="Search projects…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', maxWidth: 360,
                padding: '8px 12px',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                fontSize: '0.875rem',
                outline: 'none',
                background: 'var(--surface-base)',
                color: 'var(--gray-900)',
              }}
            />
          </div>
        )}

        {!isLoading && !isError && projects.length === 0 && (
          <div className="card">
            <EmptyState
              icon="🗂"
              title="No projects yet"
              description="Create your first project to start managing test cases, running tests, and tracking quality."
              action={
                <Button variant="primary" onClick={() => setShowCreate(true)}>
                  Create first project
                </Button>
              }
            />
          </div>
        )}

        {!isLoading && !isError && projects.length > 0 && filtered.length === 0 && (
          <div className="card">
            <EmptyState icon="🔍" title="No projects match" description={`No projects found for "${search}".`} />
          </div>
        )}

        {filtered.length > 0 && (
          <div className="grid-3">
            {filtered.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => handleProjectClick(project)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(project) => {
          // Optimistically add the new project to the cache so it appears
          // immediately if the user navigates back to this page.
          qc.setQueryData<{ projects: Project[] }>(['projects'], old =>
            old ? { projects: [...old.projects, project] } : { projects: [project] }
          );
          setShowCreate(false);
          navigate(`/projects/${project.id}`);
        }}
      />
    </AppLayout>
  );
}

// ── Helpers ───────────────────────────────────────────────────
const AVATAR_PALETTES = [
  { bg: '#DBEAFE', color: '#1D4ED8' },
  { bg: '#D1FAE5', color: '#065F46' },
  { bg: '#EDE9FE', color: '#5B21B6' },
  { bg: '#FEE2E2', color: '#991B1B' },
  { bg: '#FEF3C7', color: '#92400E' },
  { bg: '#FCE7F3', color: '#9D174D' },
  { bg: '#CCFBF1', color: '#115E59' },
  { bg: '#E0E7FF', color: '#3730A3' },
];

function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function projectPalette(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
}

// ── Project card ──────────────────────────────────────────────
function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--surface-base)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '20px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: 'var(--shadow-sm)',
        width: '100%',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)';
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)';
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)';
      }}
    >
      {/* Project avatar */}
      {(() => {
        const pal = projectPalette(project.name);
        return (
          <div style={{
            width: 44, height: 44,
            background: pal.bg,
            borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1rem', fontWeight: 700, letterSpacing: '0.02em',
            color: pal.color,
            marginBottom: 14,
            userSelect: 'none',
          }}>
            {projectInitials(project.name)}
          </div>
        );
      })()}

      <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--gray-900)', marginBottom: 4 }}>
        {project.name}
      </div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', fontFamily: 'monospace' }}>
        {project.slug}
      </div>

      <div style={{
        marginTop: 16,
        paddingTop: 14,
        borderTop: '1px solid var(--border-color)',
        fontSize: '0.8125rem',
        color: 'var(--gray-400)',
      }}>
        Created {new Date(project.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
      </div>
    </button>
  );
}

// ── Create project modal ──────────────────────────────────────
function CreateProjectModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (data: { name: string; slug: string }) =>
      api.post<Project>('projects', data),
    onSuccess: onCreated,
    onError: (err: Error) => setError(err.message),
  });

  function handleNameChange(value: string) {
    setName(value);
    const generated = value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (generated.length <= 50) {
      setSlug(generated);
    } else {
      const cut = generated.slice(0, 50);
      const lastHyphen = cut.lastIndexOf('-');
      setSlug(lastHyphen > 10 ? cut.slice(0, lastHyphen) : cut);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Project name is required'); return; }
    if (!slug.trim()) { setError('Slug is required'); return; }
    if (slug.trim().length > 50) { setError('Slug must be 50 characters or fewer'); return; }
    if (!/^[a-z0-9-]+$/.test(slug.trim())) { setError('Slug must be lowercase letters, numbers, and hyphens only'); return; }
    mutation.mutate({ name: name.trim(), slug: slug.trim() });
  }

  function handleClose() {
    setName(''); setSlug(''); setError('');
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New project"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={handleSubmit as () => void}
          >
            Create project
          </Button>
        </>
      }
    >
      {error && <div style={{ marginBottom: 16 }}><Alert type="error">{error}</Alert></div>}
      <form onSubmit={handleSubmit}>
        <Input
          label="Project name"
          value={name}
          onChange={e => handleNameChange(e.target.value)}
          placeholder="Payments API"
          autoFocus
          required
        />
        <Input
          label="Slug"
          value={slug}
          onChange={e => setSlug(e.target.value)}
          placeholder="payments-api"
          hint="Used in URLs — lowercase letters, numbers, and hyphens only"
          required
        />
      </form>
    </Modal>
  );
}
