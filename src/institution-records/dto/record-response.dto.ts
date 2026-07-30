import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  institutionId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  studentName!: string;

  @ApiPropertyOptional({ nullable: true })
  program!: string | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class RecordSummaryResponseDto extends RecordResponseDto {
  @ApiProperty({ description: 'Charges minus COMPLETED payments' })
  outstandingBalance!: number;
}
