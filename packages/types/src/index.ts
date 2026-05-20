// ─────────────────────────────────────────────────────────────
// Enums / literals
// ─────────────────────────────────────────────────────────────

export type TestType =
  | 'manual'
  | 'functional'
  | 'ui_auto'
  | 'api'
  | 'perf'
  | 'exploratory';

export type Priority = 'p0' | 'p1' | 'p2' | 'p3';

export type ResultStatus =
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'skipped'
  | 'not_applicable';

export type CoverageState = 'healthy' | 'stale' | 'failing';
export type SessionVerdict = 'thorough' | 'partial' | 'incomplete';
export type RunSource = 'manual' | 'ci_github' | 'ci_gitlab' | 'ci_jenkins' | 'api';
export type TrackerType = 'jira' | 'github' | 'linear' | 'internal';
export type MemberRole = 'admin' | 'manager' | 'editor' | 'viewer';
export type RunStatus = 'open' | 'closed';

// ─────────────────────────────────────────────────────────────
// Step schemas — one per test type
// ─────────────────────────────────────────────────────────────

export interface ManualStep {
  order: number;
  action: string;
  expected: string;
}

export interface ManualStepResult extends ManualStep {
  status: ResultStatus;
  actual?: string;
  screenshotUrl?: string;
  note?: string;
}

export interface ApiAssertion {
  field: string; // e.g. 'status', 'body.charge_id', 'response_time_ms'
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'exists';
  expected: unknown;
}

export interface ApiRequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  assertions: ApiAssertion[];
  responseTimeThresholdMs?: number;
}

export interface ApiRunResult {
  status: ResultStatus;
  responseTimeMs: number;
  statusCode: number;
  assertions: Array<ApiAssertion & { actual: unknown; pass: boolean }>;
  requestSnapshot: unknown;
  responseSnapshot: unknown;
  errorMessage?: string;
}

export interface PerfThresholds {
  p95Ms: number;
  p99Ms: number;
  maxErrorRate: number; // 0.02 = 2%
  minRps?: number;
}

export interface PerfConfig {
  tool: 'k6' | 'locust' | 'jmeter';
  scriptPath: string;
  vus: number;
  duration: string; // e.g. '5m'
  thresholds: PerfThresholds;
}

export interface PerfRunResult {
  scenario: string;
  vus: number;
  durationS: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
  rps: number;
  thresholdBreaches: string[];
  status: ResultStatus;
}

export interface ExploratoryCharter {
  charter: string;
  durationMins: number;
  area: string;
  riskFocus: string;
  exitCriteria?: string;
}

export interface SessionLogEntry {
  timestamp: string; // ISO
  type: 'bug' | 'observation' | 'question' | 'note';
  text: string;
}

// ─────────────────────────────────────────────────────────────
// Core entities
// ─────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  activated: boolean;
  createdAt: string;
}

export interface UserInvite {
  id: string;
  email: string;
  projectId: string;
  role: MemberRole;
  invitedById: string;
  expiresAt: string;
  createdAt: string;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: MemberRole;
  user: Pick<User, 'id' | 'email' | 'name'>;
}

export interface TestSuite {
  id: string;
  projectId: string;
  name: string;
  parentId?: string;
  children?: TestSuite[];
}

export interface TestCase {
  id: string;
  projectId: string;
  suiteId?: string;
  title: string;
  type: TestType;
  priority: Priority;
  version: number;
  steps?: ManualStep[] | ApiRequestConfig | PerfConfig | ExploratoryCharter;
  tags: string[];
  preconditions?: string;
  createdById: string;
  createdAt: string;
  archived: boolean;
}

export interface TestRun {
  id: string;
  projectId: string;
  name: string;
  env: string;
  source: RunSource;
  status: RunStatus;
  triggeredBy?: string;
  startedAt: string;
  endedAt?: string;
}

export interface RunResult {
  id: number;
  runId: string;
  testCaseId: string;
  testCaseVersion: number;
  status: ResultStatus;
  durationMs?: number;
  stepsLog?: ManualStepResult[] | ApiRunResult | PerfRunResult | SessionLogEntry[];
  attachments?: Array<{ type: 'screenshot' | 'video' | 'file'; url: string }>;
  failureNote?: string;
  errorMessage?: string;
  stackTrace?: string;
  executedAt: string;
}

export interface Defect {
  id: string;
  runResultId: number;
  externalRef?: string;
  tracker: TrackerType;
  status: 'open' | 'in_progress' | 'resolved';
  createdAt: string;
}

export interface ExploratorySession {
  id: string;
  runId: string;
  charter: string;
  testerId: string;
  startedAt: string;
  endedAt?: string;
  sessionLog?: SessionLogEntry[];
  debrief?: string;
  verdict?: SessionVerdict;
}

// ─────────────────────────────────────────────────────────────
// Insights
// ─────────────────────────────────────────────────────────────

export interface CoverageCase {
  id: string;
  title: string;
  type: TestType;
  lastRun?: string;
  passRate?: number;
  state: CoverageState;
}

export interface FlakyTest {
  testCaseId: string;
  title: string;
  type: TestType;
  flakinessScore: number; // 0.0 – 1.0
  runsAnalysed: number;
  lastSeen: string;
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  passRate: number;
  totalRuns: number;
}

// ─────────────────────────────────────────────────────────────
// API wrappers
// ─────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  passRate: number;
  durationMs: number;
}

export interface ReleaseGate {
  name: string;
  passing: boolean;
  detail: string;
}
