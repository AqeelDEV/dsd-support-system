import type { NextConfig } from "next";

/** The Next.js config both web apps share. `appDir` is the app's own directory. */
export function createNextConfig(options: { appDir: string }): NextConfig;
