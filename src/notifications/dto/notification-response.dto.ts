import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

export class NotificationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({ nullable: true })
  paymentId!: string | null;

  @ApiProperty()
  read!: boolean;

  @ApiProperty()
  createdAt!: Date;
}
