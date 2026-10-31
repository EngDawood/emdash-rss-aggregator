/**
 * Output publisher for the RSS Aggregator plugin.
 * Builds content-entry payloads from Output Profiles and publishes them via ctx.content.
 * No Node APIs — safe for Cloudflare Workers runtime.
 */

import type { PluginContext } from "emdash";
import type { Source, FeedItem, OutputProfile, PluginSettings, Agent, FieldToken } from "./types.js";
import { RESERVED_PAYLOAD_KEYS } from "./types.js";
import { agents } from "./utils.js";
import { slugify, resolveTemplate } from "./template.js";
import { htmlToPortableText } from "./html-parser.js";

export interface PublishResult {
	action: "internal" | "created" | "updated" | "skipped";
	contentId?: string;
	error?: string;
}

/**
 * Used when a profile declares no fieldMap. Matches the shape EmDash seeds for
 * `posts`, which is the only collection layout we can assume exists.
 */
export const DEFAULT_FIELD_MAP: Record<string, FieldToken> = {
	content: "body",
	excerpt: "excerpt",
};

/**
 * Pure: build the content-entry payload from a profile + item + source.
 * `outputsByAgentName` maps each custom agent's NAME to its produced text,
 * making it available as `{output.<agentName>}` in the footer template.
 *
 * The returned object contains ONLY keys that are safe to write: the payload
 * keys EmDash consumes itself (`slug`, `status`, `publishedAt`, `seo`), the
 * always-present `title`, and whatever the profile's fieldMap names. Every
 * other key would become a literal SQL column — see the note on
 * `OutputProfile.fieldMap`.
 */
export function buildPublishPayload(opts: {
	source: Source;
	item: FeedItem;
	profile: OutputProfile;
	outputsByAgentName?: Record<string, string>;
}): Record<string, unknown> {
	const { source, item, profile, outputsByAgentName = {} } = opts;

	// ── Slug ──────────────────────────────────────────────────────────────
	const sourceSlug = source.slug || slugify(source.name);
	const itemSlug = slugify(item.title);
	const slug = resolveTemplate(profile.slugPattern || "{itemSlug}", { itemSlug, sourceSlug });

	// ── Body ──────────────────────────────────────────────────────────────
	let body: string;
	switch (profile.bodySource) {
		case "rewrite":
			body = item.rewrittenContent ?? item.content ?? "";
			break;
		case "summary":
			body = item.summary ?? item.content ?? "";
			break;
		case "original":
		default:
			body = item.content ?? "";
			break;
	}

	// ── Footer ────────────────────────────────────────────────────────────
	const agentTokens: Record<string, string> = {};
	for (const [name, text] of Object.entries(outputsByAgentName)) {
		agentTokens[`output.${name}`] = text;
	}

	const footerTokens: Record<string, string> = {
		sourceName: source.name,
		sourceUrl: source.url,
		originalUrl: item.url,
		originalTitle: item.title,
		author: item.author?.name ?? "",
		publishedAt: item.publishedAt,
		summary: item.summary ?? "",
		sourceSlug,
		itemSlug,
		...agentTokens,
	};

	const footer = profile.footerTemplate
		? resolveTemplate(profile.footerTemplate, footerTokens)
		: "";

	const finalBody = body + (footer ? "\n" + footer : "");

	// ── Excerpt ───────────────────────────────────────────────────────────
	let excerpt: string | undefined;
	switch (profile.excerptSource) {
		case "summary":
			excerpt = item.summary;
			break;
		case "original":
			excerpt = item.excerpt;
			break;
		case "none":
		default:
			excerpt = undefined;
			break;
	}

	// ── SEO ───────────────────────────────────────────────────────────────
	// EmDash splits `seo` out of the payload before touching columns, so it is
	// always safe to send regardless of the target collection's fields.
	const seo = {
		title: item.title,
		description: excerpt ?? item.summary ?? item.excerpt ?? "",
		image: item.imageUrl ?? null,
		canonical: item.url ?? null,
		noIndex: false,
	};

	// ── Payload ───────────────────────────────────────────────────────────
	const payload: Record<string, unknown> = {
		title: item.title,
		slug,
		status: profile.status,
		publishedAt: item.publishedAt,
		seo,
	};

	const fieldMap =
		profile.fieldMap && Object.keys(profile.fieldMap).length > 0
			? profile.fieldMap
			: DEFAULT_FIELD_MAP;

	for (const [field, token] of Object.entries(fieldMap)) {
		if (RESERVED_PAYLOAD_KEYS.has(field)) continue;
		const value = resolveFieldToken(token, field, { source, item, finalBody, excerpt });
		if (value !== undefined) payload[field] = value;
	}

	return payload;
}

/** Pure: produce the value a single mapped field should receive. */
function resolveFieldToken(
	token: FieldToken,
	field: string,
	v: { source: Source; item: FeedItem; finalBody: string; excerpt: string | undefined },
): unknown {
	switch (token) {
		case "body":
			return htmlToPortableText(v.finalBody);
		case "summary":
			return v.item.summary === undefined ? undefined : htmlToPortableText(v.item.summary);
		case "excerpt":
			return v.excerpt;
		case "url":
			return v.item.url;
		case "image":
			return v.item.imageUrl;
		case "publishedAt":
			return v.item.publishedAt;
		case "author":
			return v.item.author?.name;
		case "sourceName":
			return v.source.name;
		case "customField":
			return v.item.customFields?.[field];
		default:
			return undefined;
	}
}

/**
 * Categories are configurable on a profile but cannot be written from here:
 * `ctx.taxonomies` is read-only and `ctx.content.create` has no term handling.
 * Say so once per isolate rather than dropping them in silence.
 */
let categoryNoticeLogged = false;

function noteUnassignableCategories(ctx: PluginContext, profile: OutputProfile): void {
	if (categoryNoticeLogged) return;
	const wanted = (profile.defaultCategories?.length ?? 0) > 0 || profile.mapFeedCategories !== false;
	if (!wanted) return;
	categoryNoticeLogged = true;
	ctx.log.info(
		"Categories are configured on an output profile but cannot be assigned: EmDash exposes no plugin-facing taxonomy write API. Published entries will have no terms.",
		{ profile: profile.name, collection: profile.collection },
	);
}

/**
 * Create or update a content entry, stripping unknown columns as a last
 * resort so one bad field cannot lose the whole entry.
 *
 * This is a safety net, not the mechanism: a correct `fieldMap` should never
 * reach it. Anything it strips is logged, because a silent strip is how the
 * jobs profile lost every write for six weeks.
 */
export async function writeContentEntry(
	ctx: PluginContext,
	collection: string,
	payload: Record<string, unknown>,
	existingId?: string,
): Promise<{ contentId?: string; created: boolean }> {
	// Without these the entry is meaningless, so a failure on them is fatal.
	const required = new Set(["title", "slug"]);
	let cur = { ...payload };
	const stripped = new Set<string>();

	while (true) {
		try {
			if (existingId) {
				await ctx.content!.update!(collection, existingId, cur);
				return { contentId: existingId, created: false };
			}
			const entry = await ctx.content!.create!(collection, cur);
			return { contentId: entry?.id, created: true };
		} catch (err) {
			const errMsg = String(err);
			const match =
				errMsg.match(/has no column named ([a-zA-Z0-9_]+)/i) ||
				errMsg.match(/no such column:?\s*(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)/i);
			const field = match?.[1];

			if (!field || required.has(field) || stripped.has(field) || !(field in cur)) {
				throw err;
			}

			stripped.add(field);
			delete cur[field];
			ctx.log.warn("Dropped a field the target collection has no column for", {
				collection,
				field,
				hint: "Remove it from the output profile's field map, or add the field to the collection.",
			});
		}
	}
}

/**
 * Resolve custom-agent outputs for the source, build the payload, then
 * create or update the content entry via ctx.content.
 *
 * Never throws — returns `{ action: "skipped", error }` on any failure.
 */
export async function publishItem(
	ctx: PluginContext,
	settings: PluginSettings,
	opts: {
		source: Source;
		item: FeedItem;
		profile: OutputProfile | null;
		existingContentId?: string;
	},
): Promise<PublishResult> {
	const { source, item, profile, existingContentId } = opts;

	// Internal mode or no profile → nothing to publish.
	if (!profile || profile.mode === "internal") {
		return { action: "internal" };
	}

	try {
		// ── Resolve custom-agent outputs ──────────────────────────────────
		const outputsByAgentName: Record<string, string> = {};
		for (const agentId of source.aiAgentIds ?? []) {
			const agent = (await agents(ctx).get(agentId)) as Agent | null;
			if (!agent) continue;
			const produced = item.aiOutputs?.[agentId];
			if (produced !== undefined) {
				outputsByAgentName[agent.name] = produced;
			}
		}

		const payload = buildPublishPayload({ source, item, profile, outputsByAgentName });

		// ── Guard: content API must be available ──────────────────────────
		if (!ctx.content?.create || !ctx.content?.update) {
			return { action: "skipped", error: "no content write access" };
		}

		noteUnassignableCategories(ctx, profile);

		// ── Create or update ──────────────────────────────────────────────
		const written = await writeContentEntry(ctx, profile.collection, payload, existingContentId);
		const contentId = written.contentId;
		const action: "created" | "updated" = written.created ? "created" : "updated";

		if (contentId && profile.status === "published" && (ctx.content as any).publish) {
			try {
				await (ctx.content as any).publish(profile.collection, contentId, { publishedAt: item.publishedAt });
			} catch (pubErr) {
				ctx.log.warn("Failed to set live published revision", { contentId, error: String(pubErr) });
			}
		}

		return { action, contentId };

	} catch (err) {
		ctx.log.warn("publishItem failed", { sourceId: item.sourceId, guid: item.guid, error: String(err) });
		return { action: "skipped", error: String(err) };
	}
}
