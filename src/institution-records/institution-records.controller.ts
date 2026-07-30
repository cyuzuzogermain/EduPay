import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActorRole } from '@prisma/client';
import { InstitutionRecordsService } from './institution-records.service';
import { CreateRecordDto } from './dto/create-record.dto';
import { AddChargeDto } from './dto/add-charge.dto';
import { UpdateChargeDto } from './dto/update-charge.dto';
import { ListRecordsQueryDto } from './dto/list-records-query.dto';
import { RecordResponseDto } from './dto/record-response.dto';
import { RecordDetailResponseDto } from './dto/record-detail-response.dto';
import { ChargeDetailResponseDto } from './dto/charge-detail-response.dto';
import { PaginatedRecordsResponseDto } from './dto/paginated-records-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';

@ApiTags('institution-records')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ActorRole.INSTITUTION_ADMIN)
@Controller('school-financial-records')
export class InstitutionRecordsController {
  constructor(private readonly institutionRecordsService: InstitutionRecordsService) {}

  @Get()
  @ApiOperation({
    summary:
      "List every SchoolFinancialRecord for the requester's institution (paginated, optionally searchable by schoolId/studentName)",
  })
  @ApiResponse({ status: 200, type: PaginatedRecordsResponseDto })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRecordsQueryDto,
  ): Promise<PaginatedRecordsResponseDto> {
    return this.institutionRecordsService.listForInstitution(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a SchoolFinancialRecord for a student at this institution' })
  @ApiResponse({ status: 201, type: RecordResponseDto })
  @ApiResponse({ status: 409, description: 'A record with this school ID already exists' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecordDto,
  ): Promise<RecordResponseDto> {
    return this.institutionRecordsService.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a financial record with its itemized charges' })
  @ApiResponse({ status: 200, type: RecordDetailResponseDto })
  @ApiResponse({ status: 403, description: 'Record belongs to another institution' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async getDetail(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RecordDetailResponseDto> {
    return this.institutionRecordsService.getDetail(id, user);
  }

  @Post(':id/charges')
  @ApiOperation({ summary: "Append an itemized charge to a record's transaction data" })
  @ApiResponse({ status: 201, type: ChargeDetailResponseDto })
  @ApiResponse({ status: 403, description: 'Record belongs to another institution' })
  async addCharge(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddChargeDto,
  ): Promise<ChargeDetailResponseDto> {
    return this.institutionRecordsService.addCharge(id, user, dto);
  }

  @Patch(':id/charges/:chargeId')
  @ApiOperation({ summary: 'Edit a charge - blocked while a non-rejected payment covers it' })
  @ApiResponse({ status: 200, type: ChargeDetailResponseDto })
  @ApiResponse({ status: 403, description: 'Record belongs to another institution' })
  @ApiResponse({ status: 409, description: 'Charge has a live (non-rejected) payment attached' })
  async updateCharge(
    @Param('id') id: string,
    @Param('chargeId') chargeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateChargeDto,
  ): Promise<ChargeDetailResponseDto> {
    return this.institutionRecordsService.updateCharge(id, chargeId, user, dto);
  }

  @Delete(':id/charges/:chargeId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a charge - blocked while a non-rejected payment covers it' })
  @ApiResponse({ status: 200, description: 'Charge deleted' })
  @ApiResponse({ status: 403, description: 'Record belongs to another institution' })
  @ApiResponse({ status: 409, description: 'Charge has a live (non-rejected) payment attached' })
  async deleteCharge(
    @Param('id') id: string,
    @Param('chargeId') chargeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ message: string }> {
    await this.institutionRecordsService.deleteCharge(id, chargeId, user);
    return { message: 'Charge deleted' };
  }
}
