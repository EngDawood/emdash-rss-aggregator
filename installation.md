# EmDash RSS Aggregator Plugin — Installation & Integration Guide

The RSS Aggregator plugin allows you to import, manage, and display external feed items as first-class content entries in your **EmDash CMS** site.

---

## 1. Prerequisites

- An **Astro** project integrated with **EmDash CMS** (`emdash` package version `0.17.x` or higher).
- Node.js environment configured with `pnpm`, `npm`, or `yarn`.

---

## 2. Installation

Add the plugin to your project's dependencies:

```bash
pnpm add emdash-rss-aggregator
```

*Note: If you are working in a monorepo structure or installing it locally, you can link the plugin in your `package.json`:*

```json
"dependencies": {
  "emdash-rss-aggregator": "link:./src/plugins/rss-aggregator"
}
```

---

## 3. Configuration & Registration

Open your `astro.config.mjs` file and follow these steps to register and optimize the plugin:

### Step A: Import the Plugin
```javascript
import { rssAggregatorPlugin } from "emdash-rss-aggregator";
```

### Step B: Add to Plugins List
Add `rssAggregatorPlugin()` to the `plugins` array under the `emdash` integration options:

```javascript
export default defineConfig({
  // ...
  integrations: [
    react(),
    emdash({
      // EmDash config options
      database: d1({ binding: "DB", session: "auto" }),
      storage: r2({ binding: "MEDIA" }),
      plugins: [
        // Other plugins...
        rssAggregatorPlugin({
          // Optional settings override (see Options section below)
          contentCollection: "feed-items",
          fetchInterval: 60,
          feedToPost: false,
          postCollection: "posts"
        }),
      ],
    }),
  ],
});
```

### Step C: Vite Dependency Optimization
To ensure smooth bundling of the plugin entrypoints, include the package names in your Vite configuration block inside `astro.config.mjs`:

```javascript
export default defineConfig({
  // ...
  vite: {
    optimizeDeps: {
      include: [
        // Other dependencies...
        "emdash-rss-aggregator",
        "emdash-rss-aggregator/sandbox"
      ]
    }
  }
});
```

---

## 4. Options Reference

The `rssAggregatorPlugin()` factory function accepts an optional configuration object with the following fields:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `contentCollection` | `string` | `"feed-items"` | The EmDash content collection name where imported feed items will be stored. |
| `fetchInterval` | `number` | `60` | The default polling frequency in minutes. Can be overridden per-source. |
| `feedToPost` | `boolean` | `false` | When enabled, imports feed items directly into your main post collection. |
| `postCollection` | `string` | `"posts"` | Target collection for Feed-to-Post items. |

---

## 5. Rendering Feed Items in Frontend

The plugin registers custom **Portable Text** blocks for feed embeds:
- `rssFeedEmbed`: Embeds an aggregated feed display on a page.
- `rssFeedSource`: Embeds items from a specific feed source.

The plugin provides native block renderers. To render them on the frontend, simply use the standard `<PortableText />` component from `"emdash/ui"`. No extra configuration or components mapping is required as EmDash resolves and mounts plugin blocks dynamically:

```astro
---
// src/pages/[locale]/posts/[slug].astro
import { PortableText } from "emdash/ui";

const { post } = Astro.props;
---

<article>
  <h1>{post.data.title}</h1>
  <div class="content">
    {/* This will automatically render the RSS Feed embeds! */}
    <PortableText value={post.data.content} />
  </div>
</article>
```

---

## 6. Automation & Cron Tasks

Upon activation, the plugin schedules the following background cron tasks:
- `fetch-pending-sources` (`*/15 * * * *`): Runs every 15 minutes to check feed sources and retrieve new entries.
- `cleanup-old-logs` (`0 3 * * *`): Runs daily at 3:00 AM to prune log history based on your log retention settings.
- `cleanup-old-items` (`0 4 * * *`): Runs daily at 4:00 AM to delete expired feed items.

Ensure your deployment environment (e.g. Cloudflare Workers cron triggers) is configured to handle EmDash cron tasks.
