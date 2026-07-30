import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { ActorRole } from '@prisma/client';
import { StudentsService } from '../students/students.service';
import { InstitutionsService } from '../institutions/institutions.service';
import { FinanceService } from '../finance/finance.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SEND_CURRENCIES } from '../payments/currencies';
import { UpdateStudentDto } from '../students/dto/update-student.dto';
import { SubmitKycDto } from '../students/dto/submit-kyc.dto';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { WebAuthGuard } from './web-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { WebExceptionFilter } from './web-exception.filter';

@Controller()
@UseGuards(WebAuthGuard, RolesGuard)
@Roles(ActorRole.STUDENT)
@UseFilters(WebExceptionFilter)
export class StudentWebController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly institutionsService: InstitutionsService,
    private readonly financeService: FinanceService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Get('/dashboard')
  async dashboard(
    @Req() req: Request,
    @Res() res: Response,
    @Query('error') error?: string,
    @Query('success') success?: string,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const [student, institutions, unreadCount, balance, kycStatus] = await Promise.all([
      this.studentsService.findById(user.id, user),
      this.institutionsService.findAllPublic(),
      this.notificationsService.countUnread(user.id),
      this.financeService.getBalanceForStudent(user.id),
      this.studentsService.getKycStatus(user.id),
    ]);

    return res.render('student/dashboard', {
      user,
      student,
      institutions,
      unreadCount,
      balance,
      kycStatus,
      error: error ?? null,
      success: success ?? null,
    });
  }

  @Post('/dashboard')
  async updateProfile(@Req() req: Request, @Res() res: Response, @Body() dto: UpdateStudentDto) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    await this.studentsService.update(user.id, user.id, dto);
    return res.redirect(`/dashboard?success=${encodeURIComponent('Profile updated.')}`);
  }

  @Get('/kyc')
  async kyc(
    @Req() req: Request,
    @Res() res: Response,
    @Query('error') error?: string,
    @Query('success') success?: string,
  ) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const [status, unreadCount] = await Promise.all([
      this.studentsService.getKycStatus(user.id),
      this.notificationsService.countUnread(user.id),
    ]);

    return res.render('student/kyc', {
      user,
      status,
      unreadCount,
      error: error ?? null,
      success: success ?? null,
    });
  }

  @Post('/kyc')
  @UseInterceptors(FileInterceptor('file'))
  async submitKyc(
    @Req() req: Request,
    @Res() res: Response,
    @Body() dto: SubmitKycDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }

    const user = (req as Request & { user: AuthenticatedUser }).user;
    await this.studentsService.submitKyc(user.id, user.id, dto, file);
    return res.redirect(`/kyc?success=${encodeURIComponent('Document submitted for review.')}`);
  }

  @Get('/payments')
  async payments(@Req() req: Request, @Res() res: Response) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const [student, balance, charges, unreadCount, kycStatus, institutions] = await Promise.all([
      this.studentsService.findById(user.id, user),
      this.financeService.getBalanceForStudent(user.id),
      this.paymentsService.getOutstandingCharges(user.id),
      this.notificationsService.countUnread(user.id),
      this.studentsService.getKycStatus(user.id),
      this.institutionsService.findAllPublic(),
    ]);
    const institution = institutions.find((i) => i.id === student.institutionId);

    return res.render('student/payments', {
      user,
      student,
      balance,
      charges,
      unreadCount,
      kycApproved: kycStatus.status === 'APPROVED',
      sendCurrencies: SEND_CURRENCIES,
      institutionName: institution?.name ?? null,
    });
  }

  @Get('/notifications')
  async notifications(@Req() req: Request, @Res() res: Response) {
    const user = (req as Request & { user: AuthenticatedUser }).user;
    const notifications = await this.notificationsService.listForStudent(user.id);
    await this.notificationsService.markAllRead(user.id);

    return res.render('student/notifications', { user, notifications, unreadCount: 0 });
  }
}
