import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { InstitutionResponseDto } from './institution-response.dto';

export class PaginatedInstitutionsResponseDto {
  @ApiProperty({ type: [InstitutionResponseDto] })
  items!: InstitutionResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
