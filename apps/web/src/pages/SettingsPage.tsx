import { useState, useEffect, FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Input, Select, Alert, Modal, Spinner, EmptyState, ConfirmDialog } from '../components/shared/ui';
import { api } from '../lib/api';
import { useProjectRole } from '../hooks/useProjectRole';
import { useAuthStore } from '../store/auth';

type Tab = 'general' | 'team' | 'apikeys' | 'environments' | 'notifications' | 'integrations' | 'danger';
type ProjectCategory = 'client-facing' | 'internal' | 'infrastructure' | 'third-party';

interface Member {
  userId: string;
  role: string;
  user: { id: string; email: string; name: string };
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
}

interface ApiKey {
  id: string;
  name: string;
  scope: string;
  createdAt: string;
  lastUsedAt?: string;
}

interface Environment {
  id: string;
  name: string;
  baseUrl: string;
}

interface NotifSetting {
  event: string;
  label: string;
  channel: 'slack' | 'email';
  enabled: boolean;
}

const DEFAULT_NOTIFS: NotifSetting[] = [
  { event: 'p0_failure',       label: 'P0 / P1 test failure',        channel: 'slack', enabled: true  },
  { event: 'flakiness_spike',  label: 'Flakiness score spike (>0.6)', channel: 'slack', enabled: true  },
  { event: 'gate_failed',      label: 'Release gate failed',          channel: 'slack', enabled: true  },
  { event: 'run_complete',     label: 'Run completed summary',        channel: 'slack', enabled: false },
  { event: 'daily_digest',     label: 'Daily run summary',            channel: 'email', enabled: true  },
  { event: 'weekly_flakiness', label: 'Weekly flakiness report',      channel: 'email', enabled: true  },
  { event: 'release_digest',   label: 'Release readiness digest',     channel: 'email', enabled: false },
];

export function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab]   = useState<Tab>('general');
  const { isAdmin }     = useProjectRole(projectId);
  const isSystemAdmin   = useAuthStore(s => s.user?.systemAdmin ?? false);

  if (!projectId) return null;

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'general',       label: 'General'      },
    { id: 'team',          label: 'Team'         },
    { id: 'apikeys',       label: 'API keys'     },
    { id: 'environments',  label: 'Environments' },
    { id: 'notifications', label: 'Notifications'},
    { id: 'integrations',  label: 'Integrations' },
    { id: 'danger',        label: 'Danger zone'  },
  ];

  return (
    <AppLayout title="Settings">
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Tab nav */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--border-color)',
          marginBottom: 28, gap: 0, overflowX: 'auto',
        }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.9rem', fontFamily: 'inherit', whiteSpace: 'nowrap',
              color: tab === t.id
                ? t.id === 'danger' ? 'var(--color-danger)' : 'var(--color-primary)'
                : 'var(--gray-500)',
              borderBottom: `2px solid ${tab === t.id
                ? t.id === 'danger' ? 'var(--color-danger)' : 'var(--color-primary)'
                : 'transparent'}`,
              marginBottom: -1, fontWeight: tab === t.id ? 600 : 400,
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'general'      && <GeneralTab       projectId={projectId} isAdmin={isAdmin} isSystemAdmin={isSystemAdmin} />}
        {tab === 'team'         && <TeamTab          projectId={projectId} />}
        {tab === 'apikeys'      && <ApiKeysTab        projectId={projectId} />}
        {tab === 'environments' && <EnvironmentsTab   projectId={projectId} />}
        {tab === 'notifications'&& <NotificationsTab  projectId={projectId} />}
        {tab === 'integrations' && <IntegrationsTab   projectId={projectId} />}
        {tab === 'danger'       && <DangerTab         projectId={projectId} />}
      </div>
    </AppLayout>
  );
}

// ── General tab ───────────────────────────────────────────────
function GeneralTab({ projectId, isAdmin, isSystemAdmin }: { projectId: string; isAdmin: boolean; isSystemAdmin: boolean }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<{ name: string; category: ProjectCategory | null }>(`projects/${projectId}`),
  });

  const [name, setName]         = useState('');
  const [category, setCategory] = useState<ProjectCategory | ''>('');
  const [success, setSuccess]   = useState('');
  const [error, setError]       = useState('');

  useEffect(() => {
    if (data) {
      setName(data.name);
      setCategory(data.category ?? '');
    }
  }, [data]);

  const update = useMutation({
    mutationFn: () => api.patch(`projects/${projectId}`, {
      name: name.trim(),
      category: category || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setSuccess('Project updated.');
      setError('');
      setTimeout(() => setSuccess(''), 3000);
    },
    onError: (err: Error) => setError(err.message),
  });

  if (isLoading) return <Spinner />;
  if (!isAdmin) return <Alert type="error">Only project admins can edit general settings.</Alert>;

  return (
    <div style={{ maxWidth: 480 }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 20 }}>General</h2>

      {error   && <div style={{ marginBottom: 14 }}><Alert type="error">{error}</Alert></div>}
      {success && <div style={{ marginBottom: 14 }}><Alert type="success">{success}</Alert></div>}

      <Input
        label="Project name"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="My Project"
      />

      {isSystemAdmin && (
        <div style={{ marginTop: 14, marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-700)', marginBottom: 6 }}>
            Category <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>(optional)</span>
          </label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as ProjectCategory | '')}
            style={{
              width: '100%', padding: '8px 10px',
              border: '1px solid var(--border-color)', borderRadius: 8,
              fontSize: '0.875rem', background: 'var(--surface-base)', color: 'var(--gray-900)',
            }}
          >
            <option value="">— No category —</option>
            <option value="client-facing">Client-facing</option>
            <option value="internal">Internal</option>
            <option value="infrastructure">Infrastructure</option>
            <option value="third-party">Third-party</option>
          </select>
        </div>
      )}

      <Button variant="primary" loading={update.isPending} onClick={() => update.mutate()}>
        Save changes
      </Button>
    </div>
  );
}

// ── Team tab ──────────────────────────────────────────────────
function TeamTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { isManager, isAdmin } = useProjectRole(projectId);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('editor');
  const [error, setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<{ members: Member[]; pendingInvites: PendingInvite[] }>(`projects/${projectId}`),
  });

  const invite = useMutation({
    mutationFn: () =>
      api.post(`projects/${projectId}/members/invite`, { email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      setInviteEmail('');
      setSuccess(`Invite sent to ${inviteEmail}`);
      setError('');
      setTimeout(() => setSuccess(''), 4000);
    },
    onError: (err: Error) => setError(err.message),
  });

  const changeRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      api.patch(`projects/${projectId}/members/${memberId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`projects/${projectId}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => api.delete(`projects/${projectId}/invites/${inviteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  const members        = data?.members ?? [];
  const pendingInvites = data?.pendingInvites ?? [];

  function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) { setError('Email is required'); return; }
    setError('');
    invite.mutate();
  }

  return (
    <div>
      {isManager && (
        <>
          <SectionHeader
            title="Invite member"
            desc="Send an invite email so they can set their password and join."
          />

          {error   && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}
          {success && <div style={{ marginBottom: 12 }}><Alert type="success">{success}</Alert></div>}

          <form onSubmit={handleInvite}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <Input
                placeholder="colleague@example.com"
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                style={{ flex: 1, marginBottom: 0 }}
              />
              <select
                className="input"
                style={{ width: 115 }}
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
              >
                <option value="manager">Manager</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <Button type="submit" variant="primary" loading={invite.isPending}>Send invite</Button>
            </div>
          </form>
        </>
      )}

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <>
          <SectionHeader title="Pending invites" desc="Awaiting acceptance." />
          {pendingInvites.map(inv => (
            <div key={inv.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0', borderBottom: '1px solid var(--border-color)',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: 'var(--gray-100)', border: '1px solid var(--border-color)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1rem', flexShrink: 0,
              }}>✉</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{inv.email}</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 1 }}>
                  {inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString('en-GB')}
                </div>
              </div>
              <span style={{
                fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px',
                background: 'var(--color-warning-light)', color: 'var(--color-warning)',
                borderRadius: 10,
              }}>pending</span>
              {isManager && (
                <Button
                  variant="ghost" size="sm"
                  style={{ color: 'var(--gray-400)', fontSize: '0.8125rem' }}
                  onClick={() => cancelInvite.mutate(inv.id)}
                >
                  Cancel
                </Button>
              )}
            </div>
          ))}
          <div style={{ height: 20 }} />
        </>
      )}

      <SectionHeader title="Members" desc="Manage roles and access." />

      {isLoading && <Spinner />}

      {members.map(m => (
        <div key={m.userId} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '11px 0', borderBottom: '1px solid var(--border-color)',
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'var(--color-primary-light)', border: '1px solid #bfdbfe',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-primary)', flexShrink: 0,
          }}>
            {(m.user.name || m.user.email).charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{m.user.name || m.user.email}</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>{m.user.email}</div>
          </div>
          {isAdmin ? (
            <select
              className="input"
              style={{ width: 110, fontSize: '0.875rem', padding: '5px 8px' }}
              value={m.role}
              onChange={e => changeRole.mutate({ memberId: m.userId, role: e.target.value })}
            >
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          ) : (
            <span style={{
              fontSize: '0.8125rem', color: 'var(--gray-500)',
              padding: '4px 10px', background: 'var(--gray-100)', borderRadius: 6,
            }}>{m.role}</span>
          )}
          {isAdmin && (
            <Button
              variant="ghost" size="sm"
              style={{ color: 'var(--color-danger)' }}
              onClick={() => setConfirmRemove({ userId: m.userId, name: m.user.name || m.user.email })}
            >
              Remove
            </Button>
          )}
        </div>
      ))}

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove member"
        message={`Remove ${confirmRemove?.name} from this project? They will lose all access immediately.`}
        confirmLabel="Remove"
        onConfirm={() => { remove.mutate(confirmRemove!.userId); setConfirmRemove(null); }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

// ── API keys tab ──────────────────────────────────────────────
function ApiKeysTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { isManager } = useProjectRole(projectId);
  const [showCreate, setShowCreate] = useState(false);
  const [keyName, setKeyName]       = useState('');
  const [scope, setScope]           = useState('write:results');
  const [newKey, setNewKey]         = useState<string | null>(null);
  const [error, setError]           = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys', projectId],
    queryFn: () => api.get<{ keys: ApiKey[] }>(`projects/${projectId}/api-keys`),
  });

  const create = useMutation({
    mutationFn: () => api.post<{ key: string }>(`auth/api-keys`, { name: keyName, projectId, scope }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['api-keys', projectId] });
      setNewKey(res.key);
      setShowCreate(false);
      setKeyName('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`auth/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', projectId] }),
  });

  const keys = data?.keys ?? [];

  return (
    <div>
      <SectionHeader
        title="API keys"
        desc="Keys are scoped to this project. A key is shown only once — copy it before closing."
        action={isManager ? <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>Create key</Button> : undefined}
      />

      {newKey && (
        <div style={{
          padding: '12px 14px', background: 'var(--color-success-light)',
          border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 16,
        }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-success)', marginBottom: 6 }}>
            ✓ Key created — copy it now, it won't be shown again
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{
              flex: 1, fontFamily: 'monospace', fontSize: '0.8125rem',
              padding: '6px 10px', background: 'var(--surface-base)',
              border: '1px solid var(--border-color)', borderRadius: 6,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {newKey}
            </code>
            <Button variant="secondary" size="sm" onClick={() => { navigator.clipboard.writeText(newKey); }}>
              Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setNewKey(null)}>Dismiss</Button>
          </div>
        </div>
      )}

      {isLoading && <Spinner />}

      {!isLoading && keys.length === 0 && (
        <EmptyState icon="🔑" title="No API keys yet" description="Create a key to enable CI/CD result ingest." />
      )}

      {keys.map(k => (
        <div key={k.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '12px 0', borderBottom: '1px solid var(--border-color)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{k.name}</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2, fontFamily: 'monospace' }}>
              tms_k_••••••••
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: 3 }}>
              Scope: {k.scope} · Created {new Date(k.createdAt).toLocaleDateString('en-GB')}
              {k.lastUsedAt && ` · Last used ${new Date(k.lastUsedAt).toLocaleDateString('en-GB')}`}
            </div>
          </div>
          {isManager && (
            <Button
              variant="ghost" size="sm"
              style={{ color: 'var(--color-danger)', flexShrink: 0 }}
              onClick={() => setConfirmRevoke({ id: k.id, name: k.name })}
            >
              Revoke
            </Button>
          )}
        </div>
      ))}

      <ConfirmDialog
        open={!!confirmRevoke}
        title="Revoke API key"
        message={`Revoke "${confirmRevoke?.name}"? Any CI/CD pipelines using this key will stop working immediately.`}
        confirmLabel="Revoke"
        onConfirm={() => { revoke.mutate(confirmRevoke!.id); setConfirmRevoke(null); }}
        onCancel={() => setConfirmRevoke(null)}
      />

      {/* CI snippet */}
      <div style={{
        marginTop: 24, padding: '14px 16px',
        background: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: 8,
      }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--gray-600)', marginBottom: 8 }}>
          GitHub Actions — ingest JUnit results
        </div>
        <pre style={{
          fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--gray-700)',
          margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6,
        }}>
{`- name: Push results to QAForge
  run: |
    curl -X POST $QAFORGE_URL/projects/$PROJECT_ID/runs/$RUN_ID/ingest/junit \\
      -H "Authorization: Bearer $QAFORGE_API_KEY" \\
      -H "Content-Type: application/xml" \\
      --data-binary @test-results.xml`}
        </pre>
      </div>

      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setError(''); }}
        title="Create API key"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} onClick={() => { setError(''); create.mutate(); }}>
              Create
            </Button>
          </>
        }
      >
        {error && <div style={{ marginBottom: 12 }}><Alert type="error">{error}</Alert></div>}
        <Input
          label="Key name"
          value={keyName}
          onChange={e => setKeyName(e.target.value)}
          placeholder="e.g. GitHub Actions"
          autoFocus
        />
        <Select
          label="Scope"
          value={scope}
          onChange={e => setScope(e.target.value)}
          options={[
            { value: 'write:results', label: 'write:results — ingest only' },
            { value: 'write:all',     label: 'write:all — full write access' },
            { value: 'read',          label: 'read — read only' },
          ]}
        />
      </Modal>
    </div>
  );
}

// ── Environments tab ──────────────────────────────────────────
function EnvironmentsTab({ projectId }: { projectId: string }) {
  const { isManager } = useProjectRole(projectId);
  const [envs, setEnvs] = useState<Environment[]>([
    { id: '1', name: 'Production',  baseUrl: 'https://api.example.com'         },
    { id: '2', name: 'Staging',     baseUrl: 'https://api.staging.example.com' },
    { id: '3', name: 'Local',       baseUrl: 'http://localhost:3001'            },
  ]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl]   = useState('');

  function add() {
    if (!newName.trim() || !newUrl.trim()) return;
    setEnvs(prev => [...prev, { id: Date.now().toString(), name: newName, baseUrl: newUrl }]);
    setNewName(''); setNewUrl(''); setShowAdd(false);
  }

  return (
    <div>
      <SectionHeader
        title="Environments"
        desc="Define environments and their base URLs for run scoping and variable resolution."
        action={isManager ? <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>Add environment</Button> : undefined}
      />

      {envs.map(env => (
        <div key={env.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 0', borderBottom: '1px solid var(--border-color)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{env.name}</div>
            <div style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
              {env.baseUrl}
            </div>
          </div>
          {isManager && <Button variant="ghost" size="sm">Edit</Button>}
          {isManager && (
            <Button
              variant="ghost" size="sm"
              style={{ color: 'var(--color-danger)' }}
              onClick={() => setEnvs(prev => prev.filter(e => e.id !== env.id))}
            >
              Remove
            </Button>
          )}
        </div>
      ))}

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add environment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button variant="primary" onClick={add}>Add</Button>
          </>
        }
      >
        <Input label="Name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Staging" autoFocus />
        <Input label="Base URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://api.staging.example.com" />
      </Modal>
    </div>
  );
}

// ── Notifications tab ─────────────────────────────────────────
function NotificationsTab({ projectId }: { projectId: string }) {
  const { isManager } = useProjectRole(projectId);
  const [notifs, setNotifs] = useState<NotifSetting[]>(DEFAULT_NOTIFS);
  const [slackUrl, setSlackUrl] = useState('');
  const [smtpEmail, setSmtpEmail] = useState('');
  const [saved, setSaved] = useState(false);

  function save() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const slackNotifs = notifs.filter(n => n.channel === 'slack');
  const emailNotifs = notifs.filter(n => n.channel === 'email');

  return (
    <div>
      {saved && <div style={{ marginBottom: 16 }}><Alert type="success">Notification settings saved</Alert></div>}

      <SectionHeader title="Slack" desc="Receive alerts in your Slack workspace." />
      <Input
        label="Webhook URL"
        value={slackUrl}
        onChange={e => isManager && setSlackUrl(e.target.value)}
        placeholder="https://hooks.slack.com/services/…"
        hint="Create an incoming webhook in your Slack app settings"
        disabled={!isManager}
      />
      <NotifToggleList notifs={slackNotifs} allNotifs={notifs} onChange={setNotifs} readOnly={!isManager} />

      <div style={{ height: 24 }} />
      <SectionHeader title="Email" desc="Receive digest reports by email." />
      <Input
        label="Send digests to"
        value={smtpEmail}
        onChange={e => isManager && setSmtpEmail(e.target.value)}
        placeholder="qa-team@example.com"
        disabled={!isManager}
      />
      <NotifToggleList notifs={emailNotifs} allNotifs={notifs} onChange={setNotifs} readOnly={!isManager} />

      {isManager && <Button variant="primary" onClick={save} style={{ marginTop: 8 }}>Save settings</Button>}
    </div>
  );
}

function NotifToggleList({ notifs, allNotifs, onChange, readOnly = false }: {
  notifs: NotifSetting[];
  allNotifs: NotifSetting[];
  onChange: (n: NotifSetting[]) => void;
  readOnly?: boolean;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      {notifs.map(n => {
        const idx = allNotifs.findIndex(a => a.event === n.event);
        return (
          <div key={n.event} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 0', borderBottom: '1px solid var(--border-color)',
          }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--gray-800)' }}>{n.label}</span>
            <Toggle
              checked={n.enabled}
              disabled={readOnly}
              onChange={() => !readOnly && onChange(allNotifs.map((a, i) => i === idx ? { ...a, enabled: !a.enabled } : a))}
            />
          </div>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? (disabled ? 'var(--gray-300)' : 'var(--color-primary)') : 'var(--gray-300)',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
      }}
      role="switch"
      aria-checked={checked}
    >
      <div style={{
        position: 'absolute', top: 3, width: 16, height: 16, borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s',
        left: checked ? 21 : 3,
      }} />
    </button>
  );
}

// ── Integrations tab ──────────────────────────────────────────
function IntegrationsTab({ projectId }: { projectId: string }) {
  const { isManager } = useProjectRole(projectId);
  const [githubToken, setGithubToken]   = useState('');
  const [githubRepo, setGithubRepo]     = useState('');
  const [jiraUrl, setJiraUrl]           = useState('');
  const [jiraToken, setJiraToken]       = useState('');
  const [linearToken, setLinearToken]   = useState('');
  const [saved, setSaved]               = useState('');

  function saveIntegration(name: string) {
    setSaved(name);
    setTimeout(() => setSaved(''), 2500);
  }

  const integrations = [
    {
      id: 'github',
      name: 'GitHub Issues',
      icon: '🐙',
      desc: 'Automatically create GitHub Issues from test failures.',
      fields: (
        <>
          <Input label="Personal access token" type="password" value={githubToken}
            onChange={e => setGithubToken(e.target.value)} placeholder="ghp_…"
            hint="Needs issues:write permission" />
          <Input label="Repository" value={githubRepo}
            onChange={e => setGithubRepo(e.target.value)} placeholder="owner/repo-name" />
        </>
      ),
      onSave: () => saveIntegration('GitHub Issues'),
    },
    {
      id: 'jira',
      name: 'Jira',
      icon: '📋',
      desc: 'Create and sync Jira tickets from test failures.',
      fields: (
        <>
          <Input label="Jira base URL" value={jiraUrl}
            onChange={e => setJiraUrl(e.target.value)} placeholder="https://yourorg.atlassian.net" />
          <Input label="API token" type="password" value={jiraToken}
            onChange={e => setJiraToken(e.target.value)} placeholder="Jira API token" />
        </>
      ),
      onSave: () => saveIntegration('Jira'),
    },
    {
      id: 'linear',
      name: 'Linear',
      icon: '◆',
      desc: 'Link failures to Linear issues.',
      fields: (
        <Input label="Linear API key" type="password" value={linearToken}
          onChange={e => setLinearToken(e.target.value)} placeholder="lin_api_…" />
      ),
      onSave: () => saveIntegration('Linear'),
    },
  ];

  return (
    <div>
      {saved && <div style={{ marginBottom: 16 }}><Alert type="success">{saved} settings saved</Alert></div>}
      {integrations.map((intg, i) => (
        <div key={intg.id} style={{
          padding: '18px 0',
          borderBottom: i < integrations.length - 1 ? '1px solid var(--border-color)' : 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: '1.25rem' }}>{intg.icon}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{intg.name}</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>{intg.desc}</div>
            </div>
          </div>
          {intg.fields}
          {isManager && <Button variant="secondary" size="sm" onClick={intg.onSave}>Save {intg.name}</Button>}
        </div>
      ))}
    </div>
  );
}

// ── Danger zone tab ───────────────────────────────────────────
function DangerTab({ projectId }: { projectId: string }) {
  const { isAdmin } = useProjectRole(projectId);
  const [confirm1, setConfirm1] = useState('');
  const [error, setError]       = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!isAdmin) {
    return (
      <div style={{
        padding: '20px 24px', border: '1px solid var(--border-color)',
        borderRadius: 'var(--border-radius-lg)', textAlign: 'center',
        color: 'var(--gray-500)', fontSize: '0.9rem',
      }}>
        <div style={{ fontSize: '1.5rem', marginBottom: 10 }}>🔒</div>
        Only project admins can access the danger zone.
      </div>
    );
  }

  async function handleDelete() {
    setError('');
    setDeleting(true);
    try {
      await api.delete(`projects/${projectId}`);
      window.location.href = '/';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {error && <div style={{ marginBottom: 16 }}><Alert type="error">{error}</Alert></div>}
      <div style={{
        padding: '16px 18px', border: '1px solid #fecaca',
        borderRadius: 'var(--border-radius-lg)', marginBottom: 16,
      }}>
        <div style={{ fontWeight: 600, color: 'var(--color-danger)', marginBottom: 4 }}>Delete project</div>
        <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: 14 }}>
          Permanently deletes all test cases, runs, results, and settings. This cannot be undone.
        </div>
        <Input
          label={`Type the project ID to confirm: ${projectId}`}
          value={confirm1}
          onChange={e => setConfirm1(e.target.value)}
          placeholder={projectId}
        />
        <Button
          variant="danger"
          disabled={confirm1 !== projectId || deleting}
          loading={deleting}
          onClick={handleDelete}
        >
          Delete this project
        </Button>
      </div>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────
function SectionHeader({
  title, desc, action,
}: {
  title: string; desc: string; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
      <div>
        <h3 style={{ margin: 0, marginBottom: 4 }}>{title}</h3>
        <p style={{ margin: 0, fontSize: '0.875rem' }}>{desc}</p>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
