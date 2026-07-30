import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycStorageService } from './kyc-storage.service';

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  promises: { writeFile: jest.fn().mockResolvedValue(undefined) },
}));

import * as fs from 'fs';

describe('KycStorageService', () => {
  let kycStorageService: KycStorageService;
  let configService: { get: jest.Mock };
  const uploadsDir = path.resolve('/tmp/edupay-kyc-test-uploads');

  beforeEach(() => {
    jest.clearAllMocks();
    configService = { get: jest.fn().mockReturnValue(uploadsDir) };
    kycStorageService = new KycStorageService(configService as unknown as ConfigService);
  });

  it('ensures the uploads directory exists on construction', () => {
    expect(fs.mkdirSync).toHaveBeenCalledWith(uploadsDir, { recursive: true });
  });

  it('saves an accepted JPEG upload under a generated .jpg filename', async () => {
    const result = await kycStorageService.save({
      buffer: Buffer.from('jpeg-bytes'),
      size: 1024,
      mimetype: 'image/jpeg',
      originalname: 'photo.jpg',
    });

    expect(result.fileName).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(result.originalFileName).toBe('photo.jpg');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.fileSize).toBe(1024);
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      path.join(uploadsDir, result.fileName),
      expect.any(Buffer),
    );
  });

  it('saves an accepted PNG upload under a generated .png filename', async () => {
    const result = await kycStorageService.save({
      buffer: Buffer.from('png-bytes'),
      size: 2048,
      mimetype: 'image/png',
      originalname: 'scan.png',
    });

    expect(result.fileName).toMatch(/\.png$/);
  });

  it('saves an accepted PDF upload under a generated .pdf filename', async () => {
    const result = await kycStorageService.save({
      buffer: Buffer.from('%PDF-1.4'),
      size: 4096,
      mimetype: 'application/pdf',
      originalname: 'id.pdf',
    });

    expect(result.fileName).toMatch(/\.pdf$/);
  });

  it('rejects a disallowed file type without writing anything to disk', async () => {
    await expect(
      kycStorageService.save({
        buffer: Buffer.from('zip-bytes'),
        size: 1024,
        mimetype: 'application/zip',
        originalname: 'archive.zip',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
  });

  it('rejects a file larger than 5MB without writing anything to disk', async () => {
    await expect(
      kycStorageService.save({
        buffer: Buffer.alloc(0),
        size: 6 * 1024 * 1024,
        mimetype: 'application/pdf',
        originalname: 'huge.pdf',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the 5MB limit', async () => {
    await expect(
      kycStorageService.save({
        buffer: Buffer.alloc(0),
        size: 5 * 1024 * 1024,
        mimetype: 'application/pdf',
        originalname: 'exact.pdf',
      }),
    ).resolves.toBeDefined();
  });

  describe('resolvePath', () => {
    it('resolves a stored fileName to an absolute path under the uploads directory', () => {
      const resolved = kycStorageService.resolvePath('some-uuid.pdf');

      expect(resolved).toBe(path.join(uploadsDir, 'some-uuid.pdf'));
    });

    it('refuses to resolve a fileName that attempts to traverse outside the uploads directory', () => {
      expect(() => kycStorageService.resolvePath('../../etc/passwd')).toThrow(BadRequestException);
    });
  });
});
