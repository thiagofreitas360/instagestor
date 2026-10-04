import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const userRole = pgEnum("user_role", ["ADMIN"]);
export const organizationStatus = pgEnum("organization_status", ["ACTIVE", "SUSPENDED"]);
export const organizationMemberRole = pgEnum("organization_member_role", ["OWNER", "ADMIN", "MEMBER"]);
export const instagramAccountStatus = pgEnum("instagram_account_status", [
  "CONNECTED",
  "TOKEN_EXPIRING",
  "REAUTH_REQUIRED",
  "DISCONNECTED",
  "ERROR",
  "DISABLED",
  "BANNED",
]);
export const mediaKind = pgEnum("media_kind", ["IMAGE", "VIDEO"]);
export const mediaProcessingStatus = pgEnum("media_processing_status", [
  "UPLOADING",
  "READY",
  "INVALID",
  "DELETED",
]);
export const storageProvider = pgEnum("storage_provider", ["LOCAL", "S3"]);
export const campaignStatus = pgEnum("campaign_status", [
  "DRAFT",
  "SCHEDULED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "PARTIALLY_FAILED",
  "FAILED",
  "CANCELLED",
]);
export const publicationType = pgEnum("publication_type", [
  "FEED_IMAGE",
  "FEED_VIDEO",
  "REEL",
  "STORY_IMAGE",
  "STORY_VIDEO",
  "CAROUSEL",
]);
export const delayMode = pgEnum("delay_mode", ["FIXED", "RANDOM"]);
export const targetOrder = pgEnum("target_order", ["SELECTED", "RANDOM", "USERNAME"]);
export const publicationJobStatus = pgEnum("publication_job_status", [
  "DRAFT",
  "QUEUED",
  "CLAIMED",
  "CREATING_CONTAINER",
  "WAITING_FOR_CONTAINER",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "PUBLISHED",
  "RETRY_WAIT",
  "RECONCILIATION_REQUIRED",
  "FAILED",
  "CANCELLED",
]);
export const publishingPhase = pgEnum("publishing_phase", [
  "CREATE_CONTAINER",
  "WAIT_CONTAINER",
  "PUBLISH",
  "DONE",
]);
export const campaignOrigin = pgEnum("campaign_origin", ["MANUAL", "LOOP", "SCHEDULE"]);
export const loopStatus = pgEnum("loop_status", ["ACTIVE", "PAUSED"]);
export const automatedMediaType = pgEnum("automated_media_type", ["REELS", "IMAGE", "MIXED"]);
export const scheduleStatus = pgEnum("schedule_status", ["ACTIVE", "CANCELLED"]);
export const appTheme = pgEnum("app_theme", ["LIGHT", "DARK"]);
export const autoCommentStatus = pgEnum("auto_comment_status", [
  "QUEUED",
  "PROCESSING",
  "PUBLISHED",
  "RETRY_WAIT",
  "RECONCILIATION_REQUIRED",
  "FAILED",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("ADMIN"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  sessionVersion: integer("session_version").notNull().default(0),
  ...timestamps,
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: organizationStatus("status").notNull().default("ACTIVE"),
  ...timestamps,
}, (table) => [
  check("organizations_name_valid", sql`length(trim(${table.name})) BETWEEN 1 AND 120`),
  check("organizations_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
]);

// Apps do Meta for Developers de cada cliente; sem nenhum, o OAuth usa o app de INSTAGRAM_APP_ID.
export const metaApps = pgTable(
  "meta_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    appId: text("app_id").notNull(),
    encryptedAppSecret: text("encrypted_app_secret").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("meta_apps_organization_id_unique").on(table.organizationId, table.id),
    unique("meta_apps_organization_app_id_unique").on(table.organizationId, table.appId),
    check("meta_apps_name_valid", sql`length(trim(${table.name})) BETWEEN 1 AND 60`),
    check("meta_apps_app_id_valid", sql`${table.appId} ~ '^[0-9]{10,20}$'`),
  ],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organizationMemberRole("role").notNull().default("MEMBER"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("organization_members_user_idx").on(table.userId),
  ],
);

export const instagramAccounts = pgTable(
  "instagram_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    instagramUserId: text("instagram_user_id").notNull().unique(),
    appScopedUserId: text("app_scoped_user_id").unique(),
    username: text("username").notNull(),
    displayName: text("display_name"),
    profilePictureUrl: text("profile_picture_url"),
    accountType: text("account_type"),
    status: instagramAccountStatus("status").notNull().default("CONNECTED"),
    encryptedAccessToken: text("encrypted_access_token"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).defaultNow().notNull(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    tokenLastRefreshedAt: timestamp("token_last_refreshed_at", { withTimezone: true }),
    tokenLastCheckedAt: timestamp("token_last_checked_at", { withTimezone: true }),
    lastSuccessfulApiCallAt: timestamp("last_successful_api_call_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    publishingLimitUsage: integer("publishing_limit_usage"),
    publishingLimitTotal: integer("publishing_limit_total"),
    publishingLimitCheckedAt: timestamp("publishing_limit_checked_at", { withTimezone: true }),
    grantedScopes: text("granted_scopes").array(),
    biography: text("biography"),
    website: text("website"),
    insightsSyncedAt: timestamp("insights_synced_at", { withTimezone: true }),
    insightsErrorCode: text("insights_error_code"),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    banReason: text("ban_reason"),
    metaAppId: uuid("meta_app_id").references(() => metaApps.id, { onDelete: "set null" }),
    ...timestamps,
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  },
  (table) => [
    unique("instagram_accounts_organization_id_unique").on(table.organizationId, table.id),
    index("instagram_accounts_organization_status_idx").on(table.organizationId, table.status),
    index("instagram_accounts_organization_username_idx").on(table.organizationId, table.username),
  ],
);

export const accountGroups = pgTable(
  "account_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").notNull().default("#4f46e5"),
    ...timestamps,
  },
  (table) => [
    unique("account_groups_organization_id_unique").on(table.organizationId, table.id),
    uniqueIndex("account_groups_organization_name_unique").on(table.organizationId, sql`lower(${table.name})`),
    check("account_groups_color_valid", sql`${table.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

export const accountGroupMembers = pgTable(
  "account_group_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => accountGroups.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.instagramAccountId] }),
    index("account_group_members_organization_idx").on(table.organizationId),
    foreignKey({
      columns: [table.organizationId, table.groupId],
      foreignColumns: [accountGroups.organizationId, accountGroups.id],
      name: "account_group_members_organization_group_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.instagramAccountId],
      foreignColumns: [instagramAccounts.organizationId, instagramAccounts.id],
      name: "account_group_members_organization_account_fk",
    }).onDelete("cascade"),
  ],
);

export const mediaFolders = pgTable(
  "media_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("media_folders_organization_id_unique").on(table.organizationId, table.id),
    uniqueIndex("media_folders_organization_name_unique").on(table.organizationId, sql`lower(${table.name})`),
    check("media_folders_name_valid", sql`length(trim(${table.name})) BETWEEN 1 AND 120`),
  ],
);

export const loops = pgTable(
  "loops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .unique()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: loopStatus("status").notNull().default("ACTIVE"),
    defaultCaption: text("default_caption").notNull().default(""),
    autoCommentText: text("auto_comment_text").notNull().default(""),
    autoCommentDelayMinutes: integer("auto_comment_delay_minutes").notNull().default(5),
    minIntervalMinutes: integer("min_interval_minutes").notNull().default(20),
    maxIntervalMinutes: integer("max_interval_minutes").notNull().default(40),
    dailyLimitPerAccount: integer("daily_limit_per_account").notNull().default(40),
    tieredLimits: boolean("tiered_limits").notNull().default(false),
    tierFollowerThreshold: integer("tier_follower_threshold").notNull().default(10000),
    tier1DailyLimit: integer("tier1_daily_limit").notNull().default(10),
    tier1MinIntervalMinutes: integer("tier1_min_interval_minutes").notNull().default(60),
    tier1MaxIntervalMinutes: integer("tier1_max_interval_minutes").notNull().default(120),
    mediaType: automatedMediaType("media_type").notNull().default("REELS"),
    imageEveryN: integer("image_every_n").notNull().default(0),
    noRepeat: boolean("no_repeat").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    unique("loops_organization_id_unique").on(table.organizationId, table.id),
    index("loops_organization_status_idx").on(table.organizationId, table.status),
    foreignKey({
      columns: [table.organizationId, table.campaignId],
      foreignColumns: [campaigns.organizationId, campaigns.id],
      name: "loops_organization_campaign_fk",
    }).onDelete("restrict"),
    check("loops_name_valid", sql`length(trim(${table.name})) BETWEEN 1 AND 160`),
    check(
      "loops_limits_valid",
      sql`${table.minIntervalMinutes} BETWEEN 1 AND 1440 AND ${table.maxIntervalMinutes} BETWEEN ${table.minIntervalMinutes} AND 1440 AND ${table.dailyLimitPerAccount} BETWEEN 1 AND 200`,
    ),
    check("loops_auto_comment_delay_valid", sql`${table.autoCommentDelayMinutes} BETWEEN 0 AND 10080`),
    check(
      "loops_tier_limits_valid",
      sql`${table.tierFollowerThreshold} BETWEEN 0 AND 100000000 AND ${table.tier1DailyLimit} BETWEEN 1 AND 200 AND ${table.tier1MinIntervalMinutes} BETWEEN 1 AND 1440 AND ${table.tier1MaxIntervalMinutes} BETWEEN ${table.tier1MinIntervalMinutes} AND 1440`,
    ),
    check(
      "loops_image_frequency_valid",
      sql`(${table.mediaType} = 'MIXED' AND ${table.imageEveryN} BETWEEN 1 AND 100) OR (${table.mediaType} <> 'MIXED' AND ${table.imageEveryN} = 0)`,
    ),
  ],
);

export const loopAccounts = pgTable(
  "loop_accounts",
  {
    organizationId: uuid("organization_id").notNull(),
    loopId: uuid("loop_id").notNull().references(() => loops.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id").notNull().references(() => instagramAccounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.loopId, table.instagramAccountId] }),
    foreignKey({
      columns: [table.organizationId, table.loopId],
      foreignColumns: [loops.organizationId, loops.id],
      name: "loop_accounts_organization_loop_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.instagramAccountId],
      foreignColumns: [instagramAccounts.organizationId, instagramAccounts.id],
      name: "loop_accounts_organization_account_fk",
    }).onDelete("cascade"),
  ],
);

export const loopMedia = pgTable(
  "loop_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    loopId: uuid("loop_id").notNull().references(() => loops.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("loop_media_loop_asset_unique").on(table.loopId, table.mediaAssetId),
    unique("loop_media_loop_position_unique").on(table.loopId, table.position),
    foreignKey({
      columns: [table.organizationId, table.loopId],
      foreignColumns: [loops.organizationId, loops.id],
      name: "loop_media_organization_loop_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.mediaAssetId],
      foreignColumns: [mediaAssets.organizationId, mediaAssets.id],
      name: "loop_media_organization_asset_fk",
    }).onDelete("restrict"),
    check("loop_media_position_nonnegative", sql`${table.position} >= 0`),
  ],
);

export const loopAccountState = pgTable(
  "loop_account_state",
  {
    organizationId: uuid("organization_id").notNull(),
    loopId: uuid("loop_id").notNull().references(() => loops.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id").notNull().references(() => instagramAccounts.id, { onDelete: "cascade" }),
    usedMediaIds: uuid("used_media_ids").array().notNull().default(sql`'{}'::uuid[]`),
    videosSinceImage: integer("videos_since_image").notNull().default(0),
    finished: boolean("finished").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.loopId, table.instagramAccountId] }),
    foreignKey({
      columns: [table.organizationId, table.loopId],
      foreignColumns: [loops.organizationId, loops.id],
      name: "loop_account_state_organization_loop_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.instagramAccountId],
      foreignColumns: [instagramAccounts.organizationId, instagramAccounts.id],
      name: "loop_account_state_organization_account_fk",
    }).onDelete("cascade"),
    check("loop_account_state_video_count_valid", sql`${table.videosSinceImage} >= 0`),
  ],
);

export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().unique().references(() => campaigns.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: scheduleStatus("status").notNull().default("ACTIVE"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    times: text("times").array().notNull(),
    daysOfWeek: integer("days_of_week").array().notNull(),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    mediaType: automatedMediaType("media_type").notNull(),
    defaultCaption: text("default_caption").notNull().default(""),
    autoCommentText: text("auto_comment_text").notNull().default(""),
    autoCommentDelayMinutes: integer("auto_comment_delay_minutes").notNull().default(5),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    unique("schedules_organization_id_unique").on(table.organizationId, table.id),
    index("schedules_organization_status_idx").on(table.organizationId, table.status),
    foreignKey({
      columns: [table.organizationId, table.campaignId],
      foreignColumns: [campaigns.organizationId, campaigns.id],
      name: "schedules_organization_campaign_fk",
    }).onDelete("restrict"),
    check("schedules_name_valid", sql`length(trim(${table.name})) BETWEEN 1 AND 160`),
    check("schedules_period_valid", sql`${table.endDate} >= ${table.startDate}`),
    check("schedules_media_type_valid", sql`${table.mediaType} IN ('REELS', 'IMAGE')`),
    check("schedules_auto_comment_delay_valid", sql`${table.autoCommentDelayMinutes} BETWEEN 0 AND 10080`),
  ],
);

export const scheduleAccounts = pgTable(
  "schedule_accounts",
  {
    organizationId: uuid("organization_id").notNull(),
    scheduleId: uuid("schedule_id").notNull().references(() => schedules.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id").notNull().references(() => instagramAccounts.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.scheduleId, table.instagramAccountId] }),
    foreignKey({
      columns: [table.organizationId, table.scheduleId],
      foreignColumns: [schedules.organizationId, schedules.id],
      name: "schedule_accounts_organization_schedule_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.instagramAccountId],
      foreignColumns: [instagramAccounts.organizationId, instagramAccounts.id],
      name: "schedule_accounts_organization_account_fk",
    }).onDelete("cascade"),
  ],
);

export const scheduleMedia = pgTable(
  "schedule_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    scheduleId: uuid("schedule_id").notNull().references(() => schedules.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").notNull().references(() => mediaAssets.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (table) => [
    unique("schedule_media_schedule_asset_unique").on(table.scheduleId, table.mediaAssetId),
    unique("schedule_media_schedule_position_unique").on(table.scheduleId, table.position),
    foreignKey({
      columns: [table.organizationId, table.scheduleId],
      foreignColumns: [schedules.organizationId, schedules.id],
      name: "schedule_media_organization_schedule_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.mediaAssetId],
      foreignColumns: [mediaAssets.organizationId, mediaAssets.id],
      name: "schedule_media_organization_asset_fk",
    }).onDelete("restrict"),
  ],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    originalFilename: text("original_filename").notNull(),
    storageProvider: storageProvider("storage_provider").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    mediaKind: mediaKind("media_kind").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: real("duration_seconds"),
    folderId: uuid("folder_id").references(() => mediaFolders.id, { onDelete: "set null" }),
    processingStatus: mediaProcessingStatus("processing_status").notNull().default("UPLOADING"),
    validationError: text("validation_error"),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("media_assets_organization_id_unique").on(table.organizationId, table.id),
    index("media_assets_organization_status_idx").on(table.organizationId, table.processingStatus),
    index("media_assets_organization_folder_idx").on(table.organizationId, table.folderId),
    check("media_assets_size_positive", sql`${table.sizeBytes} > 0`),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    origin: campaignOrigin("origin").notNull().default("MANUAL"),
    publicationType: publicationType("publication_type").notNull(),
    caption: text("caption"),
    status: campaignStatus("status").notNull().default("DRAFT"),
    startAt: timestamp("start_at", { withTimezone: true }),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    delayMode: delayMode("delay_mode").notNull().default("FIXED"),
    delayFixedSeconds: integer("delay_fixed_seconds").default(0),
    delayMinSeconds: integer("delay_min_seconds"),
    delayMaxSeconds: integer("delay_max_seconds"),
    targetOrder: targetOrder("target_order").notNull().default("SELECTED"),
    shareToFeed: boolean("share_to_feed").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    unique("campaigns_organization_id_unique").on(table.organizationId, table.id),
    index("campaigns_organization_status_idx").on(table.organizationId, table.status),
    check(
      "campaigns_delay_values_valid",
      sql`(${table.delayMode} = 'FIXED' AND ${table.delayFixedSeconds} IS NOT NULL AND ${table.delayFixedSeconds} >= 0) OR (${table.delayMode} = 'RANDOM' AND ${table.delayMinSeconds} IS NOT NULL AND ${table.delayMaxSeconds} IS NOT NULL AND ${table.delayMinSeconds} >= 0 AND ${table.delayMaxSeconds} >= ${table.delayMinSeconds})`,
    ),
  ],
);

export const campaignMedia = pgTable(
  "campaign_media",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.campaignId, table.position] }),
    unique("campaign_media_asset_unique").on(table.campaignId, table.mediaAssetId),
    foreignKey({
      columns: [table.organizationId, table.campaignId],
      foreignColumns: [campaigns.organizationId, campaigns.id],
      name: "campaign_media_organization_campaign_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.mediaAssetId],
      foreignColumns: [mediaAssets.organizationId, mediaAssets.id],
      name: "campaign_media_organization_asset_fk",
    }).onDelete("restrict"),
    check("campaign_media_position_nonnegative", sql`${table.position} >= 0`),
  ],
);

export const campaignTargets = pgTable(
  "campaign_targets",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.campaignId, table.instagramAccountId] }),
    unique("campaign_targets_position_unique").on(table.campaignId, table.position),
    foreignKey({
      columns: [table.organizationId, table.campaignId],
      foreignColumns: [campaigns.organizationId, campaigns.id],
      name: "campaign_targets_organization_campaign_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.instagramAccountId],
      foreignColumns: [instagramAccounts.organizationId, instagramAccounts.id],
      name: "campaign_targets_organization_account_fk",
    }).onDelete("restrict"),
  ],
);

export const publicationJobs = pgTable(
  "publication_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    loopId: uuid("loop_id").references(() => loops.id, { onDelete: "set null" }),
    scheduleId: uuid("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
    directMediaAssetId: uuid("direct_media_asset_id").references(() => mediaAssets.id, { onDelete: "restrict" }),
    publicationTypeOverride: publicationType("publication_type_override"),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "restrict" }),
    publicationPosition: integer("publication_position").notNull().default(0),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: publicationJobStatus("status").notNull().default("QUEUED"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
    fencingToken: bigint("fencing_token", { mode: "number" }).notNull().default(0),
    metaContainerId: text("meta_container_id"),
    metaChildContainerIds: text("meta_child_container_ids").array(),
    containerStartedAt: timestamp("container_started_at", { withTimezone: true }),
    metaMediaId: text("meta_media_id"),
    publishingPhase: publishingPhase("publishing_phase"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorType: text("last_error_type"),
    lastErrorMessage: text("last_error_message"),
    lastHttpStatus: integer("last_http_status"),
    reconciliationRequired: boolean("reconciliation_required").notNull().default(false),
    autoCommentText: text("auto_comment_text"),
    autoCommentDelayMinutes: integer("auto_comment_delay_minutes").notNull().default(0),
    autoCommentStatus: autoCommentStatus("auto_comment_status"),
    autoCommentScheduledAt: timestamp("auto_comment_scheduled_at", { withTimezone: true }),
    autoCommentAttemptCount: integer("auto_comment_attempt_count").notNull().default(0),
    autoCommentMaxAttempts: integer("auto_comment_max_attempts").notNull().default(5),
    autoCommentLockedAt: timestamp("auto_comment_locked_at", { withTimezone: true }),
    autoCommentLockedBy: text("auto_comment_locked_by"),
    autoCommentLockExpiresAt: timestamp("auto_comment_lock_expires_at", { withTimezone: true }),
    autoCommentFencingToken: bigint("auto_comment_fencing_token", { mode: "number" }).notNull().default(0),
    metaCommentId: text("meta_comment_id"),
    autoCommentPublishedAt: timestamp("auto_comment_published_at", { withTimezone: true }),
    autoCommentLastErrorCode: text("auto_comment_last_error_code"),
    autoCommentLastErrorType: text("auto_comment_last_error_type"),
    autoCommentLastErrorMessage: text("auto_comment_last_error_message"),
    autoCommentLastHttpStatus: integer("auto_comment_last_http_status"),
    ...timestamps,
  },
  (table) => [
    unique("publication_jobs_organization_id_unique").on(table.organizationId, table.id),
    uniqueIndex("publication_jobs_campaign_account_position_unique").on(
      table.campaignId,
      table.instagramAccountId,
      table.publicationPosition,
    ).where(sql`${table.loopId} IS NULL`),
    uniqueIndex("publication_jobs_one_active_per_loop_account").on(table.loopId, table.instagramAccountId).where(
      sql`${table.loopId} IS NOT NULL AND ${table.status} IN ('DRAFT', 'QUEUED', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH', 'PUBLISHING', 'RETRY_WAIT')`,
    ),
    index("publication_jobs_organization_status_scheduled_idx").on(table.organizationId, table.status, table.scheduledAt),
    index("publication_jobs_organization_status_retry_idx").on(table.organizationId, table.status, table.nextAttemptAt),
    index("publication_jobs_organization_account_idx").on(table.organizationId, table.instagramAccountId),
    index("publication_jobs_organization_campaign_idx").on(table.organizationId, table.campaignId),
    index("publication_jobs_stale_lock_idx").on(table.lockExpiresAt),
    index("publication_jobs_auto_comment_due_idx").on(table.autoCommentStatus, table.autoCommentScheduledAt),
    index("publication_jobs_auto_comment_stale_lock_idx").on(table.autoCommentLockExpiresAt),
    foreignKey({
      columns: [table.organizationId, table.campaignId],
      foreignColumns: [campaigns.organizationId, campaigns.id],
      name: "publication_jobs_organization_campaign_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.instagramAccountId],
      foreignColumns: [instagramAccounts.organizationId, instagramAccounts.id],
      name: "publication_jobs_organization_account_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.directMediaAssetId],
      foreignColumns: [mediaAssets.organizationId, mediaAssets.id],
      name: "publication_jobs_organization_direct_media_fk",
    }).onDelete("restrict"),
    check("publication_jobs_attempts_valid", sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} > 0`),
    check("publication_jobs_position_nonnegative", sql`${table.publicationPosition} >= 0`),
    check("publication_jobs_auto_comment_delay_valid", sql`${table.autoCommentDelayMinutes} BETWEEN 0 AND 10080`),
    check(
      "publication_jobs_auto_comment_attempts_valid",
      sql`${table.autoCommentAttemptCount} >= 0 AND ${table.autoCommentMaxAttempts} > 0`,
    ),
  ],
);

export const accountDailyMetrics = pgTable(
  "account_daily_metrics",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "restrict" }),
    day: date("day").notNull(),
    followersCount: integer("followers_count"),
    followsCount: integer("follows_count"),
    mediaCount: integer("media_count"),
    followerGains: integer("follower_gains"),
    reach: integer("reach"),
    views: integer("views"),
    profileViews: integer("profile_views"),
    accountsEngaged: integer("accounts_engaged"),
    totalInteractions: integer("total_interactions"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    replies: integer("replies"),
    websiteClicks: integer("website_clicks"),
    profileLinksTaps: integer("profile_links_taps"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.instagramAccountId, table.day] }),
    index("account_daily_metrics_organization_day_idx").on(table.organizationId, table.day),
    foreignKey({
      columns: [table.organizationId, table.instagramAccountId],
      foreignColumns: [instagramAccounts.organizationId, instagramAccounts.id],
      name: "account_daily_metrics_organization_account_fk",
    }).onDelete("restrict"),
  ],
);

export const accountMedia = pgTable(
  "account_media",
  {
    id: text("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "restrict" }),
    mediaType: text("media_type").notNull(),
    productType: text("product_type").notNull(),
    permalink: text("permalink"),
    thumbnailUrl: text("thumbnail_url"),
    caption: text("caption"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    likeCount: integer("like_count"),
    commentsCount: integer("comments_count"),
    views: integer("views"),
    reach: integer("reach"),
    shares: integer("shares"),
    saved: integer("saved"),
    totalInteractions: integer("total_interactions"),
    replies: integer("replies"),
    follows: integer("follows"),
    profileVisits: integer("profile_visits"),
    reelsAvgWatchTimeMs: integer("reels_avg_watch_time_ms"),
    reelsTotalWatchTimeMs: bigint("reels_total_watch_time_ms", { mode: "number" }),
    storyTapsForward: integer("story_taps_forward"),
    storyTapsBack: integer("story_taps_back"),
    storyExits: integer("story_exits"),
    insightsSyncedAt: timestamp("insights_synced_at", { withTimezone: true }),
    publishedJobId: uuid("published_job_id").references(() => publicationJobs.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    index("account_media_organization_account_posted_idx").on(table.organizationId, table.instagramAccountId, table.postedAt),
    index("account_media_organization_posted_idx").on(table.organizationId, table.postedAt),
    foreignKey({
      columns: [table.organizationId, table.instagramAccountId],
      foreignColumns: [instagramAccounts.organizationId, instagramAccounts.id],
      name: "account_media_organization_account_fk",
    }).onDelete("restrict"),
    check("account_media_product_type_valid", sql`${table.productType} IN ('FEED', 'REELS', 'STORY')`),
  ],
);

export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    initiatedBy: uuid("initiated_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nonceHash: text("nonce_hash").notNull().unique(),
    targetInstagramAccountId: uuid("target_instagram_account_id"),
    metaAppId: uuid("meta_app_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("oauth_states_expiry_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.organizationId, table.initiatedBy],
      foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
      name: "oauth_states_organization_member_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.targetInstagramAccountId],
      foreignColumns: [instagramAccounts.organizationId, instagramAccounts.id],
      name: "oauth_states_target_account_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.metaAppId],
      foreignColumns: [metaApps.organizationId, metaApps.id],
      name: "oauth_states_meta_app_fk",
    }).onDelete("cascade"),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_organization_created_idx").on(table.organizationId, table.createdAt),
    index("audit_logs_deletion_confirmation_idx")
      .on(sql`(${table.metadataJson}->>'confirmationCode')`)
      .where(sql`${table.eventType} = 'DATA_DELETION_REQUESTED'`),
    index("audit_logs_deletion_event_idx")
      .on(sql`(${table.metadataJson}->>'eventHash')`)
      .where(sql`${table.eventType} = 'DATA_DELETION_REQUESTED'`),
    index("audit_logs_deauthorization_event_idx")
      .on(sql`(${table.metadataJson}->>'eventHash')`)
      .where(sql`${table.eventType} IN ('ACCOUNT_DEAUTHORIZED', 'ACCOUNT_DEAUTHORIZATION_IGNORED')`),
  ],
);

export const settings = pgTable(
  "settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    defaultTimezone: text("default_timezone").notNull().default("America/Sao_Paulo"),
    defaultDelayMode: delayMode("default_delay_mode").notNull().default("RANDOM"),
    defaultDelayMin: integer("default_delay_min").notNull().default(1500),
    defaultDelayMax: integer("default_delay_max").notNull().default(3600),
    theme: appTheme("theme").notNull().default("LIGHT"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("settings_delay_valid", sql`${table.defaultDelayMin} >= 0 AND ${table.defaultDelayMax} >= ${table.defaultDelayMin}`),
  ],
);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  activeJobs: integer("active_jobs").notNull().default(0),
  version: text("version"),
});

export const loginAttempts = pgTable("login_attempts", {
  keyHash: text("key_hash").primaryKey(),
  attemptCount: integer("attempt_count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
