import { Module } from '@nestjs/common';

/**
 * Placeholder for the MTN MoMo adapter, the only PaymentPartner
 * implementation planned for this release. Wiring (collections API,
 * disbursements, webhook handling) lands in a later sprint.
 */
@Module({})
export class MtnMomoModule {}
