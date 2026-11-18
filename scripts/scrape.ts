/**
 * Crawls https://shinenos.com via its public WordPress + WooCommerce APIs and
 * writes a chunked knowledge base to data/knowledge.json.
 *
 * Run:  npm run scrape
 */
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SITE = "https://shinenos.com";
const UA = "Mozilla/5.0 (compatible; ShinenosChatbotIndexer/1.0)";

// Pages that carry no useful information for visitors.
const SKIP_SLUGS = new Set([
  "cart",
  "checkout",
  "my-account",
  "thank-you",
  "ppc-thankyou",
]);
const SKIP_PRODUCT_SLUGS = new Set(["no"]); // test product

const MAX_CHUNK = 1400;
const MIN_CHUNK = 250;

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

interface WpItem {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt?: { rendered: string };
  modified: string;
  yoast_head_json?: { description?: string; title?: string };
}

async function getJson<T>(url: string): Promise<{ data: T; totalPages: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) {
      return {
        data: (await res.json()) as T,
        totalPages: Number(res.headers.get("x-wp-totalpages") ?? "1"),
      };
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`Failed to fetch ${url}`);
}

async function getAll(type: string): Promise<WpItem[]> {
  const out: WpItem[] = [];
  let page = 1;
  let total = 1;
  do {
    const { data, totalPages } = await getJson<WpItem[]>(
      `${SITE}/wp-json/wp/v2/${type}?per_page=100&page=${page}&status=publish`,
    );
    out.push(...data);
    total = totalPages;
    page++;
  } while (page <= total);
  return out;
}

/** Text of an element with whitespace between child nodes (cheerio's .text() glues them). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spacedText($: cheerio.CheerioAPI, el: any): string {
  const parts: string[] = [];
  $(el)
    .find("*")
    .addBack()
    .contents()
    .each((_, n) => {
      if (n.type === "text") parts.push((n as unknown as { data: string }).data);
    });
  return parts.join(" ").replace(/\s+/g, " ").replace(/\s+([,.!?:;])/g, "$1").trim();
}

function decode(s: string): string {
  return cheerio.load(`<div>${s}</div>`)("div").text().trim();
}

/** Converts rendered Elementor/WordPress HTML into heading-aware plain text. */
function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $(
    "script, style, noscript, svg, iframe, form, button, input, select, textarea, .screen-reader-text",
  ).remove();

  const lines: string[] = [];
  const blockTags = "h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,blockquote,figcaption";

  $(blockTags).each((_, el) => {
    // Skip if an ancestor block is already captured (avoid double text).
    if ($(el).parents(blockTags).length > 0) return;
    const text = spacedText($, el);
    if (!text) return;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) lines.push(`## ${text}`);
    else if (tag === "li") lines.push(`- ${text}`);
    else lines.push(text);
  });

  // Elementor puts lots of text in plain divs (icon boxes, counters, etc.)
  // that never hit the block tags above. Capture leaf-ish widget text too.
  $(".elementor-widget-container").each((_, el) => {
    if ($(el).find(blockTags).length > 0) return;
    const text = spacedText($, el);
    if (text && text.length > 2) lines.push(text);
  });

  // Drop consecutive duplicates and duplicates of the same line on the page
  // (Elementor often renders desktop + mobile copies).
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result.join("\n");
}

/** Splits text into chunks along `## ` headings, merging tiny sections. */
function chunkText(text: string): { section: string; text: string }[] {
  const sections: { section: string; lines: string[] }[] = [];
  let current = { section: "", lines: [] as string[] };
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      if (current.lines.length) sections.push(current);
      current = { section: line.slice(3), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length) sections.push(current);

  const chunks: { section: string; text: string }[] = [];
  let buf = { section: "", text: "" };
  const flush = () => {
    if (buf.text.trim()) chunks.push({ ...buf, text: buf.text.trim() });
    buf = { section: "", text: "" };
  };

  for (const s of sections) {
    const body = s.lines.join("\n");
    if (body.length > MAX_CHUNK) {
      flush();
      // Hard-split long sections on line boundaries.
      let part = "";
      for (const line of s.lines) {
        if ((part + "\n" + line).length > MAX_CHUNK && part) {
          chunks.push({ section: s.section, text: part.trim() });
          part = s.section ? `## ${s.section} (cont.)\n` : "";
        }
        part += line + "\n";
      }
      if (part.trim()) buf = { section: s.section, text: part };
      continue;
    }
    if ((buf.text + "\n" + body).length > MAX_CHUNK) flush();
    if (!buf.section) buf.section = s.section;
    buf.text += "\n" + body;
    if (buf.text.length >= MIN_CHUNK && buf.text.length > MAX_CHUNK * 0.7) flush();
  }
  flush();
  return chunks;
}

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}

async function scrapeSiteChrome(): Promise<string> {
  const res = await fetch(SITE, { headers: { "User-Agent": UA } });
  const $ = cheerio.load(await res.text());
  const header = $('[data-elementor-type="header"]').first();
  const footer = $('[data-elementor-type="footer"], footer').first();
  const grab = (el: ReturnType<typeof $>) => {
    el.find("script, style, svg, noscript").remove();
    return spacedText($, el);
  };
  const socials = new Set<string>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    if (/instagram|facebook|youtube|tiktok|linkedin|twitter|x\.com|yelp|google\.com\/maps/i.test(href))
      socials.add(href);
  });
  return [
    "## Site header / main navigation",
    grab(header),
    "## Site footer (contact details, services, areas served)",
    grab(footer),
    socials.size ? "## Social media & external profiles\n" + [...socials].map((s) => `- ${s}`).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

interface StoreProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  description: string;
  short_description: string;
  prices: { price: string; currency_code: string; currency_minor_unit: number };
  is_in_stock: boolean;
}

async function main() {
  console.log("Fetching pages, posts and products from", SITE);
  const [pages, posts, productsRes, chrome] = await Promise.all([
    getAll("pages"),
    getAll("posts"),
    getJson<StoreProduct[]>(`${SITE}/wp-json/wc/store/v1/products?per_page=100`),
    scrapeSiteChrome(),
  ]);

  const chunks: Chunk[] = [];
  const pageIndex: PageRef[] = [];
  const seenChunkText = new Set<string>();

  const addDoc = (url: string, title: string, type: DocType, description: string, body: string) => {
    const text = body.trim();
    if (!text) return;
    pageIndex.push({ url, title, type, description });
    for (const c of chunkText(text)) {
      // Location pages repeat a lot of boilerplate — drop exact duplicates.
      const key = c.text.toLowerCase().replace(/\s+/g, " ");
      if (seenChunkText.has(key)) continue;
      seenChunkText.add(key);
      chunks.push({ id: hash(url + c.text), url, title, type, section: c.section, text: c.text });
    }
  };

  addDoc(`${SITE}/`, "SHINENOS — contact info & site navigation", "site", "Phone, email, services, areas served, social links", chrome);

  for (const p of pages) {
    if (SKIP_SLUGS.has(p.slug)) continue;
    const title = decode(p.title.rendered) || p.slug;
    const desc = p.yoast_head_json?.description ?? "";
    const body = (desc ? `## Summary\n${desc}\n` : "") + htmlToText(p.content.rendered);
    addDoc(p.link, title, "page", desc, body);
  }

  for (const p of posts) {
    const title = decode(p.title.rendered);
    const desc = p.yoast_head_json?.description ?? decode(p.excerpt?.rendered ?? "");
    const body = `## ${title}\nPublished/updated: ${p.modified.slice(0, 10)}\n` + htmlToText(p.content.rendered);
    addDoc(p.link, `Blog: ${title}`, "post", desc, body);
  }

  const products = productsRes.data.filter((p) => !SKIP_PRODUCT_SLUGS.has(p.slug));
  for (const p of products) {
    const price = (Number(p.prices.price) / 10 ** p.prices.currency_minor_unit).toFixed(2);
    const body = [
      `## ${p.name}`,
      `Price: ${p.prices.currency_code} ${price}`,
      `Availability: ${p.is_in_stock ? "In stock" : "Out of stock"}`,
      htmlToText(p.short_description),
      htmlToText(p.description),
    ].join("\n");
    addDoc(p.permalink, `Shop: ${p.name}`, "product", `Price ${p.prices.currency_code} ${price}`, body);
  }

  const out = {
    source: SITE,
    scrapedAt: new Date().toISOString(),
    pages: pageIndex,
    chunks,
  };
  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "knowledge.json"), JSON.stringify(out));
  const chars = chunks.reduce((n, c) => n + c.text.length, 0);
  console.log(
    `Saved ${pageIndex.length} documents → ${chunks.length} chunks (${(chars / 1000).toFixed(0)}k chars) to data/knowledge.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
