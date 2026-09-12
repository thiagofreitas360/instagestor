"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getSqlClient } from "@/db/client";
import { authenticate, clearSession, clientAddressFromHeaders, requireAdmin, setSession } from "@/server/auth";
import { banAccount, createFakeAccounts, disconnectAccount, requestInsightsRefresh, unbanAccount, verifyAccount } from "@/server/accounts";
import { createCampaign, createGroup, deleteGroup, replaceGroupMembers, resolveTargetIds, updateGroup } from "@/server/campaigns";
import { deleteMedia } from "@/server/media";
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
  try {
    const user = await authenticate(
      parsed.data.email,
      parsed.data.password,
      clientAddressFromHeaders(await headers()),
    );
    if (!user) back("/login", new Error("E-mail ou senha inválidos"));
    await setSession(user);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/login", new Error("Não foi possível autenticar agora. Tente novamente."));
  }
  redirect("/dashboard");
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

export async function createFakeAccountsAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const count = z.coerce.number().int().min(1).max(200).parse(formData.get("count"));
    await createFakeAccounts(count, user.id);
    revalidatePath("/contas");
  } catch (error) {
    back("/contas", error);
  }
}

export async function disconnectAccountAction(formData: FormData) {
  const user = await requireAdmin();
  const accountId = id.parse(formData.get("accountId"));
  try {
    await disconnectAccount(accountId, user.id);
    revalidatePath("/contas");
  } catch (error) {
    back("/contas", error);
  }
}

export async function verifyAccountAction(formData: FormData) {
  await requireAdmin();
  const accountId = id.parse(formData.get("accountId"));
  try {
    await verifyAccount(accountId);
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
  await requireAdmin();
  const accountId = z.uuid().optional().parse(formData.get("accountId") || undefined);
  const returnTo = safeReturnPath(formData.get("returnTo"), "/analises");
  let count = 0;
  try {
    count = await requestInsightsRefresh(accountId);
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
    await banAccount(accountId, String(formData.get("reason") ?? ""), user.id);
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
    await unbanAccount(accountId, user.id);
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
    await createGroup(String(formData.get("name") ?? ""), String(formData.get("description") ?? ""), user.id);
    revalidatePath("/grupos");
  } catch (error) {
    back("/grupos", error);
  }
}

export async function updateGroupMembersAction(formData: FormData) {
  await requireAdmin();
  const groupId = id.parse(formData.get("groupId"));
  try {
    await replaceGroupMembers(groupId, formData.getAll("accountIds").map(String).map((value) => id.parse(value)));
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
    await updateGroup(parsed.data.groupId, parsed.data.name, parsed.data.description, user.id);
    revalidatePath("/grupos");
  } catch (error) {
    back("/grupos", error);
  }
}

export async function deleteGroupAction(formData: FormData) {
  await requireAdmin();
  try {
    await deleteGroup(id.parse(formData.get("groupId")));
    revalidatePath("/grupos");
  } catch (error) {
    back("/grupos", error);
  }
}

export async function deleteMediaAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await deleteMedia(id.parse(formData.get("mediaId")), user.id);
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
      await confirmCampaignSchedule(campaignId, user.id);
      revalidatePath(`/campanhas/${campaignId}`);
      redirect(`/campanhas/${campaignId}?ok=agendada`);
    }
    const timezone = z.string().min(1).max(80).parse(formData.get("timezone"));
    const startValue = String(formData.get("startAt") ?? "");
    const targetIds = await resolveTargetIds({
      accountIds: formData.getAll("accountIds").map(String).map((value) => id.parse(value)),
      groupIds: formData.getAll("groupIds").map(String).map((value) => id.parse(value)),
      all: formData.get("allAccounts") === "on",
    });
    const mode = z.enum(["FIXED", "RANDOM"]).parse(formData.get("delayMode"));
    const delay =
      mode === "FIXED"
        ? { mode, fixedSeconds: z.coerce.number().int().min(0).max(86400).parse(formData.get("delayFixedSeconds")) }
        : {
            mode,
            minSeconds: z.coerce.number().int().min(0).max(86400).parse(formData.get("delayMinSeconds")),
            maxSeconds: z.coerce.number().int().min(0).max(86400).parse(formData.get("delayMaxSeconds")),
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
    await pauseCampaign(campaignId, user.id);
    revalidatePath(`/campanhas/${campaignId}`);
  } catch (error) {
    back(`/campanhas/${campaignId}`, error);
  }
}

export async function resumeCampaignAction(formData: FormData) {
  const user = await requireAdmin();
  const campaignId = id.parse(formData.get("campaignId"));
  try {
    await resumeCampaign(campaignId, user.id);
    revalidatePath(`/campanhas/${campaignId}`);
  } catch (error) {
    back(`/campanhas/${campaignId}`, error);
  }
}

export async function cancelCampaignAction(formData: FormData) {
  const user = await requireAdmin();
  const campaignId = id.parse(formData.get("campaignId"));
  try {
    await cancelCampaign(campaignId, user.id);
    revalidatePath(`/campanhas/${campaignId}`);
  } catch (error) {
    back(`/campanhas/${campaignId}`, error);
  }
}

export async function duplicateCampaignAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const copyId = await duplicateCampaign(id.parse(formData.get("campaignId")), user.id);
    redirect(`/campanhas/${copyId}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/campanhas", error);
  }
}

export async function retryJobAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await retryFailedJob(id.parse(formData.get("jobId")), user.id);
    revalidatePath("/fila");
  } catch (error) {
    back("/fila", error);
  }
}

export async function cancelJobAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await cancelPendingJob(id.parse(formData.get("jobId")), user.id);
    revalidatePath("/fila");
  } catch (error) {
    back("/fila", error);
  }
}

export async function saveSettingsAction(formData: FormData) {
  await requireAdmin();
  try {
    const values = z
      .object({
        timezone: z.string().min(1).max(80),
        delayMode: z.enum(["FIXED", "RANDOM"]),
        delayMin: z.coerce.number().int().min(0).max(86400),
        delayMax: z.coerce.number().int().min(0).max(86400),
      })
      .parse({
        timezone: formData.get("timezone"),
        delayMode: formData.get("delayMode"),
        delayMin: formData.get("delayMin"),
        delayMax: formData.get("delayMax"),
      });
    if (values.delayMax < values.delayMin) throw new Error("Intervalo máximo deve ser maior ou igual ao mínimo");
    await getSqlClient()`
      INSERT INTO settings (id, default_timezone, default_delay_mode, default_delay_min, default_delay_max)
      VALUES (true, ${values.timezone}, ${values.delayMode}, ${values.delayMin}, ${values.delayMax})
      ON CONFLICT (id) DO UPDATE SET default_timezone = EXCLUDED.default_timezone,
        default_delay_mode = EXCLUDED.default_delay_mode, default_delay_min = EXCLUDED.default_delay_min,
        default_delay_max = EXCLUDED.default_delay_max, updated_at = now()
    `;
    revalidatePath("/configuracoes");
    redirect("/configuracoes?ok=salvo");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    back("/configuracoes", error);
  }
}
