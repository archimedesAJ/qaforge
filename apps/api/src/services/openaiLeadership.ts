import { z } from 'zod';

export const LeadershipEntryDraftSchema = z.object({
  tasksAchieved: z.array(z.string().trim().min(1).max(500)).max(3),
  inProgress: z.array(z.string().trim().min(1).max(500)).max(3),
  planned: z.array(z.string().trim().min(1).max(500)).max(3),
  oneOnOneSummary: z.array(z.string().trim().min(1).max(500)).max(3),
  learningDevelopment: z.array(z.string().trim().min(1).max(500)).max(3),
  managerFeedback: z.array(z.string().trim().min(1).max(500)).max(3),
});

export type LeadershipEntryDraft = z.infer<typeof LeadershipEntryDraftSchema>;

export type LeadershipEntrySource = {
  reportingPeriod: { from: string; to: string };
  employee: { name: string; jobTitle?: string | null; teamUnit?: string | null };
  activities: Array<{ date: string; action: string; item?: string | null; project?: string | null }>;
  oneOnOnes: Array<{
    date: string;
    wins: string[];
    discussionPoints: string[];
    challenges: string[];
    managerFeedback: string[];
    presentationSummary?: string | null;
  }>;
  learningTracker: Array<{
    title: string;
    type: string;
    provider?: string | null;
    skillArea?: string | null;
    status: string;
    startDate?: string | null;
    targetCompletionDate?: string | null;
    completionDate?: string | null;
    learningHours: number;
  }>;
  plans: Array<{ name: string; project: string; milestone?: string | null; status: string; endDate?: string | null }>;
};

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tasksAchieved', 'inProgress', 'planned', 'oneOnOneSummary', 'learningDevelopment', 'managerFeedback'],
  properties: Object.fromEntries([
    'tasksAchieved', 'inProgress', 'planned', 'oneOnOneSummary', 'learningDevelopment', 'managerFeedback',
  ].map(name => [name, { type: 'array', items: { type: 'string' } }])),
};

function responseText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }> };
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return null;
}

export async function draftLeadershipEntry(source: LeadershipEntrySource, safetyIdentifier: string): Promise<LeadershipEntryDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI is not configured. Add OPENAI_API_KEY to the API environment.');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-5.6-terra',
      store: false,
      safety_identifier: safetyIdentifier,
      max_output_tokens: 2000,
      instructions: `You draft concise monthly leadership-review content for a QA lead.
Use only facts in the supplied QAForge data and only the stated reporting period.
Never invent achievements, impact, dates, percentages, plans, feedback, or progress.
Return no more than three short presentation-ready bullets per section.
Tasks achieved must describe completed outcomes, not every routine activity.
In progress must describe work demonstrably active during the period.
Planned may use supplied plans only; do not infer future commitments.
One-on-one content may use only the supplied presentation-safe fields. Do not infer or mention private matters.
Learning and development must use only learningTracker. Never derive L&D from one-on-one data.
Manager feedback must be constructive, factual, and based only on supplied managerFeedback.
When evidence is insufficient for a section, return an empty array.`,
      input: JSON.stringify(source),
      text: {
        verbosity: 'low',
        format: { type: 'json_schema', name: 'leadership_entry_draft', strict: true, schema: jsonSchema },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message || `OpenAI request failed with status ${response.status}`);
  }
  const text = responseText(await response.json());
  if (!text) throw new Error('OpenAI returned no draft content.');
  return LeadershipEntryDraftSchema.parse(JSON.parse(text));
}
