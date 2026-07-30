import { ApiProperty } from '@nestjs/swagger';

export class ImportSkippedRowDto {
  @ApiProperty({
    description: 'The CSV row number this applies to (1 = header, 2 = first data row)',
  })
  row!: number;

  @ApiProperty({ example: 'schoolId "STU-2001" already exists at this institution' })
  reason!: string;
}

export class ImportSummaryDto {
  @ApiProperty({
    description: 'Number of new SchoolFinancialRecord rows created (one per unique schoolId)',
  })
  recordsCreated!: number;

  @ApiProperty({ description: 'Number of charges created across all newly-created records' })
  chargesCreated!: number;

  @ApiProperty({
    type: [ImportSkippedRowDto],
    description: 'Every row that was not imported, with the reason it was skipped',
  })
  skipped!: ImportSkippedRowDto[];
}
