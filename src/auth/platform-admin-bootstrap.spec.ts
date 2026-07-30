import * as bcrypt from 'bcrypt';
import { bootstrapPlatformAdmin } from './platform-admin-bootstrap';

describe('bootstrapPlatformAdmin', () => {
  let prisma: { platformAdmin: { findUnique: jest.Mock; create: jest.Mock } };

  beforeEach(() => {
    prisma = {
      platformAdmin: { findUnique: jest.fn(), create: jest.fn() },
    };
  });

  it('creates exactly one platform admin, with a bcrypt-hashed password, when none exists yet', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    prisma.platformAdmin.create.mockResolvedValue({ id: 'admin-1', email: 'ops@edupay.example' });

    const result = await bootstrapPlatformAdmin(
      prisma as never,
      'ops@edupay.example',
      'StrongPassword123!',
    );

    expect(result).toEqual({
      created: true,
      admin: { id: 'admin-1', email: 'ops@edupay.example' },
    });
    expect(prisma.platformAdmin.create).toHaveBeenCalledTimes(1);

    const createArgs = prisma.platformAdmin.create.mock.calls[0][0];
    expect(createArgs.data.email).toBe('ops@edupay.example');
    expect(createArgs.data.name).toBeTruthy();
    expect(createArgs.data.password).not.toBe('StrongPassword123!');
    expect(await bcrypt.compare('StrongPassword123!', createArgs.data.password)).toBe(true);
  });

  it('is idempotent - skips creation and reports created: false when the email already exists', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'ops@edupay.example',
    });

    const result = await bootstrapPlatformAdmin(
      prisma as never,
      'ops@edupay.example',
      'StrongPassword123!',
    );

    expect(result).toEqual({
      created: false,
      admin: { id: 'admin-1', email: 'ops@edupay.example' },
    });
    expect(prisma.platformAdmin.create).not.toHaveBeenCalled();
  });

  it('looks up by the exact email given, not some derived value', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    prisma.platformAdmin.create.mockResolvedValue({ id: 'admin-1', email: 'root@edupay.example' });

    await bootstrapPlatformAdmin(prisma as never, 'root@edupay.example', 'AnotherStrongPass1!');

    expect(prisma.platformAdmin.findUnique).toHaveBeenCalledWith({
      where: { email: 'root@edupay.example' },
    });
  });
});
