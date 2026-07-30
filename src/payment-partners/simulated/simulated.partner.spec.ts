import { SimulatedPartner } from './simulated.partner';
import { PaymentCurrency, PaymentStatus } from '../interfaces/payment-partner.interface';

describe('SimulatedPartner', () => {
  let partner: SimulatedPartner;

  beforeEach(() => {
    partner = new SimulatedPartner();
  });

  it('identifies itself', () => {
    expect(partner.partnerName).toBe('simulated');
  });

  describe('initiatePayment', () => {
    it('returns a unique partner reference and a PENDING status', async () => {
      const result = await partner.initiatePayment({
        amount: '100000.00',
        currency: PaymentCurrency.RWF,
        payerId: 'student-1',
        externalReferenceId: 'payment-1',
      });

      expect(result.status).toBe(PaymentStatus.PENDING);
      expect(result.partnerReferenceId).toMatch(/^SIM-/);
    });

    it('generates a different reference for each call, mirroring a real partner assigning its own IDs', async () => {
      const first = await partner.initiatePayment({
        amount: '100000.00',
        currency: PaymentCurrency.RWF,
        payerId: 'student-1',
        externalReferenceId: 'payment-1',
      });
      const second = await partner.initiatePayment({
        amount: '50000.00',
        currency: PaymentCurrency.RWF,
        payerId: 'student-2',
        externalReferenceId: 'payment-2',
      });

      expect(first.partnerReferenceId).not.toBe(second.partnerReferenceId);
    });
  });

  describe('getPaymentStatus', () => {
    it('always reports SUCCESSFUL for the given reference, echoing it back', async () => {
      const result = await partner.getPaymentStatus('SIM-abc-123');

      expect(result).toEqual({
        partnerReferenceId: 'SIM-abc-123',
        status: PaymentStatus.SUCCESSFUL,
      });
    });
  });
});
