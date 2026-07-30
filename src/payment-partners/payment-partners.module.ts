import { Module } from '@nestjs/common';
import { PAYMENT_PARTNER } from './interfaces/payment-partner.interface';
import { SimulatedPartner } from './simulated/simulated.partner';

/**
 * Binds the PAYMENT_PARTNER token to SimulatedPartner. Swapping in a real adapter later (MTN
 * MoMo, Flutterwave, ...) means implementing PaymentPartner and changing the `useClass` below -
 * nothing outside this module needs to change.
 */
@Module({
  providers: [{ provide: PAYMENT_PARTNER, useClass: SimulatedPartner }],
  exports: [PAYMENT_PARTNER],
})
export class PaymentPartnersModule {}
