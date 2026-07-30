import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ActorRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: {
    student: { findUnique: jest.Mock };
    institutionAdmin: { findUnique: jest.Mock };
    platformAdmin: { findUnique: jest.Mock };
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let configService: { get: jest.Mock };

  const student = {
    id: 'student-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: '',
    country: 'Rwanda',
    institutionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const institutionAdmin = {
    id: 'admin-1',
    name: 'Jane Mugisha',
    email: 'jane@ur.ac.rw',
    password: '',
    institutionId: 'institution-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    student.password = await bcrypt.hash('correct-password', 10);
    institutionAdmin.password = await bcrypt.hash('admin-password', 10);

    prisma = {
      student: { findUnique: jest.fn() },
      institutionAdmin: { findUnique: jest.fn() },
      platformAdmin: { findUnique: jest.fn() },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    jwtService = { sign: jest.fn(), verify: jest.fn() };
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'jwt.secret': 'access-secret',
          'jwt.expiresIn': '15m',
          'jwt.refreshSecret': 'refresh-secret',
          'jwt.refreshExpiresIn': '7d',
        };
        return values[key];
      }),
    };

    authService = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
  });

  describe('validateCredentials', () => {
    it('returns a student when student credentials are correct', async () => {
      prisma.student.findUnique.mockResolvedValue(student);

      const result = await authService.validateCredentials('ada@example.com', 'correct-password');

      expect(result).toEqual({ id: student.id, email: student.email, role: ActorRole.STUDENT });
    });

    it('falls through to institution admins when no student matches', async () => {
      prisma.student.findUnique.mockResolvedValue(null);
      prisma.institutionAdmin.findUnique.mockResolvedValue(institutionAdmin);

      const result = await authService.validateCredentials('jane@ur.ac.rw', 'admin-password');

      expect(result).toEqual({
        id: institutionAdmin.id,
        email: institutionAdmin.email,
        role: ActorRole.INSTITUTION_ADMIN,
        institutionId: institutionAdmin.institutionId,
      });
    });

    it('falls through to platform admins when neither student nor institution admin matches', async () => {
      const platformAdmin = {
        id: 'platform-1',
        name: 'EduPay Admin',
        email: 'ops@edupay.example',
        password: await bcrypt.hash('ops-password', 10),
      };
      prisma.student.findUnique.mockResolvedValue(null);
      prisma.institutionAdmin.findUnique.mockResolvedValue(null);
      prisma.platformAdmin.findUnique.mockResolvedValue(platformAdmin);

      const result = await authService.validateCredentials('ops@edupay.example', 'ops-password');

      expect(result).toEqual({
        id: platformAdmin.id,
        email: platformAdmin.email,
        role: ActorRole.PLATFORM_ADMIN,
      });
    });

    it('returns null when no actor matches', async () => {
      prisma.student.findUnique.mockResolvedValue(null);
      prisma.institutionAdmin.findUnique.mockResolvedValue(null);
      prisma.platformAdmin.findUnique.mockResolvedValue(null);

      const result = await authService.validateCredentials('missing@example.com', 'whatever');

      expect(result).toBeNull();
    });

    it('returns null when the password is incorrect', async () => {
      prisma.student.findUnique.mockResolvedValue(student);

      const result = await authService.validateCredentials('ada@example.com', 'wrong-password');

      expect(result).toBeNull();
    });
  });

  describe('findActorByIdAndRole', () => {
    it('resolves a student by id', async () => {
      prisma.student.findUnique.mockResolvedValue(student);

      const result = await authService.findActorByIdAndRole(student.id, ActorRole.STUDENT);

      expect(result).toEqual({ id: student.id, email: student.email, role: ActorRole.STUDENT });
    });

    it('resolves an institution admin by id', async () => {
      prisma.institutionAdmin.findUnique.mockResolvedValue(institutionAdmin);

      const result = await authService.findActorByIdAndRole(
        institutionAdmin.id,
        ActorRole.INSTITUTION_ADMIN,
      );

      expect(result).toEqual({
        id: institutionAdmin.id,
        email: institutionAdmin.email,
        role: ActorRole.INSTITUTION_ADMIN,
        institutionId: institutionAdmin.institutionId,
      });
    });

    it('returns null when the institution admin no longer exists', async () => {
      prisma.institutionAdmin.findUnique.mockResolvedValue(null);

      const result = await authService.findActorByIdAndRole('missing', ActorRole.INSTITUTION_ADMIN);

      expect(result).toBeNull();
    });

    it('resolves a platform admin by id', async () => {
      const platformAdmin = { id: 'platform-1', email: 'ops@edupay.example' };
      prisma.platformAdmin.findUnique.mockResolvedValue(platformAdmin);

      const result = await authService.findActorByIdAndRole(
        platformAdmin.id,
        ActorRole.PLATFORM_ADMIN,
      );

      expect(result).toEqual({
        id: platformAdmin.id,
        email: platformAdmin.email,
        role: ActorRole.PLATFORM_ADMIN,
      });
    });

    it('returns null for an unrecognized role', async () => {
      const result = await authService.findActorByIdAndRole('any-id', 'BOGUS' as ActorRole);

      expect(result).toBeNull();
    });

    it('returns null when the actor no longer exists', async () => {
      prisma.student.findUnique.mockResolvedValue(null);

      const result = await authService.findActorByIdAndRole('missing', ActorRole.STUDENT);

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('signs access and refresh tokens and persists the refresh session', async () => {
      jwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

      const result = await authService.login({
        id: student.id,
        email: student.email,
        role: ActorRole.STUDENT,
      });

      expect(jwtService.sign).toHaveBeenCalledTimes(2);
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subjectId: student.id, role: ActorRole.STUDENT }),
        }),
      );
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: '15m',
        role: ActorRole.STUDENT,
      });
    });

    it('falls back to a 7-day session when refreshExpiresIn is not in the expected format', async () => {
      configService.get.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'jwt.secret': 'access-secret',
          'jwt.expiresIn': '15m',
          'jwt.refreshSecret': 'refresh-secret',
          'jwt.refreshExpiresIn': 'not-a-valid-duration',
        };
        return values[key];
      });
      jwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

      await authService.login({ id: student.id, email: student.email, role: ActorRole.STUDENT });

      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expiresAt: expect.any(Date),
          }),
        }),
      );
      const createdAt = prisma.refreshToken.create.mock.calls[0][0].data.expiresAt as Date;
      const daysUntilExpiry = (createdAt.getTime() - Date.now()) / 86_400_000;
      expect(daysUntilExpiry).toBeGreaterThan(6.9);
      expect(daysUntilExpiry).toBeLessThan(7.1);
    });
  });

  describe('logout', () => {
    const user = { id: student.id, email: student.email, role: ActorRole.STUDENT };

    it('revokes the refresh session when the token belongs to the user', async () => {
      jwtService.verify.mockReturnValue({
        sub: student.id,
        email: student.email,
        role: ActorRole.STUDENT,
        jti: 'jti-1',
      });

      await authService.logout(user, 'refresh-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { jti: 'jti-1', subjectId: student.id, role: ActorRole.STUDENT, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('throws when the refresh token belongs to a different user', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'someone-else',
        email: student.email,
        role: ActorRole.STUDENT,
        jti: 'jti-1',
      });

      await expect(authService.logout(user, 'refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when the refresh token is invalid', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      await expect(authService.logout(user, 'bad-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    const activeSession = {
      id: 'session-1',
      jti: 'jti-1',
      subjectId: student.id,
      role: ActorRole.STUDENT,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    };

    it('rotates the refresh token when the session is valid', async () => {
      jwtService.verify.mockReturnValue({
        sub: student.id,
        email: student.email,
        role: ActorRole.STUDENT,
        jti: 'jti-1',
      });
      prisma.refreshToken.findUnique.mockResolvedValue(activeSession);
      prisma.student.findUnique.mockResolvedValue(student);
      jwtService.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');

      const result = await authService.refresh('refresh-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { jti: 'jti-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subjectId: student.id, role: ActorRole.STUDENT }),
        }),
      );
      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: '15m',
        role: ActorRole.STUDENT,
      });
    });

    it('throws when the session no longer exists', async () => {
      jwtService.verify.mockReturnValue({
        sub: student.id,
        email: student.email,
        role: ActorRole.STUDENT,
        jti: 'jti-1',
      });
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(authService.refresh('refresh-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when the session role does not match the token payload', async () => {
      jwtService.verify.mockReturnValue({
        sub: student.id,
        email: student.email,
        role: ActorRole.STUDENT,
        jti: 'jti-1',
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...activeSession,
        role: ActorRole.PLATFORM_ADMIN,
      });

      await expect(authService.refresh('refresh-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when the session has already been revoked', async () => {
      jwtService.verify.mockReturnValue({
        sub: student.id,
        email: student.email,
        role: ActorRole.STUDENT,
        jti: 'jti-1',
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...activeSession,
        revokedAt: new Date(),
      });

      await expect(authService.refresh('refresh-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when the session has expired', async () => {
      jwtService.verify.mockReturnValue({
        sub: student.id,
        email: student.email,
        role: ActorRole.STUDENT,
        jti: 'jti-1',
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...activeSession,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(authService.refresh('refresh-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws when the actor no longer exists', async () => {
      jwtService.verify.mockReturnValue({
        sub: student.id,
        email: student.email,
        role: ActorRole.STUDENT,
        jti: 'jti-1',
      });
      prisma.refreshToken.findUnique.mockResolvedValue(activeSession);
      prisma.student.findUnique.mockResolvedValue(null);

      await expect(authService.refresh('refresh-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('registration verification tokens', () => {
    const registrationPayload = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      institutionId: 'institution-1',
      schoolId: 'STU-1001',
    };

    it('signs a token carrying the verified pair with a student-registration purpose', () => {
      jwtService.sign.mockReturnValue('signed-verification-token');

      const token = authService.signRegistrationVerificationToken(registrationPayload);

      expect(token).toBe('signed-verification-token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        { ...registrationPayload, purpose: 'student-registration' },
        expect.objectContaining({ secret: 'access-secret', expiresIn: '15m' }),
      );
    });

    it('verifies and decodes a valid token', () => {
      jwtService.verify.mockReturnValue({
        ...registrationPayload,
        purpose: 'student-registration',
      });

      const result = authService.verifyRegistrationVerificationToken('valid-token');

      expect(result).toEqual({ ...registrationPayload, purpose: 'student-registration' });
    });

    it('throws UnauthorizedException when the token is invalid or expired', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      expect(() => authService.verifyRegistrationVerificationToken('bad-token')).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the decoded payload has the wrong purpose', () => {
      jwtService.verify.mockReturnValue({
        sub: 'student-1',
        email: 'ada@example.com',
        role: ActorRole.STUDENT,
      });

      expect(() => authService.verifyRegistrationVerificationToken('access-token')).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when the decoded payload is missing required fields', () => {
      jwtService.verify.mockReturnValue({ purpose: 'student-registration', name: 'Ada Lovelace' });

      expect(() => authService.verifyRegistrationVerificationToken('incomplete-token')).toThrow(
        UnauthorizedException,
      );
    });
  });
});
