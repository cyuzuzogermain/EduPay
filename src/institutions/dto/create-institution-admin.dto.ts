import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateInstitutionAdminDto {
  @ApiProperty({ example: 'Jane Mugisha' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 'jane@ur.ac.rw' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPassword123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
