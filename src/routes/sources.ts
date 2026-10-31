import type { RouteContext } from "emdash";
import { PluginRouteError } from "emdash";
import type { Source, Agent, AgentKind, CreateSourceInput, UpdateSourceInput, ImportLog } from "../types.js";
import { loadSettings, sources, agents, importLogs, feedItems, rejectList, generateId } from "../utils.js";
import { parseFeed } from "../feed-parser.js";
import { fetchAndImportFeed } from "../feed-fetcher.js";

/**
 * Validates that a feed's selected agents include at most one per fixed kind
 * (summary / rewrite / translate). Multiple `custom` agents are allowed.
 * Throws PluginRouteError.badRequest on conflict.
 */
async function validateAgentSelection(ctx: RouteContext, agentIds?: string[]): Promise<void> {
	if (!agentIds || agentIds.length === 0) return;
	const seen = new Set<AgentKind>();
	for (const agentId of agentIds) {
		const agent = (await agents(ctx).get(agentId)) as Agent | null;
		if (!agent) continue;
		if (agent.kind === "custom") continue;
		if (seen.has(agent.kind)) {
			throw PluginRouteError.badRequest(`A feed may use at most one ${agent.kind} agent`);
		}
		seen.add(agent.kind);
	}
}

export const sourceRoutes = {
	sources: {
		handler: async (ctx: RouteContext) => {
			const url = new URL(ctx.request.url);
			const status = url.searchParams.get("status") || undefined;
			const tag = url.searchParams.get("tag") || undefined;
			const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 100);
			const cursor = url.searchParams.get("cursor") || undefined;

			const where: Record<string, unknown> = {};
			if (status) where.status = status;
			if (tag) where.tag = tag;

			const result = await sources(ctx).query({
				where: Object.keys(where).length > 0 ? (where as any) : undefined,
				orderBy: { createdAt: "desc" },
				limit,
				cursor,
			});

			const total = await sources(ctx).count(
				Object.keys(where).length > 0 ? (where as any) : undefined,
			);

			return {
				items: result.items.map((i) => ({ id: i.id, ...i.data })),
				cursor: result.cursor,
				hasMore: result.hasMore,
				total,
			};
		},
	},

	"sources/create": {
		handler: async (ctx: RouteContext) => {
			const input = ctx.input as CreateSourceInput;
			const settings = await loadSettings(ctx);
			await validateAgentSelection(ctx, input.aiAgentIds);
			const now = new Date().toISOString();
			const id = generateId("src");

			// Try to fetch the feed to validate URL and get title
			let feedTitle = input.name || "";
			let siteUrl = input.siteUrl;

			if (ctx.http) {
				try {
					const response = await ctx.http.fetch(input.url, {
						headers: { "User-Agent": settings.userAgent },
						signal: AbortSignal.timeout(settings.fetchTimeout),
					});
					const xml = await response.text();
					const parsed = parseFeed(xml);
					if (!feedTitle) feedTitle = parsed.title;
					if (!siteUrl) siteUrl = parsed.link;
				} catch (err) {
					ctx.log.warn("Could not validate feed URL", { url: input.url, error: String(err) });
				}
			}

			const source: Source = {
				name: feedTitle || input.url,
				url: input.url,
				siteUrl,
				status: input.status || "active",
				tag: input.tag,
				importLimit: input.importLimit ?? settings.maxItemsPerSource,
				importOrder: input.importOrder ?? "desc",
				ageLimit: input.ageLimit ?? settings.maxItemAge,
				ageLimitUnit: input.ageLimitUnit ?? (settings as any).maxItemAgeUnit,
				uniqueBy: input.uniqueBy ?? settings.defaultUniqueBy,
				reconcileStrategy: input.reconcileStrategy ?? settings.defaultReconcileStrategy,
				trimContent: input.trimContent ?? false,
				contentMaxWords: input.contentMaxWords ?? 0,
				enableFullText: input.enableFullText ?? false,
				// AI pipeline bindings + output
				aiModelId: input.aiModelId,
				aiAgentIds: input.aiAgentIds ?? [],
				slug: input.slug,
				outputProfileId: input.outputProfileId,
				keywordFilterEnabled: input.keywordFilterEnabled ?? false,
				keywordFilterMode: input.keywordFilterMode ?? "include",
				keywords: input.keywords ?? [],
				keywordMatchIn: input.keywordMatchIn ?? ["title", "content"],
				authorHandling: input.authorHandling ?? "from-feed",
				fallbackAuthor: input.fallbackAuthor,
				overrideAuthor: input.overrideAuthor,
				assignFeaturedImage: input.assignFeaturedImage ?? true,
				featuredImageSource: input.featuredImageSource ?? "first-in-content",
				openInNewTab: input.openInNewTab ?? settings.defaultOpenInNewTab,
				nofollow: input.nofollow ?? settings.defaultNofollow,
				canonicalLink: input.canonicalLink ?? false,
				fetchInterval: input.fetchInterval ?? settings.globalFetchInterval,
				nextFetchAt: now,
				itemCount: 0,
				futureActivateAt: input.futureActivateAt,
				futurePauseAt: input.futurePauseAt,
				createdAt: now,
				updatedAt: now,
			};

			await sources(ctx).put(id, source);
			ctx.log.info("Created feed source", { id, url: source.url });

			return { success: true, id, source };
		},
	},

	"sources/update": {
		handler: async (ctx: RouteContext) => {
			const { id, ...updates } = ctx.input as UpdateSourceInput & { id: string };
			const existing = await sources(ctx).get(id);

			if (!existing) {
				throw PluginRouteError.notFound(`Source "${id}" not found`);
			}

			if (updates.aiAgentIds !== undefined) {
				await validateAgentSelection(ctx, updates.aiAgentIds);
			}

			const updated: Source = {
				...existing,
				...updates,
				updatedAt: new Date().toISOString(),
			};

			await sources(ctx).put(id, updated);
			ctx.log.info("Updated feed source", { id });

			return { success: true, source: updated };
		},
	},

	"sources/delete": {
		handler: async (ctx: RouteContext) => {
			const { id } = ctx.input as { id: string };

			const existing = await sources(ctx).get(id);
			if (!existing) {
				throw PluginRouteError.notFound(`Source "${id}" not found`);
			}

			// Delete all items for this source
			let cursor: string | undefined;
			let deletedItems = 0;
			do {
				const items = await feedItems(ctx).query({
					where: { sourceId: id },
					limit: 1000,
					cursor,
				});
				if (items.items.length > 0) {
					await feedItems(ctx).deleteMany(items.items.map((i) => i.id));
					deletedItems += items.items.length;
				}
				cursor = items.cursor;
			} while (cursor);

			// Delete all logs for this source
			cursor = undefined;
			do {
				const logs = await importLogs(ctx).query({
					where: { sourceId: id },
					limit: 1000,
					cursor,
				});
				if (logs.items.length > 0) {
					await importLogs(ctx).deleteMany(logs.items.map((l) => l.id));
				}
				cursor = logs.cursor;
			} while (cursor);

			// Delete reject list entries for this source
			cursor = undefined;
			do {
				const entries = await rejectList(ctx).query({
					where: { sourceId: id },
					limit: 1000,
					cursor,
				});
				if (entries.items.length > 0) {
					await rejectList(ctx).deleteMany(entries.items.map((e) => e.id));
				}
				cursor = entries.cursor;
			} while (cursor);

			// Delete the source itself
			await sources(ctx).delete(id);
			ctx.log.info("Deleted feed source", { id, deletedItems });

			return { success: true, deletedItems };
		},
	},

	"sources/fetch-now": {
		handler: async (ctx: RouteContext) => {
			const { id } = ctx.input as { id: string };
			const source = await sources(ctx).get(id);

			if (!source) {
				throw PluginRouteError.notFound(`Source "${id}" not found`);
			}

			const settings = await loadSettings(ctx);
			const log = await fetchAndImportFeed(source, ctx, settings, id);

			return { success: true, log };
		},
	},

	"sources/fetch-all": {
		handler: async (ctx: RouteContext) => {
			const settings = await loadSettings(ctx);

			// Get all active sources
			const result = await sources(ctx).query({
				where: { status: "active" },
				limit: 1000,
			});

			const logs: ImportLog[] = [];
			for (const item of result.items) {
				try {
					const log = await fetchAndImportFeed(item.data, ctx, settings, item.id);
					logs.push(log);
				} catch (err) {
					ctx.log.error("Error fetching source", { id: item.id, error: String(err) });
				}
			}

			return {
				success: true,
				processed: logs.length,
				succeeded: logs.filter((l) => l.status === "success").length,
				failed: logs.filter((l) => l.status === "error").length,
			};
		},
	},

	"sources/preview": {
		handler: async (ctx: RouteContext) => {
			const { url } = ctx.input as { url: string };
			if (!url) {
				throw PluginRouteError.badRequest("URL is required");
			}
			if (!url.startsWith("http://") && !url.startsWith("https://")) {
				throw PluginRouteError.badRequest("URL must start with http:// or https://");
			}

			const settings = await loadSettings(ctx);
			if (!ctx.http) {
				throw PluginRouteError.internal("HTTP fetch capability is not available");
			}

			const response = await ctx.http.fetch(url, {
				headers: { "User-Agent": settings.userAgent },
				signal: AbortSignal.timeout(settings.fetchTimeout),
			});
			const xml = await response.text();
			const parsed = parseFeed(xml);

			return {
				success: true,
				feed: {
					title: parsed.title || "Untitled Feed",
					link: parsed.link || url,
					description: parsed.description || "",
					format: parsed.format,
					itemCount: parsed.items.length,
				},
				items: parsed.items.slice(0, 10).map((item) => ({
					guid: item.guid || item.link,
					title: item.title || "Untitled Item",
					link: item.link,
					pubDate: item.pubDate,
					author: item.author,
					description: item.description,
				})),
			};
		},
	},
};
