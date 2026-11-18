import MiniSearch from "minisearch";
import knowledge from "../../data/knowledge.json";

/**
 * Knowledge base built by `npm run scrape` from shinenos.com.
 * Retrieval is local BM25 (MiniSearch) so the bot works with no database.
 * To move to a vector DB later, replace `searchWebsite` only — the chat
 * route depends on nothing else here.
 */

export type DocType = "page" | "post" | "product" | "site";

export interface Chunk {
  id: string;
  url: string;
  title: string;
  type: DocType;
  section: string;
  text: string;
}

export interface PageRef {
  url: string;
  title: string;
  type: DocType;
  description: string;
}

interface KnowledgeFile {
  source: string;
  scrapedAt: string;
  pages: PageRef[];
  chunks: Chunk[];
}

const kb = knowledge as KnowledgeFile;

export const SITE_URL = kb.source;
export const SCRAPED_AT = kb.scrapedAt;
export const PAGES = kb.pages;

const STOP = new Set(
  "a an and are as at be by can do does for from have how i in is it me my of on or our please tell the to what when where which who why will with you your".split(
    " ",
  ),
);

/** Light English stemmer so "cancellation", "cancel", "cancelled" all match. */
function stem(w: string): string {
  if (w.length <= 3) return w;
  const rules: [RegExp, string][] = [
    [/ational$/, "ate"],
    [/ations?$/, ""],
    [/ments?$/, ""],
    [/ness$/, ""],
    [/ies$/, "y"],
    [/ing$/, ""],
    [/(ss)$/, "$1"],
    [/ed$/, ""],
    [/ers?$/, ""],
    [/ly$/, ""],
    [/s$/, ""],
  ];
  for (const [re, rep] of rules) {
    if (re.test(w)) {
      const out = w.replace(re, rep);
      if (out.length >= 3) return out.replace(/(.)\1$/, "$1"); // cancell -> cancel
    }
  }
  return w;
}

function processTerm(term: string): string | null {
  const t = term.toLowerCase();
  if (STOP.has(t)) return null;
  return stem(t);
}

// Visitor vocabulary → words the website actually uses.
const SYNONYMS: Record<string, string> = {
  price: "pricing cost rate quote",
  prices: "pricing cost rate quote",
  cost: "pricing price rate quote",
  charge: "pricing price payment deposit",
  pay: "payment deposit credit card",
  cancel: "cancellation policy notice fee reschedule",
  reschedule: "cancellation notice reschedule",
  job: "join team hiring career",
  jobs: "join team hiring career",
  work: "join team hiring career",
  career: "join team hiring",
  hiring: "join team career",
  supplies: "products equipment eco-friendly bring",
  products: "eco-friendly supplies chemicals",
  safe: "background-checked insured bonded gps",
  trust: "background-checked insured bonded gps guarantee",
  insured: "insurance bonded background-checked",
  pets: "pet dog cat",
  guarantee: "satisfaction guarantee re-clean",
  unhappy: "satisfaction guarantee re-clean",
  areas: "areas serve location city",
  serve: "areas serve location city",
  contact: "phone email call",
  phone: "call contact",
  discount: "discount offer coupon 10% off first",
  coupon: "discount offer",
  tip: "tips gratuity",
  book: "booking schedule appointment",
  move: "move-in move-out moving",
  office: "commercial business",
  airbnb: "vacation rental turnover",
};

function expandQuery(q: string): string {
  const words = q.toLowerCase().split(/[^\p{L}\p{N}$%-]+/u).filter(Boolean);
  const extra = words.map((w) => SYNONYMS[w] ?? "").filter(Boolean);
  return [...words, ...extra].join(" ");
}

// Core pages (services, FAQs, terms, why-choose-us, careers) outrank blog/city copies.
const CORE = /\/(faqs|terms-conditions|why-choose-shinenos|join-the-team|deep-cleaning|recurring-cleaning|move-in-out-clean|commercial-cleaning-service|special-event-clean|home-care-cleaning|gift-card|discount|cleaning-services|house-cleaning|apartment-cleaning)\/$/;
function docBoost(url: string, type: DocType): number {
  if (type === "site") return 1.4;
  if (CORE.test(url)) return 1.5;
  if (/privacy-policy/.test(url)) return 0.6;
  if (type === "post") return 0.85;
  return 1;
}

const index = new MiniSearch<Chunk>({
  fields: ["title", "section", "text"],
  storeFields: ["url", "title", "type", "section", "text"],
  processTerm,
  searchOptions: {
    boost: { title: 1.5, section: 1.5 },
    fuzzy: 0.15,
    prefix: true,
    combineWith: "OR",
    processTerm,
    boostDocument: (_id, _term, stored) => docBoost(String(stored?.url ?? ""), stored?.type as DocType),
  },
});
index.addAll(kb.chunks);

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
}

/** Jaccard similarity — used to skip near-identical city-page variants. */
function similar(a: Set<string>, b: Set<string>): boolean {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1) > 0.6;
}

export interface SearchHit {
  url: string;
  title: string;
  section: string;
  type: DocType;
  text: string;
  score: number;
}

/**
 * Searches the website knowledge base. Results are diversified so one page
 * can't fill every slot (the site has many near-identical city pages).
 */
export function searchWebsite(query: string, limit = 6, maxPerPage = 2): SearchHit[] {
  const raw = index.search(expandQuery(query));
  const perPage = new Map<string, number>();
  const kept: { hit: SearchHit; tokens: Set<string> }[] = [];
  for (const r of raw) {
    const n = perPage.get(r.url) ?? 0;
    if (n >= maxPerPage) continue;
    const tokens = tokenSet(r.text);
    if (kept.some((k) => similar(k.tokens, tokens))) continue;
    perPage.set(r.url, n + 1);
    kept.push({
      tokens,
      hit: { url: r.url, title: r.title, section: r.section, type: r.type, text: r.text, score: r.score },
    });
    if (kept.length >= limit) break;
  }
  return kept.map((k) => k.hit);
}

export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "No matching content found on shinenos.com for this query.";
  return hits
    .map(
      (h, i) =>
        `<result index="${i + 1}" url="${h.url}" title="${h.title.replace(/"/g, "'")}">\n${h.text}\n</result>`,
    )
    .join("\n\n");
}

/** Contact details / navigation chunk, used in the system prompt. */
export function siteProfile(): string {
  return kb.chunks
    .filter((c) => c.type === "site")
    .map((c) => c.text)
    .join("\n");
}

/** Compact list of every page so the model can link to the right one. */
export function pageDirectory(): string {
  return PAGES.filter((p) => p.type !== "site")
    .map((p) => `- ${p.title} — ${p.url}`)
    .join("\n");
}
