import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ActorRole, AuditAction, KYCStatus, Prisma, SchoolTransactionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { buildPaginationMeta, paginationSkipTake } from '../common/pagination.util';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { QuotePaymentDto } from './dto/quote-payment.dto';
import { PaymentQuoteResponseDto } from './dto/payment-quote-response.dto';
import { ReviewPaymentDto } from './dto/review-payment.dto';
import { ChargeResponseDto, ChargeState } from './dto/charge-response.dto';
import { PaymentChargeSummaryDto, PaymentResponseDto } from './dto/payment-response.dto';
import { PendingPaymentResponseDto } from './dto/pending-payment-response.dto';
import { PaginatedPendingPaymentsResponseDto } from './dto/paginated-pending-payments-response.dto';
import {
  PAYMENT_PARTNER,
  PaymentCurrency,
  PaymentPartner,
  PaymentStatus as PartnerPaymentStatus,
} from '../payment-partners/interfaces/payment-partner.interface';
import { ReceiptsService } from '../receipts/receipts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FxService } from '../fx/fx.service';

type ChargeWithAllocations = Prisma.SchoolTransactionGetPayload<{
  include: { chargeAllocations: { include: { payment: true } } };
}>;

type PaymentWithAllocations = Prisma.SchoolTransactionGetPayload<{
  include: { paymentAllocations: { include: { charge: true } } };
}>;

const PARTNER_CURRENCIES = new Set<string>(Object.values(PaymentCurrency));

/// The student covers this on top of what's owed - the institution always receives the full
/// charge amount in its own preferredCurrency, untouched.
const FEE_RATE = 0.015;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PARTNER) private readonly paymentPartner: PaymentPartner,
    private readonly receiptsService: ReceiptsService,
    private readonly notificationsService: NotificationsService,
    private readonly fxService: FxService,
  ) {}

  async getOutstandingCharges(studentId: string): Promise<ChargeResponseDto[]> {
    const record = await this.getRecordForStudent(studentId);

    if (!record) {
      return [];
    }

    const charges = await this.prisma.schoolTransaction.findMany({
      where: { recordId: record.id, type: 'CHARGE' },
      orderBy: { dueDate: 'asc' },
      include: { chargeAllocations: { include: { payment: true } } },
    });

    return charges
      .map((charge) => this.toChargeResponse(charge))
      .filter((charge) => charge.state !== ChargeState.PAID);
  }

  /// Lets the student preview the FX conversion + fee disclosure before committing to a payment -
  /// pure computation, no payment record created, so it can be called freely as they change the
  /// charge or send-currency selection.
  async quotePayment(studentId: string, dto: QuotePaymentDto): Promise<PaymentQuoteResponseDto> {
    await this.assertKycApproved(studentId);

    const record = await this.getRecordForStudent(studentId);

    if (!record) {
      throw new NotFoundException('No financial record is linked to this account yet');
    }

    const { totalAmount } = await this.resolveTargetCharges(record.id, dto.chargeId);

    return this.buildQuote(record.currency, totalAmount, dto.sendCurrency);
  }

  async initiatePayment(studentId: string, dto: InitiatePaymentDto): Promise<PaymentResponseDto> {
    if (dto.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(dto.idempotencyKey);
      if (existing) {
        return this.toPaymentResponse(existing);
      }
    }

    // Server-side, not just hidden in the UI - checked here regardless of whether the request
    // came from the web page's fetch() or a direct JSON API call.
    await this.assertKycApproved(studentId);

    const record = await this.getRecordForStudent(studentId);

    if (!record) {
      throw new NotFoundException('No financial record is linked to this account yet');
    }

    const { targetCharges, totalAmount, description } = await this.resolveTargetCharges(
      record.id,
      dto.chargeId,
    );

    // The rate/converted amount/fee are computed once, right here, and locked onto the payment
    // row below - never recomputed later. Receipts, history, and reports always read back
    // exactly what was quoted at this moment, even if the live rate has since moved.
    const quote = await this.buildQuote(record.currency, totalAmount, dto.sendCurrency);

    const paymentId = randomUUID();

    // Simulates the "start a MoMo collection request" call to the payment partner - happens
    // outside the DB transaction below, same as a real HTTP call to a partner would. Collects
    // the full amount the student pays (converted charge total + fee) in their own currency.
    const partnerResult = await this.paymentPartner.initiatePayment({
      amount: quote.totalToPay.toFixed(2),
      currency: PARTNER_CURRENCIES.has(dto.sendCurrency)
        ? (dto.sendCurrency as PaymentCurrency)
        : PaymentCurrency.RWF,
      payerId: dto.phoneNumber,
      externalReferenceId: paymentId,
      payerMessage: description,
    });

    try {
      const payment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.schoolTransaction.create({
          data: {
            id: paymentId,
            recordId: record.id,
            type: 'PAYMENT',
            status: SchoolTransactionStatus.INITIATED,
            description,
            amount: totalAmount,
            currency: record.currency,
            occurredAt: new Date(),
            partnerReferenceId: partnerResult.partnerReferenceId,
            idempotencyKey: dto.idempotencyKey || null,
            sendCurrency: dto.sendCurrency,
            fxRate: quote.fxRate,
            convertedAmount: quote.convertedAmount,
            feeAmount: quote.feeAmount,
            phoneNumber: dto.phoneNumber,
            paymentAllocations: {
              create: targetCharges.map((charge) => ({
                amount: charge.amount,
                charge: { connect: { id: charge.id } },
              })),
            },
          },
          include: { paymentAllocations: { include: { charge: true } } },
        });

        await tx.auditLog.create({
          data: {
            transactionId: created.id,
            recordId: record.id,
            action: AuditAction.INITIATED,
            toStatus: SchoolTransactionStatus.INITIATED,
            description: created.description,
            amount: created.amount,
            currency: created.currency,
            actorRole: ActorRole.STUDENT,
            actorId: studentId,
          },
        });

        return created;
      });

      return this.toPaymentResponse(payment);
    } catch (error) {
      if (dto.idempotencyKey && this.isUniqueConstraintViolation(error, 'idempotencyKey')) {
        const existing = await this.findByIdempotencyKey(dto.idempotencyKey);
        if (existing) {
          return this.toPaymentResponse(existing);
        }
      }
      throw error;
    }
  }

  async confirmPayment(paymentId: string, studentId: string): Promise<PaymentResponseDto> {
    const payment = await this.getOwnedInitiatedPayment(paymentId, studentId);

    // Simulates polling the partner for the outcome of the "approve on your phone" step.
    const statusResult = await this.paymentPartner.getPaymentStatus(
      payment.partnerReferenceId ?? payment.id,
    );

    if (statusResult.status !== PartnerPaymentStatus.SUCCESSFUL) {
      throw new ConflictException('The payment partner could not confirm this payment');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.schoolTransaction.update({
        where: { id: paymentId },
        data: { status: SchoolTransactionStatus.PENDING_APPROVAL },
        include: { paymentAllocations: { include: { charge: true } } },
      });

      await tx.auditLog.create({
        data: {
          transactionId: result.id,
          recordId: result.recordId,
          action: AuditAction.CONFIRMED,
          fromStatus: SchoolTransactionStatus.INITIATED,
          toStatus: SchoolTransactionStatus.PENDING_APPROVAL,
          description: result.description,
          amount: result.amount,
          currency: result.currency,
          actorRole: ActorRole.STUDENT,
          actorId: studentId,
        },
      });

      return result;
    });

    return this.toPaymentResponse(updated);
  }

  async cancelPayment(paymentId: string, studentId: string): Promise<void> {
    const payment = await this.getOwnedInitiatedPayment(paymentId, studentId);

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          transactionId: payment.id,
          recordId: payment.recordId,
          action: AuditAction.CANCELLED,
          fromStatus: SchoolTransactionStatus.INITIATED,
          toStatus: null,
          description: payment.description,
          amount: payment.amount,
          currency: payment.currency,
          actorRole: ActorRole.STUDENT,
          actorId: studentId,
        },
      });

      await tx.schoolTransaction.delete({ where: { id: paymentId } });
    });
  }

  async listPendingApprovals(
    requester: AuthenticatedUser,
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedPendingPaymentsResponseDto> {
    const { skip, take, page, pageSize } = paginationSkipTake(pagination.page, pagination.pageSize);

    const where: Prisma.SchoolTransactionWhereInput = {
      type: 'PAYMENT',
      status: SchoolTransactionStatus.PENDING_APPROVAL,
      record:
        requester.role === ActorRole.INSTITUTION_ADMIN
          ? { institutionId: requester.institutionId }
          : undefined,
    };

    const [payments, total] = await Promise.all([
      this.prisma.schoolTransaction.findMany({
        where,
        orderBy: { occurredAt: 'asc' },
        skip,
        take,
        include: { record: true, paymentAllocations: { include: { charge: true } } },
      }),
      this.prisma.schoolTransaction.count({ where }),
    ]);

    const items: PendingPaymentResponseDto[] = [];

    for (const payment of payments) {
      const student = await this.prisma.student.findFirst({
        where: { institutionId: payment.record.institutionId, schoolId: payment.record.schoolId },
      });

      items.push({
        ...this.toPaymentResponse(payment),
        studentId: student?.id ?? null,
        studentEmail: student?.email ?? null,
        studentName: payment.record.studentName,
        schoolId: payment.record.schoolId,
        institutionId: payment.record.institutionId,
      });
    }

    return { items, meta: buildPaginationMeta(total, page, pageSize) };
  }

  async reviewPayment(
    paymentId: string,
    requester: AuthenticatedUser,
    dto: ReviewPaymentDto,
  ): Promise<PaymentResponseDto> {
    const payment = await this.prisma.schoolTransaction.findUnique({
      where: { id: paymentId },
      include: { record: true, paymentAllocations: { include: { charge: true } } },
    });

    if (!payment || payment.type !== 'PAYMENT') {
      throw new NotFoundException('Payment not found');
    }

    this.assertReviewerAccess(requester, payment.record.institutionId);

    if (payment.status !== SchoolTransactionStatus.PENDING_APPROVAL) {
      throw new ConflictException('This payment is not awaiting approval');
    }

    const approved = dto.status === SchoolTransactionStatus.COMPLETED;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.schoolTransaction.update({
        where: { id: paymentId },
        data: { status: dto.status, reviewedAt: new Date(), reviewNote: dto.note || null },
        include: { paymentAllocations: { include: { charge: true } } },
      });

      await tx.auditLog.create({
        data: {
          transactionId: result.id,
          recordId: payment.record.id,
          action: approved ? AuditAction.APPROVED : AuditAction.REJECTED,
          fromStatus: SchoolTransactionStatus.PENDING_APPROVAL,
          toStatus: dto.status,
          description: result.description,
          amount: result.amount,
          currency: result.currency,
          actorRole: requester.role,
          actorId: requester.id,
          note: dto.note || null,
        },
      });

      const student = await tx.student.findFirst({
        where: { institutionId: payment.record.institutionId, schoolId: payment.record.schoolId },
      });

      if (student) {
        await this.notificationsService.notifyPaymentReviewed(tx, {
          studentId: student.id,
          approved,
          description: result.description,
          amount: result.amount.toNumber(),
          currency: result.currency,
          paymentId: result.id,
        });
      }

      return result;
    });

    return this.toPaymentResponse(updated);
  }

  async generateReceipt(paymentId: string, requester: AuthenticatedUser): Promise<Buffer> {
    const payment = await this.prisma.schoolTransaction.findUnique({
      where: { id: paymentId },
      include: {
        record: { include: { institution: true } },
        paymentAllocations: { include: { charge: true } },
      },
    });

    if (!payment || payment.type !== 'PAYMENT') {
      throw new NotFoundException('Payment not found');
    }

    if (requester.role === ActorRole.STUDENT) {
      const record = await this.getRecordForStudent(requester.id);
      if (!record || record.id !== payment.recordId) {
        throw new ForbiddenException('You do not have access to this payment');
      }
    } else {
      this.assertReviewerAccess(requester, payment.record.institutionId);
    }

    if (payment.status !== SchoolTransactionStatus.COMPLETED) {
      throw new ConflictException('A receipt is only available for a completed payment');
    }

    return this.receiptsService.generateReceiptPdf({
      paymentReference: payment.id,
      studentName: payment.record.studentName,
      institutionName: payment.record.institution.name,
      schoolId: payment.record.schoolId,
      program: payment.record.program,
      charges: payment.paymentAllocations.map((allocation) => ({
        description: allocation.charge.description,
        amount: allocation.amount.toNumber(),
      })),
      amount: payment.amount.toNumber(),
      currency: payment.currency,
      paidAt: payment.reviewedAt ?? payment.occurredAt,
      sendCurrency: payment.sendCurrency,
      fxRate: payment.fxRate ? payment.fxRate.toNumber() : null,
      convertedAmount: payment.convertedAmount ? payment.convertedAmount.toNumber() : null,
      feeAmount: payment.feeAmount ? payment.feeAmount.toNumber() : null,
    });
  }

  /// A student may only initiate (or quote) a payment once their latest KYC document has been
  /// approved - enforced here so it applies identically to the web page's fetch() and any
  /// direct JSON API call, not just hidden behind a disabled button.
  private async assertKycApproved(studentId: string): Promise<void> {
    const latestDocument = await this.prisma.kYCDocument.findFirst({
      where: { studentId },
      orderBy: { submittedAt: 'desc' },
    });

    if (latestDocument?.status !== KYCStatus.APPROVED) {
      throw new ForbiddenException(
        'Your KYC must be approved before you can make a payment. Submit your documents at /kyc.',
      );
    }
  }

  /// Shared by quotePayment and initiatePayment - resolves either the single requested charge
  /// (must be OPEN) or every OPEN/OVERDUE charge for "pay full balance", identically in both
  /// places so a quote can never show something initiate would then reject.
  private async resolveTargetCharges(
    recordId: string,
    chargeId?: string,
  ): Promise<{ targetCharges: ChargeWithAllocations[]; totalAmount: number; description: string }> {
    const charges = await this.prisma.schoolTransaction.findMany({
      where: { recordId, type: 'CHARGE' },
      include: { chargeAllocations: { include: { payment: true } } },
    });

    let targetCharges: ChargeWithAllocations[];

    if (chargeId) {
      const charge = charges.find((c) => c.id === chargeId);

      if (!charge) {
        throw new NotFoundException('Charge not found');
      }

      if (this.computeChargeState(charge) !== ChargeState.OPEN) {
        throw new ConflictException('This charge is not available to pay individually right now');
      }

      targetCharges = [charge];
    } else {
      targetCharges = charges.filter((charge) => {
        const state = this.computeChargeState(charge);
        return state === ChargeState.OPEN || state === ChargeState.OVERDUE;
      });

      if (targetCharges.length === 0) {
        throw new ConflictException('There is nothing outstanding to pay');
      }
    }

    const totalAmount = targetCharges.reduce((sum, charge) => sum + charge.amount.toNumber(), 0);
    const description = chargeId
      ? `Payment for ${targetCharges[0].description}`
      : `Payment for ${targetCharges.length} outstanding charge${targetCharges.length > 1 ? 's' : ''}`;

    return { targetCharges, totalAmount, description };
  }

  private async buildQuote(
    chargeCurrency: string,
    chargeAmount: number,
    sendCurrency: string,
  ): Promise<PaymentQuoteResponseDto> {
    const fxRate = await this.fxService.getRate(chargeCurrency, sendCurrency);
    const convertedAmount = this.round2(chargeAmount * fxRate);
    const feeAmount = this.round2(convertedAmount * FEE_RATE);
    const totalToPay = this.round2(convertedAmount + feeAmount);

    return {
      chargeAmount,
      chargeCurrency,
      sendCurrency,
      fxRate,
      convertedAmount,
      feeAmount,
      totalToPay,
    };
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PaymentWithAllocations | null> {
    return this.prisma.schoolTransaction.findUnique({
      where: { idempotencyKey },
      include: { paymentAllocations: { include: { charge: true } } },
    });
  }

  private isUniqueConstraintViolation(error: unknown, field: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = (error.meta as { target?: string[] } | undefined)?.target;
    return Array.isArray(target) && target.includes(field);
  }

  private async getOwnedInitiatedPayment(
    paymentId: string,
    studentId: string,
  ): Promise<PaymentWithAllocations> {
    const payment = await this.prisma.schoolTransaction.findUnique({
      where: { id: paymentId },
      include: { paymentAllocations: { include: { charge: true } } },
    });

    if (!payment || payment.type !== 'PAYMENT') {
      throw new NotFoundException('Payment not found');
    }

    const record = await this.getRecordForStudent(studentId);

    if (!record || record.id !== payment.recordId) {
      throw new ForbiddenException('You do not have access to this payment');
    }

    if (payment.status !== SchoolTransactionStatus.INITIATED) {
      throw new ConflictException('This payment can no longer be modified');
    }

    return payment;
  }

  private async getRecordForStudent(studentId: string) {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });

    if (!student?.institutionId || !student?.schoolId) {
      return null;
    }

    return this.prisma.schoolFinancialRecord.findUnique({
      where: {
        institutionId_schoolId: {
          institutionId: student.institutionId,
          schoolId: student.schoolId,
        },
      },
    });
  }

  private assertReviewerAccess(requester: AuthenticatedUser, recordInstitutionId: string): void {
    if (
      requester.role === ActorRole.INSTITUTION_ADMIN &&
      requester.institutionId !== recordInstitutionId
    ) {
      throw new ForbiddenException('You do not have access to this payment');
    }
  }

  private computeChargeState(charge: ChargeWithAllocations): ChargeState {
    const nonRejected = charge.chargeAllocations.filter(
      (allocation) => allocation.payment.status !== SchoolTransactionStatus.REJECTED,
    );

    if (
      nonRejected.some(
        (allocation) => allocation.payment.status === SchoolTransactionStatus.COMPLETED,
      )
    ) {
      return ChargeState.PAID;
    }

    if (nonRejected.length > 0) {
      return ChargeState.PAYMENT_PENDING;
    }

    if (charge.dueDate && charge.dueDate < new Date()) {
      return ChargeState.OVERDUE;
    }

    return ChargeState.OPEN;
  }

  private toChargeResponse(charge: ChargeWithAllocations): ChargeResponseDto {
    const state = this.computeChargeState(charge);

    return {
      id: charge.id,
      description: charge.description,
      amount: charge.amount.toNumber(),
      currency: charge.currency,
      dueDate: charge.dueDate,
      state,
      selectable: state === ChargeState.OPEN,
    };
  }

  private toPaymentResponse(payment: PaymentWithAllocations): PaymentResponseDto {
    const charges: PaymentChargeSummaryDto[] = payment.paymentAllocations.map((allocation) => ({
      id: allocation.charge.id,
      description: allocation.charge.description,
      amount: allocation.amount.toNumber(),
    }));

    return {
      id: payment.id,
      status: payment.status,
      amount: payment.amount.toNumber(),
      currency: payment.currency,
      description: payment.description,
      occurredAt: payment.occurredAt,
      reviewedAt: payment.reviewedAt,
      reviewNote: payment.reviewNote,
      charges,
      sendCurrency: payment.sendCurrency,
      fxRate: payment.fxRate ? payment.fxRate.toNumber() : null,
      convertedAmount: payment.convertedAmount ? payment.convertedAmount.toNumber() : null,
      feeAmount: payment.feeAmount ? payment.feeAmount.toNumber() : null,
      phoneNumber: payment.phoneNumber,
    };
  }
}
