import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KYCStatus } from '@prisma/client';

export class KycDocumentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  documentType!: string;

  @ApiProperty({ description: 'Original filename as uploaded by the student, for display only' })
  originalFileName!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ description: 'File size in bytes' })
  fileSize!: number;

  @ApiProperty({ enum: KYCStatus })
  status!: KYCStatus;

  @ApiProperty()
  submittedAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  reviewedAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Reviewer note, especially useful when rejected',
  })
  reviewNote!: string | null;
}

export class KycStatusResponseDto {
  @ApiPropertyOptional({
    enum: KYCStatus,
    nullable: true,
    description: 'Status of the most recently submitted document, or null if none submitted',
  })
  status!: KYCStatus | null;

  @ApiProperty({ type: [KycDocumentResponseDto] })
  documents!: KycDocumentResponseDto[];
}
