import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { SEND_CURRENCIES, SendCurrency } from '../currencies';
import { PHONE_NUMBER_PATTERN } from '../phone-number';

export class InitiatePaymentDto {
  @ApiPropertyOptional({
    description: 'Pay this single outstanding charge. Omit to pay the full outstanding balance.',
  })
  @IsOptional()
  @IsString()
  chargeId?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated key (e.g. a UUID minted once per "Initiate payment" click). A repeat ' +
      'request with the same key returns the original payment instead of creating a duplicate - ' +
      'guards against double-submit from a double-click or a retried request.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;

  @ApiProperty({
    enum: SEND_CURRENCIES,
    example: 'USD',
    description: 'Currency the student is paying in',
  })
  @IsIn(SEND_CURRENCIES)
  sendCurrency!: SendCurrency;

  @ApiProperty({
    example: '+250788123456',
    description: 'Phone number used for the (simulated) MoMo prompt',
  })
  @IsString()
  @Matches(PHONE_NUMBER_PATTERN, { message: 'phoneNumber must be a plausible phone number' })
  phoneNumber!: string;
}
