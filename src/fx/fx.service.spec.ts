import { FxService } from './fx.service';
import { FxProvider } from './interfaces/fx-provider.interface';

describe('FxService', () => {
  let fxService: FxService;
  let provider: { getRate: jest.Mock };
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    provider = { getRate: jest.fn().mockResolvedValue(1450) };
    fxService = new FxService(provider as unknown as FxProvider);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 1 immediately without calling the provider when from and to are the same currency', async () => {
    const rate = await fxService.getRate('RWF', 'RWF');

    expect(rate).toBe(1);
    expect(provider.getRate).not.toHaveBeenCalled();
  });

  it('fetches the rate from the provider on a cache miss', async () => {
    const rate = await fxService.getRate('RWF', 'USD');

    expect(rate).toBe(1450);
    expect(provider.getRate).toHaveBeenCalledWith('RWF', 'USD');
    expect(provider.getRate).toHaveBeenCalledTimes(1);
  });

  it('returns the cached rate for the same pair without calling the provider again within 60s', async () => {
    await fxService.getRate('RWF', 'USD');
    now += 59_000;

    const rate = await fxService.getRate('RWF', 'USD');

    expect(rate).toBe(1450);
    expect(provider.getRate).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the cached rate is older than 60s', async () => {
    await fxService.getRate('RWF', 'USD');
    now += 60_001;
    provider.getRate.mockResolvedValue(1500);

    const rate = await fxService.getRate('RWF', 'USD');

    expect(rate).toBe(1500);
    expect(provider.getRate).toHaveBeenCalledTimes(2);
  });

  it('caches each currency pair independently', async () => {
    provider.getRate.mockImplementation((from: string, to: string) =>
      Promise.resolve(from === 'RWF' && to === 'USD' ? 1450 : 129),
    );

    await fxService.getRate('RWF', 'USD');
    await fxService.getRate('RWF', 'KES');
    const rwfToUsd = await fxService.getRate('RWF', 'USD');
    const rwfToKes = await fxService.getRate('RWF', 'KES');

    expect(rwfToUsd).toBe(1450);
    expect(rwfToKes).toBe(129);
    expect(provider.getRate).toHaveBeenCalledTimes(2);
  });

  it('falls back to the offline rate table when the live provider throws', async () => {
    provider.getRate.mockRejectedValue(new Error('network error'));

    // RWF ~ 1450/USD, KES ~ 129/USD -> RWF -> KES ~ 129/1450
    const rate = await fxService.getRate('RWF', 'KES');

    expect(rate).toBeCloseTo(129 / 1450, 6);
  });

  it('falls back to the offline rate table when the live provider times out or rejects for any reason', async () => {
    provider.getRate.mockRejectedValue(new Error('timeout'));

    const rate = await fxService.getRate('USD', 'EUR');

    expect(rate).toBeCloseTo(0.92, 6);
  });

  it('throws when the provider fails and no fallback rate exists for the pair', async () => {
    provider.getRate.mockRejectedValue(new Error('network error'));

    await expect(fxService.getRate('RWF', 'XYZ')).rejects.toThrow(
      'No fallback FX rate available for RWF -> XYZ',
    );
  });
});
