import type { RouteContext } from "emdash";
import { PluginRouteError } from "emdash";
import type { Model, CreateModelInput, UpdateModelInput } from "../types.js";
import { models, generateId } from "../utils.js";
import {
	testModelConnection,
	resolveModelString,
	setModelSecret,
	getModelSecret,
	deleteModelSecret,
	setModelGatewaySecret,
	getModelGatewaySecret,
	deleteModelGatewaySecret,
} from "../ai-service.js";

/** Normalizes a client-supplied test outcome to a stored status. */
function normalizeTestStatus(s: unknown): "ok" | "failed" | "untested" {
	return s === "ok" ? "ok" : s === "failed" ? "failed" : "untested";
}

export const modelRoutes = {
	models: {
		handler: async (ctx: RouteContext) => {
			const result = await models(ctx).query({
				orderBy: { createdAt: "desc" } as any,
				limit: 200,
			});
			return {
				items: result.items.map((i) => ({ id: i.id, ...i.data })),
			};
		},
	},

	"models/create": {
		handler: async (ctx: RouteContext) => {
			const input = ctx.input as CreateModelInput & { apiKey?: string; gatewayToken?: string };

			if (!input.name?.trim()) {
				throw PluginRouteError.badRequest("Model name is required");
			}
			if (!input.endpoint?.trim()) {
				throw PluginRouteError.badRequest("Model endpoint is required");
			}
			if (!input.modelId?.trim()) {
				throw PluginRouteError.badRequest("Model modelId is required");
			}

			const mode = input.mode === "gateway" ? "gateway" : "direct";
			if (mode === "gateway") {
				if (!input.provider?.trim()) {
					throw PluginRouteError.badRequest("Provider slug is required for AI Gateway mode");
				}
			} else if (!input.apiKey?.trim()) {
				throw PluginRouteError.badRequest("API key is required");
			}

			const now = new Date().toISOString();
			const id = generateId("mdl");
			const testStatus = normalizeTestStatus(input.testStatus);

			const record: Model = {
				name: input.name,
				endpoint: input.endpoint,
				modelId: input.modelId,
				mode,
				provider: input.provider,
				headers: input.headers,
				hasKey: !!input.apiKey?.trim(),
				hasGatewayToken: !!input.gatewayToken?.trim(),
				verifiedAt: testStatus === "ok" ? now : undefined,
				lastTestStatus: testStatus,
				createdAt: now,
				updatedAt: now,
			};

			await models(ctx).put(id, record);
			if (input.apiKey?.trim()) await setModelSecret(ctx, id, input.apiKey.trim());
			if (input.gatewayToken?.trim()) await setModelGatewaySecret(ctx, id, input.gatewayToken.trim());

			return { success: true, id, model: record };
		},
	},

	"models/update": {
		handler: async (ctx: RouteContext) => {
			const { id, ...updates } = ctx.input as UpdateModelInput & { id: string; apiKey?: string; gatewayToken?: string };

			const existing = await models(ctx).get(id);
			if (!existing) {
				throw PluginRouteError.notFound(`Model "${id}" not found`);
			}

			const apiKeyChanged = updates.apiKey !== undefined && updates.apiKey.trim() !== "";
			const gatewayTokenChanged = updates.gatewayToken !== undefined && updates.gatewayToken.trim() !== "";

			// Verification is client-driven: an explicit testStatus updates it; otherwise it is preserved.
			let verifiedAt = existing.verifiedAt;
			let lastTestStatus = existing.lastTestStatus;
			if (updates.testStatus !== undefined) {
				const status = normalizeTestStatus(updates.testStatus);
				verifiedAt = status === "ok" ? new Date().toISOString() : undefined;
				lastTestStatus = status;
			}

			// Strip secrets + transient fields before spreading into the persisted record.
			const { apiKey: _apiKey, gatewayToken: _gatewayToken, testStatus: _testStatus, ...safeUpdates } = updates;

			const updated: Model = {
				...existing,
				...safeUpdates,
				...(apiKeyChanged ? { hasKey: true } : {}),
				...(gatewayTokenChanged ? { hasGatewayToken: true } : {}),
				verifiedAt,
				lastTestStatus,
				updatedAt: new Date().toISOString(),
			};

			await models(ctx).put(id, updated);
			if (apiKeyChanged) await setModelSecret(ctx, id, updates.apiKey!.trim());
			if (gatewayTokenChanged) await setModelGatewaySecret(ctx, id, updates.gatewayToken!.trim());

			return { success: true, model: updated };
		},
	},

	"models/delete": {
		handler: async (ctx: RouteContext) => {
			const { id } = ctx.input as { id: string };
			await models(ctx).delete(id);
			await deleteModelSecret(ctx, id);
			await deleteModelGatewaySecret(ctx, id);
			return { success: true };
		},
	},

	"models/test": {
		handler: async (ctx: RouteContext) => {
			const input = ctx.input as {
				id?: string;
				mode?: string;
				endpoint?: string;
				modelId?: string;
				provider?: string;
				apiKey?: string;
				gatewayToken?: string;
				headers?: Record<string, string>;
			};

			// Load the stored record when an id is given (MCP passes only id).
			const record = input.id ? await models(ctx).get(input.id) : null;

			const mode = (input.mode ?? record?.mode ?? "direct") === "gateway" ? "gateway" : "direct";
			const endpoint = input.endpoint?.trim() || record?.endpoint || null;
			const modelId = input.modelId?.trim() || record?.modelId || null;
			const provider = input.provider?.trim() || record?.provider;

			// Provider key: from input, else stored secret.
			let apiKey = input.apiKey?.trim() || null;
			if (!apiKey && input.id) {
				apiKey = await getModelSecret(ctx, input.id);
			}

			// Gateway token: from input, else stored secret (gateway mode only).
			let gatewayToken = input.gatewayToken?.trim() || null;
			if (!gatewayToken && input.id && mode === "gateway") {
				gatewayToken = await getModelGatewaySecret(ctx, input.id);
			}

			if (!endpoint || !modelId) {
				return { ok: false, error: "Missing endpoint or modelId" };
			}
			// Direct mode requires a key; gateway mode may use a key stored on the gateway (BYOK).
			if (mode !== "gateway" && !apiKey) {
				return { ok: false, error: "Missing API key" };
			}

			return await testModelConnection(ctx, {
				endpoint,
				modelId: resolveModelString({ mode, provider, modelId }),
				apiKey: apiKey ?? undefined,
				gatewayToken: gatewayToken ?? undefined,
				headers: input.headers,
			});
		},
	},
};
