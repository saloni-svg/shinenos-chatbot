# SHINENOS AI Chatbot

An AI assistant for [shinenos.com](https://shinenos.com), built with Next.js and Claude and ready to deploy on Vercel.
It answers only from the website's own content.

## AI features
- **Answers from the website only**: every reply is based on shinenos.com content (pages, city pages, FAQs, terms, blog, gift-card shop), with links to the source pages.
- **Agentic search**: Claude gets website excerpts with each question and can call a `search_website` tool several times for multi-part questions.
- **Lead capture**: when a visitor wants a quote or callback, Claude collects their details and calls `save_lead`.
- **Smart follow-up suggestions**: 2–3 AI-generated next questions after each answer.
- **Multilingual**: replies in the visitor's language.
- **Conversation memory**: understands follow-ups, and the chat is restored when the visitor returns.
- **Streaming** replies with live "Searching the website…" status, a Stop button, and quick actions (Book now / Call / Get a quote).
- **Embeddable widget**: one `<script>` tag adds a floating chat bubble to the WordPress site.

## How it works
```
scripts/scrape.ts      Crawls shinenos.com via WordPress + WooCommerce REST APIs → data/knowledge.json
src/lib/knowledge.ts   Local BM25 search index (MiniSearch) with stemming, synonyms, de-duplication
src/lib/prompt.ts      System prompt (grounding rules, booking flow, page directory)
src/lib/leads.ts       Lead saving (storage not configured yet; logs + optional webhook)
src/app/api/chat       Streaming chat endpoint: Claude + tools loop
src/components/Chat.tsx  Chat UI
src/app/embed          Chat page used inside the widget iframe
public/widget.js       Embeddable floating chat bubble
```

## Run locally
```bash
npm install
cp .env.example .env.local     # add your ANTHROPIC_API_KEY
npm run scrape                 # refresh website content (already done once)
npm run dev                    # http://localhost:3000
```

## Deploy to Vercel
1. Push this folder to a GitHub repo and import it in Vercel (or run `npx vercel`).
2. In Vercel → Project → Settings → Environment Variables, add `ANTHROPIC_API_KEY`.
3. Deploy.

## Add to the website
In WordPress, add this to the footer (e.g. with the "WPCode" plugin or Elementor custom code):
```html
<script src="https://YOUR-PROJECT.vercel.app/widget.js" defer></script>
```

## Updating the content
Run `npm run scrape` and redeploy whenever the website changes.

## Configuration (`.env.local` / Vercel env vars)
| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Claude API key |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model |
| `CHAT_EFFORT` | `low` | `low` / `medium` / `high`: reasoning depth versus speed and cost |
| `LEAD_WEBHOOK_URL` | (none) | Optional POST target for captured leads |

## Still to decide
- **Data storage** for leads, chat logs and the knowledge base. `src/lib/leads.ts` and `searchWebsite()` in `src/lib/knowledge.ts` are the only places to change.
- **Rate limiting** is in-memory and best effort on serverless. Use Vercel KV/Upstash for a hard limit.
