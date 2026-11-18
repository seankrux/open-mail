// `pnpm test` runs two Vitest projects:
//
//   node     unit tests in Node: the gateway shims, identity, the tool
//            catalog, frontend helpers. Fakes stand in for bindings.
//   workers  tests inside workerd (@cloudflare/vitest-pool-workers) against
//            the real Durable Objects and a local R2 bucket, with the
//            production entry (workers/app.ts) as the Worker: inbound mail
//            through receiveEmail(), the MailboxDO migrations, the entry's
//            identity check.
//
// A test file goes to the workers project when it is named
// `*.workers.test.ts` or listed in WORKERS_TESTS; everything else is a node
// test. This file replaces vite.config.ts for Vitest, so the Cloudflare and
// React Router plugins never load under test.
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import tsconfigPaths from "vite-tsconfig-paths";
import { configDefaults, defineConfig } from "vitest/config";
import manifest from "./everyapp.config.ts";

const WORKERS_TESTS = ["test/**/*.workers.test.ts", "test/receive-email.test.ts"];

// Keep the existing test compatibility date during the Vitest migration.
const TEST_COMPATIBILITY_DATE = "2026-03-10";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        // Node tests that load the entry (workers/app.ts) import the Durable
        // Object classes; workerd's base class is a stub here.
        resolve: { alias: { "cloudflare:workers": new URL("./test/stubs/cloudflare-workers.ts", import.meta.url).pathname } },
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.test.ts", "app/**/*.test.{ts,tsx}", "workers/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...WORKERS_TESTS],
        },
      },
      {
        plugins: [
          tsconfigPaths(),
          cloudflareTest({
            main: "./workers/app.ts",
            miniflare: {
              compatibilityDate: TEST_COMPATIBILITY_DATE,
              compatibilityFlags: ["nodejs_compat"],
              // The manifest's SQLite Durable Objects, as everyAppWorker()
              // binds them on the deployed Worker.
              durableObjects: Object.fromEntries(
                manifest.resources.durableObjects.map((d) => [
                  d.name,
                  { className: d.className, useSQLite: true },
                ]),
              ),
              r2Buckets: ["BUCKET"],
              // The app's plain settings (cloudflare.config.ts) at their
              // defaults, and the identity settings `everyapp deploy` writes:
              // the audience is the Worker's name. No identity key is bound;
              // tests that need one pass EVERYAPP_IDENTITY_PUBLIC_KEYS in the
              // env they call the entry with.
              bindings: {
                DOMAINS: "example.com",
                EMAIL_ADDRESSES: [],
                AI_PROVIDER: "",
                AGENT_MODEL: "",
                // The gmail feature's switch, on so the Gmail tests reach
                // its routes and alarm; tests of the off state pass "".
                EXPERIMENTAL_GMAIL: "true",
                EVERYAPP_APP_ID: manifest.id,
                EVERYAPP_AUDIENCE: `every-acme-${manifest.id}`,
                EVERYAPP_IDENTITY_ISSUER: "https://gateway.example.com",
              },
            },
          }),
        ],
        test: {
          name: "workers",
          include: WORKERS_TESTS,
          testTimeout: 30_000,
          maxWorkers: 1,
          isolate: false,
        },
      },
    ],
  },
});
