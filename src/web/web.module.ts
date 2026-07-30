import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { InstitutionsModule } from '../institutions/institutions.module';
import { FinanceModule } from '../finance/finance.module';
import { PaymentsModule } from '../payments/payments.module';
import { InstitutionRecordsModule } from '../institution-records/institution-records.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { AuthWebController } from './auth.web.controller';
import { StudentWebController } from './student.web.controller';
import { InstitutionWebController } from './institution.web.controller';
import { AdminWebController } from './admin.web.controller';
import { OptionalAuthMiddleware } from './optional-auth.middleware';

@Module({
  imports: [
    AuthModule,
    StudentsModule,
    InstitutionsModule,
    FinanceModule,
    PaymentsModule,
    InstitutionRecordsModule,
    NotificationsModule,
    ReportsModule,
  ],
  controllers: [
    AuthWebController,
    StudentWebController,
    InstitutionWebController,
    AdminWebController,
  ],
})
export class WebModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OptionalAuthMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
