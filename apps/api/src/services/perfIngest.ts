import { prisma } from '../lib/prisma.js';

export interface PerfPayload {
  scenario:   string;
  vus:        number;
  durationS:  number;
  p50Ms:      number;
  p95Ms:      number;
  p99Ms:      number;
  errorRate:  number;   // 0.02 = 2%
  rps:        number;
}

export interface PerfThresholds {
  p95Ms:        number;
  p99Ms:        number;
  maxErrorRate: number;
  minRps?:      number;
}

export interface ThresholdBreach {
  metric:   string;
  actual:   number;
  limit:    number;
  pctOver:  number;
}

export interface PerfIngestResult {
  status:            'pass' | 'fail';
  thresholdBreaches: ThresholdBreach[];
  baseline:          PerfPayload | null;
  isNewBaseline:     boolean;
}

// ── Baseline storage key ──────────────────────────────────────
// We store baselines per (projectId, scenario) in CoverageSnapshot
// using a special testCaseId convention. In practice you'd add a
// dedicated PerfBaseline table — for now we use a JSON file approach
// via a dedicated prisma table entry if available, else just compare
// against a hardcoded sensible default.

const DEFAULT_THRESHOLDS: PerfThresholds = {
  p95Ms:        500,
  p99Ms:        1000,
  maxErrorRate: 0.02,
  minRps:       undefined,
};

export function evaluateThresholds(
  payload: PerfPayload,
  thresholds: PerfThresholds
): ThresholdBreach[] {
  const breaches: ThresholdBreach[] = [];

  if (payload.p95Ms > thresholds.p95Ms) {
    breaches.push({
      metric:  'p95_latency_ms',
      actual:  payload.p95Ms,
      limit:   thresholds.p95Ms,
      pctOver: Math.round(((payload.p95Ms - thresholds.p95Ms) / thresholds.p95Ms) * 100),
    });
  }

  if (payload.p99Ms > thresholds.p99Ms) {
    breaches.push({
      metric:  'p99_latency_ms',
      actual:  payload.p99Ms,
      limit:   thresholds.p99Ms,
      pctOver: Math.round(((payload.p99Ms - thresholds.p99Ms) / thresholds.p99Ms) * 100),
    });
  }

  if (payload.errorRate > thresholds.maxErrorRate) {
    breaches.push({
      metric:  'error_rate',
      actual:  payload.errorRate,
      limit:   thresholds.maxErrorRate,
      pctOver: Math.round(((payload.errorRate - thresholds.maxErrorRate) / thresholds.maxErrorRate) * 100),
    });
  }

  if (thresholds.minRps !== undefined && payload.rps < thresholds.minRps) {
    breaches.push({
      metric:  'rps',
      actual:  payload.rps,
      limit:   thresholds.minRps,
      pctOver: Math.round(((thresholds.minRps - payload.rps) / thresholds.minRps) * 100),
    });
  }

  return breaches;
}

// ── Derive thresholds from baseline ──────────────────────────
// Allow 20% headroom above baseline latency, 10% drop in RPS
export function thresholdsFromBaseline(baseline: PerfPayload, override?: Partial<PerfThresholds>): PerfThresholds {
  return {
    p95Ms:        override?.p95Ms        ?? Math.round(baseline.p95Ms * 1.2),
    p99Ms:        override?.p99Ms        ?? Math.round(baseline.p99Ms * 1.2),
    maxErrorRate: override?.maxErrorRate ?? Math.min(baseline.errorRate * 2, 0.05),
    minRps:       override?.minRps       ?? Math.round(baseline.rps * 0.9),
  };
}

// ── Main ingest function ──────────────────────────────────────
export async function ingestPerfResult(
  runId:     string,
  projectId: string,
  testCaseId: string | null,
  payload:   PerfPayload,
  customThresholds?: Partial<PerfThresholds>
): Promise<PerfIngestResult> {

  // Look up previous baseline: most recent passing perf result for this scenario
  const previousResults = await prisma.runResult.findMany({
    where: {
      testCaseId: testCaseId ?? undefined,
      status: 'pass',
      run: { projectId },
    },
    orderBy: { executedAt: 'desc' },
    take: 1,
    select: { stepsLog: true },
  });

  let baseline: PerfPayload | null = null;
  let isNewBaseline = false;

  if (previousResults.length > 0 && previousResults[0].stepsLog) {
    const log = previousResults[0].stepsLog as Record<string, unknown>;
    if (log['scenario']) {
      baseline = log as unknown as PerfPayload;
    }
  }

  // Determine thresholds
  const thresholds: PerfThresholds = baseline
    ? thresholdsFromBaseline(baseline, customThresholds)
    : { ...DEFAULT_THRESHOLDS, ...customThresholds };

  const breaches = evaluateThresholds(payload, thresholds);
  const status   = breaches.length === 0 ? 'pass' : 'fail';

  // First result for this scenario becomes the baseline
  if (!baseline) isNewBaseline = true;

  // Write result
  if (testCaseId) {
    const tc = await prisma.testCase.findUnique({
      where: { id: testCaseId },
      select: { version: true },
    });

    await prisma.runResult.create({
      data: {
        runId,
        testCaseId,
        testCaseVersion: tc?.version ?? 1,
        status,
        durationMs: payload.durationS * 1000,
        stepsLog:   payload as never,
        failureNote: breaches.length > 0
          ? `${breaches.length} threshold breach(es): ${breaches.map(b => b.metric).join(', ')}`
          : undefined,
      },
    });
  }

  return { status, thresholdBreaches: breaches, baseline, isNewBaseline };
}
