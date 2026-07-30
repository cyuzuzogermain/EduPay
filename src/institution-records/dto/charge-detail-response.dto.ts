import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChargeDetailResponseDto {
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

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({
    description:
      'False when a payment (INITIATED, PENDING_APPROVAL, or COMPLETED) is already attached - it must be rejected first',
  })
  editable!: boolean;
}
