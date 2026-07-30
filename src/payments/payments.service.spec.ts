import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActorRole, Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentPartner,
  PaymentStatus,
} from '../payment-partners/interfaces/payment-partner.interface';
import { ReceiptsService } from '../receipts/receipts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FxService } from '../fx/fx.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';

function decimal(value: number) {
  return { toNumber: () => value } as unknown as { toNumber(): number };
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

describe('PaymentsService', () => {
  let paymentsService: PaymentsService;
  let prisma: {
    student: { findUnique: jest.Mock; findFirst: jest.Mock };
    schoolFinancialRecord: { findUnique: jest.Mock };
    schoolTransaction: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    auditLog: { create: jest.Mock };
    kYCDocument: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let paymentPartner: { initiatePayment: jest.Mock; getPaymentStatus: jest.Mock };
  let receiptsService: { generateReceiptPdf: jest.Mock };
  let notificationsService: { notifyPaymentReviewed: jest.Mock };
  let fxService: { getRate: jest.Mock };

  const validDto: Pick<InitiatePaymentDto, 'sendCurrency' | 'phoneNumber'> = {
    sendCurrency: 'RWF',
    phoneNumber: '+250788123456',
  };

  const student = {
    id: 'student-1',
    email: 'aline@example.com',
    institutionId: 'institution-1',
    schoolId: 'STU-1001',
  };

  const record = {
    id: 'record-1',
    institutionId: 'institution-1',
    schoolId: 'STU-1001',
    studentName: 'Aline Uwase',
    program: 'Computer Science',
    currency: 'RWF',
  };

  const ownInstitutionAdmin = {
    id: 'admin-1',
    email: 'admin@ur.ac.rw',
    role: ActorRole.INSTITUTION_ADMIN,
    institutionId: 'institution-1',
  };

  const otherInstitutionAdmin = {
    id: 'admin-2',
    email: 'admin@other.ac.rw',
    role: ActorRole.INSTITUTION_ADMIN,
    institutionId: 'other-institution',
  };

  const platformAdmin = {
    id: 'platform-1',
    email: 'ops@edupay.example',
    role: ActorRole.PLATFORM_ADMIN,
  };

  function openCharge(overrides: Record<string, unknown> = {}) {
    return {
      id: 'charge-open',
      recordId: record.id,
      type: 'CHARGE',
      description: 'Tuition',
      amount: decimal(100000),
      currency: 'RWF',
      dueDate: daysFromNow(14),
      occurredAt: new Date(),
      chargeAllocations: [],
      ...overrides,
    };
  }

  function overdueCharge(overrides: Record<string, unknown> = {}) {
    return openCharge({
      id: 'charge-overdue',
      description: 'Library Fee',
      amount: decimal(15000),
      dueDate: daysFromNow(-5),
      ...overrides,
    });
  }

  beforeEach(() => {
    prisma = {
      student: { findUnique: jest.fn(), findFirst: jest.fn() },
      schoolFinancialRecord: { findUnique: jest.fn() },
      schoolTransaction: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      kYCDocument: { findFirst: jest.fn().mockResolvedValue({ status: 'APPROVED' }) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };

    paymentPartner = {
      initiatePayment: jest
        .fn()
        .mockResolvedValue({ partnerReferenceId: 'SIM-ref-1', status: PaymentStatus.PENDING }),
      getPaymentStatus: jest
        .fn()
        .mockResolvedValue({ partnerReferenceId: 'SIM-ref-1', status: PaymentStatus.SUCCESSFUL }),
    };
    receiptsService = { generateReceiptPdf: jest.fn() };
    notificationsService = { notifyPaymentReviewed: jest.fn() };
    fxService = { getRate: jest.fn().mockResolvedValue(1) };

    paymentsService = new PaymentsService(
      prisma as unknown as PrismaService,
      paymentPartner as unknown as PaymentPartner,
      receiptsService as unknown as ReceiptsService,
      notificationsService as unknown as NotificationsService,
      fxService as unknown as FxService,
    );
  });

  describe('getOutstandingCharges', () => {
    it('returns [] when the student has no institution/school ID linked', async () => {
      prisma.student.findUnique.mockResolvedValue({ ...student, schoolId: null });

      const result = await paymentsService.getOutstandingCharges(student.id);

      expect(result).toEqual([]);
    });

    it('excludes charges fully covered by a COMPLETED payment', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findMany.mockResolvedValue([
        openCharge(),
        overdueCharge({
          chargeAllocations: [{ payment: { status: 'COMPLETED' } }],
        }),
      ]);

      const result = await paymentsService.getOutstandingCharges(student.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('charge-open');
    });

    it('marks a charge with a non-rejected covering payment as PAYMENT_PENDING and non-selectable', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findMany.mockResolvedValue([
        openCharge({ chargeAllocations: [{ payment: { status: 'PENDING_APPROVAL' } }] }),
      ]);

      const result = await paymentsService.getOutstandingCharges(student.id);

      expect(result[0].state).toBe('PAYMENT_PENDING');
      expect(result[0].selectable).toBe(false);
    });

    it('marks a charge with only a REJECTED covering payment as OPEN again', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findMany.mockResolvedValue([
        openCharge({ chargeAllocations: [{ payment: { status: 'REJECTED' } }] }),
      ]);

      const result = await paymentsService.getOutstandingCharges(student.id);

      expect(result[0].state).toBe('OPEN');
      expect(result[0].selectable).toBe(true);
    });

    it('marks a past-due, uncovered charge as OVERDUE and non-selectable', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findMany.mockResolvedValue([overdueCharge()]);

      const result = await paymentsService.getOutstandingCharges(student.id);

      expect(result[0].state).toBe('OVERDUE');
      expect(result[0].selectable).toBe(false);
    });
  });

  describe('quotePayment', () => {
    it('previews the FX conversion and fee without creating a payment', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      const charge = openCharge();
      prisma.schoolTransaction.findMany.mockResolvedValue([charge]);
      fxService.getRate.mockResolvedValue(0.00069);

      const result = await paymentsService.quotePayment(student.id, {
        chargeId: charge.id,
        sendCurrency: 'USD',
      });

      expect(fxService.getRate).toHaveBeenCalledWith('RWF', 'USD');
      expect(result).toEqual({
        chargeAmount: 100000,
        chargeCurrency: 'RWF',
        sendCurrency: 'USD',
        fxRate: 0.00069,
        convertedAmount: 69,
        feeAmount: 1.03,
        totalToPay: 70.03,
      });
      expect(prisma.schoolTransaction.create).not.toHaveBeenCalled();
      expect(paymentPartner.initiatePayment).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the student has not been KYC-approved', async () => {
      prisma.kYCDocument.findFirst.mockResolvedValue({ status: 'PENDING' });

      await expect(
        paymentsService.quotePayment(student.id, { sendCurrency: 'USD' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.student.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no financial record is linked', async () => {
      prisma.student.findUnique.mockResolvedValue({ ...student, schoolId: null });

      await expect(
        paymentsService.quotePayment(student.id, { sendCurrency: 'USD' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('initiatePayment', () => {
    it('throws NotFoundException when no financial record is linked', async () => {
      prisma.student.findUnique.mockResolvedValue({ ...student, schoolId: null });

      await expect(paymentsService.initiatePayment(student.id, validDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the student has not been KYC-approved', async () => {
      prisma.kYCDocument.findFirst.mockResolvedValue({ status: 'PENDING' });

      await expect(paymentsService.initiatePayment(student.id, validDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.student.findUnique).not.toHaveBeenCalled();
      expect(prisma.schoolTransaction.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when no KYC document has ever been submitted', async () => {
      prisma.kYCDocument.findFirst.mockResolvedValue(null);

      await expect(paymentsService.initiatePayment(student.id, validDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('initiates a payment for a single open charge, routed through the payment partner', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      const charge = openCharge();
      prisma.schoolTransaction.findMany.mockResolvedValue([charge]);
      prisma.schoolTransaction.create.mockResolvedValue({
        id: 'payment-1',
        status: 'INITIATED',
        amount: decimal(100000),
        currency: 'RWF',
        description: 'Payment for Tuition',
        occurredAt: new Date(),
        reviewedAt: null,
        reviewNote: null,
        paymentAllocations: [{ amount: decimal(100000), charge }],
      });

      const result = await paymentsService.initiatePayment(student.id, {
        chargeId: charge.id,
        ...validDto,
      });

      expect(result.status).toBe('INITIATED');
      expect(result.amount).toBe(100000);
      // The partner is paid the FX-converted total including the EduPay fee, not the raw
      // institution-currency charge amount - and the payer identifier is the phone number.
      expect(paymentPartner.initiatePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: '101500.00',
          currency: 'RWF',
          payerId: '+250788123456',
        }),
      );
      expect(prisma.schoolTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'INITIATED',
            amount: 100000,
            partnerReferenceId: 'SIM-ref-1',
            sendCurrency: 'RWF',
            fxRate: 1,
            convertedAmount: 100000,
            feeAmount: 1500,
            phoneNumber: '+250788123456',
            paymentAllocations: {
              create: [{ amount: charge.amount, charge: { connect: { id: charge.id } } }],
            },
          }),
        }),
      );
    });

    it('locks the FX rate/converted amount/fee onto the payment using the rate at initiate time', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      const charge = openCharge();
      prisma.schoolTransaction.findMany.mockResolvedValue([charge]);
      fxService.getRate.mockResolvedValue(0.00069);
      prisma.schoolTransaction.create.mockResolvedValue({
        id: 'payment-1',
        status: 'INITIATED',
        amount: decimal(100000),
        currency: 'RWF',
        description: 'Payment for Tuition',
        occurredAt: new Date(),
        reviewedAt: null,
        reviewNote: null,
        paymentAllocations: [{ amount: decimal(100000), charge }],
      });

      await paymentsService.initiatePayment(student.id, {
        chargeId: charge.id,
        sendCurrency: 'USD',
        phoneNumber: '+250788123456',
      });

      expect(fxService.getRate).toHaveBeenCalledWith('RWF', 'USD');
      expect(prisma.schoolTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sendCurrency: 'USD',
            fxRate: 0.00069,
            convertedAmount: 69,
            feeAmount: 1.03,
          }),
        }),
      );
    });

    it('surfaces the locked FX fields on the returned payment response', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      const charge = openCharge();
      prisma.schoolTransaction.findMany.mockResolvedValue([charge]);
      fxService.getRate.mockResolvedValue(0.00069);
      prisma.schoolTransaction.create.mockResolvedValue({
        id: 'payment-1',
        status: 'INITIATED',
        amount: decimal(100000),
        currency: 'RWF',
        description: 'Payment for Tuition',
        occurredAt: new Date(),
        reviewedAt: null,
        reviewNote: null,
        sendCurrency: 'USD',
        fxRate: decimal(0.00069),
        convertedAmount: decimal(69),
        feeAmount: decimal(1.03),
        phoneNumber: '+250788123456',
        paymentAllocations: [{ amount: decimal(100000), charge }],
      });

      const result = await paymentsService.initiatePayment(student.id, {
        chargeId: charge.id,
        sendCurrency: 'USD',
        phoneNumber: '+250788123456',
      });

      expect(result.sendCurrency).toBe('USD');
      expect(result.fxRate).toBe(0.00069);
      expect(result.convertedAmount).toBe(69);
      expect(result.feeAmount).toBe(1.03);
      expect(result.phoneNumber).toBe('+250788123456');
    });

    it('writes an INITIATED audit log entry in the same transaction as the create', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      const charge = openCharge();
      prisma.schoolTransaction.findMany.mockResolvedValue([charge]);
      prisma.schoolTransaction.create.mockResolvedValue({
        id: 'payment-1',
        status: 'INITIATED',
        amount: decimal(100000),
        currency: 'RWF',
        description: 'Payment for Tuition',
        occurredAt: new Date(),
        reviewedAt: null,
        reviewNote: null,
        paymentAllocations: [{ amount: decimal(100000), charge }],
      });

      await paymentsService.initiatePayment(student.id, { chargeId: charge.id, ...validDto });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          transactionId: 'payment-1',
          recordId: record.id,
          action: 'INITIATED',
          toStatus: 'INITIATED',
          actorRole: ActorRole.STUDENT,
          actorId: student.id,
        }),
      });
    });

    it('throws ConflictException (double-pay guard) when the charge already has a non-rejected payment', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      const charge = openCharge({
        chargeAllocations: [{ payment: { status: 'PENDING_APPROVAL' } }],
      });
      prisma.schoolTransaction.findMany.mockResolvedValue([charge]);

      await expect(
        paymentsService.initiatePayment(student.id, { chargeId: charge.id, ...validDto }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.schoolTransaction.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the given chargeId does not belong to this record', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findMany.mockResolvedValue([openCharge()]);

      await expect(
        paymentsService.initiatePayment(student.id, { chargeId: 'missing-charge', ...validDto }),
      ).rejects.toThrow(NotFoundException);
    });

    it('bundles all open and overdue charges (excluding payment-pending ones) for "pay full balance"', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      const open = openCharge();
      const overdue = overdueCharge();
      const pending = openCharge({
        id: 'charge-pending',
        description: 'Housing',
        amount: decimal(50000),
        chargeAllocations: [{ payment: { status: 'INITIATED' } }],
      });
      prisma.schoolTransaction.findMany.mockResolvedValue([open, overdue, pending]);
      prisma.schoolTransaction.create.mockResolvedValue({
        id: 'payment-1',
        status: 'INITIATED',
        amount: decimal(115000),
        currency: 'RWF',
        description: 'Payment for 2 outstanding charges',
        occurredAt: new Date(),
        reviewedAt: null,
        reviewNote: null,
        paymentAllocations: [
          { amount: decimal(100000), charge: open },
          { amount: decimal(15000), charge: overdue },
        ],
      });

      const result = await paymentsService.initiatePayment(student.id, { ...validDto });

      expect(result.charges).toHaveLength(2);
      const createArgs = prisma.schoolTransaction.create.mock.calls[0][0];
      expect(createArgs.data.amount).toBe(115000);
      expect(createArgs.data.paymentAllocations.create).toHaveLength(2);
    });

    it('throws ConflictException when paying full balance but nothing is outstanding', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.findMany.mockResolvedValue([
        openCharge({ chargeAllocations: [{ payment: { status: 'COMPLETED' } }] }),
      ]);

      await expect(paymentsService.initiatePayment(student.id, { ...validDto })).rejects.toThrow(
        ConflictException,
      );
    });

    describe('idempotency key', () => {
      it('returns the existing payment instead of creating a new one when the key was already used', async () => {
        const existingPayment = {
          id: 'payment-existing',
          status: 'INITIATED',
          amount: decimal(100000),
          currency: 'RWF',
          description: 'Payment for Tuition',
          occurredAt: new Date(),
          reviewedAt: null,
          reviewNote: null,
          paymentAllocations: [],
        };
        prisma.schoolTransaction.findUnique.mockResolvedValue(existingPayment);

        const result = await paymentsService.initiatePayment(student.id, {
          idempotencyKey: 'replay-key',
          ...validDto,
        });

        expect(result.id).toBe('payment-existing');
        expect(prisma.schoolTransaction.findUnique).toHaveBeenCalledWith({
          where: { idempotencyKey: 'replay-key' },
          include: { paymentAllocations: { include: { charge: true } } },
        });
        expect(prisma.student.findUnique).not.toHaveBeenCalled();
        expect(prisma.schoolTransaction.create).not.toHaveBeenCalled();
      });

      it('stores the idempotency key on a genuinely new payment', async () => {
        prisma.schoolTransaction.findUnique.mockResolvedValue(null);
        prisma.student.findUnique.mockResolvedValue(student);
        prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
        const charge = openCharge();
        prisma.schoolTransaction.findMany.mockResolvedValue([charge]);
        prisma.schoolTransaction.create.mockResolvedValue({
          id: 'payment-1',
          status: 'INITIATED',
          amount: decimal(100000),
          currency: 'RWF',
          description: 'Payment for Tuition',
          occurredAt: new Date(),
          reviewedAt: null,
          reviewNote: null,
          paymentAllocations: [{ amount: decimal(100000), charge }],
        });

        await paymentsService.initiatePayment(student.id, {
          chargeId: charge.id,
          idempotencyKey: 'fresh-key',
          ...validDto,
        });

        expect(prisma.schoolTransaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ idempotencyKey: 'fresh-key' }),
          }),
        );
      });

      it('recovers from a race (concurrent double-submit hitting the unique constraint) by returning the winning payment', async () => {
        prisma.schoolTransaction.findUnique
          .mockResolvedValueOnce(null) // pre-check: no existing payment for this key yet
          .mockResolvedValueOnce({
            id: 'payment-winner',
            status: 'INITIATED',
            amount: decimal(100000),
            currency: 'RWF',
            description: 'Payment for Tuition',
            occurredAt: new Date(),
            reviewedAt: null,
            reviewNote: null,
            paymentAllocations: [],
          });
        prisma.student.findUnique.mockResolvedValue(student);
        prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
        const charge = openCharge();
        prisma.schoolTransaction.findMany.mockResolvedValue([charge]);
        prisma.$transaction.mockImplementationOnce(() => {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
            meta: { target: ['idempotencyKey'] },
          });
        });

        const result = await paymentsService.initiatePayment(student.id, {
          chargeId: charge.id,
          idempotencyKey: 'racing-key',
          ...validDto,
        });

        expect(result.id).toBe('payment-winner');
      });
    });
  });

  describe('confirmPayment', () => {
    const initiatedPayment = {
      id: 'payment-1',
      type: 'PAYMENT',
      recordId: record.id,
      status: 'INITIATED',
      partnerReferenceId: 'SIM-ref-1',
      description: 'Payment for Tuition',
      amount: decimal(100000),
      currency: 'RWF',
      paymentAllocations: [],
    };

    it('moves an owned INITIATED payment to PENDING_APPROVAL after the partner confirms success', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(initiatedPayment);
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      prisma.schoolTransaction.update.mockResolvedValue({
        ...initiatedPayment,
        status: 'PENDING_APPROVAL',
        occurredAt: new Date(),
        reviewedAt: null,
        reviewNote: null,
      });

      const result = await paymentsService.confirmPayment('payment-1', student.id);

      expect(result.status).toBe('PENDING_APPROVAL');
      expect(paymentPartner.getPaymentStatus).toHaveBeenCalledWith('SIM-ref-1');
      expect(prisma.schoolTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1' },
          data: { status: 'PENDING_APPROVAL' },
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          transactionId: 'payment-1',
          action: 'CONFIRMED',
          fromStatus: 'INITIATED',
          toStatus: 'PENDING_APPROVAL',
          actorRole: ActorRole.STUDENT,
          actorId: student.id,
        }),
      });
    });

    it('throws ConflictException when the payment partner does not report success', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(initiatedPayment);
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      paymentPartner.getPaymentStatus.mockResolvedValue({
        partnerReferenceId: 'SIM-ref-1',
        status: PaymentStatus.FAILED,
      });

      await expect(paymentsService.confirmPayment('payment-1', student.id)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.schoolTransaction.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the payment belongs to a different student', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(initiatedPayment);
      prisma.student.findUnique.mockResolvedValue({ ...student, id: 'someone-else' });
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue({ ...record, id: 'other-record' });

      await expect(paymentsService.confirmPayment('payment-1', 'someone-else')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.schoolTransaction.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the payment is not in INITIATED state', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue({
        ...initiatedPayment,
        status: 'PENDING_APPROVAL',
      });
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);

      await expect(paymentsService.confirmPayment('payment-1', student.id)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when the payment does not exist', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(null);

      await expect(paymentsService.confirmPayment('missing', student.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancelPayment', () => {
    const initiatedPayment = {
      id: 'payment-1',
      type: 'PAYMENT',
      recordId: record.id,
      status: 'INITIATED',
      description: 'Payment for Tuition',
      amount: decimal(100000),
      currency: 'RWF',
      paymentAllocations: [],
    };

    it('deletes an owned INITIATED payment and writes a CANCELLED audit log entry first', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(initiatedPayment);
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);

      await paymentsService.cancelPayment('payment-1', student.id);

      expect(prisma.schoolTransaction.delete).toHaveBeenCalledWith({ where: { id: 'payment-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          transactionId: 'payment-1',
          action: 'CANCELLED',
          fromStatus: 'INITIATED',
          toStatus: null,
          actorRole: ActorRole.STUDENT,
          actorId: student.id,
        }),
      });
      // The audit entry must survive the transaction row being deleted - written first, same transaction.
      const auditCallOrder = prisma.auditLog.create.mock.invocationCallOrder[0];
      const deleteCallOrder = prisma.schoolTransaction.delete.mock.invocationCallOrder[0];
      expect(auditCallOrder).toBeLessThan(deleteCallOrder);
    });

    it("throws ForbiddenException when cancelling a payment that is not the caller's", async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(initiatedPayment);
      prisma.student.findUnique.mockResolvedValue({ ...student, id: 'someone-else' });
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue({ ...record, id: 'other-record' });

      await expect(paymentsService.cancelPayment('payment-1', 'someone-else')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.schoolTransaction.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the payment is no longer INITIATED', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue({
        ...initiatedPayment,
        status: 'COMPLETED',
      });
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);

      await expect(paymentsService.cancelPayment('payment-1', student.id)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.schoolTransaction.delete).not.toHaveBeenCalled();
    });
  });

  describe('listPendingApprovals', () => {
    const pendingPayment = {
      id: 'payment-1',
      status: 'PENDING_APPROVAL',
      amount: decimal(100000),
      currency: 'RWF',
      description: 'Payment for Tuition',
      occurredAt: new Date(),
      reviewedAt: null,
      reviewNote: null,
      record,
      paymentAllocations: [{ amount: decimal(100000), charge: openCharge() }],
    };

    it('scopes results to the institution admin institution', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([pendingPayment]);
      prisma.schoolTransaction.count.mockResolvedValue(1);
      prisma.student.findFirst.mockResolvedValue(student);

      await paymentsService.listPendingApprovals(ownInstitutionAdmin);

      expect(prisma.schoolTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            record: { institutionId: ownInstitutionAdmin.institutionId },
          }),
        }),
      );
    });

    it('returns every pending payment for a platform admin, paginated', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([pendingPayment]);
      prisma.schoolTransaction.count.mockResolvedValue(1);
      prisma.student.findFirst.mockResolvedValue(student);

      const result = await paymentsService.listPendingApprovals(platformAdmin);

      expect(prisma.schoolTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ record: undefined }) }),
      );
      expect(result.items[0].studentEmail).toBe(student.email);
      expect(result.items[0].schoolId).toBe(record.schoolId);
      expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
    });

    it('paginates using the given page/pageSize', async () => {
      prisma.schoolTransaction.findMany.mockResolvedValue([]);
      prisma.schoolTransaction.count.mockResolvedValue(50);

      const result = await paymentsService.listPendingApprovals(platformAdmin, {
        page: 3,
        pageSize: 20,
      });

      expect(prisma.schoolTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
      expect(result.meta).toEqual({ total: 50, page: 3, pageSize: 20, totalPages: 3 });
    });
  });

  describe('reviewPayment', () => {
    const pendingPayment = {
      id: 'payment-1',
      type: 'PAYMENT',
      status: 'PENDING_APPROVAL',
      amount: decimal(100000),
      currency: 'RWF',
      description: 'Payment for Tuition',
      occurredAt: new Date(),
      reviewedAt: null,
      reviewNote: null,
      record,
      paymentAllocations: [{ amount: decimal(100000), charge: openCharge() }],
    };

    it('approves a payment, setting status COMPLETED, logging it, and notifying the claiming student', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(pendingPayment);
      prisma.schoolTransaction.update.mockResolvedValue({
        ...pendingPayment,
        status: 'COMPLETED',
        reviewedAt: new Date(),
        reviewNote: 'Confirmed.',
      });
      prisma.student.findFirst.mockResolvedValue(student);

      const result = await paymentsService.reviewPayment('payment-1', platformAdmin, {
        status: 'COMPLETED',
        note: 'Confirmed.',
      });

      expect(result.status).toBe('COMPLETED');
      expect(prisma.schoolTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'COMPLETED', reviewedAt: expect.any(Date), reviewNote: 'Confirmed.' },
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'APPROVED',
          fromStatus: 'PENDING_APPROVAL',
          toStatus: 'COMPLETED',
          actorRole: ActorRole.PLATFORM_ADMIN,
          actorId: platformAdmin.id,
          note: 'Confirmed.',
        }),
      });
      expect(notificationsService.notifyPaymentReviewed).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ studentId: student.id, approved: true, paymentId: 'payment-1' }),
      );
    });

    it('rejects a payment, storing the reviewer note and notifying the claiming student', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(pendingPayment);
      prisma.schoolTransaction.update.mockResolvedValue({
        ...pendingPayment,
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewNote: 'Insufficient proof.',
      });
      prisma.student.findFirst.mockResolvedValue(student);

      const result = await paymentsService.reviewPayment('payment-1', ownInstitutionAdmin, {
        status: 'REJECTED',
        note: 'Insufficient proof.',
      });

      expect(result.status).toBe('REJECTED');
      expect(result.reviewNote).toBe('Insufficient proof.');
      expect(notificationsService.notifyPaymentReviewed).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ studentId: student.id, approved: false }),
      );
    });

    it('does not notify anyone when no EduPay account has claimed the underlying record', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(pendingPayment);
      prisma.schoolTransaction.update.mockResolvedValue({
        ...pendingPayment,
        status: 'COMPLETED',
        reviewedAt: new Date(),
      });
      prisma.student.findFirst.mockResolvedValue(null);

      await paymentsService.reviewPayment('payment-1', platformAdmin, { status: 'COMPLETED' });

      expect(notificationsService.notifyPaymentReviewed).not.toHaveBeenCalled();
    });

    it("throws ForbiddenException when an institution admin reviews another institution's payment", async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(pendingPayment);

      await expect(
        paymentsService.reviewPayment('payment-1', otherInstitutionAdmin, { status: 'COMPLETED' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.schoolTransaction.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the payment is not awaiting approval', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue({
        ...pendingPayment,
        status: 'INITIATED',
      });

      await expect(
        paymentsService.reviewPayment('payment-1', platformAdmin, { status: 'COMPLETED' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the payment does not exist', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(null);

      await expect(
        paymentsService.reviewPayment('missing', platformAdmin, { status: 'COMPLETED' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateReceipt', () => {
    const completedPayment = {
      id: 'payment-1',
      type: 'PAYMENT',
      status: 'COMPLETED',
      amount: decimal(100000),
      currency: 'RWF',
      description: 'Payment for Tuition',
      occurredAt: new Date(),
      reviewedAt: new Date(),
      recordId: record.id,
      record: { ...record, institution: { name: 'University of Rwanda' } },
      paymentAllocations: [{ amount: decimal(100000), charge: { description: 'Tuition' } }],
    };

    it('passes the locked FX fields through to the receipt PDF generator', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue({
        ...completedPayment,
        sendCurrency: 'USD',
        fxRate: decimal(0.00069),
        convertedAmount: decimal(69),
        feeAmount: decimal(1.03),
      });
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      receiptsService.generateReceiptPdf.mockResolvedValue(Buffer.from('pdf-bytes'));

      const studentUser = { id: student.id, email: student.email, role: ActorRole.STUDENT };
      await paymentsService.generateReceipt('payment-1', studentUser);

      expect(receiptsService.generateReceiptPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          sendCurrency: 'USD',
          fxRate: 0.00069,
          convertedAmount: 69,
          feeAmount: 1.03,
        }),
      );
    });

    it('passes null FX fields through for a payment made without cross-border conversion data', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(completedPayment);
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      receiptsService.generateReceiptPdf.mockResolvedValue(Buffer.from('pdf-bytes'));

      const studentUser = { id: student.id, email: student.email, role: ActorRole.STUDENT };
      await paymentsService.generateReceipt('payment-1', studentUser);

      expect(receiptsService.generateReceiptPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          sendCurrency: undefined,
          fxRate: null,
          convertedAmount: null,
          feeAmount: null,
        }),
      );
    });

    it('generates a receipt for the owning student', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(completedPayment);
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue(record);
      receiptsService.generateReceiptPdf.mockResolvedValue(Buffer.from('pdf-bytes'));

      const studentUser = { id: student.id, email: student.email, role: ActorRole.STUDENT };
      const result = await paymentsService.generateReceipt('payment-1', studentUser);

      expect(result).toEqual(Buffer.from('pdf-bytes'));
      expect(receiptsService.generateReceiptPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentReference: 'payment-1',
          institutionName: 'University of Rwanda',
          amount: 100000,
        }),
      );
    });

    it('generates a receipt for a reviewing institution admin of the same institution', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(completedPayment);
      receiptsService.generateReceiptPdf.mockResolvedValue(Buffer.from('pdf-bytes'));

      const result = await paymentsService.generateReceipt('payment-1', ownInstitutionAdmin);

      expect(result).toEqual(Buffer.from('pdf-bytes'));
    });

    it("throws ForbiddenException for a student who doesn't own the payment", async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(completedPayment);
      prisma.student.findUnique.mockResolvedValue({ ...student, id: 'someone-else' });
      prisma.schoolFinancialRecord.findUnique.mockResolvedValue({ ...record, id: 'other-record' });

      const studentUser = { id: 'someone-else', email: 'x@example.com', role: ActorRole.STUDENT };

      await expect(paymentsService.generateReceipt('payment-1', studentUser)).rejects.toThrow(
        ForbiddenException,
      );
      expect(receiptsService.generateReceiptPdf).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for an institution admin of a different institution', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(completedPayment);

      await expect(
        paymentsService.generateReceipt('payment-1', otherInstitutionAdmin),
      ).rejects.toThrow(ForbiddenException);
      expect(receiptsService.generateReceiptPdf).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the payment does not exist', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue(null);

      await expect(paymentsService.generateReceipt('missing', platformAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the payment has not reached COMPLETED yet', async () => {
      prisma.schoolTransaction.findUnique.mockResolvedValue({
        ...completedPayment,
        status: 'PENDING_APPROVAL',
      });

      await expect(paymentsService.generateReceipt('payment-1', platformAdmin)).rejects.toThrow(
        ConflictException,
      );
      expect(receiptsService.generateReceiptPdf).not.toHaveBeenCalled();
    });
  });
});
