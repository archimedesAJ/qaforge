import * as XLSX from 'xlsx';

interface ExportCase {
  title: string;
  type: string;
  preconditions?: string | null;
  steps?: unknown;
}

const HEADERS = [
  'TEST CASE ID',
  'TEST CASE',
  'PRECONDITION',
  'STEPS',
  'TEST DATA',
  'EXPECTED RESULTS',
  'ACTUAL RESULTS',
  'STATUS',
];

function formatSteps(steps: unknown, type: string): string {
  if (!steps) return '';
  if (type === 'ui_auto') {
    const s = steps as Record<string, string>;
    return [
      s.framework  && `Framework: ${s.framework}`,
      s.scriptPath && `Script: ${s.scriptPath}`,
      s.testName   && `Test: ${s.testName}`,
    ].filter(Boolean).join('\n');
  }
  if (type === 'exploratory') {
    return (steps as Record<string, string>).charter ?? '';
  }
  if (Array.isArray(steps)) {
    return (steps as { order: number; action: string }[])
      .sort((a, b) => a.order - b.order)
      .map(s => `${s.order}. ${s.action}`)
      .join('\n');
  }
  return '';
}

function formatExpected(steps: unknown, type: string): string {
  if (!steps || type === 'exploratory') return '';
  if (type === 'ui_auto') {
    return (steps as Record<string, string>).description ?? '';
  }
  if (Array.isArray(steps)) {
    return (steps as { order: number; expected: string }[])
      .sort((a, b) => a.order - b.order)
      .map(s => `${s.order}. ${s.expected}`)
      .join('\n');
  }
  return '';
}

export function buildExcelBuffer(cases: ExportCase[], sheetName = 'Test Cases'): Buffer {
  const rows: string[][] = [HEADERS];

  cases.forEach((tc, i) => {
    rows.push([
      `TC${String(i + 1).padStart(3, '0')}`,
      tc.title,
      tc.preconditions ?? '',
      formatSteps(tc.steps, tc.type),
      '',                                   // TEST DATA — no direct equivalent
      formatExpected(tc.steps, tc.type),
      '',                                   // ACTUAL RESULTS — filled by QA
      '',                                   // STATUS — filled by QA
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws['!cols'] = [
    { wch: 14 }, // TEST CASE ID
    { wch: 42 }, // TEST CASE
    { wch: 36 }, // PRECONDITION
    { wch: 46 }, // STEPS
    { wch: 20 }, // TEST DATA
    { wch: 46 }, // EXPECTED RESULTS
    { wch: 26 }, // ACTUAL RESULTS
    { wch: 12 }, // STATUS
  ];

  // Wrap text in all cells
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) continue;
      ws[addr].s = { alignment: { wrapText: true, vertical: 'top' } };
    }
  }

  const wb = XLSX.utils.book_new();
  // Excel sheet names: max 31 chars, no special chars
  const safeName = sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safeName);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
