import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentResponseDto } from './payment-response.dto';

export class PendingPaymentResponseDto extends PaymentResponseDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'The EduPay student account that claimed this record, if any',
  })
  studentId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  studentEmail!: string | null;

  @ApiProperty({ description: "Student's name as recorded in the institution's own records" })
  studentName!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  institutionId!: string;
}
