import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppLayout } from '../components/shared/AppLayout';
import { StatCard, Spinner } from '../components/shared/ui';
import { CoverageHeatmap } from '../components/insights/CoverageHeatmap';
import { FlakinessLeaderboard } from '../components/insights/FlakinessLeaderboard';
import { TrendChart } from '../components/insights/TrendChart';
import { ReleaseReadiness } from '../components/insights/ReleaseReadiness';
import { useCoverage, useFlakiness, useTrends } from '../hooks/useQueries';

type Tab = 'overview' | 'release';

export function InsightsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');

  const { data: coverageData, isLoading: loadingCoverage } = useCoverage(projectId ?? '');
  const { data: flakinessData, isLoading: loadingFlakiness } = useFlakiness(projectId ?? '');
  const { data: trendData, isLoading: loadingTrend } = useTrends(projectId ?? '', granularity);

  if (!projectId) return null;

  const cases     = coverageData?.cases   ?? [];
  const flaky     = flakinessData?.flaky  ?? [];
  const series    = trendData?.series     ?? [];

  const healthy   = cases.filter(c => c.state === 'healthy').length;
  const stale     = cases.filter(c => c.state === 'stale').length;
  const failing   = cases.filter(c => c.state === 'failing').length;
  const total     = cases.length;
  const executed  = cases.filter(c => c.lastRun != null).length;
  const coverPct  = total > 0 ? Math.round((executed / total) * 100) : 0;

  const latestRate = series.length > 0 ? series[series.length - 1].passRate : null;
  const prevRate   = series.length > 1 ? series[series.length - 2].passRate  : null;
  const rateDelta  = latestRate !== null && prevRate !== null
    ? Math.round(latestRate - prevRate)
    : null;

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'release',  label: 'Release readiness' },
  ];

  return (
    <AppLayout title="Insights">
      {/* Tab bar */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--border-color)',
        marginBottom: 24, gap: 0,
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.9375rem', fontFamily: 'inherit',
              color: tab === t.id ? 'var(--color-primary)' : 'var(--gray-500)',
              borderBottom: `2px solid ${tab === t.id ? 'var(--color-primary)' : 'transparent'}`,
              marginBottom: -1, fontWeight: tab === t.id ? 600 : 400, transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>

          {/* Summary stats */}
          <div className="grid-4" style={{ marginBottom: 24 }}>
            <StatCard
              label="Pass rate"
              value={latestRate !== null ? `${latestRate}%` : '—'}
              sub={rateDelta !== null
                ? `${rateDelta >= 0 ? '↑' : '↓'} ${Math.abs(rateDelta)}% vs prev period`
                : 'No trend data yet'}
              color={latestRate !== null
                ? latestRate >= 90 ? 'var(--color-success)' : latestRate >= 70 ? 'var(--color-warning)' : 'var(--color-danger)'
                : undefined}
            />
            <StatCard
              label="Exec. coverage"
              value={total > 0 ? `${coverPct}%` : '—'}
              sub={`${executed} of ${total} cases run · ${failing} failing · ${stale} stale`}
              color={coverPct >= 80 ? 'var(--color-success)' : coverPct >= 60 ? 'var(--color-warning)' : 'var(--color-danger)'}
            />
            <StatCard
              label="Flaky tests"
              value={flaky.length}
              sub={flaky.length > 0 ? `Worst: ${flaky[0]?.flakinessScore.toFixed(2)}` : 'All stable'}
              color={flaky.length > 0 ? 'var(--color-warning)' : 'var(--color-success)'}
            />
            <StatCard
              label="Total cases"
              value={total}
              sub={`${total - stale} cases with recent results`}
            />
          </div>

          {/* Main grid — heatmap + flakiness */}
          <div className="grid-2" style={{ marginBottom: 24 }}>

            {/* Coverage heatmap */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Coverage heatmap</span>
                {loadingCoverage && <Spinner size="sm" />}
              </div>
              <div className="card-body">
                <CoverageHeatmap cases={cases} isLoading={loadingCoverage} />
              </div>
            </div>

            {/* Flakiness leaderboard */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Flaky tests</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>score 0–1</span>
              </div>
              <div className="card-body">
                <FlakinessLeaderboard flaky={flaky.slice(0, 8)} isLoading={loadingFlakiness} />
              </div>
            </div>
          </div>

          {/* Trend chart */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Pass rate trend</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['day', 'week'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    style={{
                      padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontSize: '0.8125rem',
                      border: `1px solid ${granularity === g ? 'var(--color-primary)' : 'var(--border-color)'}`,
                      background: granularity === g ? 'var(--color-primary-light)' : 'transparent',
                      color: granularity === g ? 'var(--color-primary)' : 'var(--gray-500)',
                      fontWeight: granularity === g ? 500 : 400,
                    }}
                  >
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
                {loadingTrend && <Spinner size="sm" />}
              </div>
            </div>
            <div className="card-body">
              <TrendChart series={series} isLoading={loadingTrend} threshold={90} />
            </div>
          </div>

          {/* Coverage breakdown table */}
          {cases.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-header">
                <span className="card-title">Coverage breakdown</span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--gray-400)' }}>
                  {failing > 0 && <span style={{ color: 'var(--color-danger)', marginRight: 12 }}>✕ {failing} failing</span>}
                  {stale  > 0 && <span style={{ color: 'var(--color-warning)', marginRight: 12 }}>⏰ {stale} stale</span>}
                  {healthy > 0 && <span style={{ color: 'var(--color-success)' }}>✓ {healthy} healthy</span>}
                </span>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Test case</th>
                      <th style={{ width: 100 }}>Type</th>
                      <th style={{ width: 90 }}>Pass rate</th>
                      <th style={{ width: 110 }}>Last run</th>
                      <th style={{ width: 90 }}>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...cases.filter(c => c.state === 'failing'),
                      ...cases.filter(c => c.state === 'stale'),
                      ...cases.filter(c => c.state === 'healthy'),
                    ].map(c => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 500 }}>{c.title}</td>
                        <td>
                          <span style={{
                            fontSize: '0.75rem', padding: '2px 7px', borderRadius: 4,
                            background: 'var(--gray-100)', color: 'var(--gray-500)', fontFamily: 'monospace',
                          }}>{c.type}</span>
                        </td>
                        <td style={{
                          fontWeight: 600,
                          color: c.passRate == null ? 'var(--gray-400)'
                            : c.passRate >= 0.8 ? 'var(--color-success)'
                            : c.passRate >= 0.6 ? 'var(--color-warning)'
                            : 'var(--color-danger)',
                        }}>
                          {c.passRate != null ? `${Math.round(c.passRate * 100)}%` : '—'}
                        </td>
                        <td style={{ color: 'var(--gray-400)', fontSize: '0.875rem' }}>
                          {c.lastRun
                            ? new Date(c.lastRun).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                            : 'Never'}
                        </td>
                        <td>
                          <span style={{
                            fontSize: '0.75rem', fontWeight: 600, padding: '2px 9px', borderRadius: 20,
                            background: c.state === 'healthy' ? 'var(--color-success-light)'
                              : c.state === 'stale' ? 'var(--color-warning-light)'
                              : 'var(--color-danger-light)',
                            color: c.state === 'healthy' ? 'var(--color-success)'
                              : c.state === 'stale' ? 'var(--color-warning)'
                              : 'var(--color-danger)',
                          }}>
                            {c.state.charAt(0).toUpperCase() + c.state.slice(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'release' && (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <ReleaseReadiness projectId={projectId} />
        </div>
      )}
    </AppLayout>
  );
}
