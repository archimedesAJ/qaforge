import { useState } from 'react';
import type { CoverageCase, CoverageState } from '@qaforge/types';

const STATE_CONFIG: Record<CoverageState, { color: string; bg: string; border: string; label: string }> = {
  healthy: { color: 'var(--color-success)', bg: '#dcfce7', border: '#86efac', label: 'Healthy' },
  stale:   { color: 'var(--color-warning)', bg: '#fef3c7', border: '#fcd34d', label: 'Stale'   },
  failing: { color: 'var(--color-danger)',  bg: '#fee2e2', border: '#fca5a5', label: 'Failing' },
};

interface CoverageHeatmapProps {
  cases: CoverageCase[];
  isLoading?: boolean;
}

export function CoverageHeatmap({ cases, isLoading }: CoverageHeatmapProps) {
  const [hovered, setHovered] = useState<CoverageCase | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const healthy = cases.filter(c => c.state === 'healthy').length;
  const stale   = cases.filter(c => c.state === 'stale').length;
  const failing = cases.filter(c => c.state === 'failing').length;
  const total   = cases.length;
  const coveragePct = total > 0 ? Math.round((healthy / total) * 100) : 0;

  if (isLoading) {
    return (
      <div style={{ padding: '24px 0' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Array.from({ length: 40 }).map((_, i) => (
            <div key={i} style={{
              width: 20, height: 20, borderRadius: 4,
              background: 'var(--gray-100)',
              animation: 'pulse 1.5s infinite',
              animationDelay: `${i * 30}ms`,
            }} />
          ))}
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div style={{
        padding: '28px 0', textAlign: 'center',
        color: 'var(--gray-400)', fontSize: '0.875rem',
      }}>
        No test cases yet — create some to see coverage
      </div>
    );
  }

  return (
    <div>
      {/* Legend + summary */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          {(Object.entries(STATE_CONFIG) as [CoverageState, typeof STATE_CONFIG[CoverageState]][]).map(([state, cfg]) => {
            const count = state === 'healthy' ? healthy : state === 'stale' ? stale : failing;
            return (
              <div key={state} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8125rem', color: 'var(--gray-600)' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: cfg.bg, border: `1px solid ${cfg.border}` }} />
                <span>{cfg.label}</span>
                <span style={{ color: 'var(--gray-400)' }}>({count})</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
          <span style={{ fontWeight: 600, color: coveragePct >= 80 ? 'var(--color-success)' : coveragePct >= 60 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
            {coveragePct}%
          </span>{' '}healthy
        </div>
      </div>

      {/* Grid */}
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, position: 'relative' }}
        onMouseLeave={() => setHovered(null)}
      >
        {cases.map(c => {
          const cfg = STATE_CONFIG[c.state];
          return (
            <div
              key={c.id}
              style={{
                width: 20, height: 20, borderRadius: 4,
                background: cfg.bg, border: `1px solid ${cfg.border}`,
                cursor: 'pointer', transition: 'transform 0.1s, opacity 0.1s',
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                setHovered(c);
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const parent = (e.currentTarget as HTMLElement).closest('[data-heatmap]')?.getBoundingClientRect();
                setTooltipPos({
                  x: rect.left - (parent?.left ?? 0) + 24,
                  y: rect.top  - (parent?.top  ?? 0) - 8,
                });
                (e.currentTarget as HTMLElement).style.transform = 'scale(1.3)';
                (e.currentTarget as HTMLElement).style.zIndex = '10';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                (e.currentTarget as HTMLElement).style.zIndex = '0';
              }}
              title={c.title}
            />
          );
        })}

        {/* Tooltip */}
        {hovered && (
          <div style={{
            position: 'absolute',
            left: tooltipPos.x, top: tooltipPos.y,
            transform: 'translateY(-100%)',
            background: 'var(--gray-900)', color: '#f9fafb',
            padding: '6px 10px', borderRadius: 6,
            fontSize: '0.8125rem', lineHeight: 1.5,
            whiteSpace: 'nowrap', zIndex: 20,
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}>
            <div style={{ fontWeight: 500, marginBottom: 2 }}>{hovered.title}</div>
            <div style={{ color: STATE_CONFIG[hovered.state].bg, fontWeight: 600 }}>
              {STATE_CONFIG[hovered.state].label}
            </div>
            {hovered.passRate !== undefined && hovered.passRate !== null && (
              <div style={{ color: '#9ca3af' }}>Pass rate: {Math.round(hovered.passRate * 100)}%</div>
            )}
            {hovered.lastRun && (
              <div style={{ color: '#9ca3af' }}>
                Last run: {new Date(hovered.lastRun).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
