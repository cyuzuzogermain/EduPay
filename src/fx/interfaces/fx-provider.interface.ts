/**
 * Shared contract for anything that can look up a live FX rate. Only `PublicApiFxProvider`
 * exists today (a free, no-key public API) - a different source (a paid provider, a bank feed,
 * ...) can be swapped in later by implementing this interface and rebinding the FX_PROVIDER
 * token below, same pattern as PAYMENT_PARTNER. `FxService` is the only thing that depends on
 * this interface directly; it also owns caching and the offline fallback, neither of which are
 * this interface's concern.
 */
export interface FxProvider {
  /** Returns the rate such that `1 unit of from = rate units of to`. */
  getRate(from: string, to: string): Promise<number>;
}

export const FX_PROVIDER = Symbol('FX_PROVIDER');
