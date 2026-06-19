/**
 * @dawod/emdash-rss-aggregator
 *
 * Import pipeline that fetches feed, parses items, filters them,
 * deduplicates against database, and syncs them to storage and content collections.
 */

import type { PluginContext, StorageCollection } from "emdash";
import type {
	Source,
	FeedItem,
	ImportLog,
	PluginSettings,
	RejectListEntry,
	ParsedItem,
	MediaType,
	AuthorInfo,
	Enclosure,
} from "./types.js";
import { parseFeed, extractYouTubeVideoId } from "./feed-parser.js";

// ── Helpers ────────────────────────────────────────────────────────────

function generateId(prefix: string = ""): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 10);
	return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

export function applyKeywordFilter(items: ParsedItem[], source: Source): ParsedItem[] {
	if (!source.keywordFilterEnabled || !source.keywords || source.keywords.length === 0) {
		return items;
	}
	const keywords = source.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
	if (keywords.length === 0) return items;

	const matchIn = source.keywordMatchIn || ["title"];
	const mode = source.keywordFilterMode || "include";

	return items.filter((item) => {
		let matched = false;
		for (const kw of keywords) {
			if (matchIn.includes("title") && item.title?.toLowerCase().includes(kw)) {
				matched = true;
				break;
			}
			if (matchIn.includes("content") && item.content?.toLowerCase().includes(kw)) {
				matched = true;
				break;
			}
			if (matchIn.includes("content") && item.description?.toLowerCase().includes(kw)) {
				matched = true;
				break;
			}
		}
		return mode === "include" ? matched : !matched;
	});
}

export function trimContentToWords(html: string, maxWords: number): string {
	if (!html) return "";
	const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	const words = text.split(/\s+/);
	if (words.length <= maxWords) return html;
	return words.slice(0, maxWords).join(" ") + "...";
}

export function generateExcerpt(content: string, maxWords: number): string {
	if (!content) return "";
	const text = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	const words = text.split(/\s+/);
	if (words.length <= maxWords) return text;
	return words.slice(0, maxWords).join(" ") + "...";
}

export function extractImageFromContent(html: string): string | null {
	if (!html) return null;
	const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
	return match ? match[1] : null;
}

// ── Import Pipeline ────────────────────────────────────────────────────

/**
 * Fetches, parses, filters, deduplicates and imports a single feed source.
 */
export async function fetchAndImportFeed(
	source: Source,
	ctx: PluginContext,
	settings: PluginSettings,
	sourceId: string,
): Promise<ImportLog> {
	const start = Date.now();
	const now = new Date().toISOString();
	let itemsFound = 0;
	let itemsImported = 0;
	let itemsSkipped = 0;
	let itemsRejected = 0;
	let itemsUpdated = 0;
	let feedTitle: string | undefined;

	// Type cast collections
	const rejectList = ctx.storage.rejectList as StorageCollection<RejectListEntry>;
	const feedItems = ctx.storage.feedItems as StorageCollection<FeedItem>;
	const sources = ctx.storage.sources as StorageCollection<Source>;
	const importLogs = ctx.storage.importLogs as StorageCollection<ImportLog>;

	try {
		if (!ctx.http) {
			throw new Error("HTTP client capability is missing");
		}

		// 1. Fetch feed XML
		const response = await ctx.http.fetch(source.url, {
			headers: { "User-Agent": settings.userAgent || "EmDash RSS Aggregator/1.0" },
			signal: AbortSignal.timeout(settings.fetchTimeout || 30000),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const xml = await response.text();

		// 2. Parse feed XML
		const parsedFeed = parseFeed(xml);
		feedTitle = parsedFeed.title;
		itemsFound = parsedFeed.items.length;

		// 3. Apply keyword filtering
		let filteredItems = applyKeywordFilter(parsedFeed.items, source);

		// 4. Load reject list for this source to filter out rejected GUIDs
		const rejectedGuids = new Set<string>();
		let rejCursor: string | undefined;
		do {
			const res = await rejectList.query({
				where: { sourceId },
				limit: 1000,
				cursor: rejCursor,
			});
			for (const item of res.items) {
				if (item.data.guid) {
					rejectedGuids.add(item.data.guid);
				}
			}
			rejCursor = res.cursor;
		} while (rejCursor);

		const preRejectCount = filteredItems.length;
		filteredItems = filteredItems.filter((item) => !rejectedGuids.has(item.guid));
		itemsRejected = preRejectCount - filteredItems.length;

		// 5. Load existing items for this source to deduplicate
		const existingItems = new Map<string, { id: string; contentId?: string }>();
		let itemCursor: string | undefined;
		do {
			const res = await feedItems.query({
				where: { sourceId },
				limit: 1000,
				cursor: itemCursor,
			});
			for (const item of res.items) {
				const key = source.uniqueBy === "title" ? item.data.title : item.data.guid;
				if (key) {
					existingItems.set(key, { id: item.id, contentId: (item.data as any).contentId });
				}
			}
			itemCursor = res.cursor;
		} while (itemCursor);

		// Determine content collection name
		const collectionName = settings.contentCollection || "feed-items";

		// 6. Process items
		for (const parsed of filteredItems) {
			const key = source.uniqueBy === "title" ? parsed.title : parsed.guid;
			const existing = existingItems.get(key);

			if (existing && source.reconcileStrategy === "preserve") {
				itemsSkipped++;
				continue;
			}

			// Trim content
			let content = parsed.content || parsed.description || "";
			if (source.trimContent && source.contentMaxWords > 0) {
				content = trimContentToWords(content, source.contentMaxWords);
			}

			// Generate excerpt
			const excerpt = generateExcerpt(parsed.description || parsed.content || "", 40);

			// Extract image
			let imageUrl: string | undefined;
			if (source.assignFeaturedImage) {
				if (source.featuredImageSource === "enclosure" && parsed.enclosure?.url) {
					imageUrl = parsed.enclosure.url;
				} else if (source.featuredImageSource === "media-thumbnail" && parsed.mediaThumbnail) {
					imageUrl = parsed.mediaThumbnail;
				} else {
					imageUrl = extractImageFromContent(parsed.content || "") || parsed.mediaThumbnail || parsed.enclosure?.url || undefined;
				}
			}

			// Detect YouTube Video ID
			let youtubeVideoId: string | undefined;
			if (settings.enableYouTubeDetection) {
				youtubeVideoId = extractYouTubeVideoId(parsed.link) || extractYouTubeVideoId(parsed.guid) || undefined;
			}

			// Detect Audio/Podcast
			let audioUrl: string | undefined;
			let mediaType: MediaType = "article";
			if (parsed.enclosure?.type?.startsWith("audio/") || parsed.enclosure?.url?.match(/\.(mp3|wav|ogg|aac|m4a)$/i)) {
				audioUrl = parsed.enclosure.url;
				mediaType = "audio";
			}
			if (youtubeVideoId) {
				mediaType = "video";
			}

			const authorInfo: AuthorInfo = parsed.author || { name: "Feed Importer" };
			if (source.authorHandling === "override" && source.overrideAuthor) {
				authorInfo.name = source.overrideAuthor;
			} else if (source.authorHandling === "fallback" && !authorInfo.name && source.fallbackAuthor) {
				authorInfo.name = source.fallbackAuthor;
			}

			const feedItemData = {
				sourceId,
				sourceName: source.name,
				sourceUrl: source.url,
				guid: parsed.guid,
				title: parsed.title,
				url: parsed.link,
				content,
				excerpt,
				author: authorInfo,
				publishedAt: parsed.pubDate || now,
				enclosure: parsed.enclosure,
				imageUrl,
				mediaType,
				youtubeVideoId,
				audioUrl,
				categories: parsed.categories,
				importedAt: now,
			};

			let targetItemId = existing ? existing.id : generateId("itm");
			let contentId = existing?.contentId;

			// Write content entry
			if (ctx.content) {
				try {
					if (contentId) {
						// Update CMS entry
						await ctx.content.update(collectionName, contentId, feedItemData);
					} else {
						// Create CMS entry
						const contentEntry = await ctx.content.create(collectionName, feedItemData);
						contentId = contentEntry.id;
					}
				} catch (contentErr) {
					ctx.log.warn("Failed to sync content entry for feed item", { guid: parsed.guid, error: String(contentErr) });
				}
			}

			// Feed to Post conversion (premium)
			if (source.feedToPost && source.postCollection && ctx.content) {
				try {
					const postData = {
						title: parsed.title,
						content,
						excerpt,
						publishedAt: parsed.pubDate || now,
						status: source.postStatus || "draft",
						author: authorInfo.name,
						featuredImage: imageUrl,
						meta: {
							rssSourceId: sourceId,
							rssSourceUrl: source.url,
							rssGuid: parsed.guid,
						},
					};
					// Create content in custom postCollection
					await ctx.content.create(source.postCollection, postData);
				} catch (postErr) {
					ctx.log.warn("Failed to create post content for Feed-to-Post", { guid: parsed.guid, collection: source.postCollection, error: String(postErr) });
				}
			}

			// Store feed item in plugin storage
			const storedItem: FeedItem & { contentId?: string } = {
				...feedItemData,
				contentId,
			};
			await feedItems.put(targetItemId, storedItem);

			if (existing) {
				itemsUpdated++;
			} else {
				itemsImported++;
			}
		}

		// 7. Cleanup / Truncate old items (Source limit or Settings limit)
		const importLimit = source.importLimit > 0 ? source.importLimit : settings.maxItemsPerSource;
		if (importLimit > 0) {
			const sourceItems = await feedItems.query({
				where: { sourceId },
				orderBy: { publishedAt: "desc" },
				limit: 1000,
			});

			if (sourceItems.items.length > importLimit) {
				const itemsToDelete = sourceItems.items.slice(importLimit);
				for (const item of itemsToDelete) {
					await feedItems.delete(item.id);
					const itemData = item.data as any;
					if (itemData.contentId && ctx.content) {
						try {
							await ctx.content.delete(collectionName, itemData.contentId);
						} catch (delErr) {
							ctx.log.warn("Failed to delete orphaned content entry", { contentId: itemData.contentId });
						}
					}
				}
			}
		}

		// Age limits cleanup
		const ageLimit = source.ageLimit > 0 ? source.ageLimit : settings.maxItemAge;
		if (ageLimit > 0) {
			const ageUnit = source.ageLimit > 0 ? source.ageLimitUnit : settings.maxItemAgeUnit;
			const limitMs = ageLimit * 60 * 60 * 1000 * (ageUnit === "days" ? 24 : 1);
			const threshold = new Date(Date.now() - limitMs).toISOString();

			const sourceItems = await feedItems.query({
				where: { sourceId },
				limit: 1000,
			});

			for (const item of sourceItems.items) {
				if (item.data.publishedAt < threshold) {
					await feedItems.delete(item.id);
					const itemData = item.data as any;
					if (itemData.contentId && ctx.content) {
						try {
							await ctx.content.delete(collectionName, itemData.contentId);
						} catch (delErr) {
							// Ignore
						}
					}
				}
			}
		}

		// 8. Update Source stats & fetch timestamps
		const totalCount = await feedItems.count({ sourceId });
		const nextFetchAt = new Date(Date.now() + (source.fetchInterval || settings.globalFetchInterval) * 60 * 1000).toISOString();

		const updatedSource: Source = {
			...source,
			status: "active",
			itemCount: totalCount,
			lastFetchedAt: now,
			nextFetchAt,
			lastError: undefined,
			updatedAt: now,
		};
		await sources.put(sourceId, updatedSource);

		// 9. Write Import Log
		const logId = generateId("log");
		const duration = Date.now() - start;
		const log: ImportLog = {
			sourceId,
			sourceName: source.name,
			status: "success",
			itemsFound,
			itemsImported,
			itemsSkipped,
			itemsRejected,
			itemsUpdated,
			duration,
			feedTitle,
			feedUrl: source.url,
			createdAt: now,
		};
		await importLogs.put(logId, log);

		ctx.log.info("Finished feed import", { sourceId, name: source.name, imported: itemsImported, duration });
		return log;
	} catch (err: any) {
		const duration = Date.now() - start;
		const errMsg = err instanceof Error ? err.message : String(err);

		// Update Source with error status
		const nextFetchAt = new Date(Date.now() + (source.fetchInterval || settings.globalFetchInterval) * 60 * 1000).toISOString();
		const updatedSource: Source = {
			...source,
			status: "error",
			lastFetchedAt: now,
			nextFetchAt,
			lastError: errMsg,
			updatedAt: now,
		};
		await sources.put(sourceId, updatedSource);

		// Write Error Log
		const logId = generateId("log");
		const log: ImportLog = {
			sourceId,
			sourceName: source.name,
			status: "error",
			itemsFound: 0,
			itemsImported: 0,
			itemsSkipped: 0,
			itemsRejected: 0,
			itemsUpdated: 0,
			error: errMsg,
			duration,
			feedUrl: source.url,
			createdAt: now,
		};
		await importLogs.put(logId, log);

		ctx.log.error("Feed import failed", { sourceId, name: source.name, error: errMsg });
		return log;
	}
}

/**
 * Iterates through all active feed sources that are due for fetching.
 */
export async function fetchAllPendingSources(ctx: PluginContext, settings: PluginSettings): Promise<ImportLog[]> {
	const now = new Date().toISOString();
	const sourcesCol = ctx.storage.sources as StorageCollection<Source>;

	const queryResult = await sourcesCol.query({
		where: { status: "active" },
		limit: 1000,
	});

	const pending = queryResult.items.filter((item) => {
		const src = item.data;
		return !src.nextFetchAt || src.nextFetchAt <= now;
	});

	const logs: ImportLog[] = [];
	for (const item of pending) {
		const log = await fetchAndImportFeed(item.data, ctx, settings, item.id);
		logs.push(log);
	}

	return logs;
}
