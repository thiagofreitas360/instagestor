import Link from "next/link";
import { COMPANY } from "@/lib/company";

export const metadata = { title: "Termos — InstaGestor" };

export default function TermsPage() {
  return (
    <main className="legal-page">
      <h1>Termos de Uso</h1>
      <p>Última atualização: {COMPANY.updatedAt}.</p>

      <h2>1. Serviço</h2>
      <p>O InstaGestor ({COMPANY.domain}), operado por {COMPANY.legalName}, CNPJ {COMPANY.cnpj}, é uma plataforma para empresas publicarem, agendarem e analisarem conteúdo em contas profissionais do Instagram por meio das APIs oficiais da Meta.</p>

      <h2>2. Contas e autorização</h2>
      <p>O cliente só pode conectar contas profissionais que possui ou está autorizado a gerenciar. Cada conta é conectada individualmente pelo login oficial da Meta, e o acesso pode ser revogado a qualquer momento no InstaGestor ou nas configurações do Instagram. O cliente é responsável pelos usuários que cadastra e pela guarda das próprias credenciais.</p>

      <h2>3. Uso aceitável</h2>
      <p>O cliente deve publicar apenas conteúdo que possa usar legalmente e cumprir os Termos e Políticas da Meta e do Instagram. É proibido usar o serviço para spam, para contornar limites da plataforma, coletar credenciais, fazer scraping ou automatizar comportamentos não oferecidos pela API oficial.</p>

      <h2>4. Publicações</h2>
      <p>O InstaGestor publica somente o que o cliente cria e confirma. Publicações com resultado incerto são interrompidas para verificação manual, evitando duplicações. A disponibilidade depende também dos serviços da Meta, que podem aplicar limites, recusar conteúdo ou mudar suas APIs.</p>

      <h2>5. Dados</h2>
      <p>O tratamento de dados segue a <Link href="/privacy">Política de Privacidade</Link>. O conteúdo e os dados das contas continuam pertencendo ao cliente.</p>

      <h2>6. Suspensão e encerramento</h2>
      <p>Podemos suspender o acesso em caso de violação destes termos ou das políticas da Meta. No encerramento, os tokens são apagados e os dados são excluídos conforme a Política de Privacidade.</p>

      <h2>7. Contato</h2>
      <p>{COMPANY.privacyEmail} · {COMPANY.address}.</p>

      <p><Link href="/privacy">Política de Privacidade</Link> · <Link href="/data-deletion">Exclusão de dados</Link></p>
    </main>
  );
}
