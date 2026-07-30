import { PublicApiFxProvider } from './public-api-fx.provider';

describe('PublicApiFxProvider', () => {
  let provider: PublicApiFxProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new PublicApiFxProvider();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the rate for the requested currency from a successful response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success', rates: { USD: 0.00069, KES: 0.089 } }),
    });

    const rate = await provider.getRate('RWF', 'USD');

    expect(rate).toBe(0.00069);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.er-api.com/v6/latest/RWF',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('throws when the response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });

    await expect(provider.getRate('RWF', 'USD')).rejects.toThrow('FX provider responded with 503');
  });

  it('throws when the response body reports an unsuccessful result', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'error' }),
    });

    await expect(provider.getRate('RWF', 'USD')).rejects.toThrow(
      'FX provider returned an unsuccessful response',
    );
  });

  it('throws when the target currency is missing from the rates map', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success', rates: { KES: 0.089 } }),
    });

    await expect(provider.getRate('RWF', 'USD')).rejects.toThrow(
      'FX provider has no rate for RWF -> USD',
    );
  });

  it('propagates a network-level failure', async () => {
    fetchMock.mockRejectedValue(new Error('network unreachable'));

    await expect(provider.getRate('RWF', 'USD')).rejects.toThrow('network unreachable');
  });

  it('aborts the request once the timeout elapses', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new Error('The operation was aborted')),
          );
        }),
    );

    const resultPromise = provider.getRate('RWF', 'USD').catch((error: Error) => error);
    jest.advanceTimersByTime(4001);
    const result = await resultPromise;

    expect(result).toBeInstanceOf(Error);
    jest.useRealTimers();
  });
});
