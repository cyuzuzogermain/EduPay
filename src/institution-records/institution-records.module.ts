import { Module } from '@nestjs/common';
import { InstitutionRecordsController } from './institution-records.controller';
import { InstitutionRecordsService } from './institution-records.service';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [FinanceModule],
  controllers: [InstitutionRecordsController],
  providers: [InstitutionRecordsService],
  exports: [InstitutionRecordsService],
})
export class InstitutionRecordsModule {}
