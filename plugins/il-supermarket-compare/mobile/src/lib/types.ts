// The catalog written by the Go core (core/catalog.go). Same JSON the web app reads.

export type Store = {
  id: string; // chain:store_id
  chain: string; // banner shown to people: "רמי לוי", "שופרסל שלי"
  branch: string;
  address: string;
  lat: number | null;
  lon: number | null;
  approx: boolean;
  file?: string;
  fileTime?: string; // YYYYMMDDhhmm of the price file
  promoFile?: string; // the PromoFull file the promos came from
  hasSold?: boolean; // this branch's file dates each item's last sale (ProductMeta.stale is meaningful here)
  hasChg?: boolean; // ...and each price's last change (ProductMeta.chg)
};

// A normalized promotion (core/promo.go). value is agorot per unit (price), agorot for minQty units (bundle)
// or the percent off (percent). end is YYYYMMDDhhmm local time; missing = open-ended.
export type PromoKind = "price" | "bundle" | "percent";
export type Promo = { id: string; codes: string[]; minQty: number; kind: PromoKind; value: number; club: boolean; desc: string; max?: number; end?: string };
export type PromoStats = { parsed: number; modeled: number; applied: number; skipped: Record<string, number> };

export type Area = { name: string; lat: number; lon: number };
export type Category = { id: string; name: string };

/**
 * What the price files say about a product beyond name and price (core/meta.go). All optional.
 * size: [total amount, unit, chains that agree]. stale: [store index, days since the branch last sold it] (14+).
 * chg: [store index, days since the branch changed the price] (within 30).
 */
export type ProductMeta = { size?: [number, "g" | "ml" | "u", number]; maker?: string; il?: boolean; stale?: [number, number][]; chg?: [number, number][] };

// [code, name, category, weighted (1 = per kg), prices in agorot per store, matched names, image code, metadata]
export type RawProduct = [string, string, string, 0 | 1, (number | null)[], (string | null)[] | null, string | null | undefined, (ProductMeta | null)?];

export type Catalog = {
  version?: number; // 2+: products carry metadata, and "second item for X" promotions are priced as the pair
  priceDate: string;
  generatedAt: string;
  stores: Store[];
  skipped: string[];
  areas: Area[];
  categories: Category[];
  products: RawProduct[];
  imageSources?: string[];
  promos?: Promo[][]; // per store index; absent in catalogs from before promotions
  promoStats?: PromoStats[];
};

export type Product = {
  code: string;
  name: string;
  cat: string;
  weighted: boolean;
  prices: (number | null)[];
  picks: (string | null)[] | null;
  img: string | null;
  key: string; // normalized name (and manufacturer) for search
  meta?: ProductMeta | null;
};

export type Cart = Record<string, number>; // product code -> quantity (units, or kg for weighted)

export type Place = { place: string; lat: number; lon: number; radius: number; typed?: boolean };

// A branch from the store directory, as returned by NearbyStores / /api/nearby.
export type NearStore = { c: string; id: string; b: string; n: string; a: string; city: string; lat: number; lon: number; approx?: boolean; km: number };

export type SyncEvent = { phase: string; store?: string; file?: string; bytes?: number; items?: number; message?: string; ms?: number };

// A nearby branch of a chain the catalog doesn't cover, priced through the Open Israeli Supermarkets API.
export type ExtraStore = { chain: string; chainCode: string; branch: string; city: string; km: number; approx: boolean; prices: Record<string, number>; onSale?: string[]; chainSeen: string };
export type MoreResult = { stores: ExtraStore[]; sourceUrl?: string } | { error: string };
