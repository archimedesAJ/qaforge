import { z } from 'zod';

export const LeadershipEntryDraftSchema = z.object({
  tasksAchieved: z.array(z.string().trim().min(1).max(180)).max(2),
  inProgress: z.array(z.string().trim().min(1).max(180)).max(2),
  planned: z.array(z.string().trim().min(1).max(180)).max(2),
  oneOnOneSummary: z.array(z.string().trim().min(1).max(180)).max(2),
  learningDevelopment: z.array(z.string().trim().min(1).max(180)).max(2),
  managerFeedback: z.array(z.string().trim().min(1).max(180)).max(2),
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
      instructions: `You draft concise monthly leadership-review slide content for a QA lead.
Use only facts in the supplied QAForge data and only the stated reporting period.
Never invent achievements, impact, dates, percentages, plans, feedback, or progress.
Follow this exact six-card format. Return at most two short, standalone bullets per card, without bullet symbols, headings, markdown, or trailing full stops.
Tasks Achieved: state a completed deliverable or outcome; add measurable impact only when explicitly present in the data.
In Progress: state demonstrably active work and its recorded status or percentage; use a second bullet for an explicitly supplied target or completion date.
Planned: state only an upcoming priority or goal explicitly present in plans.
One-on-One: when a meeting exists, the first bullet must be "Last 1:1: D Month YYYY" using the latest supplied meeting date. The second bullet may summarize only presentationSummary or presentation-safe discussion points.
Learning & Development: use only learningTracker, never one-on-one data. Format a course or certification as "Title — status". A second bullet may state the recorded skill focus or progress.
Manager Feedback: use only supplied managerFeedback. Prefer "Strength: ..." for positive feedback and "Grow: ..." for a recorded development area. Do not turn activity data into manager feedback.
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
