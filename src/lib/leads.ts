import { z } from "zod";

// A visitor becomes a lead once they've given their NAME plus an EMAIL or PHONE.
// Other details (service, address, date, notes) are added as they come.
export const LeadSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(200).optional(),
    service: z.string().trim().max(200).optional(),
    city: z.string().trim().max(120).optional(),
    address: z.string().trim().max(300).optional(),
    preferred_date: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((l) => !!(l.name && (l.email || l.phone)), {
    message: "Need the visitor's name plus an email or phone number",
  });

export type Lead = z.infer<typeof LeadSchema>;

/** A display name for a lead that may not have a name yet. */
export function leadLabel(lead: Lead): string {
  return lead.name || lead.email || lead.phone || "Website visitor";
}

// The "Get a quote" form: these fields are compulsory.
export const QuoteFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z
    .string()
    .trim()
    .min(1, "Phone is required")
    .max(40)
    .refine((v) => v.replace(/\D/g, "").length >= 7, "Enter a valid phone number"),
  email: z.string().trim().email("Enter a valid email").max(200),
  service: z.string().trim().min(1, "Choose a service").max(200),
  address: z.string().trim().min(1, "Address is required").max(300),
  sqft: z
    .string()
    .trim()
    .min(1, "Square footage is required")
    .max(12)
    .refine((v) => /^\d[\d,]*(\.\d+)?$/.test(v) && Number(v.replace(/,/g, "")) > 0, "Enter a number, e.g. 1800"),
  preferred_date: z.string().trim().max(120).optional(),
  home_size: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Persists a lead captured by the chatbot.
 *
 * STORAGE NOT CONFIGURED YET — for now this logs the lead and, if
 * LEAD_WEBHOOK_URL is set, POSTs it there (works with Zapier, Make,
 * GoHighLevel, Google Apps Script, etc.). Swap the body of this function
 * for your database of choice later.
 */
export async function saveLead(lead: Lead, meta: { conversationId?: string }): Promise<void> {
  const record = { ...lead, ...meta, createdAt: new Date().toISOString(), source: "website-chatbot" };
  console.log("[lead]", JSON.stringify(record));

  const webhook = process.env.LEAD_WEBHOOK_URL;
  if (webhook) {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw new Error(`Lead webhook returned ${res.status}`);
  }
}
