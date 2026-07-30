import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SchoolTransactionStatus, SchoolTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { buildPaginationMeta, paginationSkipTake } from '../common/pagination.util';
import { CreateRecordDto } from './dto/create-record.dto';
import { AddChargeDto } from './dto/add-charge.dto';
import { UpdateChargeDto } from './dto/update-charge.dto';
import { RecordResponseDto, RecordSummaryResponseDto } from './dto/record-response.dto';
import { RecordDetailResponseDto } from './dto/record-detail-response.dto';
import { ChargeDetailResponseDto } from './dto/charge-detail-response.dto';
import { PaginatedRecordsResponseDto } from './dto/paginated-records-response.dto';

export interface ListRecordsQuery extends PaginationQueryDto {
  /** Case-insensitive contains match against schoolId or studentName. */
  search?: string;
}

type PlainRecord = Prisma.SchoolFinancialRecordGetPayload<Record<string, never>>;

type RecordWithTransactions = Prisma.SchoolFinancialRecordGetPayload<{
  include: { transactions: true };
}>;

type TransactionWithAllocations = Prisma.SchoolTransactionGetPayload<{
  include: { chargeAllocations: { include: { payment: true } } };
}>;

@Injectable()
export class InstitutionRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
  ) {}

  async listForInstitution(
    user: AuthenticatedUser,
    query: ListRecordsQuery = {},
  ): Promise<PaginatedRecordsResponseDto> {
    const { skip, take, page, pageSize } = paginationSkipTake(query.page, query.pageSize);

    const where: Prisma.SchoolFinancialRecordWhereInput = {
      institutionId: user.institutionId,
      ...(query.search
        ? {
            OR: [
              { schoolId: { contains: query.search, mode: 'insensitive' } },
              { studentName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [records, total] = await Promise.all([
      this.prisma.schoolFinancialRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { transactions: true },
      }),
      this.prisma.schoolFinancialRecord.count({ where }),
    ]);

    return {
      items: records.map((record) => this.toSummaryResponse(record)),
      meta: buildPaginationMeta(total, page, pageSize),
    };
  }

  /// Institution-wide snapshot for the records page's stat tiles - deliberately separate from
  /// listForInstitution since that's paginated/search-filtered and would give a misleading
  /// "total" if driven off a single page. totalOutstanding only sums records still denominated
  /// in the institution's CURRENT preferredCurrency - records left over from before a currency
  /// change keep their own currency (see Institution.preferredCurrency in schema.prisma) and
  /// summing across currencies would produce a meaningless number, so those are excluded here
  /// (they're still visible, correctly, on each record's own row in the table).
  async getInstitutionStats(institutionId: string): Promise<{
    recordCount: number;
    settledCount: number;
    totalOutstanding: number;
    preferredCurrency: string;
  }> {
    const institution = await this.prisma.institution.findUniqueOrThrow({
      where: { id: institutionId },
    });

    const records = await this.prisma.schoolFinancialRecord.findMany({
      where: { institutionId },
      include: { transactions: true },
    });

    let settledCount = 0;
    let totalOutstanding = 0;

    for (const record of records) {
      const outstanding = this.financeService.calculateOutstandingBalance(record.transactions);

      if (outstanding === 0) {
        settledCount += 1;
      }

      if (record.currency === institution.preferredCurrency) {
        totalOutstanding += outstanding;
      }
    }

    return {
      recordCount: records.length,
      settledCount,
      totalOutstanding,
      preferredCurrency: institution.preferredCurrency,
    };
  }

  async create(user: AuthenticatedUser, dto: CreateRecordDto): Promise<RecordResponseDto> {
    const institutionId = user.institutionId as string;

    await this.assertSchoolIdAvailable(institutionId, dto.schoolId);

    // New records are denominated in the institution's CURRENT preferred currency - a snapshot,
    // not a live reference, so a later currency change never retroactively reinterprets what's
    // already on file (see Institution.preferredCurrency in schema.prisma).
    const institution = await this.prisma.institution.findUniqueOrThrow({
      where: { id: institutionId },
    });

    const record = await this.prisma.schoolFinancialRecord.create({
      data: {
        institutionId,
        schoolId: dto.schoolId,
        studentName: dto.studentName,
        program: dto.program ?? null,
        currency: institution.preferredCurrency,
      },
    });

    return this.toRecordResponse(record);
  }

  async getDetail(id: string, user: AuthenticatedUser): Promise<RecordDetailResponseDto> {
    const record = await this.getOwnedRecord(id, user);

    const transactions = await this.prisma.schoolTransaction.findMany({
      where: { recordId: record.id },
      include: { chargeAllocations: { include: { payment: true } } },
    });

    const charges = transactions
      .filter((transaction) => transaction.type === SchoolTransactionType.CHARGE)
      .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity));

    return {
      ...this.toRecordResponse(record),
      outstandingBalance: this.financeService.calculateOutstandingBalance(transactions),
      charges: charges.map((charge) => this.toChargeDetailResponse(charge)),
    };
  }

  async addCharge(
    recordId: string,
    user: AuthenticatedUser,
    dto: AddChargeDto,
  ): Promise<ChargeDetailResponseDto> {
    const record = await this.getOwnedRecord(recordId, user);

    const charge = await this.prisma.schoolTransaction.create({
      data: {
        recordId: record.id,
        type: SchoolTransactionType.CHARGE,
        status: SchoolTransactionStatus.PENDING,
        description: dto.description,
        amount: dto.amount,
        currency: record.currency,
        dueDate: new Date(dto.dueDate),
        occurredAt: new Date(),
      },
    });

    return this.toChargeDetailResponse({ ...charge, chargeAllocations: [] });
  }

  async updateCharge(
    recordId: string,
    chargeId: string,
    user: AuthenticatedUser,
    dto: UpdateChargeDto,
  ): Promise<ChargeDetailResponseDto> {
    const charge = await this.getEditableCharge(recordId, chargeId, user);

    const updated = await this.prisma.schoolTransaction.update({
      where: { id: charge.id },
      data: {
        description: dto.description ?? undefined,
        amount: dto.amount ?? undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });

    return this.toChargeDetailResponse({
      ...updated,
      chargeAllocations: charge.chargeAllocations,
    });
  }

  async deleteCharge(recordId: string, chargeId: string, user: AuthenticatedUser): Promise<void> {
    const charge = await this.getEditableCharge(recordId, chargeId, user);

    await this.prisma.schoolTransaction.delete({ where: { id: charge.id } });
  }

  private async assertSchoolIdAvailable(institutionId: string, schoolId: string): Promise<void> {
    const existing = await this.prisma.schoolFinancialRecord.findUnique({
      where: { institutionId_schoolId: { institutionId, schoolId } },
    });

    if (existing) {
      throw new ConflictException(
        'A financial record with this school ID already exists for your institution',
      );
    }
  }

  private async getOwnedRecord(id: string, user: AuthenticatedUser): Promise<PlainRecord> {
    const record = await this.prisma.schoolFinancialRecord.findUnique({ where: { id } });

    if (!record) {
      throw new NotFoundException('Financial record not found');
    }

    if (record.institutionId !== user.institutionId) {
      throw new ForbiddenException('You do not have access to this financial record');
    }

    return record;
  }

  /// A charge may only be edited or deleted while every payment attached to it is REJECTED -
  /// the same rule PaymentsService.computeChargeState uses to decide whether a charge is still
  /// "OPEN" for the double-pay guard, applied here to protect against admins mutating a charge
  /// a student has already initiated, confirmed, or completed a payment against.
  private async getEditableCharge(
    recordId: string,
    chargeId: string,
    user: AuthenticatedUser,
  ): Promise<TransactionWithAllocations> {
    const record = await this.getOwnedRecord(recordId, user);

    const charge = await this.prisma.schoolTransaction.findUnique({
      where: { id: chargeId },
      include: { chargeAllocations: { include: { payment: true } } },
    });

    if (!charge || charge.recordId !== record.id || charge.type !== SchoolTransactionType.CHARGE) {
      throw new NotFoundException('Charge not found');
    }

    if (this.hasLivePayment(charge)) {
      throw new ConflictException(
        'This charge has a payment attached (initiated, pending approval, or completed) - it can only be edited or deleted once that payment is rejected',
      );
    }

    return charge;
  }

  private hasLivePayment(charge: TransactionWithAllocations): boolean {
    return charge.chargeAllocations.some(
      (allocation) => allocation.payment.status !== SchoolTransactionStatus.REJECTED,
    );
  }

  private toRecordResponse(record: PlainRecord): RecordResponseDto {
    return {
      id: record.id,
      institutionId: record.institutionId,
      schoolId: record.schoolId,
      studentName: record.studentName,
      program: record.program,
      currency: record.currency,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toSummaryResponse(record: RecordWithTransactions): RecordSummaryResponseDto {
    return {
      ...this.toRecordResponse(record),
      outstandingBalance: this.financeService.calculateOutstandingBalance(record.transactions),
    };
  }

  private toChargeDetailResponse(charge: TransactionWithAllocations): ChargeDetailResponseDto {
    return {
      id: charge.id,
      description: charge.description,
      amount: charge.amount.toNumber(),
      currency: charge.currency,
      dueDate: charge.dueDate,
      createdAt: charge.createdAt,
      editable: !this.hasLivePayment(charge),
    };
  }
}
