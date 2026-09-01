import type { AppEnv } from "@/lib/env";

export type InstagramProfile = {
  id: string;
  appScopedUserId?: string;
  username: string;
  displayName?: string;
  profilePictureUrl?: string;
  accountType?: string;
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
}

export type FakeScenario = AppEnv["FAKE_PROVIDER_SCENARIO"];
