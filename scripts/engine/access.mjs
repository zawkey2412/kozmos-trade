// Whether a customer may trade with a merchant right now.

/**
 * @typedef {object} TokenBox
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} AccessCheck
 * @property {boolean} enabled
 * @property {boolean} open
 * @property {number} now
 * @property {number | undefined} bannedUntil
 * @property {number | null} attitude
 * @property {number} refuseAt
 * @property {number | null} squares
 * @property {number | null} maxSquares
 */

// Grid squares from one token to another, 1 when they touch, diagonals counting as one.
/**
 * @param {TokenBox} a
 * @param {TokenBox} b
 * @param {number} gridSize
 */
export function squaresBetween(a, b, gridSize) {
  const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width * gridSize, b.x + b.width * gridSize));
  const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height * gridSize, b.y + b.height * gridSize));
  return Math.round(Math.max(gapX, gapY) / gridSize) + 1;
}

// The first reason the customer cannot trade, as a localization key.
/** @param {AccessCheck} check */
export function accessProblem({ enabled, open, now, bannedUntil, attitude, refuseAt, squares, maxSquares }) {
  if (!enabled) return "KT.Error.NotShop";
  if (!open) return "KT.Error.Closed";
  if (bannedUntil !== undefined && now < bannedUntil) return "KT.Error.Banned";
  if (attitude !== null && attitude <= refuseAt) return "KT.Error.Refuses";
  if (maxSquares !== null && (squares === null || squares > maxSquares)) return "KT.Error.TooFar";
  return null;
}
