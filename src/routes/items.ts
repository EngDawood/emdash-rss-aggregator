import type { RouteContext } from "emdash";
import { PluginRouteError } from "emdash";
import type { FeedItem, OutputProfile, CreditState, RejectListEntry } from "../types.js";
import { loadSettings, feedItems, sources, outputProfiles, rejectList, generateId } from "../utils.js";
import {
	getCreditState,
	setCreditLimit,
	resetCredits,
	applyAgents,
} from "../ai-service.js";
import { publishItem } from "../output.js";

export const itemRoutes = {
	items: {
		handler: async (ctx: RouteContext) => {
			const url = new URL(ctx.request.url);
			const sourceId = url.searchParams.get("sourceId") || undefined;
			const status = url.searchParams.get("status") || undefined;
			const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 100);
			const cursor = url.searchParams.get("cursor") || undefined;

			const where: Record<string, unknown> = {};
			if (sourceId) where.sourceId = sourceId;
			if (status) where.status = status;

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

	"items/approve": {
		handler: async (ctx: RouteContext) => {
			const { id } = ctx.input as { id: string };
			const item = await feedItems(ctx).get(id);
			if (!item) {
				throw PluginRouteError.notFound(`Item "${id}" not found`);
			}

			const now = new Date().toISOString();
			const updated: FeedItem = { ...item, status: "approved", approvedAt: now };
			await feedItems(ctx).put(id, updated);

			// Sync status to the linked content entry (best-effort)
			const settings = await loadSettings(ctx);
			const collectionName = settings.contentCollection || "feed-items";
			if (updated.contentId && ctx.content?.update) {
				try {
					await ctx.content.update(collectionName, updated.contentId, { status: "approved" });
				} catch (err) {
					ctx.log.warn("Failed to sync approval to content entry", { id, error: String(err) });
				}
			}

			// Publish the now-approved item via its source's output profile.
			const src = await sources(ctx).get(updated.sourceId);
			if (src?.outputProfileId) {
				const profile = (await outputProfiles(ctx).get(src.outputProfileId)) as OutputProfile | null;
				const result = await publishItem(ctx, settings, { source: src, item: updated, profile });
				if (result.action === "skipped") {
					ctx.log.warn("Publish on approval skipped", { id, error: result.error });
				}
			}

			return { success: true, item: updated };
		},
	},

	"items/ai": {
		handler: async (ctx: RouteContext) => {
			const { id, agentId, modelId } = ctx.input as {
				id: string;
				agentId?: string;
				modelId?: string;
			};
			const item = await feedItems(ctx).get(id);
			if (!item) {
				throw PluginRouteError.notFound(`Item "${id}" not found`);
			}

			const settings = await loadSettings(ctx);
			const source = await sources(ctx).get(item.sourceId);

			// Model: explicit override, else the feed's bound model.
			const effectiveModelId = modelId || source?.aiModelId;
			if (!effectiveModelId) {
				throw PluginRouteError.badRequest("No model available — assign a model to this feed or pass modelId");
			}

			// Agents: a single agent if given, else the feed's whole configured set.
			const agentIds = agentId ? [agentId] : source?.aiAgentIds ?? [];
			if (agentIds.length === 0) {
				throw PluginRouteError.badRequest("No agents to run — pass agentId or configure agents on the feed");
			}

			const produced = await applyAgents(ctx, settings, { item, modelId: effectiveModelId, agentIds });
			if (Object.keys(produced).length === 0) {
				throw PluginRouteError.internal(
					"AI produced no output (AI disabled, model unverified, or credit limit reached)",
				);
			}

			const updated: FeedItem = { ...item, ...produced };
			await feedItems(ctx).put(id, updated);

			// Best-effort sync to the linked feed-items content entry.
			const collectionName = settings.contentCollection || "feed-items";
			if (updated.contentId && ctx.content?.update) {
				try {
					await ctx.content.update(collectionName, updated.contentId, {
						summary: updated.summary,
						rewrittenContent: updated.rewrittenContent,
						translations: updated.translations,
						aiOutputs: updated.aiOutputs,
					});
				} catch (err) {
					ctx.log.warn("Failed to sync AI result to content entry", { id, error: String(err) });
				}
			}

			return { success: true, item: updated };
		},
	},

	"items/publish": {
		handler: async (ctx: RouteContext) => {
			const { id } = ctx.input as { id: string };
			const item = await feedItems(ctx).get(id);
			if (!item) {
				throw PluginRouteError.notFound(`Item "${id}" not found`);
			}

			const settings = await loadSettings(ctx);
			const src = await sources(ctx).get(item.sourceId);
			if (!src?.outputProfileId) {
				throw PluginRouteError.badRequest("No output profile configured for this feed source");
			}

			const profile = (await outputProfiles(ctx).get(src.outputProfileId)) as OutputProfile | null;
			if (!profile) {
				throw PluginRouteError.badRequest("The configured output profile was not found");
			}
			const result = await publishItem(ctx, settings, { source: src, item, profile });

			if (result.action === "skipped") {
				throw PluginRouteError.badRequest(`Publish skipped: ${result.error || "unknown reasons"}`);
			}

			// Update the item with the publishedContentId
			const now = new Date().toISOString();
			const updated: FeedItem = {
				...item,
				status: "approved",
				approvedAt: item.approvedAt || now,
				publishedContentId: result.contentId,
			};
			await feedItems(ctx).put(id, updated);

			// Best effort sync back to the feed-items collection entry
			const collectionName = settings.contentCollection || "feed-items";
			if (updated.contentId && ctx.content?.update) {
				try {
					await ctx.content.update(collectionName, updated.contentId, {
						status: "approved",
						publishedContentId: result.contentId,
					});
				} catch (err) {
					ctx.log.warn("Failed to sync publishedContentId to content entry", { id, error: String(err) });
				}
			}

			return { success: true, item: updated };
		},
	},

	credits: {
		handler: async (ctx: RouteContext) => {
			const settings = await loadSettings(ctx);
			return await getCreditState(ctx, settings);
		},
	},

	"credits/save": {
		handler: async (ctx: RouteContext) => {
			const { limit, reset } = ctx.input as { limit?: number; reset?: boolean };
			let state: CreditState;
			if (reset) {
				state = await resetCredits(ctx);
			} else if (typeof limit === "number") {
				state = await setCreditLimit(ctx, limit);
			} else {
				state = await getCreditState(ctx, await loadSettings(ctx));
			}
			return { success: true, state };
		},
	},
};
