import type { RouteContext } from "emdash";
import { PluginRouteError } from "emdash";
import type { Agent, CreateAgentInput, UpdateAgentInput } from "../types.js";
import { agents, generateId } from "../utils.js";

const VALID_KINDS = ["summary", "rewrite", "translate", "custom"] as const;

export const agentRoutes = {
	agents: {
		handler: async (ctx: RouteContext) => {
			const result = await agents(ctx).query({
				orderBy: { createdAt: "desc" } as any,
				limit: 200,
			});
			return {
				items: result.items.map((i) => ({ id: i.id, ...i.data })),
			};
		},
	},

	"agents/create": {
		handler: async (ctx: RouteContext) => {
			const input = ctx.input as CreateAgentInput;

			if (!VALID_KINDS.includes(input.kind as any)) {
				throw PluginRouteError.badRequest(`Invalid kind "${input.kind}"; must be one of: ${VALID_KINDS.join(", ")}`);
			}
			if (!input.name?.trim()) {
				throw PluginRouteError.badRequest("Agent name is required");
			}
			if (!input.instructions?.trim()) {
				throw PluginRouteError.badRequest("Agent instructions are required");
			}

			const now = new Date().toISOString();
			const id = generateId("agt");

			const agent: Agent = {
				...input,
				createdAt: now,
				updatedAt: now,
			};

			await agents(ctx).put(id, agent);
			return { success: true, id, agent };
		},
	},

	"agents/update": {
		handler: async (ctx: RouteContext) => {
			const { id, ...updates } = ctx.input as UpdateAgentInput & { id: string };

			const existing = await agents(ctx).get(id);
			if (!existing) {
				throw PluginRouteError.notFound(`Agent "${id}" not found`);
			}

			if (updates.kind !== undefined && !VALID_KINDS.includes(updates.kind as any)) {
				throw PluginRouteError.badRequest(`Invalid kind "${updates.kind}"; must be one of: ${VALID_KINDS.join(", ")}`);
			}

			const updated: Agent = {
				...existing,
				...updates,
				updatedAt: new Date().toISOString(),
			};

			await agents(ctx).put(id, updated);
			return { success: true, agent: updated };
		},
	},

	"agents/delete": {
		handler: async (ctx: RouteContext) => {
			const { id } = ctx.input as { id: string };
			await agents(ctx).delete(id);
			return { success: true };
		},
	},
};
