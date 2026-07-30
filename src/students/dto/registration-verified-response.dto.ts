import { ApiProperty } from '@nestjs/swagger';

export class RegistrationVerifiedResponseDto {
  @ApiProperty({
    description:
      'Opaque, signed proof of the verified match - submit unchanged as the verificationToken field to complete registration',
  })
  verificationToken!: string;

  @ApiProperty({ description: 'Resolved institution name, for display on the confirmation step' })
  institutionName!: string;

  @ApiProperty({ description: "The name matched against the institution's record" })
  studentName!: string;

  @ApiProperty({ description: "The matched record's school ID" })
  schoolId!: string;
}
