import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { SEND_CURRENCIES, SendCurrency } from '../currencies';

export class QuotePaymentDto {
  @ApiPropertyOptional({
    description:
      'Preview this single outstanding charge. Omit to preview the full outstanding balance.',
  })
  @IsOptional()
  @IsString()
  chargeId?: string;

  @ApiProperty({
    enum: SEND_CURRENCIES,
    example: 'USD',
    description: 'Currency the student intends to pay in',
  })
  @IsIn(SEND_CURRENCIES)
  sendCurrency!: SendCurrency;
}
