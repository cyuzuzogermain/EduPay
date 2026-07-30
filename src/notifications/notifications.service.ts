import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationResponseDto } from './dto/notification-response.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /// Called from PaymentsService.reviewPayment inside the same transaction as the status
  /// change, so the notification never exists without the review that caused it (or vice versa).
  async notifyPaymentReviewed(
    tx: Prisma.TransactionClient,
    params: {
      studentId: string;
      approved: boolean;
      description: string;
      amount: number;
      currency: string;
      paymentId: string;
    },
  ): Promise<void> {
    const type = params.approved
      ? NotificationType.PAYMENT_APPROVED
      : NotificationType.PAYMENT_REJECTED;
    const formattedAmount = `${params.currency} ${params.amount.toLocaleString()}`;
    const message = params.approved
      ? `Your payment of ${formattedAmount} for "${params.description}" was approved.`
      : `Your payment of ${formattedAmount} for "${params.description}" was rejected.`;

    await tx.notification.create({
      data: {
        studentId: params.studentId,
        type,
        message,
        paymentId: params.paymentId,
      },
    });
  }

  async listForStudent(studentId: string): Promise<NotificationResponseDto[]> {
    const notifications = await this.prisma.notification.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
    });

    return notifications.map((notification) => this.toResponse(notification));
  }

  async countUnread(studentId: string): Promise<number> {
    return this.prisma.notification.count({ where: { studentId, read: false } });
  }

  async markAllRead(studentId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { studentId, read: false },
      data: { read: true },
    });
  }

  private toResponse(
    notification: Prisma.NotificationGetPayload<Record<string, never>>,
  ): NotificationResponseDto {
    return {
      id: notification.id,
      type: notification.type,
      message: notification.message,
      paymentId: notification.paymentId,
      read: notification.read,
      createdAt: notification.createdAt,
    };
  }
}
