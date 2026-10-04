/**
 * Deployment configuration.
 *
 * This file is loaded before the app starts, so it can point the dashboard at a
 * backend or tune the built-in browser engine. Every field is optional.
 *
 * Running entirely in the browser (default, no server needed):
 *
 *   window.__ARBIBOT_CONFIG__ = { symbols: ['BTC', 'ETH', 'SOL'] }
 *
 * Talking to the FastAPI backend instead:
 *
 *   window.__ARBIBOT_CONFIG__ = {
 *     backendUrl: 'https://arbibot-api.onrender.com',
 *     lockSettings: false,
 *   }
 *
 * Some venues (notably Binance) do not send CORS headers for browser requests.
 * The browser engine reports those venues as offline; add a proxy template if
 * you want them included:
 *
 *   window.__ARBIBOT_CONFIG__ = { corsProxy: 'https://corsproxy.io/?url=' }
 */
window.__ARBIBOT_CONFIG__ = {
  // ''  (default) => use the same-origin /api when it exists, otherwise run the
  //                 whole scanner in the browser (static hosting, phones).
  // null          => always run the scanner in the browser.
  // 'https://…'   => always use that backend.
  backendUrl: '',
  dataMode: 'auto',            // auto | live | sim
  symbols: ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TON', 'DOT', 'LTC'],
  pollInterval: 5,
  notionalUsd: 10000,
  minNetSpreadPct: 0.02,
  slippageBufferPct: 0.02,
  // corsProxy: 'https://corsproxy.io/?url=',
  lockSettings: false,
}
