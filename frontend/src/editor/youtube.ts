import { shellFetch } from '../lib/shell';

/**
 * Channel lookups for the editor, through the shell (the page cannot fetch youtube.com
 * itself). Nothing here costs API quota: channel pages and the public RSS feed only.
 */

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/** Accepts a channel id, a /channel/ URL, an @handle, or a handle URL. */
export async function resolveChannelId(input: string): Promise<string | null> {
  const value = input.trim();
  if (!value) {
    return null;
  }
  if (CHANNEL_ID.test(value)) {
    return value;
  }

  const fromUrl = /\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(value);
  if (fromUrl) {
    return fromUrl[1];
  }

  const url = /^https?:\/\//i.test(value)
    ? value.replace(/^http:/i, 'https:').replace('://youtube.com', '://www.youtube.com').replace('://m.youtube.com', '://www.youtube.com')
    : `https://www.youtube.com/${value.startsWith('@') ? value : `@${value}`}`;

  const html = await shellFetch(url);

  // The page is full of other channels' ids (recommendations, featured channels), so
  // the first "channelId" in it can belong to someone else - it did for @gamed_taiko.
  // The canonical link and the page's own metadata name the channel itself.
  const own = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/,
    /<meta itemprop="identifier" content="(UC[A-Za-z0-9_-]{22})"/,
    /"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/,
  ];
  for (const pattern of own) {
    const match = pattern.exec(html);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export interface ChannelFeed {
  name: string | null;
  titles: string[];
}

/** The channel's name and its 15 most recent video titles. */
export async function fetchChannelFeed(channelId: string): Promise<ChannelFeed> {
  const xml = await shellFetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
  const feed = new DOMParser().parseFromString(xml, 'application/xml');

  const name = feed.querySelector('feed > author > name')?.textContent ?? null;
  const titles = [...feed.querySelectorAll('entry > title')]
    .map((title) => title.textContent?.trim() ?? '')
    .filter(Boolean);

  return { name, titles };
}

/** The address to fill channelUrl with, from whatever was pasted to look the channel up. */
export function channelUrlFrom(input: string, channelId: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (value.startsWith('@') || (!CHANNEL_ID.test(value) && value)) {
    return `https://www.youtube.com/${value.startsWith('@') ? value : `@${value}`}`;
  }
  return `https://www.youtube.com/channel/${channelId}`;
}
