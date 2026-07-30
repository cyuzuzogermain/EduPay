import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { PendingPaymentResponseDto } from './pending-payment-response.dto';

export class PaginatedPendingPaymentsResponseDto {
  @ApiProperty({ type: [PendingPaymentResponseDto] })
  items!: PendingPaymentResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
