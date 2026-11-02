/** Class value written for nodata pixels (transparent in the LUT). */
export const ARGMAX_NODATA = 255;
/** ForTy probabilities sum to 250 across all classes. */
const PROBABILITY_TOTAL = 250;

/**
 * Per-pixel argmax over class-probability bands (CPU).
 *
 * - A pixel where any band equals `nodata` yields 255.
 * - With `implicitOther`, an extra class (index `bands.length`) has
 *   probability `250 - sum(bands)` (ForTy v1: the 5 forest bands leave the rest
 *   to "other land").
 * - Ties pick the lowest class index.
 */
export function argmaxClasses(bands: ArrayLike<number>[], nodata: number, implicitOther: boolean): Uint8Array {
  const n = bands[0]?.length ?? 0;
  const out = new Uint8Array(n);
  const nb = bands.length;
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestV = -1;
    let sum = 0;
    let isNodata = false;
    for (let b = 0; b < nb; b++) {
      const v = bands[b][i];
      if (v === nodata) {
        isNodata = true;
        break;
      }
      sum += v;
      if (v > bestV) {
        bestV = v;
        best = b;
      }
    }
    if (isNodata) {
      out[i] = ARGMAX_NODATA;
      continue;
    }
    if (implicitOther && Math.max(0, PROBABILITY_TOTAL - sum) > bestV) best = nb;
    out[i] = best;
  }
  return out;
}
