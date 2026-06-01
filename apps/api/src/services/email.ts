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
