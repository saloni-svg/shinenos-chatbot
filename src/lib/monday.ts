import { createHmac, timingSafeEqual } from "node:crypto";
import { leadLabel, type Lead } from "./leads";

/**
 * Sends chatbot leads to the monday.com "Chatbot Leads" board.
 *
 * Two modes (server-side only — nothing here reaches the browser):
 *  1. API mode (MONDAY_API_TOKEN + MONDAY_BOARD_ID set): the first save in a
 *     chat CREATES a row; later saves in the same chat UPDATE that row.
 *  2. Webhook mode (only MONDAY_LEAD_WEBHOOK_URL set): one row is created per
 *     chat via the webhook. Webhooks can't update rows, so later details are
 *     not sent.
 *
 * The row is identified by a signed "lead token" the browser keeps for the
 * chat, so a visitor can't point updates at someone else's row.
 *
 * Never throws: every failure is logged and the chat carries on.
 */

const API_URL = "https://api.monday.com/v2";
const TIMEOUT_MS = 5000;
const WEBHOOK_SENT = "webhook";
const SOURCE_LABEL = "Website chatbot";

function apiConfig() {
  const token = process.env.MONDAY_API_TOKEN;
  const board = process.env.MONDAY_BOARD_ID;
  return token && board ? { token, board } : null;
}

// ---------- signed lead token ----------
function sign(itemId: string, key: string): string {
  return createHmac("sha256", key).update(`lead:${itemId}`).digest("base64url").slice(0, 32);
}

function makeToken(itemId: string, key: string): string {
  return `${itemId}.${sign(itemId, key)}`;
}

/** Returns the monday item id inside a valid token, or null. */
function readToken(token: string | undefined, key: string): string | null {
  if (!token) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^\d+$/.test(id)) return null;
  const expected = Buffer.from(sign(id, key));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

// ---------- payload ----------
function detailsText(lead: Lead): string {
  return [
    lead.preferred_date ? `Preferred date: ${lead.preferred_date}` : "",
    lead.notes ? `Notes: ${lead.notes}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

async function callApi<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: unknown; error_message?: string };
  if (!res.ok || json.errors || json.error_message || !json.data) {
    throw new Error(`monday API ${res.status}: ${JSON.stringify(json.errors ?? json.error_message ?? json)}`);
  }
  return json.data;
}

interface Column {
  id: string;
  title: string;
  type: string;
}

let columnsCache: { board: string; columns: Column[] } | null = null;

async function getColumns(token: string, board: string): Promise<Column[]> {
  if (columnsCache?.board === board) return columnsCache.columns;
  const data = await callApi<{ boards: { columns: Column[] }[] }>(
    token,
    "query ($board: [ID!]) { boards(ids: $board) { columns { id title type } } }",
    { board: [board] },
  );
  const columns = data.boards?.[0]?.columns ?? [];
  columnsCache = { board, columns };
  return columns;
}

/** Finds board columns by title so no column IDs need configuring. */
function mapColumns(columns: Column[]) {
  const find = (re: RegExp) => columns.find((c) => re.test(c.title.toLowerCase()) && c.type !== "name");
  return {
    email: find(/e-?mail/),
    phone: find(/phone|mobile|contact number/),
    service: find(/service/),
    city: find(/city|location|area/),
    address: find(/address/),
    details: find(/detail|note|message|comment|description|info/),
    source: find(/source/),
  };
}

/** Formats a value for a monday column of the given type; null = unsupported. */
function columnValue(type: string, value: string): unknown {
  switch (type) {
    case "text":
      return value;
    case "long_text":
      return { text: value };
    case "email":
      return { email: value, text: value };
    case "phone": {
      const digits = value.replace(/[^\d+]/g, "");
      return { phone: digits, countryShortName: "US" };
    }
    case "status":
      return { label: value };
    case "dropdown":
      return { labels: [value] };
    default:
      return null;
  }
}

function buildColumnValues(
  lead: Lead,
  columns: Column[],
  safeOnly: boolean,
  withSource = true,
): Record<string, unknown> {
  const map = mapColumns(columns);
  const values: Record<string, unknown> = {};
  const leftovers: string[] = [];

  const fields: [keyof ReturnType<typeof mapColumns>, string | undefined, string][] = [
    ["email", lead.email, "Email"],
    ["phone", lead.phone, "Phone"],
    ["service", lead.service, "Service"],
    ["city", lead.city, "City"],
    ["address", lead.address, "Address"],
  ];
  for (const [key, value, label] of fields) {
    if (!value) continue;
    // No "Address" column on the board? Use the City column (if no city was given), else Details.
    const col = key === "address" && !map.address && !lead.city ? map.city : map[key];
    // In "safe" mode only plain-text columns are written; the rest goes into details.
    const v = col && (!safeOnly || col.type === "text") ? columnValue(col.type, value) : null;
    if (col && v !== null) values[col.id] = v;
    else leftovers.push(`${label}: ${value}`);
  }

  const details = [detailsText(lead), ...leftovers].filter(Boolean).join(" | ");
  if (details && map.details) {
    const v = columnValue(map.details.type, details);
    if (v !== null) values[map.details.id] = v;
  }

  // Mark where the lead came from, like the old webhook automation did.
  if (withSource && map.source) {
    const v = columnValue(map.source.type, SOURCE_LABEL);
    if (v !== null) values[map.source.id] = v;
  }
  return values;
}

async function upsertViaApi(
  cfg: { token: string; board: string },
  lead: Lead,
  itemId: string | null,
): Promise<string | null> {
  const columns = await getColumns(cfg.token, cfg.board);

  const attempt = async (safeOnly: boolean, withSource = true): Promise<string> => {
    const values = buildColumnValues(lead, columns, safeOnly, withSource);
    if (itemId) {
      const data = await callApi<{ change_multiple_column_values: { id: string } }>(
        cfg.token,
        "mutation ($board: ID!, $item: ID!, $vals: JSON!) { change_multiple_column_values(board_id: $board, item_id: $item, column_values: $vals, create_labels_if_missing: true) { id } }",
        // Only rename the row when a real name is known (never overwrite it with an email/phone).
        { board: cfg.board, item: itemId, vals: JSON.stringify(lead.name ? { ...values, name: lead.name } : values) },
      );
      return data.change_multiple_column_values.id;
    }
    const data = await callApi<{ create_item: { id: string } }>(
      cfg.token,
      "mutation ($board: ID!, $name: String!, $vals: JSON) { create_item(board_id: $board, item_name: $name, column_values: $vals, create_labels_if_missing: true) { id } }",
      { board: cfg.board, name: leadLabel(lead), vals: JSON.stringify(values) },
    );
    return data.create_item.id;
  };

  try {
    return await attempt(false);
  } catch (e) {
    // A strict column (phone/email/status) can reject a value and fail the
    // whole request — retry with everything else folded into "details".
    console.error("[monday] full update failed, retrying with text-only columns", e);
    try {
      return await attempt(true);
    } catch (e2) {
      // Last resort: also drop the Source column so the lead itself is never lost.
      console.error("[monday] text-only update failed, retrying without Source", e2);
      return await attempt(true, false);
    }
  }
}

async function createViaWebhook(url: string, lead: Lead): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: lead.name ?? "",
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      service: lead.service ?? "",
      address: lead.address ?? lead.city ?? "",
      details: detailsText(lead),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`webhook returned ${res.status}`);
}

/**
 * Creates or updates this chat's lead row on monday.com.
 * @param leadToken token from an earlier save in the same chat, if any
 * @returns the token to keep for this chat (unchanged / new / null if nothing was saved)
 */
export async function upsertMondayLead(
  lead: Lead,
  leadToken?: string,
): Promise<{ token: string | null; created: boolean; failed?: boolean }> {
  try {
    const cfg = apiConfig();
    if (cfg) {
      const existing = readToken(leadToken, cfg.token);
      const id = await upsertViaApi(cfg, lead, existing);
      return { token: id ? makeToken(id, cfg.token) : null, created: !existing };
    }

    const webhook = process.env.MONDAY_LEAD_WEBHOOK_URL;
    if (webhook) {
      if (leadToken === WEBHOOK_SENT) return { token: WEBHOOK_SENT, created: false };
      await createViaWebhook(webhook, lead);
      return { token: WEBHOOK_SENT, created: true };
    }
  } catch (e) {
    console.error("[monday] lead sync failed", e);
    return { token: leadToken ?? null, created: false, failed: true };
  }
  return { token: leadToken ?? "local", created: !leadToken }; // monday not configured
}
