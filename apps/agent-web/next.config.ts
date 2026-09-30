import { createNextConfig } from "@dsd/config/next";
import type { NextConfig } from "next";

const config: NextConfig = createNextConfig({ appDir: import.meta.dirname });

export default config;
