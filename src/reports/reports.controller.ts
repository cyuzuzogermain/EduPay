import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActorRole } from '@prisma/client';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportFiltersDto } from './dto/report-filters.dto';
import { PaginatedReportResponseDto } from './dto/paginated-report-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ActorRole.INSTITUTION_ADMIN)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('institution')
  @ApiOperation({
    summary:
      "Paginated payments report for the requester's own institution, filterable by date range, status, and school ID. " +
      "Always scoped to the caller's own institutionId - there is no :id to guess.",
  })
  @ApiResponse({ status: 200, type: PaginatedReportResponseDto })
  async getReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: ReportFiltersDto,
  ): Promise<PaginatedReportResponseDto> {
    return this.reportsService.getInstitutionReport(user.institutionId as string, filters);
  }

  @Get('institution/export')
  @ApiOperation({ summary: 'CSV export of the same filtered payments report, unpaginated' })
  @ApiResponse({ status: 200, description: 'text/csv attachment' })
  async exportReport(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: ReportFiltersDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.reportsService.exportInstitutionReportCsv(
      user.institutionId as string,
      filters,
    );
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="edupay-payments-report.csv"`,
    });
    return csv;
  }
}
