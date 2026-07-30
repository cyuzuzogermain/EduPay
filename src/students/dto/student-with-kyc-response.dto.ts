import { ApiPropertyOptional } from '@nestjs/swagger';
import { KYCStatus } from '@prisma/client';
import { StudentResponseDto } from './student-response.dto';

export class StudentWithKycResponseDto extends StudentResponseDto {
  @ApiPropertyOptional({ enum: KYCStatus, nullable: true })
  kycStatus!: KYCStatus | null;
}
