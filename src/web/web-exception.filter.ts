import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class WebExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof UnauthorizedException) {
      response.clearCookie('access_token');
      response.clearCookie('refresh_token');
      return response.redirect('/login');
    }

    const { status, message } = this.resolve(exception);

    if (request.method !== 'GET') {
      const fallback = (request.headers.referer as string) || '/';
      const separator = fallback.includes('?') ? '&' : '?';
      return response.redirect(`${fallback}${separator}error=${encodeURIComponent(message)}`);
    }

    return response.status(status).render('error', {
      title: status === 404 ? 'Not found' : status === 403 ? 'Forbidden' : 'Something went wrong',
      message,
      user: (request as Request & { user?: unknown }).user ?? null,
    });
  }

  private resolve(exception: unknown): { status: number; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return { status, message: body };
      }

      const record = body as Record<string, unknown>;
      const raw = record.message ?? exception.message;
      const message = Array.isArray(raw) ? raw.join(', ') : String(raw);
      return { status, message };
    }

    return { status: 500, message: 'Something went wrong on our end.' };
  }
}
