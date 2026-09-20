const { sendEmail } = require('../services/emailService');

async function sendEmailJob({ to, subject, html, text, attachments }) {
  const result = await sendEmail({ to, subject, html, text, attachments });
  // A disabled transport returns { sent:false, reason:'disabled' } — treat as
  // success (no point retrying) rather than a failure.
  if (!result.sent && result.reason === 'disabled') return result;
  if (!result.sent) throw new Error(result.error || 'Email send failed');
  return result;
}

module.exports = { email: { send: sendEmailJob } };
