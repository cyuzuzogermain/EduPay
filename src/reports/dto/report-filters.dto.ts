import { ApiPropertyOptional } from '@nestjs/swagger';
import { SchoolTransactionStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ReportFiltersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'ISO date - only payments occurring on or after this date' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date - only payments occurring on or before this date' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: SchoolTransactionStatus })
  @IsOptional()
  @IsEnum(SchoolTransactionStatus)
  status?: SchoolTransactionStatus;

  @ApiPropertyOptional({ description: 'Case-insensitive contains match against the school ID' })
  @IsOptional()
  @IsString()
  schoolId?: string;
}
