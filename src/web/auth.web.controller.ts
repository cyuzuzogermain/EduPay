import { Body, Controller, Get, Post, Query, Req, Res, UseFilters } from '@nestjs/common';
import { Request, Response } from 'express';
import { ActorRole } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { StudentsService } from '../students/students.service';
import { InstitutionsService } from '../institutions/institutions.service';
import { LoginDto } from '../auth/dto/login.dto';
import { VerifyRegistrationDto } from '../students/dto/verify-registration.dto';
import { CompleteRegistrationDto } from '../students/dto/complete-registration.dto';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { WebExceptionFilter } from './web-exception.filter';
import { setAuthCookies, clearAuthCookies } from './cookie.util';
import { dashboardPathFor } from './role-redirect.util';

@Controller()
@UseFilters(WebExceptionFilter)
export class AuthWebController {
  constructor(
    private readonly authService: AuthService,
    private readonly studentsService: StudentsService,
    private readonly institutionsService: InstitutionsService,
  ) {}

  @Get('/')
  index(@Req() req: Request, @Res() res: Response) {
    const user = (req as Request & { user?: AuthenticatedUser }).user;
    if (user) return res.redirect(dashboardPathFor(user.role));
    return res.render('landing', { user: null });
  }

  @Get('/login')
  loginForm(@Req() req: Request, @Res() res: Response, @Query('error') error?: string) {
    const user = (req as Request & { user?: AuthenticatedUser }).user;
    if (user) return res.redirect(dashboardPathFor(user.role));
    return res.render('login', { user: null, error: error ?? null });
  }

  @Post('/login')
  async login(@Body() dto: LoginDto, @Res() res: Response) {
    const user = await this.authService.validateCredentials(dto.email, dto.password);

    if (!user) {
      return res.redirect(`/login?error=${encodeURIComponent('Invalid email or password.')}`);
    }

    const tokens = await this.authService.login(user);
    setAuthCookies(res, tokens);
    return res.redirect(dashboardPathFor(user.role));
  }

  @Get('/register')
  registerForm(@Req() req: Request, @Res() res: Response, @Query('error') error?: string) {
    const user = (req as Request & { user?: AuthenticatedUser }).user;
    if (user) return res.redirect(dashboardPathFor(user.role));
    return res.render('register', { user: null, error: error ?? null });
  }

  @Post('/register/verify')
  async verifyRegistration(@Body() dto: VerifyRegistrationDto, @Res() res: Response) {
    const verified = await this.studentsService.verifyForRegistration(dto);
    return res.redirect(
      `/register/complete?token=${encodeURIComponent(verified.verificationToken)}`,
    );
  }

  @Get('/register/complete')
  async registerCompleteForm(
    @Req() req: Request,
    @Res() res: Response,
    @Query('token') token?: string,
    @Query('error') error?: string,
  ) {
    const user = (req as Request & { user?: AuthenticatedUser }).user;
    if (user) return res.redirect(dashboardPathFor(user.role));

    if (!token) {
      return res.redirect(
        `/register?error=${encodeURIComponent('Please verify your details first.')}`,
      );
    }

    let verified;
    try {
      verified = this.authService.verifyRegistrationVerificationToken(token);
    } catch {
      return res.redirect(
        `/register?error=${encodeURIComponent('Your verification has expired - please verify your details again.')}`,
      );
    }

    const institutions = await this.institutionsService.findAllPublic();
    const institution = institutions.find((i) => i.id === verified.institutionId);

    return res.render('register-complete', {
      user: null,
      token,
      name: verified.name,
      schoolId: verified.schoolId,
      institutionName: institution?.name ?? null,
      error: error ?? null,
    });
  }

  @Post('/register')
  async register(@Body() dto: CompleteRegistrationDto, @Res() res: Response) {
    const student = await this.studentsService.completeRegistration(dto);
    const tokens = await this.authService.login({
      id: student.id,
      email: student.email,
      role: ActorRole.STUDENT,
    });
    setAuthCookies(res, tokens);
    return res.redirect('/dashboard');
  }

  @Post('/logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const user = (req as Request & { user?: AuthenticatedUser }).user;
    const refreshToken = req.cookies?.refresh_token;

    if (user && refreshToken) {
      try {
        await this.authService.logout(user, refreshToken);
      } catch {
        // token already invalid/expired - fall through and clear cookies anyway
      }
    }

    clearAuthCookies(res);
    return res.redirect('/login');
  }
}
