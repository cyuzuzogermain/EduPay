import { ApiProperty } from '@nestjs/swagger';
import { ActorRole } from '@prisma/client';

export class AuthResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty()
  expiresIn!: string;

  @ApiProperty({ enum: ActorRole })
  role!: ActorRole;
}
