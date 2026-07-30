import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentPartnersModule } from '../payment-partners/payment-partners.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FxModule } from '../fx/fx.module';

@Module({
  imports: [PaymentPartnersModule, ReceiptsModule, NotificationsModule, FxModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
