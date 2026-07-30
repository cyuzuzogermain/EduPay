import * as bcrypt from 'bcrypt';
import { PlatformAdmin, PrismaClient } from '@prisma/client';

const SALT_ROUNDS = 10;
const DEFAULT_PLATFORM_ADMIN_NAME = 'Platform Admin';

export interface BootstrapPlatformAdminResult {
  created: boolean;
  admin: Pick<PlatformAdmin, 'id' | 'email'>;
}

/// Production-safe entry point for provisioning the first platform admin account -
/// deliberately separate from prisma/seed.ts, which creates a full demo dataset (institutions,
/// students, payments, ...) and is meant for local development only. This creates nothing else.
/// Idempotent by email: re-running against an environment that's already been bootstrapped is
/// always safe and never throws, so it can be wired into a deploy step unconditionally.
export async function bootstrapPlatformAdmin(
  prisma: Pick<PrismaClient, 'platformAdmin'>,
  email: string,
  password: string,
): Promise<BootstrapPlatformAdminResult> {
  const existing = await prisma.platformAdmin.findUnique({ where: { email } });

  if (existing) {
    return { created: false, admin: { id: existing.id, email: existing.email } };
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const admin = await prisma.platformAdmin.create({
    data: { name: DEFAULT_PLATFORM_ADMIN_NAME, email, password: hashedPassword },
  });

  return { created: true, admin: { id: admin.id, email: admin.email } };
}
