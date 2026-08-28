// alerts.js — avisa no Telegram quando um canal fica travado sem sincronizar.
// Sem SDK (mesma regra do resto do projeto): API do Telegram é só POST/GET
// HTTP simples, chamada direto via fetch — igual o B2/SigV4 da Amazon.
//
// Motivo: hoje um erro de sync só aparece no log do Railway
// (console.error('Sync falhou:', ...) em server.js) — ninguém é avisado
// ativamente. Um canal parado por dias pode passar despercebido até
// alguém notar dado desatualizado na dashboard. Pedido do Luan, 19/08/2026.
import 'dotenv/config';
import { getChannelHealth, setChannelHealth } from './store.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
// Não alerta na primeira falha isolada (rate limit passageiro, blip de rede) — só quando um
// canal fica travado por tempo demais. Configurável porque "tempo demais" depende do canal:
// Amazon já tem backoff próprio que pode levar horas em uso normal, então o padrão é folgado.
const STALE_HOURS = Number(process.env.ALERT_STALE_HOURS || 6);

export function isConfigured() { return Boolean(TOKEN && CHAT_ID); }

export async function sendTelegramMessage(text) {
  if (!isConfigured()) return;
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Telegram sendMessage: ${res.status} ${body.description || ''}`);
  }
}

// Rótulo amigável por canal — mesmo texto usado na dashboard, pra reconhecer na hora.
const CHANNEL_LABEL = {
  shopify: 'Shopify BR', shopify_us: 'Shopify EUA',
  yucaloo_br: 'Yucaloo BR', yucaloo_us: 'Yucaloo EUA',
  shopee: 'Shopee', mercadolivre: 'Mercado Livre',
  meta: 'Meta Ads BR', meta_us: 'Meta Ads EUA',
  amazon: 'Amazon (BR + EUA)',
};

function fmtHours(h) {
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.floor(h / 24)}d ${Math.round(h % 24)}h`;
}

// Chamado depois de cada runSync() (server.js) com o `report` que sync.js já monta —
// não duplica lógica de fetch, só cruza report.errors/report.disabled com o histórico salvo
// (kv.channelHealth) pra decidir se algo precisa de alerta. `report.errors` vem como strings
// "canal.operacao: mensagem" (ex.: "shopify.orders: timeout") — agrupamos pelo prefixo antes do
// primeiro "." porque um canal com 3 sub-operações falhando (orders/sessions/catalog) deve virar
// UM alerta de canal, não três.
export async function checkSyncHealth(report) {
  if (!isConfigured()) return;
  try {
    const health = getChannelHealth();
    const disabled = new Set(report.disabled || []);
    const failingNow = new Set((report.errors || []).map(e => e.split('.')[0].split(':')[0].trim()));
    let changed = false;

    for (const ch of Object.keys(CHANNEL_LABEL)) {
      const rec = health[ch];
      if (disabled.has(ch)) {
        if (rec) { delete health[ch]; changed = true; } // desligado pela tela — não é falha
        continue;
      }
      if (failingNow.has(ch)) {
        if (!rec) {
          health[ch] = { failingSince: new Date().toISOString(), alerted: false };
          changed = true;
        } else if (!rec.alerted) {
          const hours = (Date.now() - Date.parse(rec.failingSince)) / 3600000;
          if (hours >= STALE_HOURS) {
            await sendTelegramMessage(
              `⚠️ <b>${CHANNEL_LABEL[ch]}</b> parou de sincronizar há ${fmtHours(hours)}.\n`
              + `Confira a tela de Integrações — pode ser token expirado ou a API do canal fora do ar.`
            );
            rec.alerted = true;
            changed = true;
          }
        }
      } else if (rec) {
        if (rec.alerted) {
          const hours = (Date.now() - Date.parse(rec.failingSince)) / 3600000;
          await sendTelegramMessage(`✅ <b>${CHANNEL_LABEL[ch]}</b> voltou a sincronizar normalmente (ficou ${fmtHours(hours)} travado).`);
        }
        delete health[ch];
        changed = true;
      }
    }
    if (changed) setChannelHealth(health);
  } catch (e) {
    // Alerta que falha não pode derrubar o sync em si — só loga, mesmo princípio de
    // "nunca engolir erro silenciosamente" mas sem propagar pro chamador.
    console.error('Alerta de sync falhou:', e.message);
  }
}
