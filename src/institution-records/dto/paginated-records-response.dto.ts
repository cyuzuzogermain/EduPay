import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { RecordSummaryResponseDto } from './record-response.dto';

export class PaginatedRecordsResponseDto {
  @ApiProperty({ type: [RecordSummaryResponseDto] })
  items!: RecordSummaryResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
