import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Dataset } from './reports.service';

/**
 * Generic report PDF renderer. Produces a titled, paginated document with a
 * summary row and one table per dataset. Layout is intentionally simpler than
 * the legacy cover-page/chart design while carrying the same data.
 */
@Injectable()
export class ReportsPdfService {
  async render(businessName: string, period: string, datasets: Dataset[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const finished = new Promise<void>((resolve, reject) => {
      doc.on('end', () => resolve());
      doc.on('error', reject);
    });

    const left = 40;
    const width = doc.page.width - 80;

    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(20).text(businessName || 'Business', left, 40);
    doc.font('Helvetica').fontSize(10).fillColor('#666666').text(`Report period: ${period}`, left, 66);
    doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`, left, 80);
    doc.moveTo(left, 100).lineTo(left + width, 100).strokeColor('#dddddd').stroke();

    let y = 116;
    for (const dataset of datasets) {
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = 60;
      }
      doc.fillColor('#111111').font('Helvetica-Bold').fontSize(14).text(dataset.title, left, y);
      y += 20;

      if (dataset.stats.length) {
        doc.font('Helvetica').fontSize(9).fillColor('#444444');
        doc.text(dataset.stats.map((s) => `${s.label}: ${s.value}`).join('    '), left, y, { width });
        y += 18;
      }

      const totalWidth = dataset.columns.reduce((s, c) => s + (c.width ?? 1), 0);
      const colWidths = dataset.columns.map((c) => ((c.width ?? 1) / totalWidth) * width);

      // Header row.
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');
      let x = left;
      dataset.columns.forEach((c, i) => {
        doc.text(c.label, x + 2, y, { width: colWidths[i] - 4, align: c.align ?? 'left' });
        x += colWidths[i];
      });
      y += 14;
      doc.moveTo(left, y - 3).lineTo(left + width, y - 3).strokeColor('#eeeeee').stroke();

      doc.font('Helvetica').fontSize(8.5).fillColor('#222222');
      for (const row of dataset.rows) {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = 60;
        }
        x = left;
        let rowHeight = 12;
        dataset.columns.forEach((c, i) => {
          const text = String(row[c.key] ?? '');
          const h = doc.heightOfString(text, { width: colWidths[i] - 4 });
          if (h > rowHeight) rowHeight = h;
          doc.text(text, x + 2, y, { width: colWidths[i] - 4, align: c.align ?? 'left' });
          x += colWidths[i];
        });
        y += rowHeight + 3;
      }
      if (dataset.rows.length === 0) {
        doc.fillColor('#888888').text('No records for this period.', left, y);
        y += 16;
      }
      y += 18;
    }

    doc.end();
    await finished;
    return Buffer.concat(chunks);
  }
}
