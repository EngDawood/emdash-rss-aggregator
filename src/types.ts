/**
 * @dawod/emdash-rss-aggregator
 *
 * Core type definitions for the RSS Aggregator plugin.
 * These types define the data models stored in plugin storage
 * and the shapes used throughout the plugin.
 */

// ── Feed Source ────────────────────────────────────────────────────────

/** A feed source configuration — stored in the `sources` storage collection. */
export interface Source {
	// Core
	name: string;
	url: string;
	siteUrl?: string;
	status: SourceStatus;
	tag?: string;

	// Import settings
	importLimit: number;
	importOrder: "asc" | "desc";
	ageLimit: number;
	ageLimitUnit: "days" | "hours";
	uniqueBy: "guid" | "title";
	reconcileStrategy: "preserve" | "overwrite";

	// Content settings
	trimContent: boolean;
	contentMaxWords: number;
	enableFullText: boolean;

	// AI pipeline bindings — one model + a set of agents run on import.
	aiModelId?: string;
	aiAgentIds?: string[];

	// Output: per-source slug prefix (feeds the {sourceSlug} token) + bound profile.
	slug?: string;
	outputProfileId?: string;

	// AI Content Suite (DEPRECATED — replaced by aiModelId/aiAgentIds; kept inert)
	enableAiSummary?: boolean;
	enableAiRewrite?: boolean;
	enableTranslation?: boolean;

	// Image import to media library (per-source override)
	importImages?: boolean;

	// Custom field mapping (premium: Custom Mapping)
	fieldMappings?: FieldMapping[];

	// Manual curation (premium: Manual Curation) — per-source override
	requireApproval?: boolean;

	// Post conversion (DEPRECATED — replaced by outputProfileId; kept inert)
	feedToPost?: boolean;
	postCollection?: string;
	postStatus?: "draft" | "published";

	// Keyword filtering (premium)
	keywordFilterEnabled: boolean;
	keywordFilterMode: "include" | "exclude";
	keywords: string[];
	keywordMatchIn: ("title" | "content")[];

	// Author mapping
	authorHandling: "from-feed" | "fallback" | "override";
	fallbackAuthor?: string;
	overrideAuthor?: string;

	// Image handling
	assignFeaturedImage: boolean;
	featuredImageSource: "first-in-content" | "enclosure" | "media-thumbnail";

	// Link settings
	openInNewTab: boolean;
	nofollow: boolean;
	canonicalLink: boolean;

	// Scheduling
	fetchInterval: number;
	lastFetchedAt?: string;
	nextFetchAt?: string;
	lastError?: string;

	// Future scheduling (premium)
	futureActivateAt?: string;
	futurePauseAt?: string;

	// Stats
	itemCount: number;

	// Timestamps
	createdAt: string;
	updatedAt: string;
}

export type SourceStatus = "active" | "paused" | "error";

// ── Feed Item ──────────────────────────────────────────────────────────

/**
 * A feed item — stored in the `feedItems` storage collection.
 * Also written as EmDash content entries in the "feed-items" collection.
 */
export interface FeedItem {
	sourceId: string;
	sourceName: string;
	sourceUrl: string;
	guid: string;
	title: string;
	url: string;
	content?: string;
	excerpt?: string;
	author?: AuthorInfo;
	publishedAt: string;
	enclosure?: Enclosure;
	imageUrl?: string;
	mediaType: MediaType;
	youtubeVideoId?: string;
	audioUrl?: string;
	categories?: string[];
	customFields?: Record<string, unknown>;
	importedAt: string;

	// Link to the synced EmDash content entry (collection = settings.contentCollection)
	contentId?: string;

	// Link to the published post created by an output profile (profile.collection)
	publishedContentId?: string;

	// Manual curation state. "approved" when curation is disabled.
	status?: ItemStatus;
	approvedAt?: string;
	approvedBy?: string;

	// AI Content Suite outputs
	summary?: string; // AI TL;DR (summary-kind agent)
	rewrittenContent?: string; // AI rewrite (rewrite-kind agent)
	aiOutputs?: Record<string, string>; // custom-kind agent outputs, keyed by agentId
	aiProcessedAt?: string;

	// Multilingual translations keyed by locale (e.g. "ar", "fr")
	translations?: Record<string, ItemTranslation>;

	// Media library references created by image import
	mediaIds?: string[];
}

/** Manual curation lifecycle state for an imported item. */
export type ItemStatus = "pending" | "approved" | "rejected";

/** A translated rendition of an item for a single locale. */
export interface ItemTranslation {
	title?: string;
	excerpt?: string;
	content?: string;
	summary?: string;
	translatedAt?: string;
}

export interface AuthorInfo {
	name?: string;
	email?: string;
	url?: string;
}

export interface Enclosure {
	url: string;
	type?: string;
	length?: number;
}

export type MediaType = "article" | "video" | "audio" | "podcast";

// ── Display ────────────────────────────────────────────────────────────

/** A display/template configuration — stored in the `displays` storage collection. */
export interface Display {
	name: string;
	sources: string[];
	excludeSources: string[];
	tags: string[];

	// Layout
	layout: LayoutType;
	numItems: number;
	enablePagination: boolean;
	paginationStyle: "numbered" | "load-more";
	htmlClass?: string;

	// Title options
	enableTitles: boolean;
	titleMaxLength: number;
	linkTitles: boolean;

	// Source info
	enableSources: boolean;
	sourcePrefix: string;
	linkSource: boolean;

	// Date options
	enableDates: boolean;
	datePrefix: string;
	dateFormat: string;
	useRelativeDate: boolean;

	// Author
	enableAuthors: boolean;
	authorPrefix: string;

	// Links
	linkTarget: "_blank" | "_self";
	linksNoFollow: boolean;
	linkToEmbeds: boolean;

	// Excerpts
	enableExcerpts: boolean;
	excerptMaxWords: number;
	excerptEllipsis: string;
	enableReadMore: boolean;
	readMoreText: string;

	// Images
	enableImages: boolean;
	linkImages: boolean;
	imageWidth?: number;
	imageHeight?: number;
	fallbackToSourceImage: boolean;

	// Grid-specific (premium)
	gridMaxColumns: number;
	gridUseImageAsBg: boolean;
	gridFitImages: boolean;
	gridEnableEmbeds: boolean;

	// Audio (premium)
	enableAudioPlayer: boolean;
	audioPlayerPosition: "before" | "after";

	// Bullets
	enableBullets: boolean;
	bulletStyle: "disc" | "circle" | "square" | "none";

	createdAt: string;
	updatedAt: string;
}

export type LayoutType = "list" | "grid" | "excerpts" | "thumbnails";

// ── Reject List ────────────────────────────────────────────────────────

/** A rejected item GUID — stored in the `rejectList` storage collection. */
export interface RejectListEntry {
	guid: string;
	sourceId: string;
	title?: string;
	url?: string;
	reason?: string;
	rejectedBy?: string;
	createdAt: string;
}

// ── Import Log ─────────────────────────────────────────────────────────

/** An import log entry — stored in the `importLogs` storage collection. */
export interface ImportLog {
	sourceId: string;
	sourceName: string;
	status: ImportStatus;
	itemsFound: number;
	itemsImported: number;
	itemsSkipped: number;
	itemsRejected: number;
	itemsUpdated: number;
	error?: string;
	duration: number;
	feedTitle?: string;
	feedUrl?: string;
	createdAt: string;
}

export type ImportStatus = "success" | "error" | "partial";

// ── Folder ─────────────────────────────────────────────────────────────

/** A folder for organizing sources — stored in the `folders` storage collection. */
export interface Folder {
	name: string;
	slug: string;
	sourceIds: string[];
	createdAt: string;
	updatedAt: string;
}

// ── Custom Mapping (Premium) ───────────────────────────────────────────

/** A field mapping rule for custom RSS→content field mapping. */
export interface FieldMapping {
	rssField: string;
	targetField: string;
	transform?: "none" | "strip-html" | "truncate" | "date" | "lowercase" | "uppercase";
	truncateLength?: number;
}

// ── RSS Parser Types ───────────────────────────────────────────────────

/** Parsed feed metadata from RSS/Atom. */
export interface ParsedFeed {
	format: "rss2" | "rss1" | "atom" | "unknown";
	title: string;
	link: string;
	description: string;
	language?: string;
	lastBuildDate?: string;
	generator?: string;
	imageUrl?: string;
	items: ParsedItem[];
}

/** A single parsed item from an RSS/Atom feed. */
export interface ParsedItem {
	guid: string;
	title: string;
	link: string;
	description?: string;
	content?: string;
	author?: AuthorInfo;
	pubDate?: string;
	categories?: string[];
	enclosure?: Enclosure;
	mediaThumbnail?: string;
	mediaContent?: string;
	commentsUrl?: string;
	/** Raw XML of the source <item>/<entry> block — used for custom field mapping. */
	raw?: string;
}

// ── AI Pipeline: Model ───────────────────────────────────────────────────

/** A saved AI model endpoint — stored in the `models` storage collection.
 * The API key is NEVER stored here; it lives in KV at `model-secret:<id>`. */
export interface Model {
	name: string;
	/** Full OpenAI-compatible chat-completions URL. */
	endpoint: string;
	/** Bare model identifier. In gateway mode it is prefixed with `provider/` at call time. */
	modelId: string;
	/**
	 * Connection mode. "direct" (default) = a plain OpenAI-compatible endpoint.
	 * "gateway" = a Cloudflare AI Gateway: the request body model becomes `provider/modelId`,
	 * the provider API key is optional (may be stored on the gateway / BYOK), and an optional
	 * gateway token is sent as cf-aig-authorization for an authenticated gateway.
	 */
	mode?: "direct" | "gateway";
	/** Direct mode: display label only. Gateway mode: the routing provider slug (e.g. "groq", "custom-nividia-nvm"), prepended to modelId. */
	provider?: string;
	/** Extra request headers, e.g. cf-aig-authorization for an authenticated Gateway. */
	headers?: Record<string, string>;
	/** Whether a key is configured in KV (so the UI can show "configured"). */
	hasKey?: boolean;
	/** Gateway mode: whether a cf-aig-authorization token is configured in KV. */
	hasGatewayToken?: boolean;
	verifiedAt?: string;
	lastTestStatus?: string;
	createdAt: string;
	updatedAt: string;
}

export type AgentKind = "summary" | "rewrite" | "translate" | "custom";

/** A saved AI agent — stored in the `agents` storage collection. */
export interface Agent {
	name: string;
	kind: AgentKind;
	/** The system prompt driving this agent. */
	instructions: string;
	/** Sampling temperature. Default 0.4. */
	temperature?: number;
	/** translate-kind only: comma-separated BCP-47 locales (e.g. "ar,fr"). */
	locales?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * A value the publisher can produce for one field of the target collection.
 *
 * `customField` reads `item.customFields[<the mapped field slug>]`, which is
 * how a source's Custom Mapping reaches a real column.
 */
export type FieldToken =
	| "body"
	| "summary"
	| "excerpt"
	| "url"
	| "image"
	| "publishedAt"
	| "author"
	| "sourceName"
	| "customField";

export const FIELD_TOKENS: FieldToken[] = [
	"body",
	"summary",
	"excerpt",
	"url",
	"image",
	"publishedAt",
	"author",
	"sourceName",
	"customField",
];

/**
 * Payload keys the publisher always owns. A profile's fieldMap may not target
 * them — `slug`/`status`/`publishedAt` are consumed by EmDash's write API and
 * the rest are system columns.
 */
export const RESERVED_PAYLOAD_KEYS = new Set([
	"id",
	"title",
	"slug",
	"status",
	"seo",
	"publishedAt",
	"createdAt",
	"updatedAt",
	"locale",
	"authorId",
	"primaryBylineId",
	"translationOf",
]);

/** A saved output profile — stored in the `outputProfiles` storage collection. */
export interface OutputProfile {
	name: string;
	/** internal = keep on the item, never publish. */
	mode: "internal" | "publish";
	/** Target content collection (e.g. "posts"). */
	collection: string;
	/** Created entry status. draft = native CMS draft. */
	status: "draft" | "published";
	/** true = item stays pending; entry is created on approve. */
	requireApproval: boolean;
	/** Slug template, e.g. "{itemSlug}". */
	slugPattern: string;
	/** Which produced text becomes the body. Falls back rewrite→original when absent. */
	bodySource: "rewrite" | "original" | "summary";
	/** Which produced text becomes the excerpt. */
	excerptSource?: "summary" | "original" | "none";
	/** Trusted admin HTML appended to the body; supports {token} substitution. */
	footerTemplate?: string;
	/** Default category term IDs or slugs to assign on publish. */
	defaultCategories?: string[];
	/** Whether to dynamically map feed categories / sourceSlug to EmDash taxonomy terms. */
	mapFeedCategories?: boolean;
	/**
	 * Target-collection field slug → value token.
	 *
	 * EmDash turns every payload key into a literal SQL column, so each key
	 * here MUST be a real field on `collection` or the whole insert fails.
	 * Omit to get {@link DEFAULT_FIELD_MAP} (the stock `posts` shape).
	 */
	fieldMap?: Record<string, FieldToken>;
	createdAt: string;
	updatedAt: string;
}

export type CreateModelInput = Omit<Model, "hasKey" | "hasGatewayToken" | "verifiedAt" | "lastTestStatus" | "createdAt" | "updatedAt"> & {
	/** Provider API key (Authorization: Bearer). Optional in gateway mode (BYOK on the gateway). */
	apiKey?: string;
	/** Gateway token (cf-aig-authorization). Gateway mode only; only for an authenticated gateway. */
	gatewayToken?: string;
	/** Client-supplied connection-test outcome; drives verifiedAt/lastTestStatus. */
	testStatus?: "ok" | "failed" | "untested";
};
export type UpdateModelInput = Partial<CreateModelInput> & { id: string };
export type CreateAgentInput = Omit<Agent, "createdAt" | "updatedAt">;
export type UpdateAgentInput = Partial<Omit<Agent, "createdAt" | "updatedAt">> & { id: string };
export type CreateOutputProfileInput = Omit<OutputProfile, "createdAt" | "updatedAt">;
export type UpdateOutputProfileInput = Partial<Omit<OutputProfile, "createdAt" | "updatedAt">> & { id: string };

// ── Plugin Settings ────────────────────────────────────────────────────

/** All plugin settings (stored in KV under settings:* prefix). */
export interface PluginSettings {
	globalFetchInterval: number;
	maxItemsPerSource: number;
	maxItemAge: number;
	maxItemAgeUnit: "days" | "hours";
	defaultUniqueBy: "guid" | "title";
	defaultReconcileStrategy: "preserve" | "overwrite";
	defaultOpenInNewTab: boolean;
	defaultNofollow: boolean;
	enableCustomFeed: boolean;
	customFeedTitle: string;
	customFeedLimit: number;
	customFeedFormat: "rss2" | "atom";
	logRetentionDays: number;
	contentCollection: string;
	enableFullText: boolean;
	enableKeywordFilter: boolean;
	userAgent: string;
	fetchTimeout: number;
	enableYouTubeDetection: boolean;

	// ── AI Pipeline ───────────────────────────────────────────────────
	/** Master switch for all AI features (kill-switch). */
	aiEnabled: boolean;
	/** Monthly AI credit allowance. 0 = unlimited. */
	aiCreditMonthlyLimit: number;

	// ── Image import to media library ─────────────────────────────────
	/** Download featured images into EmDash media storage (R2/local). */
	imageImportEnabled: boolean;
	/** Also download in-content images and rewrite their URLs. */
	imageImportContentImages: boolean;
	/** Maximum images to import per item. */
	imageImportMaxPerItem: number;

	// ── Manual curation ───────────────────────────────────────────────
	/** Import items into a "pending" queue requiring manual approval. */
	curationEnabled: boolean;

	// ── Full text ─────────────────────────────────────────────────────
	/** Only fetch full text when the excerpt is shorter than this (words). 0 = always when enabled. */
	fullTextMinWords: number;
}

/** Credit ledger state (stored in KV under credits:* keys). */
export interface CreditState {
	/** Monthly allowance. 0 = unlimited. */
	limit: number;
	/** Credits consumed in the current period. */
	used: number;
	/** Current accounting period in YYYY-MM form. */
	period: string;
}

/** Default settings values. */
export const DEFAULT_SETTINGS: PluginSettings = {
	globalFetchInterval: 60,
	maxItemsPerSource: 200,
	maxItemAge: 0,
	maxItemAgeUnit: "days",
	defaultUniqueBy: "guid",
	defaultReconcileStrategy: "preserve",
	defaultOpenInNewTab: true,
	defaultNofollow: true,
	enableCustomFeed: false,
	customFeedTitle: "Aggregated Feed",
	customFeedLimit: 50,
	customFeedFormat: "rss2",
	logRetentionDays: 30,
	contentCollection: "feed-items",
	enableFullText: false,
	enableKeywordFilter: false,
	userAgent: "EmDash RSS Aggregator/1.0",
	fetchTimeout: 30000,
	enableYouTubeDetection: true,

	// AI Pipeline
	aiEnabled: false,
	aiCreditMonthlyLimit: 0,

	// Image import
	imageImportEnabled: false,
	imageImportContentImages: false,
	imageImportMaxPerItem: 10,

	// Manual curation
	curationEnabled: false,

	// Full text
	fullTextMinWords: 0,
};

// ── Utility Types ──────────────────────────────────────────────────────

/** Source creation input (subset of Source, without auto-generated fields). */
export type CreateSourceInput = Omit<Source, "status" | "itemCount" | "lastFetchedAt" | "nextFetchAt" | "lastError" | "createdAt" | "updatedAt"> & {
	status?: SourceStatus;
};

/** Source update input (all fields optional). */
export type UpdateSourceInput = Partial<Omit<Source, "createdAt" | "updatedAt">>;

/** Display creation input. */
export type CreateDisplayInput = Omit<Display, "createdAt" | "updatedAt">;

/** Display update input. */
export type UpdateDisplayInput = Partial<Omit<Display, "createdAt" | "updatedAt">>;

/** Route response for paginated lists. */
export interface PaginatedResponse<T> {
	items: Array<{ id: string; data: T }>;
	cursor?: string;
	hasMore: boolean;
	total?: number;
}

/** Route response for stats/dashboard. */
export interface PluginStats {
	totalSources: number;
	activeSources: number;
	pausedSources: number;
	errorSources: number;
	totalItems: number;
	itemsToday: number;
	lastImportAt?: string;
	lastImportStatus?: ImportStatus;
}
