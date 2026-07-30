import { ApiProperty } from '@nestjs/swagger';

export class PaymentQuoteResponseDto {
  @ApiProperty({ description: "The charge total, in the institution's preferred currency" })
  chargeAmount!: number;

  @ApiProperty({ description: "The institution's preferred currency" })
  chargeCurrency!: string;

  @ApiProperty({ description: 'The currency the student chose to send in' })
  sendCurrency!: string;

  @ApiProperty({ description: '1 unit of chargeCurrency = fxRate units of sendCurrency' })
  fxRate!: number;

  @ApiProperty({
    description: 'chargeAmount converted into sendCurrency at fxRate, before the fee',
  })
  convertedAmount!: number;

  @ApiProperty({ description: 'EduPay transaction fee - 1.5% of convertedAmount, in sendCurrency' })
  feeAmount!: number;

  @ApiProperty({
    description: 'convertedAmount + feeAmount, in sendCurrency - what the student pays',
  })
  totalToPay!: number;
}
