import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class OptionalAuthMiddleware implements NestMiddleware {
  constructor(private readonly authService: AuthService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = req.cookies?.access_token;

    if (token) {
      const user = await this.authService.verifyAccessToken(token);
      if (user) {
        (req as Request & { user?: unknown }).user = user;
      }
    }

    next();
  }
}
