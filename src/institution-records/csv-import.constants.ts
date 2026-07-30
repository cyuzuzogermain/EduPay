export const MAX_CSV_FILE_SIZE_BYTES = 2 * 1024 * 1024;

/// One row per charge; rows sharing the same schoolId are grouped into one SchoolFinancialRecord
/// with multiple charges. studentName/program are read from each schoolId's first row. See
/// FLOW.md's CSV bulk import section and public/samples/school-financial-records-sample.csv.
export const CSV_IMPORT_COLUMNS = [
  'schoolId',
  'studentName',
  'program',
  'chargeDescription',
  'chargeAmount',
  'chargeDueDate',
] as const;

export const CSV_IMPORT_REQUIRED_COLUMNS = [
  'schoolId',
  'studentName',
  'chargeDescription',
  'chargeAmount',
  'chargeDueDate',
] as const;

export function isCsvFile(file: { originalname: string }): boolean {
  return file.originalname.toLowerCase().endsWith('.csv');
}
