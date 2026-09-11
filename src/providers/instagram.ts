import type { AppEnv } from "@/lib/env";

export type InstagramProfile = {
  id: string;
  appScopedUserId?: string;
  username: string;
  displayName?: string;
  profilePictureUrl?: string;
  accountType?: string;
};

export const INSIGHTS_SCOPE = "instagram_business_manage_insights";
export type MediaProductType = "FEED" | "REELS" | "STORY";
export type AccountSnapshot = {
  username: string; displayName?: string; profilePictureUrl?: string;
  followersCount: number; followsCount: number; mediaCount: number;
  biography?: string; website?: string;
};
export type AccountDayInsights = {
  day: string; followerGains: number | null; reach: number | null; views: number | null;
  profileViews: number | null; accountsEngaged: number | null; totalInteractions: number | null;
  likes: number | null; comments: number | null; shares: number | null; saves: number | null;
  replies: number | null; websiteClicks: number | null; profileLinksTaps: number | null;
};
export type MediaSummary = {
  id: string; mediaType: string; productType: MediaProductType; permalink?: string; thumbnailUrl?: string;
  caption?: string; postedAt: Date; likeCount?: number; commentsCount?: number;
};
export type MediaInsights = {
  views: number | null; reach: number | null; shares: number | null; saved: number | null;
  totalInteractions: number | null; replies: number | null; follows: number | null; profileVisits: number | null;
  reelsAvgWatchTimeMs: number | null; reelsTotalWatchTimeMs: number | null;
  storyTapsForward: number | null; storyTapsBack: number | null; storyExits: number | null;
};

export type ContainerInput = {
  accountId: string;
  accessToken: string;
  publicationType: "FEED_IMAGE" | "FEED_VIDEO" | "REEL" | "STORY_IMAGE" | "STORY_VIDEO" | "CAROUSEL";
  mediaUrls: string[];
  mediaKinds?: Array<"IMAGE" | "VIDEO">;
  children?: string[];
  isCarouselItem?: boolean;
  caption?: string;
  shareToFeed?: boolean;
};

export interface InstagramProvider {
  getProfile(accessToken: string): Promise<InstagramProfile>;
  createMediaContainer(input: ContainerInput): Promise<string>;
  getContainerStatus(containerId: string, accessToken: string): Promise<"PROCESSING" | "FINISHED" | "PUBLISHED" | "ERROR">;
  publishContainer(accountId: string, containerId: string, accessToken: string): Promise<string>;
  getPublishingLimit(accountId: string, accessToken: string): Promise<{ usage: number; total: number }>;
  refreshAccessToken(accessToken: string): Promise<{ accessToken: string; expiresIn: number }>;
  getAccountSnapshot(accessToken: string): Promise<AccountSnapshot>;
  getAccountInsights(accountId: string, accessToken: string, days: string[]): Promise<AccountDayInsights[]>;
  listRecentMedia(accountId: string, accessToken: string, since: Date): Promise<MediaSummary[]>;
  listLiveStories(accountId: string, accessToken: string): Promise<MediaSummary[]>;
  getMediaInsights(mediaId: string, accessToken: string, productType: MediaProductType): Promise<MediaInsights>;
}

export type FakeScenario = AppEnv["FAKE_PROVIDER_SCENARIO"];
