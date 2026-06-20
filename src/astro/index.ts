export { default as FeedList } from "./FeedList.astro";
export { default as FeedItem } from "./FeedItem.astro";
import RssFeedEmbed from "./RssFeedEmbed.astro";
import RssFeedSource from "./RssFeedSource.astro";

export const blockComponents = {
	rssFeedEmbed: RssFeedEmbed,
	rssFeedSource: RssFeedSource,
};
