import { Injectable, Logger } from '@nestjs/common';
import { FxProvider } from '../interfaces/fx-provider.interface';

const REQUEST_TIMEOUT_MS = 4000;

/**
 * Free, no-API-key exchange rate feed (open.er-api.com - the open endpoint of
 * exchangerate-api.com). Chosen over the two examples named in the brief (exchangerate.host now
 * requires a paid access_key; Frankfurter is ECB-only and doesn't cover most African currencies)
 * because it's the one that's actually free, keyless, and covers the full curated currency list
 * (see `payments/currencies.ts`) today. `FxService` treats any failure here (network error,
 * timeout, unsupported currency) as non-fatal and falls back to a static rate table, so a flaky
 * or unreachable network never breaks the payment flow.
 */
@Injectable()
export class PublicApiFxProvider implements FxProvider {
  private readonly logger = new Logger(PublicApiFxProvider.name);

  async getRate(from: string, to: string): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`,
        {
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`FX provider responded with ${response.status}`);
      }

      const body = (await response.json()) as { result?: string; rates?: Record<string, number> };

      if (body.result !== 'success' || !body.rates) {
        throw new Error('FX provider returned an unsuccessful response');
      }

      const rate = body.rates[to];

      if (typeof rate !== 'number' || Number.isNaN(rate)) {
        throw new Error(`FX provider has no rate for ${from} -> ${to}`);
      }

      return rate;
    } catch (error) {
      this.logger.warn(
        `Live FX lookup failed for ${from} -> ${to}: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
