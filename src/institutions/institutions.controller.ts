import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActorRole } from '@prisma/client';
import { InstitutionsService } from './institutions.service';
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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';

@ApiTags('institutions')
@Controller('institutions')
export class InstitutionsController {
  constructor(private readonly institutionsService: InstitutionsService) {}

  @Get('public')
  @ApiOperation({
    summary:
      'List institutions (id, name, country only) - no auth required, used to populate registration forms',
  })
  @ApiResponse({ status: 200, type: [PublicInstitutionResponseDto] })
  async findAllPublic(): Promise<PublicInstitutionResponseDto[]> {
    return this.institutionsService.findAllPublic();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ActorRole.PLATFORM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a new institution (platform admin only)' })
  @ApiResponse({ status: 201, type: InstitutionResponseDto })
  async create(@Body() dto: CreateInstitutionDto): Promise<InstitutionResponseDto> {
    return this.institutionsService.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ActorRole.PLATFORM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List every institution, paginated (platform admin only)' })
  @ApiResponse({ status: 200, type: PaginatedInstitutionsResponseDto })
  async findAll(
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedInstitutionsResponseDto> {
    return this.institutionsService.findAll(pagination);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ActorRole.PLATFORM_ADMIN, ActorRole.INSTITUTION_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get institution details' })
  @ApiResponse({ status: 200, type: InstitutionResponseDto })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InstitutionResponseDto> {
    return this.institutionsService.findById(id, user);
  }

  @Patch(':id/currency')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ActorRole.PLATFORM_ADMIN, ActorRole.INSTITUTION_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Update the institution's preferred currency - the institution's own admin or a platform admin only",
  })
  @ApiResponse({ status: 200, type: InstitutionResponseDto })
  @ApiResponse({ status: 403, description: 'Not allowed to manage this institution' })
  async updateCurrency(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePreferredCurrencyDto,
  ): Promise<InstitutionResponseDto> {
    return this.institutionsService.updatePreferredCurrency(id, user, dto);
  }

  @Post(':id/admins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ActorRole.PLATFORM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Provision an institution admin account (platform admin only)' })
  @ApiResponse({ status: 201, type: InstitutionAdminResponseDto })
  async createAdmin(
    @Param('id') institutionId: string,
    @Body() dto: CreateInstitutionAdminDto,
  ): Promise<InstitutionAdminResponseDto> {
    return this.institutionsService.createAdmin(institutionId, dto);
  }

  @Get(':id/admins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ActorRole.PLATFORM_ADMIN, ActorRole.INSTITUTION_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List admins for an institution' })
  @ApiResponse({ status: 200, type: [InstitutionAdminResponseDto] })
  async listAdmins(
    @Param('id') institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InstitutionAdminResponseDto[]> {
    return this.institutionsService.listAdmins(institutionId, user);
  }

  @Get(':id/students')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ActorRole.PLATFORM_ADMIN, ActorRole.INSTITUTION_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List students belonging to an institution, with latest KYC status (paginated)',
  })
  @ApiResponse({ status: 200, type: PaginatedStudentsResponseDto })
  async listStudents(
    @Param('id') institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedStudentsResponseDto> {
    return this.institutionsService.listStudents(institutionId, user, pagination);
  }
}
