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
		format: "native",
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
		// The descriptor declares single-field indexes only — the descriptor
		// type (StorageCollectionDeclaration) does not support composite
		// indexes. Composite indexes are declared on the runtime-authoritative
		// storage config in sandbox-entry.ts (the ResolvedPlugin returned by
		// createPlugin), which is what actually provisions indexes for this
		// native-format plugin.
		storage: {
			sources: {
				indexes: ["status", "tag", "createdAt"],
			},
			feedItems: {
				indexes: ["sourceId", "guid", "publishedAt"],
			},
			displays: {
				indexes: ["name"],
			},
			models: {
				indexes: ["createdAt"],
			},
			agents: {
				indexes: ["kind", "createdAt"],
			},
			outputProfiles: {
				indexes: ["createdAt"],
			},
			rejectList: {
				indexes: ["guid", "sourceId", "createdAt"],
			},
			importLogs: {
				indexes: ["sourceId", "status", "createdAt"],
			},
			folders: {
				indexes: ["slug", "name"],
			},
		},
		adminPages: [
			{ path: "/sources", label: "Feed Sources", icon: "rss" },
			{ path: "/items", label: "Feed Items", icon: "list" },
			{ path: "/reader", label: "Feed Reader", icon: "book-open" },
			{ path: "/displays", label: "Displays", icon: "layout" },
			{ path: "/ai", label: "AI", icon: "sparkles" },
			{ path: "/logs", label: "Import Log", icon: "file-text" },
			{ path: "/settings", label: "Settings", icon: "settings" },
		],
		adminWidgets: [
			{ id: "rss-stats", title: "RSS Aggregator", size: "half" },
		],
	};
}
