// Errors a player sees: a localization key and the values it needs.
export class TradeError extends Error {
  /**
   * @param {string} key
   * @param {Record<string, unknown>} [data]
   */
  constructor(key, data) {
    super(key);
    this.data = data;
  }
}

/** @param {unknown} error */
export function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  return game.i18n.localize(error.message, error instanceof TradeError ? error.data : undefined);
}

/** @param {unknown} error */
export function warn(error) {
  ui.notifications.warn(describeError(error));
}
