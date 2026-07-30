export enum PaymentCurrency {
  RWF = 'RWF',
  UGX = 'UGX',
  GHS = 'GHS',
  USD = 'USD',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESSFUL = 'SUCCESSFUL',
  FAILED = 'FAILED',
}

export interface InitiatePaymentRequest {
  /** Amount in the smallest unit accepted by the partner, as a decimal string to avoid float precision loss */
  amount: string;
  currency: PaymentCurrency;
  /** Local phone number (or equivalent payer identifier) in E.164 format */
  payerId: string;
  /** EduPay-generated reference used to reconcile the transaction across systems */
  externalReferenceId: string;
  payerMessage?: string;
  payeeNote?: string;
}

export interface InitiatePaymentResult {
  /** Identifier assigned by the payment partner for this transaction */
  partnerReferenceId: string;
  status: PaymentStatus;
}

export interface PaymentStatusResult {
  partnerReferenceId: string;
  status: PaymentStatus;
  reason?: string;
}

/**
 * Shared contract every payment-partner adapter must implement.
 * Only a SimulatedPartner implementation exists today - it stands in for MTN MoMo, driving the
 * exact same initiate -> pending -> confirm/reject lifecycle a real adapter would, entirely
 * in-process. A real adapter (MTN MoMo, Flutterwave, Paystack, ...) can be swapped in later by
 * implementing this interface and rebinding the PAYMENT_PARTNER token below - PaymentsService
 * only ever depends on this interface, never on a concrete implementation.
 */
export interface PaymentPartner {
  readonly partnerName: string;

  initiatePayment(request: InitiatePaymentRequest): Promise<InitiatePaymentResult>;

  getPaymentStatus(partnerReferenceId: string): Promise<PaymentStatusResult>;
}

/** DI token PaymentsService injects against - never inject a concrete partner class directly. */
export const PAYMENT_PARTNER = Symbol('PAYMENT_PARTNER');
