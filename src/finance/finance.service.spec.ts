import { FinanceService } from './finance.service';
import { PrismaService } from '../prisma/prisma.service';

function decimal(value: number) {
  return { toNumber: () => value };
}

describe('FinanceService', () => {
  let financeService: FinanceService;
  let prisma: {
    student: { findUnique: jest.Mock };
    schoolFinancialRecord: { findUnique: jest.Mock };
  };

  const student = {
    id: 'student-1',
    institutionId: 'institution-1',
    schoolId: 'STU-1001',
  };

  beforeEach(() => {
    prisma = {
      student: { findUnique: jest.fn() },
      schoolFinancialRecord: { findUnique: jest.fn() },
    };

    financeService = new FinanceService(prisma as unknown as PrismaService);
  });

  it('returns null when the student has no institution linked', async () => {
    prisma.student.findUnique.mockResolvedValue({ ...student, institutionId: null });

    const result = await financeService.getBalanceForStudent(student.id);

    expect(result).toBeNull();
    expect(prisma.schoolFinancialRecord.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when the student has no school ID set', async () => {
    prisma.student.findUnique.mockResolvedValue({ ...student, schoolId: null });

    const result = await financeService.getBalanceForStudent(student.id);

    expect(result).toBeNull();
    expect(prisma.schoolFinancialRecord.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when the student does not exist', async () => {
    prisma.student.findUnique.mockResolvedValue(null);

    const result = await financeService.getBalanceForStudent('missing');

    expect(result).toBeNull();
  });

  it('returns null when no matching financial record exists', async () => {
    prisma.student.findUnique.mockResolvedValue(student);
    prisma.schoolFinancialRecord.findUnique.mockResolvedValue(null);

    const result = await financeService.getBalanceForStudent(student.id);

    expect(prisma.schoolFinancialRecord.findUnique).toHaveBeenCalledWith({
      where: {
        institutionId_schoolId: {
          institutionId: student.institutionId,
          schoolId: student.schoolId,
        },
      },
      include: { transactions: { orderBy: { occurredAt: 'desc' } } },
    });
    expect(result).toBeNull();
  });

  it('maps a matched record and its transactions, converting decimals to numbers', async () => {
    prisma.student.findUnique.mockResolvedValue(student);
    prisma.schoolFinancialRecord.findUnique.mockResolvedValue({
      id: 'record-1',
      institutionId: student.institutionId,
      schoolId: student.schoolId,
      studentName: 'Aline Uwase',
      program: 'Computer Science, Year 1',
      currency: 'RWF',
      createdAt: new Date(),
      updatedAt: new Date(),
      transactions: [
        {
          id: 'tx-1',
          recordId: 'record-1',
          type: 'CHARGE',
          status: 'PENDING',
          description: 'Semester 1 Tuition Fee',
          amount: decimal(450000),
          currency: 'RWF',
          dueDate: null,
          occurredAt: new Date(),
          createdAt: new Date(),
        },
      ],
    });

    const result = await financeService.getBalanceForStudent(student.id);

    expect(result).toEqual({
      schoolId: 'STU-1001',
      studentName: 'Aline Uwase',
      program: 'Computer Science, Year 1',
      currency: 'RWF',
      totalBalance: 450000,
      transactions: [
        expect.objectContaining({
          id: 'tx-1',
          type: 'CHARGE',
          status: 'PENDING',
          description: 'Semester 1 Tuition Fee',
          amount: 450000,
          currency: 'RWF',
          dueDate: null,
        }),
      ],
    });
  });

  it('subtracts COMPLETED payments from the balance but not other payment statuses', async () => {
    prisma.student.findUnique.mockResolvedValue(student);
    prisma.schoolFinancialRecord.findUnique.mockResolvedValue({
      id: 'record-1',
      institutionId: student.institutionId,
      schoolId: student.schoolId,
      studentName: 'Eric Niyonzima',
      program: 'Business Administration, Year 2',
      currency: 'RWF',
      createdAt: new Date(),
      updatedAt: new Date(),
      transactions: [
        {
          id: 'tx-charge',
          recordId: 'record-1',
          type: 'CHARGE',
          status: 'PENDING',
          description: 'Tuition',
          amount: decimal(500000),
          currency: 'RWF',
          dueDate: null,
          occurredAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: 'tx-completed',
          recordId: 'record-1',
          type: 'PAYMENT',
          status: 'COMPLETED',
          description: 'Payment for Tuition',
          amount: decimal(200000),
          currency: 'RWF',
          dueDate: null,
          occurredAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: 'tx-pending-approval',
          recordId: 'record-1',
          type: 'PAYMENT',
          status: 'PENDING_APPROVAL',
          description: 'Payment for Tuition',
          amount: decimal(150000),
          currency: 'RWF',
          dueDate: null,
          occurredAt: new Date(),
          createdAt: new Date(),
        },
      ],
    });

    const result = await financeService.getBalanceForStudent(student.id);

    // 500000 charged - 200000 completed = 300000; the pending-approval payment doesn't count
    expect(result?.totalBalance).toBe(300000);
  });
});
