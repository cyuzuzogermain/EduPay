import { ActorRole } from '@prisma/client';

export function dashboardPathFor(role: ActorRole): string {
  switch (role) {
    case ActorRole.STUDENT:
      return '/dashboard';
    case ActorRole.INSTITUTION_ADMIN:
      return '/institution/records';
    case ActorRole.PLATFORM_ADMIN:
      return '/admin';
    default:
      return '/login';
  }
}
