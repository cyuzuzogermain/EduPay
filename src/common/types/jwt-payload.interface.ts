import { ActorRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: ActorRole;
  institutionId?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: ActorRole;
  institutionId?: string;
}

/// Proof that a prospective student's identity was matched against a SchoolFinancialRecord
/// during registration step 1 - signed so step 2 can trust institutionId/schoolId without
/// the client being able to tamper with which record it's about to link the new account to.
export interface RegistrationVerificationPayload {
  purpose: 'student-registration';
  name: string;
  email: string;
  institutionId: string;
  schoolId: string;
}
