import { loadEnvironment } from "./lib/env-loader";

loadEnvironment();

export default {
  schema: "./lib/db/drizzle-schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // biome-ignore lint: Forbidden non-null assertion.
    url: process.env.POSTGRES_URL!,
  },
};
