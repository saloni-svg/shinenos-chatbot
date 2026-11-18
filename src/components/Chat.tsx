"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import QuoteForm, { EMPTY_QUOTE, type QuoteFields } from "./QuoteForm";

type Role = "user" | "assistant";

interface Msg {
  id: string;
  role: Role;
  content: string;
  sources?: { url: string; title: string }[];
  followups?: string[];
  error?: boolean;
  lead?: boolean;
  /** Shown in the chat but never sent to the AI (e.g. form reminders). */
  local?: boolean;
  /** Renders an "Open quote form" button under the message. */
  quoteAction?: boolean;
}

type KnownLead = Partial<Record<"name" | "phone" | "email" | "service" | "city" | "address" | "preferred_date" | "notes", string>>;

interface Saved {
  id: string;
  messages: Msg[];
  leadToken?: string | null;
  knownLead?: KnownLead;
  leadNotified?: boolean;
}

const STORAGE_KEY = "shinenos-chat-v1";
const PHONE = "(888) 802-0420";
const PHONE_HREF = "tel:+18888020420";

const STARTERS = [
  "What cleaning services do you offer?",
  "Do you serve my city?",
  "What's included in a deep clean?",
  "How do I book and what's your cancellation policy?",
];

const WELCOME: Msg = {
  id: "welcome",
  role: "assistant",
  content:
    "I'm the **SHINENOS AI Assistant** ✨\n\nAsk me anything about our cleaning services, service areas, pricing and booking, or our FAQs. I can also pass your details to the team for a quote.",
};

const FORM_REMINDER =
  "Please fill in and submit the **quote form** — your quote request can only be forwarded to the SHINENOS team once the form is submitted.";

const uid = () => Math.random().toString(36).slice(2, 10);

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function save(data: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, messages: data.messages.slice(-40) }));
  } catch {
    /* storage unavailable — chat still works, just not persisted */
  }
}

export default function Chat({ embedded = false }: { embedded?: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [conversationId, setConversationId] = useState<string>(() => uid());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // One lead per chat: the token lets later details update the same monday row.
  const [leadToken, setLeadToken] = useState<string | null>(null);
  const [knownLead, setKnownLead] = useState<KnownLead>({});
  const [leadNotified, setLeadNotified] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Restore the previous conversation for returning visitors.
  useEffect(() => {
    const saved = load();
    if (saved?.messages?.length) {
      // Always show the current greeting, even in chats saved before it changed.
      setMessages(saved.messages.map((m) => (m.id === "welcome" ? WELCOME : m)));
      setConversationId(saved.id);
      setLeadToken(saved.leadToken ?? null);
      setKnownLead(saved.knownLead ?? {});
      setLeadNotified(!!saved.leadNotified);
    }
  }, []);

  useEffect(() => {
    if (!busy) save({ id: conversationId, messages, leadToken, knownLead, leadNotified });
  }, [messages, busy, conversationId, leadToken, knownLead, leadNotified]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      setInput("");

      // The quote form is open: it must be submitted before the request can go further.
      if (quoteOpen) {
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "user", content, local: true },
          { id: uid(), role: "assistant", content: FORM_REMINDER, local: true },
        ]);
        return;
      }

      setBusy(true);
      setStatus("Thinking…");

      const userMsg: Msg = { id: uid(), role: "user", content };
      const botId = uid();
      const history = [...messages, userMsg];
      setMessages([...history, { id: botId, role: "assistant", content: "" }]);

      const patch = (fn: (m: Msg) => Msg) =>
        setMessages((prev) => prev.map((m) => (m.id === botId ? fn(m) : m)));

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            conversationId,
            leadToken: leadToken ?? undefined,
            messages: history
              .filter((m) => m.id !== "welcome" && !m.error && !m.local && m.content)
              .slice(-20)
              .map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Request failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const ev = JSON.parse(line);
            switch (ev.t) {
              case "text":
                setStatus(null);
                patch((m) => ({ ...m, content: m.content + ev.v }));
                break;
              case "status":
                setStatus(ev.v);
                break;
              case "sources":
                patch((m) => ({ ...m, sources: ev.v }));
                break;
              case "followups":
                patch((m) => ({ ...m, followups: ev.v }));
                break;
              case "lead": {
                const lead = (ev.v?.lead ?? {}) as KnownLead;
                if (ev.v?.token) setLeadToken(ev.v.token);
                setKnownLead((prev) => ({ ...prev, ...lead }));
                // Confirm once, when contact details (not just a name) have been passed on.
                if ((lead.phone || lead.email) && !leadNotified) {
                  setLeadNotified(true);
                  patch((m) => ({ ...m, lead: true }));
                }
                break;
              }
              case "error":
                patch((m) => ({ ...m, content: m.content || ev.v, error: !m.content }));
                break;
            }
          }
        }
        patch((m) => ({ ...m, content: m.content.trim() }));
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          patch((m) => ({ ...m, content: m.content.trim() || "_Stopped._" }));
        } else {
          patch((m) => ({
            ...m,
            error: true,
            content:
              (e as Error).message && (e as Error).message !== "Request failed"
                ? (e as Error).message
                : `Sorry, I couldn't reach the server. Please try again or call us at ${PHONE}.`,
          }));
        }
      } finally {
        setBusy(false);
        setStatus(null);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [busy, messages, conversationId, leadToken, leadNotified, quoteOpen],
  );

  const openQuote = () => {
    if (busy) return;
    setQuoteOpen(true);
  };

  const cancelQuote = () => {
    setQuoteOpen(false);
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: "assistant",
        local: true,
        quoteAction: true,
        content: "No problem — but please note that **you'll need to submit the quote form** for your quote request to be forwarded to the SHINENOS team. You can open it again any time.",
      },
    ]);
  };

  const submitQuote = async (f: QuoteFields) => {
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, leadToken: leadToken ?? undefined, form: f }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error, fieldErrors: data.fieldErrors };
      }
      if (data.leadToken) setLeadToken(data.leadToken);
      setKnownLead((prev) => ({
        ...prev,
        name: f.name,
        phone: f.phone || prev.phone,
        email: f.email,
        service: f.service,
        address: f.address,
        preferred_date: f.preferred_date || prev.preferred_date,
      }));
      setLeadNotified(true);
      setQuoteOpen(false);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          lead: true,
          // Kept in the history so the AI knows the quote request was submitted.
          content: `Thanks, **${f.name}**! Your quote request for **${f.service}** at **${f.address}** has been sent to the SHINENOS team. They'll contact you at ${f.phone ? `${f.phone} or ${f.email}` : f.email}. Anything else I can help with meanwhile?`,
        },
      ]);
      return { ok: true };
    } catch {
      return { ok: false, error: `Couldn't reach the server. Please try again or call ${PHONE}.` };
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setMessages([WELCOME]);
    setConversationId(uid());
    setLeadToken(null);
    setKnownLead({});
    setLeadNotified(false);
    setQuoteOpen(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const close = () => window.parent?.postMessage({ type: "shinenos-chat:close" }, "*");

  const lastBot = [...messages].reverse().find((m) => m.role === "assistant");
  const showStarters = messages.length === 1;

  return (
    <div className={`flex h-full flex-col bg-white ${embedded ? "" : "rounded-2xl shadow-2xl ring-1 ring-black/5"} overflow-hidden`}>
      {/* Header */}
      <header className="flex items-center gap-3 border-b-[3px] border-orange bg-[linear-gradient(100deg,#001746_0%,#002673_55%,#00358f_100%)] px-4 py-3 text-white">
        <div className="relative h-11 w-11 shrink-0 rounded-full bg-white p-0.5 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mascot.png" alt="SHINENOS" className="h-full w-full rounded-full object-cover" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-navy bg-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-tight">SHINENOS AI Assistant</div>
        </div>
        <button
          onClick={reset}
          title="Start a new chat"
          aria-label="Start a new chat"
          className="rounded-lg px-2 py-1 text-xs font-medium text-white/85 hover:bg-white/15"
        >
          New chat
        </button>
        {embedded && (
          <button
            onClick={close}
            aria-label="Close chat"
            className="grid h-8 w-8 place-items-center rounded-lg text-xl leading-none hover:bg-white/15"
          >
            ×
          </button>
        )}
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-[#f4f6fb] px-4 py-5" aria-live="polite">
        {messages.map((m) => {
          const streaming = busy && m.id === lastBot?.id && m.role === "assistant";
          if (m.role === "assistant" && !m.content && streaming) return null;
          return (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] ${m.role === "user" ? "" : "w-fit"}`}>
                <div
                  className={
                    m.role === "user"
                      ? "rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[14.5px] leading-relaxed text-white shadow-sm"
                      : `rounded-2xl rounded-bl-md px-4 py-2.5 text-[14.5px] leading-relaxed shadow-sm ring-1 ${
                          m.error ? "bg-red-50 text-red-800 ring-red-200" : "bg-white text-ink ring-black/5"
                        }`
                  }
                >
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <div className={`md ${streaming ? "caret" : ""}`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>

                {m.lead && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#eef6ee] px-3 py-2 text-xs font-medium text-success ring-1 ring-success/25">
                    ✓ Your details were sent to the SHINENOS team
                  </div>
                )}

                {m.quoteAction && !quoteOpen && m.id === messages[messages.length - 1]?.id && (
                  <button
                    onClick={openQuote}
                    className="mt-2 rounded-full bg-orange px-4 py-1.5 text-[13px] font-bold text-navy shadow-sm hover:brightness-95"
                  >
                    Open quote form
                  </button>
                )}

                {!busy && m.id === lastBot?.id && !!m.followups?.length && (
                  <div className="mt-3 flex flex-col items-start gap-1.5">
                    {m.followups.map((q) => (
                      <button
                        key={q}
                        onClick={() => send(q)}
                        className="rounded-full border border-brand/25 bg-white px-3 py-1.5 text-left text-[13px] text-brand transition hover:border-brand hover:bg-brand hover:text-white"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {busy && status && (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span className="flex gap-1">
              <span className="dot h-1.5 w-1.5 rounded-full bg-orange" />
              <span className="dot h-1.5 w-1.5 rounded-full bg-orange" />
              <span className="dot h-1.5 w-1.5 rounded-full bg-orange" />
            </span>
            {status}
          </div>
        )}

        {quoteOpen && (
          <div className="flex justify-start">
            <QuoteForm
              initial={{
                ...EMPTY_QUOTE,
                name: knownLead.name ?? "",
                phone: knownLead.phone ?? "",
                email: knownLead.email ?? "",
                service: knownLead.service ?? "",
                address: knownLead.address ?? knownLead.city ?? "",
                preferred_date: knownLead.preferred_date ?? "",
              }}
              onSubmit={submitQuote}
              onCancel={cancelQuote}
            />
          </div>
        )}

        {showStarters && !quoteOpen && (
          <div className="grid gap-2 pt-1 sm:grid-cols-2">
            {STARTERS.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="rounded-xl border border-black/5 bg-white px-3 py-2.5 text-left text-[13px] text-navy shadow-sm transition hover:border-orange hover:shadow"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-1.5 border-t border-black/5 bg-white px-4 pt-3">
        <a href={PHONE_HREF} className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-brand border border-brand/25 hover:bg-soft">
          📞 {PHONE}
        </a>
        <button
          onClick={openQuote}
          disabled={busy || quoteOpen}
          className="whitespace-nowrap rounded-full border border-brand bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:border-navy hover:bg-navy disabled:opacity-50"
        >
          💬 Get a quote
        </button>
      </div>

      {/* Composer */}
      <form
        className="flex items-end gap-2 bg-white px-4 pb-4 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Ask about services, booking…"
          aria-label="Your message"
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-black/10 bg-[#f4f6fb] px-3.5 py-2.5 text-[14.5px] outline-none placeholder:text-muted/80 focus:border-orange focus:bg-white focus:ring-2 focus:ring-orange/20"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="h-11 shrink-0 rounded-xl bg-navy px-4 text-sm font-semibold text-white"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="h-11 shrink-0 rounded-xl bg-orange px-5 text-sm font-bold text-navy shadow-sm hover:brightness-95 disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
      <div className="bg-white pb-2 text-center text-[10.5px] text-muted">AI can make mistakes. Please confirm details when booking.</div>
    </div>
  );
}
