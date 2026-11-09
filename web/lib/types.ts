// Aufbau der Dateien, die `python -m cmtracker publish` erzeugt (scraper/cmtracker/publish.py).

export type Lang = "en" | "de" | "ja";
export type Region = "eu" | "all";
export type Period = "1d" | "7d" | "30d" | "1y";

export interface Status {
  game: string;
  gameName: string;
  day: string;
  updatedAt: string;
  version: string;
  products: number;
  variants: number;
  logicHash: string;
}

export interface PricePair {
  incl: number | null;
  excl: number | null;
}

export interface VariantNow {
  status: "ok" | "no_offers" | null;
  price: { eu: PricePair; all: PricePair } | null;
  cheapest: { eu: number | null; all: number | null } | null;
  items: number | null;
  offers: number | null;
  basket: { eu: number | null; all: number | null } | null;
  trend: number | null;
  change: Record<Period, { eu: number | null; all: number | null; items: number | null }>;
  url: string | null;
}

export interface ProductSummary {
  id: number;
  name: string | null;
  nameDe: string | null;
  category: string | null;
  categoryId: number | null;
  expansionId: number | null;
  added: string | null;
  active: boolean;
  image: string | null;
  languages: Partial<Record<Lang, VariantNow>>;
}

export interface Catalog {
  game: string;
  gameName: string;
  day: string;
  products: ProductSummary[];
}

export interface Offer {
  price: number;
  shipping: number | null;
  total: number;
  qty: number;
  country: string | null;
  sellerType: string | null;
  rating: string | null;
  sales: number | null;
  comment: string | null;
  eu: boolean;
  excluded: string | null;
  lockEu: boolean;
  lockAll: boolean;
  skipEu?: boolean;
  skipAll?: boolean;
}

export interface VariantFull extends VariantNow {
  series: {
    days: string[];
    eu_incl: (number | null)[];
    eu_excl: (number | null)[];
    all_incl: (number | null)[];
    all_excl: (number | null)[];
    eu_cheapest_incl: (number | null)[];
    all_cheapest_incl: (number | null)[];
    items: (number | null)[];
    offers: (number | null)[];
    eu_basket: (number | null)[];
    all_basket: (number | null)[];
    trend: (number | null)[];
    avg30: (number | null)[];
    avg7: (number | null)[];
    avg1: (number | null)[];
  };
  offersToday: Offer[];
}

export interface ProductDetail extends Omit<ProductSummary, "languages"> {
  languages: Partial<Record<Lang, VariantFull>>;
  related: number[];
}

export interface MarketIndex {
  eu: { days: string[]; all: number[] } & Record<string, number[] | string[]>;
  all: { days: string[]; all: number[] } & Record<string, number[] | string[]>;
  categories: Record<string, string>;
}

export interface Spark {
  days: string[];
  eu: Record<string, (number | null)[]>;
  all: Record<string, (number | null)[]>;
}
