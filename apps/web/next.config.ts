import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { loadEnvConfig } from "@next/env";
import path from "path";

const monorepoRoot = path.resolve(process.cwd(), "../..");
loadEnvConfig(monorepoRoot);
const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  agentRules: false,
};
export default withSentryConfig(nextConfig, { silent: true });
