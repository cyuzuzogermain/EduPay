import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ActorRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthenticatedUser,
  JwtPayload,
  RegistrationVerificationPayload,
} from '../common/types/jwt-payload.interface';
import { AuthResponseDto } from './dto/auth-response.dto';

interface RefreshTokenPayload extends JwtPayload {
  jti: string;
}

/// Short-lived - just long enough to fill in a password on the next screen. Not tied to
/// jwt.expiresIn since it's a different kind of token entirely (a verification proof, not a
/// session credential).
const REGISTRATION_VERIFICATION_EXPIRES_IN = '15m';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async verifyAccessToken(accessToken: string): Promise<AuthenticatedUser | null> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(accessToken, {
        secret: this.configService.get<string>('jwt.secret'),
      });
      return this.findActorByIdAndRole(payload.sub, payload.role);
    } catch {
      return null;
    }
  }

  async validateCredentials(email: string, password: string): Promise<AuthenticatedUser | null> {
    const student = await this.prisma.student.findUnique({ where: { email } });
    if (student && (await bcrypt.compare(password, student.password))) {
      return { id: student.id, email: student.email, role: ActorRole.STUDENT };
    }

    const institutionAdmin = await this.prisma.institutionAdmin.findUnique({ where: { email } });
    if (institutionAdmin && (await bcrypt.compare(password, institutionAdmin.password))) {
      return {
        id: institutionAdmin.id,
        email: institutionAdmin.email,
        role: ActorRole.INSTITUTION_ADMIN,
        institutionId: institutionAdmin.institutionId,
      };
    }

    const platformAdmin = await this.prisma.platformAdmin.findUnique({ where: { email } });
    if (platformAdmin && (await bcrypt.compare(password, platformAdmin.password))) {
      return { id: platformAdmin.id, email: platformAdmin.email, role: ActorRole.PLATFORM_ADMIN };
    }

    return null;
  }

  async findActorByIdAndRole(id: string, role: ActorRole): Promise<AuthenticatedUser | null> {
    switch (role) {
      case ActorRole.STUDENT: {
        const student = await this.prisma.student.findUnique({ where: { id } });
        return student ? { id: student.id, email: student.email, role } : null;
      }
      case ActorRole.INSTITUTION_ADMIN: {
        const admin = await this.prisma.institutionAdmin.findUnique({ where: { id } });
        return admin
          ? { id: admin.id, email: admin.email, role, institutionId: admin.institutionId }
          : null;
      }
      case ActorRole.PLATFORM_ADMIN: {
        const admin = await this.prisma.platformAdmin.findUnique({ where: { id } });
        return admin ? { id: admin.id, email: admin.email, role } : null;
      }
      default:
        return null;
    }
  }

  async login(user: AuthenticatedUser): Promise<AuthResponseDto> {
    const accessToken = this.signAccessToken(user);
    const { refreshToken, jti, expiresAt } = this.signRefreshToken(user);

    await this.prisma.refreshToken.create({
      data: { jti, subjectId: user.id, role: user.role, expiresAt },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configService.get<string>('jwt.expiresIn') as string,
      role: user.role,
    };
  }

  async logout(user: AuthenticatedUser, refreshToken: string): Promise<void> {
    const payload = this.decodeRefreshToken(refreshToken);

    if (payload.sub !== user.id || payload.role !== user.role) {
      throw new UnauthorizedException('Refresh token does not belong to this user');
    }

    await this.prisma.refreshToken.updateMany({
      where: { jti: payload.jti, subjectId: user.id, role: user.role, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const payload = this.decodeRefreshToken(refreshToken);
    const session = await this.prisma.refreshToken.findUnique({ where: { jti: payload.jti } });

    if (
      !session ||
      session.subjectId !== payload.sub ||
      session.role !== payload.role ||
      session.revokedAt ||
      session.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Refresh token is invalid or has expired');
    }

    const actor = await this.findActorByIdAndRole(payload.sub, payload.role);

    if (!actor) {
      throw new UnauthorizedException('Account no longer exists');
    }

    await this.prisma.refreshToken.update({
      where: { jti: payload.jti },
      data: { revokedAt: new Date() },
    });

    const accessToken = this.signAccessToken(actor);
    const rotated = this.signRefreshToken(actor);

    await this.prisma.refreshToken.create({
      data: {
        jti: rotated.jti,
        subjectId: actor.id,
        role: actor.role,
        expiresAt: rotated.expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: rotated.refreshToken,
      expiresIn: this.configService.get<string>('jwt.expiresIn') as string,
      role: actor.role,
    };
  }

  /// Signs proof that `payload` was already matched against a real SchoolFinancialRecord -
  /// registration step 2 trusts institutionId/schoolId/name/email from this token alone and
  /// never accepts them directly from the client.
  signRegistrationVerificationToken(
    payload: Omit<RegistrationVerificationPayload, 'purpose'>,
  ): string {
    const fullPayload: RegistrationVerificationPayload = {
      ...payload,
      purpose: 'student-registration',
    };

    return this.jwtService.sign(fullPayload, {
      secret: this.configService.get<string>('jwt.secret'),
      expiresIn: REGISTRATION_VERIFICATION_EXPIRES_IN,
    });
  }

  verifyRegistrationVerificationToken(token: string): RegistrationVerificationPayload {
    let decoded: unknown;

    try {
      decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('jwt.secret'),
      });
    } catch {
      throw new UnauthorizedException(
        'Your verification has expired - please verify your details again',
      );
    }

    if (!AuthService.isRegistrationVerificationPayload(decoded)) {
      throw new UnauthorizedException(
        'Invalid verification data - please verify your details again',
      );
    }

    return decoded;
  }

  private static isRegistrationVerificationPayload(
    value: unknown,
  ): value is RegistrationVerificationPayload {
    const payload = value as Partial<RegistrationVerificationPayload> | null;

    return (
      !!payload &&
      payload.purpose === 'student-registration' &&
      typeof payload.name === 'string' &&
      typeof payload.email === 'string' &&
      typeof payload.institutionId === 'string' &&
      typeof payload.schoolId === 'string'
    );
  }

  private signAccessToken(user: AuthenticatedUser): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      institutionId: user.institutionId,
    };
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.secret'),
      expiresIn: this.configService.get<string>('jwt.expiresIn'),
    });
  }

  private signRefreshToken(user: AuthenticatedUser): {
    refreshToken: string;
    jti: string;
    expiresAt: Date;
  } {
    const jti = randomUUID();
    const payload: RefreshTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      institutionId: user.institutionId,
      jti,
    };
    const expiresIn = this.configService.get<string>('jwt.refreshExpiresIn') as string;

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn,
    });

    const expiresAt = new Date(Date.now() + this.parseExpiryToSeconds(expiresIn) * 1000);

    return { refreshToken, jti, expiresAt };
  }

  private decodeRefreshToken(refreshToken: string): RefreshTokenPayload {
    try {
      return this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private parseExpiryToSeconds(expiry: string): number {
    const match = /^(\d+)([smhd])$/.exec(expiry);

    if (!match) {
      return 60 * 60 * 24 * 7;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

    return value * multipliers[unit];
  }
}
