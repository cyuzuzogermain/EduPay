import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';

function decimal(value: number) {
  return { toNumber: () => value };
}

describe('ReportsService', () => {
  let reportsService: ReportsService;
  let prisma: { schoolTransaction: { findMany: jest.Mock; count: jest.Mock } };

  const institutionId = 'institution-1';

  const paymentRow = {
    id: 'payment-1',
    status: 'COMPLETED',
    amount: decimal(450000),
    currency: 'RWF',
    description: 'Payment for Tuition',
    occurredAt: new Date('2026-06-01T00:00:00.000Z'),
    reviewedAt: new Date('2026-06-02T00:00:00.000Z'),
    record: { studentName: 'Aline Uwase', schoolId: 'STU-1001' },
    paymentAllocations: [{ charge: { description: 'Tuition' } }],
  };

  beforeEach(() => {
    prisma = {
      schoolTransaction: { findMany: jest.fn(), count: jest.fn() },
    };

    reportsService = new ReportsService(prisma as unknown as PrismaService);
  });

  describe('getInstitutionReport', () => {
    it('scopes the report to the given institution, type PAYMENT only', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([paymentRow]);
      prisma.schoolTransaction.count.mockResolvedValue(1);

      const result = await reportsService.getInstitutionReport(institutionId, {});

      expect(prisma.schoolTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type: 'PAYMENT', record: { institutionId } },
        }),
      );
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'payment-1',
          studentName: 'Aline Uwase',
          schoolId: 'STU-1001',
          chargesCovered: 'Tuition',
          amount: 450000,
        }),
      );
      expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
    });

    it('filters by status', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([]);
      prisma.schoolTransaction.count.mockResolvedValue(0);

      await reportsService.getInstitutionReport(institutionId, { status: 'REJECTED' as never });

      expect(prisma.schoolTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
    });

    it('filters by a case-insensitive schoolId contains match', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([]);
      prisma.schoolTransaction.count.mockResolvedValue(0);

      await reportsService.getInstitutionReport(institutionId, { schoolId: 'stu-100' });

      expect(prisma.schoolTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            record: { institutionId, schoolId: { contains: 'stu-100', mode: 'insensitive' } },
          }),
        }),
      );
    });

    it('filters by dateFrom alone', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([]);
      prisma.schoolTransaction.count.mockResolvedValue(0);

      await reportsService.getInstitutionReport(institutionId, { dateFrom: '2026-06-01' });

      const call = prisma.schoolTransaction.findMany.mock.calls[0][0];
      expect(call.where.occurredAt).toEqual({ gte: new Date('2026-06-01') });
    });

    it('filters by dateTo alone', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([]);
      prisma.schoolTransaction.count.mockResolvedValue(0);

      await reportsService.getInstitutionReport(institutionId, { dateTo: '2026-06-30' });

      const call = prisma.schoolTransaction.findMany.mock.calls[0][0];
      expect(call.where.occurredAt.gte).toBeUndefined();
      expect(call.where.occurredAt.lte.getHours()).toBe(23);
    });

    it('filters by an inclusive date range', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([]);
      prisma.schoolTransaction.count.mockResolvedValue(0);

      await reportsService.getInstitutionReport(institutionId, {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
      });

      const call = prisma.schoolTransaction.findMany.mock.calls[0][0];
      expect(call.where.occurredAt.gte).toEqual(new Date('2026-06-01'));
      // dateTo is inclusive of the whole day.
      expect(call.where.occurredAt.lte.getHours()).toBe(23);
      expect(call.where.occurredAt.lte.getMinutes()).toBe(59);
    });

    it('paginates using the given page/pageSize', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([]);
      prisma.schoolTransaction.count.mockResolvedValue(65);

      const result = await reportsService.getInstitutionReport(institutionId, {
        page: 2,
        pageSize: 25,
      });

      expect(prisma.schoolTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 25, take: 25 }),
      );
      expect(result.meta).toEqual({ total: 65, page: 2, pageSize: 25, totalPages: 3 });
    });
  });

  describe('exportInstitutionReportCsv', () => {
    it('produces a CSV with a header row and one row per payment, unpaginated', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([paymentRow]);

      const csv = await reportsService.exportInstitutionReportCsv(institutionId, {});

      const lines = csv.split('\r\n');
      expect(lines[0]).toBe(
        '"Payment ID","Student","School ID","Description","Charges Covered",' +
          '"Amount Received (Institution Currency)","Institution Currency","Send Currency",' +
          '"FX Rate","Converted Amount","Fee Amount","Status","Initiated At","Reviewed At"',
      );
      expect(lines[1]).toContain('"payment-1"');
      expect(lines[1]).toContain('"Aline Uwase"');
      expect(lines[1]).toContain('"STU-1001"');
      expect(lines[1]).toContain('"450000"');
      expect(prisma.schoolTransaction.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ skip: expect.anything(), take: expect.anything() }),
      );
    });

    it('includes send currency, FX rate, converted amount, and fee for a cross-border payment', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([
        {
          ...paymentRow,
          sendCurrency: 'USD',
          fxRate: decimal(0.00069),
          convertedAmount: decimal(310.5),
          feeAmount: decimal(4.66),
        },
      ]);

      const csv = await reportsService.exportInstitutionReportCsv(institutionId, {});
      const [, dataLine] = csv.split('\r\n');

      expect(dataLine).toContain('"USD"');
      expect(dataLine).toContain('"0.00069"');
      expect(dataLine).toContain('"310.5"');
      expect(dataLine).toContain('"4.66"');
    });

    it('leaves the FX columns blank for a payment made without cross-border conversion data', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([paymentRow]);

      const csv = await reportsService.exportInstitutionReportCsv(institutionId, {});
      const [, dataLine] = csv.split('\r\n');

      // Amount, Currency, Send Currency("", blank), FX Rate(""), Converted Amount(""), Fee Amount("")
      expect(dataLine).toContain('"450000","RWF","","","","","COMPLETED"');
    });

    it('escapes double quotes inside fields', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([
        {
          ...paymentRow,
          description: 'Payment for "Tuition"',
        },
      ]);

      const csv = await reportsService.exportInstitutionReportCsv(institutionId, {});

      expect(csv).toContain('Payment for ""Tuition""');
    });

    it('leaves the Reviewed At column blank for a payment that has not been reviewed yet', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([{ ...paymentRow, reviewedAt: null }]);

      const csv = await reportsService.exportInstitutionReportCsv(institutionId, {});

      const [, dataLine] = csv.split('\r\n');
      expect(dataLine.endsWith('""')).toBe(true);
    });

    it('returns just the header row when there are no matching payments', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([]);

      const csv = await reportsService.exportInstitutionReportCsv(institutionId, {});

      expect(csv.split('\r\n')).toHaveLength(1);
    });
  });
});
