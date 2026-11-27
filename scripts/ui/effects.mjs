// Coin sounds and the coin burst over a merchant's token.
// Canvas objects and PIXI are typed any here because the canvas layers have no generated types.
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { getTables } from "../settings.mjs";

/** @type {any} */
let coinTexture = null;

// Plays a coin sound on this client only, at the user's own volume.
/** @param {"stage" | "trade"} kind */
export function playCoins(kind) {
  const volume = Number(game.settings.get(MODULE_ID, SETTINGS.SOUND_VOLUME)) || 0;
  const src = getTables().effects.sounds[kind];
  if (!volume || !src) return;
  foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false);
}

// Coins spray from the merchant's token, when the user turned the effect on and can see the token.
/** @param {string} merchant */
export function coinBurst(merchant) {
  if (!game.settings.get(MODULE_ID, SETTINGS.COIN_BURST) || !canvas?.ready) return;
  const Generator = /** @type {any} */ (foundry.canvas).animation?.ParticleGenerator;
  const token = /** @type {any[]} */ (/** @type {any} */ (canvas).tokens?.placeables ?? []).find((t) => t.actor?.uuid === merchant && t.visible);
  if (!Generator || !token) return;
  const burst = getTables().effects.burst;
  try {
    const generator = new Generator({
      mode: "effect",
      manual: true,
      textures: [texture(burst.radius)],
      tint: coinTint(),
      lifetime: burst.lifetime,
      fade: { in: 0.05, out: 0.4 },
      velocity: { speed: burst.speed, angle: [0, 360] },
      rotation: { speed: [-180, 180] },
      alpha: [0.8, 1],
      scale: burst.scale,
      elevation: token.document.elevation ?? 0,
    });
    generator.start();
    generator.spawnParticles(burst.count, { position: token.center });
    window.setTimeout(() => generator.stop({ hard: true }), burst.lifetime[1] + 200);
  } catch (error) {
    console.error("Kozmos Trade | Coin burst failed", error);
  }
}

// A plain round coin, drawn once and tinted at spawn.
/** @param {number} radius */
function texture(radius) {
  if (coinTexture) return coinTexture;
  const pixi = /** @type {any} */ (globalThis).PIXI;
  const graphics = new pixi.Graphics();
  graphics.lineStyle(Math.max(1, radius / 4), 0xbbbbbb, 1);
  graphics.beginFill(0xffffff);
  graphics.drawCircle(radius, radius, radius);
  graphics.endFill();
  coinTexture = /** @type {any} */ (canvas).app.renderer.generateTexture(graphics);
  graphics.destroy();
  return coinTexture;
}

// The coin color token as a number the canvas can tint with.
function coinTint() {
  const css = getComputedStyle(document.body).getPropertyValue("--kt-coin").trim();
  const context = document.createElement("canvas").getContext("2d");
  if (!css || !context) return 0xffffff;
  context.fillStyle = css;
  const hex = String(context.fillStyle);
  return hex.startsWith("#") ? Number(foundry.utils.Color.fromString(hex)) : 0xffffff;
}
