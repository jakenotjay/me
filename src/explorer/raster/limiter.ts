import { PerOriginSemaphore } from "@developmentseed/geotiff";

/**
 * Max concurrent range requests to data.source.coop. The origin serves HTTP/2, so the
 * HTTP/1.1 limit of 6 that deck.gl-geotiff defaults to is needlessly low.
 */
export const SOURCE_COOP_MAX_REQUESTS = 48;

/** One limiter shared by every COGLayer (and, later, point reads) so they split a single pool. */
export const sourceCoopLimiter = new PerOriginSemaphore({ maxRequests: SOURCE_COOP_MAX_REQUESTS });
