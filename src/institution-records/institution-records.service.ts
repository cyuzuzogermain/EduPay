import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parse } from 'csv-parse/sync';
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
import { ImportSkippedRowDto, ImportSummaryDto } from './dto/import-summary.dto';
import {
  CSV_IMPORT_REQUIRED_COLUMNS,
  MAX_CSV_FILE_SIZE_BYTES,
  isCsvFile,
} from './csv-import.constants';

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

export interface ImportedCsvFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

interface CsvRow {
  rowNumber: number;
  schoolId: string;
  studentName: string;
  program: string;
  chargeDescription: string;
  chargeAmount: string;
  chargeDueDate: string;
}

interface CsvRecordGroup {
  schoolId: string;
  studentName: string;
  program: string | null;
  rowNumbers: number[];
  charges: { description: string; amount: number; dueDate: string }[];
}

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

  /// Bulk-creates records (and their charges) from a CSV file, scoped to the requester's own
  /// institution - never lets a row target another institution, since institutionId always comes
  /// from `user`, never from the file. One row = one charge; rows sharing a schoolId are grouped
  /// into a single record (see CSV_IMPORT_COLUMNS). Every row is validated independently first
  /// (no DB write yet); only groups that are entirely valid at the schoolId/studentName level get
  /// written, each in its own transaction (record + all its valid charges together), so a bad row
  /// never blocks the rest of the file and a crash mid-import never leaves a record with only
  /// some of its charges committed.
  async importCsv(user: AuthenticatedUser, file: ImportedCsvFile): Promise<ImportSummaryDto> {
    this.assertCsvFile(file);

    const institutionId = user.institutionId as string;
    const institution = await this.prisma.institution.findUniqueOrThrow({
      where: { id: institutionId },
    });

    const rows = this.parseCsvRows(file.buffer);

    const existingRecords = await this.prisma.schoolFinancialRecord.findMany({
      where: { institutionId },
      select: { schoolId: true },
    });
    const existingSchoolIds = new Set(existingRecords.map((r) => r.schoolId));

    const skipped: ImportSkippedRowDto[] = [];
    const groups = new Map<string, CsvRecordGroup>();

    for (const row of rows) {
      const schoolId = row.schoolId.trim();
      const studentName = row.studentName.trim();
      const description = row.chargeDescription.trim();
      const dueDateRaw = row.chargeDueDate.trim();
      const amountRaw = row.chargeAmount.trim();

      if (!schoolId) {
        skipped.push({ row: row.rowNumber, reason: 'Missing schoolId' });
        continue;
      }
      if (studentName.length < 2) {
        skipped.push({ row: row.rowNumber, reason: 'Missing or too-short studentName' });
        continue;
      }
      if (existingSchoolIds.has(schoolId)) {
        skipped.push({
          row: row.rowNumber,
          reason: `schoolId "${schoolId}" already exists at this institution`,
        });
        continue;
      }
      if (!description) {
        skipped.push({ row: row.rowNumber, reason: 'Missing chargeDescription' });
        continue;
      }

      const amount = Number(amountRaw);
      if (!amountRaw || Number.isNaN(amount) || amount <= 0) {
        skipped.push({ row: row.rowNumber, reason: `Invalid chargeAmount "${amountRaw}"` });
        continue;
      }
      if (!dueDateRaw || Number.isNaN(Date.parse(dueDateRaw))) {
        skipped.push({ row: row.rowNumber, reason: `Invalid chargeDueDate "${dueDateRaw}"` });
        continue;
      }

      let group = groups.get(schoolId);
      if (!group) {
        group = {
          schoolId,
          studentName,
          program: row.program.trim() || null,
          rowNumbers: [],
          charges: [],
        };
        groups.set(schoolId, group);
      }
      group.rowNumbers.push(row.rowNumber);
      group.charges.push({ description, amount, dueDate: dueDateRaw });
    }

    let recordsCreated = 0;
    let chargesCreated = 0;

    for (const group of groups.values()) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const record = await tx.schoolFinancialRecord.create({
            data: {
              institutionId,
              schoolId: group.schoolId,
              studentName: group.studentName,
              program: group.program,
              currency: institution.preferredCurrency,
            },
          });

          await tx.schoolTransaction.createMany({
            data: group.charges.map((charge) => ({
              recordId: record.id,
              type: SchoolTransactionType.CHARGE,
              status: SchoolTransactionStatus.PENDING,
              description: charge.description,
              amount: charge.amount,
              currency: institution.preferredCurrency,
              dueDate: new Date(charge.dueDate),
              occurredAt: new Date(),
            })),
          });
        });

        recordsCreated += 1;
        chargesCreated += group.charges.length;
      } catch (error) {
        const reason = this.isUniqueConstraintViolation(error, 'schoolId')
          ? `schoolId "${group.schoolId}" was claimed by another request during import`
          : 'Unexpected error while saving this record - it was not created';

        for (const rowNumber of group.rowNumbers) {
          skipped.push({ row: rowNumber, reason });
        }
      }
    }

    return {
      recordsCreated,
      chargesCreated,
      skipped: skipped.sort((a, b) => a.row - b.row),
    };
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

  private assertCsvFile(file: ImportedCsvFile): void {
    if (!isCsvFile(file)) {
      throw new BadRequestException('Only .csv files are accepted');
    }

    if (file.size > MAX_CSV_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `CSV file must be ${MAX_CSV_FILE_SIZE_BYTES / (1024 * 1024)}MB or smaller`,
      );
    }
  }

  private parseCsvRows(buffer: Buffer): CsvRow[] {
    let records: Record<string, string>[];

    try {
      records = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } catch (error) {
      throw new BadRequestException(`Could not parse CSV file: ${(error as Error).message}`);
    }

    if (records.length === 0) {
      throw new BadRequestException('CSV file has no data rows');
    }

    const headerColumns = Object.keys(records[0]);
    const missingColumns = CSV_IMPORT_REQUIRED_COLUMNS.filter(
      (column) => !headerColumns.includes(column),
    );

    if (missingColumns.length > 0) {
      throw new BadRequestException(
        `CSV is missing required column(s): ${missingColumns.join(', ')}`,
      );
    }

    return records.map((record, index) => ({
      // +1 to move from a 0-based array index to a 1-based row, +1 more because row 1 is the
      // header - so the first data row (index 0) is row 2, matching what a spreadsheet shows.
      rowNumber: index + 2,
      schoolId: record.schoolId ?? '',
      studentName: record.studentName ?? '',
      program: record.program ?? '',
      chargeDescription: record.chargeDescription ?? '',
      chargeAmount: record.chargeAmount ?? '',
      chargeDueDate: record.chargeDueDate ?? '',
    }));
  }

  private isUniqueConstraintViolation(error: unknown, field: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = (error.meta as { target?: string[] } | undefined)?.target;
    return Array.isArray(target) && target.includes(field);
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
