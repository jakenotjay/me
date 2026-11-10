import { RangeReader } from "@developmentseed/range-reader";

// A nine-year zoom-7 view uses about 39 MiB of metadata (274 COGs/year).
// Keep that loop resident without the default 32 MiB metadata eviction/refetch.
export const fortyReader = new RangeReader({
  minMetadataReadBytes: 16 * 1024,
  cache: { metadataBytes: 64 * 1024 * 1024, dataBytes: 64 * 1024 * 1024 },
});
