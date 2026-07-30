import { Response } from 'express';
import { AuthResponseDto } from '../auth/dto/auth-response.dto';

function parseExpiryToMs(expiry: string): number {
  const match = /^(\d+)([smhd])$/.exec(expiry);
  if (!match) return 7 * 86400 * 1000;
  const value = parseInt(match[1], 10);
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[match[2]];
}

const isProduction = process.env.NODE_ENV === 'production';

export function setAuthCookies(response: Response, tokens: AuthResponseDto): void {
  response.cookie('access_token', tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: parseExpiryToMs(tokens.expiresIn),
  });
  response.cookie('refresh_token', tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: 30 * 86_400_000,
  });
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie('access_token');
  response.clearCookie('refresh_token');
}
