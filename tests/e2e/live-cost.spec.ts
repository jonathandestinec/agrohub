import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL } from "./base-url";
import { makeOffer, startWorld, writeToCooperative } from "./alerts-world";

// A measurement, not a check: how many requests and database statements one visible tab costs
// per minute on the main screens. It only runs when asked (LIVE_COST=1) because it takes about
// ten minutes. Method: statement logging is turned on for the e2e database only (ALTER DATABASE ...
// SET log_statement), the Docker Postgres log is read back over each 60 second window, and the
// lines for statements (not BEGIN, COMMIT or ROLLBACK) are counted. Requests to /api/live are
// counted in the browser. Only the measured tab is open: the other people's pages are closed first.
// Results are written to test-results/live-cost.json.
const CONTAINER = process.env.LIVE_COST_CONTAINER ?? "agrohub-db-1";
const DATABASE = new URL(E2E_DATABASE_URL).pathname.slice(1);
const WINDOW_SECONDS = 60;

function psql(sql: string): void {
  execSync(`docker exec ${CONTAINER} psql -U agrohub -d postgres -c "${sql}"`, { stdio: "ignore" });
}

function statementLinesSince(unixSeconds: number): string[] {
  const log = execSync(`docker logs ${CONTAINER} --since ${unixSeconds} 2>&1`, { encoding: "utf8", maxBuffer: 1 << 28 });
  return log
    .split("\n")
    .filter((line) => /LOG:\s+(execute [^:]*|statement):/.test(line) && !/:\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(line));
}

function statementsSince(unixSeconds: number): number {
  return statementLinesSince(unixSeconds).length;
}

// Statements grouped by the first table they touch, most first: which tiles' queries dominate a load.
function statementsByTable(unixSeconds: number): Record<string, number> {
  const counts = new Map<string, number>();
  for (const line of statementLinesSince(unixSeconds)) {
    const table = /(?:FROM|INTO|UPDATE)\s+"public"\."(\w+)"/i.exec(line)?.[1] ?? "(other)";
    counts.set(table, (counts.get(table) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
}

type Row = { label: string; seconds: number; livePosts: number; statements: number; statementsPerMinute: number; postsPerMinute: number };
const rows: Row[] = [];

async function measure(page: Page, label: string, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("load");
  await page.waitForTimeout(4_000); // the page's own queries finish first
  let livePosts = 0;
  const onRequest = (r: { url(): string; method(): string }) => {
    if (r.url().endsWith("/api/live") && r.method() === "POST") livePosts += 1;
  };
  page.on("request", onRequest);
  const startedAt = Date.now();
  await page.waitForTimeout(WINDOW_SECONDS * 1000);
  const seconds = (Date.now() - startedAt) / 1000;
  page.off("request", onRequest);
  const statements = statementsSince(Math.floor(startedAt / 1000));
  rows.push({
    label,
    seconds: Math.round(seconds),
    livePosts,
    statements,
    statementsPerMinute: Math.round((statements / seconds) * 60),
    postsPerMinute: Math.round((livePosts / seconds) * 60 * 10) / 10,
  });
}

async function pageLoadStatements(page: Page, url: string): Promise<{ statements: number; byTable: Record<string, number> }> {
  await page.goto("about:blank");
  const startedAt = Math.floor(Date.now() / 1000);
  await page.goto(url);
  await page.waitForLoadState("load");
  await page.waitForTimeout(3_000);
  return { statements: statementsSince(startedAt), byTable: statementsByTable(startedAt) };
}

test.describe("live cost", () => {
  test.skip(!process.env.LIVE_COST, "a measurement; run with LIVE_COST=1");
  test.setTimeout(1_200_000);

  test.beforeAll(() => psql(`ALTER DATABASE ${DATABASE} SET log_statement = 'all'`));
  test.afterAll(() => psql(`ALTER DATABASE ${DATABASE} RESET log_statement`));

  test("requests and statements per minute for one visible tab", async ({ browser, request }) => {
    const world = await startWorld(browser, request);
    const { officerPage, buyerPage } = world;

    // Data first: an offer, and a thread with a message in it.
    await makeOffer(world);
    await writeToCooperative(buyerPage, "Is the maize dry?");
    await officerPage.goto("/officer/offers");
    const offerHref = await officerPage.locator('main a[href^="/officer/offers/"]').first().getAttribute("href");
    await officerPage.goto("/messages");
    const threadHref = await officerPage.locator('main a[href^="/messages/"]').first().getAttribute("href");
    if (!offerHref || !threadHref) throw new Error("no offer or thread to measure");

    // Only the measured tab stays open.
    await buyerPage.close();
    for (const context of browser.contexts()) {
      if (context !== officerPage.context()) await context.close();
    }

    const loads = {
      home: await pageLoadStatements(officerPage, "/officer"),
      offer: await pageLoadStatements(officerPage, offerHref),
      thread: await pageLoadStatements(officerPage, threadHref),
    };

    if (!process.env.LIVE_COST_ONLY_LOADS) {
    await measure(officerPage, "bell only (a public page)", "/prices");
    await measure(officerPage, "offer page (offer 15 s + bell 30 s)", offerHref);
    await measure(officerPage, "open thread, first minute (5 s, backing off)", threadHref);
    await measure(officerPage, "screening queue (30 s + bell)", "/officer/lots");
    await measure(officerPage, "officer home (bell 30 s; refreshes on a new alert)", "/officer");
    }

    mkdirSync("test-results", { recursive: true });
    const out = process.env.LIVE_COST_ONLY_LOADS ? "test-results/live-cost-loads.json" : "test-results/live-cost.json";
    writeFileSync(out, JSON.stringify({ windowSeconds: WINDOW_SECONDS, pageLoadStatements: loads, rows }, null, 2));
    console.log(JSON.stringify({ pageLoadStatements: loads, rows }, null, 2));
  });
});
