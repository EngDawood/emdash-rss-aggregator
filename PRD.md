# AI Pipeline — Models, Agents & Output Profiles

Redesign of the RSS Aggregator's AI features. Replaces the flat global AI config
(one endpoint + one key + one model + hardcoded summarize/rewrite/translate) with
three **decoupled, reusable** building blocks that a feed wires together.

## Concept

| Layer | Owns | Scope |
|---|---|---|
| **Model** | endpoint + modelId + key + optional headers | saved, reusable, **test-gated** |
| **Agent** | instructions + typed `kind` → produces text | saved, reusable |
| **Output Profile** | what to do with the produced text (publish target, slug, draft/live, footer) | saved, reusable |

A **feed (source)** binds: one model + a set of agents + one output profile, and
supplies per-source values (its `slug`) that the profile's templates resolve.

```
feed item ──▶ [agents run on model] ──▶ text on the item ──▶ [output profile] ──▶ post (or kept private)
```

The agent's job ends at "here's the text." The Output Profile decides where it goes.

---

## 1. Model

How to call AI. Generic **OpenAI-compatible chat-completions** over HTTP — so
OpenAI, a Cloudflare AI Gateway URL (`.../compat/chat/completions`), or any
compatible endpoint all collapse to the same primitive.

```ts
interface Model {
  name: string;
  endpoint: string;                 // full chat-completions URL
  modelId: string;                  // model identifier sent in the request body
  provider?: string;                // display label only (no behavior)
  headers?: Record<string, string>; // e.g. cf-aig-authorization for an authenticated Gateway
  verifiedAt?: string;
  lastTestStatus?: string;
  createdAt: string;
  updatedAt: string;
}
```

- **The API key is NOT stored in the record.** It lives in KV at `model-secret:<id>`
  and is redacted from every response (the UI shows "configured" + a write-only
  "replace key" field). Deleting a model also deletes its KV secret.
- **Test-gated save (server-authoritative):** `models/create` and `models/update`
  always run a live test server-side and refuse to persist on failure — a model can
  never end up saved-but-unverified. A standalone `models/test` route powers the
  pre-save "Test" button.
  - Test = `messages:[{role:"user",content:"ping"}]`, `max_tokens:1`; passes on HTTP
    200 + non-empty `choices[0].message.content`. **Tests bypass the credit ledger.**
  - Re-test on edit only when a connection field changes (`endpoint`, `modelId`, key,
    `headers`); editing just `name`/`provider` does not require a live call.
- Workers AI via the `AI` binding (non-HTTP) is **out of scope** — everything is HTTP.

## 2. Agent

The transformation. `instructions` is the system prompt (it absorbs the old
`aiOwnerVoice` and `aiSummaryWords` — bake length/voice into the prompt). `kind`
determines the output target and special handling.

```ts
interface Agent {
  name: string;
  kind: "summary" | "rewrite" | "translate" | "custom";
  instructions: string;   // the system prompt
  temperature?: number;   // default 0.4
  locales?: string;       // translate-kind only — comma-separated BCP-47 (e.g. "ar,fr")
  createdAt: string;
  updatedAt: string;
}
```

Output target by kind, written onto the feed item:

| kind | output field |
|---|---|
| `summary` | `item.summary` |
| `rewrite` | `item.rewrittenContent` |
| `translate` | `item.translations[locale]` (per-locale JSON parse) |
| `custom` | `item.aiOutputs[agentId]` |

- **`translate` has no global locale fallback** — its `locales` field is the only
  source. Empty `locales` ⇒ the agent no-ops.
- A feed may select **multiple agents**, but **≤1 per fixed kind** (summary / rewrite /
  translate); **many `custom` agents** are allowed. Enforced on create/update.

## 3. Output Profile

What to do with the produced text. Reusable; per-source variability comes from
template tokens.

```ts
interface OutputProfile {
  name: string;
  mode: "internal" | "publish";       // internal = keep on the item, never publish
  collection: string;                 // e.g. "posts" | "pages" | custom
  status: "draft" | "published";      // draft = native CMS draft (edit then publish)
  requireApproval: boolean;           // true = item stays pending; entry created on approve
  slugPattern: string;                // default "{itemSlug}" (see routing note)
  bodySource: "rewrite" | "original" | "summary";   // fallback: rewrite→original if absent
  excerptSource?: "summary" | "original" | "none";
  footerTemplate?: string;            // trusted admin HTML appended to the body
  createdAt: string;
  updatedAt: string;
}
```

### Publish flow

- `mode:"internal"` → nothing enters any collection; agent outputs stay on the item.
- `mode:"publish"`:
  - `requireApproval:false` → on import, create the content entry with `status`.
  - `requireApproval:true` → item stays **pending**; on approve (`items/approve`) the
    entry is created with `status`. Reuses the existing curation + deferred path.
  - `status:"draft"` → a **native EmDash draft** — review/edit in the normal CMS editor,
    then publish. No second approval queue.

### Body / excerpt mapping

Mapped by **role/kind, never by agentId** (keeps profiles reusable):

- `bodySource` resolves the body text; if `rewrite` is chosen but no rewrite agent ran,
  it **falls back to original** (no empty bodies). `summary` allows digest-style feeds.
- Custom-agent outputs are **not** auto-mapped to body/excerpt; they are reachable in the
  footer via `{output.<agentName>}`.
- `title` is always the original item title in v1.

### Slug & grouping

- Site routes are **flat, single-segment** (`/blog/[slug]` → `getEmDashEntry("posts", slug)`).
  Nested `source-slug/item-slug` **paths do not render** without converting those pages to
  catch-all routes — out of scope. `slugPattern` defaults to flat `{itemSlug}`.
- "Group by source" is done via **taxonomy** instead: the profile assigns the source as a
  **category/tag term** (`{sourceSlug}`), which renders at `/category/<slug>` today.
- `itemSlug` = slugified title (+ short suffix on collision).

### Footer template

- `footerTemplate` is **trusted admin HTML** appended to the body at publish time.
- Single-brace `{token}` syntax (consistent with `slugPattern`). Unknown tokens are left
  untouched (typos stay visible). Tokens:
  `{sourceName}` `{sourceUrl}` `{originalUrl}` `{originalTitle}` `{author}`
  `{publishedAt}` `{summary}` `{output.<agentName>}` — plus `{sourceSlug}` `{itemSlug}`
  for `slugPattern`.

```html
<hr><p><em>Originally published at <a href="{originalUrl}" rel="nofollow">{sourceName}</a>.</em></p>
```

## Media handling

- **Featured image** → `featuredImage` from `item.imageUrl` (media-imported when enabled).
  Flows regardless of `bodySource`.
- **Inline body images** are predictable, not magic: they travel with `original` only.
  The rewrite agent is text-only — for images **+** AI text, use `bodySource:"original"`
  and route the rewrite/summary agent to the **excerpt**.
- **Non-image media** (`enclosure`, `audioUrl`, `youtubeVideoId`, `mediaType`) →
  preserved in the post `meta` (`rssEnclosure`, `rssAudioUrl`, `rssYoutubeId`,
  `rssMediaType`). No schema changes on the target collection.

---

## Feed (Source) bindings

New fields on `Source`:

```ts
aiModelId?: string;       // one model, used by all agents on this feed
aiAgentIds?: string[];    // the agents to run (≤1 per fixed kind)
slug?: string;            // per-source prefix feeding {sourceSlug}
outputProfileId?: string; // the bound output profile
```

Replaces the old `enableAiSummary` / `enableAiRewrite` / `enableTranslation` and
`feedToPost` / `postCollection` / `postStatus`.

## Execution (ai-service)

Single source of truth shared by import **and** the on-demand route:

```ts
resolveModel(ctx, modelId)                         // record + KV key → ready-to-call
callChat(ctx, model, system, user, opts?)          // generic OpenAI-compatible call
runAgent(ctx, model, agent, item)                  // dispatch by kind
applyAgents(ctx, settings, {item, modelId, agentIds}) // → Partial<FeedItem>
```

- `feed-fetcher.ts` replaces its inline AI block with one `applyAgents` call.
- `items/ai` becomes `{ id, agentId?, modelId? }`: with `agentId` runs that one agent
  (model = `modelId` or the feed's `aiModelId`); without it, re-runs the feed's whole set.
- Credits: 1 per successful op, 1 per locale (unchanged accounting).

## Storage

New storage collections: `models` (idx `createdAt`), `agents` (idx `kind`, `createdAt`),
`outputProfiles` (idx `createdAt`). KV adds `model-secret:<id>`; credits ledger unchanged.

## Admin UI

- New tabbed **`/ai`** page: **Models · Agents · Output Profiles** (CRUD via existing
  `ui.tsx` primitives). Models tab has the write-only key field + **Test** button +
  verified badge.
- **Sources** form gains: model picker (verified only), agents multi-select (kind-grouped,
  ≤1 fixed-kind), output-profile picker, `slug` field. Old AI/feed-to-post controls removed.
- **Settings** sheds the per-feature AI fields; keeps the master `aiEnabled`, the monthly
  credit limit, and the credits panel.

## Migration / back-compat

Non-destructive. Dropped global settings (`aiApiEndpoint`, `aiApiKey`, `aiModel`,
`aiSummary*`, `aiRewrite*`, `aiOwnerVoice`, `translationLocales`) and old Source fields
become **inert** — nothing is deleted in D1; `loadSettings` already ignores unknown keys.

On install, **3 example agents** (summary / rewrite / translate) are seeded from the old
hardcoded prompts. No model or profile is seeded (a model needs a real key + passing test).

⚠️ Any source currently using `feedToPost:true` **stops auto-posting** until assigned an
`outputProfileId`. No automatic conversion.
