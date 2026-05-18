import { XMLParser } from 'fast-xml-parser';

export interface JUnitTestCase {
  name: string;
  classname?: string;
  time?: number;         // seconds
  status: 'pass' | 'fail' | 'skipped' | 'error';
  errorMessage?: string;
  stackTrace?: string;
  systemOut?: string;
}

export interface JUnitSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time?: number;
  testCases: JUnitTestCase[];
}

export interface ParsedJUnit {
  suites: JUnitSuite[];
  totals: {
    tests: number;
    failures: number;
    errors: number;
    skipped: number;
    durationMs: number;
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  isArray: (name: string) =>
    ['testsuite', 'testcase', 'failure', 'error', 'skipped'].includes(name),
});

function normaliseTestCases(raw: unknown[]): JUnitTestCase[] {
  return raw.map((tc: unknown) => {
    const t = tc as Record<string, unknown>;
    const name      = String(t['@_name']      ?? t['@_classname'] ?? 'Unknown test');
    const classname = t['@_classname'] ? String(t['@_classname']) : undefined;
    const timeSec   = t['@_time'] ? Number(t['@_time']) : undefined;

    // Determine status
    const failures = (t['failure'] as unknown[] | undefined) ?? [];
    const errors   = (t['error']   as unknown[] | undefined) ?? [];
    const skipped  = (t['skipped'] as unknown[] | undefined) ?? [];

    let status: JUnitTestCase['status'] = 'pass';
    let errorMessage: string | undefined;
    let stackTrace: string | undefined;

    if (failures.length > 0) {
      status = 'fail';
      const f = failures[0] as Record<string, unknown>;
      errorMessage = String(f['@_message'] ?? f['#text'] ?? '').split('\n')[0].trim() || undefined;
      stackTrace   = String(f['#text'] ?? '').trim() || undefined;
    } else if (errors.length > 0) {
      status = 'error';
      const e = errors[0] as Record<string, unknown>;
      errorMessage = String(e['@_message'] ?? e['#text'] ?? '').split('\n')[0].trim() || undefined;
      stackTrace   = String(e['#text'] ?? '').trim() || undefined;
    } else if (skipped.length > 0) {
      status = 'skipped';
    }

    const systemOut = t['system-out']
      ? String(t['system-out']).trim() || undefined
      : undefined;

    return { name, classname, time: timeSec, status, errorMessage, stackTrace, systemOut };
  });
}

export function parseJUnitXml(xml: string): ParsedJUnit {
  const parsed = parser.parse(xml);

  const suites: JUnitSuite[] = [];

  // Handle both <testsuites> wrapper and bare <testsuite>
  const root = parsed['testsuites'] ?? parsed;

  const rawSuites: unknown[] = Array.isArray(root['testsuite'])
    ? root['testsuite']
    : root['testsuite']
    ? [root['testsuite']]
    : [];

  // If no testsuite found, try treating root itself as a suite
  if (rawSuites.length === 0 && parsed['testsuite']) {
    rawSuites.push(parsed['testsuite']);
  }

  for (const raw of rawSuites) {
    const s = raw as Record<string, unknown>;
    const rawCases: unknown[] = Array.isArray(s['testcase'])
      ? s['testcase']
      : s['testcase']
      ? [s['testcase']]
      : [];

    const testCases = normaliseTestCases(rawCases);

    suites.push({
      name:      String(s['@_name'] ?? 'Unnamed suite'),
      tests:     Number(s['@_tests']    ?? testCases.length),
      failures:  Number(s['@_failures'] ?? 0),
      errors:    Number(s['@_errors']   ?? 0),
      skipped:   Number(s['@_skipped']  ?? 0),
      time:      s['@_time'] ? Number(s['@_time']) : undefined,
      testCases,
    });
  }

  const totals = suites.reduce(
    (acc, s) => ({
      tests:      acc.tests    + s.testCases.length,
      failures:   acc.failures + s.failures,
      errors:     acc.errors   + s.errors,
      skipped:    acc.skipped  + s.skipped,
      durationMs: acc.durationMs + (s.time ? Math.round(s.time * 1000) : 0),
    }),
    { tests: 0, failures: 0, errors: 0, skipped: 0, durationMs: 0 }
  );

  return { suites, totals };
}
