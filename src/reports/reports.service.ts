import { Injectable } from '@nestjs/common';
import { Prisma, SchoolTransactionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta, paginationSkipTake } from '../common/pagination.util';
import { ReportFiltersDto } from './dto/report-filters.dto';
import { PaymentReportRowDto } from './dto/payment-report-row.dto';
import { PaginatedReportResponseDto } from './dto/paginated-report-response.dto';

type ReportRow = Prisma.SchoolTransactionGetPayload<{
  include: { record: true; paymentAllocations: { include: { charge: true } } };
}>;

const CSV_HEADERS = [
  'Payment ID',
  'Student',
  'School ID',
  'Description',
  'Charges Covered',
  'Amount Received (Institution Currency)',
  'Institution Currency',
  'Send Currency',
  'FX Rate',
  'Converted Amount',
  'Fee Amount',
  'Status',
  'Initiated At',
  'Reviewed At',
];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getInstitutionReport(
    institutionId: string,
    filters: ReportFiltersDto,
  ): Promise<PaginatedReportResponseDto> {
    const where = this.buildWhere(institutionId, filters);
    const { skip, take, page, pageSize } = paginationSkipTake(filters.page, filters.pageSize);

    const [payments, total] = await Promise.all([
      this.prisma.schoolTransaction.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip,
        take,
        include: { record: true, paymentAllocations: { include: { charge: true } } },
      }),
      this.prisma.schoolTransaction.count({ where }),
    ]);

    return {
      items: payments.map((payment) => this.toReportRow(payment)),
      meta: buildPaginationMeta(total, page, pageSize),
    };
  }

  async exportInstitutionReportCsv(
    institutionId: string,
    filters: ReportFiltersDto,
  ): Promise<string> {
    const where = this.buildWhere(institutionId, filters);

    const payments = await this.prisma.schoolTransaction.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      include: { record: true, paymentAllocations: { include: { charge: true } } },
    });

    return this.toCsv(payments.map((payment) => this.toReportRow(payment)));
  }

  private buildWhere(
    institutionId: string,
    filters: ReportFiltersDto,
  ): Prisma.SchoolTransactionWhereInput {
    const where: Prisma.SchoolTransactionWhereInput = {
      type: 'PAYMENT',
      record: {
        institutionId,
        ...(filters.schoolId
          ? { schoolId: { contains: filters.schoolId, mode: 'insensitive' } }
          : {}),
      },
    };

    if (filters.status) {
      where.status = filters.status as SchoolTransactionStatus;
    }

    if (filters.dateFrom || filters.dateTo) {
      where.occurredAt = {
        ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: this.endOfDay(filters.dateTo) } : {}),
      };
    }

    return where;
  }

  private endOfDay(isoDate: string): Date {
    const date = new Date(isoDate);
    date.setHours(23, 59, 59, 999);
    return date;
  }

  private toReportRow(payment: ReportRow): PaymentReportRowDto {
    return {
      id: payment.id,
      studentName: payment.record.studentName,
      schoolId: payment.record.schoolId,
      description: payment.description,
      chargesCovered: payment.paymentAllocations
        .map((allocation) => allocation.charge.description)
        .join('; '),
      amount: payment.amount.toNumber(),
      currency: payment.currency,
      sendCurrency: payment.sendCurrency,
      fxRate: payment.fxRate ? payment.fxRate.toNumber() : null,
      convertedAmount: payment.convertedAmount ? payment.convertedAmount.toNumber() : null,
      feeAmount: payment.feeAmount ? payment.feeAmount.toNumber() : null,
      status: payment.status,
      occurredAt: payment.occurredAt,
      reviewedAt: payment.reviewedAt,
    };
  }

  private toCsv(rows: PaymentReportRowDto[]): string {
    const escape = (value: string | number): string => `"${String(value).replace(/"/g, '""')}"`;

    const lines = [CSV_HEADERS.map(escape).join(',')];

    for (const row of rows) {
      lines.push(
        [
          row.id,
          row.studentName,
          row.schoolId,
          row.description,
          row.chargesCovered,
          row.amount,
          row.currency,
          row.sendCurrency ?? '',
          row.fxRate ?? '',
          row.convertedAmount ?? '',
          row.feeAmount ?? '',
          row.status,
          row.occurredAt.toISOString(),
          row.reviewedAt ? row.reviewedAt.toISOString() : '',
        ]
          .map(escape)
          .join(','),
      );
    }

    return lines.join('\r\n');
  }
}
