import type { FlakyTest } from '@qaforge/types';

interface FlakinessLeaderboardProps {
  flaky: FlakyTest[];
  isLoading?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  manual: 'Manual', functional: 'Functional', ui_auto: 'UI Auto',
  api: 'API', perf: 'Perf', exploratory: 'Exploratory',
};

function scoreColor(score: number): string {
  if (score >= 0.7) return 'var(--color-danger)';
  if (score >= 0.4) return 'var(--color-warning)';
  return 'var(--color-success)';
}

function scoreBg(score: number): string {
  if (score >= 0.7) return 'var(--color-danger-light)';
  if (score >= 0.4) return 'var(--color-warning-light)';
  return 'var(--color-success-light)';
}

export function FlakinessLeaderboard({ flaky, isLoading }: FlakinessLeaderboardProps) {
  if (isLoading) {
    return (
      <div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{
            height: 48, background: 'var(--gray-100)', borderRadius: 6,
            marginBottom: 6, animation: 'pulse 1.5s infinite',
            animationDelay: `${i * 100}ms`,
          }} />
        ))}
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
      </div>
    );
  }

  if (flaky.length === 0) {
    return (
      <div style={{
        padding: '24px 0', textAlign: 'center',
        color: 'var(--gray-400)', fontSize: '0.875rem',
      }}>
        🎉 No flaky tests detected
      </div>
    );
  }

  return (
    <div>
      {flaky.map((f, idx) => (
        <div key={f.testCaseId} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 0',
          borderBottom: idx < flaky.length - 1 ? '1px solid var(--border-color)' : 'none',
        }}>
          {/* Rank */}
          <div style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
            background: idx < 3 ? scoreBg(f.flakinessScore) : 'var(--gray-100)',
            color: idx < 3 ? scoreColor(f.flakinessScore) : 'var(--gray-400)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', fontWeight: 700,
          }}>
            {idx + 1}
          </div>

          {/* Name + meta */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-900)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {f.title}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: 2, display: 'flex', gap: 8 }}>
              <span>{TYPE_LABELS[f.type] ?? f.type}</span>
              <span>{f.runsAnalysed} runs analysed</span>
            </div>
          </div>

          {/* Score bar + value */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div style={{ width: 60, height: 5, background: 'var(--gray-200)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3,
                width: `${Math.round(f.flakinessScore * 100)}%`,
                background: scoreColor(f.flakinessScore),
                transition: 'width 0.4s',
              }} />
            </div>
            <span style={{
              fontSize: '0.8125rem', fontWeight: 700, minWidth: 36, textAlign: 'right',
              color: scoreColor(f.flakinessScore),
            }}>
              {f.flakinessScore.toFixed(2)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
