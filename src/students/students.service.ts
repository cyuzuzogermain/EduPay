import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ActorRole, Institution, Prisma, SchoolFinancialRecord } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { buildPaginationMeta, paginationSkipTake } from '../common/pagination.util';
import { VerifyRegistrationDto } from './dto/verify-registration.dto';
import { RegistrationVerifiedResponseDto } from './dto/registration-verified-response.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { StudentResponseDto } from './dto/student-response.dto';
import { PaginatedStudentsResponseDto } from './dto/paginated-students-response.dto';
import { KycDocumentResponseDto, KycStatusResponseDto } from './dto/kyc-document-response.dto';
import { KycStorageService, UploadedKycFile } from './kyc-storage.service';

const SALT_ROUNDS = 10;

export interface KycFileDownload {
  filePath: string;
  mimeType: string;
  originalFileName: string;
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly kycStorageService: KycStorageService,
  ) {}

  /// Step 1 of registration - proves the applicant is a real student the institution already
  /// knows about before ever showing them a password field. Never reveals which part (the
  /// institution name, the school ID, or the name) failed to match, so the form can't be used
  /// to enumerate institutions or school IDs.
  async verifyForRegistration(
    dto: VerifyRegistrationDto,
  ): Promise<RegistrationVerifiedResponseDto> {
    const name = dto.name.trim();

    const institution = await this.resolveInstitutionByName(dto.institution);

    if (!institution) {
      throw this.verificationFailed();
    }

    const record = await this.findMatchingFinancialRecord(institution.id, dto.schoolId, name);

    if (!record) {
      throw this.verificationFailed();
    }

    await this.assertRecordNotClaimed(institution.id, record.schoolId);

    const verificationToken = this.authService.signRegistrationVerificationToken({
      name,
      email: dto.email,
      institutionId: institution.id,
      schoolId: record.schoolId,
    });

    return {
      verificationToken,
      institutionName: institution.name,
      studentName: name,
      schoolId: record.schoolId,
    };
  }

  /// Step 2 - the client never supplies institutionId/schoolId/name/email directly here, only
  /// the signed token from step 1, so this can never create an account for an unverified pair.
  /// Re-checks the match and the claim server-side rather than trusting the token blindly, since
  /// it can be up to 15 minutes old - the record could have been claimed (or removed) since.
  async completeRegistration(dto: CompleteRegistrationDto): Promise<StudentResponseDto> {
    const payload = this.authService.verifyRegistrationVerificationToken(dto.verificationToken);

    const record = await this.findMatchingFinancialRecord(
      payload.institutionId,
      payload.schoolId,
      payload.name,
    );

    if (!record) {
      throw this.verificationFailed();
    }

    await this.assertRecordNotClaimed(payload.institutionId, record.schoolId);

    const existingEmail = await this.prisma.student.findUnique({
      where: { email: payload.email },
    });

    if (existingEmail) {
      throw new ConflictException('A student with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const student = await this.prisma.student.create({
      data: {
        name: payload.name,
        email: payload.email,
        password: hashedPassword,
        country: dto.country,
        institutionId: payload.institutionId,
        schoolId: record.schoolId,
      },
    });

    return this.toStudentResponse(student);
  }

  async findById(id: string, requester: AuthenticatedUser): Promise<StudentResponseDto> {
    const student = await this.prisma.student.findUnique({ where: { id } });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    if (requester.role === ActorRole.STUDENT) {
      this.assertOwnsProfile(id, requester.id);
    } else {
      this.assertReviewerAccess(requester, student.institutionId);
    }

    return this.toStudentResponse(student);
  }

  async listForRequester(
    requester: AuthenticatedUser,
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedStudentsResponseDto> {
    const where: Prisma.StudentWhereInput =
      requester.role === ActorRole.INSTITUTION_ADMIN
        ? { institutionId: requester.institutionId }
        : {};

    const { skip, take, page, pageSize } = paginationSkipTake(pagination.page, pagination.pageSize);

    const [students, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { kycDocuments: { orderBy: { submittedAt: 'desc' }, take: 1 } },
      }),
      this.prisma.student.count({ where }),
    ]);

    const items = students.map((student) => ({
      id: student.id,
      name: student.name,
      email: student.email,
      country: student.country,
      institutionId: student.institutionId,
      schoolId: student.schoolId,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
      kycStatus: student.kycDocuments[0]?.status ?? null,
    }));

    return { items, meta: buildPaginationMeta(total, page, pageSize) };
  }

  /// Scalar aggregate for overview stat tiles - deliberately separate from listForRequester so
  /// those tiles stay accurate now that the list itself is paginated (a single page's `.length`
  /// would undercount). "Pending" means the student's *latest* KYC document is PENDING, which
  /// isn't expressible as a single Prisma `count()`, so this pulls just the latest status per
  /// student (no other student fields) and filters in memory.
  async countPendingKyc(institutionId?: string): Promise<number> {
    const where: Prisma.StudentWhereInput = institutionId ? { institutionId } : {};

    const students = await this.prisma.student.findMany({
      where,
      select: {
        kycDocuments: { orderBy: { submittedAt: 'desc' }, take: 1, select: { status: true } },
      },
    });

    return students.filter((student) => student.kycDocuments[0]?.status === 'PENDING').length;
  }

  async countAll(): Promise<number> {
    return this.prisma.student.count();
  }

  async update(
    id: string,
    requesterId: string,
    dto: UpdateStudentDto,
  ): Promise<StudentResponseDto> {
    this.assertOwnsProfile(id, requesterId);

    const student = await this.prisma.student.findUnique({ where: { id } });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    let institutionId: string | null | undefined;
    if (dto.institutionId === undefined) {
      institutionId = undefined;
    } else if (dto.institutionId === '') {
      institutionId = null;
    } else {
      await this.assertInstitutionExists(dto.institutionId);
      institutionId = dto.institutionId;
    }

    const schoolId: string | null | undefined =
      dto.schoolId === undefined ? undefined : dto.schoolId === '' ? null : dto.schoolId;

    const effectiveInstitutionId =
      institutionId === undefined ? student.institutionId : institutionId;
    const effectiveSchoolId = schoolId === undefined ? student.schoolId : schoolId;

    if (
      (institutionId !== undefined || schoolId !== undefined) &&
      effectiveInstitutionId &&
      effectiveSchoolId
    ) {
      await this.assertSchoolIdAvailable(effectiveInstitutionId, effectiveSchoolId, id);
    }

    const updated = await this.prisma.student.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        country: dto.country ?? undefined,
        institutionId,
        schoolId,
      },
    });

    return this.toStudentResponse(updated);
  }

  async submitKyc(
    id: string,
    requesterId: string,
    dto: SubmitKycDto,
    file: UploadedKycFile,
  ): Promise<KycDocumentResponseDto> {
    this.assertOwnsProfile(id, requesterId);

    const student = await this.prisma.student.findUnique({ where: { id } });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    // Validates type/size and only returns once the bytes are actually on disk - a rejected
    // upload never reaches the database at all.
    const stored = await this.kycStorageService.save(file);

    const document = await this.prisma.kYCDocument.create({
      data: {
        studentId: id,
        documentType: dto.documentType,
        fileName: stored.fileName,
        originalFileName: stored.originalFileName,
        mimeType: stored.mimeType,
        fileSize: stored.fileSize,
      },
    });

    return this.toKycDocumentResponse(document);
  }

  /// Streams a KYC document back to an authorized viewer only - the owning student, a reviewing
  /// admin of that student's institution, or a platform admin. Same scoping pattern as every
  /// other reviewer-gated resource (assertReviewerAccess), never served statically.
  async getKycFile(documentId: string, requester: AuthenticatedUser): Promise<KycFileDownload> {
    const document = await this.prisma.kYCDocument.findUnique({ where: { id: documentId } });

    if (!document) {
      throw new NotFoundException('KYC document not found');
    }

    const student = await this.prisma.student.findUnique({
      where: { id: document.studentId },
    });

    if (!student) {
      throw new NotFoundException('KYC document not found');
    }

    if (requester.role === ActorRole.STUDENT) {
      this.assertOwnsProfile(document.studentId, requester.id);
    } else {
      this.assertReviewerAccess(requester, student.institutionId);
    }

    return {
      filePath: this.kycStorageService.resolvePath(document.fileName),
      mimeType: document.mimeType,
      originalFileName: document.originalFileName,
    };
  }

  async getKycStatus(id: string): Promise<KycStatusResponseDto> {
    const student = await this.prisma.student.findUnique({ where: { id } });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const documents = await this.prisma.kYCDocument.findMany({
      where: { studentId: id },
      orderBy: { submittedAt: 'desc' },
    });

    return {
      status: documents[0]?.status ?? null,
      documents: documents.map((document) => this.toKycDocumentResponse(document)),
    };
  }

  async reviewKyc(
    studentId: string,
    documentId: string,
    requester: AuthenticatedUser,
    dto: ReviewKycDto,
  ): Promise<KycDocumentResponseDto> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    this.assertReviewerAccess(requester, student.institutionId);

    const document = await this.prisma.kYCDocument.findUnique({ where: { id: documentId } });

    if (!document || document.studentId !== studentId) {
      throw new NotFoundException('KYC document not found');
    }

    const updated = await this.prisma.kYCDocument.update({
      where: { id: documentId },
      data: { status: dto.status, reviewedAt: new Date(), reviewNote: dto.note || null },
    });

    return this.toKycDocumentResponse(updated);
  }

  async getForReview(
    studentId: string,
    requester: AuthenticatedUser,
  ): Promise<{ student: StudentResponseDto; kycDocuments: KycDocumentResponseDto[] }> {
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    this.assertReviewerAccess(requester, student.institutionId);

    const documents = await this.prisma.kYCDocument.findMany({
      where: { studentId },
      orderBy: { submittedAt: 'desc' },
    });

    return {
      student: this.toStudentResponse(student),
      kycDocuments: documents.map((document) => this.toKycDocumentResponse(document)),
    };
  }

  private assertReviewerAccess(
    requester: AuthenticatedUser,
    studentInstitutionId: string | null,
  ): void {
    if (
      requester.role === ActorRole.INSTITUTION_ADMIN &&
      requester.institutionId !== studentInstitutionId
    ) {
      throw new ForbiddenException('You do not have access to this student');
    }
  }

  private async assertInstitutionExists(institutionId: string): Promise<void> {
    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId } });

    if (!institution) {
      throw new BadRequestException('Institution not found');
    }
  }

  private async assertSchoolIdAvailable(
    institutionId: string,
    schoolId: string,
    excludeStudentId?: string,
  ): Promise<void> {
    const existing = await this.prisma.student.findUnique({
      where: { institutionId_schoolId: { institutionId, schoolId } },
    });

    if (existing && existing.id !== excludeStudentId) {
      throw new ConflictException(
        'Another student at this institution is already linked to that school ID',
      );
    }
  }

  private verificationFailed(): NotFoundException {
    return new NotFoundException(
      "We couldn't verify your details. Please check your student ID or contact your institution.",
    );
  }

  private async resolveInstitutionByName(rawName: string): Promise<Institution | null> {
    const matches = await this.prisma.institution.findMany({
      where: { name: { equals: rawName.trim(), mode: 'insensitive' } },
    });

    return matches.length === 1 ? matches[0] : null;
  }

  private async findMatchingFinancialRecord(
    institutionId: string,
    schoolId: string,
    studentName: string,
  ): Promise<SchoolFinancialRecord | null> {
    return this.prisma.schoolFinancialRecord.findFirst({
      where: {
        institutionId,
        schoolId: { equals: schoolId.trim(), mode: 'insensitive' },
        studentName: { equals: studentName.trim(), mode: 'insensitive' },
      },
    });
  }

  private async assertRecordNotClaimed(institutionId: string, schoolId: string): Promise<void> {
    const existing = await this.prisma.student.findUnique({
      where: { institutionId_schoolId: { institutionId, schoolId } },
    });

    if (existing) {
      throw new ConflictException(
        'A student is already registered with this school ID - if this is you, log in instead.',
      );
    }
  }

  private assertOwnsProfile(resourceId: string, requesterId: string): void {
    if (resourceId !== requesterId) {
      throw new ForbiddenException('You may only manage your own profile');
    }
  }

  private toStudentResponse(
    student: Prisma.StudentGetPayload<Record<string, never>>,
  ): StudentResponseDto {
    return {
      id: student.id,
      name: student.name,
      email: student.email,
      country: student.country,
      institutionId: student.institutionId,
      schoolId: student.schoolId,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
    };
  }

  private toKycDocumentResponse(
    document: Prisma.KYCDocumentGetPayload<Record<string, never>>,
  ): KycDocumentResponseDto {
    return {
      id: document.id,
      documentType: document.documentType,
      originalFileName: document.originalFileName,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      status: document.status,
      submittedAt: document.submittedAt,
      reviewedAt: document.reviewedAt,
      reviewNote: document.reviewNote,
    };
  }
}
