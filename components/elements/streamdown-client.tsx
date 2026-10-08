"use client";

// Loaded only in the browser, by response.tsx. Importing streamdown from this
// local module (rather than with import("streamdown")) keeps webpack on its
// ESM build, which can import Shiki.
export { Streamdown } from "streamdown";
