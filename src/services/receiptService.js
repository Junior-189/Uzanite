const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { pdf } = require('pdf-to-img');
const Business = require('../models/Business');
const { sendEmail } = require('./emailService');
const { escapeHtml } = require('../utils/escapeHtml');

const RECEIPTS_DIR = path.join(process.cwd(), 'public', 'receipts');

if (!fs.existsSync(RECEIPTS_DIR)) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

const getBusinessName = async (businessId) => {
  try {
    const biz = await Business.findOne({ businessId }).lean();
    return biz?.name || 'Our Shop';
  } catch { return 'Our Shop'; }
};

const generateReceiptPDF = async (order) => {
  const fileName = `receipt_${order.orderNumber || order._id}.pdf`;
  const filePath = path.join(RECEIPTS_DIR, fileName);
  const businessName = await getBusinessName(order.businessId || 'default');

  const BLACK = '#111111';
  const INK = '#1a1a1a';
  const MUTED = '#666666';
  const DASH = '#bcbcbc';

  const qrPhone = (order.customerPhone || '').replace('@s.whatsapp.net', '').replace('@lid', '');
  // Plain-text receipt details only — no URL, no EFD/verification. Scanning shows these details directly.
  const qrLines = [
    businessName,
    'SALES RECEIPT',
    `No: ${order.orderNumber || order._id}`,
    `Date: ${new Date(order.createdAt).toLocaleString('en-GB')}`,
    `Status: ${order.status}`,
    `Customer: ${order.customerName || 'Walk-in'}${qrPhone ? ' (' + qrPhone + ')' : ''}`,
    'Items:',
    ...(order.items || []).map((i) => `  ${i.productName} x${i.quantity} = ${order.currency || 'TZS'} ${Number(i.subtotal || 0).toLocaleString()}`),
    `TOTAL: ${order.currency || 'TZS'} ${Number(order.total || 0).toLocaleString()}`,
    `Paid via: ${order.paymentMethod || '-'}`,
  ];
  const qrText = qrLines.join('\n');
  const qrBuffer = await QRCode.toBuffer(qrText, {
    type: 'png',
    margin: 2,
    width: 320,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });

  const W = 250;
  const L = 16, R = 234;
  const rowH = 20;
  const qrSize = 90;
  const qrH = 130;
  const rows = Math.max(1, (order.items || []).length);
  const H = 360 + (rows - 1) * rowH + 30 + qrH;

  const doc = new PDFDocument({ size: [W, H], margin: 0 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.rect(0, 0, W, H).fill('#e6e6e6');

  const tornPath = (yTop, yBot, amp = 4, seg = 16) => {
    const step = W / seg;
    doc.moveTo(0, yTop);
    for (let i = 0; i <= seg; i++) doc.lineTo(i * step, yTop + (i % 2 === 0 ? 0 : amp));
    doc.lineTo(W, yBot);
    for (let i = seg; i >= 0; i--) doc.lineTo(i * step, yBot - (i % 2 === 0 ? 0 : amp));
    doc.lineTo(0, yTop);
  };

  const paperTop = 8, paperBot = H - 8;

  tornPath(paperTop, paperBot);
  doc.save();
  doc.clip();
  doc.rect(0, 0, W, H).fill('#ffffff');
  const g = doc.linearGradient(0, 0, 0, H);
  g.stop(0, '#ffffff').stop(1, '#f5f5f5');
  doc.rect(0, 0, W, H).fill(g);
  doc.opacity(0.05);
  for (let i = 0; i < 130; i++) {
    doc.circle(Math.random() * W, paperTop + Math.random() * (paperBot - paperTop), 0.7).fill('#000000');
  }
  doc.opacity(1);
  doc.restore();

  tornPath(paperTop, paperBot);
  doc.lineWidth(0.5).strokeColor('#cccccc').stroke();

  const dashed = (y) => {
    doc.save().dash(3, { space: 3 }).lineWidth(0.8).strokeColor(DASH)
      .moveTo(L, y).lineTo(R, y).stroke().undash().restore();
  };

  let y = paperTop + 18;

  doc.rect(14, y, W - 28, 58).fill(BLACK);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15);
  doc.text(businessName, 14, y + 12, { width: W - 28, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fillColor('#e8e8e8');
  doc.text('SALES RECEIPT', 14, y + 38, { width: W - 28, align: 'center', characterSpacing: 3 });
  y += 58 + 10;

  const cw = (R - L) / 3;
  const info = [
    { label: 'RECEIPT NO', value: order.orderNumber || order._id.toString().slice(-6).toUpperCase() },
    { label: 'DATE', value: new Date(order.createdAt).toLocaleDateString('en-GB') },
    { label: 'STATUS', value: order.status, color: BLACK },
  ];
  info.forEach((it, i) => {
    const x = L + cw * i;
    doc.fontSize(6).font('Helvetica').fillColor(MUTED).text(it.label, x, y, { width: cw, align: 'center', characterSpacing: 1 });
    doc.fontSize(10).font('Helvetica-Bold').fillColor(it.color).text(it.value, x, y + 11, { width: cw, align: 'center' });
  });
  y += 36;
  dashed(y); y += 10;

  doc.fontSize(7).font('Helvetica-Bold').fillColor(MUTED).text('CUSTOMER', L, y);
  const phone = (order.customerPhone || '').replace('@s.whatsapp.net', '').replace('@lid', '');
  doc.font('Helvetica').fillColor(INK).fontSize(9.5);
  doc.text(`${order.customerName || '—'}${phone ? '  |  ' + phone : ''}`, L, y + 13, { width: R - L });
  if (order.deliveryLocation) {
    doc.fontSize(8).fillColor(MUTED).text(`Delivery: ${order.deliveryLocation}`, L, y + 25, { width: R - L });
    y += 42;
  } else {
    y += 34;
  }
  dashed(y); y += 10;

  doc.fontSize(7).font('Helvetica-Bold').fillColor(BLACK);
  doc.text('ITEM', L, y, { width: 112, align: 'left' });
  doc.text('QTY', 130, y, { width: 28, align: 'center' });
  doc.text('PRICE', 158, y, { width: 38, align: 'center' });
  doc.text('TOTAL', 196, y, { width: 38, align: 'right' });
  y += 16;
  dashed(y); y += 6;

  doc.font('Helvetica').fillColor(INK).fontSize(8.5);
  (order.items || []).forEach((item, idx) => {
    const yy = y;
    if (idx % 2 === 1) doc.rect(L, yy - 2, R - L, rowH).fill('#f0f0f0');
    doc.fillColor(INK).text((item.productName || '').substring(0, 26), L, yy, { width: 112, align: 'left' });
    doc.text(String(item.quantity || 1), 130, yy, { width: 28, align: 'center' });
    doc.text(`${Number(item.price || 0).toLocaleString()}`, 158, yy, { width: 38, align: 'center' });
    doc.text(`${Number(item.subtotal || 0).toLocaleString()}`, 196, yy, { width: 38, align: 'right' });
    y += rowH;
  });
  if (!order.items || order.items.length === 0) y += rowH;
  dashed(y); y += 10;

  doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED).text('TOTAL', L, y + 3, { width: R - L, align: 'left' });
  doc.fontSize(16).font('Helvetica-Bold').fillColor(BLACK)
    .text(`${order.currency || 'TZS'} ${(Number(order.total || 0)).toLocaleString()}`, L, y, { width: R - L, align: 'right' });
  y += 30;
  if (order.offeredTotal) {
    doc.fontSize(6.5).font('Helvetica').fillColor(MUTED).text(`(Negotiated from ${order.currency || 'TZS'} ${(Number(order.originalTotal || 0)).toLocaleString()})`, L, y, { width: R - L, align: 'right' });
    y += 12;
  }
  dashed(y); y += 10;

  doc.fontSize(7).font('Helvetica-Bold').fillColor(MUTED).text('PAYMENT', L, y, { width: R - L, align: 'center', characterSpacing: 1 });
  doc.font('Helvetica').fillColor(INK).fontSize(9.5).text(order.paymentMethod || '—', L, y + 12, { width: R - L, align: 'center' });
  if (order.paymentReference && order.paymentReference !== 'Walk-in Cash') {
    doc.fontSize(7.5).fillColor(MUTED).text(`Ref: ${order.paymentReference}`, L, y + 24, { width: R - L, align: 'center' });
    y += 36;
  } else {
    y += 30;
  }
  dashed(y); y += 10;

  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(BLACK).text('Thank you for your business!', L, y, { width: R - L, align: 'center' });
  y += 18;

  const qrX = (W - qrSize) / 2;
  doc.image(qrBuffer, qrX, y, { width: qrSize, height: qrSize });
  y += qrSize + 6;
  doc.fontSize(6.5).font('Helvetica').fillColor(MUTED).text('Scan to view receipt details', L, y, { width: R - L, align: 'center' });
  y += 14;

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      try {
        const buffer = fs.readFileSync(filePath);
        resolve({ filePath, fileName, buffer });
      } catch (e) { reject(e); }
    });
    stream.on('error', reject);
  });
};

const pdfBufferToPng = async (pdfBuffer) => {
  const doc = await pdf(pdfBuffer, { scale: 3 });
  for await (const page of doc) {
    return page;
  }
  throw new Error('No page rendered from receipt PDF');
};

const generateReceiptImage = async (order) => {
  const { buffer, fileName } = await generateReceiptPDF(order);
  const png = await pdfBufferToPng(buffer);
  return { pngBuffer: png, fileName: (fileName || 'receipt.png').replace(/\.pdf$/i, '.png') };
};

const sendReceiptImageToCustomer = async (sock, order, businessId = 'default') => {
  try {
    // Support the queue path where no socket is supplied.
    sock = sock || require('../whatsapp/transport').getSock(businessId);
    const phone = (order.customerPhone || '').replace('@s.whatsapp.net', '').replace('@lid', '');
    if (!phone) return { sent: false, error: 'No phone number' };
    const jid = `${phone}@s.whatsapp.net`;

    const { pngBuffer, fileName } = await generateReceiptImage(order);
    if (!pngBuffer || !pngBuffer.length) return { sent: false, error: 'Receipt image not generated' };

    try {
      await sock.sendMessage(jid, {
        image: pngBuffer,
        mimetype: 'image/png',
        fileName,
        caption: `Receipt ${order.orderNumber || ''}`,
      });
      console.log(`✅ Receipt image sent to ${phone} for order ${order.orderNumber}`);
      return { sent: true };
    } catch (imgErr) {
      console.error('Receipt image send failed, trying PDF fallback:', imgErr.message);
      try {
        const { buffer } = await generateReceiptPDF(order);
        await sock.sendMessage(jid, {
          document: buffer,
          mimetype: 'application/pdf',
          fileName: `receipt_${order.orderNumber || order._id}.pdf`,
          caption: `Receipt ${order.orderNumber || ''}`,
        });
        console.log(`✅ Receipt (PDF fallback) sent to ${phone} for order ${order.orderNumber}`);
        return { sent: true, fallback: 'pdf' };
      } catch (pdfErr) {
        console.error('Receipt PDF fallback failed:', pdfErr.message);
        const itemsText = (order.items || []).map(i => `• ${i.productName} x${i.quantity} = ${(order.currency || 'TZS')} ${(i.subtotal || 0).toLocaleString()}`).join('\n');
        const textMsg = `📄 *Receipt - ${order.orderNumber}*\n\n` +
          `Items:\n${itemsText}\n\n` +
          `*Total: ${order.currency || 'TZS'} ${(order.total || 0).toLocaleString()}*\n` +
          `Payment: ${order.paymentMethod || 'N/A'}\n` +
          `Date: ${new Date(order.createdAt).toLocaleDateString()}\n\n` +
          `Thank you for your business!`;
        await sock.sendMessage(jid, { text: textMsg });
        console.log(`✅ Receipt (text fallback) sent to ${phone} for order ${order.orderNumber}`);
        return { sent: true, fallback: 'text' };
      }
    }
  } catch (err) {
    console.error('Failed to send receipt image:', err.message);
    return { sent: false, error: err.message };
  }
};

const sendReceiptToCustomer = async (sock, order, businessId = 'default') => {
  try {
    sock = sock || require('../whatsapp/transport').getSock(businessId);
    const { filePath, fileName } = await generateReceiptPDF(order);
    const phone = (order.customerPhone || '').replace('@s.whatsapp.net', '').replace('@lid', '');
    if (!phone) return { sent: false, error: 'No phone number' };
    const jid = `${phone}@s.whatsapp.net`;

    // Verify file exists and has content
    if (!fs.existsSync(filePath)) {
      console.error('Receipt PDF not found:', filePath);
      return { sent: false, error: 'PDF not generated' };
    }
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      console.error('Receipt PDF is empty:', filePath);
      return { sent: false, error: 'PDF is empty' };
    }

    const buffer = fs.readFileSync(filePath);

    // Try sending as document first
    try {
      await sock.sendMessage(jid, {
        document: buffer,
        mimetype: 'application/pdf',
        fileName,
        caption: `Receipt ${order.orderNumber || ''}`,
      });
      console.log(`✅ Receipt sent to ${phone} for order ${order.orderNumber}`);
      return { sent: true };
    } catch (docErr) {
      console.error('Document send failed, trying text fallback:', docErr.message);
      // Fallback: send as text message with order details
      const itemsText = (order.items || []).map(i => `• ${i.productName} x${i.quantity} = ${(order.currency || 'TZS')} ${(i.subtotal || 0).toLocaleString()}`).join('\n');
      const textMsg = `📄 *Receipt - ${order.orderNumber}*\n\n` +
        `Items:\n${itemsText}\n\n` +
        `*Total: ${order.currency || 'TZS'} ${(order.total || 0).toLocaleString()}*\n` +
        `Payment: ${order.paymentMethod || 'N/A'}\n` +
        `Date: ${new Date(order.createdAt).toLocaleDateString()}\n\n` +
        `Thank you for your business!`;
      await sock.sendMessage(jid, { text: textMsg });
      console.log(`✅ Receipt (text) sent to ${phone} for order ${order.orderNumber}`);
      return { sent: true, fallback: 'text' };
    }
  } catch (err) {
    console.error('Failed to send receipt:', err.message);
    return { sent: false, error: err.message };
  }
};

const getReceiptUrl = (order) => {
  return `/receipts/receipt_${order.orderNumber || order._id}.pdf`;
};

// Email the receipt PDF to the customer (only if they have an email on file).
// Runs in parallel with the WhatsApp receipt; never blocks the WhatsApp send.
const emailReceiptToCustomer = async (order) => {
  try {
    const email = String(order.customerEmail || '').trim();
    if (!email) return { sent: false, reason: 'no_customer_email' };

    const { fileName, buffer } = await generateReceiptPDF(order);
    const businessName = await getBusinessName(order.businessId || 'default');
    const itemsRows = (order.items || [])
      .map(
        (i) =>
          `<tr><td style="padding:4px 8px;">${escapeHtml(i.productName)}</td><td align="center" style="padding:4px 8px;">${i.quantity}</td><td align="right" style="padding:4px 8px;">${order.currency || 'TZS'} ${Number(i.subtotal || 0).toLocaleString()}</td></tr>`
      )
      .join('');

    const res = await sendEmail({
      to: email,
      subject: `Your receipt from ${businessName} — ${order.orderNumber || ''}`,
      html: `<h2 style="margin:0 0 12px;color:#16a34a;">Receipt ${escapeHtml(order.orderNumber || '')}</h2>
<p>Hello ${escapeHtml(order.customerName || 'Customer')},</p>
<p>Thank you for your order. Your receipt is attached as a PDF.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">
  <thead><tr style="border-bottom:1px solid #e5e7eb;color:#6b7280;text-align:left;"><th style="padding:4px 8px;">Item</th><th align="center" style="padding:4px 8px;">Qty</th><th align="right" style="padding:4px 8px;">Price</th></tr></thead>
  <tbody>${itemsRows}</tbody>
</table>
<p style="font-size:16px;"><strong>Total: ${order.currency || 'TZS'} ${Number(order.total || 0).toLocaleString()}</strong></p>
<p style="color:#6b7280;">Paid via: ${order.paymentMethod || '-'}</p>
<p style="color:#9ca3af;font-size:13px;">We appreciate your business!</p>`,
      attachments: [{ filename: fileName, content: buffer, contentType: 'application/pdf' }],
    });
    console.log(`📧 Receipt emailed to ${email} for order ${order.orderNumber}`);
    return res;
  } catch (err) {
    console.error('Failed to email receipt:', err.message);
    return { sent: false, error: err.message };
  }
};

module.exports = { generateReceiptPDF, sendReceiptToCustomer, sendReceiptImageToCustomer, generateReceiptImage, getReceiptUrl, emailReceiptToCustomer };
