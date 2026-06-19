/**
 * @dawod/emdash-rss-aggregator
 *
 * Plugin descriptor factory — imported in `astro.config.mjs` at build time.
 * This file must be side-effect-free.
 */

import type { PluginDescriptor } from "emdash";

export interface RssAggregatorOptions {
	/** Override the content collection name for feed items. Default: "feed-items" */
	contentCollection?: string;
	/** Override the default fetch interval in minutes. Default: 60 */
	fetchInterval?: number;
	/** Enable Feed-to-Post by default. Default: false */
	feedToPost?: boolean;
	/** Default post collection for Feed-to-Post. Default: "posts" */
	postCollection?: string;
}

/**
 * RSS Aggregator plugin descriptor factory.
 *
 * Usage in `astro.config.mjs`:
 * ```ts
 * import { rssAggregatorPlugin } from "@dawod/emdash-rss-aggregator";
 *
 * export default defineConfig({
 *   integrations: [
 *     emdash({
 *       plugins: [rssAggregatorPlugin()],
 *     }),
 *   ],
 * });
 * ```
 */
export function rssAggregatorPlugin(options: RssAggregatorOptions = {}): PluginDescriptor {
	return {
		id: "rss-aggregator",
		version: "1.0.0",
		entrypoint: "@dawod/emdash-rss-aggregator/sandbox",
		componentsEntry: "@dawod/emdash-rss-aggregator/astro",
		adminEntry: "@dawod/emdash-rss-aggregator/admin",
		options: options as any,
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
				indexes: [
					"status",
					"tag",
					"createdAt",
					["status", "nextFetchAt"],
				],
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
			displays: {
				indexes: ["name"],
			},
			rejectList: {
				indexes: ["guid", "sourceId", "createdAt"],
			},
			importLogs: {
				indexes: [
					"sourceId",
					"status",
					"createdAt",
					["sourceId", "createdAt"],
				],
			},
			folders: {
				indexes: ["slug", "name"],
			},
		},
		adminPages: [
			{ path: "/sources", label: "Feed Sources", icon: "rss" },
			{ path: "/items", label: "Feed Items", icon: "list" },
			{ path: "/displays", label: "Displays", icon: "layout" },
			{ path: "/logs", label: "Import Log", icon: "file-text" },
			{ path: "/settings", label: "Settings", icon: "settings" },
		],
		adminWidgets: [
			{ id: "rss-stats", title: "RSS Aggregator", size: "half" },
		],
	};
}
