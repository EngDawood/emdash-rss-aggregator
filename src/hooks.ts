import type { PluginContext } from "emdash";
import type { Display, Agent } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import {
	loadSettings,
	sources,
	feedItems,
	displays,
	agents,
	models,
	outputProfiles,
	rejectList,
	importLogs,
	folders,
	generateId,
} from "./utils.js";
import { fetchAllPendingSources } from "./feed-fetcher.js";

/** Example agents seeded on install so users have working starting points. */
const SEED_AGENTS: Array<Pick<Agent, "kind" | "name" | "instructions" | "locales">> = [
	{
		kind: "summary",
		name: "TL;DR Summary",
		instructions:
			"You are an editorial assistant. Produce a concise TL;DR summary of about 50 words. " +
			"Return plain text only, with no preamble, labels, markdown, or quotation marks.",
	},
	{
		kind: "rewrite",
		name: "Rewrite in House Voice",
		instructions:
			"You are a skilled writer. Rewrite the supplied article as ORIGINAL content in a clear, neutral editorial voice. " +
			"Preserve all facts faithfully. Do not copy phrasing from the source. " +
			"Format the rewritten content using clean semantic HTML tags (such as <p>, <h3>, <strong>, <ul>, and <li>) as appropriate for rich text formatting. " +
			"Return ONLY the HTML body with no preamble, commentary, or markdown code fences (like ```html).",
	},
	{
		kind: "translate",
		name: "Translate",
		instructions:
			"You are a professional translator. Translate each provided field faithfully, preserving meaning and tone.",
		locales: "",
	},
];

export const hooks = {
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
				readMoreText: "Read more »",
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

			// Seed example agents (no model/profile — a model needs a real key + passing test).
			for (const seed of SEED_AGENTS) {
				const agent: Agent = { ...seed, createdAt: now, updatedAt: now };
				await agents(ctx).put(generateId("agt"), agent);
			}

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
					agents(ctx),
					models(ctx),
					outputProfiles(ctx),
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
					if ((settings as any).maxItemAgeUnit === "hours") {
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
};
