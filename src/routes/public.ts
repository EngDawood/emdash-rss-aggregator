import type { RouteContext } from "emdash";
import { PluginRouteError } from "emdash";
import { loadSettings, feedItems, displays, sources } from "../utils.js";
import { buildRssFeed, buildAtomFeed } from "../feed-builder.js";

export const publicRoutes = {
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
};
