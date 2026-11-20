import type { Lead } from "./leads";

/**
 * Sends chatbot leads to monday.com through the monday workflow webhook
 * (MONDAY_LEAD_WEBHOOK_URL). Server-side only — the URL never reaches the browser.
 *
 * Each chat session sends its lead ONCE: after a successful POST the browser
 * keeps a "sent" marker for the chat and later saves are skipped. A failed POST
 * leaves the marker unset, so the next save in that chat tries again.
 *
 * Never throws: every failure is logged and the chat carries on.
 */

const TIMEOUT_MS = 5000;
const WEBHOOK_SENT = "webhook";

function detailsText(lead: Lead): string {
  return [
    lead.preferred_date ? `Preferred date: ${lead.preferred_date}` : "",
    lead.notes ? `Notes: ${lead.notes}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

async function postToWebhook(url: string, lead: Lead): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: lead.name ?? "",
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      service: lead.service ?? "", // exact service name the visitor picked
      address: lead.address ?? lead.city ?? "",
      sqft: lead.sqft ?? "",
      details: detailsText(lead),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`webhook returned ${res.status}`);
}

/**
 * Sends this chat's lead to the monday workflow webhook, once per chat session.
 * @param leadToken marker from an earlier save in the same chat, if any
 * @returns the marker to keep for this chat; `created` is true when the lead was sent now
 */
export async function upsertMondayLead(
  lead: Lead,
  leadToken?: string,
): Promise<{ token: string | null; created: boolean; failed?: boolean }> {
  const webhook = process.env.MONDAY_LEAD_WEBHOOK_URL;
  if (!webhook) {
    console.warn("[monday] MONDAY_LEAD_WEBHOOK_URL is not set — lead not sent to monday");
    return { token: leadToken ?? "local", created: !leadToken }; // monday not configured
  }
  if (leadToken === WEBHOOK_SENT) return { token: WEBHOOK_SENT, created: false };
  try {
    await postToWebhook(webhook, lead);
    return { token: WEBHOOK_SENT, created: true };
  } catch (e) {
    console.error("[monday] webhook lead send failed", e);
    return { token: leadToken ?? null, created: false, failed: true };
  }
}
