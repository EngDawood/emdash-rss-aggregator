import { describe, it, expect } from "vitest";
import { buildPublishPayload, DEFAULT_FIELD_MAP } from "./output.js";
import type { Source, FeedItem, OutputProfile } from "./types.js";

/**
 * EmDash turns every payload key into a literal SQL column
 * (ContentRepository.create → INSERT INTO ec_<collection> (...keys)), so a
 * payload key that is not a column fails the whole insert. These are the real
 * writable columns, read from D1; `title`/`slug`/`status`/`published_at` are
 * handled by EmDash itself and `seo` is split off before columns are built.
 */
const POSTS_COLUMNS = new Set(["title", "featured_image", "content", "excerpt"]);
const JOBS_COLUMNS = new Set([
	"img",
	"job_posting",
	"deadline",
	"locations",
	"summary",
	"job_descriptions",
	"title",
	"original_url",
]);

/** Keys EmDash consumes before it maps anything onto columns. */
const NON_COLUMN_KEYS = new Set(["slug", "status", "publishedAt", "seo"]);

const source: Source = {
	name: "Yemen-jobs",
	url: "https://jobs.engdawood.com/rss.xml",
	slug: "jobs",
} as Source;

const item: FeedItem = {
	sourceId: "src_1",
	guid: "g1",
	title: "Field Coordinator",
	url: "https://example.com/job/1",
	content: "<p>Run the field office.</p>",
	summary: "Runs the field office.",
	excerpt: "Runs the field office.",
	imageUrl: "https://example.com/a.png",
	publishedAt: "2026-08-01T00:00:00.000Z",
	author: { name: "HR Yemen" },
	mediaType: "article",
	importedAt: "2026-08-01T00:00:00.000Z",
	status: "approved",
} as FeedItem;

function profile(overrides: Partial<OutputProfile>): OutputProfile {
	return {
		name: "p",
		mode: "publish",
		collection: "posts",
		status: "published",
		requireApproval: false,
		slugPattern: "{itemSlug}",
		bodySource: "original",
		excerptSource: "summary",
		createdAt: "",
		updatedAt: "",
		...overrides,
	};
}

/** Keys that would be written as columns on the target collection. */
function columnKeys(payload: Record<string, unknown>): string[] {
	return Object.keys(payload).filter((k) => !NON_COLUMN_KEYS.has(k));
}

describe("buildPublishPayload", () => {
	it("emits only real columns for posts using the default field map", () => {
		const payload = buildPublishPayload({ source, item, profile: profile({ collection: "posts" }) });

		for (const key of columnKeys(payload)) {
			expect(POSTS_COLUMNS, `"${key}" is not a column on ec_posts`).toContain(key);
		}
		expect(payload.content).toBeDefined();
		expect(payload.excerpt).toBe("Runs the field office.");
	});

	it("emits only real columns for jobs using an explicit field map", () => {
		const payload = buildPublishPayload({
			source,
			item,
			profile: profile({
				collection: "jobs",
				fieldMap: {
					job_descriptions: "body",
					summary: "summary",
					original_url: "url",
					img: "image",
					deadline: "publishedAt",
					job_posting: "publishedAt",
					locations: "customField",
				},
			}),
		});

		for (const key of columnKeys(payload)) {
			expect(JOBS_COLUMNS, `"${key}" is not a column on ec_jobs`).toContain(key);
		}
		// jobs requires these three; a missing one is a NOT NULL failure.
		expect(payload.job_descriptions).toBeDefined();
		expect(payload.original_url).toBe("https://example.com/job/1");
		expect(payload.deadline).toBe("2026-08-01T00:00:00.000Z");
		// One token may feed two columns.
		expect(payload.job_posting).toBe(payload.deadline);
	});

	// The regression: hardcoded jobs aliases were injected into every payload,
	// which broke posts outright and — once `data` joined them — jobs too.
	it("never injects jobs fields into a collection that has no field map", () => {
		const payload = buildPublishPayload({ source, item, profile: profile({ collection: "posts" }) });

		for (const leaked of ["job_descriptions", "original_url", "deadline", "job_posting", "data", "meta", "categories", "author"]) {
			expect(payload).not.toHaveProperty(leaked);
		}
	});

	it("ignores mapped fields the publisher already owns", () => {
		const payload = buildPublishPayload({
			source,
			item,
			profile: profile({ fieldMap: { slug: "url", status: "author", content: "body" } }),
		});

		expect(payload.slug).toBe("field-coordinator");
		expect(payload.status).toBe("published");
		expect(payload.content).toBeDefined();
	});

	it("omits a mapped field whose value is absent rather than writing undefined", () => {
		const bare = { ...item, imageUrl: undefined, author: undefined } as FeedItem;
		const payload = buildPublishPayload({
			source,
			item: bare,
			profile: profile({ collection: "jobs", fieldMap: { img: "image", locations: "customField" } }),
		});

		expect(payload).not.toHaveProperty("img");
		expect(payload).not.toHaveProperty("locations");
	});

	it("falls back to the default field map when fieldMap is empty", () => {
		const payload = buildPublishPayload({ source, item, profile: profile({ fieldMap: {} }) });

		expect(Object.keys(DEFAULT_FIELD_MAP).every((k) => k in payload)).toBe(true);
	});
});
