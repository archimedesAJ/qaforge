import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftLeadershipEntry, type LeadershipEntrySource } from './openaiLeadership.js';

const source: LeadershipEntrySource = {
  reportingPeriod: { from: '2026-07-01', to: '2026-07-31' },
  employee: { name: 'Editor A', jobTitle: 'QA Engineer', teamUnit: 'QA' },
  activities: [{ date: '2026-07-10T09:00:00.000Z', action: 'Completed test run', item: 'Regression', project: 'Payments' }],
  oneOnOnes: [{ date: '2026-07-15', wins: ['Improved regression coverage'], discussionPoints: [], challenges: [], managerFeedback: ['Strong ownership'] }],
  learningTracker: [{ title: 'API Testing', type: 'course', status: 'in_progress', learningHours: 4 }],
  plans: [{ name: 'August regression', project: 'Payments', status: 'active' }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
});

describe('draftLeadershipEntry', () => {
  it('requests a structured, non-persisted draft and validates the response', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'test-model';
    const draft = {
      tasksAchieved: ['Completed regression testing for Payments.'],
      inProgress: [], planned: ['Prepare August regression testing.'],
      oneOnOneSummary: ['Last 1:1: 15 July 2026.'],
      learningDevelopment: ['API Testing course — in progress.'],
      managerFeedback: ['Demonstrates strong ownership.'],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(draft) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(draftLeadershipEntry(source, 'user-id')).resolves.toEqual(draft);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body));
    expect(body).toMatchObject({ model: 'test-model', store: false, safety_identifier: 'user-id' });
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(body.instructions).toContain('at most two short');
    expect(body.instructions).toContain('Last 1:1: D Month YYYY');
    expect(body.instructions).toContain('Strength: ...');
    expect(JSON.parse(body.input)).toEqual(source);
  });

  it('fails clearly when the API key is absent', async () => {
    await expect(draftLeadershipEntry(source, 'user-id')).rejects.toThrow('OPENAI_API_KEY');
  });
});
