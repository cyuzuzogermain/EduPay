import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SchoolTransactionResponseDto } from './school-transaction-response.dto';

export class StudentBalanceResponseDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  studentName!: string;

  @ApiPropertyOptional({ nullable: true })
  program!: string | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'Current outstanding balance - charges minus completed payments' })
  totalBalance!: number;

  @ApiProperty({ type: [SchoolTransactionResponseDto] })
  transactions!: SchoolTransactionResponseDto[];
}
