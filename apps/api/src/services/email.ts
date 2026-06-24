const TENANT_ID     = process.env.AZURE_TENANT_ID;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const FROM          = process.env.EMAIL_FROM ?? 'noreply@qaforge.dev';
const WEB_URL       = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

const isConfigured = !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET);

// ── Token cache (tokens last ~1 hour; refresh 60s before expiry) ──
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Azure token request failed: ${await res.text()}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

// Extract bare email from "Display Name <email@domain.com>" or plain address
function extractEmail(from: string): string {
  const match = from.match(/<(.+)>/);
  return match ? match[1].trim() : from.trim();
}

async function sendViaMsGraph(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const token      = await getAccessToken();
  const senderAddr = extractEmail(FROM);

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${senderAddr}/sendMail`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: opts.subject,
          body:    { contentType: 'HTML', content: opts.html },
          toRecipients: [{ emailAddress: { address: opts.to } }],
        },
        saveToSentItems: false,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Graph sendMail failed (${res.status}): ${await res.text()}`);
  }
}

// ── Public API ────────────────────────────────────────────────

export async function sendInviteEmail(opts: {
  to: string;
  inviterName: string;
  projectName: string;
  role: string;
  token: string;
}): Promise<void> {
  const link      = `${WEB_URL}/accept-invite?token=${opts.token}`;
  const roleLabel = opts.role.charAt(0).toUpperCase() + opts.role.slice(1);
  const subject   = `You've been invited to ${opts.projectName} on QAForge`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" border="0"
               style="background:#ffffff;border-radius:8px;padding:40px;max-width:560px;">
          <tr>
            <td style="font-size:22px;font-weight:bold;color:#111827;padding-bottom:16px;">
              You've been invited to QAForge
            </td>
          </tr>
          <tr>
            <td style="font-size:15px;color:#374151;line-height:1.6;padding-bottom:16px;">
              <strong>${opts.inviterName}</strong> has invited you to join
              <strong>${opts.projectName}</strong> as a <strong>${roleLabel}</strong>.
            </td>
          </tr>
          <tr>
            <td style="font-size:15px;color:#374151;padding-bottom:32px;">
              Click the button below to set your password and get started.
              This link expires in 7 days.
            </td>
          </tr>
          <tr>
            <td align="left" style="padding-bottom:32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#2563eb"
                      style="border-radius:6px;mso-padding-alt:0;">
                    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                      href="${link}" style="height:44px;width:160px;" arcsize="14%"
                      fillcolor="#2563eb" strokecolor="#2563eb">
                      <v:textbox inset="0,0,0,0"><center style="color:#ffffff;font-family:Arial;font-size:15px;font-weight:bold;">Accept invite</center></v:textbox>
                    </v:roundrect><![endif]-->
                    <!--[if !mso]><!-->
                    <a href="${link}"
                       style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;
                              font-weight:bold;text-decoration:none;border-radius:6px;">
                      Accept invite
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#6b7280;padding-bottom:8px;">
              Or copy this link into your browser:
            </td>
          </tr>
          <tr>
            <td style="font-size:12px;color:#2563eb;word-break:break-all;
                       background:#f3f4f6;padding:10px;border-radius:4px;">
              ${link}
            </td>
          </tr>
          <tr>
            <td style="font-size:12px;color:#9ca3af;padding-top:24px;">
              If you weren't expecting this invitation, you can ignore this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (isConfigured) {
    await sendViaMsGraph({ to: opts.to, subject, html });
  } else {
    console.log(`\n[invite] Azure AD not configured — share this link with ${opts.to}:\n${link}\n`);
  }
}

export async function sendWeeklyDigestEmail(opts: {
  to: string;
  userName: string;
  projectName: string;
  projectId: string;
  runsTotal: number;
  runsOpen: number;
  runsClosed: number;
  resultsPassed: number;
  resultsFailed: number;
  resultsBlocked: number;
  newCases: number;
  newDefects: number;
  resolvedDefects: number;
  openDefectsCount: number;
  userRole?: string;
}): Promise<void> {
  const projectLink = `${WEB_URL}/projects/${opts.projectId}`;
  const weekLabel   = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject     = `QAForge Digest — ${opts.projectName}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="background:#ffffff;border-radius:8px;max-width:600px;overflow:hidden;">

          <!-- Header bar -->
          <tr>
            <td style="background:#2563eb;padding:24px 32px;">
              <div style="font-size:13px;color:#bfdbfe;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">
                QAForge · Project Digest
              </div>
              <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">
                ${opts.projectName}
              </div>
              <div style="font-size:13px;color:#bfdbfe;margin-top:2px;">Week ending ${weekLabel}</div>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 32px 8px;">
              <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
                Hi ${opts.userName}, here's what happened in
                <strong>${opts.projectName}</strong> over the past 7 days.
              </p>
            </td>
          </tr>

          <!-- Runs section -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
                Test Runs
              </div>
              <div style="font-size:12px;color:#9ca3af;margin-bottom:12px;">
                How many runs were executed this period
              </div>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${statCard(opts.runsTotal,  'Runs this period', '#111827')}
                  ${statCard(opts.runsClosed, 'Completed',        '#2563eb')}
                  ${statCard(opts.runsOpen,   'Still open',       '#d97706')}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Test results section -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
                Execution Results
              </div>
              <div style="font-size:12px;color:#9ca3af;margin-bottom:12px;">
                Individual test case outcomes across all runs above — one case can run in multiple runs
              </div>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${statCard(opts.resultsPassed,  'Passed',  '#16a34a')}
                  ${statCard(opts.resultsFailed,  'Failed',  '#dc2626')}
                  ${statCard(opts.resultsBlocked, 'Blocked', '#d97706')}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Library + Defects section -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
                Test Library &amp; Defects
              </div>
              <div style="font-size:12px;color:#9ca3af;margin-bottom:12px;">
                Changes to the test case library and defect tracker this period
              </div>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${statCard(opts.newCases,        'Cases written',      '#2563eb')}
                  ${statCard(opts.newDefects,       'Defects filed',      '#dc2626')}
                  ${statCard(opts.resolvedDefects,  'Defects resolved',   '#16a34a')}
                  ${statCard(opts.openDefectsCount, 'Open defects total', '#6b7280')}
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="left" style="padding:28px 32px 32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#2563eb" style="border-radius:6px;">
                    <a href="${projectLink}"
                       style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;
                              font-weight:bold;text-decoration:none;border-radius:6px;">
                      Open ${opts.projectName} →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                You're receiving this because you're ${opts.userRole === 'manager' ? 'a manager' : 'an editor'} on
                <strong>${opts.projectName}</strong> in QAForge.
                Digests are sent every Monday and Friday.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (isConfigured) {
    await sendViaMsGraph({ to: opts.to, subject, html });
  } else {
    console.log(`[digest] Azure AD not configured — digest for ${opts.projectName} → ${opts.to} (skipped)`);
  }
}

export async function sendProjectAddedEmail(opts: {
  to: string;
  inviterName: string;
  projectName: string;
  role: string;
}): Promise<void> {
  const loginLink = `${WEB_URL}/login`;
  const roleLabel = opts.role.charAt(0).toUpperCase() + opts.role.slice(1);
  const subject   = `You've been added to ${opts.projectName} on QAForge`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" border="0"
               style="background:#ffffff;border-radius:8px;padding:40px;max-width:560px;">
          <tr>
            <td style="font-size:22px;font-weight:bold;color:#111827;padding-bottom:16px;">
              You've been added to a project
            </td>
          </tr>
          <tr>
            <td style="font-size:15px;color:#374151;line-height:1.6;padding-bottom:24px;">
              <strong>${opts.inviterName}</strong> has added you to
              <strong>${opts.projectName}</strong> on QAForge as a
              <strong>${roleLabel}</strong>.
            </td>
          </tr>
          <tr>
            <td style="font-size:15px;color:#374151;padding-bottom:32px;">
              Log in to your account to access the project.
            </td>
          </tr>
          <tr>
            <td align="left" style="padding-bottom:32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#2563eb"
                      style="border-radius:6px;mso-padding-alt:0;">
                    <a href="${loginLink}"
                       style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;
                              font-weight:bold;text-decoration:none;border-radius:6px;">
                      Go to QAForge
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="font-size:12px;color:#9ca3af;padding-top:8px;">
              If you weren't expecting this, you can ignore this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (isConfigured) {
    await sendViaMsGraph({ to: opts.to, subject, html });
  } else {
    console.log(`\n[project-added] Azure AD not configured — ${opts.to} was added to ${opts.projectName}\n`);
  }
}

// ── Shared email helpers ──────────────────────────────────────────────────────

function statCard(value: number, label: string, color: string): string {
  return `
    <td align="center" style="padding:0 8px;">
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;min-width:100px;">
        <div style="font-size:26px;font-weight:700;color:${color};line-height:1;">${value}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;white-space:nowrap;">${label}</div>
      </div>
    </td>`;
}

function trendBadge(delta: number | null): string {
  if (delta === null) return '<span style="font-size:13px;color:#9ca3af;">No comparison data</span>';
  if (delta > 0)  return `<span style="font-size:13px;color:#16a34a;font-weight:600;">&#8593; +${delta}% vs last week</span>`;
  if (delta < 0)  return `<span style="font-size:13px;color:#dc2626;font-weight:600;">&#8595; ${delta}% vs last week</span>`;
  return '<span style="font-size:13px;color:#9ca3af;">No change vs last week</span>';
}

function sprintRows(sprints: { name: string; daysLeft: number | null }[]): string {
  if (sprints.length === 0) {
    return '<tr><td style="padding:8px 0;font-size:13px;color:#9ca3af;font-style:italic;">No active sprints</td></tr>';
  }
  return sprints.map(s => {
    let statusText: string;
    let statusColor: string;
    if (s.daysLeft === null)   { statusText = 'No end date';                              statusColor = '#9ca3af'; }
    else if (s.daysLeft < 0)   { statusText = `${Math.abs(s.daysLeft)}d overdue`;         statusColor = '#dc2626'; }
    else if (s.daysLeft === 0) { statusText = 'Ends today';                               statusColor = '#d97706'; }
    else if (s.daysLeft <= 3)  { statusText = `${s.daysLeft}d left`;                      statusColor = '#d97706'; }
    else                       { statusText = `${s.daysLeft}d left`;                      statusColor = '#6b7280'; }
    return `
      <tr>
        <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:14px;color:#374151;font-weight:500;">${s.name}</span>
          <span style="display:inline-block;margin-left:10px;font-size:12px;font-weight:600;
                       color:${statusColor};background:${statusColor}18;padding:2px 8px;border-radius:10px;">
            ${statusText}
          </span>
        </td>
      </tr>`;
  }).join('');
}

function emailHeader(projectName: string, weekLabel: string): string {
  return `
    <tr>
      <td style="background:#2563eb;padding:24px 32px;">
        <div style="font-size:13px;color:#bfdbfe;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">
          QAForge · Project Digest
        </div>
        <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">${projectName}</div>
        <div style="font-size:13px;color:#bfdbfe;margin-top:2px;">Week ending ${weekLabel}</div>
      </td>
    </tr>`;
}

function emailFooter(role: string, projectName: string): string {
  const roleLabel = role === 'admin' ? 'an admin' : role === 'viewer' ? 'a viewer' : role === 'manager' ? 'a manager' : 'an editor';
  return `
    <tr>
      <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;">
        <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
          You're receiving this because you're ${roleLabel} on
          <strong>${projectName}</strong> in QAForge.
          Digests are sent every Monday and Friday.
        </p>
      </td>
    </tr>`;
}

function ctaButton(projectLink: string, projectName: string): string {
  return `
    <tr>
      <td align="left" style="padding:28px 32px 32px;">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" bgcolor="#2563eb" style="border-radius:6px;">
              <a href="${projectLink}"
                 style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;
                        font-weight:bold;text-decoration:none;border-radius:6px;">
                Open ${projectName} &#8594;
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

// ── Admin digest ──────────────────────────────────────────────────────────────

export async function sendAdminDigestEmail(opts: {
  to: string;
  userName: string;
  projectName: string;
  projectId: string;
  runsTotal: number;
  runsOpen: number;
  runsClosed: number;
  resultsPassed: number;
  resultsFailed: number;
  resultsBlocked: number;
  newCases: number;
  newDefects: number;
  resolvedDefects: number;
  openDefectsCount: number;
  passRate: number | null;
  passRateDelta: number | null;
  sprintInfo: { name: string; daysLeft: number | null }[];
}): Promise<void> {
  const projectLink   = `${WEB_URL}/projects/${opts.projectId}`;
  const weekLabel     = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject       = `QAForge Digest — ${opts.projectName}`;
  const passRateColor = opts.passRate === null ? '#9ca3af' : opts.passRate >= 80 ? '#16a34a' : opts.passRate >= 60 ? '#d97706' : '#dc2626';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="background:#ffffff;border-radius:8px;max-width:600px;overflow:hidden;">

          ${emailHeader(opts.projectName, weekLabel)}

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 32px 8px;">
              <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
                Hi ${opts.userName}, here's the full project digest for
                <strong>${opts.projectName}</strong> — past 7 days.
              </p>
            </td>
          </tr>

          <!-- Pass Rate -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">
                Pass Rate
              </div>
              <div style="display:inline-block;">
                <div style="font-size:48px;font-weight:800;color:${passRateColor};line-height:1;">
                  ${opts.passRate !== null ? `${opts.passRate}%` : '&mdash;'}
                </div>
                <div style="margin-top:6px;">${trendBadge(opts.passRateDelta)}</div>
              </div>
            </td>
          </tr>

          <!-- Sprint Health -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">
                Sprint Health
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${sprintRows(opts.sprintInfo)}
              </table>
            </td>
          </tr>

          <!-- Test Runs -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
                Test Runs
              </div>
              <div style="font-size:12px;color:#9ca3af;margin-bottom:12px;">
                Runs executed this period
              </div>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${statCard(opts.runsTotal,  'Runs this period', '#111827')}
                  ${statCard(opts.runsClosed, 'Completed',        '#2563eb')}
                  ${statCard(opts.runsOpen,   'Still open',       '#d97706')}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Execution Results -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
                Execution Results
              </div>
              <div style="font-size:12px;color:#9ca3af;margin-bottom:12px;">
                Individual test case outcomes across all runs
              </div>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${statCard(opts.resultsPassed,  'Passed',  '#16a34a')}
                  ${statCard(opts.resultsFailed,  'Failed',  '#dc2626')}
                  ${statCard(opts.resultsBlocked, 'Blocked', '#d97706')}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Test Library & Defects -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">
                Test Library &amp; Defects
              </div>
              <div style="font-size:12px;color:#9ca3af;margin-bottom:12px;">
                Library changes and defect tracker this period
              </div>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${statCard(opts.newCases,        'Cases written',      '#2563eb')}
                  ${statCard(opts.newDefects,       'Defects filed',      '#dc2626')}
                  ${statCard(opts.resolvedDefects,  'Defects resolved',   '#16a34a')}
                  ${statCard(opts.openDefectsCount, 'Open defects total', '#6b7280')}
                </tr>
              </table>
            </td>
          </tr>

          ${ctaButton(projectLink, opts.projectName)}
          ${emailFooter('admin', opts.projectName)}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (isConfigured) {
    await sendViaMsGraph({ to: opts.to, subject, html });
  } else {
    console.log(`[digest] Azure AD not configured — admin digest for ${opts.projectName} → ${opts.to} (skipped)`);
  }
}

// ── Viewer digest ─────────────────────────────────────────────────────────────

export async function sendViewerDigestEmail(opts: {
  to: string;
  userName: string;
  projectName: string;
  projectId: string;
  runsTotal: number;
  resultsPassed: number;
  resultsFailed: number;
  resultsBlocked: number;
  openDefectsCount: number;
  resolvedDefects: number;
  passRate: number | null;
  passRateDelta: number | null;
  sprintInfo: { name: string; daysLeft: number | null }[];
}): Promise<void> {
  const projectLink   = `${WEB_URL}/projects/${opts.projectId}`;
  const weekLabel     = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject       = `QAForge — ${opts.projectName} quality snapshot`;
  const passRateColor = opts.passRate === null ? '#9ca3af' : opts.passRate >= 80 ? '#16a34a' : opts.passRate >= 60 ? '#d97706' : '#dc2626';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
               style="background:#ffffff;border-radius:8px;max-width:600px;overflow:hidden;">

          ${emailHeader(opts.projectName, weekLabel)}

          <!-- Greeting -->
          <tr>
            <td style="padding:28px 32px 8px;">
              <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
                Hi ${opts.userName}, here's the quality snapshot for
                <strong>${opts.projectName}</strong> this week.
              </p>
            </td>
          </tr>

          <!-- Quality Snapshot -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">
                Quality Snapshot
              </div>
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px 24px;display:inline-block;">
                <div style="font-size:52px;font-weight:800;color:${passRateColor};line-height:1;">
                  ${opts.passRate !== null ? `${opts.passRate}%` : '&mdash;'}
                </div>
                <div style="font-size:13px;color:#6b7280;margin-top:2px;">pass rate across ${opts.runsTotal} run${opts.runsTotal !== 1 ? 's' : ''}</div>
                <div style="margin-top:8px;">${trendBadge(opts.passRateDelta)}</div>
              </div>
            </td>
          </tr>

          <!-- Test Results -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">
                Test Results
              </div>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${statCard(opts.resultsPassed,  'Passed',  '#16a34a')}
                  ${statCard(opts.resultsFailed,  'Failed',  '#dc2626')}
                  ${statCard(opts.resultsBlocked, 'Blocked', '#d97706')}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sprint Status -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">
                Active Sprints
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${sprintRows(opts.sprintInfo)}
              </table>
            </td>
          </tr>

          <!-- Defects -->
          <tr>
            <td style="padding:20px 32px 4px;">
              <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">
                Defects
              </div>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${statCard(opts.openDefectsCount, 'Open defects', '#dc2626')}
                  ${statCard(opts.resolvedDefects,  'Resolved this week', '#16a34a')}
                </tr>
              </table>
            </td>
          </tr>

          ${ctaButton(projectLink, opts.projectName)}
          ${emailFooter('viewer', opts.projectName)}

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (isConfigured) {
    await sendViaMsGraph({ to: opts.to, subject, html });
  } else {
    console.log(`[digest] Azure AD not configured — viewer digest for ${opts.projectName} → ${opts.to} (skipped)`);
  }
}
