"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getSqlClient } from "@/db/client";
import { authenticate, clearSession, clientAddressFromHeaders, requireAdmin, setSession } from "@/server/auth";
import { banAccount, createFakeAccounts, disconnectAccount, requestInsightsRefresh, unbanAccount, verifyAccount } from "@/server/accounts";
import { createCampaign, createGroup, deleteGroup, replaceGroupMembers, resolveTargetIds, updateGroup } from "@/server/campaigns";
import { createLoop, createSchedule, deleteLoop, deleteSchedule, setLoopStatus, updateLoop, updateSchedule } from "@/server/automation";
import {
  createMediaFolder,
  deleteMedia,
  deleteMediaFolder,
  moveMedia,
  renameMediaFolder,
} from "@/server/media";
import {
  cancelCampaign,
  cancelPendingJob,
  confirmCampaignSchedule,
  duplicateCampaign,
  localDateTimeToUtc,
  pauseCampaign,
  previewCampaignSchedule,
  resumeCampaign,
  retryFailedJob,
} from "@/server/scheduler";

function message(error: unknown) {
  return encodeURIComponent(error instanceof Error ? error.message : "Operação não concluída");
}

function back(path: string, error: unknown): never {
  redirect(`${path}?erro=${message(error)}`);
}

const id = z.uuid();

export async function loginAction(formData: FormData) {
  const parsed = z
    .object({ email: z.email(), password: z.string().min(8).max(200) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) back("/login", new Error("E-mail ou senha inválidos"));
  let mustChangePassword = false;
  try {
    const user = await authenticate(
      parsed.data.email,
      parsed.data.password,
      clientAddressFromHeaders(await headers()),
    );
    if (!user) back("/login", new Error("E-mail ou senha inválidos"));
    await setSession(user);
    mustChangePassword = user.mustChangePassword;
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/login", new Error("Não foi possível autenticar agora. Tente novamente."));
  }
  redirect(mustChangePassword ? "/alterar-senha" : "/dashboard");
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

export async function createFakeAccountsAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const count = z.coerce.number().int().min(1).max(200).parse(formData.get("count"));
    await createFakeAccounts(count, user.id, user.organizationId);
    revalidatePath("/contas");
  } catch (error) {
    back("/contas", error);
  }
}

export async function disconnectAccountAction(formData: FormData) {
  const user = await requireAdmin();
  const accountId = id.parse(formData.get("accountId"));
  try {
    await disconnectAccount(accountId, user.id, user.organizationId);
    revalidatePath("/contas");
  } catch (error) {
    back("/contas", error);
  }
}

export async function verifyAccountAction(formData: FormData) {
  const user = await requireAdmin();
  const accountId = id.parse(formData.get("accountId"));
  try {
    await verifyAccount(accountId, user.organizationId);
    revalidatePath(`/contas/${accountId}`);
  } catch (error) {
    back(`/contas/${accountId}`, error);
  }
}

function safeReturnPath(value: FormDataEntryValue | null, fallback: string) {
  const path = typeof value === "string" ? value : "";
  return /^\/(analises|contas)(\/|\?|$)/.test(path) ? path : fallback;
}

export async function refreshInsightsAction(formData: FormData) {
  const user = await requireAdmin();
  const accountId = z.uuid().optional().parse(formData.get("accountId") || undefined);
  const returnTo = safeReturnPath(formData.get("returnTo"), "/analises");
  let count = 0;
  try {
    count = await requestInsightsRefresh(user.organizationId, accountId);
    revalidatePath("/analises");
  } catch (error) {
    back(returnTo, error);
  }
  const separator = returnTo.includes("?") ? "&" : "?";
  redirect(`${returnTo}${separator}ok=${encodeURIComponent(`Atualização solicitada para ${count} conta(s); o worker processa em até 1 minuto`)}`);
}

export async function banAccountAction(formData: FormData) {
  const user = await requireAdmin();
  const accountId = id.parse(formData.get("accountId"));
  try {
    await banAccount(accountId, String(formData.get("reason") ?? ""), user.id, user.organizationId);
    revalidatePath("/contas");
    revalidatePath(`/contas/${accountId}`);
    revalidatePath("/analises/banidas");
  } catch (error) {
    back(`/contas/${accountId}`, error);
  }
  redirect(`/contas/${accountId}?ok=${encodeURIComponent("Conta marcada como banida")}`);
}

export async function unbanAccountAction(formData: FormData) {
  const user = await requireAdmin();
  const accountId = id.parse(formData.get("accountId"));
  try {
    await unbanAccount(accountId, user.id, user.organizationId);
    revalidatePath("/contas");
    revalidatePath(`/contas/${accountId}`);
    revalidatePath("/analises/banidas");
  } catch (error) {
    back(`/contas/${accountId}`, error);
  }
  redirect(`/contas/${accountId}?ok=${encodeURIComponent("Banimento desmarcado; reconecte a conta para voltar a usá-la")}`);
}

export async function createGroupAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await createGroup(
      String(formData.get("name") ?? ""),
      String(formData.get("description") ?? ""),
      user.id,
      user.organizationId,
      z.string().regex(/^#[0-9a-fA-F]{6}$/).parse(formData.get("color")),
    );
    revalidatePath("/grupos");
  } catch (error) {
    back("/grupos", error);
  }
}

export async function updateGroupMembersAction(formData: FormData) {
  const user = await requireAdmin();
  const groupId = id.parse(formData.get("groupId"));
  try {
    await replaceGroupMembers(
      groupId,
      formData.getAll("accountIds").map(String).map((value) => id.parse(value)),
      user.organizationId,
    );
    revalidatePath("/grupos");
  } catch (error) {
    back("/grupos", error);
  }
}

export async function updateGroupAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = z.object({
    groupId: id,
    name: z.string().trim().min(1, "Nome do grupo é obrigatório").max(120),
    description: z.string().trim().max(500).optional(),
  }).safeParse({
    groupId: formData.get("groupId"),
    name: formData.get("name"),
    description: String(formData.get("description") ?? "") || undefined,
  });
  if (!parsed.success) back("/grupos", new Error(parsed.error.issues[0]?.message ?? "Dados do grupo inválidos"));
  try {
    await updateGroup(
      parsed.data.groupId,
      parsed.data.name,
      parsed.data.description,
      user.id,
      user.organizationId,
      z.string().regex(/^#[0-9a-fA-F]{6}$/).parse(formData.get("color")),
    );
    revalidatePath("/grupos");
  } catch (error) {
    back("/grupos", error);
  }
}

export async function deleteGroupAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await deleteGroup(id.parse(formData.get("groupId")), user.organizationId);
    revalidatePath("/grupos");
  } catch (error) {
    back("/grupos", error);
  }
}

export async function deleteMediaAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await deleteMedia(id.parse(formData.get("mediaId")), user.id, user.organizationId);
    revalidatePath("/midias");
  } catch (error) {
    back("/midias", error);
  }
}

export async function createMediaFolderAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await createMediaFolder(
      z.string().trim().min(1).max(120).parse(formData.get("name")),
      user.id,
      user.organizationId,
    );
    revalidatePath("/midias");
  } catch (error) {
    back("/midias", error);
  }
}

export async function renameMediaFolderAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await renameMediaFolder(
      id.parse(formData.get("folderId")),
      z.string().trim().min(1).max(120).parse(formData.get("name")),
      user.id,
      user.organizationId,
    );
    revalidatePath("/midias");
  } catch (error) {
    back("/midias", error);
  }
}

export async function deleteMediaFolderAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await deleteMediaFolder(id.parse(formData.get("folderId")), user.id, user.organizationId);
    revalidatePath("/midias");
  } catch (error) {
    back("/midias", error);
  }
}

export async function moveMediaAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const folderValue = String(formData.get("folderId") ?? "");
    await moveMedia(
      id.parse(formData.get("mediaId")),
      folderValue ? id.parse(folderValue) : null,
      user.id,
      user.organizationId,
    );
    revalidatePath("/midias");
  } catch (error) {
    back("/midias", error);
  }
}

export async function createCampaignAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const publicationType = z
      .enum(["FEED_IMAGE", "FEED_VIDEO", "REEL", "STORY_IMAGE", "STORY_VIDEO", "CAROUSEL"])
      .parse(formData.get("publicationType"));
    const campaignId = await createCampaign({
      name: z.string().min(1).max(160).parse(formData.get("name")),
      publicationType,
      caption: z.string().max(2200).optional().parse(String(formData.get("caption") ?? "") || undefined),
      mediaIds: formData.getAll("mediaIds").map(String).map((value) => id.parse(value)),
      shareToFeed: formData.get("shareToFeed") === "on",
      actorUserId: user.id,
      organizationId: user.organizationId,
    });
    redirect(`/campanhas/${campaignId}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/campanhas/nova", error);
  }
}

export async function scheduleCampaignAction(formData: FormData) {
  const user = await requireAdmin();
  const campaignId = id.parse(formData.get("campaignId"));
  try {
    if (formData.get("intent") === "confirm") {
      await confirmCampaignSchedule(campaignId, user.id, user.organizationId);
      revalidatePath(`/campanhas/${campaignId}`);
      redirect(`/campanhas/${campaignId}?ok=agendada`);
    }
    const timezone = z.string().min(1).max(80).parse(formData.get("timezone"));
    const startValue = String(formData.get("startAt") ?? "");
    const targetIds = await resolveTargetIds({
      organizationId: user.organizationId,
      accountIds: formData.getAll("accountIds").map(String).map((value) => id.parse(value)),
      groupIds: formData.getAll("groupIds").map(String).map((value) => id.parse(value)),
      all: formData.get("allAccounts") === "on",
    });
    const mode = z.enum(["FIXED", "RANDOM"]).parse(formData.get("delayMode"));
    const delay =
      mode === "FIXED"
        ? { mode, fixedSeconds: Math.round(z.coerce.number().min(0).max(1440).parse(formData.get("delayFixedMinutes")) * 60) }
        : {
            mode,
            minSeconds: z.coerce.number().int().min(25).max(60).parse(formData.get("delayMinMinutes")) * 60,
            maxSeconds: z.coerce.number().int().min(25).max(60).parse(formData.get("delayMaxMinutes")) * 60,
          };
    if (delay.mode === "RANDOM" && delay.maxSeconds < delay.minSeconds) throw new Error("Intervalo máximo deve ser maior ou igual ao mínimo");
    await previewCampaignSchedule({
      campaignId,
      targetIds,
      startAt: formData.get("publishNow") === "on" || !startValue ? new Date() : localDateTimeToUtc(startValue, timezone),
      timezone,
      delay,
      targetOrder: z.enum(["SELECTED", "RANDOM", "USERNAME"]).parse(formData.get("targetOrder")),
      actorUserId: user.id,
      organizationId: user.organizationId,
    });
    revalidatePath(`/campanhas/${campaignId}`);
    redirect(`/campanhas/${campaignId}?preview=1`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back(`/campanhas/${campaignId}`, error);
  }
}

export async function pauseCampaignAction(formData: FormData) {
  const user = await requireAdmin();
  const campaignId = id.parse(formData.get("campaignId"));
  try {
    await pauseCampaign(campaignId, user.id, user.organizationId);
    revalidatePath(`/campanhas/${campaignId}`);
  } catch (error) {
    back(`/campanhas/${campaignId}`, error);
  }
}

export async function resumeCampaignAction(formData: FormData) {
  const user = await requireAdmin();
  const campaignId = id.parse(formData.get("campaignId"));
  try {
    await resumeCampaign(campaignId, user.id, user.organizationId);
    revalidatePath(`/campanhas/${campaignId}`);
  } catch (error) {
    back(`/campanhas/${campaignId}`, error);
  }
}

export async function cancelCampaignAction(formData: FormData) {
  const user = await requireAdmin();
  const campaignId = id.parse(formData.get("campaignId"));
  try {
    await cancelCampaign(campaignId, user.id, user.organizationId);
    revalidatePath(`/campanhas/${campaignId}`);
  } catch (error) {
    back(`/campanhas/${campaignId}`, error);
  }
}

export async function duplicateCampaignAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const copyId = await duplicateCampaign(id.parse(formData.get("campaignId")), user.id, user.organizationId);
    redirect(`/campanhas/${copyId}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/campanhas", error);
  }
}

export async function retryJobAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await retryFailedJob(id.parse(formData.get("jobId")), user.id, user.organizationId);
    revalidatePath("/fila");
  } catch (error) {
    back("/fila", error);
  }
}

export async function cancelJobAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await cancelPendingJob(id.parse(formData.get("jobId")), user.id, user.organizationId);
    revalidatePath("/fila");
  } catch (error) {
    back("/fila", error);
  }
}

async function loopInputFromForm(formData: FormData, user: { id: string; organizationId: string }) {
  const accountIds = await resolveTargetIds({
    organizationId: user.organizationId,
    accountIds: formData.getAll("accountIds").map(String).map((value) => id.parse(value)),
    groupIds: formData.getAll("groupIds").map(String).map((value) => id.parse(value)),
    all: formData.get("allAccounts") === "on",
  });
  const values = z.object({
    name: z.string().trim().min(1).max(160),
    defaultCaption: z.string().max(2200).optional(),
    autoCommentText: z.string().max(2200).optional(),
    autoCommentDelayMinutes: z.coerce.number().int().min(0).max(10080),
    minIntervalMinutes: z.coerce.number().int().min(1).max(1440),
    maxIntervalMinutes: z.coerce.number().int().min(1).max(1440),
    dailyLimitPerAccount: z.coerce.number().int().min(1).max(200),
    tierFollowerThreshold: z.coerce.number().int().min(0).max(100_000_000),
    tier1DailyLimit: z.coerce.number().int().min(1).max(200),
    tier1MinIntervalMinutes: z.coerce.number().int().min(1).max(1440),
    tier1MaxIntervalMinutes: z.coerce.number().int().min(1).max(1440),
    mediaType: z.enum(["REELS", "IMAGE", "MIXED"]),
    imageEveryN: z.coerce.number().int().min(1).max(100),
    mode: z.enum(["CONTINUOUS", "LIMITED"]),
  }).parse({
    name: formData.get("name"),
    defaultCaption: String(formData.get("defaultCaption") ?? "") || undefined,
    autoCommentText: String(formData.get("autoCommentText") ?? "") || undefined,
    autoCommentDelayMinutes: formData.get("autoCommentDelayMinutes") || 5,
    minIntervalMinutes: formData.get("minIntervalMinutes"),
    maxIntervalMinutes: formData.get("maxIntervalMinutes"),
    dailyLimitPerAccount: formData.get("dailyLimitPerAccount"),
    tierFollowerThreshold: formData.get("tierFollowerThreshold") || 10000,
    tier1DailyLimit: formData.get("tier1DailyLimit") || 10,
    tier1MinIntervalMinutes: formData.get("tier1MinIntervalMinutes") || 60,
    tier1MaxIntervalMinutes: formData.get("tier1MaxIntervalMinutes") || 120,
    mediaType: formData.get("mediaType"),
    imageEveryN: formData.get("imageEveryN") || 1,
    mode: formData.get("mode"),
  });
  if (values.maxIntervalMinutes < values.minIntervalMinutes) {
    throw new Error("O intervalo máximo deve ser maior ou igual ao mínimo");
  }
  if (values.tier1MaxIntervalMinutes < values.tier1MinIntervalMinutes) {
    throw new Error("O intervalo máximo da faixa deve ser maior ou igual ao mínimo");
  }
  return {
    organizationId: user.organizationId,
    actorUserId: user.id,
    name: values.name,
    defaultCaption: values.defaultCaption,
    autoCommentText: values.autoCommentText,
    autoCommentDelayMinutes: values.autoCommentDelayMinutes,
    minIntervalMinutes: values.minIntervalMinutes,
    maxIntervalMinutes: values.maxIntervalMinutes,
    dailyLimitPerAccount: values.dailyLimitPerAccount,
    tieredLimits: formData.get("tieredLimits") === "on",
    tierFollowerThreshold: values.tierFollowerThreshold,
    tier1DailyLimit: values.tier1DailyLimit,
    tier1MinIntervalMinutes: values.tier1MinIntervalMinutes,
    tier1MaxIntervalMinutes: values.tier1MaxIntervalMinutes,
    mediaType: values.mediaType,
    imageEveryN: values.imageEveryN,
    noRepeat: values.mode === "LIMITED",
    accountIds,
    mediaIds: formData.getAll("mediaIds").map(String).map((value) => id.parse(value)),
  };
}

export async function createLoopAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const input = await loopInputFromForm(formData, user);
    const result = await createLoop(input);
    revalidatePath("/loops");
    const mode = input.noRepeat ? "modo=limitados&" : "";
    redirect(`/loops?${mode}ok=${encodeURIComponent(`Loop criado para ${result.scheduledCount} conta(s)`)}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/loops", error);
  }
}

export async function updateLoopAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const input = await loopInputFromForm(formData, user);
    await updateLoop(id.parse(formData.get("loopId")), input);
    revalidatePath("/loops");
    redirect(`/loops?${input.noRepeat ? "modo=limitados&" : ""}ok=${encodeURIComponent("Loop atualizado")}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/loops", error);
  }
}

export async function setLoopStatusAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await setLoopStatus(
      id.parse(formData.get("loopId")),
      z.enum(["ACTIVE", "PAUSED"]).parse(formData.get("status")),
      user.id,
      user.organizationId,
    );
    revalidatePath("/loops");
  } catch (error) {
    back("/loops", error);
  }
}

export async function deleteLoopAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await deleteLoop(id.parse(formData.get("loopId")), user.id, user.organizationId);
    revalidatePath("/loops");
  } catch (error) {
    back("/loops", error);
  }
}

async function scheduleInputFromForm(formData: FormData, user: { id: string; organizationId: string }) {
  const accountIds = await resolveTargetIds({
    organizationId: user.organizationId,
    accountIds: formData.getAll("accountIds").map(String).map((value) => id.parse(value)),
    groupIds: formData.getAll("groupIds").map(String).map((value) => id.parse(value)),
    all: formData.get("allAccounts") === "on",
  });
  const values = z.object({
    name: z.string().trim().min(1).max(160),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    timezone: z.string().min(1).max(80),
    mediaType: z.enum(["REELS", "IMAGE"]),
    defaultCaption: z.string().max(2200).optional(),
    autoCommentText: z.string().max(2200).optional(),
    autoCommentDelayMinutes: z.coerce.number().int().min(0).max(10080),
  }).parse({
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    timezone: formData.get("timezone"),
    mediaType: formData.get("mediaType"),
    defaultCaption: String(formData.get("defaultCaption") ?? "") || undefined,
    autoCommentText: String(formData.get("autoCommentText") ?? "") || undefined,
    autoCommentDelayMinutes: formData.get("autoCommentDelayMinutes") || 5,
  });
  return {
    organizationId: user.organizationId,
    actorUserId: user.id,
    ...values,
    times: String(formData.get("times") ?? "").split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean),
    daysOfWeek: formData.getAll("daysOfWeek").map((value) => z.coerce.number().int().min(0).max(6).parse(value)),
    accountIds,
    mediaIds: formData.getAll("mediaIds").map(String).map((value) => id.parse(value)),
  };
}

export async function createScheduleAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const result = await createSchedule(await scheduleInputFromForm(formData, user));
    revalidatePath("/escalas");
    redirect(`/escalas?ok=${encodeURIComponent(`${result.scheduled} mídia(s) distribuída(s) em ${result.jobs} publicação(ões)`)}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/escalas", error);
  }
}

export async function updateScheduleAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const result = await updateSchedule(
      id.parse(formData.get("scheduleId")),
      await scheduleInputFromForm(formData, user),
    );
    revalidatePath("/escalas");
    redirect(`/escalas?ok=${encodeURIComponent(`${result.rescheduled} publicação(ões) pendente(s) reagendada(s)`)}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/escalas", error);
  }
}

export async function deleteScheduleAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await deleteSchedule(id.parse(formData.get("scheduleId")), user.id, user.organizationId);
    revalidatePath("/escalas");
  } catch (error) {
    back("/escalas", error);
  }
}

export async function saveSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const values = z
      .object({
        timezone: z.string().min(1).max(80),
        delayMode: z.enum(["FIXED", "RANDOM"]),
        delayMinMinutes: z.coerce.number().int().min(25).max(60),
        delayMaxMinutes: z.coerce.number().int().min(25).max(60),
        theme: z.enum(["LIGHT", "DARK"]),
      })
      .parse({
        timezone: formData.get("timezone"),
        delayMode: formData.get("delayMode"),
        delayMinMinutes: formData.get("delayMinMinutes"),
        delayMaxMinutes: formData.get("delayMaxMinutes"),
        theme: formData.get("theme"),
      });
    if (values.delayMaxMinutes < values.delayMinMinutes) throw new Error("Intervalo máximo deve ser maior ou igual ao mínimo");
    const delayMin = values.delayMinMinutes * 60;
    const delayMax = values.delayMaxMinutes * 60;
    await getSqlClient()`
      INSERT INTO settings (organization_id, default_timezone, default_delay_mode, default_delay_min, default_delay_max, theme)
      VALUES (${user.organizationId}, ${values.timezone}, ${values.delayMode}, ${delayMin}, ${delayMax}, ${values.theme})
      ON CONFLICT (organization_id) DO UPDATE SET default_timezone = EXCLUDED.default_timezone,
        default_delay_mode = EXCLUDED.default_delay_mode, default_delay_min = EXCLUDED.default_delay_min,
        default_delay_max = EXCLUDED.default_delay_max, theme = EXCLUDED.theme, updated_at = now()
    `;
    revalidatePath("/configuracoes");
    revalidatePath("/", "layout");
    redirect("/configuracoes?ok=salvo");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/configuracoes", error);
  }
}
