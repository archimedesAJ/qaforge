// ── CSV Export ────────────────────────────────────────────────

interface RunResultRow {
  id:          number;
  status:      string;
  durationMs?: number;
  errorMessage?: string;
  failureNote?:  string;
  executedAt:  string;
  testCase?:   { title: string; type: string; priority: string } | null;
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
  const headers = ['Test case', 'Type', 'Status', 'Duration (ms)', 'Error message', 'Failure note', 'Executed at'];

  const rows = results.map(r => [
    r.testCase?.title    ?? `Result #${r.id}`,
    r.testCase?.type     ?? '',
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
  summary: RunSummary
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

  const execText  = buildExecutiveSummary(run, summary);
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

  // Column widths — no Priority
  const colTitle  = COL_W - 78; // ~100 mm
  const colType   = 26;
  const colStatus = 26;

  doc.setFillColor(...gray100);
  doc.rect(MARGIN, y - 3, COL_W, 7, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray500);
  let tx = MARGIN + 2;
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
    const truncTitle  = title.length > 52 ? title.slice(0, 50) + '…' : title;

    doc.setFontSize(7.5);
    doc.setTextColor(...gray900);
    tx = MARGIN + 2;
    doc.text(truncTitle,                    tx, y + 1); tx += colTitle;
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

function buildExecutiveSummary(run: RunMeta, summary: RunSummary): string {
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

// ── Helpers ───────────────────────────────────────────────────

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
