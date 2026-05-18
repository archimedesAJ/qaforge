import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { TrendPoint } from '@qaforge/types';

interface TrendChartProps {
  series: TrendPoint[];
  isLoading?: boolean;
  threshold?: number; // e.g. 90 for 90% warning line
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number; payload: TrendPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  return (
    <div style={{
      background: 'var(--gray-900)', color: '#f9fafb',
      padding: '8px 12px', borderRadius: 6,
      fontSize: '0.8125rem', lineHeight: 1.6,
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    }}>
      <div style={{ color: '#9ca3af', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>
        Pass rate:{' '}
        <span style={{
          color: point.value >= 90 ? '#4ade80' : point.value >= 70 ? '#fbbf24' : '#f87171',
        }}>
          {point.value}%
        </span>
      </div>
      <div style={{ color: '#9ca3af' }}>{point.payload.totalRuns} runs</div>
    </div>
  );
}

function dotColor(value: number): string {
  if (value >= 90) return 'var(--color-success)';
  if (value >= 70) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

export function TrendChart({ series, isLoading, threshold = 90 }: TrendChartProps) {
  if (isLoading) {
    return (
      <div style={{
        height: 180, background: 'var(--gray-50)',
        borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--gray-300)', fontSize: '0.875rem',
      }}>
        Loading…
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <div style={{
        height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--gray-400)', fontSize: '0.875rem',
      }}>
        No trend data yet — close some runs to populate this chart
      </div>
    );
  }

  // Format date labels
  const formatted = series.map(s => ({
    ...s,
    label: new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    passRate: Math.round(s.passRate),
  }));

  // Determine line colour based on last value
  const lastVal = formatted[formatted.length - 1]?.passRate ?? 0;
  const lineColor = dotColor(lastVal);

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={formatted} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--gray-400)' }}
            axisLine={false} tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: 'var(--gray-400)' }}
            axisLine={false} tickLine={false}
            tickFormatter={v => `${v}%`}
          />
          <Tooltip content={<CustomTooltip />} />
          {threshold && (
            <ReferenceLine
              y={threshold}
              stroke="var(--color-warning)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{ value: `${threshold}%`, position: 'right', fontSize: 10, fill: 'var(--color-warning)' }}
            />
          )}
          <Line
            type="monotone"
            dataKey="passRate"
            stroke={lineColor}
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props;
              return (
                <circle
                  key={`dot-${payload.date}`}
                  cx={cx} cy={cy} r={3}
                  fill={dotColor(payload.passRate)}
                  stroke="white" strokeWidth={1.5}
                />
              );
            }}
            activeDot={{ r: 5, stroke: 'white', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
