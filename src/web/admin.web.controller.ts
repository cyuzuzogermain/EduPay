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
import { CreateInstitutionDto } from '../institutions/dto/create-institution.dto';
import { CreateInstitutionAdminDto } from '../institutions/dto/create-institution-admin.dto';
import { UpdatePreferredCurrencyDto } from '../institutions/dto/update-preferred-currency.dto';
import { PaymentsService } from '../payments/payments.service';
import { ReviewKycDto } from '../students/dto/review-kyc.dto';
import { ReviewPaymentDto } from '../payments/dto/review-payment.dto';
import { SEND_CURRENCIES } from '../payments/currencies';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { WebAuthGuard } from './web-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { WebExceptionFilter } from './web-exception.filter';

@Controller('admin')
@UseGuards(WebAuthGuard, RolesGuard)
@Roles(ActorRole.PLATFORM_ADMIN)
@UseFilters(WebExceptionFilter)
export class AdminWebController {
  constructor(
    private readonly institutionsService: InstitutionsService,
    private readonly studentsService: StudentsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get()
  async overview(@Req() req: Request, @Res() res: Response) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const [institutionCount, studentCount, pendingCount] = await Promise.all([
      this.institutionsService.countAll(),
      this.studentsService.countAll(),
      this.studentsService.countPendingKyc(),
    ]);

    return res.render('admin/overview', {
      user,
      institutionCount,
      studentCount,
      pendingCount,
    });
  }

  @Get('institutions')
  async institutions(
    @Req() req: Request,
    @Res() res: Response,
    @Query('page') page?: string,
    @Query('error') error?: string,
    @Query('success') success?: string,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const { items, meta } = await this.institutionsService.findAll({ page: Number(page) || 1 });
    return res.render('admin/institutions', {
      user,
      institutions: items,
      meta,
      currencies: SEND_CURRENCIES,
      error: error ?? null,
      success: success ?? null,
    });
  }

  @Post('institutions')
  async createInstitution(@Res() res: Response, @Body() dto: CreateInstitutionDto) {
    const institution = await this.institutionsService.create(dto);
    return res.redirect(
      `/admin/institutions/${institution.id}?success=${encodeURIComponent('Institution created.')}`,
    );
  }

  @Get('institutions/:id')
  async institutionDetail(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') institutionId: string,
    @Query('error') error?: string,
    @Query('success') success?: string,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const [institution, admins, studentsPage] = await Promise.all([
      this.institutionsService.findById(institutionId, user),
      this.institutionsService.listAdmins(institutionId, user),
      this.institutionsService.listStudents(institutionId, user, { page: 1, pageSize: 100 }),
    ]);

    return res.render('admin/institution-detail', {
      user,
      institution,
      admins,
      students: studentsPage.items,
      studentTotal: studentsPage.meta.total,
      currencies: SEND_CURRENCIES,
      error: error ?? null,
      success: success ?? null,
    });
  }

  @Post('institutions/:id/currency')
  async updateInstitutionCurrency(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') institutionId: string,
    @Body() dto: UpdatePreferredCurrencyDto,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    await this.institutionsService.updatePreferredCurrency(institutionId, user, dto);
    return res.redirect(
      `/admin/institutions/${institutionId}?success=${encodeURIComponent('Preferred currency updated.')}`,
    );
  }

  @Post('institutions/:id/admins')
  async createAdmin(
    @Res() res: Response,
    @Param('id') institutionId: string,
    @Body() dto: CreateInstitutionAdminDto,
  ) {
    await this.institutionsService.createAdmin(institutionId, dto);
    return res.redirect(
      `/admin/institutions/${institutionId}?success=${encodeURIComponent('Institution admin created.')}`,
    );
  }

  @Get('students')
  async students(@Req() req: Request, @Res() res: Response, @Query('page') page?: string) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const { items, meta } = await this.studentsService.listForRequester(user, {
      page: Number(page) || 1,
    });
    return res.render('admin/students', { user, students: items, meta });
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

    return res.render('admin/student-detail', {
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
      `/admin/students/${studentId}?success=${encodeURIComponent('Document reviewed.')}`,
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

    return res.render('admin/payments', {
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
    return res.redirect(`/admin/payments?success=${encodeURIComponent('Payment reviewed.')}`);
  }
}
