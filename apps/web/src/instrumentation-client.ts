import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.2,
    tracePropagationTargets: [
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
    ],
  });
}
