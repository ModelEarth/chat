import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal starting config — OpenNext figures out App Router, ISR,
// middleware, etc. from your existing Next.js build automatically.
//
// If you later hit ISR/data-cache pages that need persistence across
// requests, add Cloudflare KV or R2 here, e.g.:
//
// import kvIncrementalCache from "@opennextjs/cloudflare/kv-cache";
// export default defineCloudflareConfig({
//   incrementalCache: kvIncrementalCache,
// });
//
// See: https://opennext.js.org/cloudflare for current options
// (image optimization, R2 caching, etc.) as the adapter evolves.

export default defineCloudflareConfig();
