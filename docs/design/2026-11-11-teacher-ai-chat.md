# AI assistant chat in the teacher area: proposal

Status: approved for building (owner decisions 2026-11-11, below); stages S19a–S19c. Owner's wishes: a chat "similar to this" (Claude Code) inside the teacher area; **chats kept on the server so they are not lost**; **connect whatever AI the school has**: accounts where the provider allows it, API keys, other providers.

## Owner decisions (2026-11-11)

- **Connections: all of them.** Anthropic API key, OpenAI API key, Google Gemini API key, OpenRouter ("Connect OpenRouter" with OAuth PKCE, or a pasted key) and any OpenAI-compatible base URL, all in the first build; the admin picks the school default. **"Sign in with ChatGPT"** (a teacher's ChatGPT plan): build the adapter slot and the flow behind a setting that stays off until OpenAI grants Class Compass access; the admin page says so plainly and links how to apply. Claude subscriptions stay impossible (Anthropic allows only API keys for third-party apps).
- **Easier connector setup (the other direction).** Besides the in-app chat, a guided "Connect an AI app" page so a teacher can add Class Compass to ChatGPT, Claude (claude.ai, Desktop, Code) and other MCP clients with step-by-step instructions, the exact URL, copy buttons, a connection test and the admin checklist (AI tools switch, OAuth return hosts, the Cloudflare Access bypass note) — replacing today's bare token list as the first thing teachers see.
- **Teachers' own connections:** an admin setting, off by default; when on, a teacher may add a personal connection only they use.
- **Chat retention:** keep for the school year, delete one year after the last message (admin can change it).
- **Parent drafts:** yes, drafts only; nothing is ever sent from the chat; the teacher copies the text.

## What already exists

S14h built the AI tools server (`src/server/modules/mcp/`): 45 endpoints opted in as tools with scopes, every call acting with the user's own permissions and audited, the privacy filter (`privacy.ts`: student names become stable pseudonyms like "Student 4" while the school's student-data switch is off, single name parts become `[name]`), and the two school switches (AI tools, student data), both off by default. External assistants (claude.ai, Claude Desktop, ChatGPT connectors) already use it over `/mcp`.

The in-app chat reuses that tool layer; it adds a chat client, a server-side agent loop, provider connections and chat storage.

## How it works

- A **chat page in the teacher area** (PIN-gated in classroom mode), never on the classroom board or the student page. An administrator switches the feature on and chooses the allowed connections.
- The server runs the conversation: it sends the teacher's message and the tools that teacher may use to the chosen model, runs the tool calls **as that teacher** through the same code path as `/mcp` (`callEndpoint`, privacy filter, audit with actor `{ type: 'mcp', … }` or a new `assistant` actor), and streams the answer back.
- **Reading runs automatically. Every change asks first**: a confirmation card in the chat ("Add 2 points to Defne? Yes / No"). Tools marked `readOnly: false` never run without the teacher's click; approved changes go through the normal endpoints (outbox, audit).
- **Real names on screen, pseudonyms to the provider.** With the student-data switch off, the provider only ever sees pseudonyms. The server knows the mapping, so the chat shows the teacher real names (swapped back on the way to the browser, never on the way to the provider). External assistants cannot do this; it makes the in-app chat the more private option.
- The guides (`docs/guides/`, already AI resources) let it answer "how do I…" questions.
- Children's text in tool results (reflections, notes) is data; it can try to steer the model (prompt injection). Mitigations: it is marked as untrusted in the tool output, and no change runs without the teacher's confirmation.

## Connections: "connect whatever I can"

One connection layer with adapters; each connection has a type, a display name, the models it may use, and (for keys) a sealed secret.

| Connection | How the school connects | Status |
|---|---|---|
| **Anthropic (Claude) API key** | Admin pastes a key from the Claude Console | Possible now; the reference adapter |
| **OpenAI API key** | Admin pastes a key | Possible now |
| **Google Gemini API key** | Admin pastes a key (AI Studio) | Possible now |
| **OpenRouter account** | "Connect OpenRouter" button: the user signs in at OpenRouter and approves; the app receives a key tied to that account (OAuth with PKCE). One account reaches many providers' models, including Claude, GPT and Gemini. Or paste an OpenRouter key | Possible now |
| **Any OpenAI-compatible endpoint** | Base URL + optional key: Mistral, Groq, Azure, a self-hosted model (Ollama/vLLM on the Oracle server, see the local-AI idea) | Possible now; small local models are weak at multi-step tool use, so mark them "experimental" |
| **ChatGPT account (Plus/Pro plan)** | "Sign in with ChatGPT" with plan usage: since OpenAI's DevDay (29 Sep 2026) participating apps can run requests on a subscriber's plan with per-app weekly caps. Access is gated: open-source apps are self-serve, hosted/commercial apps apply | **Not guaranteed**: Class Compass would have to apply (or qualify as open source). Build the adapter slot; switch it on only when OpenAI grants access |
| **Claude account (Pro/Max plan)** | Not allowed: Anthropic limits subscription login to its own products (claude.ai, Claude Code); third-party apps must use API keys | Use an Anthropic API key or Claude through OpenRouter |

Using a ChatGPT or Claude **subscription** already works today in the other direction: the teacher opens ChatGPT or Claude and adds Class Compass as a connector (`/mcp`, S14h). The in-app chat is for teachers who want it inside Class Compass.

The OpenAI-compatible connection takes **any base URL** the admin enters, plus an optional key and a model name. The service must speak the OpenAI Chat Completions API with tool (function) calling, otherwise the chat can answer but not use the app's tools; a "Test connection" button checks both. Only administrators may enter URLs; the server refuses cloud metadata and link-local addresses and allows private addresses only when the admin marks the connection as "on this server or school network" (so a local model on the Oracle server works).

Rules for connections:
- **Who sets them**: administrators set school connections (and a default); optionally a teacher may add a personal connection if the admin allows it.
- **Secrets**: sealed at rest with `sealSecret` (`src/server/lib/crypto.ts`) under their own purpose; shown once, never returned by any endpoint, never in logs, audit details, exports or screenshots; deleting a connection deletes the secret; OAuth refresh handled server-side.
- **Limits**: a monthly budget per connection and a daily message limit per teacher; usage shown to the admin (counts and tokens, not chat content).
- **Privacy per provider**: each provider is a separate data processor (KVKK). The admin confirms each one when adding it; the AI tools guide lists what leaves the school. A self-hosted endpoint on the school's server keeps everything inside.
- **Tool calling differs by provider**: one internal tool format (the existing MCP tool definitions) translated per adapter (Anthropic tools, OpenAI function calling, Gemini function declarations). A model list marks which models were tested with the tools.

## Chats kept on the server

- New tables (migration): `assistant_chats` (id, owner user, title, connection and model, created, updated, archived) and `assistant_messages` (chat, role, content blocks as JSON, tool calls and their results, confirmation state, token usage, created).
- **Private to the teacher**: only the owner reads their chats; administrators see usage numbers, not content. No AI tool exposes chats.
- **Stored as sent**: with the student-data switch off, chats are stored with pseudonyms and shown with real names, so erasing a student also makes old chats name-free. With the switch on, stored text can hold names; erasure then scrubs them.
- Search, rename, archive, delete; continue any old chat. Long chats are compacted (summary of the earlier part) before they exceed the model's context.
- **Retention**: an admin setting (default: keep for the school year, delete one year after the last message); included in the teacher's own data export; deleted with the account.

## Stages (suggested)

1. **S19a Assistant chat (core)**: chat page with streaming, the server agent loop on the existing tool layer, confirmation cards, server-side chats with retention, Anthropic adapter plus the OpenAI-compatible adapter (covers OpenAI, OpenRouter keys, Mistral, Groq, local models), connection admin with sealed keys and limits, guides EN/TR, tests (permissions, pseudonym round trip, confirmations, prompt-injection cases, secrets never returned).
2. **S19b More connections**: Gemini adapter, "Connect OpenRouter" (OAuth PKCE), per-teacher connections, model test matrix; "Sign in with ChatGPT" when OpenAI grants access.

Size: S19a large, S19b medium. After S17/S18.

## Open questions for the owner

- Default model and connection for the school (and whether teachers may add their own).
- Retention period for chats.
- Whether drafts for parents (messages, notes) should be offered at all, since nothing is sent from the chat.

## Sources (checked 2026-11-11)
- Sign in with ChatGPT plan usage: [The New Stack](https://thenewstack.io/sign-in-with-chatgpt/), [DEV Community](https://dev.to/hassann/sign-in-with-chatgpt-for-developers-the-oauth-flow-plan-usage-and-what-it-means-for-your-api-bill-48f7), [Trending Topics](https://www.trendingtopics.eu/sign-in-with-chatgpt-tokens-other-apps/)
- Claude subscription login limited to Anthropic's products: [GitHub issue anthropics/claude-code#82266](https://github.com/anthropics/claude-code/issues/82266), [WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/), [AlternativeTo](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use)
- OpenRouter OAuth PKCE: [OpenRouter docs](https://openrouter.ai/docs/use-cases/oauth-pkce)
