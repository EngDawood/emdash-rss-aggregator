/**
 * Ambient type declarations for `emdash` peer dependency.
 * These types are resolved at build time in the consuming EmDash project.
 * This file provides minimal declarations for local TypeScript compilation.
 */

declare module "emdash" {
	// ── Plugin Descriptor ──────────────────────────────────────────────
	export interface PluginDescriptor {
		id: string;
		version: string;
		format?: "standard" | "native";
		entrypoint: string;
		componentsEntry?: string;
		adminEntry?: string;
		options?: Record<string, unknown>;
		capabilities?: Capability[];
		allowedHosts?: string[];
		storage?: Record<string, StorageConfig>;
		adminPages?: AdminPageConfig[];
		adminWidgets?: AdminWidgetConfig[];
	}

	export type Capability =
		| "read:content"
		| "write:content"
		| "read:media"
		| "write:media"
		| "network:fetch"
		| "read:users"
		| "email:send"
		| "email:provide"
		| "email:intercept";

	export interface StorageConfig {
		indexes: Array<string | string[]>;
	}

	export interface AdminPageConfig {
		path: string;
		label: string;
		icon?: string;
	}

	export interface AdminWidgetConfig {
		id: string;
		title: string;
		size: "full" | "half" | "third";
	}

	// ── Plugin Definition ──────────────────────────────────────────────
	export interface PluginDefinition {
		id: string;
		version: string;
		capabilities?: Capability[];
		allowedHosts?: string[];
		storage?: Record<string, StorageConfig>;
		hooks?: Record<string, HookHandler | HookConfig>;
		routes?: Record<string, RouteConfig>;
		admin?: AdminConfig;
	}

	export interface AdminConfig {
		entry?: string;
		pages?: AdminPageConfig[];
		widgets?: AdminWidgetConfig[];
		settingsSchema?: Record<string, SettingField>;
		portableTextBlocks?: PortableTextBlockConfig[];
	}

	export interface PortableTextBlockConfig {
		type: string;
		label: string;
		icon?: string;
		description?: string;
		placeholder?: string;
		fields?: Array<{
			type: string;
			action_id: string;
			label: string;
			placeholder?: string;
			options?: Array<{ label: string; value: string }>;
			initial_value?: unknown;
			min?: number;
			max?: number;
		}>;
	}

	export interface SettingField {
		type: "string" | "number" | "boolean" | "select" | "secret";
		label: string;
		description?: string;
		default?: unknown;
		min?: number;
		max?: number;
		multiline?: boolean;
		options?: Array<{ value: string; label: string }>;
	}

	export type HookHandler = (event: any, ctx: PluginContext) => Promise<unknown> | unknown;

	export interface HookConfig {
		priority?: number;
		timeout?: number;
		dependencies?: string[];
		errorPolicy?: "abort" | "continue";
		exclusive?: boolean;
		handler: HookHandler;
	}

	export interface RouteConfig {
		public?: boolean;
		input?: any; // Zod schema
		handler: (routeCtx: RouteContext, ctx: PluginContext) => Promise<unknown> | unknown;
	}

	// ── Plugin Context ─────────────────────────────────────────────────
	export interface PluginContext {
		plugin: { id: string; version: string };
		storage: Record<string, StorageCollection>;
		kv: KVAccess;
		log: LogAccess;
		content?: ContentAccess;
		media?: MediaAccess;
		http?: HttpAccess;
		users?: UserAccess;
		cron?: CronAccess;
		email?: EmailAccess;
	}

	export interface RouteContext<TInput = unknown> {
		input: TInput;
		request: Request;
	}

	// ── Storage ────────────────────────────────────────────────────────
	export interface StorageCollection<T = unknown> {
		get(id: string): Promise<T | null>;
		put(id: string, data: T): Promise<void>;
		delete(id: string): Promise<boolean>;
		exists(id: string): Promise<boolean>;
		getMany(ids: string[]): Promise<Map<string, T>>;
		putMany(items: Array<{ id: string; data: T }>): Promise<void>;
		deleteMany(ids: string[]): Promise<number>;
		query(options?: QueryOptions): Promise<PaginatedResult<{ id: string; data: T }>>;
		count(where?: WhereClause): Promise<number>;
	}

	export interface QueryOptions {
		where?: WhereClause;
		orderBy?: Record<string, "asc" | "desc">;
		limit?: number;
		cursor?: string;
	}

	export type WhereClause = Record<string, unknown>;

	export interface PaginatedResult<T> {
		items: T[];
		cursor?: string;
		hasMore: boolean;
	}

	// ── KV ──────────────────────────────────────────────────────────────
	export interface KVAccess {
		get<T>(key: string): Promise<T | null>;
		set(key: string, value: unknown): Promise<void>;
		delete(key: string): Promise<boolean>;
		list(prefix?: string): Promise<Array<{ key: string; value: unknown }>>;
	}

	// ── Content ─────────────────────────────────────────────────────────
	export interface ContentAccess {
		get(collection: string, id: string): Promise<ContentEntry | null>;
		list(collection: string, options?: ContentListOptions): Promise<PaginatedResult<ContentEntry>>;
		create(collection: string, data: Record<string, unknown>): Promise<ContentEntry>;
		update(collection: string, id: string, data: Record<string, unknown>): Promise<ContentEntry>;
		delete(collection: string, id: string): Promise<boolean>;
	}

	export interface ContentEntry {
		id: string;
		collection: string;
		data: Record<string, unknown>;
		createdAt: string;
		updatedAt: string;
	}

	export interface ContentListOptions {
		where?: WhereClause;
		orderBy?: Record<string, "asc" | "desc">;
		limit?: number;
		cursor?: string;
	}

	// ── Media ───────────────────────────────────────────────────────────
	export interface MediaAccess {
		get(id: string): Promise<MediaEntry | null>;
		list(options?: { limit?: number; cursor?: string }): Promise<PaginatedResult<MediaEntry>>;
		getUploadUrl(): Promise<{ url: string; id: string }>;
		delete(id: string): Promise<boolean>;
	}

	export interface MediaEntry {
		id: string;
		filename: string;
		mimeType: string;
		size: number | null;
		url: string;
		createdAt: string;
	}

	// ── HTTP ────────────────────────────────────────────────────────────
	export interface HttpAccess {
		fetch(url: string, init?: RequestInit): Promise<Response>;
	}

	// ── Users ───────────────────────────────────────────────────────────
	export interface UserAccess {
		get(id: string): Promise<unknown>;
		list(): Promise<unknown[]>;
		getByEmail(email: string): Promise<unknown>;
	}

	// ── Cron ────────────────────────────────────────────────────────────
	export interface CronAccess {
		schedule(name: string, config: { schedule: string }): Promise<void>;
		cancel(name: string): Promise<void>;
		list(): Promise<Array<{ name: string; schedule: string; nextRun?: string }>>;
	}

	// ── Email ───────────────────────────────────────────────────────────
	export interface EmailAccess {
		send(message: EmailMessage): Promise<void>;
	}

	export interface EmailMessage {
		to: string | string[];
		subject: string;
		text?: string;
		html?: string;
		from?: string;
		replyTo?: string;
	}

	// ── Log ─────────────────────────────────────────────────────────────
	export interface LogAccess {
		info(message: string, data?: Record<string, unknown>): void;
		warn(message: string, data?: Record<string, unknown>): void;
		error(message: string, data?: Record<string, unknown>): void;
		debug(message: string, data?: Record<string, unknown>): void;
	}

	// ── definePlugin ────────────────────────────────────────────────────
	export function definePlugin(config: PluginDefinition): PluginDefinition;
}
