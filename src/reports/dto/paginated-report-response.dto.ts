import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { PaymentReportRowDto } from './payment-report-row.dto';

export class PaginatedReportResponseDto {
  @ApiProperty({ type: [PaymentReportRowDto] })
  items!: PaymentReportRowDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
