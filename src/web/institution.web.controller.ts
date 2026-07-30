import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ActorRole } from '@prisma/client';
import { InstitutionsService } from '../institutions/institutions.service';
import { StudentsService } from '../students/students.service';
import { PaymentsService } from '../payments/payments.service';
import { InstitutionRecordsService } from '../institution-records/institution-records.service';
import { ReportsService } from '../reports/reports.service';
import { ReviewKycDto } from '../students/dto/review-kyc.dto';
import { ReviewPaymentDto } from '../payments/dto/review-payment.dto';
import { CreateRecordDto } from '../institution-records/dto/create-record.dto';
import { AddChargeDto } from '../institution-records/dto/add-charge.dto';
import { ReportFiltersDto } from '../reports/dto/report-filters.dto';
import { UpdatePreferredCurrencyDto } from '../institutions/dto/update-preferred-currency.dto';
import { SEND_CURRENCIES } from '../payments/currencies';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { WebAuthGuard } from './web-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { WebExceptionFilter } from './web-exception.filter';

@Controller('institution')
@UseGuards(WebAuthGuard, RolesGuard)
@Roles(ActorRole.INSTITUTION_ADMIN)
@UseFilters(WebExceptionFilter)
export class InstitutionWebController {
  constructor(
    private readonly institutionsService: InstitutionsService,
    private readonly studentsService: StudentsService,
    private readonly paymentsService: PaymentsService,
    private readonly institutionRecordsService: InstitutionRecordsService,
    private readonly reportsService: ReportsService,
  ) {}

  @Get()
  overview(@Res() res: Response) {
    // Records is the institution admin's landing page - no separate overview page anymore (its
    // stat tiles moved to /institution/records, pending-KYC moved to /institution/students).
    return res.redirect('/institution/records');
  }

  @Post('currency')
  async updateCurrency(
    @Req() req: Request,
    @Res() res: Response,
    @Body() dto: UpdatePreferredCurrencyDto,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const institutionId = user.institutionId as string;
    await this.institutionsService.updatePreferredCurrency(institutionId, user, dto);
    return res.redirect(
      `/institution/records?success=${encodeURIComponent('Preferred currency updated.')}`,
    );
  }

  @Get('students')
  async students(@Req() req: Request, @Res() res: Response, @Query('page') page?: string) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const institutionId = user.institutionId as string;
    const [{ items, meta }, pendingCount] = await Promise.all([
      this.institutionsService.listStudents(institutionId, user, { page: Number(page) || 1 }),
      this.studentsService.countPendingKyc(institutionId),
    ]);
    return res.render('institution/students', { user, students: items, meta, pendingCount });
  }

  @Get('students/:id')
  async studentDetail(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') studentId: string,
    @Query('error') error?: string,
    @Query('success') success?: string,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const { student, kycDocuments } = await this.studentsService.getForReview(studentId, user);

    return res.render('institution/student-detail', {
      user,
      student,
      kycDocuments,
      error: error ?? null,
      success: success ?? null,
    });
  }

  @Post('students/:id/kyc/:documentId/review')
  async reviewKyc(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') studentId: string,
    @Param('documentId') documentId: string,
    @Body() dto: ReviewKycDto,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    await this.studentsService.reviewKyc(studentId, documentId, user, dto);
    return res.redirect(
      `/institution/students/${studentId}?success=${encodeURIComponent('Document reviewed.')}`,
    );
  }

  @Get('payments')
  async payments(
    @Req() req: Request,
    @Res() res: Response,
    @Query('page') page?: string,
    @Query('error') error?: string,
    @Query('success') success?: string,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const { items, meta } = await this.paymentsService.listPendingApprovals(user, {
      page: Number(page) || 1,
    });

    return res.render('institution/payments', {
      user,
      payments: items,
      meta,
      error: error ?? null,
      success: success ?? null,
    });
  }

  @Post('payments/:id/review')
  async reviewPayment(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') paymentId: string,
    @Body() dto: ReviewPaymentDto,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    await this.paymentsService.reviewPayment(paymentId, user, dto);
    return res.redirect(`/institution/payments?success=${encodeURIComponent('Payment reviewed.')}`);
  }

  @Get('records')
  async records(
    @Req() req: Request,
    @Res() res: Response,
    @Query('page') page?: string,
    @Query('search') search?: string,
    @Query('error') error?: string,
    @Query('success') success?: string,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const institutionId = user.institutionId as string;

    const [{ items, meta }, institution, stats] = await Promise.all([
      this.institutionRecordsService.listForInstitution(user, {
        page: Number(page) || 1,
        search: search || undefined,
      }),
      this.institutionsService.findById(institutionId, user),
      this.institutionRecordsService.getInstitutionStats(institutionId),
    ]);

    return res.render('institution/records', {
      user,
      records: items,
      meta,
      institution,
      stats,
      currencies: SEND_CURRENCIES,
      search: search ?? '',
      error: error ?? null,
      success: success ?? null,
    });
  }

  @Post('records')
  async createRecord(@Req() req: Request, @Res() res: Response, @Body() dto: CreateRecordDto) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const record = await this.institutionRecordsService.create(user, dto);
    return res.redirect(
      `/institution/records/${record.id}?success=${encodeURIComponent('Financial record created.')}`,
    );
  }

  @Get('records/:id')
  async recordDetail(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') recordId: string,
    @Query('error') error?: string,
    @Query('success') success?: string,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const record = await this.institutionRecordsService.getDetail(recordId, user);

    return res.render('institution/record-detail', {
      user,
      record,
      error: error ?? null,
      success: success ?? null,
    });
  }

  @Post('records/:id/charges')
  async addCharge(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') recordId: string,
    @Body() dto: AddChargeDto,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    await this.institutionRecordsService.addCharge(recordId, user, dto);
    return res.redirect(
      `/institution/records/${recordId}?success=${encodeURIComponent('Charge added.')}`,
    );
  }

  @Get('reports')
  async reports(@Req() req: Request, @Res() res: Response, @Query() filters: ReportFiltersDto) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const { items, meta } = await this.reportsService.getInstitutionReport(
      user.institutionId as string,
      filters,
    );

    return res.render('institution/reports', {
      user,
      payments: items,
      meta,
      filters,
    });
  }
}
