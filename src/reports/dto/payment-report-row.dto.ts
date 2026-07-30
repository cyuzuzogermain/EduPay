import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SchoolTransactionStatus } from '@prisma/client';

export class PaymentReportRowDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentName!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  chargesCovered!: string;

  @ApiProperty({ description: 'Amount received by the institution, in its preferred currency' })
  amount!: number;

  @ApiProperty({ description: "The institution's preferred currency" })
  currency!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Currency the student paid in' })
  sendCurrency!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: '1 unit of `currency` = fxRate units of sendCurrency',
  })
  fxRate!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: '`amount` converted into sendCurrency, before the fee',
  })
  convertedAmount!: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'EduPay fee (1.5%), in sendCurrency' })
  feeAmount!: number | null;

  @ApiProperty({ enum: SchoolTransactionStatus })
  status!: SchoolTransactionStatus;

  @ApiProperty()
  occurredAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  reviewedAt!: Date | null;
}
