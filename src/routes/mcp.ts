/**
 * @dawod/emdash-rss-aggregator
 *
 * In-plugin MCP route. Exposes a focused, `rss_`-prefixed tool surface so an
 * MCP client can manage feed sources and the AI pipeline (agents, output
 * profiles, models). Mirrors the inbox-plugin pattern: the site's `/mcp` proxy
 * merges these tools into `tools/list` and forwards `rss_*` `tools/call`s here.
 *
 * Single source of truth: every tool dispatches to an existing route handler
 * via a derived RouteContext (`{ ...ctx, input }`), so all validation,
 * defaulting, and cascade logic lives in one place — the route modules.
 */

import type { RouteContext } from "emdash";
import { PluginRouteError } from "emdash";
import { sourceRoutes } from "./sources.js";
import { itemRoutes } from "./items.js";
import { agentRoutes } from "./agents.js";
import { profileRoutes } from "./profiles.js";
import { modelRoutes } from "./models.js";
import { miscRoutes } from "./misc.js";

type RouteHandler = (ctx: RouteContext) => Promise<unknown>;
type Args = Record<string, unknown>;

// ── Dispatch helpers ───────────────────────────────────────────────────────

/** Call a route handler that reads `ctx.input` (mutations, validate, stats). */
function withInput(handler: RouteHandler, ctx: RouteContext, input: unknown): Promise<unknown> {
	return handler({ ...ctx, input });
}

/**
 * Call a list route handler that reads filters off `ctx.request.url`
 * (sources/items). Encodes the tool args into a synthetic GET URL.
 */
function withQuery(handler: RouteHandler, ctx: RouteContext, query: Args): Promise<unknown> {
	const url = new URL("https://plugin.internal/");
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
	}
	const request = new Request(url.toString(), { method: "GET" });
	return handler({ ...ctx, request, input: undefined });
}

// ── Shared JSON Schema fragments ───────────────────────────────────────────

const SOURCE_WRITE_FIELDS = {
	name: { type: "string", description: "Display name. Defaults to the feed's title when omitted." },
	tag: { type: "string", description: "Free-text tag for grouping/filtering sources." },
	status: { type: "string", enum: ["active", "paused", "error"], description: "Source status." },
	fetchInterval: { type: "number", description: "Minutes between fetches. Defaults to the global interval." },
	importLimit: { type: "number", description: "Max items kept for this source." },
	aiModelId: { type: "string", description: "Bind a model (see rss_list_models) to run the AI pipeline on import." },
	aiAgentIds: {
		type: "array",
		items: { type: "string" },
		description: "Agent IDs to run (see rss_list_agents). At most one per fixed kind (summary/rewrite/translate).",
	},
	outputProfileId: { type: "string", description: "Bind an output profile (see rss_list_profiles)." },
} as const;

const LIST_FILTER_PROPS = {
	limit: { type: "number", description: "Max items to return (1–100)." },
	cursor: { type: "string", description: "Pagination cursor from a previous call." },
} as const;

// ── Tool registry ──────────────────────────────────────────────────────────

interface ToolDef {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	invoke: (ctx: RouteContext, args: Args) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
	// ── Sources ────────────────────────────────────────────────────────────
	{
		name: "rss_list_sources",
		description: "List configured feed sources, optionally filtered by status or tag.",
		inputSchema: {
			type: "object",
			properties: {
				status: { type: "string", enum: ["active", "paused", "error"] },
				tag: { type: "string" },
				...LIST_FILTER_PROPS,
			},
		},
		invoke: (ctx, a) => withQuery(sourceRoutes["sources"].handler, ctx, a),
	},
	{
		name: "rss_add_source",
		description:
			"Add a feed source by URL. The feed is fetched once to derive its title; omitted fields fall back to plugin defaults.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Feed URL (RSS or Atom)." },
				...SOURCE_WRITE_FIELDS,
			},
			required: ["url"],
		},
		invoke: (ctx, a) => withInput(sourceRoutes["sources/create"].handler, ctx, a),
	},
	{
		name: "rss_update_source",
		description: "Update fields on an existing feed source.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Source ID." },
				url: { type: "string" },
				...SOURCE_WRITE_FIELDS,
			},
			required: ["id"],
		},
		invoke: (ctx, a) => withInput(sourceRoutes["sources/update"].handler, ctx, a),
	},
	{
		name: "rss_delete_source",
		description:
			"Delete a feed source. CASCADES: also permanently deletes all of the source's imported items, import logs, and reject-list entries.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "Source ID." } },
			required: ["id"],
		},
		invoke: (ctx, a) => withInput(sourceRoutes["sources/delete"].handler, ctx, a),
	},
	{
		name: "rss_fetch_source",
		description: "Fetch and import a single source immediately. Returns the import log.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "Source ID." } },
			required: ["id"],
		},
		invoke: (ctx, a) => withInput(sourceRoutes["sources/fetch-now"].handler, ctx, a),
	},
	{
		name: "rss_fetch_all",
		description: "Fetch and import every active source now. Returns processed/succeeded/failed counts.",
		inputSchema: { type: "object", properties: {} },
		invoke: (ctx) => withInput(sourceRoutes["sources/fetch-all"].handler, ctx, {}),
	},
	{
		name: "rss_validate_feed",
		description: "Fetch and parse a feed URL without saving it. Returns title/format/itemCount, or an error.",
		inputSchema: {
			type: "object",
			properties: { url: { type: "string", description: "Feed URL to validate." } },
			required: ["url"],
		},
		invoke: (ctx, a) => withInput(miscRoutes["validate-feed"].handler, ctx, a),
	},

	// ── Observe ──────────────────────────────────────────────────────────────
	{
		name: "rss_stats",
		description: "Aggregate stats: source counts by status, total items, items imported today, last import.",
		inputSchema: { type: "object", properties: {} },
		invoke: (ctx) => withInput(miscRoutes["stats"].handler, ctx, {}),
	},
	{
		name: "rss_list_items",
		description: "List imported feed items, optionally filtered by source or status.",
		inputSchema: {
			type: "object",
			properties: {
				sourceId: { type: "string" },
				status: { type: "string" },
				...LIST_FILTER_PROPS,
			},
		},
		invoke: (ctx, a) => withQuery(itemRoutes["items"].handler, ctx, a),
	},

	// ── Agents ───────────────────────────────────────────────────────────────
	{
		name: "rss_list_agents",
		description: "List saved AI agents (the pipeline steps bound to feeds).",
		inputSchema: { type: "object", properties: {} },
		invoke: (ctx) => withInput(agentRoutes["agents"].handler, ctx, {}),
	},
	{
		name: "rss_create_agent",
		description:
			"Create an AI agent. `kind` is summary/rewrite/translate/custom; `instructions` is its system prompt.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string" },
				kind: { type: "string", enum: ["summary", "rewrite", "translate", "custom"] },
				instructions: { type: "string", description: "System prompt driving the agent." },
				temperature: { type: "number", description: "Sampling temperature (default 0.4)." },
				locales: { type: "string", description: "translate-kind only: comma-separated BCP-47 locales, e.g. \"ar,fr\"." },
			},
			required: ["name", "kind", "instructions"],
		},
		invoke: (ctx, a) => withInput(agentRoutes["agents/create"].handler, ctx, a),
	},
	{
		name: "rss_update_agent",
		description: "Update fields on an existing AI agent.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				name: { type: "string" },
				kind: { type: "string", enum: ["summary", "rewrite", "translate", "custom"] },
				instructions: { type: "string" },
				temperature: { type: "number" },
				locales: { type: "string" },
			},
			required: ["id"],
		},
		invoke: (ctx, a) => withInput(agentRoutes["agents/update"].handler, ctx, a),
	},
	{
		name: "rss_delete_agent",
		description: "Delete an AI agent by ID.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		},
		invoke: (ctx, a) => withInput(agentRoutes["agents/delete"].handler, ctx, a),
	},

	// ── Output profiles ──────────────────────────────────────────────────────
	{
		name: "rss_list_profiles",
		description: "List saved output profiles (how processed items become content entries).",
		inputSchema: { type: "object", properties: {} },
		invoke: (ctx) => withInput(profileRoutes["output-profiles"].handler, ctx, {}),
	},
	{
		name: "rss_create_profile",
		description:
			"Create an output profile. `mode` internal keeps items private; publish creates content entries in `collection`.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string" },
				mode: { type: "string", enum: ["internal", "publish"] },
				collection: { type: "string", description: "Target content collection. Required when mode is \"publish\"." },
				status: { type: "string", enum: ["draft", "published"], description: "Created-entry status (default draft)." },
				requireApproval: { type: "boolean", description: "If true, entry is created only on approval (default false)." },
				slugPattern: { type: "string", description: "Slug template (default \"{itemSlug}\")." },
				bodySource: { type: "string", enum: ["rewrite", "original", "summary"], description: "Which text becomes the body (default rewrite)." },
				excerptSource: { type: "string", enum: ["summary", "original", "none"] },
			},
			required: ["name", "mode"],
		},
		invoke: (ctx, a) =>
			withInput(profileRoutes["output-profiles/create"].handler, ctx, {
				...a,
				collection: a.collection ?? "",
				status: a.status ?? "draft",
				requireApproval: a.requireApproval ?? false,
				slugPattern: a.slugPattern ?? "{itemSlug}",
				bodySource: a.bodySource ?? "rewrite",
			}),
	},
	{
		name: "rss_update_profile",
		description: "Update fields on an existing output profile.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				name: { type: "string" },
				mode: { type: "string", enum: ["internal", "publish"] },
				collection: { type: "string" },
				status: { type: "string", enum: ["draft", "published"] },
				requireApproval: { type: "boolean" },
				slugPattern: { type: "string" },
				bodySource: { type: "string", enum: ["rewrite", "original", "summary"] },
				excerptSource: { type: "string", enum: ["summary", "original", "none"] },
			},
			required: ["id"],
		},
		invoke: (ctx, a) => withInput(profileRoutes["output-profiles/update"].handler, ctx, a),
	},
	{
		name: "rss_delete_profile",
		description: "Delete an output profile by ID.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		},
		invoke: (ctx, a) => withInput(profileRoutes["output-profiles/delete"].handler, ctx, a),
	},

	// ── Models (read / verify / remove only — creation holds a secret key) ────
	{
		name: "rss_list_models",
		description: "List saved AI models. API keys are never returned; `hasKey` indicates one is configured.",
		inputSchema: { type: "object", properties: {} },
		invoke: (ctx) => withInput(modelRoutes["models"].handler, ctx, {}),
	},
	{
		name: "rss_test_model",
		description:
			"Test a saved model's connection using its stored key. Creating/updating models (which require a raw API key) is intentionally not available over MCP — use the admin UI.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string", description: "Model ID to test." } },
			required: ["id"],
		},
		invoke: (ctx, a) => withInput(modelRoutes["models/test"].handler, ctx, a),
	},
	{
		name: "rss_delete_model",
		description: "Delete a model and its stored API key by ID.",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		},
		invoke: (ctx, a) => withInput(modelRoutes["models/delete"].handler, ctx, a),
	},
];

// ── JSON-RPC route ─────────────────────────────────────────────────────────

interface JsonRpc {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: { name?: string; arguments?: Args };
}

export const mcpRoutes = {
	/**
	 * Non-public route (requires the caller's token to carry `plugins:manage`
	 * + `admin` scope). Reachable at /_emdash/api/plugins/rss-aggregator/mcp.
	 * The site `/mcp` proxy forwards `tools/list` and `rss_*` `tools/call`s here.
	 */
	mcp: {
		handler: async (ctx: RouteContext) => {
			const rpc = (ctx.input ?? {}) as JsonRpc;
			const id = rpc.id ?? null;

			if (rpc.method === "tools/list") {
				return {
					jsonrpc: "2.0",
					id,
					result: {
						tools: TOOLS.map((t) => ({
							name: t.name,
							description: t.description,
							inputSchema: t.inputSchema,
						})),
					},
				};
			}

			if (rpc.method === "tools/call") {
				const name = rpc.params?.name;
				const tool = TOOLS.find((t) => t.name === name);
				if (!tool) {
					return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } };
				}
				try {
					const data = await tool.invoke(ctx, rpc.params?.arguments ?? {});
					return {
						jsonrpc: "2.0",
						id,
						result: { content: [{ type: "text", text: JSON.stringify(data) }] },
					};
				} catch (err) {
					// Surface user-facing PluginRouteError messages; mask anything else.
					const message =
						err instanceof PluginRouteError ? err.message : "Internal error running tool";
					return {
						jsonrpc: "2.0",
						id,
						result: { content: [{ type: "text", text: message }], isError: true },
					};
				}
			}

			if (rpc.method === "initialize") {
				return {
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: "2024-11-05",
						capabilities: { tools: {} },
						serverInfo: { name: "rss-aggregator", version: "1.0.0" },
					},
				};
			}

			return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${rpc.method}` } };
		},
	},
};
