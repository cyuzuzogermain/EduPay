import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { KycFileController } from './kyc-file.controller';
import { StudentsService } from './students.service';
import { KycStorageService } from './kyc-storage.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [StudentsController, KycFileController],
  providers: [StudentsService, KycStorageService],
  exports: [StudentsService],
})
export class StudentsModule {}
