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

  const html = `
    <p>Hi,</p>
    <p><strong>${opts.inviterName}</strong> has invited you to join
    <strong>${opts.projectName}</strong> on QAForge as a <strong>${roleLabel}</strong>.</p>
    <p>Click the button below to set your password and get started.
    This link expires in 7 days.</p>
    <p>
      <a href="${link}"
         style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;
                text-decoration:none;display:inline-block;">
        Accept invite
      </a>
    </p>
    <p>Or copy this URL into your browser:<br/><code>${link}</code></p>
    <p style="color:#6b7280;font-size:0.875rem;">
      If you weren't expecting this invitation, you can ignore this email.
    </p>
  `;

  if (isConfigured) {
    await sendViaMsGraph({ to: opts.to, subject, html });
  } else {
    console.log(`\n[invite] Azure AD not configured — share this link with ${opts.to}:\n${link}\n`);
  }
}
