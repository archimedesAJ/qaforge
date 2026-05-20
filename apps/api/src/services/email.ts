import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM = process.env.EMAIL_FROM ?? 'QAForge <noreply@qaforge.dev>';
const WEB_URL = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

export async function sendInviteEmail(opts: {
  to: string;
  inviterName: string;
  projectName: string;
  role: string;
  token: string;
}): Promise<void> {
  const link = `${WEB_URL}/accept-invite?token=${opts.token}`;
  const roleLabel = opts.role.charAt(0).toUpperCase() + opts.role.slice(1);

  const subject = `You've been invited to ${opts.projectName} on QAForge`;
  const html = `
    <p>Hi,</p>
    <p><strong>${opts.inviterName}</strong> has invited you to join <strong>${opts.projectName}</strong>
    on QAForge as a <strong>${roleLabel}</strong>.</p>
    <p>Click the link below to set your password and get started. This link expires in 7 days.</p>
    <p><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Accept invite</a></p>
    <p>Or copy this URL into your browser:<br/><code>${link}</code></p>
    <p>If you weren't expecting this invitation, you can ignore this email.</p>
  `;

  if (resend) {
    await resend.emails.send({ from: FROM, to: opts.to, subject, html });
  } else {
    // No email provider configured — log so the admin can share the link manually
    console.log(`\n[invite] No RESEND_API_KEY set. Share this link with ${opts.to}:\n${link}\n`);
  }
}
