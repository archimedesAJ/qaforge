import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '../components/shared/AppLayout';
import { Button, Spinner, EmptyState, StatCard } from '../components/shared/ui';
import { api } from '../lib/api';
import {
  buildAdminExecutiveSummary,
  exportAdminReportPdf,
  type AdminReportData,
} from '../lib/export';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewStats {
  totalProjects: number;
  totalUsers: number;
  activatedUsers: number;
  totalCases: number;
  openRuns: number;
  openDefects: number;
  activeSprints: number;
  sprintsAtRisk: number;
}

interface ActivePlan {
  id: string;
  name: string;
  milestone: string | null;
  endsAt: string | null;
  passRate: number | null;
  failCount: number;
  blockedCount: number;
}

interface RecentlyCompletedPlan {
  id: string;
  name: string;
  milestone: string | null;
  projectId: string;
  projectName: string;
  closedAt: string;
  passRate: number | null;
  failCount: number;
  total: number;
}

interface LatestRun {
  id: string;
  name: string;
  env: string;
  status: string;
  startedAt: string;
}

interface ProjectHealth {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  counts: { cases: number; runs: number; members: number };
  openDefects: number;
  latestRun: LatestRun | null;
  passRate: number | null;
  coveragePct: number | null;
  coverageStats: { healthy: number; stale: number; failing: number };
  flakyCount: number;
  activePlan: ActivePlan | null;
  automatedCases: number;
  manualCases: number;
}

interface RecentRun {
  id: string;
  name: string;
  env: string;
  status: string;
  startedAt: string;
  project: { id: string; name: string };
}

interface OverviewData {
  stats: OverviewStats;
  projects: ProjectHealth[];
  recentRuns: RecentRun[];
  recentlyCompleted: RecentlyCompletedPlan[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function projectStaleness(latestRun: LatestRun | null): 'none' | 'stale' | 'ok' {
  if (!latestRun) return 'none';
  const days = (Date.now() - new Date(latestRun.startedAt).getTime()) / 86_400_000;
  return days > 30 ? 'stale' : 'ok';
}

const RUN_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  open:   { label: 'Open',   color: '#D97706', bg: '#FEF3C7' },
  closed: { label: 'Closed', color: '#16A34A', bg: '#DCFCE7' },
};

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

type DatePreset = '7d' | '30d' | '90d' | 'month' | 'quarter' | 'all' | 'custom';

const DATE_PRESETS: Array<{ key: DatePreset; label: string }> = [
  { key: '7d',      label: 'Last 7 days'  },
  { key: '30d',     label: 'Last 30 days' },
  { key: '90d',     label: 'Last 90 days' },
  { key: 'month',   label: 'This month'   },
  { key: 'quarter', label: 'This quarter' },
  { key: 'all',     label: 'All time'     },
  { key: 'custom',  label: 'Custom'       },
];

function getDateRange(
  preset: DatePreset,
  customFrom?: string,
  customUntil?: string,
): { since: string | null; until: string | null } {
  if (preset === 'all') return { since: null, until: null };
  if (preset === 'custom') {
    if (customFrom && customUntil) {
      return {
        since: new Date(customFrom).toISOString(),
        until: new Date(customUntil + 'T23:59:59').toISOString(),
      };
    }
    return { since: null, until: null };
  }
  const now   = new Date();
  const until = now.toISOString();
  if (preset === '7d')   return { since: new Date(now.getTime() - 7  * 86_400_000).toISOString(), until };
  if (preset === '30d')  return { since: new Date(now.getTime() - 30 * 86_400_000).toISOString(), until };
  if (preset === '90d')  return { since: new Date(now.getTime() - 90 * 86_400_000).toISOString(), until };
  if (preset === 'month') {
    return { since: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), until };
  }
  // quarter
  const q = Math.floor(now.getMonth() / 3);
  return { since: new Date(now.getFullYear(), q * 3, 1).toISOString(), until };
}

function kpiColor(value: number | null, thresholds: [number, number]): string {
  if (value === null) return 'var(--gray-400)';
  if (value >= thresholds[0]) return 'var(--color-success)';
  if (value >= thresholds[1]) return '#d97706';
  return '#dc2626';
}

function fmtRelative(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function getPeriodLabel(preset: DatePreset, customFrom: string, customUntil: string): string {
  if (preset === 'custom' && customFrom && customUntil) {
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${new Date(customFrom).toLocaleDateString('en-GB', opts)} – ${new Date(customUntil).toLocaleDateString('en-GB', opts)}`;
  }
  return DATE_PRESETS.find(p => p.key === preset)?.label ?? preset;
}

// ── Page ──────────────────────────────────────────────────────────────────────

type ViewMode = 'overview' | 'stakeholder';

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const [viewMode, setViewMode]                   = useState<ViewMode>('overview');
  const [datePreset, setDatePreset] = useState<DatePreset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customUntil, setCustomUntil] = useState('');
  const [showReportModal, setShowReportModal]     = useState(false);
  const [reportSummaryText, setReportSummaryText] = useState('');
  const [exporting, setExporting]                 = useState(false);

  const customReady = datePreset !== 'custom' || (!!customFrom && !!customUntil);

  const { data, isLoading } = useQuery({
    queryKey: ['sysadmin-overview', datePreset, customFrom, customUntil],
    enabled: customReady,
    queryFn: () => {
      const { since, until } = getDateRange(datePreset, customFrom, customUntil);
      const params = new URLSearchParams();
      if (since) params.set('since', since);
      if (until) params.set('until', until);
      const qs = params.toString();
      return api.get<OverviewData>(`projects/sysadmin/overview${qs ? `?${qs}` : ''}`);
    },
  });

  const stats             = data?.stats;
  const projects          = data?.projects ?? [];
  const recent            = data?.recentRuns ?? [];
  const recentlyCompleted = data?.recentlyCompleted ?? [];

  function openReportModal() {
    if (!stats || projects.length === 0) return;
    const withPassRate = projects.filter(p => p.passRate    !== null);
    const withCoverage = projects.filter(p => p.coveragePct !== null);
    const reportData: AdminReportData = {
      period:      getPeriodLabel(datePreset, customFrom, customUntil),
      generatedAt: new Date().toISOString(),
      stats: {
        totalProjects:  stats.totalProjects,
        activatedUsers: stats.activatedUsers,
        totalCases:     stats.totalCases,
        openRuns:       stats.openRuns,
        openDefects:    stats.openDefects,
      },
      kpis: {
        avgPassRate:  withPassRate.length > 0 ? Math.round(withPassRate.reduce((s, p) => s + p.passRate!, 0)  / withPassRate.length) : null,
        avgCoverage:  withCoverage.length > 0 ? Math.round(withCoverage.reduce((s, p) => s + p.coveragePct!, 0) / withCoverage.length) : null,
        totalFailing: projects.reduce((s, p) => s + p.coverageStats.failing, 0),
        totalStale:   projects.reduce((s, p) => s + p.coverageStats.stale,   0),
        totalFlaky:   projects.reduce((s, p) => s + p.flakyCount,            0),
      },
      projects: projects.map(p => ({
        name:          p.name,
        cases:         p.counts.cases,
        passRate:      p.passRate,
        coveragePct:   p.coveragePct,
        coverageStats: p.coverageStats,
        flakyCount:    p.flakyCount,
        latestRun:     p.latestRun ? { env: p.latestRun.env, status: p.latestRun.status, startedAt: p.latestRun.startedAt } : null,
        openDefects:   p.openDefects,
      })),
    };
    setReportSummaryText(buildAdminExecutiveSummary(reportData));
    setShowReportModal(true);
  }

  async function handleExportPdf() {
    if (!stats) return;
    setExporting(true);
    const withPassRate = projects.filter(p => p.passRate    !== null);
    const withCoverage = projects.filter(p => p.coveragePct !== null);
    const reportData: AdminReportData = {
      period:      getPeriodLabel(datePreset, customFrom, customUntil),
      generatedAt: new Date().toISOString(),
      stats: {
        totalProjects:  stats.totalProjects,
        activatedUsers: stats.activatedUsers,
        totalCases:     stats.totalCases,
        openRuns:       stats.openRuns,
        openDefects:    stats.openDefects,
      },
      kpis: {
        avgPassRate:  withPassRate.length > 0 ? Math.round(withPassRate.reduce((s, p) => s + p.passRate!, 0)  / withPassRate.length) : null,
        avgCoverage:  withCoverage.length > 0 ? Math.round(withCoverage.reduce((s, p) => s + p.coveragePct!, 0) / withCoverage.length) : null,
        totalFailing: projects.reduce((s, p) => s + p.coverageStats.failing, 0),
        totalStale:   projects.reduce((s, p) => s + p.coverageStats.stale,   0),
        totalFlaky:   projects.reduce((s, p) => s + p.flakyCount,            0),
      },
      projects: projects.map(p => ({
        name:          p.name,
        cases:         p.counts.cases,
        passRate:      p.passRate,
        coveragePct:   p.coveragePct,
        coverageStats: p.coverageStats,
        flakyCount:    p.flakyCount,
        latestRun:     p.latestRun ? { env: p.latestRun.env, status: p.latestRun.status, startedAt: p.latestRun.startedAt } : null,
        openDefects:   p.openDefects,
      })),
    };
    await exportAdminReportPdf(reportData, { executiveSummary: reportSummaryText });
    setExporting(false);
    setShowReportModal(false);
  }

  return (
    <AppLayout title="System overview">
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        {/* Back nav + header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>← All projects</Button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* View toggle */}
            <div style={{
              display: 'flex', gap: 0, border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden',
            }}>
              {(['overview', 'stakeholder'] as ViewMode[]).map(mode => (
                <button key={mode} onClick={() => setViewMode(mode)} style={{
                  padding: '6px 14px', fontSize: '0.8125rem', fontWeight: 500, border: 'none', cursor: 'pointer',
                  background: viewMode === mode ? 'var(--color-primary)' : 'var(--surface-base)',
                  color: viewMode === mode ? '#fff' : 'var(--gray-600)',
                  transition: 'all 0.15s',
                }}>
                  {mode === 'overview' ? 'Overview' : '📊 Thursday Report'}
                </button>
              ))}
            </div>
            {stats && projects.length > 0 && (
              <Button variant="secondary" size="sm" onClick={openReportModal}>
                ↓ Export PDF
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => navigate('/admin/users')}>
              👥 Manage users
            </Button>
          </div>
        </div>

        {/* Date range picker */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', fontWeight: 500, marginRight: 4 }}>
              KPI period:
            </span>
            {DATE_PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => setDatePreset(p.key)}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 500,
                  cursor: 'pointer', border: '1px solid',
                  borderColor: datePreset === p.key ? 'var(--color-primary)' : 'var(--border-color)',
                  background:  datePreset === p.key ? 'var(--color-primary-light)' : 'var(--surface-base)',
                  color:       datePreset === p.key ? 'var(--color-primary)' : 'var(--gray-600)',
                  transition: 'all 0.15s',
                }}
              >
                {p.label}
              </button>
            ))}
            {isLoading && <Spinner size="sm" />}
          </div>

          {datePreset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, marginLeft: 2 }}>
              <label style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', fontWeight: 500 }}>From</label>
              <input
                type="date"
                value={customFrom}
                max={customUntil || undefined}
                onChange={e => setCustomFrom(e.target.value)}
                style={{
                  padding: '5px 10px', borderRadius: 6, fontSize: '0.875rem',
                  border: '1px solid var(--border-color)', background: 'var(--surface-base)',
                  color: 'var(--text-primary)', fontFamily: 'inherit',
                }}
              />
              <label style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', fontWeight: 500 }}>To</label>
              <input
                type="date"
                value={customUntil}
                min={customFrom || undefined}
                onChange={e => setCustomUntil(e.target.value)}
                style={{
                  padding: '5px 10px', borderRadius: 6, fontSize: '0.875rem',
                  border: '1px solid var(--border-color)', background: 'var(--surface-base)',
                  color: 'var(--text-primary)', fontFamily: 'inherit',
                }}
              />
              {!customReady && (
                <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
                  Select both dates to load data
                </span>
              )}
            </div>
          )}
        </div>

        {(isLoading && !data) || !customReady ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
            <Spinner size="lg" />
          </div>
        ) : null}

        {!isLoading && stats && viewMode === 'overview' && (
          <>
            {/* System stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginBottom: 14 }}>
              <StatCard label="Projects"       value={stats.totalProjects} />
              <StatCard label="Active users"   value={stats.activatedUsers}
                sub={`${stats.totalUsers - stats.activatedUsers} pending`}
                color="var(--color-primary)" />
              <StatCard label="Test cases"     value={stats.totalCases} />
              <StatCard label="Open runs"      value={stats.openRuns}
                color={stats.openRuns > 0 ? 'var(--color-warning)' : undefined} />
              <StatCard label="Open defects"   value={stats.openDefects}
                color={stats.openDefects > 0 ? '#DC2626' : undefined} />
              <StatCard label="Pending invites" value={stats.totalUsers - stats.activatedUsers}
                color={stats.totalUsers - stats.activatedUsers > 0 ? 'var(--gray-500)' : undefined} />
            </div>

            {/* Sprint health KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 28 }}>
              <StatCard
                label="Active sprints"
                value={stats.activeSprints}
                color={stats.activeSprints > 0 ? 'var(--color-primary)' : undefined}
                sub={stats.activeSprints > 0 ? `${stats.activeSprints} plan${stats.activeSprints !== 1 ? 's' : ''} in progress across projects` : 'No active sprint plans'}
              />
              <StatCard
                label="Sprints at risk"
                value={stats.sprintsAtRisk}
                color={stats.sprintsAtRisk > 0 ? '#DC2626' : 'var(--color-success)'}
                sub={stats.sprintsAtRisk > 0 ? 'failing tests or pass rate below 70%' : 'all sprints on track'}
              />
            </div>

            {/* Coverage KPI banner */}
            {projects.length > 0 && (() => {
              const withPassRate  = projects.filter(p => p.passRate !== null);
              const withCoverage  = projects.filter(p => p.coveragePct !== null);
              const avgPassRate   = withPassRate.length  > 0 ? Math.round(withPassRate.reduce((s, p) => s + p.passRate!, 0)  / withPassRate.length)  : null;
              const avgCoverage   = withCoverage.length > 0 ? Math.round(withCoverage.reduce((s, p) => s + p.coveragePct!, 0) / withCoverage.length) : null;
              const totalFlaky    = projects.reduce((s, p) => s + p.flakyCount, 0);
              const totalFailing  = projects.reduce((s, p) => s + p.coverageStats.failing, 0);
              const totalStale    = projects.reduce((s, p) => s + p.coverageStats.stale, 0);
              return (
                <div style={{
                  background: 'var(--surface-base)', border: '1px solid var(--border-color)',
                  borderRadius: 10, padding: '16px 20px', marginBottom: 20,
                }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
                    Coverage KPIs — all projects
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                    {[
                      { label: 'Avg pass rate',      value: avgPassRate  !== null ? `${avgPassRate}%`  : '—', color: kpiColor(avgPassRate,  [90, 70]), sub: `across ${withPassRate.length} project${withPassRate.length !== 1 ? 's' : ''} with data` },
                      { label: 'Avg exec. coverage', value: avgCoverage  !== null ? `${avgCoverage}%` : '—', color: kpiColor(avgCoverage, [80, 60]), sub: `across ${withCoverage.length} project${withCoverage.length !== 1 ? 's' : ''} with data` },
                      { label: 'Failing cases',    value: totalFailing, color: totalFailing > 0 ? '#dc2626' : 'var(--color-success)', sub: `${totalStale} stale` },
                      { label: 'Flaky tests',      value: totalFlaky,   color: totalFlaky  > 0 ? '#d97706' : 'var(--color-success)', sub: 'across all projects' },
                      { label: 'Open defects',     value: stats!.openDefects, color: stats!.openDefects > 0 ? '#dc2626' : 'var(--color-success)', sub: 'across all projects' },
                    ].map(item => (
                      <div key={item.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: item.color, lineHeight: 1 }}>{item.value}</div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--gray-600)', marginTop: 4 }}>{item.label}</div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--gray-400)', marginTop: 2 }}>{item.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Projects health table */}
            <div className="card" style={{ padding: 0, marginBottom: 24 }}>
              <div className="card-header" style={{ padding: '14px 20px' }}>
                <span className="card-title">Projects</span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
                  {projects.length} project{projects.length !== 1 ? 's' : ''}
                </span>
              </div>

              {projects.length === 0 && (
                <EmptyState icon="🗂" title="No projects yet" description="Create a project to get started." />
              )}

              {projects.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th style={{ textAlign: 'center' }}>Members</th>
                        <th style={{ textAlign: 'center' }}>Cases</th>
                        <th style={{ textAlign: 'center' }}>Automation</th>
                        <th style={{ textAlign: 'center' }}>Pass rate</th>
                        <th style={{ textAlign: 'center' }}>Exec. coverage</th>
                        <th style={{ textAlign: 'center' }}>Flaky</th>
                        <th>Latest run</th>
                        <th style={{ textAlign: 'center' }}>Open defects</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map(p => {
                        const stale = projectStaleness(p.latestRun);
                        const rs = p.latestRun ? (RUN_STATUS[p.latestRun.status] ?? RUN_STATUS.closed) : null;
                        return (
                          <tr
                            key={p.id}
                            style={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/projects/${p.id}`)}
                          >
                            {/* Project name + activity dot */}
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{
                                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                  background: stale === 'ok' ? '#16A34A' : stale === 'stale' ? '#D97706' : '#D1D5DB',
                                }} title={stale === 'ok' ? 'Active recently' : stale === 'stale' ? 'No run in 30+ days' : 'No runs yet'} />
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: stale === 'none' ? 'var(--gray-400)' : 'var(--gray-900)' }}>{p.name}</span>
                                    {stale === 'none' && (
                                      <span style={{
                                        fontSize: '0.6875rem', fontWeight: 600, padding: '1px 7px', borderRadius: 20,
                                        background: '#F3F4F6', color: '#9CA3AF', border: '1px solid #E5E7EB',
                                        letterSpacing: '0.02em',
                                      }}>
                                        Inactive
                                      </span>
                                    )}
                                    {stale === 'stale' && (
                                      <span style={{
                                        fontSize: '0.6875rem', fontWeight: 600, padding: '1px 7px', borderRadius: 20,
                                        background: '#FEF3C7', color: '#D97706', border: '1px solid #FDE68A',
                                        letterSpacing: '0.02em',
                                      }}>
                                        Stale
                                      </span>
                                    )}
                                    {p.activePlan && (() => {
                                      const ap = p.activePlan!;
                                      const atRisk   = ap.failCount > 0 || (ap.passRate !== null && ap.passRate < 70);
                                      const endsAt   = ap.endsAt ? new Date(ap.endsAt) : null;
                                      const daysLeft = endsAt ? Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000) : null;
                                      const isOverdue = daysLeft !== null && daysLeft < 0;
                                      const countdownLabel = daysLeft === null ? '' : isOverdue ? ` · ${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? ' · ends today' : ` · ${daysLeft}d left`;
                                      const badgeStyle = isOverdue
                                        ? { bg: '#FEF3C7', color: '#D97706', border: '#FDE68A' }
                                        : atRisk
                                          ? { bg: '#FEE2E2', color: '#DC2626', border: '#FECACA' }
                                          : { bg: '#DCFCE7', color: '#16A34A', border: '#BBF7D0' };
                                      const tooltip = `${ap.name}${ap.milestone ? ` · ${ap.milestone}` : ''} — ${ap.passRate !== null ? `${ap.passRate}% pass` : 'no results yet'}${ap.failCount > 0 ? `, ${ap.failCount} failing` : ''}${ap.blockedCount > 0 ? `, ${ap.blockedCount} blocked` : ''}${endsAt ? ` · ends ${endsAt.toLocaleDateString('en-GB')}` : ''}`;
                                      return (
                                        <span title={tooltip} style={{
                                          fontSize: '0.6875rem', fontWeight: 600, padding: '1px 7px', borderRadius: 20,
                                          background: badgeStyle.bg, color: badgeStyle.color,
                                          border: `1px solid ${badgeStyle.border}`,
                                          letterSpacing: '0.02em', cursor: 'default',
                                        }}>
                                          {isOverdue ? '⚠ ' : atRisk ? '⊘ ' : '✓ '}{ap.milestone ?? ap.name}{countdownLabel}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', fontFamily: 'monospace' }}>{p.slug}</div>
                                </div>
                              </div>
                            </td>

                            {/* Members */}
                            <td style={{ textAlign: 'center', color: 'var(--gray-600)', fontWeight: 500 }}>
                              {p.counts.members}
                            </td>

                            {/* Cases */}
                            <td style={{ textAlign: 'center', color: 'var(--gray-600)' }}>
                              {p.counts.cases}
                            </td>

                            {/* Automation % */}
                            <td style={{ textAlign: 'center' }}>
                              {p.counts.cases > 0 ? (() => {
                                const pct = Math.round((p.automatedCases / p.counts.cases) * 100);
                                const color = pct >= 70 ? '#16A34A' : pct >= 40 ? '#D97706' : '#6B7280';
                                return (
                                  <div>
                                    <span style={{ fontWeight: 700, fontSize: '0.875rem', color }}>{pct}%</span>
                                    <div style={{ fontSize: '0.6875rem', color: 'var(--gray-400)', marginTop: 1 }}>
                                      {p.automatedCases} / {p.counts.cases}
                                    </div>
                                  </div>
                                );
                              })() : (
                                <span style={{ color: 'var(--gray-300)', fontSize: '0.875rem' }}>—</span>
                              )}
                            </td>

                            {/* Pass rate */}
                            <td style={{ textAlign: 'center' }}>
                              {p.passRate !== null ? (
                                <span style={{ fontWeight: 700, color: kpiColor(p.passRate, [90, 70]) }}>
                                  {p.passRate}%
                                </span>
                              ) : (
                                <span style={{ color: 'var(--gray-300)', fontSize: '0.875rem' }}>—</span>
                              )}
                            </td>

                            {/* Coverage */}
                            <td style={{ textAlign: 'center' }}>
                              {p.coveragePct !== null ? (
                                <div>
                                  <span style={{ fontWeight: 700, color: kpiColor(p.coveragePct, [80, 60]) }}>
                                    {p.coveragePct}%
                                  </span>
                                  {p.coverageStats.failing > 0 && (
                                    <div style={{ fontSize: '0.6875rem', color: '#dc2626' }}>
                                      {p.coverageStats.failing} failing
                                    </div>
                                  )}
                                  {p.coverageStats.failing === 0 && p.coverageStats.stale > 0 && (
                                    <div style={{ fontSize: '0.6875rem', color: '#d97706' }}>
                                      {p.coverageStats.stale} stale
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--gray-300)', fontSize: '0.875rem' }}>—</span>
                              )}
                            </td>

                            {/* Flaky */}
                            <td style={{ textAlign: 'center' }}>
                              {p.flakyCount > 0 ? (
                                <span style={{
                                  padding: '2px 8px', borderRadius: 20,
                                  fontSize: '0.8125rem', fontWeight: 700,
                                  color: '#d97706', background: '#fef3c7',
                                }}>
                                  {p.flakyCount}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--gray-300)', fontSize: '0.875rem' }}>—</span>
                              )}
                            </td>

                            {/* Latest run */}
                            <td>
                              {p.latestRun && rs ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{
                                    padding: '1px 8px', borderRadius: 20,
                                    fontSize: '0.75rem', fontWeight: 600,
                                    color: rs.color, background: rs.bg,
                                  }}>
                                    {rs.label}
                                  </span>
                                  <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
                                    {fmtRelative(p.latestRun.startedAt)}
                                  </span>
                                  <span style={{
                                    fontFamily: 'monospace', fontSize: '0.75rem',
                                    background: 'var(--gray-100)', color: 'var(--gray-500)',
                                    padding: '1px 5px', borderRadius: 4,
                                  }}>
                                    {p.latestRun.env}
                                  </span>
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.8125rem', color: 'var(--gray-300)', fontStyle: 'italic' }}>No runs yet</span>
                              )}
                            </td>

                            {/* Open defects */}
                            <td style={{ textAlign: 'center' }}>
                              {p.openDefects > 0 ? (
                                <span style={{
                                  padding: '2px 10px', borderRadius: 20,
                                  fontSize: '0.8125rem', fontWeight: 700,
                                  color: '#DC2626', background: '#FEE2E2',
                                }}>
                                  {p.openDefects}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--gray-300)', fontSize: '0.875rem' }}>—</span>
                              )}
                            </td>

                            {/* Arrow */}
                            <td style={{ color: 'var(--gray-300)', textAlign: 'right', paddingRight: 16 }}>→</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recently completed sprints */}
            {recentlyCompleted.length > 0 && (
              <div className="card" style={{ padding: 0 }}>
                <div className="card-header" style={{ padding: '14px 20px' }}>
                  <span className="card-title">Recently completed sprints</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginLeft: 8 }}>last 14 days</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Sprint</th>
                        <th>Milestone</th>
                        <th style={{ textAlign: 'center' }}>Pass rate</th>
                        <th style={{ textAlign: 'center' }}>Failures</th>
                        <th style={{ textAlign: 'center' }}>Total</th>
                        <th>Closed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentlyCompleted.map(plan => {
                        const pct = plan.passRate;
                        const pctColor = pct === null ? 'var(--gray-400)' : pct >= 90 ? '#16A34A' : pct >= 70 ? '#D97706' : '#DC2626';
                        const pctBg   = pct === null ? 'var(--gray-100)'  : pct >= 90 ? '#DCFCE7'  : pct >= 70 ? '#FEF3C7'  : '#FEE2E2';
                        return (
                          <tr key={plan.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${plan.projectId}/plans`)}>
                            <td style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-primary)' }}>{plan.projectName}</td>
                            <td style={{ fontWeight: 500, color: 'var(--gray-800)' }}>{plan.name}</td>
                            <td style={{ color: 'var(--gray-500)', fontSize: '0.8125rem' }}>{plan.milestone ?? '—'}</td>
                            <td style={{ textAlign: 'center' }}>
                              {pct !== null ? (
                                <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.8125rem', fontWeight: 600, color: pctColor, background: pctBg }}>
                                  {pct}%
                                </span>
                              ) : <span style={{ color: 'var(--gray-400)' }}>—</span>}
                            </td>
                            <td style={{ textAlign: 'center', color: plan.failCount > 0 ? '#DC2626' : 'var(--gray-400)', fontWeight: plan.failCount > 0 ? 700 : 400 }}>
                              {plan.failCount > 0 ? plan.failCount : '—'}
                            </td>
                            <td style={{ textAlign: 'center', color: 'var(--gray-600)' }}>{plan.total}</td>
                            <td style={{ color: 'var(--gray-400)', fontSize: '0.8125rem' }}>{fmtRelative(plan.closedAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recent activity */}
            <div className="card" style={{ padding: 0 }}>
              <div className="card-header" style={{ padding: '14px 20px' }}>
                <span className="card-title">Recent runs across all projects</span>
              </div>

              {recent.length === 0 && (
                <EmptyState icon="▶" title="No runs yet" description="Test runs will appear here once teams start executing." />
              )}

              {recent.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Run</th>
                        <th>Env</th>
                        <th>Status</th>
                        <th>Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map(run => {
                        const rs = RUN_STATUS[run.status] ?? RUN_STATUS.closed;
                        return (
                          <tr
                            key={run.id}
                            style={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/projects/${run.project.id}/runs`)}
                          >
                            <td>
                              <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-primary)' }}>
                                {run.project.name}
                              </span>
                            </td>
                            <td style={{ fontWeight: 500, color: 'var(--gray-800)' }}>{run.name}</td>
                            <td>
                              <span style={{
                                fontFamily: 'monospace', fontSize: '0.8125rem',
                                background: 'var(--gray-100)', color: 'var(--gray-500)',
                                padding: '1px 6px', borderRadius: 4,
                              }}>
                                {run.env}
                              </span>
                            </td>
                            <td>
                              <span style={{
                                padding: '2px 10px', borderRadius: 20,
                                fontSize: '0.8125rem', fontWeight: 600,
                                color: rs.color, background: rs.bg,
                              }}>
                                {rs.label}
                              </span>
                            </td>
                            <td style={{ color: 'var(--gray-400)', fontSize: '0.8125rem' }}>
                              {fmt(run.startedAt)} · {fmtRelative(run.startedAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Thursday / Stakeholder Report view ── */}
        {!isLoading && stats && viewMode === 'stakeholder' && (
          <StakeholderView
            stats={stats}
            projects={projects}
            recentlyCompleted={recentlyCompleted}
            period={getPeriodLabel(datePreset, customFrom, customUntil)}
            onExport={openReportModal}
            navigate={navigate}
          />
        )}
      </div>

      {/* ── Report summary modal ── */}
      {showReportModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}
          onClick={e => { if (e.target === e.currentTarget) setShowReportModal(false); }}
        >
          <div style={{
            background: 'var(--surface-base)', borderRadius: 12, padding: 28,
            width: 600, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--gray-900)' }}>
                  Export overview report
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
                  {getPeriodLabel(datePreset, customFrom, customUntil)}
                </div>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--gray-400)', lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--gray-700)', display: 'block', marginBottom: 6 }}>
                Executive summary
              </label>
              <textarea
                value={reportSummaryText}
                onChange={e => setReportSummaryText(e.target.value)}
                rows={8}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                  border: '1px solid var(--border-color)', borderRadius: 8,
                  fontSize: '0.875rem', fontFamily: 'inherit', lineHeight: 1.6,
                  color: 'var(--gray-800)', background: 'var(--surface-base)',
                  resize: 'vertical',
                }}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: 4 }}>
                Auto-generated — edit before exporting.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <Button variant="secondary" size="sm" onClick={() => setShowReportModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleExportPdf} disabled={exporting}>
                {exporting ? 'Generating…' : '↓ Export PDF'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

// ── Thursday / Stakeholder Report view ───────────────────────────────────────

function SlideHeader({ number, title, subtitle }: { number: number; title: string; subtitle: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: 'var(--color-primary)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: '1rem',
      }}>
        {number}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--gray-900)' }}>{title}</div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 1 }}>{subtitle}</div>
      </div>
    </div>
  );
}

function StakeholderView({
  stats, projects, recentlyCompleted, period, onExport, navigate,
}: {
  stats: OverviewStats;
  projects: ProjectHealth[];
  recentlyCompleted: RecentlyCompletedPlan[];
  period: string;
  onExport: () => void;
  navigate: (path: string) => void;
}) {
  const totalAutomated   = projects.reduce((s, p) => s + p.automatedCases, 0);
  const totalCases       = projects.reduce((s, p) => s + p.counts.cases,   0);
  const overallAutoPct   = totalCases > 0 ? Math.round((totalAutomated / totalCases) * 100) : 0;

  const withPassRate     = projects.filter(p => p.passRate !== null);
  const avgPassRate      = withPassRate.length > 0
    ? Math.round(withPassRate.reduce((s, p) => s + p.passRate!, 0) / withPassRate.length)
    : null;

  const byPassRate       = [...projects].sort((a, b) => (b.passRate ?? -1) - (a.passRate ?? -1));
  const byAutomation     = [...projects].sort((a, b) => {
    const pctA = a.counts.cases > 0 ? a.automatedCases / a.counts.cases : -1;
    const pctB = b.counts.cases > 0 ? b.automatedCases / b.counts.cases : -1;
    return pctB - pctA;
  });

  const activeSprintProjects = projects.filter(p => p.activePlan !== null);

  const slideBox: React.CSSProperties = {
    background: 'var(--surface-base)',
    border: '1px solid var(--border-color)',
    borderRadius: 12,
    padding: '20px 24px',
    marginBottom: 20,
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1.0625rem', color: 'var(--gray-900)' }}>
            Thursday Stakeholder Report
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--gray-400)', marginTop: 2 }}>
            {period} · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onExport}>↓ Export PDF</Button>
      </div>

      {/* ── Slide 1: Quality Health ───────────────────────────────── */}
      <div style={slideBox}>
        <SlideHeader number={1} title="Quality Health" subtitle="Overall test quality across all projects this period" />

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Avg pass rate',  value: avgPassRate !== null ? `${avgPassRate}%` : '—', color: avgPassRate !== null ? kpiColor(avgPassRate, [90, 70]) : 'var(--gray-400)' },
            { label: 'Open defects',   value: stats.openDefects, color: stats.openDefects > 0 ? '#DC2626' : 'var(--color-success)' },
            { label: 'Active sprints', value: stats.activeSprints, color: 'var(--color-primary)' },
            { label: 'Sprints at risk',value: stats.sprintsAtRisk, color: stats.sprintsAtRisk > 0 ? '#DC2626' : 'var(--color-success)' },
          ].map(k => (
            <div key={k.label} style={{
              background: 'var(--gray-50)', borderRadius: 8, padding: '14px 16px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: 5, fontWeight: 500 }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Top projects by pass rate */}
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          Projects by pass rate
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {byPassRate.slice(0, 8).map(p => {
            const pct = p.passRate;
            const color = pct === null ? 'var(--gray-300)' : kpiColor(pct, [90, 70]);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                onClick={() => navigate(`/projects/${p.id}`)}>
                <div style={{ flex: '0 0 200px', fontSize: '0.875rem', color: 'var(--gray-800)', fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <div style={{ flex: 1, height: 8, background: 'var(--gray-100)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4, transition: 'width 0.4s',
                    background: color,
                    width: pct !== null ? `${pct}%` : '0%',
                  }} />
                </div>
                <div style={{ flex: '0 0 44px', textAlign: 'right', fontWeight: 700, fontSize: '0.875rem', color }}>
                  {pct !== null ? `${pct}%` : '—'}
                </div>
                {p.openDefects > 0 && (
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#DC2626',
                    background: '#FEE2E2', padding: '1px 7px', borderRadius: 20 }}>
                    {p.openDefects} defects
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Slide 2: Automation Coverage ─────────────────────────── */}
      <div style={slideBox}>
        <SlideHeader number={2} title="Automation Coverage" subtitle="Automated vs manual test cases per project" />

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total test cases', value: totalCases.toLocaleString(), color: 'var(--color-primary)' },
            { label: 'Automated',        value: totalAutomated.toLocaleString(), color: '#16A34A' },
            { label: 'Automation %',     value: `${overallAutoPct}%`, color: overallAutoPct >= 70 ? '#16A34A' : overallAutoPct >= 40 ? '#D97706' : '#6B7280' },
          ].map(k => (
            <div key={k.label} style={{
              background: 'var(--gray-50)', borderRadius: 8, padding: '14px 16px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: 5, fontWeight: 500 }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Per-project automation bars */}
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          Per project
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {byAutomation.map(p => {
            const pct   = p.counts.cases > 0 ? Math.round((p.automatedCases / p.counts.cases) * 100) : 0;
            const color = pct >= 70 ? '#16A34A' : pct >= 40 ? '#D97706' : '#6B7280';
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                onClick={() => navigate(`/projects/${p.id}`)}>
                <div style={{ flex: '0 0 200px', fontSize: '0.875rem', color: 'var(--gray-800)', fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <div style={{ flex: 1, height: 8, background: 'var(--gray-100)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4, transition: 'width 0.4s',
                    background: color,
                    width: p.counts.cases > 0 ? `${pct}%` : '0%',
                  }} />
                </div>
                <div style={{ flex: '0 0 44px', textAlign: 'right', fontWeight: 700, fontSize: '0.875rem', color }}>
                  {p.counts.cases > 0 ? `${pct}%` : '—'}
                </div>
                <div style={{ flex: '0 0 80px', textAlign: 'right', fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                  {p.automatedCases} / {p.counts.cases}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Slide 3: Sprint & Defect Readiness ───────────────────── */}
      <div style={slideBox}>
        <SlideHeader number={3} title="Sprint & Defect Readiness" subtitle="Active sprints status and open defects per project" />

        {activeSprintProjects.length === 0 ? (
          <div style={{ color: 'var(--gray-400)', fontSize: '0.875rem', fontStyle: 'italic', marginBottom: 16 }}>
            No active sprint plans this period.
          </div>
        ) : (
          <>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              Active sprints
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
              {activeSprintProjects.map(p => {
                const ap       = p.activePlan!;
                const atRisk   = ap.failCount > 0 || (ap.passRate !== null && ap.passRate < 70);
                const endsAt   = ap.endsAt ? new Date(ap.endsAt) : null;
                const daysLeft = endsAt ? Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000) : null;
                const isOverdue = daysLeft !== null && daysLeft < 0;
                const statusColor = isOverdue ? '#D97706' : atRisk ? '#DC2626' : '#16A34A';
                const statusBg    = isOverdue ? '#FEF3C7' : atRisk ? '#FEE2E2' : '#DCFCE7';
                const statusLabel = isOverdue ? 'Overdue' : atRisk ? 'At risk' : 'On track';
                return (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '8px 12px', borderRadius: 8,
                    background: 'var(--gray-50)', cursor: 'pointer',
                  }} onClick={() => navigate(`/projects/${p.id}/plans`)}>
                    <div style={{ flex: '0 0 200px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--gray-900)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </div>
                    <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
                      {ap.milestone ?? ap.name}
                    </div>
                    <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, color: statusColor, background: statusBg }}>
                      {statusLabel}
                    </span>
                    {ap.passRate !== null && (
                      <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: kpiColor(ap.passRate, [90, 70]) }}>
                        {ap.passRate}% pass
                      </span>
                    )}
                    {daysLeft !== null && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                        {isOverdue ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'ends today' : `${daysLeft}d left`}
                      </span>
                    )}
                    {p.openDefects > 0 && (
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#DC2626' }}>
                        {p.openDefects} open defects
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Recently completed */}
        {recentlyCompleted.length > 0 && (
          <>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              Completed this period
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentlyCompleted.map(plan => {
                const pct   = plan.passRate;
                const color = pct === null ? 'var(--gray-400)' : kpiColor(pct, [90, 70]);
                return (
                  <div key={plan.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '8px 12px', borderRadius: 8, background: 'var(--gray-50)',
                    cursor: 'pointer',
                  }} onClick={() => navigate(`/projects/${plan.projectId}/plans`)}>
                    <div style={{ flex: '0 0 200px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--gray-900)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {plan.projectName}
                    </div>
                    <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
                      {plan.milestone ?? plan.name}
                    </div>
                    {pct !== null ? (
                      <span style={{ fontWeight: 700, fontSize: '0.875rem', color }}>{pct}% pass</span>
                    ) : <span style={{ color: 'var(--gray-400)', fontSize: '0.875rem' }}>—</span>}
                    <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                      {plan.failCount > 0 ? `${plan.failCount} failures · ` : ''}{plan.total} total
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
