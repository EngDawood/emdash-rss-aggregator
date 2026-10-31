import type { RouteContext } from "emdash";
import { PluginRouteError } from "emdash";
import type { Display, CreateDisplayInput, UpdateDisplayInput } from "../types.js";
import { displays, generateId } from "../utils.js";

export const displayRoutes = {
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
};
