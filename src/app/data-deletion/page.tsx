import Link from "next/link";
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
          <p>Para excluir os dados associados à sua conta, remova o aplicativo nas configurações do Instagram/Meta ou solicite a exclusão pelo e-mail [EMAIL].</p>
          <p>O app mantém identificadores da conta profissional, nome de usuário, nome, foto, tipo de conta, token cifrado, estado de quota e histórico operacional de publicação.</p>
          <p>Após a confirmação, o token é inutilizado; perfil, identificadores e vínculos com grupos são removidos ou anonimizados; jobs futuros são cancelados. Registros operacionais podem ser preservados somente de forma anonimizada quando necessários para segurança, integridade ou obrigação legal.</p>
          <p><Link href="/privacy">Política de Privacidade</Link> · <Link href="/terms">Termos de Uso</Link></p>
        </>
      )}
    </main>
  );
}
