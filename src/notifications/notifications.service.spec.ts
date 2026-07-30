import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let notificationsService: NotificationsService;
  let prisma: {
    notification: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let tx: { notification: { create: jest.Mock } };

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    tx = { notification: { create: jest.fn() } };

    notificationsService = new NotificationsService(prisma as unknown as PrismaService);
  });

  describe('notifyPaymentReviewed', () => {
    it('creates a PAYMENT_APPROVED notification with a formatted message when approved', async () => {
      await notificationsService.notifyPaymentReviewed(tx as never, {
        studentId: 'student-1',
        approved: true,
        description: 'Tuition',
        amount: 450000,
        currency: 'RWF',
        paymentId: 'payment-1',
      });

      expect(tx.notification.create).toHaveBeenCalledWith({
        data: {
          studentId: 'student-1',
          type: 'PAYMENT_APPROVED',
          message: 'Your payment of RWF 450,000 for "Tuition" was approved.',
          paymentId: 'payment-1',
        },
      });
    });

    it('creates a PAYMENT_REJECTED notification with a formatted message when rejected', async () => {
      await notificationsService.notifyPaymentReviewed(tx as never, {
        studentId: 'student-1',
        approved: false,
        description: 'Tuition',
        amount: 450000,
        currency: 'RWF',
        paymentId: 'payment-1',
      });

      expect(tx.notification.create).toHaveBeenCalledWith({
        data: {
          studentId: 'student-1',
          type: 'PAYMENT_REJECTED',
          message: 'Your payment of RWF 450,000 for "Tuition" was rejected.',
          paymentId: 'payment-1',
        },
      });
    });

    it('writes through the given transaction client, not the module-level prisma client', async () => {
      await notificationsService.notifyPaymentReviewed(tx as never, {
        studentId: 'student-1',
        approved: true,
        description: 'Tuition',
        amount: 1000,
        currency: 'RWF',
        paymentId: 'payment-1',
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('listForStudent', () => {
    it('returns the student notifications newest first', async () => {
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'n-1',
          type: 'PAYMENT_APPROVED',
          message: 'Approved.',
          paymentId: 'payment-1',
          read: false,
          createdAt: new Date(),
        },
      ]);

      const result = await notificationsService.listForStudent('student-1');

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('n-1');
    });
  });

  describe('countUnread', () => {
    it('counts only unread notifications for the student', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await notificationsService.countUnread('student-1');

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { studentId: 'student-1', read: false },
      });
      expect(result).toBe(3);
    });
  });

  describe('markAllRead', () => {
    it('flips every unread notification for the student to read', async () => {
      await notificationsService.markAllRead('student-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1', read: false },
        data: { read: true },
      });
    });
  });
});
