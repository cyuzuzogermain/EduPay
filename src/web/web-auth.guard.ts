import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class WebAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Without this, a browser can restore a previously-authenticated page (e.g. via the
    // back/forward cache) after logout without ever sending a fresh request to the server -
    // the page just reappears from cache, cookies or not. no-store forces a real request on
    // back-navigation, which then correctly fails auth and redirects to /login.
    response.set('Cache-Control', 'no-store, must-revalidate');

    if (!request.user) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
