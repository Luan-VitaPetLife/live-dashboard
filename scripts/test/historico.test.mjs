// Histórico de edições — quem mudou o quê, quando, e de quanto pra quanto.
//
// O registro mora DENTRO das funções de gravação do store, não nos handlers do servidor: é lá que
// o valor ANTIGO ainda existe, e é por lá que passa obrigatoriamente qualquer tela que salve algo.
//
// O que este teste protege, que quebra em silêncio:
//   1. salvar sem mudar nada não pode virar linha — senão "mudou" deixa de significar mudou;
//   2. senha nunca entra no registro, nem no valor antigo nem no novo;
//   3. a frase e os valores saem PRONTOS do servidor (a tela que reformata pode mostrar um número
//      diferente do que foi salvo, justamente na tela que existe pra dizer qual era o número);
//   4. o filtro de país não pode engolir edição que não é de país nenhum;
//   5. o histórico é tabela própria, nunca uma chave do kv (que é reescrito inteiro a cada
//      gravação);
//   6. a tela é de administrador, nos dois lados.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { criarTeste, ROOT, PUB } from './_lib.mjs';
import { montar, frase, valor, mercadoDaLinha, PAGINAS, INTEGRACOES } from '../../src/historico.js';

const t = criarTeste('Histórico de edições');

const STORE  = fs.readFileSync(path.join(ROOT, 'src', 'store.js'), 'utf8');
const AUTH   = fs.readFileSync(path.join(ROOT, 'src', 'auth.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// ── 1. Só o que mudou de verdade vira registro ────────────────────────────────
// `registrarCampos` roda de verdade, com o `registrarEdicao` substituído por um espião.
// O corpo comeca depois da ASSINATURA, nao no primeiro `{` do arquivo: uma funcao com valor
// padrao de objeto (`patch = {}`) tem chave dentro dos parenteses, e contar a partir dali fecha
// o bloco no lugar errado e deixa passar defeito sem ninguem ver.
function corpoDaFuncao(src, i) {
  let paren = 0, inicio = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '(') paren++;
    else if (src[j] === ')') { paren--; if (paren === 0) { inicio = src.indexOf('{', j); break; } }
  }
  let prof = 0;
  for (let j = inicio; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}') { prof--; if (prof === 0) return src.slice(i, j + 1); }
  }
  return '';
}

function carregarRegistrarCampos() {
  const i = STORE.indexOf('function registrarCampos(');
  const corpo = corpoDaFuncao(STORE, i);
  const gravados = [];
  const ctx = { console, registrarEdicao: r => gravados.push(r) };
  vm.createContext(ctx);
  vm.runInContext(corpo, ctx);
  return { registrarCampos: ctx.registrarCampos, gravados };
}

const { registrarCampos, gravados } = carregarRegistrarCampos();
t.ok(typeof registrarCampos === 'function', 'achou registrarCampos em store.js');

if (typeof registrarCampos === 'function') {
  const ROTULOS = { cog: { rotulo: 'COG', formato: 'dinheiro' }, shipping: { rotulo: 'Frete', formato: 'dinheiro' } };
  const base = { pagina: 'produtos', canal: 'shopee', alvo: 'Lisina 120g' };

  registrarCampos(base, { cog: 15.21, shipping: 4 }, { cog: 16.4, shipping: 4 }, ROTULOS);
  t.eq(gravados.length, 1, 'salvar dois campos mudando um só grava uma linha');
  t.eq(gravados[0].campo, 'COG', 'a linha é a do campo que mudou');
  t.eq(gravados[0].de, 15.21, 'com o valor antigo');
  t.eq(gravados[0].para, 16.4, 'e o novo');
  t.eq(gravados[0].formato, 'dinheiro', 'e o formato, que é quem grava que sabe');

  gravados.length = 0;
  registrarCampos(base, { cog: 15.21 }, { cog: 15.21 }, ROTULOS);
  t.eq(gravados.length, 0, 'salvar sem mudar nada não vira linha nenhuma');

  gravados.length = 0;
  registrarCampos(base, {}, { cog: 15.21 }, ROTULOS);
  t.eq(gravados.length, 1, 'preencher um campo vazio vira linha');
  t.eq(gravados[0].de, null, 'com o valor antigo vazio');
}

// ── 2. As frases ──────────────────────────────────────────────────────────────
t.eq(
  frase({ autor: 'Luan', acao: 'editou', alvo: 'Lisina 120g', campo: 'COG' }, { de: 'R$ 15,21', para: 'R$ 16,40' }),
  'Luan mudou COG em Lisina 120g: de R$ 15,21 para R$ 16,40',
  'edição com valor antigo e novo vira frase completa');
t.eq(
  frase({ autor: 'Luan', acao: 'editou', alvo: 'Lisina 120g', campo: 'COG' }, { de: null, para: 'R$ 16,40' }),
  'Luan definiu COG em Lisina 120g como R$ 16,40',
  'campo que estava vazio é "definiu", não "mudou de nada"');
t.eq(
  frase({ autor: 'Luan', acao: 'desligou', alvo: 'Shopee' }, {}),
  'Luan desligou Shopee', 'liga/desliga tem frase própria');
t.eq(
  frase({ autor: null, acao: 'apagou', alvo: 'Grupo Daily' }, {}),
  'O sistema apagou Grupo Daily',
  'edição sem pessoa aparece como sistema, em vez de frase começando em branco');

// ── 3. Valores formatados no servidor ─────────────────────────────────────────
// O Intl separa o símbolo do número com espaço NÃO separável (U+00A0), não com espaço comum.
// A comparação normaliza os dois porque o caractere invisível não é o que este teste protege —
// mas quem for comparar essa string em outro lugar precisa saber que ele está ali.
const semNbsp = v => String(v).replace(/\u00a0/g, ' ');
t.eq(semNbsp(valor(16.4, 'dinheiro', 'br')), 'R$ 16,40', 'dinheiro do BR sai com centavos e símbolo do Intl');
t.eq(semNbsp(valor(16.4, 'dinheiro', 'us')), '$16.40', 'dinheiro dos EUA sai em dólar');
t.eq(valor(2.64, 'porcentagem', 'br'), '2,64%', 'porcentagem sai com vírgula');
t.eq(valor(null, 'dinheiro', 'br'), null, 'campo vazio continua vazio, não vira R$ 0,00');

// ── 4. Mercado e filtro de país ───────────────────────────────────────────────
t.eq(mercadoDaLinha({ canal: 'amazon_us' }), 'us', 'o canal diz o país quando a edição é por canal');
t.eq(mercadoDaLinha({ canal: 'shopee' }), 'br', 'idem para o Brasil');
t.eq(mercadoDaLinha({ market: 'us', canal: null }), 'us', 'e o país gravado tem prioridade');
t.eq(mercadoDaLinha({ canal: null }), null, 'edição que não é de país nenhum não inventa um');

{
  const linhas = [
    { ts: '2026-09-04T12:00:00.000Z', autor: 'Luan', pagina: 'produtos', canal: 'shopee',    acao: 'editou', alvo: 'Lisina', campo: 'COG', formato: 'dinheiro', de: 15.21, para: 16.4 },
    { ts: '2026-09-04T11:00:00.000Z', autor: 'Luan', pagina: 'produtos', canal: 'amazon_us', acao: 'editou', alvo: 'Daily',  campo: 'COG', formato: 'dinheiro', de: 3, para: 4 },
    { ts: '2026-09-04T10:00:00.000Z', autor: 'Luan', pagina: 'integracoes', acao: 'desligou', alvo: 'shopee' },
  ];
  t.eq(montar(linhas, { pagina: 'produtos' }).length, 2, 'o filtro de página só traz aquela página');
  t.eq(montar(linhas, { pagina: 'produtos', market: 'br' }).length, 1, 'e o de país recorta pelo canal');

  const br = montar(linhas, { pagina: 'produtos', market: 'br' })[0];
  t.eq(semNbsp(br.para), 'R$ 16,40', 'o valor chega pronto na tela');
  // Os pedaços precisam remontar exatamente a frase: se divergirem, a tela mostra uma coisa e
  // quem lê a API direto lê outra.
  t.eq(br.partes.map(p => p.v).join(''), br.texto, 'os pedaços remontam a frase inteira');
  t.eq(br.partes.filter(p => p.t === 'de').length, 1, 'com o valor antigo separado');
  t.eq(br.partes.filter(p => p.t === 'para').length, 1, 'e o novo também');
  t.eq(br.canal, 'Shopee', 'com o nome do canal, não a chave interna');
  const us = montar(linhas, { pagina: 'produtos', market: 'us' })[0];
  t.eq(semNbsp(us.para), '$4.00', 'e cada país com a sua moeda');

  // A Shopee só existe no Brasil, então desligá-la é uma edição brasileira: quem filtrar por
  // Brasil precisa ver isso, senão o filtro esconde justamente o que a pessoa foi procurar.
  const integ = montar(linhas, { pagina: 'integracoes', market: 'br' });
  t.eq(integ.length, 1, 'liga/desliga de integração aparece sob o país dela');
  t.eq(integ[0].texto, 'Luan desligou Shopee', 'com o nome que a tela de Integrações mostra, não a chave interna');
  t.eq(montar(linhas, { pagina: 'integracoes', market: 'us' }).length, 0, 'e não aparece no país errado');

  // Já usuário não é de país nenhum: mostrá-lo sob uma bandeira diria que existe um "usuário do
  // Brasil", que não é uma coisa que a dashboard tenha.
  const usuario = [{ ts: '2026-09-04T09:00:00.000Z', autor: 'Luan', pagina: 'configuracoes', acao: 'criou', alvo: 'Maria', campo: 'Usuário', para: 'padrão' }];
  t.eq(montar(usuario, { pagina: 'configuracoes', market: 'br' }).length, 0, 'edição sem país não aparece sob um país');
  t.eq(montar(usuario, { pagina: 'configuracoes' }).length, 1, 'mas aparece quando nenhum país está filtrado');
}

// ── 4b. A lista de integrações não pode envelhecer escondida ──────────────────
// O nome e o país de cada integração estão escritos em dois lugares: aqui e em
// computeIntegrationsList (server.js), que é o que a tela de Integrações mostra. Uma cópia que
// diverge não dá erro nenhum: o histórico só passa a chamar a integração por outro nome, ou a
// escondê-la do país certo.
{
  const doServidor = {};
  for (const m of SERVER.matchAll(/key: '([a-z_]+)', label: '([^']*)', country: '([a-z]+)'/g)) {
    doServidor[m[1]] = { label: m[2], market: m[3] };
  }
  const daqui = Object.keys(INTEGRACOES).sort().join(',');
  const doLa  = Object.keys(doServidor).sort().join(',');
  t.eq(daqui, doLa, 'o histórico conhece exatamente as mesmas integrações que a tela de Integrações');
  const divergentes = Object.keys(doServidor).filter(k =>
    !INTEGRACOES[k] || INTEGRACOES[k].label !== doServidor[k].label || INTEGRACOES[k].market !== doServidor[k].market);
  t.eq(divergentes.length, 0, `nome e país de cada integração batem nos dois lugares${divergentes.length ? ' (' + divergentes.join(', ') + ')' : ''}`);
}

// ── 5. Senha nunca entra no histórico ─────────────────────────────────────────
// O registro de troca de senha existe (é o fato que importa), mas sem valor nenhum junto.
{
  const chamadas = [...AUTH.matchAll(/registrarEdicao\(\{[\s\S]*?\}\);/g)].map(m => m[0]);
  t.ok(chamadas.length >= 4, `auth.js registra as mudanças de usuário (achei ${chamadas.length})`);
  const vazando = chamadas.filter(c => /\b(salt|hash|patch\.password|newPassword|password)\b/.test(c));
  t.eq(vazando.length, 0, 'nenhum registro de usuário carrega senha, hash ou salt');
  const senha = chamadas.find(c => /campo: 'Senha'/.test(c));
  t.ok(senha && /de: null, para: null/.test(senha), 'a troca de senha é registrada sem valor antigo nem novo');
}

// ── 6. Tudo que uma pessoa edita passa a ser registrado ───────────────────────
// Uma função de gravação que fique de fora não dá erro nenhum: a edição acontece e simplesmente
// não aparece no histórico, que é o jeito mais silencioso possível de esse recurso furar.
const EDITAVEIS = [
  'setProductFinance', 'setProductStock', 'setProductStockAgg',
  'upsertProductGroup', 'deleteProductGroup', 'removeFromProductGroup', 'setProductGroupsEnabled',
  'setProductGroupType', 'upsertProductTypeGroup', 'removeProductTypeKeyword', 'deleteProductTypeGroup',
  'upsertProductHiddenTags', 'removeProductHiddenTag',
  'setIntegrationEnabled', 'setAmazonRetentionConfig',
];
for (const fn of EDITAVEIS) {
  const i = STORE.indexOf(`export function ${fn}(`);
  if (i < 0) { t.ok(false, `${fn} existe em store.js`); continue; }
  const corpo = corpoDaFuncao(STORE, i);
  t.ok(/registrarEdicao\(|registrarCampos\(/.test(corpo), `${fn} registra a edição no histórico`);
}

// ── 6b. Getter que devolve referência viva esconde a edição ───────────────────
// O handler da retenção da Amazon pega a config, mexe nela e devolve pro setter. Com a referência
// viva do store, o setter recebe o objeto JÁ alterado como se fosse o valor antigo, conclui que
// nada mudou e não registra nada — sem erro em lugar nenhum.
t.ok(/getAmazonRetentionConfig\(\) \{ return \{ \.\.\.\(load\(\)\.amazonRetentionConfig/.test(STORE),
  'a config de retenção volta como cópia, senão a edição some do histórico');

// ── 7. Onde o histórico é guardado ────────────────────────────────────────────
// Tabela própria. No kv, uma lista que só cresce faria cada edição reescrever o histórico inteiro.
t.ok(/CREATE TABLE IF NOT EXISTS historico/.test(STORE), 'o histórico tem tabela própria no Postgres');
t.ok(/CREATE INDEX IF NOT EXISTS historico_ts_idx/.test(STORE), 'com índice por data, que é como a tela consulta');
t.ok(!/pgKv\('historico'/.test(STORE), 'e nunca vira uma chave do kv');
t.ok(/DELETE FROM historico WHERE ts </.test(STORE), 'a retenção poda o que passou do prazo');
t.ok(/podarHistorico\(\)/.test(fs.readFileSync(path.join(ROOT, 'src', 'sync.js'), 'utf8')), 'e a poda roda no sync');

// ── 8. Quem editou vem da sessão, não de parâmetro solto ──────────────────────
t.ok(/comAutor\(req\.authUser\?\.name \|\| null, next\)/.test(SERVER),
  'o servidor marca o autor da requisição uma vez, pra toda gravação dentro dela');
t.ok(/AsyncLocalStorage/.test(fs.readFileSync(path.join(ROOT, 'src', 'autor.js'), 'utf8')),
  'e usa AsyncLocalStorage: variável global seria sobrescrita pela requisição seguinte');

// ── 9. A tela é de administrador nos DOIS lados ───────────────────────────────
// Só no cliente seria decoração: quem soubesse a URL veria o que todo mundo editou.
t.ok(/app\.get\('\/api\/history', requireAdmin/.test(SERVER), 'a API do histórico exige administrador');
t.ok(/app\.get\('\/api\/history\/paginas', requireAdmin/.test(SERVER), 'a lista de páginas também');
t.ok(/file === 'historico\.html'[\s\S]{0,80}role !== 'admin'/.test(SERVER)
  || /historico\.html'\) && user\.role !== 'admin'/.test(SERVER), 'e a página só abre para administrador');

const sidebar = fs.readFileSync(path.join(PUB, 'js', 'sidebar.js'), 'utf8');
t.ok(/data-page="historico\.html"/.test(sidebar), 'a sidebar tem o item Histórico');
t.ok(/navHistorico/.test(sidebar), 'e ele só aparece para administrador');
t.ok(/historico: 'historico\.html'/.test(sidebar), 'com a URL limpa registrada na sidebar');
t.ok(/historico: 'historico\.html'/.test(SERVER), 'e no servidor');

// ── 10. A tela não remonta frase nem valor por conta própria ──────────────────
const telaJs = fs.readFileSync(path.join(PUB, 'js', 'paginas', 'historico.js'), 'utf8');
t.ok(/item\.partes/.test(telaJs), 'a tela usa a frase em pedaços que veio pronta');
// Procurar o valor dentro da frase pronta embaralha quando um valor é pedaço do outro
// ("de 10 para 1"): o "1" seria achado dentro do "10" que acabou de ser marcado.
t.ok(!/texto\.replace|txt\.replace/.test(telaJs), 'e não vasculha o texto atrás dos valores');
t.ok(!/toLocaleString\([^)]*currency/.test(telaJs), 'e não formata dinheiro por conta própria');

// Toda página oferecida tem que ter mesmo algo editável, senão o seletor promete lista vazia.
for (const p of PAGINAS) {
  t.ok(new RegExp(`pagina: '${p.id}'`).test(STORE) || new RegExp(`pagina: '${p.id}'`).test(AUTH),
    `a página "${p.label}" tem edição registrada em algum lugar`);
}

t.fim();
