/**
 * @dawod/emdash-rss-aggregator
 *
 * Plugin definition — runs at request time on the deployed server.
 * Contains all hooks, routes, and admin configuration.
 */

import { definePlugin } from "emdash";
import { storageConfig } from "./storage-config.js";
import { settingsSchema, portableTextBlocks, adminPages, adminWidgets } from "./admin-config.js";
import { hooks } from "./hooks.js";
import { sourceRoutes } from "./routes/sources.js";
import { itemRoutes } from "./routes/items.js";
import { displayRoutes } from "./routes/displays.js";
import { modelRoutes } from "./routes/models.js";
import { agentRoutes } from "./routes/agents.js";
import { profileRoutes } from "./routes/profiles.js";
import { miscRoutes } from "./routes/misc.js";
import { publicRoutes } from "./routes/public.js";
import { mcpRoutes } from "./routes/mcp.js";

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

		storage: storageConfig,

		admin: {
			entry: "@dawod/emdash-rss-aggregator/admin",
			pages: adminPages,
			widgets: adminWidgets,
			portableTextBlocks: portableTextBlocks as any,
			settingsSchema: settingsSchema as any,
		},

		hooks,

		routes: {
			...sourceRoutes,
			...itemRoutes,
			...displayRoutes,
			...modelRoutes,
			...agentRoutes,
			...profileRoutes,
			...miscRoutes,
			...publicRoutes,
			...mcpRoutes,
		},
	});
}

export default createPlugin;
