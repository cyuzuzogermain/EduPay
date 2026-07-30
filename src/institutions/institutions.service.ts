import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ActorRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { buildPaginationMeta, paginationSkipTake } from '../common/pagination.util';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { CreateInstitutionAdminDto } from './dto/create-institution-admin.dto';
import { UpdatePreferredCurrencyDto } from './dto/update-preferred-currency.dto';
import {
  InstitutionAdminResponseDto,
  InstitutionResponseDto,
  PublicInstitutionResponseDto,
} from './dto/institution-response.dto';
import { PaginatedInstitutionsResponseDto } from './dto/paginated-institutions-response.dto';
import { PaginatedStudentsResponseDto } from '../students/dto/paginated-students-response.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class InstitutionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateInstitutionDto): Promise<InstitutionResponseDto> {
    const existing = await this.prisma.institution.findUnique({
      where: { contactEmail: dto.contactEmail },
    });

    if (existing) {
      throw new ConflictException('An institution with this contact email already exists');
    }

    const institution = await this.prisma.institution.create({ data: dto });
    return this.toInstitutionResponse(institution);
  }

  async findAll(pagination: PaginationQueryDto = {}): Promise<PaginatedInstitutionsResponseDto> {
    const { skip, take, page, pageSize } = paginationSkipTake(pagination.page, pagination.pageSize);

    const [institutions, total] = await Promise.all([
      this.prisma.institution.findMany({ orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.institution.count(),
    ]);

    return {
      items: institutions.map((institution) => this.toInstitutionResponse(institution)),
      meta: buildPaginationMeta(total, page, pageSize),
    };
  }

  async countAll(): Promise<number> {
    return this.prisma.institution.count();
  }

  async findAllPublic(): Promise<PublicInstitutionResponseDto[]> {
    const institutions = await this.prisma.institution.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, country: true },
    });
    return institutions;
  }

  async findById(id: string, requester: AuthenticatedUser): Promise<InstitutionResponseDto> {
    this.assertCanAccessInstitution(id, requester);

    const institution = await this.prisma.institution.findUnique({ where: { id } });

    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    return this.toInstitutionResponse(institution);
  }

  async createAdmin(
    institutionId: string,
    dto: CreateInstitutionAdminDto,
  ): Promise<InstitutionAdminResponseDto> {
    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId } });

    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    const existing = await this.prisma.institutionAdmin.findUnique({ where: { email: dto.email } });

    if (existing) {
      throw new ConflictException('An admin with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const admin = await this.prisma.institutionAdmin.create({
      data: { name: dto.name, email: dto.email, password: hashedPassword, institutionId },
    });

    return this.toInstitutionAdminResponse(admin);
  }

  async listAdmins(
    institutionId: string,
    requester: AuthenticatedUser,
  ): Promise<InstitutionAdminResponseDto[]> {
    this.assertCanAccessInstitution(institutionId, requester);

    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    const admins = await this.prisma.institutionAdmin.findMany({
      where: { institutionId },
      orderBy: { createdAt: 'desc' },
    });

    return admins.map((admin) => this.toInstitutionAdminResponse(admin));
  }

  async listStudents(
    institutionId: string,
    requester: AuthenticatedUser,
    pagination: PaginationQueryDto = {},
  ): Promise<PaginatedStudentsResponseDto> {
    this.assertCanAccessInstitution(institutionId, requester);

    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    const { skip, take, page, pageSize } = paginationSkipTake(pagination.page, pagination.pageSize);
    const where: Prisma.StudentWhereInput = { institutionId };

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

  async countStudents(institutionId: string, requester: AuthenticatedUser): Promise<number> {
    this.assertCanAccessInstitution(institutionId, requester);
    return this.prisma.student.count({ where: { institutionId } });
  }

  /// Editable by the institution's own admin (self-service, /institution settings) or a
  /// platform admin (create + detail pages) - the one deliberate exception to "platform admins
  /// can create, not update, institutions" (see FLOW.md). Does not touch any existing
  /// SchoolFinancialRecord/charge - those keep whatever currency they were created with.
  async updatePreferredCurrency(
    institutionId: string,
    requester: AuthenticatedUser,
    dto: UpdatePreferredCurrencyDto,
  ): Promise<InstitutionResponseDto> {
    this.assertCanAccessInstitution(institutionId, requester);

    const institution = await this.prisma.institution.findUnique({ where: { id: institutionId } });

    if (!institution) {
      throw new NotFoundException('Institution not found');
    }

    const updated = await this.prisma.institution.update({
      where: { id: institutionId },
      data: { preferredCurrency: dto.preferredCurrency },
    });

    return this.toInstitutionResponse(updated);
  }

  private assertCanAccessInstitution(institutionId: string, requester: AuthenticatedUser): void {
    if (requester.role === ActorRole.PLATFORM_ADMIN) {
      return;
    }

    if (
      requester.role === ActorRole.INSTITUTION_ADMIN &&
      requester.institutionId === institutionId
    ) {
      return;
    }

    throw new ForbiddenException('You do not have access to this institution');
  }

  private toInstitutionResponse(
    institution: Prisma.InstitutionGetPayload<Record<string, never>>,
  ): InstitutionResponseDto {
    return {
      id: institution.id,
      name: institution.name,
      country: institution.country,
      contactEmail: institution.contactEmail,
      preferredCurrency: institution.preferredCurrency,
      createdAt: institution.createdAt,
      updatedAt: institution.updatedAt,
    };
  }

  private toInstitutionAdminResponse(
    admin: Prisma.InstitutionAdminGetPayload<Record<string, never>>,
  ): InstitutionAdminResponseDto {
    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      institutionId: admin.institutionId,
      createdAt: admin.createdAt,
    };
  }
}
