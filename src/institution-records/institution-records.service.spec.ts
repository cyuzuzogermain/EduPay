import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActorRole } from '@prisma/client';
import { InstitutionRecordsService } from './institution-records.service';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';

function decimal(value: number) {
  return { toNumber: () => value };
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
      update: jest.Mock;
      delete: jest.Mock;
    };
    institution: { findUniqueOrThrow: jest.Mock };
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
        update: jest.fn(),
        delete: jest.fn(),
      },
      institution: { findUniqueOrThrow: jest.fn() },
    };
    prisma.institution.findUniqueOrThrow.mockResolvedValue({
      id: institutionId,
      preferredCurrency: 'RWF',
    });

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
