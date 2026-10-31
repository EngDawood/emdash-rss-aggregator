import type { PluginContext, StorageCollection } from "emdash";
import type {
	Source,
	FeedItem,
	Display,
	Model,
	Agent,
	OutputProfile,
	RejectListEntry,
	ImportLog,
	Folder,
	PluginSettings,
} from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";

export function generateId(prefix: string = ""): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

export async function loadSettings(ctx: PluginContext): Promise<PluginSettings> {
	const entries = await ctx.kv.list("settings:");
	const settings = { ...DEFAULT_SETTINGS };
	for (const { key, value } of entries) {
		const field = key.replace("settings:", "") as keyof PluginSettings;
		if (field in settings) {
			(settings as Record<string, unknown>)[field] = value;
		}
	}
	return settings;
}

export function sources(ctx: PluginContext): StorageCollection<Source> {
	return ctx.storage.sources as StorageCollection<Source>;
}

export function feedItems(ctx: PluginContext): StorageCollection<FeedItem> {
	return ctx.storage.feedItems as StorageCollection<FeedItem>;
}

export function displays(ctx: PluginContext): StorageCollection<Display> {
	return ctx.storage.displays as StorageCollection<Display>;
}

export function models(ctx: PluginContext): StorageCollection<Model> {
	return ctx.storage.models as StorageCollection<Model>;
}

export function agents(ctx: PluginContext): StorageCollection<Agent> {
	return ctx.storage.agents as StorageCollection<Agent>;
}

export function outputProfiles(ctx: PluginContext): StorageCollection<OutputProfile> {
	return ctx.storage.outputProfiles as StorageCollection<OutputProfile>;
}

export function rejectList(ctx: PluginContext): StorageCollection<RejectListEntry> {
	return ctx.storage.rejectList as StorageCollection<RejectListEntry>;
}

export function importLogs(ctx: PluginContext): StorageCollection<ImportLog> {
	return ctx.storage.importLogs as StorageCollection<ImportLog>;
}

export function folders(ctx: PluginContext): StorageCollection<Folder> {
	return ctx.storage.folders as StorageCollection<Folder>;
}

export { htmlToPortableText } from "./html-parser.js";
