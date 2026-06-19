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

	// Post conversion (premium: Feed-to-Post)
	feedToPost: boolean;
	postCollection: string;
	postStatus: "draft" | "published";

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
}

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
	enableFeedToPost: boolean;
	defaultPostCollection: string;
	defaultPostStatus: "draft" | "published";
	enableFullText: boolean;
	enableKeywordFilter: boolean;
	userAgent: string;
	fetchTimeout: number;
	enableYouTubeDetection: boolean;
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
	enableFeedToPost: false,
	defaultPostCollection: "posts",
	defaultPostStatus: "draft",
	enableFullText: false,
	enableKeywordFilter: false,
	userAgent: "EmDash RSS Aggregator/1.0",
	fetchTimeout: 30000,
	enableYouTubeDetection: true,
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
