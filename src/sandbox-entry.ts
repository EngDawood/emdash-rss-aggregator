/**
 * emdash-rss-aggregator
 *
 * Plugin definition — runs at request time on the deployed server.
 * Contains all hooks, routes, and admin configuration.
 */

import { definePlugin, PluginRouteError } from "emdash";
import type {
	PluginContext,
	StorageCollection,
	RouteContext,
} from "emdash";
import type {
	Source,
	FeedItem,
	Display,
	RejectListEntry,
	ImportLog,
	Folder,
	PluginSettings,
	PluginStats,
	PaginatedResponse,
	CreateSourceInput,
	UpdateSourceInput,
	CreateDisplayInput,
	UpdateDisplayInput,
} from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { fetchAndImportFeed, fetchAllPendingSources } from "./feed-fetcher.js";
import { parseFeed } from "./feed-parser.js";

// ── Helper: Load settings from KV ─────────────────────────────────────

async function loadSettings(ctx: PluginContext): Promise<PluginSettings> {
	const entries = await ctx.kv.list("settings:");
	const settings = { ...DEFAULT_SETTINGS };
	for (const { key, value } of entries) {
		const field = key.replace("settings:", "") as keyof PluginSettings;
		if (field in settings) {
			(settings as Record<string, unknown>)[field] = value;
		}
	}
	return settings;
}

// ── Helper: Generate ID ────────────────────────────────────────────────

function generateId(prefix: string = ""): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

// ── Helper: Typed storage accessors ────────────────────────────────────

function sources(ctx: PluginContext): StorageCollection<Source> {
	return ctx.storage.sources as StorageCollection<Source>;
}

function feedItems(ctx: PluginContext): StorageCollection<FeedItem> {
	return ctx.storage.feedItems as StorageCollection<FeedItem>;
}

function displays(ctx: PluginContext): StorageCollection<Display> {
	return ctx.storage.displays as StorageCollection<Display>;
}

function rejectList(ctx: PluginContext): StorageCollection<RejectListEntry> {
	return ctx.storage.rejectList as StorageCollection<RejectListEntry>;
}

function importLogs(ctx: PluginContext): StorageCollection<ImportLog> {
	return ctx.storage.importLogs as StorageCollection<ImportLog>;
}

function folders(ctx: PluginContext): StorageCollection<Folder> {
	return ctx.storage.folders as StorageCollection<Folder>;
}

// ── Plugin Definition ──────────────────────────────────────────────────

export function createPlugin() {
	return definePlugin({
	id: "rss-aggregator",
	version: "1.0.0",
	capabilities: [
		"read:content",
		"write:content",
		"read:media",
		"write:media",
		"network:fetch",
	],
	allowedHosts: ["*"],

	storage: {
		sources: {
			indexes: ["status", "tag", "createdAt", ["status", "nextFetchAt"]],
		},
		feedItems: {
			indexes: [
				"sourceId",
				"guid",
				"publishedAt",
				["sourceId", "publishedAt"],
				["sourceId", "guid"],
			],
		},
		displays: { indexes: ["name"] },
		rejectList: { indexes: ["guid", "sourceId", "createdAt"] },
		importLogs: {
			indexes: ["sourceId", "status", "createdAt", ["sourceId", "createdAt"]],
		},
		folders: { indexes: ["slug", "name"] },
	},

	admin: {
		entry: "emdash-rss-aggregator/admin",
		pages: [
			{ path: "/sources", label: "Feed Sources", icon: "rss" },
			{ path: "/items", label: "Feed Items", icon: "list" },
			{ path: "/displays", label: "Displays", icon: "layout" },
			{ path: "/logs", label: "Import Log", icon: "file-text" },
			{ path: "/settings", label: "Settings", icon: "settings" },
		],
		widgets: [{ id: "rss-stats", title: "RSS Aggregator", size: "half" }],

		portableTextBlocks: [
			{
				type: "rssFeedEmbed",
				label: "RSS Feed",
				icon: "rss" as any,
				description: "Embed an aggregated RSS feed display",
				fields: [
					{
						type: "text_input",
						action_id: "id",
						label: "Display ID",
						placeholder: "Enter display ID or leave blank for default",
					},
					{
						type: "number_input",
						action_id: "limit",
						label: "Max Items",
						min: 1,
						max: 100,
					},
				],
			},
			{
				type: "rssFeedSource",
				label: "Feed Source",
				icon: "link-external" as any,
				description: "Embed items from a specific feed source",
				fields: [
					{
						type: "text_input",
						action_id: "id",
						label: "Source ID",
						placeholder: "Enter the feed source ID",
					},
					{
						type: "number_input",
						action_id: "limit",
						label: "Max Items",
						min: 1,
						max: 50,
					},
				],
			},
		],

		settingsSchema: {
			globalFetchInterval: {
				type: "number",
				label: "Default Fetch Interval (minutes)",
				description: "How often to check feeds for new items. Per-source override available.",
				default: 60,
				min: 5,
				max: 10080,
			},
			maxItemsPerSource: {
				type: "number",
				label: "Max Items Per Source",
				description: "Maximum items to keep per source. Oldest are deleted first.",
				default: 200,
				min: 10,
				max: 5000,
			},
			maxItemAge: {
				type: "number",
				label: "Max Item Age (days)",
				description: "Delete items older than this. 0 = keep forever.",
				default: 0,
				min: 0,
				max: 365,
			},
			defaultUniqueBy: {
				type: "select",
				label: "Duplicate Detection",
				options: [
					{ value: "guid", label: "By GUID (recommended)" },
					{ value: "title", label: "By Title" },
				],
				default: "guid",
			},
			defaultReconcileStrategy: {
				type: "select",
				label: "Existing Items",
				description: "When a duplicate is found, preserve existing or overwrite.",
				options: [
					{ value: "preserve", label: "Preserve existing" },
					{ value: "overwrite", label: "Overwrite with new data" },
				],
				default: "preserve",
			},
			defaultOpenInNewTab: {
				type: "boolean",
				label: "Open Links in New Tab",
				default: true,
			},
			defaultNofollow: {
				type: "boolean",
				label: "Add nofollow to Links",
				default: true,
			},
			enableCustomFeed: {
				type: "boolean",
				label: "Enable Outgoing RSS Feed",
				description: "Serve aggregated items as RSS at the public API endpoint.",
				default: false,
			},
			customFeedTitle: {
				type: "string",
				label: "Outgoing Feed Title",
				default: "Aggregated Feed",
			},
			customFeedLimit: {
				type: "number",
				label: "Outgoing Feed Item Limit",
				default: 50,
				min: 1,
				max: 500,
			},
			logRetentionDays: {
				type: "number",
				label: "Import Log Retention (days)",
				description: "Delete import logs older than this. 0 = keep forever.",
				default: 30,
				min: 0,
				max: 365,
			},
			contentCollection: {
				type: "string",
				label: "Content Collection",
				description: "EmDash collection for imported feed items.",
				default: "feed-items",
			},
			enableFeedToPost: {
				type: "boolean",
				label: "Enable Feed-to-Post",
				description: "Convert feed items into regular content entries (e.g., posts).",
				default: false,
			},
			userAgent: {
				type: "string",
				label: "User Agent",
				description: "HTTP User-Agent header sent when fetching feeds.",
				default: "EmDash RSS Aggregator/1.0",
			},
			fetchTimeout: {
				type: "number",
				label: "Fetch Timeout (ms)",
				description: "Timeout for HTTP requests when fetching feeds.",
				default: 30000,
				min: 5000,
				max: 120000,
			},
		},
	},

	// ── Hooks ────────────────────────────────────────────────────────────

	hooks: {
		"plugin:install": {
			handler: async (_event: any, ctx: PluginContext) => {
				ctx.log.info("Installing RSS Aggregator plugin");

				// Seed default settings
				for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
					await ctx.kv.set(`settings:${key}`, value);
				}

				// Create default display
				const now = new Date().toISOString();
				const defaultDisplay: Display = {
					name: "Default",
					sources: [],
					excludeSources: [],
					tags: [],
					layout: "list",
					numItems: 15,
					enablePagination: true,
					paginationStyle: "load-more",
					enableTitles: true,
					titleMaxLength: 0,
					linkTitles: true,
					enableSources: true,
					sourcePrefix: "Source:",
					linkSource: true,
					enableDates: true,
					datePrefix: "",
					dateFormat: "MMMM d, yyyy",
					useRelativeDate: true,
					enableAuthors: false,
					authorPrefix: "By",
					linkTarget: "_blank",
					linksNoFollow: true,
					linkToEmbeds: false,
					enableExcerpts: false,
					excerptMaxWords: 55,
					excerptEllipsis: "...",
					enableReadMore: false,
					readMoreText: "Read more \u00BB",
					enableImages: false,
					linkImages: true,
					fallbackToSourceImage: false,
					gridMaxColumns: 3,
					gridUseImageAsBg: false,
					gridFitImages: true,
					gridEnableEmbeds: false,
					enableAudioPlayer: false,
					audioPlayerPosition: "before",
					enableBullets: true,
					bulletStyle: "disc",
					createdAt: now,
					updatedAt: now,
				};
				await displays(ctx).put("default", defaultDisplay);

				ctx.log.info("RSS Aggregator installed successfully");
			},
		},

		"plugin:activate": {
			handler: async (_event: any, ctx: PluginContext) => {
				ctx.log.info("Activating RSS Aggregator");

				// Schedule the global feed fetch cron (every 15 minutes to check pending sources)
				await ctx.cron!.schedule("fetch-pending-sources", {
					schedule: "*/15 * * * *",
				});

				// Schedule log cleanup (daily at 3 AM)
				await ctx.cron!.schedule("cleanup-old-logs", {
					schedule: "0 3 * * *",
				});

				// Schedule old items cleanup (daily at 4 AM)
				await ctx.cron!.schedule("cleanup-old-items", {
					schedule: "0 4 * * *",
				});

				ctx.log.info("RSS Aggregator activated — cron jobs scheduled");
			},
		},

		"plugin:deactivate": {
			handler: async (_event: any, ctx: PluginContext) => {
				ctx.log.info("Deactivating RSS Aggregator");
				await ctx.cron!.cancel("fetch-pending-sources");
				await ctx.cron!.cancel("cleanup-old-logs");
				await ctx.cron!.cancel("cleanup-old-items");
				ctx.log.info("RSS Aggregator deactivated — cron jobs cancelled");
			},
		},

		"plugin:uninstall": {
			handler: async (event: { deleteData: boolean }, ctx: PluginContext) => {
				if (event.deleteData) {
					ctx.log.info("Uninstalling RSS Aggregator — deleting all data");

					// Delete all storage collections
					const collections = [
						sources(ctx),
						feedItems(ctx),
						displays(ctx),
						rejectList(ctx),
						importLogs(ctx),
						folders(ctx),
					];

					for (const collection of collections) {
						let cursor: string | undefined;
						do {
							const result = await collection.query({ limit: 1000, cursor });
							if (result.items.length > 0) {
								await collection.deleteMany(result.items.map((i) => i.id));
							}
							cursor = result.cursor;
						} while (cursor);
					}

					// Delete all KV entries
					const kvEntries = await ctx.kv.list();
					for (const entry of kvEntries) {
						await ctx.kv.delete(entry.key);
					}

					ctx.log.info("RSS Aggregator data deleted");
				}
			},
		},

		cron: {
			handler: async (event: { name: string }, ctx: PluginContext) => {
				const settings = await loadSettings(ctx);

				if (event.name === "fetch-pending-sources") {
					ctx.log.info("Cron: Fetching pending sources");
					const logs = await fetchAllPendingSources(ctx, settings);
					ctx.log.info(`Cron: Processed ${logs.length} sources`, {
						success: logs.filter((l) => l.status === "success").length,
						errors: logs.filter((l) => l.status === "error").length,
					});
				}

				if (event.name === "cleanup-old-logs") {
					if (settings.logRetentionDays > 0) {
						const cutoff = new Date();
						cutoff.setDate(cutoff.getDate() - settings.logRetentionDays);
						const cutoffStr = cutoff.toISOString();

						const oldLogs = await importLogs(ctx).query({
							where: { createdAt: { lt: cutoffStr } } as any,
							limit: 1000,
						});

						if (oldLogs.items.length > 0) {
							await importLogs(ctx).deleteMany(oldLogs.items.map((l) => l.id));
							ctx.log.info(`Cleaned up ${oldLogs.items.length} old import logs`);
						}
					}
				}

				if (event.name === "cleanup-old-items") {
					if (settings.maxItemAge > 0) {
						const cutoff = new Date();
						if (settings.maxItemAgeUnit === "hours") {
							cutoff.setHours(cutoff.getHours() - settings.maxItemAge);
						} else {
							cutoff.setDate(cutoff.getDate() - settings.maxItemAge);
						}
						const cutoffStr = cutoff.toISOString();

						const oldItems = await feedItems(ctx).query({
							where: { publishedAt: { lt: cutoffStr } } as any,
							limit: 1000,
						});

						if (oldItems.items.length > 0) {
							await feedItems(ctx).deleteMany(oldItems.items.map((i) => i.id));
							ctx.log.info(`Cleaned up ${oldItems.items.length} old feed items`);
						}
					}
				}
			},
		},
	},

	// ── Routes ───────────────────────────────────────────────────────────

	routes: {
		// ── Sources CRUD ─────────────────────────────────────────────────

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
					ageLimitUnit: input.ageLimitUnit ?? settings.maxItemAgeUnit,
					uniqueBy: input.uniqueBy ?? settings.defaultUniqueBy,
					reconcileStrategy: input.reconcileStrategy ?? settings.defaultReconcileStrategy,
					trimContent: input.trimContent ?? false,
					contentMaxWords: input.contentMaxWords ?? 0,
					enableFullText: input.enableFullText ?? false,
					feedToPost: input.feedToPost ?? settings.enableFeedToPost,
					postCollection: input.postCollection ?? settings.defaultPostCollection,
					postStatus: input.postStatus ?? settings.defaultPostStatus,
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

		// ── Items ────────────────────────────────────────────────────────

		items: {
			handler: async (ctx: RouteContext) => {
				const url = new URL(ctx.request.url);
				const sourceId = url.searchParams.get("sourceId") || undefined;
				const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 100);
				const cursor = url.searchParams.get("cursor") || undefined;

				const where: Record<string, unknown> = {};
				if (sourceId) where.sourceId = sourceId;

				const result = await feedItems(ctx).query({
					where: Object.keys(where).length > 0 ? (where as any) : undefined,
					orderBy: { publishedAt: "desc" },
					limit,
					cursor,
				});

				const total = await feedItems(ctx).count(
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

		"items/delete": {
			handler: async (ctx: RouteContext) => {
				const { ids } = ctx.input as { ids: string[] };
				const deleted = await feedItems(ctx).deleteMany(ids);
				return { success: true, deleted };
			},
		},

		"items/reject": {
			handler: async (ctx: RouteContext) => {
				const { id, reason } = ctx.input as { id: string; reason?: string };
				const item = await feedItems(ctx).get(id);

				if (!item) {
					throw PluginRouteError.notFound(`Item "${id}" not found`);
				}

				// Add to reject list
				const entry: RejectListEntry = {
					guid: item.guid,
					sourceId: item.sourceId,
					title: item.title,
					url: item.url,
					reason: reason || "Manually rejected",
					createdAt: new Date().toISOString(),
				};
				await rejectList(ctx).put(generateId("rej"), entry);

				// Delete the item
				await feedItems(ctx).delete(id);

				return { success: true };
			},
		},

		// ── Displays CRUD ────────────────────────────────────────────────

		displays: {
			handler: async (ctx: RouteContext) => {
				if (ctx.request.method === "GET") {
					const result = await displays(ctx).query({
						orderBy: { name: "asc" } as any,
						limit: 100,
					});
					return {
						items: result.items.map((i) => ({ id: i.id, ...i.data })),
					};
				}
				return { items: [] };
			},
		},

		"displays/create": {
			handler: async (ctx: RouteContext) => {
				const input = ctx.input as CreateDisplayInput;
				const now = new Date().toISOString();
				const id = generateId("dsp");

				const display: Display = {
					...input,
					createdAt: now,
					updatedAt: now,
				};

				await displays(ctx).put(id, display);
				return { success: true, id, display };
			},
		},

		"displays/update": {
			handler: async (ctx: RouteContext) => {
				const { id, ...updates } = ctx.input as UpdateDisplayInput & { id: string };
				const existing = await displays(ctx).get(id);

				if (!existing) {
					throw PluginRouteError.notFound(`Display "${id}" not found`);
				}

				const updated: Display = {
					...existing,
					...updates,
					updatedAt: new Date().toISOString(),
				};

				await displays(ctx).put(id, updated);
				return { success: true, display: updated };
			},
		},

		"displays/delete": {
			handler: async (ctx: RouteContext) => {
				const { id } = ctx.input as { id: string };
				if (id === "default") {
					throw PluginRouteError.badRequest("Cannot delete the default display");
				}
				await displays(ctx).delete(id);
				return { success: true };
			},
		},

		// ── Reject List ──────────────────────────────────────────────────

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

		// ── Folders ──────────────────────────────────────────────────────

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

		// ── Import Logs ──────────────────────────────────────────────────

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

		// ── Settings ─────────────────────────────────────────────────────

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

		// ── Stats ────────────────────────────────────────────────────────

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

		// ── Public API ───────────────────────────────────────────────────

		"public/items": {
			public: true,
			handler: async (ctx: RouteContext) => {
				const url = new URL(ctx.request.url);
				const displayId = url.searchParams.get("display") || "default";
				const sourceId = url.searchParams.get("source") || undefined;
				const tag = url.searchParams.get("tag") || undefined;
				const limit = Math.min(parseInt(url.searchParams.get("limit") || "15", 10) || 15, 100);
				const cursor = url.searchParams.get("cursor") || undefined;

				// Load display config
				const display = await displays(ctx).get(displayId);
				const effectiveLimit = display ? display.numItems : limit;

				// Build query
				const where: Record<string, unknown> = {};

				if (sourceId) {
					where.sourceId = sourceId;
				} else if (display && display.sources.length > 0) {
					where.sourceId = { in: display.sources };
				}

				// If filtering by tag, get source IDs with that tag
				if (tag) {
					const taggedSources = await sources(ctx).query({
						where: { tag },
						limit: 1000,
					});
					const taggedIds = taggedSources.items.map((s) => s.id);
					if (taggedIds.length > 0) {
						where.sourceId = { in: taggedIds };
					} else {
						return { items: [], hasMore: false };
					}
				}

				const result = await feedItems(ctx).query({
					where: Object.keys(where).length > 0 ? (where as any) : undefined,
					orderBy: { publishedAt: "desc" },
					limit: Math.min(effectiveLimit, limit),
					cursor,
				});

				return {
					items: result.items.map((i) => ({
						id: i.id,
						...i.data,
					})),
					cursor: result.cursor,
					hasMore: result.hasMore,
					display: display
						? {
								layout: display.layout,
								enableTitles: display.enableTitles,
								enableDates: display.enableDates,
								enableExcerpts: display.enableExcerpts,
								enableImages: display.enableImages,
								enableSources: display.enableSources,
								enableAuthors: display.enableAuthors,
								linkTarget: display.linkTarget,
								linksNoFollow: display.linksNoFollow,
							}
						: undefined,
				};
			},
		},

		"public/feed.xml": {
			public: true,
			handler: async (ctx: RouteContext) => {
				const settings = await loadSettings(ctx);

				if (!settings.enableCustomFeed) {
					throw PluginRouteError.notFound("Outgoing RSS feed is not enabled");
				}

				const result = await feedItems(ctx).query({
					orderBy: { publishedAt: "desc" },
					limit: settings.customFeedLimit,
				});

				const items = result.items.map((i) => i.data);

				if (settings.customFeedFormat === "atom") {
					return buildAtomFeed(settings, items);
				}
				return buildRssFeed(settings, items);
			},
		},

		// ── Feed validation ──────────────────────────────────────────────

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
	},
});
}

export default createPlugin;

// ── RSS/Atom Output Builders ──────────────────────────────────────────

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function buildRssFeed(settings: PluginSettings, items: FeedItem[]): Response {
	const now = new Date().toUTCString();
	let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
	xml += `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n`;
	xml += `<channel>\n`;
	xml += `  <title>${escapeXml(settings.customFeedTitle)}</title>\n`;
	xml += `  <description>Aggregated RSS Feed</description>\n`;
	xml += `  <lastBuildDate>${now}</lastBuildDate>\n`;
	xml += `  <generator>EmDash RSS Aggregator</generator>\n`;

	for (const item of items) {
		xml += `  <item>\n`;
		xml += `    <title>${escapeXml(item.title)}</title>\n`;
		xml += `    <link>${escapeXml(item.url)}</link>\n`;
		xml += `    <guid isPermaLink="false">${escapeXml(item.guid)}</guid>\n`;
		if (item.content || item.excerpt) {
			xml += `    <description><![CDATA[${item.excerpt || item.content || ""}]]></description>\n`;
		}
		if (item.author?.name) {
			xml += `    <author>${escapeXml(item.author.email || "")} (${escapeXml(item.author.name)})</author>\n`;
		}
		xml += `    <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>\n`;
		if (item.sourceName) {
			xml += `    <source url="${escapeXml(item.sourceUrl || "")}">${escapeXml(item.sourceName)}</source>\n`;
		}
		if (item.enclosure) {
			xml += `    <enclosure url="${escapeXml(item.enclosure.url)}" type="${escapeXml(item.enclosure.type || "")}" length="${item.enclosure.length || 0}" />\n`;
		}
		if (item.categories) {
			for (const cat of item.categories) {
				xml += `    <category>${escapeXml(cat)}</category>\n`;
			}
		}
		xml += `  </item>\n`;
	}

	xml += `</channel>\n</rss>`;

	return new Response(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=900",
		},
	});
}

function buildAtomFeed(settings: PluginSettings, items: FeedItem[]): Response {
	const now = new Date().toISOString();
	let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
	xml += `<feed xmlns="http://www.w3.org/2005/Atom">\n`;
	xml += `  <title>${escapeXml(settings.customFeedTitle)}</title>\n`;
	xml += `  <updated>${now}</updated>\n`;
	xml += `  <id>urn:emdash:rss-aggregator:feed</id>\n`;
	xml += `  <generator>EmDash RSS Aggregator</generator>\n`;

	for (const item of items) {
		xml += `  <entry>\n`;
		xml += `    <title>${escapeXml(item.title)}</title>\n`;
		xml += `    <link href="${escapeXml(item.url)}" />\n`;
		xml += `    <id>${escapeXml(item.guid)}</id>\n`;
		xml += `    <updated>${item.publishedAt}</updated>\n`;
		if (item.content || item.excerpt) {
			xml += `    <summary type="html"><![CDATA[${item.excerpt || item.content || ""}]]></summary>\n`;
		}
		if (item.author?.name) {
			xml += `    <author><name>${escapeXml(item.author.name)}</name>`;
			if (item.author.email) xml += `<email>${escapeXml(item.author.email)}</email>`;
			xml += `</author>\n`;
		}
		if (item.categories) {
			for (const cat of item.categories) {
				xml += `    <category term="${escapeXml(cat)}" />\n`;
			}
		}
		xml += `  </entry>\n`;
	}

	xml += `</feed>`;

	return new Response(xml, {
		headers: {
			"Content-Type": "application/atom+xml; charset=utf-8",
			"Cache-Control": "public, max-age=900",
		},
	});
}
