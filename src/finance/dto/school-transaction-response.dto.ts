import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SchoolTransactionStatus, SchoolTransactionType } from '@prisma/client';

export class SchoolTransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: SchoolTransactionType })
  type!: SchoolTransactionType;

  @ApiProperty({ enum: SchoolTransactionStatus })
  status!: SchoolTransactionStatus;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiPropertyOptional({ nullable: true })
  dueDate!: Date | null;

  @ApiProperty()
  occurredAt!: Date;

  @ApiPropertyOptional({ nullable: true, description: 'When a PAYMENT was approved/rejected' })
  reviewedAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Reviewer note, especially useful when a PAYMENT is rejected',
  })
  reviewNote!: string | null;
}
