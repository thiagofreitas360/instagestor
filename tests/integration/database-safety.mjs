/**
 * @param {string | undefined} rawUrl
 */
export function assertTestDatabaseUrl(rawUrl) {
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL é obrigatória para os testes destrutivos e deve apontar para um PostgreSQL de teste dedicado.",
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL dos testes é inválida.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL dos testes deve usar PostgreSQL.");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!databaseName || !databaseName.toLowerCase().endsWith("_test")) {
    throw new Error(
      `Banco recusado: o nome "${databaseName || "(vazio)"}" não termina em "_test". Nenhuma migração ou limpeza foi executada.`,
    );
  }

  return rawUrl;
}
