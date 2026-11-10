import { PerOriginSemaphore, type ConcurrencyLimiter, type Priority } from "@developmentseed/geotiff";

export const SOURCE_COOP_MAX_REQUESTS = 48;
const shared = new PerOriginSemaphore({ maxRequests: SOURCE_COOP_MAX_REQUESTS });

/** Visible requests always precede background frame preparation, including after promotion. */
export function createSourceLimiter(isBackground: () => boolean, limiter: ConcurrencyLimiter = shared): ConcurrencyLimiter {
  return {
    acquire: (url, signal, getPriority) => limiter.acquire(url, signal, () => {
      const priority: Priority = getPriority?.() ?? 0;
      return [isBackground() ? 1 : 0, ...(typeof priority === "number" ? [priority] : priority)];
    }),
  };
}
export const sourceCoopLimiter = createSourceLimiter(() => false);
