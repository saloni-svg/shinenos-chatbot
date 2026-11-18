import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { formatHits, searchWebsite, type SearchHit } from "@/lib/knowledge";
import { LeadSchema, leadLabel, saveLead, type Lead } from "@/lib/leads";
import { upsertMondayLead } from "@/lib/monday";
import { notifyLeadByEmail } from "@/lib/notify";
import { FollowupFilter } from "@/lib/followups";
import { SYSTEM_PROMPT } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
// Chat replies don't need deep reasoning; "low" keeps answers fast and cheap.
// Raise to "medium" via env if answers on complex questions need more care.
const EFFORT = (process.env.CHAT_EFFORT ?? "low") as "low" | "medium" | "high";
const MAX_TOOL_ROUNDS = 5;
// Text written right before a tool call ("I'll save the lead…") is internal
// narration. Each round's text is held back until it's clearly a real answer
// (longer than this), so a short preamble before a tool call is never shown.
const PREAMBLE_HOLD_CHARS = 280;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

// ---------- request validation ----------
const BodySchema = z.object({
  conversationId: z.string().max(100).optional(),
  leadToken: z.string().max(200).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

// ---------- tools ----------
const SearchInput = z.object({
  query: z.string().min(1).max(300),
});

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_website",
    description:
      "Search the SHINENOS website (all service pages, city/location pages, FAQs, policies, blog posts and gift-card shop) and return the most relevant excerpts with their URLs. Use it whenever the excerpts already provided don't fully answer the visitor's question. Use specific keywords, e.g. 'move out cleaning checklist', 'cancellation policy', 'deep cleaning Edina'. Call it multiple times for multi-part questions.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords describing what to look up" },
      },
      required: ["query"],
    },
    eager_input_streaming: true,
  },
  {
    name: "save_lead",
    description:
      "Create or update this visitor's lead for the SHINENOS team. Call it only once you have the visitor's NAME plus an EMAIL ADDRESS or PHONE NUMBER (a name alone, or an email/phone alone, is not enough), and call it again whenever they share or correct any other detail (phone, email, service, address, city, date, home size, pets, notes) — each call updates the same lead. Always pass ALL details known so far in the conversation, not just the new ones. Only use details the visitor actually gave you; never make anything up.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Visitor's name, if given" },
        phone: { type: "string", description: "Phone number, if given" },
        email: { type: "string", description: "Email address, if given" },
        service: { type: "string", description: "Service they're interested in, e.g. deep cleaning" },
        city: { type: "string", description: "City / area of the property" },
        address: { type: "string", description: "Street address of the property, if given" },
        preferred_date: { type: "string", description: "Preferred date or time, as the visitor said it" },
        notes: { type: "string", description: "Anything else useful: home size, pets, special requests" },
      },
      required: [],
    },
    eager_input_streaming: true,
  },
];

// ---------- simple per-IP rate limit (best effort on serverless) ----------
const hitsByIp = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hitsByIp.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hitsByIp.set(ip, recent);
  if (hitsByIp.size > 5000) hitsByIp.clear();
  return recent.length > 20;
}

type Event =
  | { t: "status"; v: string }
  | { t: "text"; v: string }
  | { t: "followups"; v: string[] }
  | { t: "lead"; v: { name: string; token: string | null; lead: Lead } }
  | { t: "error"; v: string }
  | { t: "done" };

function buildRetrievalQuery(msgs: z.infer<typeof BodySchema>["messages"]): string {
  // Include the previous user turn so short follow-ups ("and in Edina?") still retrieve well.
  const users = msgs.filter((m) => m.role === "user").slice(-2);
  return users.map((m) => m.content).join(" ");
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return Response.json({ error: "Too many messages — please wait a minute." }, { status: 429 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const history = body.messages;
  let leadToken = body.leadToken;
  if (history[history.length - 1].role !== "user") {
    return Response.json({ error: "Last message must be from the user" }, { status: 400 });
  }

  // Pre-retrieve website excerpts for the newest question so most answers need no tool round-trip.
  const preHits: SearchHit[] = searchWebsite(buildRetrievalQuery(history), 6);
  const last = history[history.length - 1];

  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  messages.push({
    role: "user",
    content: [
      {
        type: "text",
        text: `<website_excerpts note="Automatically retrieved from shinenos.com for this message; may be incomplete or irrelevant.">\n${formatHits(preHits)}\n</website_excerpts>`,
      },
      { type: "text", text: last.content },
    ],
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Event) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const filter = new FollowupFilter();
      let answer = "";
      let jsonRetries = 0;

      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const s = client.beta.messages.stream({
            model: MODEL,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: EFFORT },
            // Explicit breakpoint on the big stable system prompt + automatic
            // caching of the growing conversation during tool rounds.
            system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            cache_control: { type: "ephemeral" },
            // On the last allowed round, take tools away so the model must answer.
            tools: round < MAX_TOOL_ROUNDS ? tools : undefined,
            messages,
          });

          let held = answer && !answer.endsWith("\n") ? filter.push("\n\n") : "";
          let streaming = false;
          const emit = (text: string) => {
            if (!text) return;
            answer += text;
            send({ t: "text", v: text });
          };
          s.on("text", (delta) => {
            const visible = filter.push(delta);
            if (streaming) return emit(visible);
            held += visible;
            if (held.trim().length > PREAMBLE_HOLD_CHARS) {
              streaming = true;
              emit(held);
              held = "";
            }
          });

          let message: Anthropic.Beta.BetaMessage;
          try {
            message = await s.finalMessage();
            jsonRetries = 0;
          } catch (err) {
            // Only an unparseable tool input is retried; API errors bubble up.
            if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
            round--;
            continue;
          }

          // Short text before a tool call is narration — drop it; otherwise show it.
          const isToolRound = message.stop_reason === "tool_use";
          if (!streaming) {
            if (!isToolRound) emit(held);
            held = "";
          }

          if (message.stop_reason === "refusal") {
            const msg = "Sorry, I can't help with that. I'm happy to answer questions about SHINENOS cleaning services!";
            answer += msg;
            send({ t: "text", v: msg });
            break;
          }

          if (message.stop_reason === "pause_turn") {
            messages.push({ role: "assistant", content: message.content });
            continue;
          }

          const toolUses = message.content.filter(
            (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
          );
          if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

          messages.push({ role: "assistant", content: message.content });
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];

          for (const tu of toolUses) {
            if (tu.name === "search_website") {
              const parsed = SearchInput.safeParse(tu.input);
              if (!parsed.success) {
                results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: "Invalid input: provide a 'query' string." });
                continue;
              }
              send({ t: "status", v: `Searching the website for “${parsed.data.query}”…` });
              results.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: formatHits(searchWebsite(parsed.data.query, 6)),
              });
            } else if (tu.name === "save_lead") {
              // Drop empty strings so a blank optional field never fails validation.
              const input = Object.fromEntries(
                Object.entries((tu.input ?? {}) as Record<string, unknown>).filter(
                  ([, v]) => !(typeof v === "string" && v.trim() === "") && v != null,
                ),
              );
              const parsed = LeadSchema.safeParse(input);
              if (!parsed.success) {
                results.push({
                  type: "tool_result",
                  tool_use_id: tu.id,
                  is_error: true,
                  content: `Not saved: ${parsed.error.issues.map((i) => i.message).join("; ")}. Politely ask the visitor for the missing or invalid detail, then call save_lead again.`,
                });
                continue;
              }
              send({ t: "status", v: "Saving your details…" });
              try {
                await saveLead(parsed.data, { conversationId: body.conversationId });
                // Create this chat's monday row on the first save, update it afterwards (never throws).
                const firstSave = !leadToken;
                const synced = await upsertMondayLead(parsed.data, leadToken);
                leadToken = synced.token ?? leadToken;
                // Email the team when this chat's lead is first created — also if monday failed (never throws).
                if (synced.created || (synced.failed && firstSave)) {
                  await notifyLeadByEmail(parsed.data, {
                    via: "Chat",
                    conversationId: body.conversationId,
                    mondayOk: !synced.failed,
                  });
                }
                send({ t: "lead", v: { name: leadLabel(parsed.data), token: leadToken ?? null, lead: parsed.data } });
                results.push({
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: "Saved. The visitor's lead is up to date for the SHINENOS team. Don't mention saving unless the visitor asks; just continue the conversation.",
                });
              } catch (e) {
                console.error("[lead] save failed", e);
                results.push({
                  type: "tool_result",
                  tool_use_id: tu.id,
                  is_error: true,
                  content: "Saving failed due to a system error. Apologise and give the visitor the phone number and booking link instead.",
                });
              }
            } else {
              results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Unknown tool ${tu.name}` });
            }
          }
          messages.push({ role: "user", content: results });
        }

        const { rest, followups } = filter.end();
        if (rest) {
          answer += rest;
          send({ t: "text", v: rest });
        }
        if (followups.length) send({ t: "followups", v: followups });
        send({ t: "done" });
      } catch (err) {
        console.error("[chat] error", err);
        let msg = "Sorry — something went wrong on my side. Please try again, or call us at (888) 802-0420.";
        if (err instanceof Anthropic.RateLimitError) {
          msg = "I'm getting a lot of questions right now — please try again in a moment.";
        } else if (err instanceof Anthropic.AuthenticationError) {
          msg = "The chatbot isn't configured correctly (API key). Please call us at (888) 802-0420.";
        }
        send({ t: "error", v: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
