import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ActorRole, KYCStatus } from '@prisma/client';
import { StudentsService } from './students.service';
import { KycStorageService } from './kyc-storage.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('StudentsService', () => {
  let studentsService: StudentsService;
  let prisma: {
    student: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    institution: { findUnique: jest.Mock; findMany: jest.Mock };
    schoolFinancialRecord: { findFirst: jest.Mock };
    kYCDocument: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let authService: {
    signRegistrationVerificationToken: jest.Mock;
    verifyRegistrationVerificationToken: jest.Mock;
  };
  let kycStorageService: { save: jest.Mock; resolvePath: jest.Mock };

  const uploadedFile = {
    buffer: Buffer.from('%PDF-1.4 fake pdf bytes'),
    size: 1024,
    mimetype: 'application/pdf',
    originalname: 'passport.pdf',
  };

  const storedFile = {
    fileName: 'generated-uuid.pdf',
    originalFileName: 'passport.pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
  };

  const student = {
    id: 'student-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'hashed-password',
    country: 'Rwanda',
    institutionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const institution = {
    id: 'institution-1',
    name: 'University of Rwanda',
    country: 'Rwanda',
    contactEmail: 'finance@ur.ac.rw',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const otherInstitution = {
    id: 'institution-2',
    name: 'Other University',
    country: 'Kenya',
    contactEmail: 'finance@other.example',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const financialRecord = {
    id: 'record-1',
    institutionId: institution.id,
    schoolId: 'STU-1001',
    studentName: 'Ada Lovelace',
    program: 'Computer Science',
    currency: 'RWF',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      student: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      institution: { findUnique: jest.fn(), findMany: jest.fn() },
      schoolFinancialRecord: { findFirst: jest.fn() },
      kYCDocument: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    authService = {
      signRegistrationVerificationToken: jest.fn(),
      verifyRegistrationVerificationToken: jest.fn(),
    };
    kycStorageService = {
      save: jest.fn().mockResolvedValue(storedFile),
      resolvePath: jest.fn().mockReturnValue('/uploads/kyc/generated-uuid.pdf'),
    };

    studentsService = new StudentsService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      kycStorageService as unknown as KycStorageService,
    );
  });

  describe('verifyForRegistration', () => {
    const verifyDto = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      schoolId: 'STU-1001',
      institution: 'University of Rwanda',
    };

    it('returns a verification token on a successful match', async () => {
      prisma.institution.findMany.mockResolvedValue([institution]);
      prisma.schoolFinancialRecord.findFirst.mockResolvedValue(financialRecord);
      prisma.student.findUnique.mockResolvedValue(null);
      authService.signRegistrationVerificationToken.mockReturnValue('signed-token');

      const result = await studentsService.verifyForRegistration(verifyDto);

      expect(result).toEqual({
        verificationToken: 'signed-token',
        institutionName: institution.name,
        studentName: verifyDto.name,
        schoolId: financialRecord.schoolId,
      });
      expect(authService.signRegistrationVerificationToken).toHaveBeenCalledWith({
        name: verifyDto.name,
        email: verifyDto.email,
        institutionId: institution.id,
        schoolId: financialRecord.schoolId,
      });
    });

    it('rejects when the institution name does not match any institution', async () => {
      prisma.institution.findMany.mockResolvedValue([]);

      await expect(studentsService.verifyForRegistration(verifyDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.schoolFinancialRecord.findFirst).not.toHaveBeenCalled();
    });

    it('rejects when the institution name is ambiguous (matches more than one institution)', async () => {
      prisma.institution.findMany.mockResolvedValue([institution, otherInstitution]);

      await expect(studentsService.verifyForRegistration(verifyDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.schoolFinancialRecord.findFirst).not.toHaveBeenCalled();
    });

    it('rejects when the school ID does not match any record at the resolved institution', async () => {
      prisma.institution.findMany.mockResolvedValue([institution]);
      prisma.schoolFinancialRecord.findFirst.mockResolvedValue(null);

      await expect(
        studentsService.verifyForRegistration({ ...verifyDto, schoolId: 'STU-9999' }),
      ).rejects.toThrow(NotFoundException);
      expect(authService.signRegistrationVerificationToken).not.toHaveBeenCalled();
    });

    it('rejects when the name does not match the record on file', async () => {
      prisma.institution.findMany.mockResolvedValue([institution]);
      prisma.schoolFinancialRecord.findFirst.mockResolvedValue(null);

      await expect(
        studentsService.verifyForRegistration({ ...verifyDto, name: 'Someone Else' }),
      ).rejects.toThrow(NotFoundException);
      expect(authService.signRegistrationVerificationToken).not.toHaveBeenCalled();
    });

    it('rejects when the schoolId/name pair belongs to a different institution than the one resolved', async () => {
      // The student typed a real institution name, but the matching record actually lives
      // under a different institution - the lookup must stay scoped to the resolved one.
      prisma.institution.findMany.mockResolvedValue([otherInstitution]);
      prisma.schoolFinancialRecord.findFirst.mockResolvedValue(null);

      await expect(
        studentsService.verifyForRegistration({ ...verifyDto, institution: otherInstitution.name }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.schoolFinancialRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ institutionId: otherInstitution.id }),
        }),
      );
    });

    it('throws ConflictException when the record is already claimed by another student', async () => {
      prisma.institution.findMany.mockResolvedValue([institution]);
      prisma.schoolFinancialRecord.findFirst.mockResolvedValue(financialRecord);
      prisma.student.findUnique.mockResolvedValue({ ...student, id: 'someone-else' });

      await expect(studentsService.verifyForRegistration(verifyDto)).rejects.toThrow(
        ConflictException,
      );
      expect(authService.signRegistrationVerificationToken).not.toHaveBeenCalled();
    });
  });

  describe('completeRegistration', () => {
    const verifiedPayload = {
      purpose: 'student-registration' as const,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      institutionId: institution.id,
      schoolId: financialRecord.schoolId,
    };
    const completeDto = {
      verificationToken: 'signed-token',
      password: 'StrongPassword123!',
      country: 'Rwanda',
    };

    it('creates the account using only data from the verified token', async () => {
      authService.verifyRegistrationVerificationToken.mockReturnValue(verifiedPayload);
      prisma.schoolFinancialRecord.findFirst.mockResolvedValue(financialRecord);
      prisma.student.findUnique.mockResolvedValue(null);
      prisma.student.create.mockResolvedValue({
        ...student,
        institutionId: institution.id,
        schoolId: financialRecord.schoolId,
      });

      const result = await studentsService.completeRegistration(completeDto);

      expect(authService.verifyRegistrationVerificationToken).toHaveBeenCalledWith('signed-token');
      const createArgs = prisma.student.create.mock.calls[0][0];
      expect(createArgs.data).toEqual(
        expect.objectContaining({
          name: verifiedPayload.name,
          email: verifiedPayload.email,
          institutionId: verifiedPayload.institutionId,
          schoolId: verifiedPayload.schoolId,
          country: completeDto.country,
        }),
      );
      expect(await bcrypt.compare(completeDto.password, createArgs.data.password)).toBe(true);
      expect(result.email).toBe(student.email);
    });

    it('cannot create an account for an unverified pair - rejects when the token is invalid or expired', async () => {
      authService.verifyRegistrationVerificationToken.mockImplementation(() => {
        throw new UnauthorizedException('Your verification has expired');
      });

      await expect(studentsService.completeRegistration(completeDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.schoolFinancialRecord.findFirst).not.toHaveBeenCalled();
      expect(prisma.student.create).not.toHaveBeenCalled();
    });

    it('re-verifies the match and rejects when the record no longer matches', async () => {
      authService.verifyRegistrationVerificationToken.mockReturnValue(verifiedPayload);
      prisma.schoolFinancialRecord.findFirst.mockResolvedValue(null);

      await expect(studentsService.completeRegistration(completeDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.student.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the school ID was claimed by someone else since verification', async () => {
      authService.verifyRegistrationVerificationToken.mockReturnValue(verifiedPayload);
      prisma.schoolFinancialRecord.findFirst.mockResolvedValue(financialRecord);
      prisma.student.findUnique.mockResolvedValue({ ...student, id: 'someone-else' });

      await expect(studentsService.completeRegistration(completeDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.student.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the email is already registered', async () => {
      authService.verifyRegistrationVerificationToken.mockReturnValue(verifiedPayload);
      prisma.schoolFinancialRecord.findFirst.mockResolvedValue(financialRecord);
      prisma.student.findUnique.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(where.email ? student : null),
      );

      await expect(studentsService.completeRegistration(completeDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.student.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    const platformAdmin = {
      id: 'platform-1',
      email: 'ops@edupay.example',
      role: ActorRole.PLATFORM_ADMIN,
    };

    it('returns the student profile without the password when the student fetches their own', async () => {
      prisma.student.findUnique.mockResolvedValue(student);

      const result = await studentsService.findById(student.id, {
        id: student.id,
        email: student.email,
        role: ActorRole.STUDENT,
      });

      expect(result).not.toHaveProperty('password');
      expect(result.id).toBe(student.id);
    });

    it('throws ForbiddenException when a student fetches another student', async () => {
      prisma.student.findUnique.mockResolvedValue(student);

      await expect(
        studentsService.findById(student.id, {
          id: 'someone-else',
          email: 'other@example.com',
          role: ActorRole.STUDENT,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a platform admin to fetch any student', async () => {
      prisma.student.findUnique.mockResolvedValue(student);

      const result = await studentsService.findById(student.id, platformAdmin);

      expect(result.id).toBe(student.id);
    });

    it('allows an institution admin to fetch a student in their own institution', async () => {
      prisma.student.findUnique.mockResolvedValue({ ...student, institutionId: institution.id });

      const result = await studentsService.findById(student.id, {
        id: 'admin-1',
        email: 'admin@ur.ac.rw',
        role: ActorRole.INSTITUTION_ADMIN,
        institutionId: institution.id,
      });

      expect(result.id).toBe(student.id);
    });

    it('throws ForbiddenException when an institution admin fetches a student outside their institution', async () => {
      prisma.student.findUnique.mockResolvedValue({ ...student, institutionId: institution.id });

      await expect(
        studentsService.findById(student.id, {
          id: 'admin-2',
          email: 'admin@other.ac.rw',
          role: ActorRole.INSTITUTION_ADMIN,
          institutionId: 'other-institution',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the student does not exist', async () => {
      prisma.student.findUnique.mockResolvedValue(null);

      await expect(studentsService.findById('missing', platformAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listForRequester', () => {
    it('scopes results to the institution admin institution', async () => {
      prisma.student.findMany.mockResolvedValue([{ ...student, kycDocuments: [] }]);
      prisma.student.count.mockResolvedValue(1);

      await studentsService.listForRequester({
        id: 'admin-1',
        email: 'admin@ur.ac.rw',
        role: ActorRole.INSTITUTION_ADMIN,
        institutionId: institution.id,
      });

      expect(prisma.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { institutionId: institution.id } }),
      );
    });

    it('returns every student for a platform admin, paginated', async () => {
      prisma.student.findMany.mockResolvedValue([{ ...student, kycDocuments: [] }]);
      prisma.student.count.mockResolvedValue(1);

      const result = await studentsService.listForRequester({
        id: 'platform-1',
        email: 'ops@edupay.example',
        role: ActorRole.PLATFORM_ADMIN,
      });

      expect(prisma.student.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
      expect(result.items[0].kycStatus).toBeNull();
      expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
    });

    it('paginates using the given page/pageSize', async () => {
      prisma.student.findMany.mockResolvedValue([]);
      prisma.student.count.mockResolvedValue(25);

      const result = await studentsService.listForRequester(
        { id: 'platform-1', email: 'ops@edupay.example', role: ActorRole.PLATFORM_ADMIN },
        { page: 2, pageSize: 10 },
      );

      expect(prisma.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.meta).toEqual({ total: 25, page: 2, pageSize: 10, totalPages: 3 });
    });
  });

  describe('countPendingKyc / countAll', () => {
    it('counts students whose latest KYC document is PENDING', async () => {
      prisma.student.findMany.mockResolvedValue([
        { kycDocuments: [{ status: 'PENDING' }] },
        { kycDocuments: [{ status: 'APPROVED' }] },
        { kycDocuments: [] },
        { kycDocuments: [{ status: 'PENDING' }] },
      ]);

      const result = await studentsService.countPendingKyc();

      expect(result).toBe(2);
    });

    it('scopes the pending KYC count to an institution when given', async () => {
      prisma.student.findMany.mockResolvedValue([]);

      await studentsService.countPendingKyc(institution.id);

      expect(prisma.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { institutionId: institution.id } }),
      );
    });

    it('counts every student', async () => {
      prisma.student.count.mockResolvedValue(42);

      await expect(studentsService.countAll()).resolves.toBe(42);
    });
  });

  describe('update', () => {
    it('updates the profile when the requester owns it', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.student.update.mockResolvedValue({ ...student, name: 'Ada L.' });

      const result = await studentsService.update(student.id, student.id, { name: 'Ada L.' });

      expect(result.name).toBe('Ada L.');
    });

    it('throws ForbiddenException when the requester does not own the profile', async () => {
      await expect(
        studentsService.update(student.id, 'someone-else', { name: 'Ada L.' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the student does not exist', async () => {
      prisma.student.findUnique.mockResolvedValue(null);

      await expect(
        studentsService.update(student.id, student.id, { name: 'Ada L.' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('clears the institution link when institutionId is an empty string', async () => {
      prisma.student.findUnique.mockResolvedValue({ ...student, institutionId: institution.id });
      prisma.student.update.mockResolvedValue({ ...student, institutionId: null });

      await studentsService.update(student.id, student.id, { institutionId: '' });

      expect(prisma.student.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ institutionId: null }) }),
      );
    });

    it('throws when setting institutionId to one that does not exist', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.institution.findUnique.mockResolvedValue(null);

      await expect(
        studentsService.update(student.id, student.id, { institutionId: 'missing' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('submitKyc', () => {
    const document = {
      id: 'doc-1',
      studentId: student.id,
      documentType: 'PASSPORT',
      fileName: storedFile.fileName,
      originalFileName: storedFile.originalFileName,
      mimeType: storedFile.mimeType,
      fileSize: storedFile.fileSize,
      status: KYCStatus.PENDING,
      submittedAt: new Date(),
      reviewedAt: null,
    };

    it('creates a KYC document when the requester owns the profile', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.kYCDocument.create.mockResolvedValue(document);

      const result = await studentsService.submitKyc(
        student.id,
        student.id,
        { documentType: 'PASSPORT' },
        uploadedFile,
      );

      expect(result.status).toBe(KYCStatus.PENDING);
      expect(result.originalFileName).toBe('passport.pdf');
      expect(kycStorageService.save).toHaveBeenCalledWith(uploadedFile);
      expect(prisma.kYCDocument.create).toHaveBeenCalledWith({
        data: {
          studentId: student.id,
          documentType: 'PASSPORT',
          fileName: storedFile.fileName,
          originalFileName: storedFile.originalFileName,
          mimeType: storedFile.mimeType,
          fileSize: storedFile.fileSize,
        },
      });
    });

    it('throws ForbiddenException when the requester does not own the profile', async () => {
      await expect(
        studentsService.submitKyc(
          student.id,
          'someone-else',
          { documentType: 'PASSPORT' },
          uploadedFile,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.kYCDocument.create).not.toHaveBeenCalled();
      expect(kycStorageService.save).not.toHaveBeenCalled();
    });

    it('propagates a BadRequestException from storage (disallowed type or oversized) without creating a row', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      kycStorageService.save.mockRejectedValue(new BadRequestException('nope'));

      await expect(
        studentsService.submitKyc(
          student.id,
          student.id,
          { documentType: 'PASSPORT' },
          uploadedFile,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.kYCDocument.create).not.toHaveBeenCalled();
    });
  });

  describe('getKycStatus', () => {
    it('returns the latest status and full document history', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.kYCDocument.findMany.mockResolvedValue([
        {
          id: 'doc-2',
          studentId: student.id,
          documentType: 'PASSPORT',
          fileName: 'stored-2.pdf',
          originalFileName: 'passport-2.pdf',
          mimeType: 'application/pdf',
          fileSize: 2048,
          status: KYCStatus.APPROVED,
          submittedAt: new Date(),
          reviewedAt: new Date(),
        },
      ]);

      const result = await studentsService.getKycStatus(student.id);

      expect(result.status).toBe(KYCStatus.APPROVED);
      expect(result.documents).toHaveLength(1);
    });

    it('returns a null status when no documents have been submitted', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.kYCDocument.findMany.mockResolvedValue([]);

      const result = await studentsService.getKycStatus(student.id);

      expect(result.status).toBeNull();
      expect(result.documents).toHaveLength(0);
    });

    it('throws NotFoundException when the student does not exist', async () => {
      prisma.student.findUnique.mockResolvedValue(null);

      await expect(studentsService.getKycStatus('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reviewKyc', () => {
    const linkedStudent = { ...student, institutionId: institution.id };
    const document = {
      id: 'doc-1',
      studentId: student.id,
      documentType: 'PASSPORT',
      fileName: storedFile.fileName,
      originalFileName: storedFile.originalFileName,
      mimeType: storedFile.mimeType,
      fileSize: storedFile.fileSize,
      status: KYCStatus.PENDING,
      submittedAt: new Date(),
      reviewedAt: null,
    };

    it('approves a document when a platform admin reviews it', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.kYCDocument.findUnique.mockResolvedValue(document);
      prisma.kYCDocument.update.mockResolvedValue({
        ...document,
        status: KYCStatus.APPROVED,
        reviewedAt: new Date(),
      });

      const result = await studentsService.reviewKyc(
        student.id,
        document.id,
        { id: 'platform-1', email: 'ops@edupay.example', role: ActorRole.PLATFORM_ADMIN },
        { status: KYCStatus.APPROVED },
      );

      expect(result.status).toBe(KYCStatus.APPROVED);
    });

    it('persists a reviewer note when one is given', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.kYCDocument.findUnique.mockResolvedValue(document);
      prisma.kYCDocument.update.mockResolvedValue({
        ...document,
        status: KYCStatus.REJECTED,
        reviewedAt: new Date(),
        reviewNote: 'Photo is blurry, please resubmit.',
      });

      await studentsService.reviewKyc(
        student.id,
        document.id,
        { id: 'platform-1', email: 'ops@edupay.example', role: ActorRole.PLATFORM_ADMIN },
        { status: KYCStatus.REJECTED, note: 'Photo is blurry, please resubmit.' },
      );

      expect(prisma.kYCDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reviewNote: 'Photo is blurry, please resubmit.' }),
        }),
      );
    });

    it('stores a null reviewNote when no note is given', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.kYCDocument.findUnique.mockResolvedValue(document);
      prisma.kYCDocument.update.mockResolvedValue({
        ...document,
        status: KYCStatus.APPROVED,
        reviewedAt: new Date(),
      });

      await studentsService.reviewKyc(
        student.id,
        document.id,
        { id: 'platform-1', email: 'ops@edupay.example', role: ActorRole.PLATFORM_ADMIN },
        { status: KYCStatus.APPROVED },
      );

      expect(prisma.kYCDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ reviewNote: null }) }),
      );
    });

    it('allows an institution admin to review a student in their own institution', async () => {
      prisma.student.findUnique.mockResolvedValue(linkedStudent);
      prisma.kYCDocument.findUnique.mockResolvedValue(document);
      prisma.kYCDocument.update.mockResolvedValue({
        ...document,
        status: KYCStatus.REJECTED,
        reviewedAt: new Date(),
      });

      const result = await studentsService.reviewKyc(
        student.id,
        document.id,
        {
          id: 'admin-1',
          email: 'admin@ur.ac.rw',
          role: ActorRole.INSTITUTION_ADMIN,
          institutionId: institution.id,
        },
        { status: KYCStatus.REJECTED },
      );

      expect(result.status).toBe(KYCStatus.REJECTED);
    });

    it('throws ForbiddenException when an institution admin reviews another institution', async () => {
      prisma.student.findUnique.mockResolvedValue(linkedStudent);

      await expect(
        studentsService.reviewKyc(
          student.id,
          document.id,
          {
            id: 'admin-2',
            email: 'other@x.ac.rw',
            role: ActorRole.INSTITUTION_ADMIN,
            institutionId: 'other-institution',
          },
          { status: KYCStatus.APPROVED },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.kYCDocument.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the student does not exist', async () => {
      prisma.student.findUnique.mockResolvedValue(null);

      await expect(
        studentsService.reviewKyc(
          'missing',
          document.id,
          { id: 'platform-1', email: 'ops@edupay.example', role: ActorRole.PLATFORM_ADMIN },
          { status: KYCStatus.APPROVED },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the document does not belong to the student', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.kYCDocument.findUnique.mockResolvedValue({ ...document, studentId: 'someone-else' });

      await expect(
        studentsService.reviewKyc(
          student.id,
          document.id,
          { id: 'platform-1', email: 'ops@edupay.example', role: ActorRole.PLATFORM_ADMIN },
          { status: KYCStatus.APPROVED },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getForReview', () => {
    it('returns the student and full KYC document history', async () => {
      prisma.student.findUnique.mockResolvedValue(student);
      prisma.kYCDocument.findMany.mockResolvedValue([]);

      const result = await studentsService.getForReview(student.id, {
        id: 'platform-1',
        email: 'ops@edupay.example',
        role: ActorRole.PLATFORM_ADMIN,
      });

      expect(result.student.id).toBe(student.id);
      expect(result.kycDocuments).toEqual([]);
    });

    it('throws NotFoundException when the student does not exist', async () => {
      prisma.student.findUnique.mockResolvedValue(null);

      await expect(
        studentsService.getForReview('missing', {
          id: 'platform-1',
          email: 'ops@edupay.example',
          role: ActorRole.PLATFORM_ADMIN,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getKycFile', () => {
    const linkedStudent = { ...student, institutionId: institution.id };
    const document = {
      id: 'doc-1',
      studentId: student.id,
      documentType: 'PASSPORT',
      fileName: storedFile.fileName,
      originalFileName: storedFile.originalFileName,
      mimeType: storedFile.mimeType,
      fileSize: storedFile.fileSize,
      status: KYCStatus.PENDING,
      submittedAt: new Date(),
      reviewedAt: null,
    };

    it('lets the owning student download their own document', async () => {
      prisma.kYCDocument.findUnique.mockResolvedValue(document);
      prisma.student.findUnique.mockResolvedValue(student);

      const result = await studentsService.getKycFile(document.id, {
        id: student.id,
        email: student.email,
        role: ActorRole.STUDENT,
      });

      expect(result).toEqual({
        filePath: '/uploads/kyc/generated-uuid.pdf',
        mimeType: storedFile.mimeType,
        originalFileName: storedFile.originalFileName,
      });
      expect(kycStorageService.resolvePath).toHaveBeenCalledWith(storedFile.fileName);
    });

    it("throws ForbiddenException for a student who doesn't own the document", async () => {
      prisma.kYCDocument.findUnique.mockResolvedValue(document);
      prisma.student.findUnique.mockResolvedValue(student);

      await expect(
        studentsService.getKycFile(document.id, {
          id: 'someone-else',
          email: 'x@example.com',
          role: ActorRole.STUDENT,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(kycStorageService.resolvePath).not.toHaveBeenCalled();
    });

    it("lets a reviewing institution admin of the student's own institution download it", async () => {
      prisma.kYCDocument.findUnique.mockResolvedValue({ ...document, studentId: linkedStudent.id });
      prisma.student.findUnique.mockResolvedValue(linkedStudent);

      const result = await studentsService.getKycFile(document.id, {
        id: 'admin-1',
        email: 'admin@ur.ac.rw',
        role: ActorRole.INSTITUTION_ADMIN,
        institutionId: institution.id,
      });

      expect(result.mimeType).toBe(storedFile.mimeType);
    });

    it('throws ForbiddenException for an institution admin of a different institution', async () => {
      prisma.kYCDocument.findUnique.mockResolvedValue({ ...document, studentId: linkedStudent.id });
      prisma.student.findUnique.mockResolvedValue(linkedStudent);

      await expect(
        studentsService.getKycFile(document.id, {
          id: 'admin-2',
          email: 'other@x.ac.rw',
          role: ActorRole.INSTITUTION_ADMIN,
          institutionId: 'other-institution',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(kycStorageService.resolvePath).not.toHaveBeenCalled();
    });

    it('lets a platform admin download any document', async () => {
      prisma.kYCDocument.findUnique.mockResolvedValue({ ...document, studentId: linkedStudent.id });
      prisma.student.findUnique.mockResolvedValue(linkedStudent);

      const result = await studentsService.getKycFile(document.id, {
        id: 'platform-1',
        email: 'ops@edupay.example',
        role: ActorRole.PLATFORM_ADMIN,
      });

      expect(result.originalFileName).toBe(storedFile.originalFileName);
    });

    it('throws NotFoundException when the document does not exist', async () => {
      prisma.kYCDocument.findUnique.mockResolvedValue(null);

      await expect(
        studentsService.getKycFile('missing', {
          id: 'platform-1',
          email: 'ops@edupay.example',
          role: ActorRole.PLATFORM_ADMIN,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
