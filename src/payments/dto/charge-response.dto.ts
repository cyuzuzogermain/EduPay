import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ChargeState {
  OPEN = 'OPEN',
  OVERDUE = 'OVERDUE',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAID = 'PAID',
}

export class ChargeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiPropertyOptional({ nullable: true })
  dueDate!: Date | null;

  @ApiProperty({ enum: ChargeState })
  state!: ChargeState;

  @ApiProperty({ description: 'Whether this charge can be selected to pay individually right now' })
  selectable!: boolean;
}
