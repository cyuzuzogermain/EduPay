import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class AddChargeDto {
  @ApiProperty({ example: 'Semester 2 Tuition Fee' })
  @IsString()
  @MinLength(1)
  description!: string;

  @ApiProperty({ example: 450000 })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: '2026-09-01' })
  @IsDateString()
  dueDate!: string;
}
