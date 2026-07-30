import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/// The document file itself travels as a multipart `file` field (see FileInterceptor on the
/// controller), not on this DTO - class-validator only governs the non-file form fields.
export class SubmitKycDto {
  @ApiProperty({ example: 'PASSPORT' })
  @IsString()
  @IsNotEmpty()
  documentType!: string;
}
