import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SchoolTransactionStatus } from '@prisma/client';

export class PaymentChargeSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  amount!: number;
}

export class PaymentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: SchoolTransactionStatus })
  status!: SchoolTransactionStatus;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  occurredAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  reviewedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  reviewNote!: string | null;

  @ApiProperty({ type: [PaymentChargeSummaryDto] })
  charges!: PaymentChargeSummaryDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Currency the student paid in' })
  sendCurrency!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      '1 unit of `currency` (institution) = fxRate units of sendCurrency, locked at initiate time',
  })
  fxRate!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: '`amount` converted into sendCurrency, before the fee',
  })
  convertedAmount!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'EduPay fee (1.5% of convertedAmount), in sendCurrency',
  })
  feeAmount!: number | null;

  @ApiPropertyOptional({ nullable: true })
  phoneNumber!: string | null;
}
