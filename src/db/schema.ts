import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const userRole = pgEnum("user_role", ["ADMIN"]);
export const instagramAccountStatus = pgEnum("instagram_account_status", [
  "CONNECTED",
  "TOKEN_EXPIRING",
  "REAUTH_REQUIRED",
  "DISCONNECTED",
  "ERROR",
  "DISABLED",
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

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("ADMIN"),
  ...timestamps,
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const instagramAccounts = pgTable(
  "instagram_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    ...timestamps,
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  },
  (table) => [index("instagram_accounts_status_idx").on(table.status)],
);

export const accountGroups = pgTable("account_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  ...timestamps,
});

export const accountGroupMembers = pgTable(
  "account_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => accountGroups.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.instagramAccountId] })],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    processingStatus: mediaProcessingStatus("processing_status").notNull().default("UPLOADING"),
    validationError: text("validation_error"),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("media_assets_status_idx").on(table.processingStatus),
    check("media_assets_size_positive", sql`${table.sizeBytes} > 0`),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
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
    index("campaigns_status_idx").on(table.status),
    check(
      "campaigns_delay_values_valid",
      sql`(${table.delayMode} = 'FIXED' AND ${table.delayFixedSeconds} IS NOT NULL AND ${table.delayFixedSeconds} >= 0) OR (${table.delayMode} = 'RANDOM' AND ${table.delayMinSeconds} IS NOT NULL AND ${table.delayMaxSeconds} IS NOT NULL AND ${table.delayMinSeconds} >= 0 AND ${table.delayMaxSeconds} >= ${table.delayMinSeconds})`,
    ),
  ],
);

export const campaignMedia = pgTable(
  "campaign_media",
  {
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
    check("campaign_media_position_nonnegative", sql`${table.position} >= 0`),
  ],
);

export const campaignTargets = pgTable(
  "campaign_targets",
  {
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
  ],
);

export const publicationJobs = pgTable(
  "publication_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "restrict" }),
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
    ...timestamps,
  },
  (table) => [
    unique("publication_jobs_campaign_account_unique").on(table.campaignId, table.instagramAccountId),
    index("publication_jobs_status_scheduled_idx").on(table.status, table.scheduledAt),
    index("publication_jobs_status_retry_idx").on(table.status, table.nextAttemptAt),
    index("publication_jobs_account_idx").on(table.instagramAccountId),
    index("publication_jobs_campaign_idx").on(table.campaignId),
    index("publication_jobs_stale_lock_idx").on(table.lockExpiresAt),
    check("publication_jobs_attempts_valid", sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} > 0`),
  ],
);

export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nonceHash: text("nonce_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("oauth_states_expiry_idx").on(table.expiresAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_created_idx").on(table.createdAt),
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
    id: boolean("id").primaryKey().default(true),
    defaultTimezone: text("default_timezone").notNull().default("America/Sao_Paulo"),
    defaultDelayMode: delayMode("default_delay_mode").notNull().default("FIXED"),
    defaultDelayMin: integer("default_delay_min").notNull().default(120),
    defaultDelayMax: integer("default_delay_max").notNull().default(300),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("settings_singleton", sql`${table.id} = true`),
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
