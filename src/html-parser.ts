/**
 * Lightweight HTML-to-PortableText parser.
 * Converts semantic HTML tags into Portable Text block and span structures.
 * Pure TypeScript — safe for Cloudflare Workers runtime (no DOM/JSDOM required).
 */

import type { PortableTextBlock } from "emdash";

export function markdownToHtml(text: string): string {
	if (!text) return "";

	let html = text.replace(/\r\n/g, "\n");

	// 1. Horizontal rules (---, ***, ___)
	html = html.replace(/^(?:---|\*\*\*|___)\s*$/gm, "<hr />");

	// 2. Headings (# to ######)
	html = html.replace(/^######\s+(.*?)$/gm, "<h6>$1</h6>");
	html = html.replace(/^#####\s+(.*?)$/gm, "<h5>$1</h5>");
	html = html.replace(/^####\s+(.*?)$/gm, "<h4>$1</h4>");
	html = html.replace(/^###\s+(.*?)$/gm, "<h3>$1</h3>");
	html = html.replace(/^##\s+(.*?)$/gm, "<h2>$1</h2>");
	html = html.replace(/^#\s+(.*?)$/gm, "<h1>$1</h1>");

	// 3. Bold: **text** or __text__
	html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/__(.*?)__/g, "<strong>$1</strong>");

	// 4. Italic: *text* or _text_
	html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
	html = html.replace(/_(.*?)_/g, "<em>$1</em>");

	// 5. Code: `code`
	html = html.replace(/`(.*?)`/g, "<code>$1</code>");

	// Check if the input already contains HTML block tags (like <p>, <div>, <h3>, etc.)
	const hasHtmlParagraphs = /<p\b[^>]*>|<div\b[^>]*>/i.test(html);
	if (!hasHtmlParagraphs) {
		// Convert newlines to paragraph tags
		const parts = html.split(/\n\s*\n/);
		html = parts
			.map((part) => {
				const trimmed = part.trim();
				if (!trimmed) return "";
				// If it's already wrapped in a block-level tag (like <h1>-<h6> or <hr />), don't wrap in <p>
				if (/^<(h[1-6]|hr|blockquote|ul|ol|li)\b[^>]*>/i.test(trimmed)) {
					return trimmed;
				}
				// Replace single newlines inside paragraph with <br />
				const withLineBreaks = trimmed.replace(/\n/g, "<br />");
				return `<p>${withLineBreaks}</p>`;
			})
			.filter(Boolean)
			.join("\n");
	}

	return html;
}


interface HtmlNode {
	type: "text" | "tag";
	name?: string;
	isClose?: boolean;
	attributes?: Record<string, string>;
	text?: string;
}

interface MarkDef {
	_key: string;
	_type: string;
	href?: string;
	[key: string]: unknown;
}

interface InternalSpan {
	_type: "span";
	_key: string;
	text: string;
	marks: string[];
}

interface InternalBlock {
	_type: string;
	_key: string;
	style: string;
	children: InternalSpan[];
	markDefs: MarkDef[];
	listItem?: string;
	level?: number;
}

function generateKey(): string {
	return Math.random().toString(36).substring(2, 10);
}

/**
 * Tokenize simple HTML string into tag and text nodes.
 */
function tokenizeHtml(html: string): HtmlNode[] {
	const tokens: HtmlNode[] = [];
	let index = 0;

	while (index < html.length) {
		const nextTagStart = html.indexOf("<", index);
		if (nextTagStart === -1) {
			const text = html.slice(index);
			if (text) {
				tokens.push({ type: "text", text });
			}
			break;
		}

		if (nextTagStart > index) {
			const text = html.slice(index, nextTagStart);
			if (text) {
				tokens.push({ type: "text", text });
			}
		}

		const nextTagEnd = html.indexOf(">", nextTagStart);
		if (nextTagEnd === -1) {
			const text = html.slice(nextTagStart);
			tokens.push({ type: "text", text });
			break;
		}

		const tagContent = html.slice(nextTagStart + 1, nextTagEnd);
		index = nextTagEnd + 1;

		if (tagContent.startsWith("/")) {
			const name = tagContent.slice(1).trim().toLowerCase();
			tokens.push({ type: "tag", name, isClose: true });
		} else {
			const isSelfClosing = tagContent.endsWith("/");
			const cleanedTag = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent.trim();

			const spaceIndex = cleanedTag.search(/\s/);
			let name = cleanedTag.toLowerCase();
			let attrStr = "";
			if (spaceIndex !== -1) {
				name = cleanedTag.slice(0, spaceIndex).toLowerCase();
				attrStr = cleanedTag.slice(spaceIndex + 1);
			}

			const attributes: Record<string, string> = {};
			if (attrStr) {
				const attrRegex = /([a-zA-Z0-9-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
				let match;
				while ((match = attrRegex.exec(attrStr)) !== null) {
					const attrName = match[1].toLowerCase();
					const attrValue = match[2] ?? match[3] ?? match[4] ?? "";
					attributes[attrName] = attrValue;
				}
			}

			tokens.push({ type: "tag", name, isClose: false, attributes });
			if (isSelfClosing) {
				tokens.push({ type: "tag", name, isClose: true });
			}
		}
	}

	return tokens;
}

/**
 * Converts semantic HTML text to Portable Text blocks.
 */
export function htmlToPortableText(html: string): PortableTextBlock[] {
	if (!html || !html.trim()) {
		return [];
	}

	const processedHtml = markdownToHtml(html);
	const tokens = tokenizeHtml(processedHtml);
	const blocks: InternalBlock[] = [];

	let currentBlock: InternalBlock | null = null;
	const activeMarks: string[] = [];
	const listStack: Array<"bullet" | "number"> = [];

	const blockTags = new Set([
		"p",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"blockquote",
		"li",
		"div",
		"pre",
		"section",
		"article",
	]);

	function ensureBlock(tag?: string): InternalBlock {
		if (currentBlock) return currentBlock;

		let style = "normal";
		let listItem: string | undefined;
		let level: number | undefined;

		if (tag) {
			if (tag.startsWith("h") && tag.length === 2) {
				style = tag;
			} else if (tag === "blockquote") {
				style = "blockquote";
			} else if (tag === "li") {
				listItem = listStack[listStack.length - 1] || "bullet";
				level = listStack.length || 1;
			}
		}

		currentBlock = {
			_type: "block",
			_key: generateKey(),
			style,
			children: [],
			markDefs: [],
		};

		if (listItem) {
			currentBlock.listItem = listItem;
			currentBlock.level = level;
		}

		blocks.push(currentBlock);
		return currentBlock;
	}

	function closeBlock() {
		if (currentBlock) {
			if (!currentBlock.children || currentBlock.children.length === 0) {
				currentBlock.children = [
					{
						_type: "span",
						_key: generateKey(),
						text: "",
						marks: [],
					},
				];
			}
			currentBlock = null;
		}
	}

	for (const token of tokens) {
		if (token.type === "tag") {
			const name = token.name || "";

			if (blockTags.has(name)) {
				if (token.isClose) {
					closeBlock();
				} else {
					closeBlock();
					ensureBlock(name);
				}
			} else if (name === "ul" || name === "ol") {
				if (token.isClose) {
					listStack.pop();
				} else {
					listStack.push(name === "ul" ? "bullet" : "number");
				}
			} else if (name === "strong" || name === "b") {
				if (token.isClose) {
					const idx = activeMarks.indexOf("strong");
					if (idx !== -1) activeMarks.splice(idx, 1);
				} else {
					activeMarks.push("strong");
				}
			} else if (name === "em" || name === "i") {
				if (token.isClose) {
					const idx = activeMarks.indexOf("em");
					if (idx !== -1) activeMarks.splice(idx, 1);
				} else {
					activeMarks.push("em");
				}
			} else if (name === "code") {
				if (token.isClose) {
					const idx = activeMarks.indexOf("code");
					if (idx !== -1) activeMarks.splice(idx, 1);
				} else {
					activeMarks.push("code");
				}
			} else if (name === "a") {
				if (token.isClose) {
					const linkMarkIdx = activeMarks.findIndex((m) => m.startsWith("link_"));
					if (linkMarkIdx !== -1) {
						activeMarks.splice(linkMarkIdx, 1);
					}
				} else {
					const href = token.attributes?.href || "";
					const markKey = `link_${generateKey()}`;
					
					const block = ensureBlock();
					block.markDefs.push({
						_key: markKey,
						_type: "link",
						href,
					});
					activeMarks.push(markKey);
				}
			} else if (name === "br") {
				const block = ensureBlock();
				const span: InternalSpan = {
					_type: "span",
					_key: generateKey(),
					text: "\n",
					marks: [...activeMarks],
				};
				block.children.push(span);
			} else if (name === "img" && !token.isClose) {
				const src = token.attributes?.src;
				if (src) {
					closeBlock();
					blocks.push({
						_type: "image",
						_key: generateKey(),
						url: src,
						src: src,
						alt: token.attributes?.alt || "",
					} as any);
				}
			}
		} else if (token.type === "text") {
			const isWhitespace = !token.text || !token.text.trim();
			if (isWhitespace && !currentBlock) {
				continue;
			}

			const block = ensureBlock();
			const span: InternalSpan = {
				_type: "span",
				_key: generateKey(),
				text: token.text || "",
				marks: [...activeMarks],
			};
			block.children.push(span);
		}
	}

	closeBlock();

	return blocks as unknown as PortableTextBlock[];
};

if (typeof globalThis !== "undefined") {
	(globalThis as any).htmlToPortableText = htmlToPortableText;
}
