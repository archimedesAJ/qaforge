import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateAdminBrief, type AdminBriefSource } from './openaiAdminBrief.js';

const source: AdminBriefSource = {
  date: '2026-08-10',
  question: 'What is happening today?',
  totals: { activeProjects: 1, runsStarted: 1, runsClosed: 0, testsExecuted: 3, passed: 2, failed: 1, blocked: 0, skipped: 0, casesCreated: 0, defectsFiled: 1, defectsResolved: 0, plansCreated: 0 },
  projects: [{ name: 'Payments', runsStarted: 1, runsClosed: 0, testsExecuted: 3, passed: 2, failed: 1, blocked: 0, casesCreated: 0, defectsFiled: 1, defectsResolved: 0, plansCreated: 0 }],
  activities: [{ at: '2026-08-10T09:00:00.000Z', user: 'Editor A', action: 'run_started', project: 'Payments', item: 'Regression' }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
});

describe('generateAdminBrief', () => {
  it('uses structured output without storing the response', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'test-model';
    const brief = {
      headline: 'Payments testing is active',
      summary: 'Three tests were executed and one failed.',
      highlights: ['Two of three tests passed'],
      risks: ['One test failed'],
      projectUpdates: [{ project: 'Payments', update: 'A regression run started and three tests were executed.' }],
      peopleActivity: ['Editor A started the Regression run'],
      followUps: ['Review the failed test in Payments'],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(brief) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateAdminBrief(source, 'admin-id')).resolves.toEqual(brief);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body));
    expect(body).toMatchObject({ model: 'test-model', store: false, safety_identifier: 'admin-id' });
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(body.instructions).toContain('using only the supplied database facts');
    expect(JSON.parse(body.input)).toEqual(source);
  });

  it('fails clearly when OpenAI is not configured', async () => {
    await expect(generateAdminBrief(source, 'admin-id')).rejects.toThrow('OPENAI_API_KEY');
  });
});
