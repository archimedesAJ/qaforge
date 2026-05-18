// ── CSV Export ────────────────────────────────────────────────

interface RunResultRow {
  id:              number;
  status:          string;
  durationMs?:     number;
  errorMessage?:   string;
  failureNote?:    string;
  executedAt:      string;
  testCase?:       { title: string; type: string; priority: string } | null;
}

interface RunMeta {
  name:      string;
  env:       string;
  source:    string;
  startedAt: string;
  endedAt?:  string;
}

export function exportResultsCsv(run: RunMeta, results: RunResultRow[]): void {
  const headers = [
    'Test case',
    'Type',
    'Priority',
    'Status',
    'Duration (ms)',
    'Error message',
    'Failure note',
    'Executed at',
  ];

  const rows = results.map(r => [
    r.testCase?.title     ?? `Result #${r.id}`,
    r.testCase?.type      ?? '',
    r.testCase?.priority  ?? '',
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
        // Escape cells that contain commas, quotes, or newlines
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
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
  // Dynamic import — keeps bundle size down for users who never export
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PAGE_W   = 210;
  const MARGIN   = 16;
  const COL_W    = PAGE_W - MARGIN * 2;
  let y          = MARGIN;

  const primary  = [29,  78, 216] as [number, number, number];
  const gray900  = [17,  24,  39] as [number, number, number];
  const gray500  = [107, 114, 128] as [number, number, number];
  const gray200  = [229, 231, 235] as [number, number, number];
  const green    = [22, 163,  74] as [number, number, number];
  const red      = [220,  38,  38] as [number, number, number];
  const amber    = [217, 119,   6] as [number, number, number];

  function line(color = gray200) {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 4;
  }

  function checkPage(needed = 10) {
    if (y + needed > 277) {
      doc.addPage();
      y = MARGIN;
    }
  }

  // ── Header ────────────────────────────────────────────────
  doc.setFillColor(...primary);
  doc.rect(0, 0, PAGE_W, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('QAForge', MARGIN, 11);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Test Run Report', MARGIN, 18);
  doc.text(
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    PAGE_W - MARGIN, 18, { align: 'right' }
  );

  y = 34;

  // ── Run title ─────────────────────────────────────────────
  doc.setTextColor(...gray900);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(run.name, MARGIN, y);
  y += 6;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...gray500);
  doc.text(
    `${run.env}  ·  ${run.source}  ·  Started ${new Date(run.startedAt).toLocaleString('en-GB')}`,
    MARGIN, y
  );
  y += 8;

  line();

  // ── Summary stats ─────────────────────────────────────────
  const statW  = COL_W / 4;
  const stats  = [
    { label: 'Pass rate', value: `${summary.passRate}%`, color: summary.passRate >= 90 ? green : summary.passRate >= 70 ? amber : red },
    { label: 'Passed',    value: String(summary.passed),  color: green  },
    { label: 'Failed',    value: String(summary.failed),  color: summary.failed > 0 ? red : gray500 },
    { label: 'Total',     value: String(summary.total),   color: gray900 },
  ];

  stats.forEach((s, i) => {
    const x = MARGIN + i * statW + statW / 2;
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...s.color);
    doc.text(s.value, x, y + 8, { align: 'center' });
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...gray500);
    doc.text(s.label, x, y + 13, { align: 'center' });
  });

  y += 20;
  line();

  // ── Results table ─────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray900);
  doc.text('Test results', MARGIN, y);
  y += 6;

  // Table header
  const cols = { title: 80, type: 22, priority: 18, status: 20, duration: 22, rest: COL_W - 162 };
  doc.setFillColor(243, 244, 246);
  doc.rect(MARGIN, y - 3, COL_W, 7, 'F');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...gray500);
  let x = MARGIN + 2;
  doc.text('Test case',   x, y + 1); x += cols.title;
  doc.text('Type',        x, y + 1); x += cols.type;
  doc.text('Priority',    x, y + 1); x += cols.priority;
  doc.text('Status',      x, y + 1); x += cols.status;
  doc.text('Duration',    x, y + 1);
  y += 8;

  // Table rows
  doc.setFont('helvetica', 'normal');
  results.forEach((r, i) => {
    checkPage(8);

    if (i % 2 === 0) {
      doc.setFillColor(249, 250, 251);
      doc.rect(MARGIN, y - 3, COL_W, 7, 'F');
    }

    const statusColor = r.status === 'pass' ? green : r.status === 'fail' ? red : amber;
    const title = r.testCase?.title ?? `Result #${r.id}`;
    const truncTitle = title.length > 40 ? title.slice(0, 38) + '…' : title;

    doc.setFontSize(7.5);
    doc.setTextColor(...gray900);
    x = MARGIN + 2;
    doc.text(truncTitle,                    x, y + 1); x += cols.title;
    doc.text(r.testCase?.type ?? '',        x, y + 1); x += cols.type;
    doc.text((r.testCase?.priority ?? '').toUpperCase(), x, y + 1); x += cols.priority;

    doc.setTextColor(...statusColor);
    doc.text(r.status.charAt(0).toUpperCase() + r.status.slice(1), x, y + 1); x += cols.status;

    doc.setTextColor(...gray500);
    doc.text(r.durationMs != null ? fmtDuration(r.durationMs) : '—', x, y + 1);

    // Error message on next line if failed
    if (r.errorMessage && r.status === 'fail') {
      y += 6;
      checkPage(6);
      doc.setFontSize(6.5);
      doc.setTextColor(...red);
      const errMsg = r.errorMessage.length > 90 ? r.errorMessage.slice(0, 88) + '…' : r.errorMessage;
      doc.text(errMsg, MARGIN + 4, y + 1);
    }

    y += 7;
  });

  // ── Footer on last page ───────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...gray500);
    doc.text(
      `Generated by QAForge  ·  Page ${i} of ${pageCount}`,
      PAGE_W / 2, 290, { align: 'center' }
    );
  }

  doc.save(`${slugify(run.name)}-report.pdf`);
}

// ── Helpers ───────────────────────────────────────────────────
function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
