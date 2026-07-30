import { Injectable } from '@nestjs/common';
import { Prisma, SchoolTransactionStatus, SchoolTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StudentBalanceResponseDto } from './dto/student-balance-response.dto';
import { SchoolTransactionResponseDto } from './dto/school-transaction-response.dto';

type RecordWithTransactions = Prisma.SchoolFinancialRecordGetPayload<{
  include: { transactions: true };
}>;

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Matches a student to their institution's school-records system by (institutionId, schoolId).
   * Returns null when the student hasn't linked an institution/school ID yet, or when no
   * matching record exists in the school's system for that pair - both are normal, expected
   * states, not errors.
   */
  async getBalanceForStudent(studentId: string): Promise<StudentBalanceResponseDto | null> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });

    if (!student?.institutionId || !student?.schoolId) {
      return null;
    }

    const record = await this.prisma.schoolFinancialRecord.findUnique({
      where: {
        institutionId_schoolId: {
          institutionId: student.institutionId,
          schoolId: student.schoolId,
        },
      },
      include: { transactions: { orderBy: { occurredAt: 'desc' } } },
    });

    if (!record) {
      return null;
    }

    return this.toBalanceResponse(record);
  }

  private toBalanceResponse(record: RecordWithTransactions): StudentBalanceResponseDto {
    return {
      schoolId: record.schoolId,
      studentName: record.studentName,
      program: record.program,
      currency: record.currency,
      totalBalance: this.calculateOutstandingBalance(record.transactions),
      transactions: record.transactions.map((transaction) =>
        this.toTransactionResponse(transaction),
      ),
    };
  }

  /** Charges minus COMPLETED payments only - INITIATED/PENDING_APPROVAL/REJECTED payments never affect this. */
  calculateOutstandingBalance(
    transactions: Prisma.SchoolTransactionGetPayload<Record<string, never>>[],
  ): number {
    return transactions.reduce((balance, transaction) => {
      if (transaction.type === SchoolTransactionType.CHARGE) {
        return balance + transaction.amount.toNumber();
      }
      if (
        transaction.type === SchoolTransactionType.PAYMENT &&
        transaction.status === SchoolTransactionStatus.COMPLETED
      ) {
        return balance - transaction.amount.toNumber();
      }
      return balance;
    }, 0);
  }

  private toTransactionResponse(
    transaction: Prisma.SchoolTransactionGetPayload<Record<string, never>>,
  ): SchoolTransactionResponseDto {
    return {
      id: transaction.id,
      type: transaction.type,
      status: transaction.status,
      description: transaction.description,
      amount: transaction.amount.toNumber(),
      currency: transaction.currency,
      dueDate: transaction.dueDate,
      occurredAt: transaction.occurredAt,
      reviewedAt: transaction.reviewedAt,
      reviewNote: transaction.reviewNote,
    };
  }
}
