/**
 * @dawod/emdash-rss-aggregator
 *
 * RSS/Atom XML feed parser. Uses regex-based XML extraction for compatibility
 * across edge runtimes, Cloudflare Workers, and standard Node.js environments.
 */

import type { ParsedFeed, ParsedItem, AuthorInfo, Enclosure } from "./types.js";

// ── Helpers ────────────────────────────────────────────────────────────

function getTagContent(xml: string, tagName: string): string | null {
	const regex = new RegExp('<(?:[a-zA-Z0-9_-]+:)?' + tagName + '(?:\\s+[^>]*?)?>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?' + tagName + '>', 'i');
	const match = xml.match(regex);
	return match ? match[1] : null;
}

function extractBlocks(xml: string, tagName: string): string[] {
	const regex = new RegExp('<(?:[a-zA-Z0-9_-]+:)?' + tagName + '(?:\\s+[^>]*?)?>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?' + tagName + '>', 'gi');
	const results: string[] = [];
	let match;
	while ((match = regex.exec(xml)) !== null) {
		results.push(match[1]);
	}
	return results;
}

function extractTagSelfOrNormal(xml: string, tagName: string): string | null {
	const regex = new RegExp('<(?:[a-zA-Z0-9_-]+:)?' + tagName + '(?:\\s+[^>]*?)?/?>', 'i');
	const match = xml.match(regex);
	return match ? match[0] : null;
}

function getAttributeValue(tagXml: string, attrName: string): string | null {
	const regex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
	const match = tagXml.match(regex);
	if (match) {
		return match[1] || match[2] || null;
	}
	return null;
}

function cleanCdata(text: string): string {
	if (!text) return "";
	return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function decodeHtmlEntities(text: string): string {
	if (!text) return "";
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/g, "'");
}

function normalizeDate(dateStr?: string): string | undefined {
	if (!dateStr) return undefined;
	const d = new Date(dateStr.trim());
	if (isNaN(d.getTime())) {
		return undefined;
	}
	return d.toISOString();
}

// ── Exports ────────────────────────────────────────────────────────────

/**
 * Extracts YouTube video ID from various YouTube URL formats.
 */
export function extractYouTubeVideoId(url: string): string | null {
	if (!url) return null;
	const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
	const match = url.match(regex);
	return match ? match[1] : null;
}

/**
 * Detects feed format (RSS 2.0/1.0, Atom, or unknown) from XML string.
 */
export function detectFeedFormat(xml: string): "rss2" | "rss1" | "atom" | "unknown" {
	if (/<feed/i.test(xml)) return "atom";
	if (/<rss/i.test(xml)) return "rss2";
	if (/<rdf:RDF/i.test(xml)) return "rss1";
	return "unknown";
}

/**
 * Parses an RSS/Atom XML string into a normalized ParsedFeed structure.
 */
export function parseFeed(xml: string): ParsedFeed {
	const format = detectFeedFormat(xml);

	if (format === "atom") {
		const feedTitle = decodeHtmlEntities(cleanCdata(getTagContent(xml, "title") || ""));
		const feedDescription = decodeHtmlEntities(cleanCdata(getTagContent(xml, "subtitle") || ""));
		const generator = decodeHtmlEntities(cleanCdata(getTagContent(xml, "generator") || ""));
		const imageUrl = decodeHtmlEntities(cleanCdata(getTagContent(xml, "logo") || getTagContent(xml, "icon") || "")) || undefined;

		// Extract alternate feed link
		const allLinkTags: string[] = [];
		const linkRegex = /<(?:[a-zA-Z0-9_-]+:)?link(?:\s+[^>]*?)?\/?>/gi;
		let linkMatch;
		while ((linkMatch = linkRegex.exec(xml)) !== null) {
			allLinkTags.push(linkMatch[0]);
		}
		let feedLink = "";
		for (const tag of allLinkTags) {
			const rel = getAttributeValue(tag, "rel");
			const href = getAttributeValue(tag, "href");
			if (href && (!rel || rel === "alternate")) {
				feedLink = href;
				break;
			}
		}
		if (!feedLink && allLinkTags.length > 0) {
			feedLink = getAttributeValue(allLinkTags[0], "href") || "";
		}

		const lastBuildDate = normalizeDate(getTagContent(xml, "updated") || "");

		const entryBlocks = extractBlocks(xml, "entry");
		const items: ParsedItem[] = entryBlocks.map((entryXml) => {
			const guid = decodeHtmlEntities(cleanCdata(getTagContent(entryXml, "id") || getTagContent(entryXml, "link") || ""));
			const title = decodeHtmlEntities(cleanCdata(getTagContent(entryXml, "title") || ""));

			// Extract entry link and enclosure link
			const entryLinkTags: string[] = [];
			const entryLinkRegex = /<(?:[a-zA-Z0-9_-]+:)?link(?:\s+[^>]*?)?\/?>/gi;
			let entryLinkMatch;
			while ((entryLinkMatch = entryLinkRegex.exec(entryXml)) !== null) {
				entryLinkTags.push(entryLinkMatch[0]);
			}
			let link = "";
			let enclosure: Enclosure | undefined;
			for (const tag of entryLinkTags) {
				const rel = getAttributeValue(tag, "rel");
				const href = getAttributeValue(tag, "href");
				if (href) {
					if (rel === "enclosure") {
						enclosure = {
							url: href,
							type: getAttributeValue(tag, "type") || undefined,
							length: Number(getAttributeValue(tag, "length")) || undefined,
						};
					} else if (!rel || rel === "alternate") {
						link = href;
					}
				}
			}
			if (!link && entryLinkTags.length > 0) {
				link = getAttributeValue(entryLinkTags[0], "href") || "";
			}

			const description = decodeHtmlEntities(cleanCdata(getTagContent(entryXml, "summary") || ""));
			const content = decodeHtmlEntities(cleanCdata(getTagContent(entryXml, "content") || ""));

			// Parse author
			const authorXml = getTagContent(entryXml, "author");
			let author: AuthorInfo | undefined;
			if (authorXml) {
				const authorName = decodeHtmlEntities(cleanCdata(getTagContent(authorXml, "name") || ""));
				if (authorName) {
					author = {
						name: authorName,
						email: decodeHtmlEntities(cleanCdata(getTagContent(authorXml, "email") || "")) || undefined,
						url: decodeHtmlEntities(cleanCdata(getTagContent(authorXml, "uri") || "")) || undefined,
					};
				}
			}

			const pubDate = normalizeDate(getTagContent(entryXml, "published") || getTagContent(entryXml, "updated") || "");

			// Parse categories
			const categoryTags: string[] = [];
			const categoryRegex = /<(?:[a-zA-Z0-9_-]+:)?category(?:\s+[^>]*?)?\/?>/gi;
			let categoryMatch;
			while ((categoryMatch = categoryRegex.exec(entryXml)) !== null) {
				categoryTags.push(categoryMatch[0]);
			}
			const categories = categoryTags.map((tag) => getAttributeValue(tag, "term")).filter(Boolean) as string[];

			const thumbnailTag = extractTagSelfOrNormal(entryXml, "media:thumbnail") || extractTagSelfOrNormal(entryXml, "thumbnail");
			const mediaThumbnail = thumbnailTag ? getAttributeValue(thumbnailTag, "url") || undefined : undefined;

			const mediaContentTag = extractTagSelfOrNormal(entryXml, "media:content") || extractTagSelfOrNormal(entryXml, "content");
			const mediaContent = mediaContentTag ? getAttributeValue(mediaContentTag, "url") || undefined : undefined;

			return {
				guid,
				title,
				link,
				description: description || undefined,
				content: content || undefined,
				author,
				pubDate,
				categories: categories.length ? categories : undefined,
				enclosure,
				mediaThumbnail,
				mediaContent,
			};
		});

		return {
			format,
			title: feedTitle,
			link: feedLink,
			description: feedDescription,
			generator: generator || undefined,
			imageUrl,
			lastBuildDate,
			items,
		};
	} else {
		// RSS 2.0 or RSS 1.0 (RDF)
		const channelXml = getTagContent(xml, "channel") || xml;
		const feedTitle = decodeHtmlEntities(cleanCdata(getTagContent(channelXml, "title") || ""));
		const feedLink = decodeHtmlEntities(cleanCdata(getTagContent(channelXml, "link") || ""));
		const feedDescription = decodeHtmlEntities(cleanCdata(getTagContent(channelXml, "description") || ""));
		const language = decodeHtmlEntities(cleanCdata(getTagContent(channelXml, "language") || ""));
		const lastBuildDate = normalizeDate(getTagContent(channelXml, "lastBuildDate") || getTagContent(channelXml, "pubDate") || "");
		const generator = decodeHtmlEntities(cleanCdata(getTagContent(channelXml, "generator") || ""));
		const imageXml = getTagContent(channelXml, "image");
		const imageUrl = imageXml ? decodeHtmlEntities(cleanCdata(getTagContent(imageXml, "url") || "")) : undefined;

		const itemBlocks = extractBlocks(xml, "item");
		const items: ParsedItem[] = itemBlocks.map((itemXml) => {
			const guid = decodeHtmlEntities(cleanCdata(getTagContent(itemXml, "guid") || getTagContent(itemXml, "link") || ""));
			const title = decodeHtmlEntities(cleanCdata(getTagContent(itemXml, "title") || ""));
			const link = decodeHtmlEntities(cleanCdata(getTagContent(itemXml, "link") || ""));
			const description = decodeHtmlEntities(cleanCdata(getTagContent(itemXml, "description") || ""));
			const content = decodeHtmlEntities(cleanCdata(getTagContent(itemXml, "content:encoded") || getTagContent(itemXml, "encoded") || ""));

			const creator = getTagContent(itemXml, "dc:creator") || getTagContent(itemXml, "creator") || getTagContent(itemXml, "author");
			const authorName = creator ? decodeHtmlEntities(cleanCdata(creator)) : undefined;
			const author: AuthorInfo | undefined = authorName ? { name: authorName } : undefined;

			const pubDate = normalizeDate(getTagContent(itemXml, "pubDate") || getTagContent(itemXml, "date") || getTagContent(itemXml, "dc:date") || "");

			const categoryBlocks = extractBlocks(itemXml, "category");
			const categories = categoryBlocks.map((c) => decodeHtmlEntities(cleanCdata(c))).filter(Boolean);

			const enclosureTag = extractTagSelfOrNormal(itemXml, "enclosure");
			let enclosure: Enclosure | undefined;
			if (enclosureTag) {
				const encUrl = getAttributeValue(enclosureTag, "url");
				if (encUrl) {
					enclosure = {
						url: encUrl,
						type: getAttributeValue(enclosureTag, "type") || undefined,
						length: Number(getAttributeValue(enclosureTag, "length")) || undefined,
					};
				}
			}

			const thumbnailTag = extractTagSelfOrNormal(itemXml, "media:thumbnail") || extractTagSelfOrNormal(itemXml, "thumbnail");
			const mediaThumbnail = thumbnailTag ? getAttributeValue(thumbnailTag, "url") || undefined : undefined;

			const mediaContentTag = extractTagSelfOrNormal(itemXml, "media:content") || extractTagSelfOrNormal(itemXml, "content");
			const mediaContent = mediaContentTag ? getAttributeValue(mediaContentTag, "url") || undefined : undefined;

			const commentsUrl = decodeHtmlEntities(cleanCdata(getTagContent(itemXml, "comments") || "")) || undefined;

			return {
				guid,
				title,
				link,
				description: description || undefined,
				content: content || undefined,
				author,
				pubDate,
				categories: categories.length ? categories : undefined,
				enclosure,
				mediaThumbnail,
				mediaContent,
				commentsUrl,
			};
		});

		return {
			format: format === "rss1" ? "rss1" : "rss2",
			title: feedTitle,
			link: feedLink,
			description: feedDescription,
			language: language || undefined,
			generator: generator || undefined,
			imageUrl,
			lastBuildDate,
			items,
		};
	}
}
