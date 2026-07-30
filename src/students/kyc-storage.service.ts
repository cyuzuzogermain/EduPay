import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ALLOWED_KYC_MIME_TYPES,
  AllowedKycMimeType,
  MAX_KYC_FILE_SIZE_BYTES,
  extensionForKycMimeType,
  isAllowedKycMimeType,
} from './kyc-file.constants';

export interface UploadedKycFile {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

export interface StoredKycFile {
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
}

/// Owns everything about where KYC documents physically live - the uploads directory is
/// configurable (UPLOADS_DIR, default ./uploads/kyc) and never served statically; every read goes
/// through StudentsService.getKycFile's scoping check, then this service resolves the on-disk
/// path. Files are written under a randomly-generated name, never the client's original filename,
/// so nothing about the stored path is guessable or attacker-controlled.
@Injectable()
export class KycStorageService {
  private readonly uploadsDir: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadsDir = path.resolve(this.configService.get<string>('uploadsDir')!);
    fs.mkdirSync(this.uploadsDir, { recursive: true });
  }

  async save(file: UploadedKycFile): Promise<StoredKycFile> {
    const mimeType = this.assertAllowed(file.mimetype, file.size);

    const fileName = `${randomUUID()}${extensionForKycMimeType(mimeType)}`;
    await fsp.writeFile(path.join(this.uploadsDir, fileName), file.buffer);

    return {
      fileName,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
    };
  }

  /// Resolves a stored fileName to an absolute path, refusing to resolve outside the uploads
  /// directory. fileName always comes from a KYCDocument row this service itself wrote, so this
  /// is defense in depth rather than the primary guard - the scoping check happens one layer up.
  resolvePath(fileName: string): string {
    const resolved = path.resolve(this.uploadsDir, fileName);

    if (resolved !== path.normalize(resolved) || !resolved.startsWith(this.uploadsDir + path.sep)) {
      throw new BadRequestException('Invalid stored file reference');
    }

    return resolved;
  }

  private assertAllowed(mimeType: string, size: number): AllowedKycMimeType {
    if (!isAllowedKycMimeType(mimeType)) {
      throw new BadRequestException(
        `Only ${ALLOWED_KYC_MIME_TYPES.join(', ')} files are accepted for KYC documents`,
      );
    }

    if (size > MAX_KYC_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `KYC document must be ${MAX_KYC_FILE_SIZE_BYTES / (1024 * 1024)}MB or smaller`,
      );
    }

    return mimeType;
  }
}
