export const adminPages = [
	{ path: "/sources", label: "Feed Sources", icon: "rss" },
	{ path: "/items", label: "Feed Items", icon: "list" },
	{ path: "/reader", label: "Feed Reader", icon: "book-open" },
	{ path: "/profiles", label: "Output Profiles", icon: "share" },
	{ path: "/displays", label: "Displays", icon: "layout" },
	{ path: "/ai", label: "AI", icon: "sparkles" },
	{ path: "/logs", label: "Import Log", icon: "file-text" },
	{ path: "/settings", label: "Settings", icon: "settings" },
];

export const adminWidgets = [
	{ id: "rss-stats", title: "RSS Aggregator", size: "half" as const },
];

export const portableTextBlocks = [
	{
		type: "rssFeedEmbed",
		label: "RSS Feed",
		icon: "rss" as any,
		description: "Embed an aggregated RSS feed display",
		fields: [
			{
				type: "text_input",
				action_id: "id",
				label: "Display ID",
				placeholder: "Enter display ID or leave blank for default",
			},
			{
				type: "number_input",
				action_id: "limit",
				label: "Max Items",
				min: 1,
				max: 100,
			},
		],
	},
	{
		type: "rssFeedSource",
		label: "Feed Source",
		icon: "link-external" as any,
		description: "Embed items from a specific feed source",
		fields: [
			{
				type: "text_input",
				action_id: "id",
				label: "Source ID",
				placeholder: "Enter the feed source ID",
			},
			{
				type: "number_input",
				action_id: "limit",
				label: "Max Items",
				min: 1,
				max: 50,
			},
		],
	},
];

export const settingsSchema = {
	globalFetchInterval: {
		type: "number",
		label: "Default Fetch Interval (minutes)",
		description: "How often to check feeds for new items. Per-source override available.",
		default: 60,
		min: 5,
		max: 10080,
	},
	maxItemsPerSource: {
		type: "number",
		label: "Max Items Per Source",
		description: "Maximum items to keep per source. Oldest are deleted first.",
		default: 200,
		min: 10,
		max: 5000,
	},
	maxItemAge: {
		type: "number",
		label: "Max Item Age (days)",
		description: "Delete items older than this. 0 = keep forever.",
		default: 0,
		min: 0,
		max: 365,
	},
	defaultUniqueBy: {
		type: "select",
		label: "Duplicate Detection",
		options: [
			{ value: "guid", label: "By GUID (recommended)" },
			{ value: "title", label: "By Title" },
		],
		default: "guid",
	},
	defaultReconcileStrategy: {
		type: "select",
		label: "Existing Items",
		description: "When a duplicate is found, preserve existing or overwrite.",
		options: [
			{ value: "preserve", label: "Preserve existing" },
			{ value: "overwrite", label: "Overwrite with new data" },
		],
		default: "preserve",
	},
	defaultOpenInNewTab: {
		type: "boolean",
		label: "Open Links in New Tab",
		default: true,
	},
	defaultNofollow: {
		type: "boolean",
		label: "Add nofollow to Links",
		default: true,
	},
	enableCustomFeed: {
		type: "boolean",
		label: "Enable Outgoing RSS Feed",
		description: "Serve aggregated items as RSS at the public API endpoint.",
		default: false,
	},
	customFeedTitle: {
		type: "string",
		label: "Outgoing Feed Title",
		default: "Aggregated Feed",
	},
	customFeedLimit: {
		type: "number",
		label: "Outgoing Feed Item Limit",
		default: 50,
		min: 1,
		max: 500,
	},
	logRetentionDays: {
		type: "number",
		label: "Import Log Retention (days)",
		description: "Delete import logs older than this. 0 = keep forever.",
		default: 30,
		min: 0,
		max: 365,
	},
	contentCollection: {
		type: "string",
		label: "Content Collection",
		description: "EmDash collection for imported feed items.",
		default: "feed-items",
	},
	userAgent: {
		type: "string",
		label: "User Agent",
		description: "HTTP User-Agent header sent when fetching feeds.",
		default: "EmDash RSS Aggregator/1.0",
	},
	fetchTimeout: {
		type: "number",
		label: "Fetch Timeout (ms)",
		description: "Timeout for HTTP requests when fetching feeds.",
		default: 30000,
		min: 5000,
		max: 120000,
	},

	// ── AI Pipeline ───────────────────────────────────────────────────
	aiEnabled: {
		type: "boolean",
		label: "Enable AI Pipeline",
		description: "Master switch for the AI pipeline (models, agents, output profiles).",
		default: false,
	},
	aiCreditMonthlyLimit: {
		type: "number",
		label: "Monthly AI Credit Limit",
		description: "Maximum AI operations per month. 0 = unlimited.",
		default: 0,
		min: 0,
	},

	// ── Image Import to Media Library ─────────────────────────────────
	imageImportEnabled: {
		type: "boolean",
		label: "Import Featured Images",
		description: "Download featured images into EmDash media storage (R2/local).",
		default: false,
	},
	imageImportContentImages: {
		type: "boolean",
		label: "Import In-content Images",
		description: "Also download images embedded in content and rewrite their URLs.",
		default: false,
	},
	imageImportMaxPerItem: {
		type: "number",
		label: "Max Images per Item",
		default: 10,
		min: 1,
		max: 50,
	},

	// ── Manual Curation ───────────────────────────────────────────────
	curationEnabled: {
		type: "boolean",
		label: "Require Manual Approval",
		description: "Import items into a pending queue requiring approval before publishing.",
		default: false,
	},

	// ── Full Text ─────────────────────────────────────────────────────
	fullTextMinWords: {
		type: "number",
		label: "Full-text Min Words Threshold",
		description: "Only fetch full text when the item is shorter than this. 0 = always when enabled.",
		default: 0,
		min: 0,
	},
};
