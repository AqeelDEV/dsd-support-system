import type { NextConfig } from "next";

/** The headers every page gets; HSTS is added for production builds. */
export function pageHeaders(
  nodeEnv?: string,
): readonly { key: string; value: string }[];

/** The Next.js config both web apps share. `appDir` is the app's own directory. */
export function createNextConfig(options: { appDir: string }): NextConfig;
