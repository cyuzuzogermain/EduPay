import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRecordDto {
  @ApiProperty({
    example: 'STU-1006',
    description:
      "The student's ID in the institution's own records system - unique per institution",
  })
  @IsString()
  @MinLength(1)
  schoolId!: string;

  @ApiProperty({ example: 'Aline Uwase' })
  @IsString()
  @MinLength(2)
  studentName!: string;

  @ApiPropertyOptional({ example: 'Computer Science, Year 1' })
  @IsOptional()
  @IsString()
  program?: string;
}
