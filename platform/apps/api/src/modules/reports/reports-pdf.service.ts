import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Dataset } from './reports.service';

/**
 * Report PDF renderer: a branded cover page, then one section per dataset with
 * a summary row, an optional bar chart, and a paginated table. This restores the
 * legacy cover/chart presentation (the earlier version was a bare table).
 */
@Injectable()
export class ReportsPdfService {
  async render(businessName: string, period: string, datasets: Dataset[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const finished = new Promise<void>((resolve, reject) => {
      doc.on('end', () => resolve());
      doc.on('error', reject);
    });

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    this.cover(doc, businessName, period, datasets);
    for (const dataset of datasets) {
      doc.addPage();
      this.section(doc, dataset, left, width);
    }
    this.stampFooters(doc, businessName);

    doc.flushPages();
    doc.end();
    await finished;
    return Buffer.concat(chunks);
  }

  private cover(doc: PDFKit.PDFDocument, businessName: string, period: string, datasets: Dataset[]): void {
    const width = doc.page.width;
    const margin = doc.page.margins.left;
    const contentWidth = width - margin * 2;

    // Header band.
    doc.rect(0, 0, width, 170).fill('#111111');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text(businessName || 'Business', margin, 48, {
      width: contentWidth,
    });
    doc.font('Helvetica').fontSize(10).fillColor('#c9c9c9').text('BUSINESS REPORT', margin, 84, {
      width: contentWidth,
      characterSpacing: 4,
    });
    doc.font('Helvetica').fontSize(10).fillColor('#e8e8e8').text(`Period: ${period}`, margin, 110);
    doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`, margin, 126);

    let y = 200;
    if (datasets.length === 1) {
      const dataset = datasets[0];
      doc.fillColor('#111111').font('Helvetica-Bold').fontSize(18).text(dataset.title, margin, y, { width: contentWidth });
      y += 28;
      if (dataset.subtitle) {
        doc.font('Helvetica').fontSize(10).fillColor('#666666').text(dataset.subtitle, margin, y);
        y += 22;
      }
      doc.fillColor('#111111').font('Helvetica').fontSize(10);
      for (const stat of dataset.stats) {
        doc.text(`${stat.label}: ${stat.value}`, margin, y);
        y += 16;
      }
    } else {
      doc.fillColor('#111111').font('Helvetica-Bold').fontSize(16).text('Contents', margin, y);
      y += 26;
      doc.font('Helvetica').fontSize(11).fillColor('#444444');
      datasets.forEach((dataset, i) => {
        doc.text(`${i + 1}.  ${dataset.title}`, margin, y);
        y += 18;
      });
    }

    doc.moveTo(margin, y + 10).lineTo(margin + contentWidth, y + 10).strokeColor('#dddddd').stroke();
  }

  private section(doc: PDFKit.PDFDocument, dataset: Dataset, left: number, width: number): void {
    let y = 60;
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(16).text(dataset.title, left, y);
    y += 22;
    if (dataset.subtitle) {
      doc.font('Helvetica').fontSize(9.5).fillColor('#666666').text(dataset.subtitle, left, y);
      y += 18;
    }

    if (dataset.stats.length) {
      doc.font('Helvetica').fontSize(9).fillColor('#333333');
      doc.text(dataset.stats.map((s) => `${s.label}: ${s.value}`).join('     '), left, y, { width });
      y += 20;
    }

    if (dataset.series && dataset.series.length > 0) {
      y = this.chart(doc, dataset.series, dataset.chartTitle ?? 'Summary', left, y, width) + 16;
    }

    this.table(doc, dataset, left, y, width);
  }

  /** Simple vertical bar chart; returns the y after the chart. */
  private chart(
    doc: PDFKit.PDFDocument,
    points: Array<{ label: string; value: number }>,
    title: string,
    left: number,
    y: number,
    width: number
  ): number {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text(title, left, y);
    y += 16;
    const height = 110;
    const baseline = y + height;
    const max = Math.max(1, ...points.map((p) => p.value));
    const gap = 6;
    const barWidth = Math.max(6, (width - gap * (points.length - 1)) / points.length);

    doc.save();
    doc.rect(left, y, width, height).fill('#f7f7f7');
    doc.restore();

    points.forEach((point, i) => {
      const barHeight = Math.max(1, (point.value / max) * (height - 18));
      const x = left + i * (barWidth + gap);
      doc.rect(x, baseline - barHeight, barWidth, barHeight).fill('#16a34a');
      doc.font('Helvetica').fontSize(6).fillColor('#444444');
      doc.text(String(point.value), x - 2, baseline - barHeight - 9, { width: barWidth + 4, align: 'center' });
      doc.fontSize(6).fillColor('#666666');
      doc.text(point.label.slice(0, 10), x - 2, baseline + 3, { width: barWidth + 4, align: 'center' });
    });

    return baseline + 18;
  }

  private table(doc: PDFKit.PDFDocument, dataset: Dataset, left: number, startY: number, width: number): void {
    let y = startY;
    const totalWidth = dataset.columns.reduce((s, c) => s + (c.width ?? 1), 0);
    const colWidths = dataset.columns.map((c) => ((c.width ?? 1) / totalWidth) * width);

    const header = () => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');
      let x = left;
      dataset.columns.forEach((c, i) => {
        doc.text(c.label, x + 2, y, { width: colWidths[i] - 4, align: c.align ?? 'left' });
        x += colWidths[i];
      });
      y += 14;
      doc.moveTo(left, y - 3).lineTo(left + width, y - 3).strokeColor('#eeeeee').stroke();
      doc.font('Helvetica').fontSize(8.5).fillColor('#222222');
    };
    header();

    if (dataset.rows.length === 0) {
      doc.fillColor('#888888').text('No records for this period.', left, y);
      return;
    }

    for (const row of dataset.rows) {
      if (y > doc.page.height - 70) {
        doc.addPage();
        y = 60;
        header();
      }
      let x = left;
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
  }

  private stampFooters(doc: PDFKit.PDFDocument, businessName: string): void {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - 34;
      doc
        .moveTo(doc.page.margins.left, y)
        .lineTo(doc.page.width - doc.page.margins.right, y)
        .strokeColor('#e5e5e5')
        .stroke();
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#999999')
        .text(`${businessName}`, doc.page.margins.left, y + 6, { width: 300 })
        .text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width - 240, y + 6, { width: 200, align: 'right' });
    }
  }
}
