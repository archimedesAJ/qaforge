import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  Project, TestCase, TestRun, CoverageCase, FlakyTest, TrendPoint,
  PaginatedResponse,
} from '@qaforge/types';

// ── Projects ──────────────────────────────────────────────────
export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[] }>('projects'),
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<Project>(`projects/${projectId}`),
    enabled: !!projectId,
  });
}

// ── Test cases ────────────────────────────────────────────────
export function useTestCases(
  projectId: string,
  filters: { suiteId?: string; type?: string; priority?: string } = {}
) {
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][]
  ).toString();

  return useQuery({
    queryKey: ['cases', projectId, filters],
    queryFn: () =>
      api.get<PaginatedResponse<TestCase>>(
        `projects/${projectId}/cases${params ? `?${params}` : ''}`
      ),
    enabled: !!projectId,
  });
}

export function useCreateCase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<TestCase>) =>
      api.post<TestCase>(`projects/${projectId}/cases`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases', projectId] }),
  });
}

export function useUpdateCase(projectId: string, caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<TestCase>) =>
      api.put<TestCase>(`projects/${projectId}/cases/${caseId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases', projectId] }),
  });
}

// ── Test runs ─────────────────────────────────────────────────
export function useRuns(projectId: string) {
  return useQuery({
    queryKey: ['runs', projectId],
    queryFn: () => api.get<{ runs: TestRun[] }>(`projects/${projectId}/runs`),
    enabled: !!projectId,
  });
}

export function useCreateRun(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; env: string; source: string }) =>
      api.post<TestRun>(`projects/${projectId}/runs`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs', projectId] }),
  });
}

export function useCloseRun(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.put(`projects/runs/${runId}/close`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  });
}

// ── Insights ──────────────────────────────────────────────────
export function useCoverage(projectId: string) {
  return useQuery({
    queryKey: ['coverage', projectId],
    queryFn: () => api.get<{ cases: CoverageCase[] }>(`projects/${projectId}/insights/coverage`),
    enabled: !!projectId,
  });
}

export function useFlakiness(projectId: string) {
  return useQuery({
    queryKey: ['flakiness', projectId],
    queryFn: () => api.get<{ flaky: FlakyTest[] }>(`projects/${projectId}/insights/flakiness`),
    enabled: !!projectId,
  });
}

export function useTrends(projectId: string, granularity: 'day' | 'week' = 'day') {
  return useQuery({
    queryKey: ['trends', projectId, granularity],
    queryFn: () =>
      api.get<{ series: TrendPoint[] }>(
        `projects/${projectId}/insights/trends?granularity=${granularity}`
      ),
    enabled: !!projectId,
  });
}

// ── Suites ────────────────────────────────────────────────────
export function useSuites(projectId: string) {
  return useQuery({
    queryKey: ['suites', projectId],
    queryFn: () => api.get<{ suites: unknown[] }>(`projects/${projectId}/suites`),
    enabled: !!projectId,
  });
}
