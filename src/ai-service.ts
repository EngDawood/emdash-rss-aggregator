/**
 * @dawod/emdash-rss-aggregator
 *
 * AI Content Suite: model resolution, agent dispatch, and a KV-backed monthly
 * credit ledger backed by OpenAI-compatible chat-completions over HTTP.
 *
 * Cloudflare Workers runtime only — no Node.js APIs. Every exported function is
 * defensive and never throws out to the caller: on any failure it resolves with
 * an `ok: false` result so the import pipeline keeps working when AI is down.
 */

import type { PluginContext } from "emdash";
import type { PluginSettings, FeedItem, Agent, AgentKind, ItemTranslation, CreditState, Model } from "./types.js";

// ── Constants ──────────────────────────────────────────────────────────

const KV_CREDIT_LIMIT = "credits:limit";
const KV_CREDIT_USED = "credits:used";
const KV_CREDIT_PERIOD = "credits:period";

/** Maximum characters of input content forwarded to the model. */
const MAX_INPUT_CHARS = 6000;

// ── Local helpers ──────────────────────────────────────────────────────

/** Current accounting period in "YYYY-MM" form. */
function currentPeriod(): string {
	const now = new Date();
	const year = now.getUTCFullYear();
	const month = String(now.getUTCMonth() + 1).padStart(2, "0");
	return `${year}-${month}`;
}

/** Strip HTML tags and collapse whitespace to keep prompts lean. */
function stripHtml(s: string): string {
	if (!s) return "";
	return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Strip-and-truncate input content to keep prompts within budget. */
function leanInput(s: string): string {
	const text = stripHtml(s);
	return text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
}

// ── Credit ledger ──────────────────────────────────────────────────────

/**
 * Reads the credit ledger from KV, rolling over to a fresh period when the
 * stored period is missing or stale. Never throws.
 */
export async function getCreditState(ctx: PluginContext, settings: PluginSettings): Promise<CreditState> {
	const period = currentPeriod();

	let storedLimit: number | null = null;
	let storedUsed: number | null = null;
	let storedPeriod: string | null = null;

	try {
		storedLimit = await ctx.kv.get<number>(KV_CREDIT_LIMIT);
		storedUsed = await ctx.kv.get<number>(KV_CREDIT_USED);
		storedPeriod = await ctx.kv.get<string>(KV_CREDIT_PERIOD);
	} catch (err) {
		ctx.log.warn("Failed to read credit ledger from KV", { error: String(err) });
	}

	const limit = typeof storedLimit === "number" ? storedLimit : settings.aiCreditMonthlyLimit;

	// Roll over when the period is missing or stale.
	if (storedPeriod !== period) {
		try {
			await ctx.kv.set(KV_CREDIT_USED, 0);
			await ctx.kv.set(KV_CREDIT_PERIOD, period);
		} catch (err) {
			ctx.log.warn("Failed to roll over credit period", { error: String(err) });
		}
		return { limit, used: 0, period };
	}

	const used = typeof storedUsed === "number" ? storedUsed : 0;
	return { limit, used, period };
}

/**
 * Atomically (best-effort) consumes `amount` credits. Returns ok:false without
 * incrementing when the limit would be exceeded.
 */
export async function consumeCredits(
	ctx: PluginContext,
	settings: PluginSettings,
	amount: number,
): Promise<{ ok: boolean; state: CreditState }> {
	const state = await getCreditState(ctx, settings);

	if (state.limit > 0 && state.used + amount > state.limit) {
		return { ok: false, state };
	}

	const used = state.used + amount;
	try {
		await ctx.kv.set(KV_CREDIT_USED, used);
	} catch (err) {
		ctx.log.warn("Failed to persist consumed credits", { error: String(err) });
	}

	return { ok: true, state: { ...state, used } };
}

/** Persists a new monthly credit limit and returns the refreshed state. */
export async function setCreditLimit(ctx: PluginContext, limit: number): Promise<CreditState> {
	try {
		await ctx.kv.set(KV_CREDIT_LIMIT, limit);
	} catch (err) {
		ctx.log.warn("Failed to persist credit limit", { error: String(err) });
	}
	return getCreditState(ctx, { aiCreditMonthlyLimit: limit } as PluginSettings);
}

/** Resets the consumed credit counter to 0 for the current period. */
export async function resetCredits(ctx: PluginContext): Promise<CreditState> {
	const period = currentPeriod();
	let limit = 0;
	try {
		const storedLimit = await ctx.kv.get<number>(KV_CREDIT_LIMIT);
		limit = typeof storedLimit === "number" ? storedLimit : 0;
		await ctx.kv.set(KV_CREDIT_USED, 0);
		await ctx.kv.set(KV_CREDIT_PERIOD, period);
	} catch (err) {
		ctx.log.warn("Failed to reset credits", { error: String(err) });
	}
	return { limit, used: 0, period };
}

/**
 * Pre-flight credit gate: returns an error string when the limit is already
 * exhausted, otherwise null. Reads but does not consume.
 */
async function creditGate(ctx: PluginContext, settings: PluginSettings): Promise<string | null> {
	const state = await getCreditState(ctx, settings);
	if (state.limit > 0 && state.used >= state.limit) {
		return "AI credit limit reached";
	}
	return null;
}

// ── Model resolution ───────────────────────────────────────────────────

/**
 * A fully-resolved model ready for calling: endpoint + the assembled model string
 * + credentials loaded from KV, plus any custom headers. In gateway mode the
 * provider key may be absent (BYOK on the gateway) and a gateway token may apply.
 */
export interface ResolvedModel {
	id: string;
	endpoint: string;
	/** The exact `model` value to send in the request body (already prefixed in gateway mode). */
	modelId: string;
	headers?: Record<string, string>;
	apiKey?: string;
	gatewayToken?: string;
}

/**
 * Builds the `model` value sent in the request body. Gateway mode prefixes the
 * provider slug (`provider/modelId`); direct mode sends the bare modelId.
 */
export function resolveModelString(record: { mode?: string; provider?: string; modelId: string }): string {
	if (record.mode === "gateway" && record.provider?.trim()) {
		return `${record.provider.trim()}/${record.modelId}`;
	}
	return record.modelId;
}

/** KV key for a model's API secret. */
function modelSecretKey(id: string): string {
	return `model-secret:${id}`;
}

/** KV key for a model's Cloudflare AI Gateway token (cf-aig-authorization). */
function modelGatewaySecretKey(id: string): string {
	return `model-gateway-secret:${id}`;
}

/** Stores an API key for the given model ID in KV. Never throws. */
export async function setModelSecret(ctx: PluginContext, id: string, apiKey: string): Promise<void> {
	try {
		await ctx.kv.set(modelSecretKey(id), apiKey);
	} catch (err) {
		ctx.log.warn("Failed to set model secret", { id, error: String(err) });
	}
}

/** Retrieves the API key for the given model ID from KV, or null if absent. Never throws. */
export async function getModelSecret(ctx: PluginContext, id: string): Promise<string | null> {
	try {
		return await ctx.kv.get<string>(modelSecretKey(id));
	} catch (err) {
		ctx.log.warn("Failed to get model secret", { id, error: String(err) });
		return null;
	}
}

/** Removes the API key for the given model ID from KV. Never throws. */
export async function deleteModelSecret(ctx: PluginContext, id: string): Promise<void> {
	try {
		await ctx.kv.delete(modelSecretKey(id));
	} catch (err) {
		ctx.log.warn("Failed to delete model secret", { id, error: String(err) });
	}
}

/** Stores a gateway token (cf-aig-authorization) for the given model ID in KV. Never throws. */
export async function setModelGatewaySecret(ctx: PluginContext, id: string, token: string): Promise<void> {
	try {
		await ctx.kv.set(modelGatewaySecretKey(id), token);
	} catch (err) {
		ctx.log.warn("Failed to set model gateway secret", { id, error: String(err) });
	}
}

/** Retrieves the gateway token for the given model ID from KV, or null if absent. Never throws. */
export async function getModelGatewaySecret(ctx: PluginContext, id: string): Promise<string | null> {
	try {
		return await ctx.kv.get<string>(modelGatewaySecretKey(id));
	} catch (err) {
		ctx.log.warn("Failed to get model gateway secret", { id, error: String(err) });
		return null;
	}
}

/** Removes the gateway token for the given model ID from KV. Never throws. */
export async function deleteModelGatewaySecret(ctx: PluginContext, id: string): Promise<void> {
	try {
		await ctx.kv.delete(modelGatewaySecretKey(id));
	} catch (err) {
		ctx.log.warn("Failed to delete model gateway secret", { id, error: String(err) });
	}
}

/**
 * Loads a saved model record from storage and its API key from KV, returning a
 * ready-to-call ResolvedModel, or null when the record or key is missing.
 * Never throws.
 */
export async function resolveModel(ctx: PluginContext, modelId: string): Promise<ResolvedModel | null> {
	try {
		const record = await ctx.storage.models.get(modelId) as Model | null;
		if (!record) return null;

		const apiKey = await getModelSecret(ctx, modelId);
		// Direct mode requires a provider key; gateway mode allows BYOK (key on the gateway).
		if (!apiKey && record.mode !== "gateway") return null;

		const gatewayToken = record.mode === "gateway" ? await getModelGatewaySecret(ctx, modelId) : null;

		return {
			id: modelId,
			endpoint: record.endpoint,
			modelId: resolveModelString(record),
			headers: record.headers,
			apiKey: apiKey ?? undefined,
			gatewayToken: gatewayToken ?? undefined,
		};
	} catch (err) {
		ctx.log.warn("Failed to resolve model", { modelId, error: String(err) });
		return null;
	}
}

// ── HTTP chat call ─────────────────────────────────────────────────────

/**
 * Generic OpenAI-compatible chat-completion call against a ResolvedModel.
 * Never throws — all failure modes return { ok:false, error }.
 */
export async function callChat(
	ctx: PluginContext,
	model: ResolvedModel,
	system: string,
	user: string,
	opts?: { temperature?: number; maxTokens?: number },
): Promise<{ ok: boolean; text?: string; error?: string }> {
	try {
		const body: Record<string, unknown> = {
			model: model.modelId,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
			temperature: opts?.temperature ?? 0.4,
		};
		if (opts?.maxTokens) {
			body.max_tokens = opts.maxTokens;
		}

		const doFetch = ctx.http?.fetch ?? fetch;
		const response = await doFetch(model.endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...model.headers,
				...(model.apiKey ? { "Authorization": `Bearer ${model.apiKey}` } : {}),
				...(model.gatewayToken ? { "cf-aig-authorization": `Bearer ${model.gatewayToken}` } : {}),
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			return { ok: false, error: `AI HTTP ${response.status}` };
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const text = data.choices?.[0]?.message?.content?.trim();
		if (!text) {
			return { ok: false, error: "Empty AI response" };
		}

		return { ok: true, text };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

// ── Connection test ────────────────────────────────────────────────────

/**
 * Live connection test against a candidate model configuration. Sends a single
 * "ping" message with max_tokens:1 and passes on HTTP 200 + non-empty response.
 * Bypasses the credit ledger. Never throws.
 */
export async function testModelConnection(
	ctx: PluginContext,
	candidate: { endpoint: string; modelId: string; apiKey?: string; gatewayToken?: string; headers?: Record<string, string> },
): Promise<{ ok: boolean; status?: number; error?: string }> {
	try {
		const doFetch = ctx.http?.fetch ?? fetch;
		const response = await doFetch(candidate.endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...candidate.headers,
				...(candidate.apiKey ? { "Authorization": `Bearer ${candidate.apiKey}` } : {}),
				...(candidate.gatewayToken ? { "cf-aig-authorization": `Bearer ${candidate.gatewayToken}` } : {}),
			},
			body: JSON.stringify({
				model: candidate.modelId,
				messages: [{ role: "user", content: "ping" }],
				max_tokens: 1,
			}),
			signal: AbortSignal.timeout(30000),
		});

		const status = response.status;

		if (!response.ok) {
			return { ok: false, status, error: `HTTP ${status}` };
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const text = data.choices?.[0]?.message?.content?.trim();
		if (!text) {
			return { ok: false, status, error: "Empty AI response" };
		}

		return { ok: true, status };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

// ── Agent dispatch ─────────────────────────────────────────────────────

/**
 * Runs a single agent on one feed item, dispatching by kind. Consumes 1 credit
 * per successful operation (translate: 1 per locale). Never throws.
 *
 * - summary/rewrite/custom → value: string
 * - translate → value: Record<string, ItemTranslation> (keyed by locale)
 */
export async function runAgent(
	ctx: PluginContext,
	settings: PluginSettings,
	model: ResolvedModel,
	agent: Agent,
	item: FeedItem,
): Promise<{ ok: boolean; kind: AgentKind; value?: string | Record<string, ItemTranslation>; error?: string; creditsUsed: number }> {
	const userMessage = `Title: ${item.title}\n\nContent:\n${leanInput(item.content || "")}`;
	const temperature = agent.temperature ?? 0.4;

	if (agent.kind === "summary" || agent.kind === "rewrite" || agent.kind === "custom") {
		const result = await callChat(ctx, model, agent.instructions, userMessage, { temperature });
		if (!result.ok || !result.text) {
			return { ok: false, kind: agent.kind, error: result.error || "Empty AI response", creditsUsed: 0 };
		}

		const credit = await consumeCredits(ctx, settings, 1);
		if (!credit.ok) {
			return { ok: false, kind: agent.kind, error: "AI credit limit reached", creditsUsed: 0 };
		}

		return { ok: true, kind: agent.kind, value: result.text.trim(), creditsUsed: 1 };
	}

	if (agent.kind === "translate") {
		const rawLocales = agent.locales || "";
		const locales = rawLocales.split(",").map((l) => l.trim()).filter(Boolean);

		if (locales.length === 0) {
			return { ok: true, kind: "translate", value: {}, creditsUsed: 0 };
		}

		// Build the fields object from the item — same logic as the old translate().
		const fields: Record<string, string> = {};
		if (typeof item.title === "string" && item.title) fields.title = stripHtml(item.title);
		if (typeof item.excerpt === "string" && item.excerpt) fields.excerpt = stripHtml(item.excerpt);
		if (typeof item.content === "string" && item.content) fields.content = leanInput(item.content);
		if (typeof item.summary === "string" && item.summary) fields.summary = stripHtml(item.summary);

		const providedKeys = Object.keys(fields);

		const translations: Record<string, ItemTranslation> = {};
		let creditsUsed = 0;

		for (const locale of locales) {
			if (providedKeys.length === 0) {
				translations[locale] = { translatedAt: new Date().toISOString() };
				continue;
			}

			const system =
				`You are a professional translator. Translate the provided fields into the language identified by ` +
				`the BCP-47 locale "${locale}". Return a STRICT JSON object containing ONLY these keys: ` +
				`${providedKeys.join(", ")}. Each value is the translated text. ` +
				`Do not add other keys, commentary, or markdown fences.`;
			const userMsg = JSON.stringify(fields);

			const result = await callChat(ctx, model, system, userMsg, { temperature });
			if (!result.ok || !result.text) {
				ctx.log.warn("Translate agent failed for locale", { locale, error: result.error });
				continue;
			}

			// Strip optional ```json … ``` fences before parsing.
			let raw = result.text.trim();
			const fenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
			if (fenceMatch) raw = fenceMatch[1].trim();

			const translation: ItemTranslation = { translatedAt: new Date().toISOString() };
			try {
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				if (typeof parsed.title === "string") translation.title = parsed.title;
				if (typeof parsed.excerpt === "string") translation.excerpt = parsed.excerpt;
				if (typeof parsed.content === "string") translation.content = parsed.content;
				if (typeof parsed.summary === "string") translation.summary = parsed.summary;
			} catch {
				// Parse failure — treat the whole response as content.
				translation.content = raw;
			}

			const credit = await consumeCredits(ctx, settings, 1);
			if (!credit.ok) {
				ctx.log.warn("Credit limit reached mid-translate; stopping", { locale });
				break;
			}

			translations[locale] = translation;
			creditsUsed += 1;
		}

		return { ok: true, kind: "translate", value: translations, creditsUsed };
	}

	return { ok: false, kind: agent.kind as AgentKind, error: `Unknown agent kind: ${agent.kind}`, creditsUsed: 0 };
}

// ── Orchestrator ───────────────────────────────────────────────────────

/**
 * Orchestrator used by both the import pipeline and the on-demand route.
 * Returns a Partial<FeedItem> with only the produced fields set:
 * summary?, rewrittenContent?, aiOutputs?, translations?, aiProcessedAt?
 *
 * Returns {} (empty) when AI is disabled, no modelId/agentIds supplied, the
 * model cannot be resolved, or the credit ledger is exhausted. Never throws.
 */
export async function applyAgents(
	ctx: PluginContext,
	settings: PluginSettings,
	opts: { item: FeedItem; modelId?: string; agentIds?: string[] },
): Promise<Partial<FeedItem>> {
	if (!settings.aiEnabled || !opts.modelId || !opts.agentIds?.length) {
		return {};
	}

	const model = await resolveModel(ctx, opts.modelId);
	if (!model) {
		ctx.log.warn("applyAgents: could not resolve model", { modelId: opts.modelId });
		return {};
	}

	// Pre-flight credit gate.
	const blocked = await creditGate(ctx, settings);
	if (blocked) {
		ctx.log.warn("applyAgents: credit gate blocked", { reason: blocked });
		return {};
	}

	const out: Partial<FeedItem> = {};

	for (const agentId of opts.agentIds) {
		try {
			const agent = (await ctx.storage.agents.get(agentId)) as Agent | null;
			if (!agent) {
				ctx.log.warn("applyAgents: agent not found, skipping", { agentId });
				continue;
			}

			const result = await runAgent(ctx, settings, model, agent, opts.item);

			if (!result.ok) {
				ctx.log.warn("applyAgents: agent failed", { agentId, kind: agent.kind, error: result.error });
				continue;
			}

			switch (result.kind) {
				case "summary":
					out.summary = result.value as string;
					break;
				case "rewrite":
					out.rewrittenContent = result.value as string;
					break;
				case "custom":
					out.aiOutputs = { ...out.aiOutputs, [agentId]: result.value as string };
					break;
				case "translate": {
					const localeMap = result.value as Record<string, ItemTranslation>;
					out.translations = { ...out.translations, ...localeMap };
					break;
				}
			}
		} catch (err) {
			ctx.log.warn("applyAgents: unexpected error in agent loop", { agentId, error: String(err) });
		}
	}

	// Only stamp the timestamp when at least one field was produced.
	const produced =
		out.summary !== undefined ||
		out.rewrittenContent !== undefined ||
		out.aiOutputs !== undefined ||
		out.translations !== undefined;

	if (produced) {
		out.aiProcessedAt = new Date().toISOString();
	}

	return out;
}
