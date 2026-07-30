import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KYCStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewKycDto {
  @ApiProperty({ enum: [KYCStatus.APPROVED, KYCStatus.REJECTED] })
  @IsIn([KYCStatus.APPROVED, KYCStatus.REJECTED])
  status!: KYCStatus;

  @ApiPropertyOptional({
    description: 'Explanation shown to the student, especially useful when rejecting',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
