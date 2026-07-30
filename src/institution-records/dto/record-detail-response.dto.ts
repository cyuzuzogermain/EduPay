import { ApiProperty } from '@nestjs/swagger';
import { RecordResponseDto } from './record-response.dto';
import { ChargeDetailResponseDto } from './charge-detail-response.dto';

export class RecordDetailResponseDto extends RecordResponseDto {
  @ApiProperty({ description: 'Charges minus COMPLETED payments' })
  outstandingBalance!: number;

  @ApiProperty({ type: [ChargeDetailResponseDto] })
  charges!: ChargeDetailResponseDto[];
}
