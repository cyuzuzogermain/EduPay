import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitiatePaymentDto } from './initiate-payment.dto';

async function validateDto(plain: Record<string, unknown>) {
  const dto = plainToInstance(InitiatePaymentDto, plain);
  return validate(dto);
}

describe('InitiatePaymentDto', () => {
  const valid = { sendCurrency: 'USD', phoneNumber: '+250788123456' };

  it('accepts a valid payload with a curated send currency and a plausible phone number', async () => {
    const errors = await validateDto(valid);

    expect(errors).toHaveLength(0);
  });

  it('rejects a missing phoneNumber', async () => {
    const errors = await validateDto({ sendCurrency: 'USD' });

    expect(errors.some((e) => e.property === 'phoneNumber')).toBe(true);
  });

  it.each(['not-a-phone', '123', 'abcdefghij'])(
    'rejects an implausible phoneNumber value: %s',
    async (phoneNumber) => {
      const errors = await validateDto({ ...valid, phoneNumber });

      expect(errors.some((e) => e.property === 'phoneNumber')).toBe(true);
    },
  );

  it.each(['+250788123456', '0788123456', '+1 415-555-0100', '254712345678'])(
    'accepts plausible phoneNumber formats: %s',
    async (phoneNumber) => {
      const errors = await validateDto({ ...valid, phoneNumber });

      expect(errors.some((e) => e.property === 'phoneNumber')).toBe(false);
    },
  );

  it('rejects a missing sendCurrency', async () => {
    const errors = await validateDto({ phoneNumber: '+250788123456' });

    expect(errors.some((e) => e.property === 'sendCurrency')).toBe(true);
  });

  it('rejects a sendCurrency outside the curated list', async () => {
    const errors = await validateDto({ ...valid, sendCurrency: 'JPY' });

    expect(errors.some((e) => e.property === 'sendCurrency')).toBe(true);
  });

  it('accepts every curated send currency', async () => {
    const { SEND_CURRENCIES } = await import('../currencies');

    for (const currency of SEND_CURRENCIES) {
      const errors = await validateDto({ ...valid, sendCurrency: currency });
      expect(errors.some((e) => e.property === 'sendCurrency')).toBe(false);
    }
  });
});
