// Envio de e-mail transacional pela Brevo (API HTTP, sem SDK — mesma regra do B2 e do Telegram).
// Hoje serve só ao "Esqueci a senha". Escolha do Luan (24/09/2026): gratuito até 300 por dia, basta
// confirmar um remetente na Brevo, e a mesma conta envia SMS quando o telefone entrar.
//
// Configuração: BREVO_API_KEY e BREVO_SENDER_EMAIL (o remetente confirmado na Brevo);
// BREVO_SENDER_NAME é opcional. Sem as duas primeiras, o envio por e-mail simplesmente não aparece
// na tela de login, em vez de fingir que mandou.
const API = 'https://api.brevo.com/v3/smtp/email';

export function emailConfigurado() {
  return Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);
}

export async function enviarEmail({ para, assunto, texto }) {
  if (!emailConfigurado()) throw new Error('Envio de e-mail não configurado (BREVO_API_KEY / BREVO_SENDER_EMAIL).');
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || 'Dashboard Vita Pet Life' },
      to: [{ email: para }],
      subject: assunto,
      textContent: texto,
    }),
  });
  if (!res.ok) {
    // O corpo da resposta da Brevo diz o motivo (remetente não confirmado, chave errada…) e não
    // contém o e-mail de ninguém além do destinatário, que quem chama já conhece.
    const corpo = await res.text().catch(() => '');
    throw new Error(`Brevo respondeu ${res.status}: ${corpo.slice(0, 200)}`);
  }
  return true;
}
