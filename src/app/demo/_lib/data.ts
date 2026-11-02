// Sample data for the /demo screens. Every name, price and quantity here is invented
// for the presentation; nothing is read from or written to the database.

export const COOP_CUT_BPS = 500; // 5% cooperative cut
export const AGROHUB_FEE_BPS = 300; // 3% AgroHub fee

export type Crop = {
  id: string;
  name: string;
  unit: string;
  // Field colours for small swatches; the photo is used wherever there is room.
  field: string;
  ink: string;
  photo: string;
  alt: string;
};

export const CROPS: Crop[] = [
  { id: "maize", name: "Maize", unit: "100kg bag", field: "#E9C54B", ink: "#2A2205", photo: "/demo/maize.jpg", alt: "Farmers carrying harvested maize stalks past a maize field in Tula, Gombe" },
  { id: "rice", name: "Paddy rice", unit: "100kg bag", field: "#C9B98A", ink: "#2A2412", photo: "/demo/rice.jpg", alt: "Rice paddies seen from the air near Munjibir, Kano" },
  { id: "yam", name: "Yam", unit: "100 tubers", field: "#8C6A4A", ink: "#FFF8EE", photo: "/demo/yam.jpg", alt: "Yam tubers stacked for sale at an open market" },
  { id: "soybeans", name: "Soybeans", unit: "100kg bag", field: "#D8D27A", ink: "#25240A", photo: "/demo/soybeans.jpg", alt: "Soybeans and other beans in basins at a market stall" },
  { id: "tomatoes", name: "Tomatoes", unit: "50kg basket", field: "#D2513A", ink: "#FFF4F0", photo: "/demo/tomatoes.jpg", alt: "Tomatoes laid out for sale at the Monday Market in Kakuri, Kaduna" },
  { id: "sorghum", name: "Sorghum", unit: "100kg bag", field: "#A8553A", ink: "#FFF4EE", photo: "/demo/sorghum.jpg", alt: "Bags of guinea corn, one open, at a market" },
];

// Photographs from Wikimedia Commons, credited in the demo footer as their licences require.
export const PHOTO_CREDITS = [
  { what: "Farmer at harvest", by: "Photobyamin", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Farmer_at_harvest.jpg" },
  { what: "Nigeria farmer cooperative", by: "USAID in Africa", license: "Public domain", url: "https://commons.wikimedia.org/wiki/File:Nigeria_farmer_cooperative_(14353069405).jpg" },
  { what: "Farmers in Tula", by: "BarryTheOctopus", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Farmers_in_Tula.jpg" },
  { what: "Rice farm in Munjibir town", by: "Bappancey", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:RICE_FARM_IN_MUNJIBIR_TOWN.jpg" },
  { what: "Yam market", by: "Chizurumebuka", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Yam_market.jpg" },
  { what: "Tomatoes on sale at the Monday Market in Kakuri, Kaduna", by: "Kambai Akau", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Tomatoes_on_sale_at_the_Monday_Market_in_Kakuri,_Kaduna_01.jpg" },
  { what: "Guinea corn in bags", by: "Zeerun", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Guinea_Corn_in_bags.jpg" },
  { what: "Soybeans and other beans at a market", by: "Bembety", license: "CC BY-SA 4.0", url: "https://commons.wikimedia.org/wiki/File:Soybeans,_different_types_of_beans_market.jpg" },
  { what: "Trees with open sky", by: "supplied by the AgroHub team", license: "", url: "" },
];

export function cropById(id: string): Crop {
  const crop = CROPS.find((c) => c.id === id);
  if (!crop) throw new Error(`Unknown crop ${id}`);
  return crop;
}

export type Cooperative = {
  id: string;
  name: string;
  state: string;
  lga: string;
  members: number;
  verifiedOn: string;
};

export const COOPERATIVES: Cooperative[] = [
  { id: "ogbomoso", name: "Ogbomoso Maize Growers Cooperative", state: "Oyo", lga: "Ogbomoso North", members: 43, verifiedOn: "14 Oct 2026" },
  { id: "dawakin", name: "Dawakin Tofa Grain Farmers Union", state: "Kano", lga: "Dawakin Tofa", members: 61, verifiedOn: "2 Oct 2026" },
  { id: "zaki-biam", name: "Zaki Biam Yam Producers", state: "Benue", lga: "Ukum", members: 37, verifiedOn: "21 Oct 2026" },
  { id: "giwa", name: "Giwa Soybean Farmers Cooperative", state: "Kaduna", lga: "Giwa", members: 28, verifiedOn: "9 Oct 2026" },
];

export function cooperativeById(id: string): Cooperative {
  const coop = COOPERATIVES.find((c) => c.id === id);
  if (!coop) throw new Error(`Unknown cooperative ${id}`);
  return coop;
}

export type Lot = {
  id: string;
  cropId: string;
  cooperativeId: string;
  grade: "Grade A" | "Grade B";
  quantity: number;
  minOrder: number;
  askKobo: number;
  boardKobo: number;
  farmers: number;
  harvested: string;
  note: string;
};

export const LOTS: Lot[] = [
  { id: "lot-1042", cropId: "maize", cooperativeId: "ogbomoso", grade: "Grade A", quantity: 180, minOrder: 20, askKobo: 6_485_000, boardKobo: 6_320_000, farmers: 9, harvested: "18 Oct 2026", note: "Yellow maize, sun dried to 13% moisture, bagged in new polypropylene sacks." },
  { id: "lot-1043", cropId: "rice", cooperativeId: "dawakin", grade: "Grade A", quantity: 240, minOrder: 30, askKobo: 7_150_000, boardKobo: 7_240_000, farmers: 14, harvested: "11 Oct 2026", note: "FARO 44 paddy, cleaned of stones and chaff. Pickup from the union store in Dawakin Tofa." },
  { id: "lot-1047", cropId: "yam", cooperativeId: "zaki-biam", grade: "Grade A", quantity: 65, minOrder: 5, askKobo: 27_800_000, boardKobo: 26_500_000, farmers: 6, harvested: "24 Oct 2026", note: "Large white yam tubers, between 3kg and 5kg each, sorted by size." },
  { id: "lot-1051", cropId: "soybeans", cooperativeId: "giwa", grade: "Grade B", quantity: 120, minOrder: 10, askKobo: 8_270_000, boardKobo: 8_400_000, farmers: 7, harvested: "16 Oct 2026", note: "TGX 1951 soybeans. Some split beans; priced below the board to reflect it." },
  { id: "lot-1053", cropId: "sorghum", cooperativeId: "dawakin", grade: "Grade A", quantity: 95, minOrder: 10, askKobo: 5_740_000, boardKobo: 5_690_000, farmers: 5, harvested: "9 Oct 2026", note: "Red sorghum, threshed and winnowed. Suitable for malting." },
  { id: "lot-1058", cropId: "tomatoes", cooperativeId: "ogbomoso", grade: "Grade B", quantity: 40, minOrder: 5, askKobo: 3_860_000, boardKobo: 4_120_000, farmers: 3, harvested: "30 Oct 2026", note: "Roma tomatoes in ventilated baskets. Collect within three days of harvest." },
  { id: "lot-1061", cropId: "maize", cooperativeId: "giwa", grade: "Grade B", quantity: 75, minOrder: 10, askKobo: 6_090_000, boardKobo: 6_320_000, farmers: 4, harvested: "20 Oct 2026", note: "White maize, mixed sizes. Moisture tested at 14%." },
];

export function lotById(id: string): Lot | undefined {
  return LOTS.find((l) => l.id === id);
}

export type BoardRow = {
  cropId: string;
  markets: { name: string; thisWeekKobo: number; lastWeekKobo: number }[];
};

export const BOARD_WEEK = "Week of 26 October 2026";

export const BOARD: BoardRow[] = [
  { cropId: "maize", markets: [
    { name: "Bodija, Ibadan", thisWeekKobo: 6_320_000, lastWeekKobo: 6_175_000 },
    { name: "Dawanau, Kano", thisWeekKobo: 5_980_000, lastWeekKobo: 6_040_000 },
    { name: "Mile 12, Lagos", thisWeekKobo: 6_890_000, lastWeekKobo: 6_710_000 },
  ] },
  { cropId: "rice", markets: [
    { name: "Bodija, Ibadan", thisWeekKobo: 7_460_000, lastWeekKobo: 7_390_000 },
    { name: "Dawanau, Kano", thisWeekKobo: 7_240_000, lastWeekKobo: 7_315_000 },
    { name: "Mile 12, Lagos", thisWeekKobo: 7_820_000, lastWeekKobo: 7_660_000 },
  ] },
  { cropId: "yam", markets: [
    { name: "Bodija, Ibadan", thisWeekKobo: 27_900_000, lastWeekKobo: 28_450_000 },
    { name: "Wurukum, Makurdi", thisWeekKobo: 26_500_000, lastWeekKobo: 26_100_000 },
    { name: "Mile 12, Lagos", thisWeekKobo: 30_250_000, lastWeekKobo: 29_800_000 },
  ] },
  { cropId: "soybeans", markets: [
    { name: "Dawanau, Kano", thisWeekKobo: 8_400_000, lastWeekKobo: 8_260_000 },
    { name: "Central Market, Kaduna", thisWeekKobo: 8_350_000, lastWeekKobo: 8_390_000 },
    { name: "Mile 12, Lagos", thisWeekKobo: 8_970_000, lastWeekKobo: 8_880_000 },
  ] },
  { cropId: "tomatoes", markets: [
    { name: "Bodija, Ibadan", thisWeekKobo: 4_120_000, lastWeekKobo: 4_560_000 },
    { name: "Mile 12, Lagos", thisWeekKobo: 4_480_000, lastWeekKobo: 4_910_000 },
    { name: "Dawanau, Kano", thisWeekKobo: 3_750_000, lastWeekKobo: 3_990_000 },
  ] },
  { cropId: "sorghum", markets: [
    { name: "Dawanau, Kano", thisWeekKobo: 5_690_000, lastWeekKobo: 5_610_000 },
    { name: "Central Market, Kaduna", thisWeekKobo: 5_740_000, lastWeekKobo: 5_720_000 },
    { name: "Bodija, Ibadan", thisWeekKobo: 6_050_000, lastWeekKobo: 5_970_000 },
  ] },
];

// Officer and admin queues.
export const SCREENING_QUEUE = [
  { id: "lot-1066", farmer: "Adebayo Ogunleye", cropId: "maize", grade: "Grade A", quantity: 30, askKobo: 6_550_000, boardKobo: 6_320_000, submitted: "1 Nov 2026, 16:42", note: "Dried on tarpaulin, not on the road. Moisture 12.5%." },
  { id: "lot-1067", farmer: "Folake Adeyemi", cropId: "tomatoes", grade: "Grade A", quantity: 12, askKobo: 4_900_000, boardKobo: 4_120_000, submitted: "2 Nov 2026, 07:15", note: "First pick from the greenhouse plot, very uniform." },
  { id: "lot-1068", farmer: "Musa Abdullahi", cropId: "maize", grade: "Grade B", quantity: 22, askKobo: 6_010_000, boardKobo: 6_320_000, submitted: "2 Nov 2026, 09:03", note: "" },
] as const;

export const OFFERS = [
  { id: "of-311", buyer: "Kanem Feeds Ltd", lotId: "lot-1042", quantity: 60, offerKobo: 6_300_000, expires: "3 Nov 2026, 14:00", aboveFloor: true },
  { id: "of-314", buyer: "Ibadan Poultry Hub", lotId: "lot-1042", quantity: 25, offerKobo: 5_950_000, expires: "4 Nov 2026, 09:30", aboveFloor: false },
] as const;

export const DELIVERIES = [
  { id: "ord-2209", buyer: "Kanem Feeds Ltd", lotId: "lot-1042", quantity: 40, totalKobo: 259_400_000, due: "4 Nov 2026", status: "Paid, payment held" },
  { id: "ord-2196", buyer: "Oyo Agro Processors", lotId: "lot-1058", quantity: 10, totalKobo: 38_600_000, due: "2 Nov 2026", status: "Delivered, awaiting buyer" },
] as const;

export const VERIFICATION_QUEUE = [
  { id: "coop-77", name: "Ikole Cassava Growers Association", state: "Ekiti", officer: "Bunmi Fashola", submitted: "29 Oct 2026", waitingDays: 4, documents: ["Registration certificate", "By-laws", "Officer list"] },
  { id: "coop-79", name: "Shendam Rice Farmers Cooperative", state: "Plateau", officer: "Daniel Gyang", submitted: "31 Oct 2026", waitingDays: 2, documents: ["Registration certificate", "By-laws", "Officer list"] },
  { id: "coop-80", name: "Ayetoro Cocoa Farmers Union", state: "Ogun", officer: "Kemi Odukoya", submitted: "1 Nov 2026", waitingDays: 1, documents: ["Registration certificate", "Officer list"] },
] as const;

// The signed-in farmer for the farmer screen.
export const DEMO_FARMER = {
  name: "Adebayo Ogunleye",
  cooperativeId: "ogbomoso",
  farmSize: "4.5 hectares",
  crops: ["maize", "tomatoes"],
  lots: [
    { id: "lot-1042", status: "Live", contributed: 30 },
    { id: "lot-1066", status: "Waiting for officer", contributed: 30 },
    { id: "lot-0987", status: "Sold and paid", contributed: 25 },
  ],
  paidOutKobo: 148_215_000,
  // His 30 of 180 bags in ord-2209, after the 5% cut and 3% fee.
  heldKobo: 39_774_666,
};
