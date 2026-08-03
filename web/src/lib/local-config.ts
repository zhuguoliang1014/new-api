// Local fork configuration — keeps overrides for upstream defaults in one
// place so a future upstream rename or new feature can be swapped in by
// editing values here, without touching call sites.

export const LOCAL_CONFIG = {
  // The fork uses /my-wallet (Hupijiao + Alipay) instead of the upstream
  // /wallet route. Flip this back to '/wallet' to restore upstream behavior.
  walletRoute: '/my-wallet',
} as const
