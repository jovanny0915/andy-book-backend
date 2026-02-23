import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM || 'Victoriacross <onboarding@resend.dev>';

export const resend = apiKey ? new Resend(apiKey) : null;

const siteUrl = process.env.SITE_URL || 'http://localhost:3000';

const PETITION_NAMES = {
  'waterman-vc': 'Waterman Victoria Cross',
  'waterman-dso': 'Waterman DSO',
  hickey: 'Hickey Victoria Cross',
};

export async function sendPetitionVerification(email, name, petitionId, token) {
  if (!resend) {
    console.warn('Resend not configured; skipping email.');
    return { ok: false };
  }
  const verifyUrl = `${siteUrl}/verify-petition?token=${encodeURIComponent(token)}`;
  const petitionName = PETITION_NAMES[petitionId] || petitionId;
  const { error } = await resend.emails.send({
    from,
    to: email,
    subject: `Verify your petition vote – ${petitionName}`,
    html: `
      <p>Hello ${escapeHtml(name)},</p>
      <p>Please verify your email to confirm your vote on the ${escapeHtml(petitionName)} petition.</p>
      <p><a href="${verifyUrl}">Verify my vote</a></p>
      <p>If you did not request this, you can ignore this email.</p>
      <p>— Victoriacross.ca</p>
    `,
  });
  return { ok: !error, error };
}

export async function sendForumVerification(email, token) {
  if (!resend) {
    console.warn('Resend not configured; skipping email.');
    return { ok: false };
  }
  const verifyUrl = `${siteUrl}/verify-forum?token=${encodeURIComponent(token)}`;
  const { error } = await resend.emails.send({
    from,
    to: email,
    subject: 'Verify your email – Victoriacross.ca forum',
    html: `
      <p>Please verify your email to join the discussion forum.</p>
      <p><a href="${verifyUrl}">Verify my email</a></p>
      <p>If you did not register, you can ignore this email.</p>
      <p>— Victoriacross.ca</p>
    `,
  });
  return { ok: !error, error };
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
