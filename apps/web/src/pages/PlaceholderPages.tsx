
import { AppLayout } from '../components/shared/AppLayout';
import { Button } from '../components/shared/ui';

// ── Test cases placeholder ────────────────────────────────────
export function CasesPage() {
  
  return (
    <AppLayout title="Test cases" actions={<Button variant="primary" size="sm">+ New case</Button>}>
      <ComingSoon
        icon="✓"
        title="Test case editor"
        description="Suite organiser, type-aware editor, bulk actions — Phase 2 Week 6"
        items={[
          'Suite tree — collapsible folder hierarchy',
          'Test case editor for all 6 types (manual, functional, UI auto, API, perf, exploratory)',
          'Step builder with add/remove/reorder',
          'Bulk actions — move, tag, assign, delete',
        ]}
      />
    </AppLayout>
  );
}

// ── Runs placeholder ─────────────────────────────────────────
export function RunsPage() {
  return (
    <AppLayout title="Runs" actions={<Button variant="primary" size="sm">+ New run</Button>}>
      <ComingSoon
        icon="▶"
        title="Test runners"
        description="Manual step runner, exploratory session, API runner — Phase 2 Week 8–9"
        items={[
          'Manual / functional step-by-step runner',
          'Exploratory session runner with live log',
          'API test runner with assertion builder',
          'UI automation result viewer with stack traces',
          'Performance results view with threshold bars',
        ]}
      />
    </AppLayout>
  );
}

// ── Insights placeholder ─────────────────────────────────────
export function InsightsPage() {
  return (
    <AppLayout title="Insights">
      <ComingSoon
        icon="◈"
        title="Insights dashboard"
        description="Coverage heatmap, flakiness detection, trend analytics — Phase 3 Week 11"
        items={[
          'Coverage heatmap — healthy / stale / failing per case',
          'Flakiness leaderboard with scores',
          'Pass rate trend chart (by env and suite)',
          'Release readiness view with P0/P1 gates',
          'Exportable PDF/CSV reports',
        ]}
      />
    </AppLayout>
  );
}

// ── Settings placeholder ─────────────────────────────────────
export function SettingsPage() {
  return (
    <AppLayout title="Settings">
      <ComingSoon
        icon="⚙"
        title="Project settings"
        description="Integrations, team management, API keys, notifications — Phase 3 Week 15"
        items={[
          'Integrations — Jira, GitHub Issues, Linear, Slack',
          'Team — invite members, manage roles',
          'API keys — create, scope, revoke',
          'Notification triggers — per-event toggles',
          'Environments — name and base URL config',
        ]}
      />
    </AppLayout>
  );
}

// ── Shared coming soon component ──────────────────────────────
function ComingSoon({
  icon, title, description, items,
}: {
  icon: string;
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <div style={{ maxWidth: 580 }}>
      <div className="card">
        <div className="card-body">
          <div style={{
            width: 52, height: 52,
            background: 'var(--color-primary-light)',
            border: '1px solid #bfdbfe',
            borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.5rem',
            marginBottom: 16,
          }}>
            {icon}
          </div>
          <h2 style={{ marginBottom: 8 }}>{title}</h2>
          <p style={{ marginBottom: 20, color: 'var(--gray-500)' }}>{description}</p>
          <div style={{
            background: 'var(--gray-50)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--border-radius-md)',
            padding: '14px 16px',
          }}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--gray-500)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Planned features
            </div>
            {items.map((item, i) => (
              <div key={i} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                padding: '5px 0',
                fontSize: '0.875rem', color: 'var(--gray-600)',
                borderBottom: i < items.length - 1 ? '1px solid var(--border-color)' : 'none',
              }}>
                <span style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: 2 }}>→</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
