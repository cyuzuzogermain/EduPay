import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ActorRole, Prisma } from '@prisma/client';
import { InstitutionRecordsService } from './institution-records.service';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';

function decimal(value: number) {
  return { toNumber: () => value };
}

function csvBuffer(rows: string[]): Buffer {
  const header = 'schoolId,studentName,program,chargeDescription,chargeAmount,chargeDueDate';
  return Buffer.from([header, ...rows].join('\n'));
}

function csvFile(rows: string[], overrides: Partial<{ originalname: string; size: number }> = {}) {
  const buffer = csvBuffer(rows);
  return {
    buffer,
    size: overrides.size ?? buffer.length,
    originalname: overrides.originalname ?? 'import.csv',
  };
}

describe('InstitutionRecordsService', () => {
  let service: InstitutionRecordsService;
  let prisma: {
    schoolFinancialRecord: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
    };
    schoolTransaction: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      createMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    institution: { findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };

  const institutionId = 'institution-1';
  const otherInstitutionId = 'institution-2';

  const admin = {
    id: 'admin-1',
    email: 'admin@ur.ac.rw',
    role: ActorRole.INSTITUTION_ADMIN,
    institutionId,
  };
  const otherAdmin = {
    id: 'admin-2',
    email: 'admin@other.ac.rw',
    role: ActorRole.INSTITUTION_ADMIN,
    institutionId: otherInstitutionId,
  };

  const record = {
    id: 'record-1',
    institutionId,
    schoolId: 'STU-2001',
    studentName: 'Aline Uwase',
    program: 'Computer Science, Year 1',
    currency: 'RWF',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      schoolFinancialRecord: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
      },
      schoolTransaction: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      institution: { findUniqueOrThrow: jest.fn() },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    prisma.institution.findUniqueOrThrow.mockResolvedValue({
      id: institutionId,
      preferredCurrency: 'RWF',
    });
    prisma.schoolFinancialRecord.findMany.mockResolvedValue([]);
    prisma.schoolFinancialRecord.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: `record-${data.schoolId}`,
        ...data,
      }),
    );

    const financeService = new FinanceService({} as PrismaService);

    service = new InstitutionRecordsService(prisma as unknown as PrismaService, financeService);
  });

  describe('create', () => {
    it('creates a record when the school ID is unused within the institution', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(null);
      prisma.schoolFinancialRecord.create.mockResolvedValue(record);

      const result = await service.create(admin, {
        schoolId: record.schoolId,
        studentName: record.studentName,
        program: record.program,
      });

      expect(result.id).toBe(record.id);
      expect(prisma.schoolFinancialRecord.create).toHaveBeenCalledWith({
        data: {
          institutionId,
          schoolId: record.schoolId,
          studentName: record.studentName,
          program: record.program,
          currency: 'RWF',
        },
      });
    });

    it('throws ConflictException when the school ID is already used at this institution', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);

      await expect(
        service.create(admin, {
          schoolId: record.schoolId,
          studentName: record.studentName,
          program: record.program,
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.schoolFinancialRecord.create).not.toHaveBeenCalled();
    });

    it('scopes the uniqueness check to the requester institution, not schoolId alone', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(null);
      prisma.schoolFinancialRecord.create.mockResolvedValue(record);

      await service.create(admin, {
        schoolId: record.schoolId,
        studentName: record.studentName,
      });

      expect(prisma.schoolFinancialRecord.findUnique).toHaveBeenCalledWith({
        where: { institutionId_schoolId: { institutionId, schoolId: record.schoolId } },
      });
    });

    it("denominates a new record in the institution's current preferred currency, not a hardcoded default", async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(null);
      prisma.institution.findUniqueOrThrow.mockResolvedValue({
        id: institutionId,
        preferredCurrency: 'USD',
      });
      prisma.schoolFinancialRecord.create.mockResolvedValue({ ...record, currency: 'USD' });

      await service.create(admin, {
        schoolId: record.schoolId,
        studentName: record.studentName,
      });

      expect(prisma.schoolFinancialRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currency: 'USD' }) }),
      );
    });
  });

  describe('importCsv', () => {
    it('creates one record per unique schoolId and one charge per row, grouping multi-charge students', async () => {
      const file = csvFile([
        'STU-3001,Aline Uwase,CS Year 1,Tuition,450000,2026-09-01',
        'STU-3001,Aline Uwase,CS Year 1,Library Fee,15000,2026-09-15',
        'STU-3002,Eric Niyonzima,Business Year 2,Tuition,500000,2026-09-01',
      ]);

      const result = await service.importCsv(admin, file);

      expect(result).toEqual({ recordsCreated: 2, chargesCreated: 3, skipped: [] });
      expect(prisma.schoolFinancialRecord.create).toHaveBeenCalledTimes(2);
      expect(prisma.schoolFinancialRecord.create).toHaveBeenCalledWith({
        data: {
          institutionId,
          schoolId: 'STU-3001',
          studentName: 'Aline Uwase',
          program: 'CS Year 1',
          currency: 'RWF',
        },
      });

      const createManyArgs = prisma.schoolTransaction.createMany.mock.calls[0][0];
      expect(createManyArgs.data).toHaveLength(2);
      expect(createManyArgs.data[0]).toEqual(
        expect.objectContaining({
          recordId: 'record-STU-3001',
          type: 'CHARGE',
          status: 'PENDING',
          description: 'Tuition',
          amount: 450000,
          currency: 'RWF',
        }),
      );
    });

    it('treats an empty program column as null, not an empty string', async () => {
      const file = csvFile(['STU-3003,Sandrine Ingabire,,Tuition,300000,2026-09-01']);

      await service.importCsv(admin, file);

      expect(prisma.schoolFinancialRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ program: null }) }),
      );
    });

    it('imports the valid rows and reports the rest in a mixed file, without aborting the whole upload', async () => {
      prisma.schoolFinancialRecord.findMany.mockResolvedValue([{ schoolId: 'STU-EXISTING' }]);

      const file = csvFile([
        'STU-3001,Aline Uwase,CS Year 1,Tuition,450000,2026-09-01', // valid
        'STU-EXISTING,Someone,,Tuition,100000,2026-09-01', // duplicate schoolId (already in DB)
        ',No School Id,,Tuition,100000,2026-09-01', // missing schoolId
        'STU-3004,A,,Tuition,100000,2026-09-01', // studentName too short
        'STU-3005,Valid Name,,,100000,2026-09-01', // missing chargeDescription
        'STU-3006,Valid Name,,Tuition,not-a-number,2026-09-01', // bad amount
        'STU-3007,Valid Name,,Tuition,-500,2026-09-01', // non-positive amount
        'STU-3008,Valid Name,,Tuition,100000,not-a-date', // bad due date
      ]);

      const result = await service.importCsv(admin, file);

      expect(result.recordsCreated).toBe(1);
      expect(result.chargesCreated).toBe(1);
      expect(result.skipped).toHaveLength(7);
      expect(result.skipped.map((s) => s.row)).toEqual([3, 4, 5, 6, 7, 8, 9]);
      expect(result.skipped[0].reason).toContain('already exists');
      expect(result.skipped[1].reason).toContain('Missing schoolId');
      expect(result.skipped[2].reason).toContain('studentName');
      expect(result.skipped[3].reason).toContain('chargeDescription');
      expect(result.skipped[4].reason).toContain('chargeAmount');
      expect(result.skipped[5].reason).toContain('chargeAmount');
      expect(result.skipped[6].reason).toContain('chargeDueDate');
    });

    it("scopes every created record to the uploading admin's own institution, never the file", async () => {
      const file = csvFile(['STU-4001,Someone Else,,Tuition,100000,2026-09-01']);

      await service.importCsv(otherAdmin, file);

      expect(prisma.schoolFinancialRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ institutionId: otherInstitutionId }),
        }),
      );
    });

    it("denominates every imported charge in the institution's current preferred currency", async () => {
      prisma.institution.findUniqueOrThrow.mockResolvedValue({
        id: institutionId,
        preferredCurrency: 'USD',
      });
      const file = csvFile(['STU-5001,Someone,,Tuition,1000,2026-09-01']);

      await service.importCsv(admin, file);

      expect(prisma.schoolFinancialRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currency: 'USD' }) }),
      );
      expect(prisma.schoolTransaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ currency: 'USD' })],
        }),
      );
    });

    it("reports every row of a group as skipped, with all other groups unaffected, when that group's transaction fails", async () => {
      prisma.$transaction
        .mockImplementationOnce(() => {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
            meta: { target: ['institutionId', 'schoolId'] },
          });
        })
        .mockImplementationOnce((callback: (tx: unknown) => unknown) => callback(prisma));

      const file = csvFile([
        'STU-6001,First Student,,Tuition,100000,2026-09-01',
        'STU-6002,Second Student,,Tuition,200000,2026-09-01',
      ]);

      const result = await service.importCsv(admin, file);

      expect(result.recordsCreated).toBe(1);
      expect(result.chargesCreated).toBe(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toEqual({
        row: 2,
        reason: 'schoolId "STU-6001" was claimed by another request during import',
      });
    });

    it('throws BadRequestException for a non-.csv file', async () => {
      const file = csvFile(['STU-1,A Name,,Tuition,1000,2026-09-01'], {
        originalname: 'import.xlsx',
      });

      await expect(service.importCsv(admin, file)).rejects.toThrow(BadRequestException);
      expect(prisma.schoolFinancialRecord.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the file exceeds the size limit', async () => {
      const file = csvFile(['STU-1,A Name,,Tuition,1000,2026-09-01'], { size: 3 * 1024 * 1024 });

      await expect(service.importCsv(admin, file)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when required columns are missing', async () => {
      const file = {
        buffer: Buffer.from('schoolId,studentName\nSTU-1,A Name'),
        size: 10,
        originalname: 'import.csv',
      };

      await expect(service.importCsv(admin, file)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for a CSV with a header but no data rows', async () => {
      const file = csvFile([]);

      await expect(service.importCsv(admin, file)).rejects.toThrow(BadRequestException);
    });
  });

  describe('listForInstitution', () => {
    it('only returns records for the requester institution and computes the balance', async () => {
      prisma.schoolFinancialRecord.findMany.mockResolvedValue([
        {
          ...record,
          transactions: [
            { type: 'CHARGE', status: 'PENDING', amount: decimal(100) },
            { type: 'PAYMENT', status: 'COMPLETED', amount: decimal(40) },
          ],
        },
      ]);
      prisma.schoolFinancialRecord.count.mockResolvedValue(1);

      const result = await service.listForInstitution(admin);

      expect(prisma.schoolFinancialRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { institutionId } }),
      );
      expect(result.items[0].outstandingBalance).toBe(60);
      expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
    });

    it('paginates using the given page/pageSize', async () => {
      prisma.schoolFinancialRecord.findMany.mockResolvedValue([]);
      prisma.schoolFinancialRecord.count.mockResolvedValue(45);

      const result = await service.listForInstitution(admin, { page: 2, pageSize: 10 });

      expect(prisma.schoolFinancialRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.meta).toEqual({ total: 45, page: 2, pageSize: 10, totalPages: 5 });
    });

    it('filters by a case-insensitive search against schoolId/studentName', async () => {
      prisma.schoolFinancialRecord.findMany.mockResolvedValue([]);
      prisma.schoolFinancialRecord.count.mockResolvedValue(0);

      await service.listForInstitution(admin, { search: 'Aline' });

      expect(prisma.schoolFinancialRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            institutionId,
            OR: [
              { schoolId: { contains: 'Aline', mode: 'insensitive' } },
              { studentName: { contains: 'Aline', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });
  });

  describe('getDetail', () => {
    it('throws NotFoundException when the record does not exist', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(null);

      await expect(service.getDetail('missing', admin)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the record belongs to another institution', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);

      await expect(service.getDetail(record.id, otherAdmin)).rejects.toThrow(ForbiddenException);
      expect(prisma.schoolTransaction.findMany).not.toHaveBeenCalled();
    });

    it('returns the record with its charges, sorted with undated charges last, and the outstanding balance', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findMany.mockResolvedValue([
        {
          id: 'charge-undated',
          type: 'CHARGE',
          status: 'PENDING',
          description: 'Application Fee',
          amount: decimal(5000),
          currency: 'RWF',
          dueDate: null,
          createdAt: new Date(),
          chargeAllocations: [],
        },
        {
          id: 'charge-1',
          type: 'CHARGE',
          status: 'PENDING',
          description: 'Tuition',
          amount: decimal(500000),
          currency: 'RWF',
          dueDate: new Date('2026-09-01'),
          createdAt: new Date(),
          chargeAllocations: [],
        },
        {
          id: 'payment-1',
          type: 'PAYMENT',
          status: 'COMPLETED',
          description: 'Payment for Tuition',
          amount: decimal(200000),
          currency: 'RWF',
          dueDate: null,
          createdAt: new Date(),
          chargeAllocations: [],
        },
      ]);

      const result = await service.getDetail(record.id, admin);

      expect(result.outstandingBalance).toBe(305000);
      expect(result.charges).toHaveLength(2);
      expect(result.charges.map((c) => c.id)).toEqual(['charge-1', 'charge-undated']);
      expect(result.charges[0]).toEqual(
        expect.objectContaining({ id: 'charge-1', amount: 500000, editable: true }),
      );
    });
  });

  describe('addCharge', () => {
    it('appends a charge to an owned record', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.create.mockResolvedValue({
        id: 'charge-1',
        description: 'Library Fee',
        amount: decimal(15000),
        currency: 'RWF',
        dueDate: new Date('2026-10-01'),
        createdAt: new Date(),
      });

      const result = await service.addCharge(record.id, admin, {
        description: 'Library Fee',
        amount: 15000,
        dueDate: '2026-10-01',
      });

      expect(result.editable).toBe(true);
      expect(prisma.schoolTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recordId: record.id,
          type: 'CHARGE',
          status: 'PENDING',
          description: 'Library Fee',
          amount: 15000,
          currency: record.currency,
        }),
      });
    });

    it('throws ForbiddenException when the record belongs to another institution', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);

      await expect(
        service.addCharge(record.id, otherAdmin, {
          description: 'Library Fee',
          amount: 15000,
          dueDate: '2026-10-01',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.schoolTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('updateCharge / deleteCharge', () => {
    const openCharge = {
      id: 'charge-1',
      recordId: record.id,
      type: 'CHARGE',
      description: 'Tuition',
      amount: decimal(500000),
      currency: 'RWF',
      dueDate: new Date('2026-09-01'),
      createdAt: new Date(),
      chargeAllocations: [],
    };

    const chargeWithRejectedPaymentOnly = {
      ...openCharge,
      chargeAllocations: [{ payment: { status: 'REJECTED' } }],
    };

    const chargeWithLivePayment = {
      ...openCharge,
      chargeAllocations: [{ payment: { status: 'PENDING_APPROVAL' } }],
    };

    it('allows editing a charge with no payments attached', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findUnique.mockResolvedValue(openCharge);
      prisma.schoolTransaction.update.mockResolvedValue({
        ...openCharge,
        description: 'Tuition Fee',
      });

      const result = await service.updateCharge(record.id, openCharge.id, admin, {
        description: 'Tuition Fee',
      });

      expect(result.description).toBe('Tuition Fee');
    });

    it('updates the due date when one is provided', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findUnique.mockResolvedValue(openCharge);
      prisma.schoolTransaction.update.mockResolvedValue(openCharge);

      await service.updateCharge(record.id, openCharge.id, admin, { dueDate: '2026-12-01' });

      expect(prisma.schoolTransaction.update).toHaveBeenCalledWith({
        where: { id: openCharge.id },
        data: expect.objectContaining({ dueDate: new Date('2026-12-01') }),
      });
    });

    it('allows editing a charge whose only payment was rejected', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findUnique.mockResolvedValue(chargeWithRejectedPaymentOnly);
      prisma.schoolTransaction.update.mockResolvedValue(chargeWithRejectedPaymentOnly);

      await expect(
        service.updateCharge(record.id, openCharge.id, admin, { amount: 10000 }),
      ).resolves.toBeDefined();
    });

    it.each(['INITIATED', 'PENDING_APPROVAL', 'COMPLETED'])(
      'blocks editing a charge with a %s payment attached',
      async (status) => {
        prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
        prisma.schoolTransaction.findUnique.mockResolvedValue({
          ...openCharge,
          chargeAllocations: [{ payment: { status } }],
        });

        await expect(
          service.updateCharge(record.id, openCharge.id, admin, { amount: 10000 }),
        ).rejects.toThrow(ConflictException);
        expect(prisma.schoolTransaction.update).not.toHaveBeenCalled();
      },
    );

    it('blocks deleting a charge with a live payment attached', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findUnique.mockResolvedValue(chargeWithLivePayment);

      await expect(service.deleteCharge(record.id, openCharge.id, admin)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.schoolTransaction.delete).not.toHaveBeenCalled();
    });

    it('deletes a charge with no live payment attached', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findUnique.mockResolvedValue(openCharge);
      prisma.schoolTransaction.delete.mockResolvedValue(openCharge);

      await service.deleteCharge(record.id, openCharge.id, admin);

      expect(prisma.schoolTransaction.delete).toHaveBeenCalledWith({
        where: { id: openCharge.id },
      });
    });

    it("throws ForbiddenException when editing a charge on another institution's record", async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);

      await expect(
        service.updateCharge(record.id, openCharge.id, otherAdmin, { amount: 10000 }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.schoolTransaction.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the charge does not belong to the record', async () => {
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findUnique.mockResolvedValue({
        ...openCharge,
        recordId: 'a-different-record',
      });

      await expect(
        service.updateCharge(record.id, openCharge.id, admin, { amount: 10000 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
