import { Inject, Injectable, Logger } from '@nestjs/common';
import { FX_PROVIDER, FxProvider } from './interfaces/fx-provider.interface';

interface CachedRate {
  rate: number;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;

/// Approximate, offline fallback rates (USD cross rates) - only used when the live provider is
/// unreachable (network error, timeout, rate limiting), so a payment can always be quoted even
/// without internet access. Not refreshed automatically; these are rough order-of-magnitude
/// figures, not for real financial accuracy. Keys must cover every currency in
/// payments/currencies.ts.
const FALLBACK_USD_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  RWF: 1450,
  KES: 129,
  NGN: 1550,
  GHS: 14.5,
  ZAR: 18,
  UGX: 3700,
  TZS: 2600,
  XOF: 605,
  XAF: 605,
  EGP: 49,
  MAD: 9.4,
};

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private readonly cache = new Map<string, CachedRate>();

  constructor(@Inject(FX_PROVIDER) private readonly fxProvider: FxProvider) {}

  /** Returns the rate such that `1 unit of from = rate units of to`, cached per pair for 60s. */
  async getRate(from: string, to: string): Promise<number> {
    if (from === to) {
      return 1;
    }

    const key = `${from}_${to}`;
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.rate;
    }

    const rate = await this.fetchRate(from, to);
    this.cache.set(key, { rate, fetchedAt: now });
    return rate;
  }

  private async fetchRate(from: string, to: string): Promise<number> {
    try {
      return await this.fxProvider.getRate(from, to);
    } catch {
      const fallback = this.fallbackRate(from, to);
      this.logger.warn(`Falling back to an offline FX rate for ${from} -> ${to}: ${fallback}`);
      return fallback;
    }
  }

  private fallbackRate(from: string, to: string): number {
    const fromUsd = FALLBACK_USD_RATES[from];
    const toUsd = FALLBACK_USD_RATES[to];

    if (!fromUsd || !toUsd) {
      throw new Error(`No fallback FX rate available for ${from} -> ${to}`);
    }

    return toUsd / fromUsd;
  }
}
