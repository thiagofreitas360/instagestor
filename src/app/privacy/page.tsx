import Link from "next/link";
import { COMPANY } from "@/lib/company";

export const metadata = { title: "Privacidade — InstaGestor" };

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <h1>Política de Privacidade</h1>
      <p>Última atualização: {COMPANY.updatedAt}.</p>

      <h2>1. Quem somos</h2>
      <p>O InstaGestor ({COMPANY.domain}) é operado por {COMPANY.legalName}, CNPJ {COMPANY.cnpj}, com endereço em {COMPANY.address}. É uma plataforma usada por empresas clientes para publicar, agendar e analisar conteúdo em contas profissionais do Instagram que elas possuem ou estão autorizadas a gerenciar.</p>
      <p>Para os dados das contas conectadas, a empresa cliente é a controladora e o InstaGestor atua como operador, tratando os dados somente para prestar o serviço contratado (LGPD, Lei 13.709/2018). Para os dados de cadastro dos usuários da plataforma, o InstaGestor é o controlador.</p>

      <h2>2. Como as contas do Instagram são conectadas</h2>
      <p>A conexão é feita exclusivamente pelo login oficial da Meta (Business Login for Instagram). O InstaGestor nunca solicita, recebe ou armazena a senha do Instagram. A Meta entrega um token de acesso que é guardado criptografado (AES-256-GCM) e nunca é exibido no navegador.</p>

      <h2>3. Dados obtidos da Meta e finalidade</h2>
      <ul>
        <li><strong>Perfil da conta profissional</strong> (permissão <code>instagram_business_basic</code>): ID, ID com escopo do app, nome de usuário, nome, foto, tipo de conta, biografia, site e contagens de seguidores, seguidos e publicações — para identificar a conta, exibir seu status e escolher o destino das publicações.</li>
        <li><strong>Publicação</strong> (<code>instagram_business_content_publish</code>): IDs dos contêineres e das mídias publicadas e o limite de publicação da conta — para publicar o conteúdo aprovado pelo cliente e evitar publicações duplicadas.</li>
        <li><strong>Métricas</strong> (<code>instagram_business_manage_insights</code>): métricas diárias da conta (alcance, visualizações, visitas ao perfil, interações, ganho de seguidores) e de mídias recentes (legenda, link, miniatura, visualizações, alcance, curtidas, comentários, salvamentos, compartilhamentos) — para exibir relatórios de desempenho ao próprio cliente.</li>
      </ul>
      <p>Não usamos esses dados para publicidade, não os vendemos, não os compartilhamos com outros clientes e não fazemos scraping, uso de APIs privadas ou automação de navegador.</p>

      <h2>4. Outros dados tratados</h2>
      <ul>
        <li>Usuários da plataforma: e-mail, senha armazenada apenas como hash Argon2id, organização e papel.</li>
        <li>Mídias e legendas enviadas pelo cliente para publicação, guardadas em armazenamento privado.</li>
        <li>Registros de auditoria (quem conectou, desconectou ou publicou e quando) e tentativas de login com IP armazenado apenas como hash, para segurança e prevenção de abuso.</li>
      </ul>

      <h2>5. Isolamento entre clientes</h2>
      <p>Cada empresa cliente tem um ambiente isolado. Uma conta do Instagram pertence a um único cliente por vez, e nenhum cliente acessa contas, métricas ou mídias de outro.</p>

      <h2>6. Compartilhamento</h2>
      <p>Os dados são enviados somente à Meta, para executar as ações solicitadas, e aos provedores de infraestrutura que hospedam a aplicação, o banco de dados e o armazenamento de mídias, sob obrigação de confidencialidade. Podemos divulgá-los quando exigido por lei ou ordem judicial.</p>

      <h2>7. Retenção e exclusão</h2>
      <ul>
        <li>Os dados são mantidos enquanto a conta estiver conectada e o contrato do cliente estiver ativo.</li>
        <li>Ao desconectar uma conta ou remover o app nas configurações do Instagram, o token é apagado imediatamente e as publicações pendentes são canceladas.</li>
        <li>Pedidos de exclusão (pela Meta ou pelo e-mail abaixo) removem ou anonimizam perfil, identificadores, métricas e mídias sincronizadas da conta. Veja a <Link href="/data-deletion">página de exclusão de dados</Link>.</li>
        <li>No encerramento do contrato, os dados do cliente são excluídos em até 30 dias, salvo registros que a lei exija manter, que ficam anonimizados.</li>
      </ul>

      <h2>8. Seus direitos</h2>
      <p>Você pode solicitar confirmação, acesso, correção, portabilidade, anonimização ou exclusão dos seus dados, e revogar o acesso a qualquer momento removendo o app nas configurações do Instagram. Contato do encarregado de dados: {COMPANY.privacyEmail}.</p>

      <h2>9. Segurança</h2>
      <p>Usamos HTTPS, tokens criptografados, senhas com hash, armazenamento privado, controle de acesso por organização e registros de auditoria. Em caso de incidente que possa gerar risco relevante, os clientes afetados e a ANPD serão comunicados nos termos da lei.</p>

      <p><Link href="/terms">Termos de Uso</Link> · <Link href="/data-deletion">Exclusão de dados</Link></p>
    </main>
  );
}
