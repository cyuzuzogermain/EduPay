import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { SEND_CURRENCIES, SendCurrency } from '../../payments/currencies';

export class CreateInstitutionDto {
  @ApiProperty({ example: 'University of Rwanda' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 'Rwanda' })
  @IsString()
  @MinLength(2)
  country!: string;

  @ApiProperty({ example: 'finance@ur.ac.rw' })
  @IsEmail()
  contactEmail!: string;

  @ApiProperty({
    enum: SEND_CURRENCIES,
    example: 'RWF',
    description: 'The currency this institution is owed in and receives funds in',
  })
  @IsIn(SEND_CURRENCIES)
  preferredCurrency!: SendCurrency;
}
