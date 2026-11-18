/**
 * Sends a TEST "New Chatbot Lead" email using the same code the chatbot uses.
 *
 *   npm run test:lead-email              -> sends a real test email (needs the env vars)
 *   npm run test:lead-email -- --dry     -> just prints the subject + text body, sends nothing
 *
 * Env vars are read from .env.local (or your shell): RESEND_API_KEY, LEAD_NOTIFY_TO, LEAD_NOTIFY_FROM.
 */
import { buildLeadEmail, notifyLeadByEmail } from "../src/lib/notify";
import type { Lead } from "../src/lib/leads";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* no .env.local — use the shell environment */
}

const lead: Lead = {
  name: "TEST Lead (please ignore)",
  email: "test.lead@example.com",
  phone: "(555) 010-0000",
  service: "Deep Cleaning",
  address: "123 Test Street, Springfield, 12345",
  notes: "This is a test email from the SHINENOS chatbot — no action needed.",
  // preferred_date and city left blank on purpose: they should show as "—"
};
const meta = { via: "Test script", conversationId: "test-script", mondayOk: true };

async function main() {
  if (process.argv.includes("--dry")) {
    const { subject, text } = buildLeadEmail(lead, meta);
    console.log(`Subject: ${subject}\n\n${text}`);
    return;
  }
  const ok = await notifyLeadByEmail(lead, meta);
  console.log(ok ? `✅ Test email sent to: ${process.env.LEAD_NOTIFY_TO}` : "❌ Not sent — see the message above.");
  process.exitCode = ok ? 0 : 1;
}
main();
