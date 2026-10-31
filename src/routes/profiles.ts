import type { RouteContext } from "emdash";
import { PluginRouteError } from "emdash";
import type { OutputProfile, CreateOutputProfileInput, UpdateOutputProfileInput, FieldToken } from "../types.js";
import { FIELD_TOKENS, RESERVED_PAYLOAD_KEYS } from "../types.js";
import { outputProfiles, generateId } from "../utils.js";

const FIELD_SLUG_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A fieldMap key becomes a literal SQL column, so reject anything that is not
 * a plain identifier here rather than letting it fail at insert time.
 */
function validateFieldMap(fieldMap: unknown): void {
	if (fieldMap === undefined || fieldMap === null) return;
	if (typeof fieldMap !== "object" || Array.isArray(fieldMap)) {
		throw PluginRouteError.badRequest("fieldMap must be an object of { field: token }");
	}
	for (const [field, token] of Object.entries(fieldMap as Record<string, unknown>)) {
		if (!FIELD_SLUG_RE.test(field)) {
			throw PluginRouteError.badRequest(`Invalid field name "${field}" in fieldMap; use letters, digits and underscores`);
		}
		if (RESERVED_PAYLOAD_KEYS.has(field)) {
			throw PluginRouteError.badRequest(`"${field}" is set by the publisher and cannot be mapped`);
		}
		if (!FIELD_TOKENS.includes(token as FieldToken)) {
			throw PluginRouteError.badRequest(`Unknown token "${String(token)}" for field "${field}"; expected one of: ${FIELD_TOKENS.join(", ")}`);
		}
	}
}

export const profileRoutes = {
	"output-profiles": {
		handler: async (ctx: RouteContext) => {
			const result = await outputProfiles(ctx).query({
				orderBy: { createdAt: "desc" } as any,
				limit: 200,
			});
			return {
				items: result.items.map((i) => ({ id: i.id, ...i.data })),
			};
		},
	},

	"output-profiles/create": {
		handler: async (ctx: RouteContext) => {
			const input = ctx.input as CreateOutputProfileInput;

			if (!input.name?.trim()) {
				throw PluginRouteError.badRequest("Output profile name is required");
			}
			if (input.mode !== "internal" && input.mode !== "publish") {
				throw PluginRouteError.badRequest(`Invalid mode "${input.mode}"; must be "internal" or "publish"`);
			}
			if (input.mode === "publish" && !input.collection?.trim()) {
				throw PluginRouteError.badRequest("collection is required when mode is \"publish\"");
			}
			validateFieldMap(input.fieldMap);

			const now = new Date().toISOString();
			const id = generateId("opf");

			const profile: OutputProfile = {
				...input,
				createdAt: now,
				updatedAt: now,
			};

			await outputProfiles(ctx).put(id, profile);
			return { success: true, id, profile };
		},
	},

	"output-profiles/update": {
		handler: async (ctx: RouteContext) => {
			const { id, ...updates } = ctx.input as UpdateOutputProfileInput & { id: string };

			const existing = await outputProfiles(ctx).get(id);
			if (!existing) {
				throw PluginRouteError.notFound(`Output profile "${id}" not found`);
			}

			if (updates.mode !== undefined && updates.mode !== "internal" && updates.mode !== "publish") {
				throw PluginRouteError.badRequest(`Invalid mode "${updates.mode}"; must be "internal" or "publish"`);
			}

			const effectiveMode = updates.mode ?? existing.mode;
			if (effectiveMode === "publish") {
				const effectiveCollection = updates.collection ?? existing.collection;
				if (!effectiveCollection?.trim()) {
					throw PluginRouteError.badRequest("collection is required when mode is \"publish\"");
				}
			}
			validateFieldMap(updates.fieldMap);

			const updated: OutputProfile = {
				...existing,
				...updates,
				updatedAt: new Date().toISOString(),
			};

			await outputProfiles(ctx).put(id, updated);
			return { success: true, profile: updated };
		},
	},

	"output-profiles/delete": {
		handler: async (ctx: RouteContext) => {
			const { id } = ctx.input as { id: string };
			await outputProfiles(ctx).delete(id);
			return { success: true };
		},
	},
};
