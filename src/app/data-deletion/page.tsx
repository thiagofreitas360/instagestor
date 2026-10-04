import Link from "next/link";
import { COMPANY } from "@/lib/company";
import { findDeletionStatus } from "@/server/accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exclusão de dados — InstaGestor" };

export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const status = code ? await findDeletionStatus(code) : null;
  return (
    <main className="legal-page">
      <h1>Exclusão de dados do Instagram</h1>
      {code ? (
        status ? (
          <p className="alert success">Solicitação {code}: dados da conexão removidos em {status.requestedAt.toLocaleString("pt-BR")}.</p>
        ) : (
          <p className="alert error">Código de confirmação não encontrado.</p>
        )
      ) : (
        <>
          <p>Você pode pedir a exclusão dos dados de uma conta do Instagram conectada ao InstaGestor de duas formas:</p>
          <ol>
            <li>No Instagram, acesse Configurações → Apps e sites, remova o InstaGestor e solicite a exclusão. A Meta nos avisa automaticamente e você recebe um código para acompanhar o pedido nesta página.</li>
            <li>Envie um e-mail para {COMPANY.privacyEmail} informando o nome de usuário da conta.</li>
          </ol>
          <p>Mantemos sobre a conta: identificadores, nome de usuário, nome, foto, tipo de conta, biografia, site, token de acesso criptografado, limite de publicação, métricas da conta e das mídias e o histórico das publicações feitas pela plataforma.</p>
          <p>Ao processar o pedido, o token é apagado; perfil e identificadores são anonimizados; métricas, mídias sincronizadas e vínculos com grupos são excluídos; publicações pendentes são canceladas. Registros operacionais só são mantidos de forma anonimizada quando necessários para segurança ou obrigação legal.</p>
          <p><Link href="/privacy">Política de Privacidade</Link> · <Link href="/terms">Termos de Uso</Link></p>
        </>
      )}
    </main>
  );
}
