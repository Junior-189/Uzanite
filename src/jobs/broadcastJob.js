// Broadcast fan-out job. Enqueues per-recipient outbound WhatsApp jobs and
// per-recipient email jobs so each has independent retries + DLQ handling.
const { enqueue } = require('../queue/queues');
const { sendEmail } = require('../services/emailService');
const { createNotification } = require('../services/notificationStore');
const logger = require('../config/logger');
const metrics = require('../lib/metrics');

async function broadcastJob({ businessId, channel, message, subject, contacts = [], emailContacts = [] }) {
  const fullMessage = `${message}\n\n_Reply STOP to opt out._`;
  let queued = 0;
  let failed = 0;

  if (channel === 'whatsapp' || channel === 'both') {
    for (const c of contacts) {
      try {
        const jid = c.jid || `${String(c.phone).replace(/\D/g, '')}@s.whatsapp.net`;
        await enqueue('whatsapp-outbound', 'text', { businessId, to: jid, text: fullMessage });
        queued++;
      } catch (err) {
        failed++;
        logger.error({ err: err.message, businessId }, 'Broadcast WA enqueue failed');
      }
    }
  }

  if (channel === 'email' || channel === 'both') {
    const emailSubject = (subject || 'Message from your merchant').toString().slice(0, 150);
    const html = `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6;">
  <p>${String(message).replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p>
  <p style="color:#9ca3af;font-size:12px;border-top:1px solid #eee;padding-top:8px;margin-top:16px;">
    You received this because you interacted with our business. Reply STOP to opt out of email.
  </p>
</div>`;
    for (const c of emailContacts) {
      try {
        await enqueue('email', 'send', { to: c.email, subject: emailSubject, html });
        queued++;
      } catch (err) {
        failed++;
        logger.error({ err: err.message, businessId }, 'Broadcast email enqueue failed');
      }
    }
  }

  createNotification({
    businessId,
    type: 'broadcast_sent',
    title: 'Broadcast Queued',
    message: `Broadcast (${channel}) queued for ${queued} recipient(s)${failed ? ` (${failed} failed to queue)` : ''}`,
    data: { queued, failed, channel },
  });

  metrics.inc('uzanite_broadcasts_queued_total', { channel }, queued);
  return { queued, failed };
}

module.exports = { broadcast: { send: broadcastJob } };
