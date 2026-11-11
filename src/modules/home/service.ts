import { ForbiddenError } from "@/lib/errors";
import type { History, Summary } from "@/lib/summary";
import { farmerCounteredLotsSummary, farmerLotCounts, screeningSummary, catalogRequestsSummary, type FarmerLotCounts } from "@/modules/catalog/service";
import { verificationSummary, getOwnCooperative } from "@/modules/cooperatives/service";
import { pendingFarmersSummary } from "@/modules/farmers/service";
import { can, type Actor, type Role } from "@/modules/identity/policies";
import { buyerOffersToActSummary, farmerOffersSummary, officerOffersSummary } from "@/modules/marketplace/service";
import { latestThreads } from "@/modules/messaging/service";
import { nameChangeQueueSummary } from "@/modules/name-changes/service";
import {
  buyerOpenOrdersSummary,
  deliveriesToConfirmSummary,
  deliverySchedule,
  officerAttentionSummary,
  openDisputesSummary,
  ordersToPrepareSummary,
  recentEarningsSummary,
  recentReceiptsSummary,
  type DeliverySchedule,
} from "@/modules/orders/service";
import { payoutIssuesSummary, reconciliationSummary } from "@/modules/payments/service";
import { SEE_ALL, type TileId } from "./tiles";

export type { TileId } from "./tiles";

export type Tile =
  | { id: TileId; seeAll: string; status: "ok"; kind: "todo"; summary: Summary }
  | { id: TileId; seeAll: string; status: "ok"; kind: "history"; history: History }
  | { id: "farmerLots"; seeAll: string; status: "ok"; kind: "counts"; counts: FarmerLotCounts }
  | { id: TileId; seeAll: string; status: "error" };

export type OfficerHome = { verified: false } | { verified: true; tiles: Tile[]; schedule: DeliverySchedule | null };

type Body =
  | { kind: "todo"; summary: Summary }
  | { kind: "history"; history: History }
  | { kind: "counts"; counts: FarmerLotCounts };

type Job = { id: TileId; run: () => Promise<Body> };

const todo = (id: TileId, read: () => Promise<Summary>): Job => ({
  id,
  run: async () => ({ kind: "todo", summary: await read() }),
});
const history = (id: TileId, read: () => Promise<History>): Job => ({
  id,
  run: async () => ({ kind: "history", history: await read() }),
});

// Runs every tile's read at once. One that fails becomes an error tile (logged by id only) and
// never fails the page.
async function build(jobs: Job[]): Promise<Tile[]> {
  const results = await Promise.allSettled(jobs.map((job) => job.run()));
  return results.map((result, i): Tile => {
    const { id } = jobs[i];
    const seeAll = SEE_ALL[id];
    if (result.status === "rejected") {
      console.error("home tile failed", { id });
      return { id, seeAll, status: "error" };
    }
    return { id, seeAll, status: "ok", ...result.value } as Tile;
  });
}

// Everyone's home starts with the home:view check, then the role the page is for.
function assertHome(actor: Actor, role: Role): void {
  if (!can(actor, "home:view") || actor.role !== role) throw new ForbiddenError();
}

export async function farmerHome(actor: Actor, now: Date = new Date()): Promise<Tile[]> {
  assertHome(actor, "FARMER");
  return build([
    todo("farmerOffers", () => farmerOffersSummary(actor, now)),
    todo("farmerCountered", () => farmerCounteredLotsSummary(actor)),
    { id: "farmerLots", run: async () => ({ kind: "counts", counts: await farmerLotCounts(actor) }) },
    history("farmerEarnings", () => recentEarningsSummary(actor)),
    history("messages", () => latestThreads(actor)),
  ]);
}

export async function officerHome(actor: Actor, now: Date = new Date()): Promise<OfficerHome> {
  assertHome(actor, "OFFICER");
  const { cooperative } = await getOwnCooperative(actor);
  if (cooperative.status !== "VERIFIED") return { verified: false };
  const [tiles, schedule] = await Promise.all([
    build([
      todo("officerFarmers", () => pendingFarmersSummary(actor)),
      todo("officerLots", () => screeningSummary(actor)),
      todo("officerOffers", () => officerOffersSummary(actor, now)),
      todo("officerPrepare", () => ordersToPrepareSummary(actor)),
      todo("officerAttention", () => officerAttentionSummary(actor)),
      todo("officerRequests", () => catalogRequestsSummary(actor)),
      history("messages", () => latestThreads(actor)),
    ]),
    deliverySchedule(actor, now).catch(() => {
      console.error("home tile failed", { id: "schedule" });
      return null;
    }),
  ]);
  return { verified: true, tiles, schedule };
}

export async function buyerHome(actor: Actor, now: Date = new Date()): Promise<Tile[]> {
  assertHome(actor, "BUYER");
  return build([
    todo("buyerOffers", () => buyerOffersToActSummary(actor, now)),
    todo("buyerConfirm", () => deliveriesToConfirmSummary(actor)),
    todo("buyerOrders", () => buyerOpenOrdersSummary(actor, now)),
    history("buyerReceipts", () => recentReceiptsSummary(actor)),
    history("messages", () => latestThreads(actor)),
  ]);
}

export async function adminHome(actor: Actor, now: Date = new Date()): Promise<Tile[]> {
  assertHome(actor, "ADMIN");
  return build([
    todo("adminCooperatives", () => verificationSummary(actor)),
    todo("adminDisputes", () => openDisputesSummary(actor)),
    todo("adminPayouts", () => payoutIssuesSummary(actor, now)),
    todo("adminReconciliation", () => reconciliationSummary(actor)),
    todo("adminNames", () => nameChangeQueueSummary(actor)),
    todo("adminLots", () => screeningSummary(actor)),
    history("messages", () => latestThreads(actor)),
  ]);
}
