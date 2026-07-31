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
  oneOnOneCount?: number;
  unitHighlights: unknown; nextPeriodFocus: unknown; workingFeedback: unknown; challengesSupport: unknown;
  decisionsActions: unknown; crossTeamDependencies: unknown; followUps: unknown;
};

const RED = 'E2093C'; const BLACK = '0D0D0D'; const DARK = '1A1A1A'; const GREY = 'F5F5F7'; const MID = '7E7E87';
const REPORTING_TO = 'Abraham Abbey';
const templateAsset = (name: string) => join(process.cwd(), 'apps/api/assets/leadership-template', name);
const asStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string') as string[] : [];
const asActions = (value: unknown): { action: string; owner?: string; dueDate?: string }[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && 'action' in item) as { action: string; owner?: string; dueDate?: string }[] : [];

function addLogo(slide: any, dark = false) {
  slide.addImage({ path: templateAsset('acs-logo.png'), x: dark ? 0.85 : 11.62, y: dark ? 0.7 : 6.92, w: dark ? 1.95 : 1.18, h: dark ? 0.75 : 0.46 });
}

function addFooter(slide: any, label: string) {
  slide.addText(`Leadership Review & Planning   •   ${label}   •   Confidential`, { x: 0.5, y: 7.08, w: 10.5, h: 0.3, fontFace: 'Arial', fontSize: 7.5, color: MID, margin: 0 });
  addLogo(slide);
}

function bulletText(items: string[], fallback = 'No update recorded', limit = 4, color = '30303A'): any[] {
  const values = items.length ? items.slice(0, limit) : [fallback];
  return values.map((item, index) => ({ text: item, options: { bullet: { indent: 12 }, breakLine: index < values.length - 1, color: items.length ? color : '9999A3' } }));
}

function addCard(slide: any, title: string, items: string[], x: number, y: number, w: number, h: number, icon: string, limit = 4, showEmptyMessage = true) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.05, fill: { color: GREY }, line: { color: 'E3E3E8', width: 1 }, shadow: { type: 'outer', color: 'BBBBBB', opacity: 0.18, blur: 2, angle: 45, distance: 1 } });
  slide.addShape('ellipse', { x: x + 0.22, y: y + 0.22, w: 0.48, h: 0.48, fill: { color: RED }, line: { color: RED } });
  slide.addImage({ path: templateAsset(icon), x: x + 0.33, y: y + 0.37, w: 0.27, h: 0.27 });
  slide.addText(title, { x: x + 0.86, y: y + 0.25, w: w - 1.05, h: 0.55, fontFace: 'Arial', bold: true, fontSize: 15, color: BLACK, margin: 0, valign: 'mid' });
  if (items.length || showEmptyMessage) {
    slide.addText(bulletText(items, 'No update recorded', limit), { x: x + 0.26, y: y + 0.82, w: w - 0.5, h: h - 1.0, fontFace: 'Arial', fontSize: 10.5, color: '30303A', margin: 0.03, breakLine: false, valign: 'top', paraSpaceAfterPt: 7 });
  }
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
  slide.addShape('rect', { x: 9.35, y: 0, w: 3.95, h: 7.5, fill: { color: DARK }, line: { color: DARK } });
  slide.addImage({ path: templateAsset('team.png'), x: 10.35, y: 2.55, w: 2.3, h: 2.3 });
  addLogo(slide, true);
  slide.addText('M O N T H L Y   L E A D E R S H I P   R E V I E W', { x: 0.87, y: 1.9, w: 8, h: 0.4, fontFace: 'Arial', fontSize: 12, bold: true, color: RED, charSpacing: 2.5, margin: 0 });
  slide.addText('Leadership Review\n& Planning', { x: 0.87, y: 2.38, w: 7.6, h: 1.42, fontFace: 'Arial', fontSize: 45, bold: true, color: 'FFFFFF', margin: 0, breakLine: false });
  slide.addText('Departmental review of progress, people and plans', { x: 0.9, y: 4.08, w: 6.8, h: 0.35, fontFace: 'Arial', fontSize: 15, italic: true, color: 'C5C5CC', margin: 0 });
  const coverFields = [
    { label: 'DEPARTMENT', value: review.department, labelY: 4.82, valueY: 5.06, lineY: 5.32 },
    { label: 'PRESENTED BY (TEAM LEAD)', value: REPORTING_TO, labelY: 5.48, valueY: 5.72, lineY: 5.98 },
    { label: 'REPORTING PERIOD (MONTH / YEAR)', value: period, labelY: 6.14, valueY: 6.38, lineY: 6.64 },
  ];
  coverFields.forEach(field => {
    slide.addText(field.label, { x: 0.87, y: field.labelY, w: 6, h: 0.28, fontFace: 'Arial', fontSize: 9.5, bold: true, color: RED, margin: 0 });
    slide.addText(field.value, { x: 0.87, y: field.valueY, w: 7.4, h: 0.24, fontFace: 'Arial', fontSize: 10.5, color: 'FFFFFF', margin: 0 });
    slide.addShape('line', { x: 0.87, y: field.lineY, w: 7.4, h: 0, line: { color: '3C3C3C', width: 1 } });
  });
  slide.addText("Prepared for the Managing Director's monthly leadership review", { x: 0.87, y: 6.98, w: 8, h: 0.3, fontFace: 'Arial', fontSize: 8, color: MID, margin: 0 });

  slide = pptx.addSlide();
  slide.addText('Unit Snapshot', { x: 0.5, y: 0.42, w: 9, h: 0.6, fontFace: 'Arial', fontSize: 34, bold: true, color: BLACK, margin: 0 });
  slide.addText(`${review.unitName}   ·   Team Lead: ${REPORTING_TO}   ·   ${period}`, { x: 0.52, y: 1.1, w: 12, h: 0.4, fontFace: 'Arial', fontSize: 14, italic: true, color: MID, margin: 0 });
  const held = review.oneOnOneCount ?? review.entries.filter(entry => asStrings(entry.oneOnOneSummary).some(item => !item.startsWith('Last 1:1:'))).length;
  const ldHours = review.entries.reduce((sum, entry) => sum + entry.ldHours, 0);
  const wins = asStrings(review.unitHighlights).length;
  [[String(review.entries.length), 'Direct reports'], [String(held), '1:1s held this period'], [String(ldHours), 'L&D hours logged'], [String(wins), 'Key wins delivered']].forEach(([value, label], index) => {
    const x = 0.5 + index * 3.13;
    slide.addShape('roundRect', { x, y: 1.8, w: 2.85, h: 1.72, fill: { color: RED }, line: { color: RED }, rectRadius: 0.06, shadow: { type: 'outer', color: 'BBBBBB', opacity: 0.2, blur: 2, angle: 45, distance: 1 } });
    slide.addText(value, { x: x + 0.1, y: 2.06, w: 2.65, h: 0.9, fontFace: 'Arial', fontSize: 35, bold: true, color: 'FFFFFF', align: 'center', margin: 0, valign: 'mid' });
    slide.addText(label, { x: x + 0.15, y: 2.96, w: 2.55, h: 0.42, fontFace: 'Arial', fontSize: 12, bold: true, color: 'FFFFFF', align: 'center', margin: 0 });
  });
  addCard(slide, 'Unit highlights', asStrings(review.unitHighlights), 0.5, 3.88, 6.15, 2.72, 'trophy.png', 4);
  addCard(slide, 'Focus for next period', asStrings(review.nextPeriodFocus), 6.85, 3.88, 5.95, 2.72, 'focus.png', 3, false);
  addFooter(slide, 'Unit snapshot');

  for (const entry of review.entries) {
    slide = pptx.addSlide();
    slide.addShape('roundRect', { x: 9.07, y: 0.42, w: 3.73, h: 0.36, fill: { color: BLACK }, line: { color: BLACK }, rectRadius: 0.05 });
    slide.addText('MONTHLY REVIEW · DIRECT REPORT', { x: 9.07, y: 0.42, w: 3.73, h: 0.36, fontFace: 'Arial', fontSize: 9.5, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid', margin: 0 });
    slide.addText(entry.employee.name, { x: 0.5, y: 0.34, w: 8.6, h: 0.62, fontFace: 'Arial', fontSize: 31, bold: true, color: BLACK, margin: 0 });
    slide.addText(`${entry.jobTitle || 'Job title'}  ·  ${entry.teamUnit || review.unitName}`, { x: 0.52, y: 1, w: 8.6, h: 0.35, fontFace: 'Arial', fontSize: 13, color: MID, margin: 0 });
    slide.addText(`Reporting period:  ${period}\nReporting to:  ${REPORTING_TO}`, { x: 8.6, y: 0.92, w: 4.2, h: 0.55, fontFace: 'Arial', fontSize: 10.5, color: BLACK, margin: 0, align: 'right', breakLine: false });
    slide.addShape('line', { x: 0.5, y: 1.5, w: 12.3, h: 0, line: { color: 'E3E3E8', width: 1 } });
    const cards: [string, string[], string][] = [['Tasks Achieved', asStrings(entry.tasksAchieved), 'achieved.png'], ['In Progress', asStrings(entry.inProgress), 'progress.png'], ['Planned', asStrings(entry.planned), 'planned.png'], ['One-on-One', asStrings(entry.oneOnOneSummary), 'one-on-one.png'], ['Learning & Development', asStrings(entry.learningDevelopment), 'learning.png'], ['Manager Feedback', asStrings(entry.managerFeedback), 'feedback.png']];
    cards.forEach(([title, items, icon], index) => addCard(slide, title, items, 0.5 + (index % 3) * 4.2, 1.72 + Math.floor(index / 3) * 2.68, 3.9, 2.42, icon, 3));
    addFooter(slide, 'Direct report');
  }

  slide = pptx.addSlide();
  slide.addText('Unit Feedback & Challenges', { x: 0.5, y: 0.42, w: 12.3, h: 0.6, fontFace: 'Arial', fontSize: 32, bold: true, color: BLACK, margin: 0 });
  slide.addText('Presented and moderated by the Unit Lead', { x: 0.52, y: 1.08, w: 12, h: 0.4, fontFace: 'Arial', fontSize: 14, italic: true, color: MID, margin: 0 });
  addCard(slide, "What's working / Feedback", asStrings(review.workingFeedback), 0.5, 1.75, 6.05, 3.3, 'trophy.png', 3);
  addCard(slide, 'Challenges & support needed', asStrings(review.challengesSupport), 6.75, 1.75, 6.05, 3.3, 'warning.png', 3);
  slide.addShape('roundRect', { x: 0.5, y: 5.32, w: 12.3, h: 1.32, fill: { color: BLACK }, line: { color: BLACK }, rectRadius: 0.05 });
  slide.addShape('ellipse', { x: 0.72, y: 5.52, w: 0.5, h: 0.5, fill: { color: RED }, line: { color: RED } });
  slide.addImage({ path: templateAsset('actions.png'), x: 0.83, y: 5.64, w: 0.27, h: 0.27 });
  slide.addText('Decisions & actions agreed', { x: 1.4, y: 5.5, w: 4.3, h: 0.54, bold: true, fontFace: 'Arial', fontSize: 16, color: 'FFFFFF', margin: 0, valign: 'mid' });
  const actions = asActions(review.decisionsActions).map(action => `${action.action}${action.owner ? ` — ${action.owner}` : ''}${action.dueDate ? ` — ${action.dueDate}` : ''}`);
  slide.addText(bulletText(actions, 'No actions agreed', 2, 'E0E0E5'), { x: 6, y: 5.54, w: 6.6, h: 0.98, fontFace: 'Arial', fontSize: 10.5, color: 'E0E0E5', margin: 0 });
  addFooter(slide, 'Department wrap-up');

  slide = pptx.addSlide();
  slide.background = { color: BLACK };
  slide.addShape('rect', { x: 9.35, y: 0, w: 3.95, h: 7.5, fill: { color: DARK }, line: { color: DARK } });
  slide.addImage({ path: templateAsset('next-steps.png'), x: 10.5, y: 2.75, w: 1.9, h: 1.9 });
  addLogo(slide, true);
  slide.addText('Discussion & Next Steps', { x: 0.85, y: 1.85, w: 8, h: 0.9, fontFace: 'Arial', fontSize: 38, bold: true, color: 'FFFFFF', margin: 0 });
  const actionSummaries = asActions(review.decisionsActions).map(action => `${action.action}${action.owner ? ` — ${action.owner}` : ''}${action.dueDate ? ` — ${action.dueDate}` : ''}`);
  const dependencySummaries = asStrings(review.crossTeamDependencies);
  const followUpSummaries = asStrings(review.followUps);
  const nextSteps = [
    ...(actionSummaries.length ? [`Agreed actions: ${actionSummaries.slice(0, 2).join('; ')}`] : []),
    ...(dependencySummaries.length ? [`Dependencies / support: ${dependencySummaries.slice(0, 2).join('; ')}`] : []),
    ...(followUpSummaries.length ? [`Follow-ups: ${followUpSummaries.slice(0, 2).join('; ')}`] : []),
    ...(review.nextMeetingDate ? [`Next meeting: ${review.nextMeetingDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`] : []),
  ];
  slide.addText(bulletText(nextSteps, 'No next steps recorded', 4, 'E0E0E5'), { x: 0.95, y: 3.1, w: 7.4, h: 2.7, fontFace: 'Arial', fontSize: 14, color: 'E0E0E5', margin: 0.04, paraSpaceAfterPt: 10, breakLine: false });
  slide.addText("It's possible.", { x: 0.95, y: 6.55, w: 2.2, h: 0.25, fontFace: 'Arial', fontSize: 13, italic: true, color: '59A7FF', margin: 0 });

  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}
