import { z } from "zod";
import { QuoteFormSchema, saveLead, type Lead } from "@/lib/leads";
import { upsertMondayLead } from "@/lib/monday";
import { notifyLeadByEmail } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({
  conversationId: z.string().max(100).optional(),
  leadToken: z.string().max(200).optional(),
  form: QuoteFormSchema,
});

// Best-effort per-IP limit so the form can't be used to spam the board.
const hitsByIp = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hitsByIp.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hitsByIp.set(ip, recent);
  if (hitsByIp.size > 5000) hitsByIp.clear();
  return recent.length > 5;
}

/** "Get a quote" form submission: saves the lead and creates/updates this chat's monday row. */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return Response.json({ ok: false, error: "Too many submissions — please wait a minute." }, { status: 429 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === "form" && typeof issue.path[1] === "string") fieldErrors[issue.path[1]] = issue.message;
    }
    return Response.json({ ok: false, error: "Please check the highlighted fields.", fieldErrors }, { status: 400 });
  }

  const { form, conversationId, leadToken } = parsed.data;
  const lead: Lead = {
    name: form.name,
    phone: form.phone,
    email: form.email,
    service: form.service,
    address: form.address,
    preferred_date: form.preferred_date || undefined,
    sqft: form.sqft,
    notes: [`Square footage: ${form.sqft} sq ft`, form.home_size ? `Home size: ${form.home_size}` : "", form.notes ? form.notes : "", "Submitted via quote form"]
      .filter(Boolean)
      .join(". "),
  };

  try {
    await saveLead(lead, { conversationId });
  } catch (e) {
    console.error("[lead] save failed", e);
    return Response.json(
      { ok: false, error: "Sorry, we couldn't send your request. Please try again or call (888) 802-0420." },
      { status: 500 },
    );
  }

  const { token, failed } = await upsertMondayLead(lead, leadToken);
  // Every quote form submission emails the team — also if monday failed (never throws).
  await notifyLeadByEmail(lead, { via: "Get a quote form", conversationId, mondayOk: !failed });
  return Response.json({ ok: true, leadToken: token, lead });
}
