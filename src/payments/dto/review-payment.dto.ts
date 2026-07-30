import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SchoolTransactionStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewPaymentDto {
  @ApiProperty({ enum: [SchoolTransactionStatus.COMPLETED, SchoolTransactionStatus.REJECTED] })
  @IsIn([SchoolTransactionStatus.COMPLETED, SchoolTransactionStatus.REJECTED])
  status!: SchoolTransactionStatus;

  @ApiPropertyOptional({
    description: 'Explanation shown to the student, especially useful when rejecting',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
