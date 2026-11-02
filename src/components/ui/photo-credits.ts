// Openly licensed photographs of Nigerian farms (copied from the demo), with their credits.

export type PhotoKey = "harvest" | "cooperative" | "maize";

export type Photo = {
  src: string;
  alt: string;
  credit: { what: string; by: string; license: string; url: string };
};

export const PHOTOS: Record<PhotoKey, Photo> = {
  harvest: {
    src: "/photos/farmer-at-harvest.jpg",
    alt: "A farmer carrying a bundle of harvested rice across a paddy field",
    credit: {
      what: "Farmer at harvest",
      by: "Photobyamin",
      license: "CC BY-SA 4.0",
      url: "https://commons.wikimedia.org/wiki/File:Farmer_at_harvest.jpg",
    },
  },
  cooperative: {
    src: "/photos/cooperative.jpg",
    alt: "Members of a farmer cooperative seated together at a meeting",
    credit: {
      what: "Nigeria farmer cooperative",
      by: "USAID in Africa",
      license: "Public domain",
      url: "https://commons.wikimedia.org/wiki/File:Nigeria_farmer_cooperative_(14353069405).jpg",
    },
  },
  maize: {
    src: "/photos/maize.jpg",
    alt: "Farmers carrying harvested maize stalks past a maize field in Tula, Gombe",
    credit: {
      what: "Farmers in Tula",
      by: "BarryTheOctopus",
      license: "CC BY-SA 4.0",
      url: "https://commons.wikimedia.org/wiki/File:Farmers_in_Tula.jpg",
    },
  },
};
