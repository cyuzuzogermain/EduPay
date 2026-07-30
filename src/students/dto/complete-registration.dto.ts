import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CompleteRegistrationDto {
  @ApiProperty({ description: 'The verificationToken returned by POST /students/register/verify' })
  @IsString()
  @IsNotEmpty()
  verificationToken!: string;

  @ApiProperty({ example: 'StrongPassword123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Rwanda' })
  @IsString()
  @MinLength(2)
  country!: string;
}
