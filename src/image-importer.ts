/**
 * @dawod/emdash-rss-aggregator
 *
 * Best-effort image importer. Downloads a feed item's featured image and
 * (optionally) in-content images, stores them in EmDash's media library
 * (R2/local), and rewrites `<img src>` URLs in the content to point at the
 * stored media.
 *
 * Cloudflare Workers runtime: no Node.js APIs. Uses fetch/Response,
 * ArrayBuffer, regex and standard Web APIs only. NEVER throws to the caller —
 * on any failure it returns the original content unchanged plus whatever media
 * was successfully imported.
 */

import type { PluginContext } from "emdash";
import type { PluginSettings } from "./types.js";

// ── Public contract ────────────────────────────────────────────────────

export interface ImageImportResult {
	featuredUrl?: string; // media URL for the imported featured image (if any)
	featuredMediaId?: string;
	content: string; // content HTML, with <img src> rewritten to media URLs where imported
	mediaIds: string[]; // all media ids created
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Fallback per-item download cap when the setting is 0 or negative. */
const DEFAULT_MAX_PER_ITEM = 10;

const IMG_SRC_REGEX = /<img[^>]+src=["']([^"']+)["']/gi;

/** Map a Content-Type to a file extension. */
function extensionForContentType(contentType: string): string | undefined {
	const ct = contentType.toLowerCase();
	if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
	if (ct.includes("png")) return ".png";
	if (ct.includes("gif")) return ".gif";
	if (ct.includes("webp")) return ".webp";
	if (ct.includes("svg")) return ".svg";
	if (ct.includes("avif")) return ".avif";
	return undefined;
}

/** Derive the origin of a URL, or null if it can't be parsed. */
function originOf(url: string): string | null {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

/** Build a safe filename from a URL, inferring an extension from the content type. */
function deriveFilename(url: string, contentType: string, index: number): string {
	let base = "";
	try {
		const pathname = new URL(url).pathname;
		const last = pathname.split("/").filter(Boolean).pop() || "";
		base = last.replace(/[^a-zA-Z0-9._-]/g, "");
	} catch {
		base = "";
	}
	if (!base) base = `image-${index}`;

	// Ensure the filename has an extension matching the content type.
	if (!/\.[a-zA-Z0-9]+$/.test(base)) {
		const ext = extensionForContentType(contentType) || ".jpg";
		base = base + ext;
	}
	return base;
}

/** Collect candidate image URLs from content HTML. */
function extractContentImageUrls(content: string): string[] {
	const urls: string[] = [];
	let match: RegExpExecArray | null;
	IMG_SRC_REGEX.lastIndex = 0;
	while ((match = IMG_SRC_REGEX.exec(content)) !== null) {
		if (match[1]) urls.push(match[1]);
	}
	return urls;
}

// ── Importer ───────────────────────────────────────────────────────────

/**
 * Downloads candidate images and stores them in the media library, rewriting
 * `<img src>` URLs in the content to the stored media URLs where imported.
 * Best-effort: never throws.
 */
export async function importImages(
	ctx: PluginContext,
	settings: PluginSettings,
	opts: { featuredImageUrl?: string; content: string; importContentImages: boolean },
): Promise<ImageImportResult> {
	const content = opts.content || "";
	const result: ImageImportResult = { content, mediaIds: [] };

	// 1. No media capability → no-op.
	const upload = ctx.media?.upload;
	if (!upload) {
		return result;
	}

	const siteOrigin = ctx.site?.url ? originOf(ctx.site.url) : null;

	// 2. Collect & de-duplicate candidate URLs (featured first).
	const seen = new Set<string>();
	const candidates: string[] = [];
	const addCandidate = (raw?: string) => {
		if (!raw) return;
		const url = raw.trim();
		if (!url) return;
		if (url.startsWith("data:")) return;
		if (siteOrigin && originOf(url) === siteOrigin) return; // already local
		if (seen.has(url)) return;
		seen.add(url);
		candidates.push(url);
	};

	addCandidate(opts.featuredImageUrl);
	if (opts.importContentImages) {
		for (const url of extractContentImageUrls(content)) {
			addCandidate(url);
		}
	}

	if (candidates.length === 0) {
		return result;
	}

	// Cap total downloads.
	const maxPerItem = settings.imageImportMaxPerItem > 0 ? settings.imageImportMaxPerItem : DEFAULT_MAX_PER_ITEM;
	const limited = candidates.slice(0, maxPerItem);

	// 3. Download & upload each candidate sequentially.
	const rewrites = new Map<string, string>(); // originalUrl → newUrl
	const userAgent = settings.userAgent || "EmDash RSS Aggregator/1.0";
	const timeout = settings.fetchTimeout || 30000;

	for (let i = 0; i < limited.length; i++) {
		const url = limited[i];
		try {
			if (!ctx.http?.fetch) break;
			const response = await ctx.http.fetch(url, {
				headers: { "User-Agent": userAgent },
				signal: AbortSignal.timeout(timeout),
			});
			if (!response.ok) {
				ctx.log.warn("Image fetch returned non-OK status", { url, status: response.status });
				continue;
			}

			const contentType = response.headers.get("Content-Type")?.split(";")[0].trim() || "image/jpeg";
			if (!contentType.toLowerCase().startsWith("image/")) {
				ctx.log.warn("Skipping non-image content type", { url, contentType });
				continue;
			}

			const bytes = await response.arrayBuffer();
			const filename = deriveFilename(url, contentType, i);

			const uploaded = await upload(filename, contentType, bytes);
			if (uploaded?.mediaId) {
				result.mediaIds.push(uploaded.mediaId);
			}
			if (uploaded?.url) {
				rewrites.set(url, uploaded.url);
			}

			// Track featured image result.
			if (opts.featuredImageUrl && url === opts.featuredImageUrl.trim()) {
				result.featuredUrl = uploaded?.url;
				result.featuredMediaId = uploaded?.mediaId;
			}
		} catch (err) {
			ctx.log.warn("Failed to import image", { url, error: String(err) });
			continue;
		}
	}

	// 4. Rewrite content img src URLs for successful uploads.
	if (rewrites.size > 0 && content) {
		let rewritten = content;
		for (const [original, newUrl] of rewrites) {
			rewritten = rewritten.split(original).join(newUrl);
		}
		result.content = rewritten;
	}

	return result;
}
