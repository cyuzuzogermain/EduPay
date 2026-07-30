import { PrismaClient } from '@prisma/client';
import { bootstrapPlatformAdmin } from '../src/auth/platform-admin-bootstrap';

/// Standalone production entry point - `npm run bootstrap`. Creates only the platform admin
/// account, reading credentials from the environment (never hardcoded). Safe to run on every
/// deploy: it's a no-op once that admin already exists. Does not touch prisma/seed.ts's demo
/// data at all - the two are entirely separate paths (seed for local dev, this for production).
async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must both be set to run the bootstrap script.',
    );
  }

  const prisma = new PrismaClient();

  try {
    const result = await bootstrapPlatformAdmin(prisma, email, password);

    if (result.created) {
      console.log(`Created platform admin: ${result.admin.email}`);
    } else {
      console.log(`Platform admin already exists - skipping: ${result.admin.email}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
