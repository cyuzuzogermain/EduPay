export const MAX_KYC_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_KYC_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

export type AllowedKycMimeType = (typeof ALLOWED_KYC_MIME_TYPES)[number];

export function isAllowedKycMimeType(mimeType: string): mimeType is AllowedKycMimeType {
  return (ALLOWED_KYC_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function extensionForKycMimeType(mimeType: AllowedKycMimeType): string {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'application/pdf':
      return '.pdf';
  }
}
