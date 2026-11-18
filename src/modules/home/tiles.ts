// Pure facts about the home tiles, kept apart from the service so tests and components can use
// them without the database.

export const TILE_IDS = [
  "farmerOffers",
  "farmerCountered",
  "farmerLots",
  "farmerEarnings",
  "officerFarmers",
  "officerLots",
  "officerOffers",
  "officerPrepare",
  "officerAttention",
  "officerRequests",
  "buyerOffers",
  "buyerConfirm",
  "buyerOrders",
  "buyerReceipts",
  "adminCooperatives",
  "adminDisputes",
  "adminPayouts",
  "adminReconciliation",
  "adminNames",
  "adminLots",
  "messages",
] as const;

export type TileId = (typeof TILE_IDS)[number];

// Where each tile's "See all" goes: the page that already holds the full list and its actions.
export const SEE_ALL: Record<TileId, string> = {
  farmerOffers: "/farmer/lots",
  farmerCountered: "/farmer/lots",
  farmerLots: "/farmer/lots",
  farmerEarnings: "/farmer/earnings",
  officerFarmers: "/officer/farmers",
  officerLots: "/officer/lots",
  officerOffers: "/officer/offers",
  officerPrepare: "/officer/orders",
  officerAttention: "/officer/orders",
  officerRequests: "/officer/farmers",
  buyerOffers: "/buyer/offers",
  buyerConfirm: "/buyer/orders",
  buyerOrders: "/buyer/orders",
  buyerReceipts: "/buyer/orders",
  adminCooperatives: "/admin/cooperatives",
  adminDisputes: "/admin/orders",
  adminPayouts: "/admin/payouts",
  adminReconciliation: "/admin/orders",
  adminNames: "/admin/names",
  adminLots: "/admin/lots",
  messages: "/messages",
};
