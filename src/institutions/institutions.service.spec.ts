import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ActorRole } from '@prisma/client';
import { InstitutionsService } from './institutions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('InstitutionsService', () => {
  let institutionsService: InstitutionsService;
  let prisma: {
    institution: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    institutionAdmin: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    student: { findMany: jest.Mock; count: jest.Mock };
  };

  const institution = {
    id: 'institution-1',
    name: 'University of Rwanda',
    country: 'Rwanda',
    contactEmail: 'finance@ur.ac.rw',
    preferredCurrency: 'RWF',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const platformAdmin = {
    id: 'platform-1',
    email: 'ops@edupay.example',
    role: ActorRole.PLATFORM_ADMIN,
  };
  const ownInstitutionAdmin = {
    id: 'admin-1',
    email: 'admin@ur.ac.rw',
    role: ActorRole.INSTITUTION_ADMIN,
    institutionId: institution.id,
  };
  const otherInstitutionAdmin = {
    id: 'admin-2',
    email: 'admin@other.ac.rw',
    role: ActorRole.INSTITUTION_ADMIN,
    institutionId: 'other-institution',
  };

  beforeEach(() => {
    prisma = {
      institution: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      institutionAdmin: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
      student: { findMany: jest.fn(), count: jest.fn() },
    };

    institutionsService = new InstitutionsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates an institution when the contact email is unused', async () => {
      prisma.institution.findUnique.mockResolvedValue(null);
      prisma.institution.create.mockResolvedValue(institution);

      const result = await institutionsService.create({
        name: institution.name,
        country: institution.country,
        contactEmail: institution.contactEmail,
        preferredCurrency: institution.preferredCurrency as never,
      });

      expect(result.id).toBe(institution.id);
      expect(result.preferredCurrency).toBe('RWF');
    });

    it('throws a conflict when the contact email is already used', async () => {
      prisma.institution.findUnique.mockResolvedValue(institution);

      await expect(
        institutionsService.create({
          name: institution.name,
          country: institution.country,
          contactEmail: institution.contactEmail,
          preferredCurrency: institution.preferredCurrency as never,
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.institution.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll / findAllPublic', () => {
    it('returns every institution, paginated', async () => {
      prisma.institution.findMany.mockResolvedValue([institution]);
      prisma.institution.count.mockResolvedValue(1);

      const result = await institutionsService.findAll();

      expect(result.items).toHaveLength(1);
      expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
    });

    it('paginates using the given page/pageSize', async () => {
      prisma.institution.findMany.mockResolvedValue([]);
      prisma.institution.count.mockResolvedValue(35);

      const result = await institutionsService.findAll({ page: 2, pageSize: 10 });

      expect(prisma.institution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.meta).toEqual({ total: 35, page: 2, pageSize: 10, totalPages: 4 });
    });

    it('returns only id/name/country for the public listing', async () => {
      prisma.institution.findMany.mockResolvedValue([
        { id: institution.id, name: institution.name, country: institution.country },
      ]);

      const result = await institutionsService.findAllPublic();

      expect(result).toEqual([
        { id: institution.id, name: institution.name, country: institution.country },
      ]);
    });
  });

  describe('findById', () => {
    it('allows a platform admin to fetch any institution', async () => {
      prisma.institution.findUnique.mockResolvedValue(institution);

      const result = await institutionsService.findById(institution.id, platformAdmin);

      expect(result.id).toBe(institution.id);
    });

    it('allows an institution admin to fetch their own institution', async () => {
      prisma.institution.findUnique.mockResolvedValue(institution);

      const result = await institutionsService.findById(institution.id, ownInstitutionAdmin);

      expect(result.id).toBe(institution.id);
    });

    it('throws ForbiddenException when an institution admin fetches another institution', async () => {
      await expect(
        institutionsService.findById(institution.id, otherInstitutionAdmin),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.institution.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the institution does not exist', async () => {
      prisma.institution.findUnique.mockResolvedValue(null);

      await expect(institutionsService.findById(institution.id, platformAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createAdmin', () => {
    it('creates an institution admin with a hashed password', async () => {
      prisma.institution.findUnique.mockResolvedValue(institution);
      prisma.institutionAdmin.findUnique.mockResolvedValue(null);
      prisma.institutionAdmin.create.mockResolvedValue({
        id: 'admin-1',
        name: 'Jane Mugisha',
        email: 'jane@ur.ac.rw',
        institutionId: institution.id,
        createdAt: new Date(),
      });

      await institutionsService.createAdmin(institution.id, {
        name: 'Jane Mugisha',
        email: 'jane@ur.ac.rw',
        password: 'StrongPassword123!',
      });

      const createArgs = prisma.institutionAdmin.create.mock.calls[0][0];
      expect(createArgs.data.password).not.toBe('StrongPassword123!');
      expect(await bcrypt.compare('StrongPassword123!', createArgs.data.password)).toBe(true);
    });

    it('throws NotFoundException when the institution does not exist', async () => {
      prisma.institution.findUnique.mockResolvedValue(null);

      await expect(
        institutionsService.createAdmin(institution.id, {
          name: 'Jane Mugisha',
          email: 'jane@ur.ac.rw',
          password: 'StrongPassword123!',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the email is already used', async () => {
      prisma.institution.findUnique.mockResolvedValue(institution);
      prisma.institutionAdmin.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        institutionsService.createAdmin(institution.id, {
          name: 'Jane Mugisha',
          email: 'jane@ur.ac.rw',
          password: 'StrongPassword123!',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listAdmins', () => {
    it('lists admins for a platform admin', async () => {
      prisma.institution.findUnique.mockResolvedValue(institution);
      prisma.institutionAdmin.findMany.mockResolvedValue([
        {
          id: 'admin-1',
          name: 'Jane Mugisha',
          email: 'jane@ur.ac.rw',
          institutionId: institution.id,
          createdAt: new Date(),
        },
      ]);

      const result = await institutionsService.listAdmins(institution.id, platformAdmin);

      expect(result).toHaveLength(1);
    });

    it('throws ForbiddenException for an institution admin of a different institution', async () => {
      await expect(
        institutionsService.listAdmins(institution.id, otherInstitutionAdmin),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listStudents', () => {
    it('returns students with their latest KYC status, paginated', async () => {
      prisma.institution.findUnique.mockResolvedValue(institution);
      prisma.student.findMany.mockResolvedValue([
        {
          id: 'student-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          country: 'Rwanda',
          institutionId: institution.id,
          createdAt: new Date(),
          updatedAt: new Date(),
          kycDocuments: [{ status: 'PENDING' }],
        },
      ]);
      prisma.student.count.mockResolvedValue(1);

      const result = await institutionsService.listStudents(institution.id, ownInstitutionAdmin);

      expect(result.items[0].kycStatus).toBe('PENDING');
      expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
      expect(prisma.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { institutionId: institution.id } }),
      );
    });

    it('throws ForbiddenException for an institution admin of a different institution', async () => {
      await expect(
        institutionsService.listStudents(institution.id, otherInstitutionAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the institution does not exist', async () => {
      prisma.institution.findUnique.mockResolvedValue(null);

      await expect(institutionsService.listStudents(institution.id, platformAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('countAll / countStudents', () => {
    it('counts every institution', async () => {
      prisma.institution.count.mockResolvedValue(7);

      await expect(institutionsService.countAll()).resolves.toBe(7);
    });

    it('counts students scoped to an institution and enforces access', async () => {
      prisma.student.count.mockResolvedValue(3);

      const result = await institutionsService.countStudents(institution.id, ownInstitutionAdmin);

      expect(result).toBe(3);
      expect(prisma.student.count).toHaveBeenCalledWith({
        where: { institutionId: institution.id },
      });
    });

    it('throws ForbiddenException when counting students for another institution', async () => {
      await expect(
        institutionsService.countStudents(institution.id, otherInstitutionAdmin),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updatePreferredCurrency', () => {
    it("lets the institution's own admin change its preferred currency", async () => {
      prisma.institution.findUnique.mockResolvedValue(institution);
      prisma.institution.update.mockResolvedValue({ ...institution, preferredCurrency: 'USD' });

      const result = await institutionsService.updatePreferredCurrency(
        institution.id,
        ownInstitutionAdmin,
        { preferredCurrency: 'USD' as never },
      );

      expect(result.preferredCurrency).toBe('USD');
      expect(prisma.institution.update).toHaveBeenCalledWith({
        where: { id: institution.id },
        data: { preferredCurrency: 'USD' },
      });
    });

    it("lets a platform admin change any institution's preferred currency", async () => {
      prisma.institution.findUnique.mockResolvedValue(institution);
      prisma.institution.update.mockResolvedValue({ ...institution, preferredCurrency: 'EUR' });

      const result = await institutionsService.updatePreferredCurrency(
        institution.id,
        platformAdmin,
        {
          preferredCurrency: 'EUR' as never,
        },
      );

      expect(result.preferredCurrency).toBe('EUR');
    });

    it("throws ForbiddenException when an institution admin edits another institution's currency", async () => {
      await expect(
        institutionsService.updatePreferredCurrency(institution.id, otherInstitutionAdmin, {
          preferredCurrency: 'USD' as never,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.institution.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the institution does not exist', async () => {
      prisma.institution.findUnique.mockResolvedValue(null);

      await expect(
        institutionsService.updatePreferredCurrency(institution.id, platformAdmin, {
          preferredCurrency: 'USD' as never,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
