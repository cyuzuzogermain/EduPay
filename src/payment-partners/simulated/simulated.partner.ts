import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InitiatePaymentRequest,
  InitiatePaymentResult,
  PaymentPartner,
  PaymentStatus,
  PaymentStatusResult,
} from '../interfaces/payment-partner.interface';

/**
 * Stands in for MTN MoMo (or any real partner) - drives the exact initiate -> pending ->
 * confirm/reject lifecycle a real adapter would, but entirely in-process: no HTTP call, no
 * webhook, no polling delay. `getPaymentStatus` always reports SUCCESSFUL because in this build
 * the "approve on your phone" step is a user clicking Done in the UI, not a real wallet
 * confirmation - PaymentsService treats that click as the signal to check status.
 */
@Injectable()
export class SimulatedPartner implements PaymentPartner {
  readonly partnerName = 'simulated';

  async initiatePayment(_request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    return {
      partnerReferenceId: `SIM-${randomUUID()}`,
      status: PaymentStatus.PENDING,
    };
  }

  async getPaymentStatus(partnerReferenceId: string): Promise<PaymentStatusResult> {
    return {
      partnerReferenceId,
      status: PaymentStatus.SUCCESSFUL,
    };
  }
}
