// ── CSV Export ────────────────────────────────────────────────

interface RunResultRow {
  id:           number;
  testCaseId?:  string;
  status:       string;
  durationMs?:  number;
  errorMessage?: string;
  failureNote?:  string;
  executedAt:   string;
  testCase?:    { seqId?: number; title: string; type: string; priority: string } | null;
}

interface RunMeta {
  name:         string;
  env:          string;
  source:       string;
  startedAt:    string;
  endedAt?:     string;
  reporter?:    string;
  projectName?: string;
}

export function exportResultsCsv(run: RunMeta, results: RunResultRow[]): void {
  const headers = ['Case ID', 'Test case', 'Type', 'Status', 'Duration (ms)', 'Error message', 'Failure note', 'Executed at'];

  const rows = results.map(r => [
    r.testCase?.seqId != null ? fmtSeqId(r.testCase.seqId) : (r.testCaseId ?? ''),
    r.testCase?.title     ?? `Result #${r.id}`,
    r.testCase?.type      ?? '',
    r.status,
    r.durationMs != null  ? String(r.durationMs) : '',
    r.errorMessage        ?? '',
    r.failureNote         ?? '',
    new Date(r.executedAt).toISOString(),
  ]);

  const csv = [headers, ...rows]
    .map(row =>
      row.map(cell => {
        const str = String(cell ?? '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(',')
    )
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${slugify(run.name)}-results.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── PDF Export ────────────────────────────────────────────────

interface RunSummary {
  total:    number;
  passed:   number;
  failed:   number;
  blocked:  number;
  skipped:  number;
  passRate: number;
}

export async function exportResultsPdf(
  run:     RunMeta,
  results: RunResultRow[],
  summary: RunSummary,
  overrides?: { executiveSummary?: string }
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PAGE_W = 210;
  const MARGIN = 16;
  const COL_W  = PAGE_W - MARGIN * 2; // 178 mm
  let y        = MARGIN;

  const primary = [29,  78, 216] as [number, number, number];
  const gray900 = [17,  24,  39] as [number, number, number];
  const gray500 = [107, 114, 128] as [number, number, number];
  const gray400 = [156, 163, 175] as [number, number, number];
  const gray200 = [229, 231, 235] as [number, number, number];
  const gray100 = [243, 244, 246] as [number, number, number];
  const green   = [22,  163,  74] as [number, number, number];
  const red     = [220,  38,  38] as [number, number, number];
  const amber   = [217, 119,   6] as [number, number, number];

  function hrLine(color: [number, number, number] = gray200) {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 4;
  }

  function checkPage(needed = 10) {
    if (y + needed > 277) { doc.addPage(); y = MARGIN; }
  }

  // ── 1. Header banner ──────────────────────────────────────────
  doc.setFillColor(...primary);
  doc.rect(0, 0, PAGE_W, 33, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text('QAForge  ·  Test Run Report', MARGIN, 10);
  doc.text(
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    PAGE_W - MARGIN, 10, { align: 'right' }
  );

  const runLabel = run.name.length > 52 ? run.name.slice(0, 50) + '…' : run.name;
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(runLabel, MARGIN, 24);

  y = 41;

  // ── 2. Run meta lines ─────────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...gray500);
  const metaRow1 = [
    ...(run.projectName ? [`Project: ${run.projectName}`] : []),
    `Environment: ${run.env}`,
    ...(run.reporter ? [`Reported by: ${run.reporter}`] : []),
  ];
  const metaRow2 = [
    `Started: ${new Date(run.startedAt).toLocaleString('en-GB')}`,
    ...(run.endedAt ? [`Ended: ${new Date(run.endedAt).toLocaleString('en-GB')}`] : []),
  ];
  if (metaRow1.length > 0) {
    doc.text(metaRow1.join('   ·   '), MARGIN, y);
    y += 5;
  }
  doc.text(metaRow2.join('   ·   '), MARGIN, y);
  y += 7;

  hrLine();

  // ── 3. Summary stat boxes ─────────────────────────────────────
  const statItems = [
    { label: 'Pass rate', value: `${summary.passRate}%`,    color: summary.passRate >= 90 ? green : summary.passRate >= 70 ? amber : red },
    { label: 'Passed',   value: String(summary.passed),     color: green },
    { label: 'Failed',   value: String(summary.failed),     color: summary.failed  > 0 ? red   : gray400 },
    { label: 'Blocked',  value: String(summary.blocked),    color: summary.blocked > 0 ? amber : gray400 },
    { label: 'Skipped',  value: String(summary.skipped),    color: gray400 },
    { label: 'Total',    value: String(summary.total),      color: gray900 },
  ];

  const statW = COL_W / statItems.length;
  statItems.forEach((s, i) => {
    const sx = MARGIN + i * statW + statW / 2;
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...s.color);
    doc.text(s.value, sx, y + 7, { align: 'center' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray500);
    doc.text(s.label, sx, y + 12.5, { align: 'center' });
  });

  y += 20;
  hrLine();

  // ── 4. Donut chart + legend ───────────────────────────────────
  const CHART_MM = 50;
  const donutImg = createDonutChart(summary);
  doc.addImage(donutImg, 'PNG', MARGIN, y, CHART_MM, CHART_MM);

  const legendX = MARGIN + CHART_MM + 10;
  let   legendY = y + 8;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray900);
  doc.text('Results breakdown', legendX, legendY);
  legendY += 8;

  const legendItems = [
    { label: 'Passed',  count: summary.passed,  color: green  },
    { label: 'Failed',  count: summary.failed,  color: red    },
    { label: 'Blocked', count: summary.blocked, color: amber  },
    { label: 'Skipped', count: summary.skipped, color: gray400 },
  ].filter(item => item.count > 0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  for (const item of legendItems) {
    const pct = summary.total > 0 ? Math.round((item.count / summary.total) * 100) : 0;
    doc.setFillColor(...item.color);
    doc.rect(legendX, legendY - 2.5, 4, 4, 'F');
    doc.setTextColor(...gray900);
    doc.text(`${item.label}: ${item.count} (${pct}%)`, legendX + 6, legendY + 0.5);
    legendY += 7;
  }

  y = Math.max(y + CHART_MM + 5, legendY + 4);
  hrLine();

  // ── 5. Executive Summary ──────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray900);
  doc.text('Executive Summary', MARGIN, y);
  y += 5;

  const execText  = overrides?.executiveSummary ?? buildExecutiveSummary(run, summary);
  const execLines = doc.splitTextToSize(execText, COL_W);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(55, 65, 81);
  doc.text(execLines, MARGIN, y);
  y += execLines.length * 4.6 + 5;

  hrLine();

  // ── 6. Test results table ─────────────────────────────────────
  checkPage(20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray900);
  doc.text('Test results', MARGIN, y);
  y += 6;

  // Column widths
  const colId     = 22;
  const colTitle  = COL_W - 22 - 78; // ~78 mm
  const colType   = 26;
  const colStatus = 26;

  doc.setFillColor(...gray100);
  doc.rect(MARGIN, y - 3, COL_W, 7, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray500);
  let tx = MARGIN + 2;
  doc.text('Case ID',  tx, y + 1); tx += colId;
  doc.text('Test case', tx, y + 1); tx += colTitle;
  doc.text('Type',      tx, y + 1); tx += colType;
  doc.text('Status',    tx, y + 1); tx += colStatus;
  doc.text('Duration',  tx, y + 1);
  y += 8;

  doc.setFont('helvetica', 'normal');

  results.forEach((r, i) => {
    checkPage(8);

    if (i % 2 === 0) {
      doc.setFillColor(249, 250, 251);
      doc.rect(MARGIN, y - 3, COL_W, 7, 'F');
    }

    const statusColor = r.status === 'pass' ? green : r.status === 'fail' ? red : amber;
    const title       = r.testCase?.title ?? `Result #${r.id}`;
    const shortId     = r.testCase?.seqId != null ? fmtSeqId(r.testCase.seqId) : '—';

    doc.setFontSize(7.5);
    doc.setTextColor(...gray400);
    tx = MARGIN + 2;
    doc.text(shortId,                          tx, y + 1); tx += colId;
    doc.setTextColor(...gray900);
    doc.text(fitText(doc, title, colTitle - 2), tx, y + 1); tx += colTitle;
    doc.text(r.testCase?.type ?? '',        tx, y + 1); tx += colType;
    doc.setTextColor(...statusColor);
    doc.text(r.status.charAt(0).toUpperCase() + r.status.slice(1), tx, y + 1); tx += colStatus;
    doc.setTextColor(...gray500);
    doc.text(r.durationMs != null ? fmtDuration(r.durationMs) : '—', tx, y + 1);

    y += 7;

    // Error sub-row
    const note = r.errorMessage || r.failureNote;
    if (note && r.status !== 'pass') {
      checkPage(6);
      doc.setFontSize(6.5);
      doc.setTextColor(...(r.status === 'fail' ? red : amber));
      const truncNote = note.length > 110 ? note.slice(0, 108) + '…' : note;
      doc.text('↳ ' + truncNote, MARGIN + 4, y + 1);
      y += 6;
    }
  });

  // ── Footer on every page ──────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(...gray500);
    doc.text(
      `Generated by QAForge  ·  Page ${p} of ${pageCount}`,
      PAGE_W / 2, 290, { align: 'center' }
    );
  }

  doc.save(`${slugify(run.name)}-report.pdf`);
}

// ── Donut chart via canvas ────────────────────────────────────

function createDonutChart(summary: RunSummary): string {
  const canvas  = document.createElement('canvas');
  canvas.width  = 300;
  canvas.height = 300;
  const ctx     = canvas.getContext('2d')!;
  const cx = 150, cy = 150, outerR = 128, innerR = 82;

  const segments = [
    { value: summary.passed,  color: '#16a34a' },
    { value: summary.failed,  color: '#dc2626' },
    { value: summary.blocked, color: '#d97706' },
    { value: summary.skipped, color: '#9ca3af' },
  ].filter(s => s.value > 0);

  if (summary.total === 0 || segments.length === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth   = 46;
    ctx.stroke();
  } else {
    let angle = -Math.PI / 2;
    for (const seg of segments) {
      const slice = (seg.value / summary.total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      // Small gap between slices
      angle += slice + 0.01;
    }
  }

  // White donut hole
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Center text
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#111827';
  ctx.font         = 'bold 54px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${summary.passRate}%`, cx, cy - 14);
  ctx.font      = '26px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText('pass rate', cx, cy + 26);

  return canvas.toDataURL('image/png');
}

// ── Executive summary ─────────────────────────────────────────

export function buildExecutiveSummary(run: RunMeta, summary: RunSummary): string {
  const { passRate, total, passed, failed, blocked, skipped } = summary;
  const dateStr = new Date(run.startedAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const quality =
    passRate >= 95 ? 'excellent' :
    passRate >= 80 ? 'good, though a small number of cases require attention' :
    passRate >= 60 ? 'below expectations, with several cases requiring immediate attention' :
    'poor — a significant proportion of test cases are failing';

  const recommendation =
    passRate >= 95
      ? 'The application is performing well and is considered ready for release.'
      : passRate >= 80
      ? 'The application is largely stable. The engineering team should review and resolve the failing cases prior to the next release.'
      : passRate >= 60
      ? 'Caution is advised. The volume of failures suggests the application may not be ready for release. A detailed review by the engineering team is strongly recommended before proceeding.'
      : 'Release to production is not recommended at this stage. The engineering team must investigate and resolve all critical failures before any release decision is made.';

  const parts: string[] = [
    `This report covers the "${run.name}" test run${run.projectName ? ` for the ${run.projectName} project` : ''}, executed against the ${run.env} environment on ${dateStr}.`,
  ];

  let resultLine = `Of the ${total} test case${total !== 1 ? 's' : ''} executed, ${passed} passed`;
  if (failed > 0)  resultLine += `, ${failed} failed`;
  if (blocked > 0) resultLine += `, ${blocked} were blocked due to a dependency or environment issue`;
  if (skipped > 0) resultLine += `, and ${skipped} were skipped`;
  resultLine += '.';
  parts.push(resultLine);

  parts.push(`The overall pass rate of ${passRate}% is ${quality}. ${recommendation}`);

  if (failed > 0) {
    parts.push(
      `There ${failed === 1 ? 'is' : 'are'} ${failed} failing test case${failed !== 1 ? 's' : ''} that require${failed === 1 ? 's' : ''} attention from the engineering team. Error details are listed in the test results section below.`
    );
  }

  return parts.join(' ');
}

// ── Admin Overview Report ─────────────────────────────────────

export interface AdminReportProject {
  name:          string;
  cases:         number;
  passRate:      number | null;
  coveragePct:   number | null;
  coverageStats: { healthy: number; stale: number; failing: number };
  flakyCount:    number;
  latestRun:     { env: string; status: string; startedAt: string } | null;
  openDefects:   number;
}

export interface AdminReportData {
  period:      string;
  generatedAt: string;
  stats: {
    totalProjects:  number;
    activatedUsers: number;
    totalCases:     number;
    openRuns:       number;
    openDefects:    number;
  };
  kpis: {
    avgPassRate:  number | null;
    avgCoverage:  number | null;
    totalFailing: number;
    totalStale:   number;
    totalFlaky:   number;
  };
  projects: AdminReportProject[];
}

export function buildAdminExecutiveSummary(data: AdminReportData): string {
  const { kpis, stats, projects, period } = data;
  const parts: string[] = [];

  const activeProjects   = projects.filter(p => p.latestRun !== null).length;
  const inactiveProjects = projects.length - activeProjects;

  parts.push(
    `This report covers ${stats.totalProjects} project${stats.totalProjects !== 1 ? 's' : ''} ` +
    `with ${stats.activatedUsers} active user${stats.activatedUsers !== 1 ? 's' : ''}, ` +
    `tracking ${stats.totalCases.toLocaleString()} test case${stats.totalCases !== 1 ? 's' : ''}. ` +
    `Period: ${period}.`,
  );

  if (kpis.avgPassRate !== null && kpis.avgCoverage !== null) {
    const passQual     = kpis.avgPassRate >= 90 ? 'strong' : kpis.avgPassRate >= 70 ? 'moderate' : 'below target';
    const coverageQual = kpis.avgCoverage >= 80 ? 'well covered' : kpis.avgCoverage >= 50 ? 'partially covered' : 'under-covered';
    parts.push(
      `Average pass rate across all projects is ${kpis.avgPassRate}% (${passQual}), ` +
      `with an average execution coverage of ${kpis.avgCoverage}% (${coverageQual}).`,
    );
  } else {
    parts.push('No test runs were recorded in the selected period.');
  }

  if (kpis.totalFailing > 0 || kpis.totalStale > 0) {
    const issues: string[] = [];
    if (kpis.totalFailing > 0) issues.push(`${kpis.totalFailing} failing case${kpis.totalFailing !== 1 ? 's' : ''}`);
    if (kpis.totalStale   > 0) issues.push(`${kpis.totalStale} stale case${kpis.totalStale !== 1 ? 's' : ''}`);
    parts.push(`Portfolio-wide, there are ${issues.join(' and ')} that require attention.`);
  }

  if (kpis.totalFlaky > 0) {
    parts.push(
      `${kpis.totalFlaky} test${kpis.totalFlaky !== 1 ? 's exhibit' : ' exhibits'} flaky behaviour and should be investigated to improve result reliability.`,
    );
  }

  if (inactiveProjects > 0) {
    parts.push(
      `${inactiveProjects} project${inactiveProjects !== 1 ? 's have' : ' has'} no recorded test runs and may require activation or review.`,
    );
  }

  const recommendation =
    (kpis.avgPassRate ?? 0) >= 90 && (kpis.avgCoverage ?? 0) >= 80 && kpis.totalFailing === 0
      ? 'Overall, the QA portfolio is in a healthy state.'
      : kpis.totalFailing > 0 || (kpis.avgPassRate ?? 100) < 70
      ? 'The engineering team should prioritise resolving failing cases before the next release cycle.'
      : 'The portfolio is performing adequately. Continued focus on expanding test coverage is recommended.';

  parts.push(recommendation);
  return parts.join(' ');
}

export async function exportAdminReportPdf(
  data:     AdminReportData,
  override: { executiveSummary?: string } = {},
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PAGE_W = 210;
  const MARGIN = 16;
  const COL_W  = PAGE_W - MARGIN * 2;
  let y        = MARGIN;

  const primary = [29,  78, 216] as [number, number, number];
  const gray900 = [17,  24,  39] as [number, number, number];
  const gray600 = [75,  85, 99]  as [number, number, number];
  const gray500 = [107, 114, 128] as [number, number, number];
  const gray400 = [156, 163, 175] as [number, number, number];
  const gray200 = [229, 231, 235] as [number, number, number];
  const gray100 = [243, 244, 246] as [number, number, number];
  const green   = [22,  163,  74] as [number, number, number];
  const red     = [220,  38,  38] as [number, number, number];
  const amber   = [217, 119,   6] as [number, number, number];

  function hr(color: [number, number, number] = gray200) {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 4;
  }

  function checkPage(needed = 10) {
    if (y + needed > 277) { doc.addPage(); y = MARGIN; }
  }

  // ── 1. Header banner ──────────────────────────────────────────
  doc.setFillColor(...primary);
  doc.rect(0, 0, PAGE_W, 33, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text('QAForge  ·  System Overview Report', MARGIN, 10);
  doc.text(
    new Date(data.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    PAGE_W - MARGIN, 10, { align: 'right' },
  );

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(`Coverage Report  ·  ${data.period}`, MARGIN, 24);

  y = 41;

  // ── 2. System stat boxes ──────────────────────────────────────
  const sysStats = [
    { label: 'Projects',     value: String(data.stats.totalProjects)  },
    { label: 'Active users', value: String(data.stats.activatedUsers) },
    { label: 'Test cases',   value: data.stats.totalCases.toLocaleString() },
    { label: 'Open runs',    value: String(data.stats.openRuns),   color: data.stats.openRuns   > 0 ? amber : gray400 },
    { label: 'Open defects', value: String(data.stats.openDefects), color: data.stats.openDefects > 0 ? red  : gray400 },
  ];

  const statW = COL_W / sysStats.length;
  sysStats.forEach((s, i) => {
    const sx = MARGIN + i * statW + statW / 2;
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(s.color ?? gray900));
    doc.text(s.value, sx, y + 6, { align: 'center' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray500);
    doc.text(s.label, sx, y + 11, { align: 'center' });
  });
  y += 18;
  hr();

  // ── 3. KPI boxes ──────────────────────────────────────────────
  const kpiItems = [
    { label: 'Avg pass rate',      value: data.kpis.avgPassRate  !== null ? `${data.kpis.avgPassRate}%`  : '—', color: data.kpis.avgPassRate  !== null ? (data.kpis.avgPassRate  >= 90 ? green : data.kpis.avgPassRate  >= 70 ? amber : red) : gray400 },
    { label: 'Avg exec. coverage', value: data.kpis.avgCoverage  !== null ? `${data.kpis.avgCoverage}%` : '—', color: data.kpis.avgCoverage  !== null ? (data.kpis.avgCoverage  >= 80 ? green : data.kpis.avgCoverage  >= 60 ? amber : red) : gray400 },
    { label: 'Failing cases',      value: String(data.kpis.totalFailing), color: data.kpis.totalFailing > 0 ? red   : green },
    { label: 'Flaky tests',        value: String(data.kpis.totalFlaky),   color: data.kpis.totalFlaky   > 0 ? amber : green },
    { label: 'Stale cases',        value: String(data.kpis.totalStale),   color: data.kpis.totalStale   > 0 ? amber : gray400 },
  ];

  kpiItems.forEach((k, i) => {
    const sx = MARGIN + i * statW + statW / 2;
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...k.color);
    doc.text(k.value, sx, y + 6, { align: 'center' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray500);
    doc.text(k.label, sx, y + 11, { align: 'center' });
  });
  y += 18;
  hr();

  // ── 4. Executive Summary ──────────────────────────────────────
  checkPage(20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray900);
  doc.text('Executive Summary', MARGIN, y);
  y += 5;

  const execText  = override.executiveSummary ?? buildAdminExecutiveSummary(data);
  const execLines = doc.splitTextToSize(execText, COL_W);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(55, 65, 81);
  doc.text(execLines, MARGIN, y);
  y += execLines.length * 4.6 + 5;
  hr();

  // ── 5. Projects table ─────────────────────────────────────────
  checkPage(20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray900);
  doc.text('Projects', MARGIN, y);
  y += 6;

  // Column widths (total = COL_W = 178)
  const cName  = 58;
  const cCases = 18;
  const cPass  = 22;
  const cCover = 26;
  const cFlaky = 16;

  doc.setFillColor(...gray100);
  doc.rect(MARGIN, y - 3, COL_W, 7, 'F');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray500);
  let tx = MARGIN + 2;
  doc.text('Project',        tx, y + 1);  tx += cName;
  doc.text('Cases',          tx, y + 1);  tx += cCases;
  doc.text('Pass rate',      tx, y + 1);  tx += cPass;
  doc.text('Exec. coverage', tx, y + 1);  tx += cCover;
  doc.text('Flaky',          tx, y + 1);  tx += cFlaky;
  doc.text('Latest run',     tx, y + 1);
  y += 8;

  doc.setFont('helvetica', 'normal');

  data.projects.forEach((p, i) => {
    checkPage(8);

    if (i % 2 === 0) {
      doc.setFillColor(249, 250, 251);
      doc.rect(MARGIN, y - 3, COL_W, 7, 'F');
    }

    const passColor   = p.passRate    === null ? gray400 : p.passRate    >= 90 ? green : p.passRate    >= 70 ? amber : red;
    const coverColor  = p.coveragePct === null ? gray400 : p.coveragePct >= 80 ? green : p.coveragePct >= 60 ? amber : red;
    const truncName   = p.name.length > 30 ? p.name.slice(0, 28) + '…' : p.name;

    doc.setFontSize(7.5);
    tx = MARGIN + 2;

    doc.setTextColor(...gray900);
    doc.setFont('helvetica', 'bold');
    doc.text(truncName, tx, y + 1);
    tx += cName;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray600);
    doc.text(String(p.cases), tx, y + 1);
    tx += cCases;

    doc.setTextColor(...passColor);
    doc.text(p.passRate !== null ? `${p.passRate}%` : '—', tx, y + 1);
    tx += cPass;

    doc.setTextColor(...coverColor);
    doc.text(p.coveragePct !== null ? `${p.coveragePct}%` : '—', tx, y + 1);
    tx += cCover;

    doc.setTextColor(p.flakyCount > 0 ? amber[0] : gray400[0], p.flakyCount > 0 ? amber[1] : gray400[1], p.flakyCount > 0 ? amber[2] : gray400[2]);
    doc.text(p.flakyCount > 0 ? String(p.flakyCount) : '—', tx, y + 1);
    tx += cFlaky;

    doc.setTextColor(...gray500);
    if (p.latestRun) {
      const ago = (() => {
        const diff  = Date.now() - new Date(p.latestRun!.startedAt).getTime();
        const days  = Math.floor(diff / 86_400_000);
        const hours = Math.floor(diff / 3_600_000);
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
      })();
      doc.text(`${p.latestRun.status.charAt(0).toUpperCase() + p.latestRun.status.slice(1)}  ${ago}  ${p.latestRun.env}`, tx, y + 1);
    } else {
      doc.text('No runs yet', tx, y + 1);
    }

    y += 7;

    // Sub-row: failing / stale note
    if (p.coverageStats.failing > 0 || p.coverageStats.stale > 0) {
      checkPage(5);
      doc.setFontSize(6.5);
      const notes: string[] = [];
      if (p.coverageStats.failing > 0) notes.push(`${p.coverageStats.failing} failing`);
      if (p.coverageStats.stale   > 0) notes.push(`${p.coverageStats.stale} stale`);
      doc.setTextColor(...amber);
      doc.text('  ↳ ' + notes.join('  ·  '), MARGIN + 2, y + 1);
      y += 5;
    }
  });

  // ── Footer ────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(...gray500);
    doc.text(
      `Generated by QAForge  ·  Page ${p} of ${pageCount}`,
      PAGE_W / 2, 290, { align: 'center' },
    );
  }

  const safe = data.period.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  doc.save(`qaforge-report-${safe}.pdf`);
}

// ── Sprint Summary PDF ────────────────────────────────────────────────────────

export interface SprintSummaryData {
  name: string;
  milestone: string | null;
  stories: Array<{
    label: string;
    url: string | null;
    storyStatus: string;
    cases: Array<{ id?: string; seqId?: number; title: string; status: string; failureNote: string | null; errorMessage: string | null }>;
  }>;
  unlinked: Array<{ id?: string; seqId?: number; title: string; status: string; failureNote: string | null; errorMessage: string | null }>;
  overall: { total: number; pass: number; fail: number; blocked: number; skipped: number; passRate: number | null };
}

export async function exportSprintSummaryPdf(plan: SprintSummaryData): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PAGE_W = 210;
  const MARGIN = 16;
  const COL_W  = PAGE_W - MARGIN * 2;
  let y        = MARGIN;

  const primary = [29,  78, 216] as [number, number, number];
  const gray900 = [17,  24,  39] as [number, number, number];
  const gray700 = [55,  65,  81] as [number, number, number];
  const gray500 = [107, 114, 128] as [number, number, number];
  const gray400 = [156, 163, 175] as [number, number, number];
  const gray200 = [229, 231, 235] as [number, number, number];
  const green   = [22,  163,  74] as [number, number, number];
  const red     = [220,  38,  38] as [number, number, number];
  const amber   = [217, 119,   6] as [number, number, number];

  function hrLine() {
    doc.setDrawColor(...gray200);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 4;
  }

  function checkPage(needed = 10) {
    if (y + needed > 277) { doc.addPage(); y = MARGIN; }
  }

  function statusColor(s: string): [number, number, number] {
    if (s === 'pass')    return green;
    if (s === 'fail')    return red;
    if (s === 'blocked') return amber;
    return gray400;
  }

  // ── Header ────────────────────────────────────────────────────
  doc.setFillColor(...primary);
  doc.rect(0, 0, PAGE_W, 33, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text('QAForge  ·  Sprint Summary Report', MARGIN, 10);
  doc.text(
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    PAGE_W - MARGIN, 10, { align: 'right' }
  );
  const planLabel = plan.name.length > 52 ? plan.name.slice(0, 50) + '…' : plan.name;
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(planLabel, MARGIN, 24);
  if (plan.milestone) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Milestone: ${plan.milestone}`, PAGE_W - MARGIN, 24, { align: 'right' });
  }
  y = 41;

  // ── Overall stats ─────────────────────────────────────────────
  const { overall } = plan;
  const passRate = overall.passRate ?? 0;
  const statItems = [
    { label: 'Pass rate', value: overall.passRate !== null ? `${passRate}%` : '—', color: passRate >= 80 ? green : passRate >= 50 ? amber : red },
    { label: 'Passed',   value: String(overall.pass),    color: green },
    { label: 'Failed',   value: String(overall.fail),    color: overall.fail    > 0 ? red   : gray400 },
    { label: 'Blocked',  value: String(overall.blocked), color: overall.blocked > 0 ? amber : gray400 },
    { label: 'Skipped',  value: String(overall.skipped), color: gray400 },
    { label: 'Total',    value: String(overall.total),   color: gray900 },
  ];
  const statW = COL_W / statItems.length;
  statItems.forEach((s, i) => {
    const sx = MARGIN + i * statW + statW / 2;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...s.color);
    doc.text(s.value, sx, y + 7, { align: 'center' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray500);
    doc.text(s.label, sx, y + 12.5, { align: 'center' });
  });
  y += 22;
  hrLine();

  // ── Story breakdown ───────────────────────────────────────────
  if (plan.stories.length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...gray700);
    doc.text('Story breakdown', MARGIN, y);
    y += 7;

    for (const story of plan.stories) {
      checkPage(14);
      const pass    = story.cases.filter(c => c.status === 'pass').length;
      const total   = story.cases.length;
      const sc      = statusColor(story.storyStatus);
      const icon    = story.storyStatus === 'pass' ? '✓' : story.storyStatus === 'fail' ? '✗' : story.storyStatus === 'blocked' ? '⊘' : '◑';

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...sc);
      doc.text(icon, MARGIN, y);
      doc.setTextColor(...gray900);
      const storyLabel = story.label.length > 70 ? story.label.slice(0, 68) + '…' : story.label;
      doc.text(storyLabel, MARGIN + 6, y);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...gray500);
      doc.text(`${pass}/${total} passed`, PAGE_W - MARGIN, y, { align: 'right' });
      y += 5;

      for (const c of story.cases) {
        checkPage(6);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...statusColor(c.status));
        doc.text(c.status.padEnd(8), MARGIN + 6, y);
        doc.setTextColor(...gray400);
        const shortId = c.seqId != null ? fmtSeqId(c.seqId) : '';
        if (shortId) doc.text(shortId, MARGIN + 22, y);
        doc.setTextColor(...gray700);
        const titleX  = MARGIN + (shortId ? 40 : 22);
        const titleMax = PAGE_W - MARGIN - titleX - 2;
        doc.text(fitText(doc, c.title, titleMax), titleX, y);
        y += 5;
        const note = c.failureNote || c.errorMessage;
        if (note && c.status !== 'pass') {
          checkPage(5);
          doc.setFontSize(6.5);
          doc.setTextColor(...gray400);
          const truncNote = note.length > 100 ? note.slice(0, 98) + '…' : note;
          doc.text('↳ ' + truncNote, MARGIN + 22, y);
          y += 4;
        }
      }
      y += 2;
    }
    hrLine();
  }

  // ── Unlinked cases ────────────────────────────────────────────
  if (plan.unlinked.length > 0) {
    checkPage(12);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...gray700);
    doc.text('Unlinked cases', MARGIN, y);
    y += 7;

    for (const c of plan.unlinked) {
      checkPage(6);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...statusColor(c.status));
      doc.text(c.status.padEnd(8), MARGIN, y);
      doc.setTextColor(...gray400);
      const shortId = c.seqId != null ? fmtSeqId(c.seqId) : '';
      if (shortId) doc.text(shortId, MARGIN + 16, y);
      doc.setTextColor(...gray700);
      const titleX  = MARGIN + (shortId ? 34 : 16);
      const titleMax = PAGE_W - MARGIN - titleX - 2;
      doc.text(fitText(doc, c.title, titleMax), titleX, y);
      y += 5;
    }
    hrLine();
  }

  // ── Blockers & reasons ────────────────────────────────────────
  const blockers = [...plan.stories.flatMap(s => s.cases), ...plan.unlinked]
    .filter(c => c.status === 'blocked' || c.status === 'skipped');

  if (blockers.length > 0) {
    checkPage(12);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...gray700);
    doc.text('Blockers & reasons', MARGIN, y);
    y += 7;

    for (const c of blockers) {
      checkPage(8);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...statusColor(c.status));
      doc.text(c.status, MARGIN, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...gray700);
      const title = c.title.length > 55 ? c.title.slice(0, 53) + '…' : c.title;
      doc.text(title, MARGIN + 14, y);
      y += 5;
      const note = c.failureNote;
      if (note) {
        checkPage(5);
        doc.setFontSize(7);
        doc.setTextColor(...gray500);
        const truncNote = note.length > 100 ? note.slice(0, 98) + '…' : note;
        doc.text('↳ ' + truncNote, MARGIN + 14, y);
        y += 4;
      } else {
        checkPage(5);
        doc.setFontSize(7);
        doc.setTextColor(...gray400);
        doc.text('↳ no reason recorded', MARGIN + 14, y);
        y += 4;
      }
    }
  }

  // ── Footer ────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(...gray500);
    doc.text(`Generated by QAForge  ·  Page ${p} of ${pageCount}`, PAGE_W / 2, 290, { align: 'center' });
  }

  doc.save(`${plan.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-sprint-summary.pdf`);
}

// ── Helpers ───────────────────────────────────────────────────

// Truncate text to fit within maxWidth mm using actual glyph measurements.
// Must be called after setFontSize/setFont so measurements are accurate.
function fitText(doc: { getTextWidth: (t: string) => number }, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && doc.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtSeqId(seqId: number): string {
  return `TC-${String(seqId).padStart(4, '0')}`;
}
