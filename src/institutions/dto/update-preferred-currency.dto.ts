import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { SEND_CURRENCIES, SendCurrency } from '../../payments/currencies';

export class UpdatePreferredCurrencyDto {
  @ApiProperty({ enum: SEND_CURRENCIES, example: 'RWF' })
  @IsIn(SEND_CURRENCIES)
  preferredCurrency!: SendCurrency;
}
