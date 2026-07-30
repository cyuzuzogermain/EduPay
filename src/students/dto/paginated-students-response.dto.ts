import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { StudentWithKycResponseDto } from './student-with-kyc-response.dto';

export class PaginatedStudentsResponseDto {
  @ApiProperty({ type: [StudentWithKycResponseDto] })
  items!: StudentWithKycResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
