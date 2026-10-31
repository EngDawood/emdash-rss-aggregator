import type { RouteContext } from "emdash";
import { PluginRouteError } from "emdash";
import type { Folder, PluginSettings, PluginStats } from "../types.js";
import {
	loadSettings,
	sources,
	feedItems,
	rejectList,
	importLogs,
	folders,
	generateId,
} from "../utils.js";
import { parseFeed } from "../feed-parser.js";

export const miscRoutes = {
	// ── Reject List ──────────────────────────────────────────────────────

	"reject-list": {
		handler: async (ctx: RouteContext) => {
			const url = new URL(ctx.request.url);
			const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 100);
			const cursor = url.searchParams.get("cursor") || undefined;

			const result = await rejectList(ctx).query({
				orderBy: { createdAt: "desc" },
				limit,
				cursor,
			});

			return {
				items: result.items.map((i) => ({ id: i.id, ...i.data })),
				cursor: result.cursor,
				hasMore: result.hasMore,
			};
		},
	},

	"reject-list/remove": {
		handler: async (ctx: RouteContext) => {
			const { id } = ctx.input as { id: string };
			await rejectList(ctx).delete(id);
			return { success: true };
		},
	},

	// ── Folders ──────────────────────────────────────────────────────────

	folders: {
		handler: async (ctx: RouteContext) => {
			const result = await folders(ctx).query({ limit: 100 });
			return {
				items: result.items.map((i) => ({ id: i.id, ...i.data })),
			};
		},
	},

	"folders/create": {
		handler: async (ctx: RouteContext) => {
			const { name, sourceIds } = ctx.input as { name: string; sourceIds?: string[] };
			const now = new Date().toISOString();
			const id = generateId("fld");
			const slug = name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/(^-|-$)/g, "");

			const folder: Folder = {
				name,
				slug,
				sourceIds: sourceIds || [],
				createdAt: now,
				updatedAt: now,
			};

			await folders(ctx).put(id, folder);
			return { success: true, id, folder };
		},
	},

	"folders/update": {
		handler: async (ctx: RouteContext) => {
			const { id, ...updates } = ctx.input as Partial<Folder> & { id: string };
			const existing = await folders(ctx).get(id);

			if (!existing) {
				throw PluginRouteError.notFound(`Folder "${id}" not found`);
			}

			const updated: Folder = {
				...existing,
				...updates,
				updatedAt: new Date().toISOString(),
			};

			await folders(ctx).put(id, updated);
			return { success: true, folder: updated };
		},
	},

	"folders/delete": {
		handler: async (ctx: RouteContext) => {
			const { id } = ctx.input as { id: string };
			await folders(ctx).delete(id);
			return { success: true };
		},
	},

	// ── Import Logs ──────────────────────────────────────────────────────

	logs: {
		handler: async (ctx: RouteContext) => {
			const url = new URL(ctx.request.url);
			const sourceId = url.searchParams.get("sourceId") || undefined;
			const status = url.searchParams.get("status") || undefined;
			const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 100);
			const cursor = url.searchParams.get("cursor") || undefined;

			const where: Record<string, unknown> = {};
			if (sourceId) where.sourceId = sourceId;
			if (status) where.status = status;

			const result = await importLogs(ctx).query({
				where: Object.keys(where).length > 0 ? (where as any) : undefined,
				orderBy: { createdAt: "desc" },
				limit,
				cursor,
			});

			return {
				items: result.items.map((i) => ({ id: i.id, ...i.data })),
				cursor: result.cursor,
				hasMore: result.hasMore,
			};
		},
	},

	"logs/clear": {
		handler: async (ctx: RouteContext) => {
			const { sourceId } = ctx.input as { sourceId?: string };

			const where: Record<string, unknown> = {};
			if (sourceId) where.sourceId = sourceId;

			let deleted = 0;
			let cursor: string | undefined;
			do {
				const result = await importLogs(ctx).query({
					where: Object.keys(where).length > 0 ? (where as any) : undefined,
					limit: 1000,
					cursor,
				});
				if (result.items.length > 0) {
					await importLogs(ctx).deleteMany(result.items.map((l) => l.id));
					deleted += result.items.length;
				}
				cursor = result.cursor;
			} while (cursor);

			return { success: true, deleted };
		},
	},

	// ── Settings ─────────────────────────────────────────────────────────

	settings: {
		handler: async (ctx: RouteContext) => {
			return await loadSettings(ctx);
		},
	},

	"settings/save": {
		handler: async (ctx: RouteContext) => {
			const input = ctx.input as Partial<PluginSettings>;

			for (const [key, value] of Object.entries(input)) {
				if (value !== undefined) {
					await ctx.kv.set(`settings:${key}`, value);
				}
			}

			ctx.log.info("Settings saved", { keys: Object.keys(input) });
			return { success: true };
		},
	},

	// ── Stats ────────────────────────────────────────────────────────────

	stats: {
		handler: async (ctx: RouteContext) => {
			const totalSources = await sources(ctx).count();
			const activeSources = await sources(ctx).count({ status: "active" });
			const pausedSources = await sources(ctx).count({ status: "paused" });
			const errorSources = await sources(ctx).count({ status: "error" });
			const totalItems = await feedItems(ctx).count();

			// Items imported today
			const todayStart = new Date();
			todayStart.setHours(0, 0, 0, 0);
			const todayLogs = await importLogs(ctx).query({
				where: { createdAt: { gte: todayStart.toISOString() } } as any,
				limit: 1000,
			});
			const itemsToday = todayLogs.items.reduce(
				(sum, l) => sum + (l.data.itemsImported || 0),
				0,
			);

			// Last import
			const lastLogResult = await importLogs(ctx).query({
				orderBy: { createdAt: "desc" },
				limit: 1,
			});
			const lastLog = lastLogResult.items[0]?.data;

			const stats: PluginStats = {
				totalSources,
				activeSources,
				pausedSources,
				errorSources,
				totalItems,
				itemsToday,
				lastImportAt: lastLog?.createdAt,
				lastImportStatus: lastLog?.status,
			};

			return stats;
		},
	},

	// ── Feed validation ──────────────────────────────────────────────────

	"validate-feed": {
		handler: async (ctx: RouteContext) => {
			const { url } = ctx.input as { url: string };
			const settings = await loadSettings(ctx);

			if (!ctx.http) {
				throw PluginRouteError.internal(
					"Network access not available (network:fetch capability missing)",
				);
			}

			try {
				const response = await ctx.http.fetch(url, {
					headers: { "User-Agent": settings.userAgent },
					signal: AbortSignal.timeout(settings.fetchTimeout),
				});

				if (!response.ok) {
					return {
						valid: false,
						error: `HTTP ${response.status}: ${response.statusText}`,
					};
				}

				const xml = await response.text();
				const feed = parseFeed(xml);

				return {
					valid: true,
					title: feed.title,
					link: feed.link,
					description: feed.description,
					format: feed.format,
					itemCount: feed.items.length,
				};
			} catch (err) {
				return {
					valid: false,
					error: String(err),
				};
			}
		},
	},
};
