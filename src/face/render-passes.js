export const PASS_ORDER = Object.freeze([
  'background', 'rain', 'face', 'substrate', 'debris', 'featureGlow', 'halo',
]);

export function backgroundPass(context) {
  const { ctx, dpr, width, height, reducedMotion, params } = context;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;
  ctx.fillStyle = reducedMotion
    ? '#000'
    : `rgba(0,0,0,${Math.min(0.6, 0.22 + 0.2 * (1 - Math.min(1, params.regen))).toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function rainPass(context) { context.passes?.rain?.(context); }
export function facePass(context) { context.passes?.face?.(context); }
export function substratePass(context) { context.passes?.substrate?.(context); }
export function debrisPass(context) { context.passes?.debris?.(context); }
export function featureGlowPass(context) { context.passes?.featureGlow?.(context); }
export function haloPass(context) { context.passes?.halo?.(context); }

export function renderFrame(context) {
  backgroundPass(context);
  rainPass(context);
  facePass(context);
  substratePass(context);
  debrisPass(context);
  featureGlowPass(context);
  haloPass(context);
}

export function substrateMaterialVisible(region, substrate, visualEvent) {
  return region !== 0 && substrate > 0.54 &&
    visualEvent?.active && visualEvent.type === 'aperture-breach';
}
