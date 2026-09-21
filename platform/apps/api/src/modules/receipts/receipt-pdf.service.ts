import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { ReceiptData } from '@uzanite/contracts';

/**
 * Renders a stored order receipt as a thermal-style PDF, matching the legacy
 * Express `/api/orders/:id/receipt` download. The QR encodes the receipt
 * details as plain text (no verification URL), exactly like the legacy app.
 */
@Injectable()
export class ReceiptPdfService {
  private money(amount: number, currency: string): string {
    return `${currency} ${Number(amount ?? 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  async render(data: ReceiptData): Promise<Buffer> {
    const currency = data.order.currency || data.totals.currency || 'TZS';
    const qrLines = [
      data.business.name,
      'SALES RECEIPT',
      `No: ${data.order.number}`,
      `Date: ${new Date(data.order.createdAt).toLocaleString('en-GB')}`,
      `Status: ${data.order.status}`,
      `Customer: ${data.customer.name}${data.customer.phone ? ` (${data.customer.phone})` : ''}`,
      'Items:',
      ...data.order.items.map((i) => `  ${i.productName} x${i.quantity} = ${this.money(i.subtotal, currency)}`),
      `TOTAL: ${this.money(data.totals.total, currency)}`,
      `Paid via: ${data.order.paymentMethod || '-'}`,
    ];
    const qrBuffer = await QRCode.toBuffer(qrLines.join('\n'), {
      type: 'png',
      margin: 1,
      width: 256,
      errorCorrectionLevel: 'M',
    });

    const width = 260;
    const doc = new PDFDocument({ size: [width, 720], margin: 16 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
      doc.on('end', () => resolve());
      doc.on('error', reject);
    });

    const left = 16;
    const contentWidth = width - 32;
    const dashed = (y: number) => {
      doc.save().dash(3, { space: 3 }).lineWidth(0.7).strokeColor('#bcbcbc');
      doc.moveTo(left, y).lineTo(left + contentWidth, y).stroke().undash();
      doc.restore();
    };

    // Header.
    doc.rect(left, 16, contentWidth, 54).fill('#111111');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14).text(data.business.name, left, 26, {
      width: contentWidth,
      align: 'center',
    });
    doc.font('Helvetica').fontSize(7.5).fillColor('#e8e8e8').text('SALES RECEIPT', left, 46, {
      width: contentWidth,
      align: 'center',
      characterSpacing: 3,
    });

    let y = 84;
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(9).text(`Receipt No: ${data.receiptNumber}`, left, y);
    y += 14;
    doc.font('Helvetica').fontSize(8).fillColor('#444444');
    doc.text(`Order: ${data.order.number}`, left, y);
    y += 12;
    doc.text(`Date: ${new Date(data.order.createdAt).toLocaleString('en-GB')}`, left, y);
    y += 12;
    doc.text(`Status: ${data.order.status}`, left, y);
    y += 12;
    doc.text(`Customer: ${data.customer.name}${data.customer.phone ? ` (${data.customer.phone})` : ''}`, left, y);
    y += 12;
    if (data.customer.deliveryLocation) {
      doc.text(`Deliver to: ${data.customer.deliveryLocation}`, left, y);
      y += 12;
    }

    y += 4;
    dashed(y);
    y += 8;

    // Items.
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111111');
    doc.text('Item', left, y, { width: contentWidth - 90 });
    doc.text('Qty', left + contentWidth - 90, y, { width: 30, align: 'right' });
    doc.text('Subtotal', left + contentWidth - 60, y, { width: 60, align: 'right' });
    y += 12;
    doc.font('Helvetica').fontSize(8).fillColor('#333333');
    for (const item of data.order.items) {
      const name = doc.heightOfString(item.productName, { width: contentWidth - 90 });
      doc.text(item.productName, left, y, { width: contentWidth - 90 });
      doc.text(String(item.quantity), left + contentWidth - 90, y, { width: 30, align: 'right' });
      doc.text(this.money(item.subtotal, currency), left + contentWidth - 60, y, { width: 60, align: 'right' });
      y += Math.max(name, 12) + 2;
    }

    y += 2;
    dashed(y);
    y += 8;

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
    doc.text('TOTAL', left, y, { width: contentWidth - 80 });
    doc.text(this.money(data.totals.total, currency), left + contentWidth - 100, y, { width: 100, align: 'right' });
    y += 16;
    doc.font('Helvetica').fontSize(8).fillColor('#444444');
    doc.text(`Paid via: ${data.order.paymentMethod || '-'}`, left, y);
    if (data.order.paymentReference) {
      y += 12;
      doc.text(`Ref: ${data.order.paymentReference}`, left, y);
    }

    y += 18;
    const qrSize = 110;
    doc.image(qrBuffer, left + (contentWidth - qrSize) / 2, y, { width: qrSize, height: qrSize });
    y += qrSize + 8;
    doc.font('Helvetica').fontSize(7).fillColor('#666666').text('Scan for receipt details', left, y, {
      width: contentWidth,
      align: 'center',
    });

    doc.end();
    await finished;
    return Buffer.concat(chunks);
  }
}
