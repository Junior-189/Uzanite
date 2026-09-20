const nodemailer = require('nodemailer');

let transporter = null;
let warned = false;

function getTransporter() {
  const { EMAIL_USER, EMAIL_PASS, EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS) {
    if (!warned) {
      console.warn(
        '[emailService] EMAIL_USER / EMAIL_PASS not set — email sending is DISABLED (no-op). Set them in .env to enable.'
      );
      warned = true;
    }
    return null;
  }
  if (!transporter) {
    const port = EMAIL_PORT ? parseInt(EMAIL_PORT, 10) : 587;
    // SSL is only used on port 465; 587 (and 25) use STARTTLS. Some hosts
    // block outbound 465, so default to 587 + STARTTLS for reliability.
    const secure = port === 465;
    transporter = nodemailer.createTransport({
      host: EMAIL_HOST || 'smtp.gmail.com',
      port,
      secure,
      requireTLS: !secure,
      family: 4,
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    });
  }
  return transporter;
}

function stripHtml(html = '') {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function wrapEmail(html, { preheader = '' } = {}) {
  const appName = process.env.APP_NAME || 'UZANITE';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${appName}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="text-align:center;padding:16px 0;">
      <span style="display:inline-block;font-size:22px;font-weight:700;color:#16a34a;">${appName}</span>
    </div>
    <div style="background:#ffffff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      ${html}
    </div>
    <div style="text-align:center;padding:16px;font-size:12px;color:#9ca3af;">
      ${appName} &middot; Automated message &middot; Please do not reply to this email.
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail({ to, subject, html, text, attachments }) {
  const t = getTransporter();
  if (!t || !to) return { sent: false, reason: 'disabled' };
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  try {
    const info = await t.sendMail({
      from,
      to,
      subject,
      html: wrapEmail(html),
      text: text || stripHtml(html),
      attachments,
    });
    return { sent: true, id: info.messageId };
  } catch (err) {
    console.error('[emailService] send failed:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { sendEmail, wrapEmail };
