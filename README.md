# @dawod/emdash-rss-aggregator

An RSS and Atom feed aggregator plugin for **EmDash CMS** on **Astro**. Automatically import, manage, filter, and display RSS/Atom feed items as first-class CMS content entries.

Features both standard aggregation and premium features (like Feed-to-Post conversion, keyword filtering, YouTube detection, and custom audio players).

--- 

## Features

- **Native Format**: Leverages React admin UI pages, Astro components, and direct database access.
- **Robust Feed Parser**: Native regex-based feed parser supporting RSS 2.0, RSS 1.0 (RDF), and Atom 1.0 XML formats without requiring DOMParser.
- **Deduplication & Reconciling**: Prevent duplicate imports using GUID or Title matching. Supports overwriting updated entries or preserving them.
- **Content Trimming**: Automatically truncate feed content to a specific word count.
- **Featured Image Extraction**: Extracts images from enclosure tags, Media RSS thumbnails, or parses them directly from item content body.
- **YouTube Detection**: Extracts YouTube video IDs from URLs and renders them.
- **Feed-to-Post (Premium)**: Automatically convert imported feed items into first-class CMS blog posts in your custom collections.
- **Keyword Filtering (Premium)**: Only import items matching (or excluding) specific keyword criteria in titles or descriptions.
- **Dashboard Widget**: Top-level stats on sources, active counts, and import times on your main admin dashboard.
- **Custom XML Feed Output**: Merge all feed items and expose them as a single custom XML feed.

---

## Installation

Install the package via `pnpm` (or npm/yarn):

```bash
pnpm add @dawod/emdash-rss-aggregator
```

### Integration Setup

Add the plugin to your `astro.config.mjs` under the `emdash` integration settings:

```javascript
import { defineConfig } from "astro/config";
import emdash from "emdash";
import { rssAggregatorPlugin } from "@dawod/emdash-rss-aggregator";

export default defineConfig({
  integrations: [
    emdash({
      plugins: [
        rssAggregatorPlugin({
          contentCollection: "feed-items", // Default destination collection
          fetchInterval: 60,             // Default fetch interval (minutes)
        }),
      ],
    }),
  ],
});
```

---

## Astro Rendering Components

This plugin exports pre-styled, customizable Astro components for displaying feed items in your theme templates.

### Displaying Feeds

Simply import `<FeedList />` in your Astro pages:

```astro
---
import { FeedList } from "@dawood/emdash-rss-aggregator/astro";
import Layout from "../layouts/Layout.astro";
---

<Layout title="Aggregated Feed">
  <main class="container">
    <h1>Latest News</h1>
    
    <!-- Render using the default display settings -->
    <FeedList displayId="default" limit={10} />
  </main>
</Layout>
```

### Options

The `<FeedList />` component accepts the following props:

- `displayId`: ID of the display template configured in the admin UI (defaults to `"default"`).
- `limit`: Override the maximum number of items to show.
- `sourceId`: Filter items specifically for a single feed source.
- `tag`: Filter items for sources belonging to a specific tag/folder.

---

## Developer API

You can fetch feed items directly in your frontend scripts or custom endpoints using the public JSON API:

`GET /api/plugins/rss-aggregator/public/items?display=default`

Optional query parameters:
- `limit` (number)
- `source` (sourceId)
- `tag` (tag string)
- `cursor` (opaque keyset pagination cursor)

---

## License

MIT License. See [LICENSE](./LICENSE) for details.
