import PptxModule from 'pptxgenjs';
import { join } from 'node:path';

type Entry = {
  employee: { name: string };
  jobTitle: string | null; teamUnit: string | null; ldHours: number;
  tasksAchieved: unknown; inProgress: unknown; planned: unknown; oneOnOneSummary: unknown;
  learningDevelopment: unknown; managerFeedback: unknown;
};
type Review = {
  department: string; unitName: string; reportingPeriod: Date; meetingDate: Date | null; nextMeetingDate: Date | null;
  presenter: { name: string };
  entries: Entry[];
  unitHighlights: unknown; nextPeriodFocus: unknown; workingFeedback: unknown; challengesSupport: unknown;
  decisionsActions: unknown; crossTeamDependencies: unknown; followUps: unknown;
};

const RED = 'EA0038'; const BLACK = '0B0B0B'; const DARK = '191919'; const GREY = 'F4F4F6'; const MID = '73737E';
const asStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string') as string[] : [];
const asActions = (value: unknown): { action: string; owner?: string; dueDate?: string }[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && 'action' in item) as { action: string; owner?: string; dueDate?: string }[] : [];

function addLogo(slide: any, dark = false) {
  const path = join(process.cwd(), 'apps/api/assets/acs-logo.png');
  slide.addImage({ path, x: dark ? 0.8 : 11.2, y: dark ? 0.55 : 6.65, w: 1.35, h: 0.55 });
}

function addFooter(slide: any, label: string) {
  slide.addText(`Leadership Review & Planning  •  ${label}  •  Confidential`, { x: 0.55, y: 7.1, w: 7.2, h: 0.2, fontFace: 'Arial', fontSize: 8, color: MID, margin: 0 });
  addLogo(slide);
}

function bulletText(items: string[], fallback = 'No update recorded'): any[] {
  const values = items.length ? items.slice(0, 5) : [fallback];
  return values.map((item, index) => ({ text: item, options: { bullet: { indent: 12 }, breakLine: index < values.length - 1, color: items.length ? '30303A' : '9999A3' } }));
}

function addCard(slide: any, title: string, items: string[], x: number, y: number, w: number, h: number) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.05, fill: { color: GREY }, line: { color: 'E3E3E8', width: 1 }, shadow: { type: 'outer', color: 'BBBBBB', opacity: 0.18, blur: 2, angle: 45, distance: 1 } });
  slide.addShape('ellipse', { x: x + 0.22, y: y + 0.22, w: 0.48, h: 0.48, fill: { color: RED }, line: { color: RED } });
  slide.addText('●', { x: x + 0.35, y: y + 0.30, w: 0.2, h: 0.18, color: 'FFFFFF', fontSize: 10, margin: 0, align: 'center' });
  slide.addText(title, { x: x + 0.82, y: y + 0.26, w: w - 1.02, h: 0.28, fontFace: 'Arial', bold: true, fontSize: 15, color: BLACK, margin: 0 });
  slide.addText(bulletText(items), { x: x + 0.25, y: y + 0.78, w: w - 0.5, h: h - 0.95, fontFace: 'Arial', fontSize: 11, color: '30303A', margin: 0.03, breakLine: false, valign: 'top', paraSpaceAfterPt: 7 });
}

export async function buildLeadershipDeck(review: Review): Promise<Buffer> {
  const PptxGenJS = PptxModule as unknown as new () => any;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = review.presenter.name;
  pptx.subject = 'Monthly Leadership Review & Planning';
  pptx.title = `${review.unitName} Leadership Review`;
  pptx.company = 'ACS';
  pptx.lang = 'en-GB';
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'en-GB' };
  const period = review.reportingPeriod.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  let slide = pptx.addSlide();
  slide.background = { color: BLACK };
  slide.addShape('rect', { x: 9.5, y: 0, w: 3.84, h: 7.5, fill: { color: DARK }, line: { color: DARK } });
  addLogo(slide, true);
  slide.addText('M O N T H L Y   L E A D E R S H I P   R E V I E W', { x: 0.85, y: 2.15, w: 5.8, h: 0.25, fontSize: 11, bold: true, color: RED, charSpacing: 2, margin: 0 });
  slide.addText('Leadership Review\n& Planning', { x: 0.85, y: 2.65, w: 7.3, h: 1.25, fontSize: 42, bold: true, color: 'FFFFFF', margin: 0, breakLine: false });
  slide.addText('Departmental review of progress, people and plans', { x: 0.9, y: 4.35, w: 6.8, h: 0.25, fontSize: 15, italic: true, color: 'C5C5CC', margin: 0 });
  slide.addText(`DEPARTMENT\n${review.department}\n\nPRESENTED BY\n${review.presenter.name}\n\nREPORTING PERIOD\n${period}`, { x: 0.9, y: 4.9, w: 6.8, h: 1.55, fontSize: 10, bold: true, color: RED, breakLine: false, margin: 0, paraSpaceAfterPt: 4 });

  slide = pptx.addSlide();
  slide.addText('Unit Snapshot', { x: 0.75, y: 0.55, w: 5, h: 0.5, fontSize: 32, bold: true, color: BLACK, margin: 0 });
  slide.addText(`${review.unitName} · Team Lead: ${review.presenter.name} · ${period}`, { x: 0.78, y: 1.22, w: 7, h: 0.25, fontSize: 14, italic: true, color: MID, margin: 0 });
  const held = review.entries.filter(entry => asStrings(entry.oneOnOneSummary).length > 0).length;
  const ldHours = review.entries.reduce((sum, entry) => sum + entry.ldHours, 0);
  const wins = review.entries.reduce((sum, entry) => sum + asStrings(entry.tasksAchieved).length, 0);
  [[String(review.entries.length), 'Direct reports'], [String(held), '1:1s held this period'], [String(ldHours), 'L&D hours logged'], [String(wins), 'Key wins delivered']].forEach(([value, label], index) => {
    const x = 0.75 + index * 3.08;
    slide.addShape('roundRect', { x, y: 1.75, w: 2.7, h: 1.55, fill: { color: RED }, line: { color: RED }, rectRadius: 0.06 });
    slide.addText(value, { x, y: 2.05, w: 2.7, h: 0.55, fontSize: 28, bold: true, color: 'FFFFFF', align: 'center', margin: 0 });
    slide.addText(label, { x: x + 0.15, y: 2.75, w: 2.4, h: 0.25, fontSize: 12, bold: true, color: 'FFFFFF', align: 'center', margin: 0 });
  });
  addCard(slide, 'Unit highlights', asStrings(review.unitHighlights), 0.75, 3.65, 5.85, 2.55);
  addCard(slide, 'Focus for next period', asStrings(review.nextPeriodFocus), 6.9, 3.65, 5.65, 2.55);
  addFooter(slide, 'Unit snapshot');

  for (const entry of review.entries) {
    slide = pptx.addSlide();
    slide.addText(entry.employee.name, { x: 0.55, y: 0.35, w: 6.8, h: 0.45, fontSize: 29, bold: true, color: BLACK, margin: 0 });
    slide.addText(`${entry.jobTitle || 'Job title'} · ${entry.teamUnit || review.unitName}`, { x: 0.57, y: 0.95, w: 6, h: 0.25, fontSize: 13, color: MID, margin: 0 });
    slide.addText(`Reporting period: ${period}\nReporting to: ${review.presenter.name}`, { x: 9.35, y: 0.45, w: 3.4, h: 0.6, fontSize: 11, color: BLACK, margin: 0.02, align: 'right' });
    const cards: [string, string[]][] = [['Tasks Achieved', asStrings(entry.tasksAchieved)], ['In Progress', asStrings(entry.inProgress)], ['Planned', asStrings(entry.planned)], ['One-on-One', asStrings(entry.oneOnOneSummary)], ['Learning & Development', asStrings(entry.learningDevelopment)], ['Manager Feedback', asStrings(entry.managerFeedback)]];
    cards.forEach(([title, items], index) => addCard(slide, title, items, 0.55 + (index % 3) * 4.25, 1.45 + Math.floor(index / 3) * 2.55, 3.95, 2.25));
    addFooter(slide, `Direct report · ${entry.employee.name}`);
  }

  slide = pptx.addSlide();
  slide.addText('Unit Feedback & Challenges', { x: 0.6, y: 0.45, w: 8, h: 0.5, fontSize: 31, bold: true, color: BLACK, margin: 0 });
  slide.addText('Presented and moderated by the Unit Lead', { x: 0.63, y: 1.12, w: 6.5, h: 0.25, fontSize: 14, italic: true, color: MID, margin: 0 });
  addCard(slide, "What's working / Feedback", asStrings(review.workingFeedback), 0.6, 1.7, 6, 3.15);
  addCard(slide, 'Challenges & support needed', asStrings(review.challengesSupport), 6.85, 1.7, 5.9, 3.15);
  slide.addShape('roundRect', { x: 0.6, y: 5.15, w: 12.15, h: 1.25, fill: { color: BLACK }, line: { color: BLACK }, rectRadius: 0.05 });
  slide.addText('Decisions & actions agreed', { x: 0.85, y: 5.5, w: 3.4, h: 0.28, bold: true, fontSize: 16, color: 'FFFFFF', margin: 0 });
  const actions = asActions(review.decisionsActions).map(action => `${action.action}${action.owner ? ` — ${action.owner}` : ''}${action.dueDate ? ` — ${action.dueDate}` : ''}`);
  slide.addText(bulletText(actions), { x: 5.2, y: 5.35, w: 6.8, h: 0.7, fontSize: 11, color: 'FFFFFF', margin: 0 });
  addFooter(slide, 'Department wrap-up');

  slide = pptx.addSlide();
  slide.background = { color: BLACK };
  slide.addShape('rect', { x: 9.4, y: 0, w: 3.94, h: 7.5, fill: { color: DARK }, line: { color: DARK } });
  addLogo(slide, true);
  slide.addText('Discussion & Next Steps', { x: 0.9, y: 1.75, w: 7.6, h: 0.6, fontSize: 36, bold: true, color: 'FFFFFF', margin: 0 });
  const nextSteps = [
    ...asActions(review.decisionsActions).map(action => `${action.action}${action.owner ? ` — ${action.owner}` : ''}${action.dueDate ? ` — ${action.dueDate}` : ''}`),
    ...asStrings(review.crossTeamDependencies), ...asStrings(review.followUps),
    ...(review.nextMeetingDate ? [`Next meeting: ${review.nextMeetingDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`] : []),
  ];
  slide.addText(bulletText(nextSteps, 'No next steps recorded'), { x: 0.95, y: 3.05, w: 7.4, h: 2.5, fontSize: 18, color: 'E0E0E5', margin: 0.04, paraSpaceAfterPt: 12 });
  slide.addText("It's possible.", { x: 0.95, y: 6.55, w: 2.2, h: 0.25, fontSize: 13, italic: true, color: '59A7FF', margin: 0 });

  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}
