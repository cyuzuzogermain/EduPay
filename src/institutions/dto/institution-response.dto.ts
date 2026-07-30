import { ApiProperty } from '@nestjs/swagger';

export class InstitutionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  country!: string;

  @ApiProperty()
  contactEmail!: string;

  @ApiProperty({ description: 'The currency this institution is owed in and receives funds in' })
  preferredCurrency!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class InstitutionAdminResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  institutionId!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class PublicInstitutionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  country!: string;
}
