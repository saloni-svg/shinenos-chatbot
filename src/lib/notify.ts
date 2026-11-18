import type { Lead } from "./leads";

/**
 * Emails a "New Chatbot Lead" notification to the SHINENOS team via Resend
 * (https://resend.com) — plain fetch, no extra package.
 *
 * Env vars (server-side only):
 *   RESEND_API_KEY     Resend API key
 *   LEAD_NOTIFY_TO     comma-separated recipients
 *   LEAD_NOTIFY_FROM   sender, e.g. "SHINENOS Chatbot <leads@shinenos.com>" (domain must be verified in Resend)
 *   LEAD_NOTIFY_BOARD_URL  optional, link to the monday board
 *   LEAD_NOTIFY_TIMEZONE   optional, IANA zone for the submission time (default America/New_York)
 *
 * Never throws: if email isn't configured or fails, it logs and returns false.
 */

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 5000;
const DEFAULT_BOARD_URL = "https://shinenos.monday.com/boards/18440107184";
const BLANK = "—";

export interface LeadNotifyMeta {
  /** Where the lead came from, e.g. "Chat" or "Get a quote form". */
  via: string;
  conversationId?: string;
  /** Whether the monday.com sync succeeded. */
  mondayOk?: boolean;
  submittedAt?: Date;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Every lead field in a fixed order, blanks shown as "—". */
function leadRows(lead: Lead, meta: LeadNotifyMeta): [string, string][] {
  const tz = process.env.LEAD_NOTIFY_TIMEZONE || "America/New_York";
  let when: string;
  try {
    when = (meta.submittedAt ?? new Date()).toLocaleString("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    when = (meta.submittedAt ?? new Date()).toISOString();
  }
  const v = (x: string | undefined) => (x && x.trim() ? x.trim() : BLANK);
  return [
    ["Name", v(lead.name)],
    ["Email", v(lead.email)],
    ["Phone", v(lead.phone)],
    ["Service", v(lead.service)],
    ["Address", v(lead.address)],
    ["City", v(lead.city)],
    ["Preferred date", v(lead.preferred_date)],
    ["Notes", v(lead.notes)],
    ["Source", `Website chatbot (${meta.via})`],
    ["Submitted", when],
    ["monday.com", meta.mondayOk === undefined ? BLANK : meta.mondayOk ? "Saved to board" : "NOT saved — check server logs"],
    ["Conversation ID", v(meta.conversationId)],
  ];
}

export function buildLeadEmail(lead: Lead, meta: LeadNotifyMeta) {
  const boardUrl = process.env.LEAD_NOTIFY_BOARD_URL || DEFAULT_BOARD_URL;
  const rows = leadRows(lead, meta);
  const subject = `New Chatbot Lead: ${lead.name?.trim() || BLANK} – ${lead.service?.trim() || BLANK}`;

  const text = [
    "New lead from the SHINENOS website chatbot",
    "",
    ...rows.map(([k, val]) => `${k}: ${val}`),
    "",
    `Open the board: ${boardUrl}`,
  ].join("\n");

  const htmlRows = rows
    .map(
      ([k, val]) =>
        `<tr><th align="left" style="padding:8px 12px;background:#eef2fa;color:#001746;font-weight:600;border-bottom:1px solid #dde3ef;width:150px;vertical-align:top">${esc(k)}</th>` +
        `<td style="padding:8px 12px;color:#1f2937;border-bottom:1px solid #dde3ef;white-space:pre-wrap">${esc(val)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #dde3ef">
<tr><td style="background:#001746;border-bottom:3px solid #ffa608;padding:16px 20px;color:#fff;font-size:18px;font-weight:bold">New Chatbot Lead</td></tr>
<tr><td style="padding:16px 20px 4px;color:#1f2937;font-size:14px">A new lead came in from the SHINENOS website chatbot.</td></tr>
<tr><td style="padding:12px 20px"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px">${htmlRows}</table></td></tr>
<tr><td style="padding:8px 20px 24px"><a href="${esc(boardUrl)}" style="display:inline-block;background:#ffa608;color:#001746;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:8px">Open the monday.com board</a></td></tr>
</table></body></html>`;

  return { subject, text, html };
}

/** Sends the lead email. Returns true if Resend accepted it. Never throws. */
export async function notifyLeadByEmail(lead: Lead, meta: LeadNotifyMeta): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = (process.env.LEAD_NOTIFY_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const from = process.env.LEAD_NOTIFY_FROM;
  if (!apiKey || !to.length || !from) {
    console.warn("[lead-email] skipped: RESEND_API_KEY, LEAD_NOTIFY_TO or LEAD_NOTIFY_FROM not set");
    return false;
  }

  try {
    const { subject, text, html } = buildLeadEmail(lead, meta);
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text, html, ...(lead.email ? { reply_to: lead.email } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    }
    console.log("[lead-email] sent to", to.length, "recipient(s)");
    return true;
  } catch (e) {
    console.error("[lead-email] failed", e);
    return false;
  }
}
