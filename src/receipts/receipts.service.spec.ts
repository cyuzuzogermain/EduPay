import { ReceiptsService } from './receipts.service';

describe('ReceiptsService', () => {
  let receiptsService: ReceiptsService;

  beforeEach(() => {
    receiptsService = new ReceiptsService();
  });

  it('generates a well-formed single-page PDF containing the receipt data', async () => {
    const buffer = await receiptsService.generateReceiptPdf({
      paymentReference: 'payment-123',
      studentName: 'Aline Uwase',
      institutionName: 'EduPay Demo University',
      schoolId: 'STU-1001',
      program: 'Computer Science, Year 1',
      charges: [
        { description: 'Tuition', amount: 450000 },
        { description: 'Library Fee', amount: 15000 },
      ],
      amount: 465000,
      currency: 'RWF',
      paidAt: new Date('2026-07-01T00:00:00.000Z'),
      sendCurrency: null,
      fxRate: null,
      convertedAmount: null,
      feeAmount: null,
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    // A valid PDF starts with the %PDF- header and ends with %%EOF.
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.subarray(-6).toString('ascii').trim()).toBe('%%EOF');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('handles a record with no program set', async () => {
    const buffer = await receiptsService.generateReceiptPdf({
      paymentReference: 'payment-456',
      studentName: 'Eric Niyonzima',
      institutionName: 'EduPay Demo University',
      schoolId: 'STU-1002',
      program: null,
      charges: [{ description: 'Housing', amount: 120000 }],
      amount: 120000,
      currency: 'RWF',
      paidAt: new Date(),
      sendCurrency: null,
      fxRate: null,
      convertedAmount: null,
      feeAmount: null,
    });

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('handles multiple charges without throwing', async () => {
    const buffer = await receiptsService.generateReceiptPdf({
      paymentReference: 'payment-789',
      studentName: 'Sandrine Ingabire',
      institutionName: 'EduPay Demo University',
      schoolId: 'STU-1005',
      program: 'Medicine, Year 1',
      charges: [
        { description: 'Tuition', amount: 600000 },
        { description: 'Housing', amount: 150000 },
        { description: 'Medical Insurance', amount: 60000 },
        { description: 'Library Fee', amount: 12000 },
      ],
      amount: 822000,
      currency: 'RWF',
      paidAt: new Date(),
      sendCurrency: null,
      fxRate: null,
      convertedAmount: null,
      feeAmount: null,
    });

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders a cross-border payment details section when FX fields are present', async () => {
    const buffer = await receiptsService.generateReceiptPdf({
      paymentReference: 'payment-fx',
      studentName: 'Aline Uwase',
      institutionName: 'EduPay Demo University',
      schoolId: 'STU-1001',
      program: 'Computer Science, Year 1',
      charges: [{ description: 'Tuition', amount: 450000 }],
      amount: 450000,
      currency: 'RWF',
      paidAt: new Date('2026-07-01T00:00:00.000Z'),
      sendCurrency: 'USD',
      fxRate: 0.00069,
      convertedAmount: 310.5,
      feeAmount: 4.66,
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('omits the cross-border section when only some FX fields are present', async () => {
    const buffer = await receiptsService.generateReceiptPdf({
      paymentReference: 'payment-partial-fx',
      studentName: 'Aline Uwase',
      institutionName: 'EduPay Demo University',
      schoolId: 'STU-1001',
      program: 'Computer Science, Year 1',
      charges: [{ description: 'Tuition', amount: 450000 }],
      amount: 450000,
      currency: 'RWF',
      paidAt: new Date('2026-07-01T00:00:00.000Z'),
      sendCurrency: 'USD',
      fxRate: null,
      convertedAmount: null,
      feeAmount: null,
    });

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
