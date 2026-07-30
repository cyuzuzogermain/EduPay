import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, SchoolTransactionStatus, NotificationType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const prisma = new PrismaClient();

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR ?? './uploads/kyc');

/// Generates a small, genuinely valid PDF so the seeded KYC documents are real files a reviewer
/// can actually open through GET /kyc/:documentId/file - not a placeholder string. Written under
/// UPLOADS_DIR using the same generated-filename convention KycStorageService uses at runtime
/// (a random name, never derived from anything client-supplied).
async function seedDemoKycFile(studentName: string): Promise<{
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
}> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([400, 260]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  page.drawText('EduPay - Demo KYC Document', { x: 32, y: 220, size: 16, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(`Student: ${studentName}`, { x: 32, y: 180, size: 12, font });
  page.drawText('Document type: National ID', { x: 32, y: 158, size: 12, font });
  page.drawText('This is seed data for local development/demo purposes only.', {
    x: 32,
    y: 120,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  const bytes = await pdfDoc.save();
  const buffer = Buffer.from(bytes);

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const fileName = `${randomUUID()}.pdf`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buffer);

  return {
    fileName,
    originalFileName: 'national-id.pdf',
    mimeType: 'application/pdf',
    fileSize: buffer.length,
  };
}

const DEMO_PLATFORM_ADMIN_EMAIL = 'admin@edupay.example';
const DEMO_PLATFORM_ADMIN_PASSWORD = 'PlatformAdmin123!';

const STUDENT_PASSWORD = 'StudentPass123!';
const RECORDS_PER_INSTITUTION = 50;

// ---------------------------------------------------------------------------
// Institutions - 21 total, each in a different country with its own currency.
// The first is the long-standing demo institution (kept byte-for-byte the same
// identity as earlier releases so existing bookmarks/credentials keep working);
// the rest are new. Names are invented, not real institutions.
// ---------------------------------------------------------------------------
interface InstitutionDef {
  name: string;
  country: string;
  currency: string;
  contactEmail: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  /** Rough order-of-magnitude for a semester's tuition in this currency - invented, not FX-derived. */
  tuitionRange: [number, number];
}

const INSTITUTIONS: InstitutionDef[] = [
  {
    name: 'EduPay Demo University',
    country: 'Rwanda',
    currency: 'RWF',
    contactEmail: 'finance@demo-university.edupay.example',
    adminName: 'Demo Institution Admin',
    adminEmail: 'admin@demo-university.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [400000, 650000],
  },
  {
    name: 'Nairobi Heights University',
    country: 'Kenya',
    currency: 'KES',
    contactEmail: 'finance@nairobi-heights.edupay.example',
    adminName: 'Wanjiku Kamau',
    adminEmail: 'admin@nairobi-heights.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [60000, 120000],
  },
  {
    name: 'Lagos Metropolitan University',
    country: 'Nigeria',
    currency: 'NGN',
    contactEmail: 'finance@lagos-metropolitan.edupay.example',
    adminName: 'Chinedu Okafor',
    adminEmail: 'admin@lagos-metropolitan.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [150000, 350000],
  },
  {
    name: 'Accra Coastal University',
    country: 'Ghana',
    currency: 'GHS',
    contactEmail: 'finance@accra-coastal.edupay.example',
    adminName: 'Ama Boateng',
    adminEmail: 'admin@accra-coastal.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [3000, 7000],
  },
  {
    name: 'Cairo Nile University',
    country: 'Egypt',
    currency: 'EGP',
    contactEmail: 'finance@cairo-nile.edupay.example',
    adminName: 'Youssef El-Sayed',
    adminEmail: 'admin@cairo-nile.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [15000, 30000],
  },
  {
    name: 'Cape Town Peninsula University',
    country: 'South Africa',
    currency: 'ZAR',
    contactEmail: 'finance@cape-town-peninsula.edupay.example',
    adminName: 'Thandiwe Nkosi',
    adminEmail: 'admin@cape-town-peninsula.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [25000, 55000],
  },
  {
    name: 'Kampala Ridge University',
    country: 'Uganda',
    currency: 'UGX',
    contactEmail: 'finance@kampala-ridge.edupay.example',
    adminName: 'Nakato Ssemakula',
    adminEmail: 'admin@kampala-ridge.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [1500000, 3000000],
  },
  {
    name: 'Dar es Salaam Bay University',
    country: 'Tanzania',
    currency: 'TZS',
    contactEmail: 'finance@dar-bay.edupay.example',
    adminName: 'Amina Mwakalinga',
    adminEmail: 'admin@dar-bay.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [1200000, 2500000],
  },
  {
    // Ethiopian birr isn't on EduPay's curated send-currency shortlist - like several real
    // institutions with less liquid local currencies, this one is paid in USD instead.
    name: 'Addis Highlands University',
    country: 'Ethiopia',
    currency: 'USD',
    contactEmail: 'finance@addis-highlands.edupay.example',
    adminName: 'Selamawit Tesfaye',
    adminEmail: 'admin@addis-highlands.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [2000, 4500],
  },
  {
    name: 'Dakar Atlantic University',
    country: 'Senegal',
    currency: 'XOF',
    contactEmail: 'finance@dakar-atlantic.edupay.example',
    adminName: 'Fatou Ndiaye',
    adminEmail: 'admin@dakar-atlantic.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [400000, 800000],
  },
  {
    name: 'Abidjan Lagoon University',
    country: 'Ivory Coast',
    currency: 'XOF',
    contactEmail: 'finance@abidjan-lagoon.edupay.example',
    adminName: 'Kouadio Yao',
    adminEmail: 'admin@abidjan-lagoon.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [400000, 800000],
  },
  {
    name: 'Yaounde Central University',
    country: 'Cameroon',
    currency: 'XAF',
    contactEmail: 'finance@yaounde-central.edupay.example',
    adminName: 'Marie Ateba',
    adminEmail: 'admin@yaounde-central.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [400000, 800000],
  },
  {
    name: 'Casablanca Maritime University',
    country: 'Morocco',
    currency: 'MAD',
    contactEmail: 'finance@casablanca-maritime.edupay.example',
    adminName: 'Youssra Bennani',
    adminEmail: 'admin@casablanca-maritime.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [8000, 18000],
  },
  {
    // Zambian kwacha isn't curated - paid in USD instead.
    name: 'Lusaka Plains University',
    country: 'Zambia',
    currency: 'USD',
    contactEmail: 'finance@lusaka-plains.edupay.example',
    adminName: 'Mwansa Chileshe',
    adminEmail: 'admin@lusaka-plains.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [1500, 4000],
  },
  {
    // Botswana pula isn't curated - the pula trades close to the rand in real life, so ZAR is a
    // natural stand-in.
    name: 'Gaborone Kalahari University',
    country: 'Botswana',
    currency: 'ZAR',
    contactEmail: 'finance@gaborone-kalahari.edupay.example',
    adminName: 'Kagiso Molefe',
    adminEmail: 'admin@gaborone-kalahari.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [15000, 30000],
  },
  {
    // Mozambican metical isn't curated - regional ties make ZAR a natural stand-in.
    name: 'Maputo Bay University',
    country: 'Mozambique',
    currency: 'ZAR',
    contactEmail: 'finance@maputo-bay.edupay.example',
    adminName: 'Ines Machava',
    adminEmail: 'admin@maputo-bay.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [18000, 38000],
  },
  {
    // Malawian kwacha isn't curated - paid in USD instead.
    name: 'Lilongwe Lakeside University',
    country: 'Malawi',
    currency: 'USD',
    contactEmail: 'finance@lilongwe-lakeside.edupay.example',
    adminName: 'Chikondi Banda',
    adminEmail: 'admin@lilongwe-lakeside.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [1000, 3000],
  },
  {
    // Namibian dollar isn't curated - it's actually pegged 1:1 to the rand in real life, so ZAR
    // is an especially natural stand-in.
    name: 'Windhoek Desert University',
    country: 'Namibia',
    currency: 'ZAR',
    contactEmail: 'finance@windhoek-desert.edupay.example',
    adminName: 'Ndapewa Shikongo',
    adminEmail: 'admin@windhoek-desert.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [22000, 48000],
  },
  {
    name: 'Harare Highveld University',
    country: 'Zimbabwe',
    currency: 'USD',
    contactEmail: 'finance@harare-highveld.edupay.example',
    adminName: 'Tendai Moyo',
    adminEmail: 'admin@harare-highveld.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [2000, 6000],
  },
  {
    // Congolese franc isn't curated - USD is already the de facto second currency in DR Congo.
    name: 'Kinshasa River University',
    country: 'DR Congo',
    currency: 'USD',
    contactEmail: 'finance@kinshasa-river.edupay.example',
    adminName: 'Beatrice Kalonji',
    adminEmail: 'admin@kinshasa-river.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [1500, 4500],
  },
  {
    // Algerian dinar isn't curated - close European trade ties make EUR a natural stand-in.
    name: 'Algiers Coastal University',
    country: 'Algeria',
    currency: 'EUR',
    contactEmail: 'finance@algiers-coastal.edupay.example',
    adminName: 'Amine Belkacem',
    adminEmail: 'admin@algiers-coastal.edupay.example',
    adminPassword: 'InstitutionAdmin123!',
    tuitionRange: [1500, 3500],
  },
];

const PROGRAMS = [
  'Computer Science',
  'Business Administration',
  'Law',
  'Medicine',
  'Civil Engineering',
  'Electrical Engineering',
  'Economics',
  'Nursing',
  'Agriculture',
  'Architecture',
  'Education',
  'Public Health',
];

const FIRST_NAMES = [
  'Aline', 'Eric', 'Grace', 'Jean', 'Sandrine', 'David', 'Faith', 'Amara', 'Kwame', 'Zainab',
  'Ibrahim', 'Fatima', 'Samuel', 'Ruth', 'Daniel', 'Esther', 'Joseph', 'Mary', 'Peter', 'Sarah',
  'Emmanuel', 'Joy', 'Moses', 'Naomi', 'Isaac', 'Rebecca', 'Victor', 'Patience', 'Michael', 'Blessing',
  'Ahmed', 'Aisha', 'Omar', 'Layla', 'Karim', 'Nadia', 'Tarek', 'Salma', 'Adama', 'Awa',
];

const LAST_NAMES = [
  'Uwase', 'Niyonzima', 'Mukamana', 'Bosco', 'Ingabire', 'Otieno', 'Wanjiru', 'Okafor', 'Boateng', 'El-Sayed',
  'Nkosi', 'Ssemakula', 'Mwakalinga', 'Tesfaye', 'Ndiaye', 'Yao', 'Ateba', 'Bennani', 'Chileshe', 'Molefe',
  'Machava', 'Banda', 'Shikongo', 'Moyo', 'Kalonji', 'Belkacem', 'Kamau', 'Adeyemi', 'Mensah', 'Haile',
];

const CHARGE_TYPES: Array<{ description: string; fraction: number }> = [
  { description: 'Housing', fraction: 0.28 },
  { description: 'Medical Insurance', fraction: 0.08 },
  { description: 'Library Fee', fraction: 0.02 },
  { description: 'Lab Fee', fraction: 0.05 },
  { description: 'Exam Fee', fraction: 0.03 },
  { description: 'Application Fee', fraction: 0.015 },
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

function roundAmount(value: number): number {
  return Math.round(value / 100) * 100;
}

async function seedPlatformAdmin(): Promise<void> {
  const existing = await prisma.platformAdmin.findUnique({
    where: { email: DEMO_PLATFORM_ADMIN_EMAIL },
  });

  if (existing) {
    console.log(`Platform admin already exists: ${DEMO_PLATFORM_ADMIN_EMAIL}`);
    return;
  }

  const password = await bcrypt.hash(DEMO_PLATFORM_ADMIN_PASSWORD, 10);

  await prisma.platformAdmin.create({
    data: { name: 'EduPay Admin', email: DEMO_PLATFORM_ADMIN_EMAIL, password },
  });

  console.log('Created platform admin.');
}

async function seedInstitution(def: InstitutionDef): Promise<string> {
  const existing = await prisma.institution.findUnique({ where: { contactEmail: def.contactEmail } });

  if (existing) {
    console.log(`Institution already exists: ${def.name}`);

    // Backfill preferredCurrency for institutions created before this field existed, so every
    // seeded institution ends up denominated in the currency its own records already use.
    if (existing.preferredCurrency !== def.currency) {
      await prisma.institution.update({
        where: { id: existing.id },
        data: { preferredCurrency: def.currency },
      });
      console.log(`  backfilled preferredCurrency -> ${def.currency}`);
    }

    return existing.id;
  }

  const institution = await prisma.institution.create({
    data: {
      name: def.name,
      country: def.country,
      contactEmail: def.contactEmail,
      preferredCurrency: def.currency,
    },
  });

  console.log(`Created institution: ${def.name} (${def.country})`);
  return institution.id;
}

async function seedInstitutionAdmin(institutionId: string, def: InstitutionDef): Promise<void> {
  const existing = await prisma.institutionAdmin.findUnique({ where: { email: def.adminEmail } });

  if (existing) {
    return;
  }

  const password = await bcrypt.hash(def.adminPassword, 10);

  await prisma.institutionAdmin.create({
    data: { name: def.adminName, email: def.adminEmail, password, institutionId },
  });
}

/**
 * Generates `count` unclaimed SchoolFinancialRecord rows (each with 2-4 charges, guaranteed at
 * least one overdue) for an institution, numbered from `startingAt`. Skipped entirely if the
 * institution already has >= RECORDS_PER_INSTITUTION records, so re-running the seed never
 * duplicates this bulk data.
 */
async function seedBulkRecords(
  institutionId: string,
  schoolIdPrefix: string,
  currency: string,
  tuitionRange: [number, number],
  startingAt: number,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const schoolId = `${schoolIdPrefix}-${String(startingAt + i).padStart(4, '0')}`;
    const studentName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const program = `${pick(PROGRAMS)}, Year ${randomInt(1, 4)}`;
    const tuition = roundAmount(randomInt(tuitionRange[0], tuitionRange[1]));

    const record = await prisma.schoolFinancialRecord.create({
      data: { institutionId, schoolId, studentName, program, currency },
    });

    await prisma.schoolTransaction.create({
      data: {
        recordId: record.id,
        type: 'CHARGE',
        status: 'PENDING',
        description: 'Tuition',
        amount: tuition,
        currency,
        dueDate: daysFromNow(randomInt(10, 60)),
        occurredAt: daysFromNow(-randomInt(30, 90)),
      },
    });

    // 1-3 extra charges, shuffled; the first one is forced overdue so every record demonstrates
    // the Overdue state without relying on chance.
    const extras = [...CHARGE_TYPES].sort(() => Math.random() - 0.5).slice(0, randomInt(1, 3));

    for (let j = 0; j < extras.length; j++) {
      const extra = extras[j];
      const overdue = j === 0;
      await prisma.schoolTransaction.create({
        data: {
          recordId: record.id,
          type: 'CHARGE',
          status: 'PENDING',
          description: extra.description,
          amount: roundAmount(Math.max(1, tuition * extra.fraction)),
          currency,
          dueDate: overdue ? daysFromNow(-randomInt(3, 45)) : daysFromNow(randomInt(10, 90)),
          occurredAt: daysFromNow(-randomInt(30, 90)),
        },
      });
    }
  }
}

async function ensureBulkRecordsSeeded(def: InstitutionDef, institutionId: string, reserved: number): Promise<void> {
  const existingCount = await prisma.schoolFinancialRecord.count({ where: { institutionId } });

  if (existingCount >= RECORDS_PER_INSTITUTION) {
    console.log(`${def.name} already has ${existingCount} records - skipping bulk generation.`);
    return;
  }

  const prefix = def.name === 'EduPay Demo University' ? 'STU' : `STU-${def.currency}`;
  const toCreate = RECORDS_PER_INSTITUTION - Math.max(existingCount, reserved);
  const startingAt = existingCount === 0 ? reserved + 1 : existingCount + 1;

  await seedBulkRecords(institutionId, prefix, def.currency, def.tuitionRange, startingAt, toCreate);
  console.log(`Seeded ${toCreate} bulk records for ${def.name}.`);
}

interface CuratedCharge {
  key: string;
  description: string;
  amount: number;
  dueInDays: number;
}

interface CuratedPayment {
  chargeKeys: string[];
  status: SchoolTransactionStatus;
  description: string;
  daysAgo: number;
  reviewedDaysAgo?: number;
  reviewNote?: string;
  /** If set, a Student account is created and linked to this record, and (when the payment is
   * COMPLETED or REJECTED) a Notification is written too - exactly what PaymentsService.reviewPayment
   * would have produced for a real review. */
  claimAs?: { name: string; email: string };
  /** Cross-border disclosure fields, same shape PaymentsService.initiatePayment locks onto a
   * real payment - a couple of curated payments carry this so receipts/reports have FX data to
   * show on first run without needing to run the live flow first. */
  fx?: { sendCurrency: string; fxRate: number; phoneNumber: string };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface CuratedRecord {
  schoolId: string;
  studentName: string;
  program: string;
  charges: CuratedCharge[];
  payments: CuratedPayment[];
  claimAs?: { name: string; email: string };
}

/** Hand-crafted records with specific, demoable payment states - kept separate from the bulk
 * generator above so the interesting states (PENDING_APPROVAL, COMPLETED, REJECTED, claimed
 * accounts) are guaranteed to exist rather than left to chance. */
const CURATED_RECORDS: Record<string, CuratedRecord[]> = {
  'EduPay Demo University': [
    {
      schoolId: 'STU-1001',
      studentName: 'Aline Uwase',
      program: 'Computer Science, Year 1',
      charges: [
        { key: 'tuition', description: 'Tuition', amount: 450000, dueInDays: 14 },
        { key: 'library', description: 'Library Fee', amount: 15000, dueInDays: -5 },
      ],
      payments: [],
      claimAs: { name: 'Aline Uwase', email: 'aline.uwase@example.com' },
    },
    {
      schoolId: 'STU-1002',
      studentName: 'Eric Niyonzima',
      program: 'Business Administration, Year 2',
      charges: [
        { key: 'tuition', description: 'Tuition', amount: 500000, dueInDays: 20 },
        { key: 'housing', description: 'Housing', amount: 120000, dueInDays: -10 },
        { key: 'library', description: 'Library Fee', amount: 10000, dueInDays: 30 },
      ],
      payments: [
        {
          chargeKeys: ['housing'],
          status: 'COMPLETED',
          description: 'Payment for Housing',
          daysAgo: 20,
          reviewedDaysAgo: 19,
          reviewNote: 'Confirmed by finance office.',
          fx: { sendCurrency: 'USD', fxRate: 0.00069, phoneNumber: '+250788123456' },
        },
        {
          chargeKeys: ['tuition'],
          status: 'PENDING_APPROVAL',
          description: 'Payment for Tuition',
          daysAgo: 1,
        },
      ],
      claimAs: { name: 'Eric Niyonzima', email: 'eric.niyonzima@example.com' },
    },
    {
      schoolId: 'STU-1003',
      studentName: 'Grace Mukamana',
      program: 'Law, Year 3',
      charges: [
        { key: 'tuition', description: 'Tuition', amount: 480000, dueInDays: 10 },
        { key: 'medical', description: 'Medical Insurance', amount: 40000, dueInDays: -3 },
      ],
      payments: [
        {
          chargeKeys: ['tuition', 'medical'],
          status: 'COMPLETED',
          description: 'Payment for 2 outstanding charges',
          daysAgo: 8,
          reviewedDaysAgo: 7,
          reviewNote: 'Full settlement confirmed.',
        },
      ],
    },
    {
      schoolId: 'STU-1004',
      studentName: 'Jean Bosco',
      program: 'Engineering, Year 2',
      charges: [
        { key: 'tuition', description: 'Tuition', amount: 520000, dueInDays: 25 },
        { key: 'housing', description: 'Housing', amount: 100000, dueInDays: -7 },
      ],
      payments: [
        {
          chargeKeys: ['tuition'],
          status: 'REJECTED',
          description: 'Payment for Tuition',
          daysAgo: 5,
          reviewedDaysAgo: 4,
          reviewNote: 'Payment could not be verified with MTN MoMo - please retry.',
        },
      ],
    },
    {
      schoolId: 'STU-1005',
      studentName: 'Sandrine Ingabire',
      program: 'Medicine, Year 1',
      charges: [
        { key: 'tuition', description: 'Tuition', amount: 600000, dueInDays: 21 },
        { key: 'housing', description: 'Housing', amount: 150000, dueInDays: 45 },
        { key: 'medical', description: 'Medical Insurance', amount: 60000, dueInDays: -2 },
        { key: 'library', description: 'Library Fee', amount: 12000, dueInDays: -1 },
      ],
      payments: [
        {
          chargeKeys: ['housing'],
          status: 'COMPLETED',
          description: 'Payment for Housing',
          daysAgo: 15,
          reviewedDaysAgo: 14,
          reviewNote: 'Confirmed by finance office.',
        },
      ],
    },
  ],
  'Nairobi Heights University': [
    {
      schoolId: 'STU-KES-0001',
      studentName: 'David Otieno',
      program: 'Economics, Year 2',
      charges: [
        { key: 'tuition', description: 'Tuition', amount: 90000, dueInDays: 18 },
        { key: 'housing', description: 'Housing', amount: 25000, dueInDays: -6 },
      ],
      payments: [
        {
          chargeKeys: ['tuition'],
          status: 'PENDING_APPROVAL',
          description: 'Payment for Tuition',
          daysAgo: 2,
        },
      ],
      claimAs: { name: 'David Otieno', email: 'david.otieno@example.com' },
    },
    {
      schoolId: 'STU-KES-0002',
      studentName: 'Faith Wanjiru',
      program: 'Nursing, Year 1',
      charges: [
        { key: 'tuition', description: 'Tuition', amount: 85000, dueInDays: 12 },
        { key: 'medical', description: 'Medical Insurance', amount: 7000, dueInDays: -4 },
      ],
      payments: [
        {
          chargeKeys: ['tuition'],
          status: 'REJECTED',
          description: 'Payment for Tuition',
          daysAgo: 3,
          reviewedDaysAgo: 2,
          reviewNote: 'Amount did not match the outstanding charge - please retry.',
          fx: { sendCurrency: 'EUR', fxRate: 0.00713, phoneNumber: '+254712345678' },
        },
      ],
      claimAs: { name: 'Faith Wanjiru', email: 'faith.wanjiru@example.com' },
    },
  ],
};

async function notifyIfClaimed(
  studentId: string | null,
  payment: { status: SchoolTransactionStatus; description: string; amount: number; currency: string; id: string },
): Promise<void> {
  if (!studentId || (payment.status !== 'COMPLETED' && payment.status !== 'REJECTED')) {
    return;
  }

  const approved = payment.status === 'COMPLETED';
  const formattedAmount = `${payment.currency} ${payment.amount.toLocaleString()}`;
  const message = approved
    ? `Your payment of ${formattedAmount} for "${payment.description}" was approved.`
    : `Your payment of ${formattedAmount} for "${payment.description}" was rejected.`;

  await prisma.notification.create({
    data: {
      studentId,
      type: approved ? NotificationType.PAYMENT_APPROVED : NotificationType.PAYMENT_REJECTED,
      message,
      paymentId: payment.id,
    },
  });
}

async function seedCuratedRecords(
  institutionId: string,
  institutionName: string,
  currency: string,
): Promise<void> {
  const definitions = CURATED_RECORDS[institutionName] ?? [];

  for (const def of definitions) {
    const existing = await prisma.schoolFinancialRecord.findUnique({
      where: { institutionId_schoolId: { institutionId, schoolId: def.schoolId } },
    });

    if (existing) {
      console.log(`Curated record already exists for ${def.schoolId} at ${institutionName}`);
    } else {
      const record = await prisma.schoolFinancialRecord.create({
        data: {
          institutionId,
          schoolId: def.schoolId,
          studentName: def.studentName,
          program: def.program,
          currency,
        },
      });

      const chargeIdByKey = new Map<string, { id: string; amount: number }>();

      for (const charge of def.charges) {
        const created = await prisma.schoolTransaction.create({
          data: {
            recordId: record.id,
            type: 'CHARGE',
            status: 'PENDING',
            description: charge.description,
            amount: charge.amount,
            currency,
            dueDate: daysFromNow(charge.dueInDays),
            occurredAt: daysFromNow(-60),
          },
        });
        chargeIdByKey.set(charge.key, { id: created.id, amount: charge.amount });
      }

      for (const payment of def.payments) {
        const covered = payment.chargeKeys.map((key) => {
          const charge = chargeIdByKey.get(key);
          if (!charge) {
            throw new Error(`Seed error: unknown charge key "${key}" for ${def.schoolId}`);
          }
          return charge;
        });
        const totalAmount = covered.reduce((sum, charge) => sum + charge.amount, 0);

        // Mirrors PaymentsService.initiatePayment's own math exactly (convertedAmount = amount *
        // fxRate, fee = 1.5% of convertedAmount) so these curated rows look like real output.
        const convertedAmount = payment.fx ? round2(totalAmount * payment.fx.fxRate) : null;
        const feeAmount = convertedAmount !== null ? round2(convertedAmount * 0.015) : null;

        await prisma.schoolTransaction.create({
          data: {
            recordId: record.id,
            type: 'PAYMENT',
            status: payment.status,
            description: payment.description,
            amount: totalAmount,
            currency,
            occurredAt: daysFromNow(-payment.daysAgo),
            reviewedAt:
              payment.reviewedDaysAgo !== undefined ? daysFromNow(-payment.reviewedDaysAgo) : null,
            reviewNote: payment.reviewNote ?? null,
            sendCurrency: payment.fx?.sendCurrency ?? null,
            fxRate: payment.fx?.fxRate ?? null,
            convertedAmount,
            feeAmount,
            phoneNumber: payment.fx?.phoneNumber ?? null,
            paymentAllocations: {
              create: covered.map((charge) => ({
                amount: charge.amount,
                charge: { connect: { id: charge.id } },
              })),
            },
          },
        });
      }
    }
  }
}

async function claimRecordsAndNotify(institutionId: string): Promise<void> {
  const definitions = Object.values(CURATED_RECORDS).flat().filter((def) => def.claimAs);

  for (const def of definitions) {
    if (!def.claimAs) continue;

    const record = await prisma.schoolFinancialRecord.findUnique({
      where: { institutionId_schoolId: { institutionId, schoolId: def.schoolId } },
    });
    if (!record || record.institutionId !== institutionId) continue;

    // Prefer the intended seed account by email, but (institutionId, schoolId) can only ever
    // belong to one student - if someone already claimed this record under a different email
    // (e.g. by actually registering through the live app), notify that account instead of
    // failing on the unique constraint.
    let student = await prisma.student.findUnique({ where: { email: def.claimAs.email } });

    if (!student) {
      const claimedBy = await prisma.student.findUnique({
        where: { institutionId_schoolId: { institutionId, schoolId: record.schoolId } },
      });

      if (claimedBy) {
        student = claimedBy;
        console.log(
          `${record.schoolId} is already claimed by ${claimedBy.email} (not the seed account ${def.claimAs.email}) - notifying that account instead.`,
        );
      } else {
        const password = await bcrypt.hash(STUDENT_PASSWORD, 10);
        student = await prisma.student.create({
          data: {
            name: def.claimAs.name,
            email: def.claimAs.email,
            password,
            country: 'Rwanda',
            institutionId,
            schoolId: record.schoolId,
          },
        });
        console.log(`Claimed ${record.schoolId} with student account ${def.claimAs.email}`);
      }
    }

    // These accounts are the ones FLOW.md walks a fresh demo through initiating a payment with -
    // the KYC gate added in this pass would otherwise block that on a completely fresh seed
    // (no KYCDocument exists yet), so give each an already-APPROVED one.
    const existingKyc = await prisma.kYCDocument.findFirst({ where: { studentId: student.id } });
    if (!existingKyc) {
      const file = await seedDemoKycFile(student.name);
      await prisma.kYCDocument.create({
        data: {
          studentId: student.id,
          documentType: 'National ID',
          fileName: file.fileName,
          originalFileName: file.originalFileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          status: 'APPROVED',
          reviewedAt: new Date(),
          reviewNote: 'Seed data - pre-approved for demo purposes.',
        },
      });
    }

    const payments = await prisma.schoolTransaction.findMany({
      where: { recordId: record.id, type: 'PAYMENT' },
    });

    for (const payment of payments) {
      const alreadyNotified = await prisma.notification.findFirst({
        where: { studentId: student.id, paymentId: payment.id },
      });
      if (alreadyNotified) continue;

      await notifyIfClaimed(student.id, {
        status: payment.status,
        description: payment.description,
        amount: payment.amount.toNumber(),
        currency: payment.currency,
        id: payment.id,
      });
    }
  }
}

async function main() {
  await seedPlatformAdmin();

  const institutionIds = new Map<string, string>();

  for (const def of INSTITUTIONS) {
    const institutionId = await seedInstitution(def);
    institutionIds.set(def.name, institutionId);
    await seedInstitutionAdmin(institutionId, def);
  }

  for (const def of INSTITUTIONS) {
    const institutionId = institutionIds.get(def.name) as string;
    const curated = CURATED_RECORDS[def.name]?.length ?? 0;
    await seedCuratedRecords(institutionId, def.name, def.currency);
    await ensureBulkRecordsSeeded(def, institutionId, curated);
  }

  // Claim curated records with real Student accounts and mirror the notifications a live
  // review would have produced, now that every curated record definitely exists.
  for (const def of INSTITUTIONS) {
    if (!CURATED_RECORDS[def.name]) continue;
    const institutionId = institutionIds.get(def.name) as string;
    await claimRecordsAndNotify(institutionId);
  }

  console.log('');
  console.log('================================================================');
  console.log('Seed complete. Demo credentials:');
  console.log('================================================================');
  console.log('');
  console.log('Platform admin:');
  console.log(`  ${DEMO_PLATFORM_ADMIN_EMAIL} / ${DEMO_PLATFORM_ADMIN_PASSWORD}`);
  console.log('');
  console.log(`Institution admins (${INSTITUTIONS.length} institutions, one admin each, same password):`);
  for (const def of INSTITUTIONS) {
    console.log(`  ${def.adminEmail} / ${def.adminPassword}  -  ${def.name} (${def.country})`);
  }
  console.log('');
  console.log('Pre-claimed student accounts (ready to log in immediately, no registration needed):');
  const claimedSummaries = [
    ['aline.uwase@example.com', 'EduPay Demo University', 'STU-1001', 'no payments yet - try Initiate payment'],
    ['eric.niyonzima@example.com', 'EduPay Demo University', 'STU-1002', 'a COMPLETED payment + a PENDING_APPROVAL one awaiting review'],
    ['david.otieno@example.com', 'Nairobi Heights University', 'STU-KES-0001', 'a PENDING_APPROVAL payment awaiting review'],
    ['faith.wanjiru@example.com', 'Nairobi Heights University', 'STU-KES-0002', 'a REJECTED payment (see the note + notification)'],
  ];
  for (const [email, institution, schoolId, note] of claimedSummaries) {
    console.log(`  ${email} / ${STUDENT_PASSWORD}  -  ${institution}, school ID ${schoolId} (${note})`);
  }
  console.log('');
  console.log(
    `Every institution has ${RECORDS_PER_INSTITUTION}+ SchoolFinancialRecord rows. Beyond the ` +
      'accounts above, all other records are unclaimed - register at /register with the matching ' +
      'institution name + school ID + name-on-file to claim one (see any institution admin\'s ' +
      '/institution/records page for real schoolId/name pairs to use).',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
