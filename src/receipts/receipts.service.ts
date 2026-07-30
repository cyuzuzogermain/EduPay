import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface ReceiptChargeLine {
  description: string;
  amount: number;
}

export interface ReceiptData {
  paymentReference: string;
  studentName: string;
  institutionName: string;
  schoolId: string;
  program: string | null;
  charges: ReceiptChargeLine[];
  /** Amount received by the institution, in its own preferred currency. */
  amount: number;
  /** The institution's preferred currency. */
  currency: string;
  paidAt: Date;
  /** Cross-border disclosure fields - null for a payment that predates the FX feature. */
  sendCurrency: string | null;
  fxRate: number | null;
  convertedAmount: number | null;
  feeAmount: number | null;
}

const PAGE_WIDTH = 595.28; // A4 in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const INK = rgb(0.11, 0.15, 0.19);
const MUTED = rgb(0.39, 0.45, 0.52);
const ACCENT = rgb(0.11, 0.3, 0.85);
const RULE = rgb(0.87, 0.89, 0.91);

@Injectable()
export class ReceiptsService {
  async generateReceiptPdf(data: ReceiptData): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`EduPay receipt ${data.paymentReference}`);
    pdfDoc.setProducer('EduPay');

    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = PAGE_HEIGHT - MARGIN;

    page.drawText('EduPay', { x: MARGIN, y, size: 22, font: bold, color: ACCENT });
    page.drawText('Payment Receipt', {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize('Payment Receipt', 12),
      y: y - 4,
      size: 12,
      font,
      color: MUTED,
    });
    y -= 34;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 1,
      color: RULE,
    });
    y -= 28;

    const field = (label: string, value: string) => {
      page.drawText(label, { x: MARGIN, y, size: 9, font, color: MUTED });
      page.drawText(value, { x: MARGIN, y: y - 14, size: 12, font: bold, color: INK });
      y -= 38;
    };

    const row = (label: string, value: string, color = INK) => {
      page.drawText(label, { x: MARGIN, y, size: 10, font, color: MUTED });
      page.drawText(value, {
        x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(value, 10),
        y,
        size: 10,
        font,
        color,
      });
      y -= 18;
    };

    const rule = () => {
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_WIDTH - MARGIN, y },
        thickness: 1,
        color: RULE,
      });
      y -= 20;
    };

    field('Reference', data.paymentReference);
    field('Paid on', data.paidAt.toISOString().slice(0, 10));
    field('Student', data.studentName);
    field(
      'Institution',
      data.program ? `${data.institutionName} - ${data.program}` : data.institutionName,
    );
    field('School ID', data.schoolId);

    y -= 6;
    page.drawText('Charges covered', { x: MARGIN, y, size: 10, font: bold, color: INK });
    y -= 18;
    rule();

    for (const charge of data.charges) {
      const amountText = `${data.currency} ${charge.amount.toLocaleString()}`;
      page.drawText(charge.description, { x: MARGIN, y, size: 11, font, color: INK });
      page.drawText(amountText, {
        x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(amountText, 11),
        y,
        size: 11,
        font,
        color: INK,
      });
      y -= 22;
    }

    y -= 8;
    rule();

    const receivedText = `${data.currency} ${data.amount.toLocaleString()}`;
    page.drawText('Amount received by institution', {
      x: MARGIN,
      y,
      size: 12,
      font: bold,
      color: INK,
    });
    page.drawText(receivedText, {
      x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(receivedText, 12),
      y,
      size: 12,
      font: bold,
      color: ACCENT,
    });
    y -= 30;

    if (
      data.sendCurrency &&
      data.fxRate !== null &&
      data.convertedAmount !== null &&
      data.feeAmount !== null
    ) {
      page.drawText('Cross-border payment details', {
        x: MARGIN,
        y,
        size: 10,
        font: bold,
        color: INK,
      });
      y -= 18;
      rule();

      row('Paid by student in', data.sendCurrency);
      row(
        'Exchange rate applied',
        `1 ${data.currency} = ${data.fxRate.toFixed(4)} ${data.sendCurrency}`,
      );
      row(
        `Converted amount (${data.sendCurrency})`,
        `${data.sendCurrency} ${data.convertedAmount.toLocaleString()}`,
      );
      row('EduPay fee (1.5%)', `${data.sendCurrency} ${data.feeAmount.toLocaleString()}`);

      const totalToStudent = data.convertedAmount + data.feeAmount;
      const totalText = `${data.sendCurrency} ${totalToStudent.toLocaleString()}`;
      y -= 4;
      page.drawText('Total charged to student', { x: MARGIN, y, size: 11, font: bold, color: INK });
      page.drawText(totalText, {
        x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(totalText, 11),
        y,
        size: 11,
        font: bold,
        color: ACCENT,
      });
      y -= 30;
    }

    page.drawText(
      'This receipt was generated automatically by EduPay and confirms a COMPLETED payment. ' +
        'The FX rate shown was the one locked in at the time the payment was initiated.',
      { x: MARGIN, y: MARGIN, size: 8, font, color: MUTED },
    );

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }
}
