import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class VerifyRegistrationDto {
  @ApiProperty({
    example: 'Ada Lovelace',
    description: "Matched against the institution's record of the student's name on file",
  })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'STU-1001',
    description: "The student's ID in the institution's own records system",
  })
  @IsString()
  @MinLength(1)
  schoolId!: string;

  @ApiProperty({
    example: 'EduPay Demo University',
    description: "The institution's name, matched case-insensitively against existing institutions",
  })
  @IsString()
  @MinLength(2)
  institution!: string;
}
