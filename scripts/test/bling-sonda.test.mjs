// Sonda das saídas em bonificação: o que ela pode e o que ela NÃO pode devolver.
//
// A resposta desta sonda existe pra ser lida e colada numa conversa, e a nota fiscal do Bling
// carrega nome, CPF, endereço, e-mail e telefone de quem recebeu. Já aconteceu uma vez de uma
// sonda deste projeto (a da Shopee) vazar o texto livre do comprador contrariando o próprio
// comentário dela — por isso o mascaramento é testado, e não só documentado.
//
// A allowlist é POSITIVA: campo novo que o Bling passe a mandar nasce mascarado, em vez de nascer
// exposto até alguém reparar. É isso que o último caso deste arquivo prova.
import fs from 'node:fs';
import path from 'node:path';
import { criarTeste, ROOT } from './_lib.mjs';
import { esqueletoBling, ehNaturezaDeBonificacao } from '../../src/bling.js';

const t = criarTeste('Sonda de bonificação (Bling)');

// Uma nota fiscal no formato que a tela do Bling mostra, com os dados de quem recebeu.
const NOTA = {
  id: 123456,
  numero: '000219',
  serie: 1,
  tipo: 1,
  situacao: 5,
  dataEmissao: '2026-09-04',
  naturezaOperacao: 'Saída em bonificação',
  valorNota: 0,
  contato: {
    nome: 'Fulana de Tal',
    numeroDocumento: '000.000.000-00',
    email: 'fulana@example.com',
    telefone: '(11) 90000-0000',
    endereco: { endereco: 'Avenida Qualquer', numero: '848', municipio: 'São Paulo', uf: 'SP', cep: '00000-000' },
  },
  itens: [{ codigo: 'DAILYSUPPORT-POWDER-BR', descricao: 'Daily Support para Gatos', quantidade: 1, valor: 0, unidade: 'UN' }],
};

const esq = esqueletoBling(NOTA);
const texto = JSON.stringify(esq);

// ── O que a sonda PRECISA trazer, senão ela não serve pra nada ──
t.eq(esq.naturezaOperacao, 'Saída em bonificação', 'a natureza de operação vem inteira: é ela que separa doação de venda');
t.eq(esq.numero, '000219', 'o número da nota vem, pra conferir contra o Bling');
t.eq(esq.valorNota, 0, 'e o valor, que nessas notas é zero');
t.eq(esq.itens[0].codigo, 'DAILYSUPPORT-POWDER-BR', 'o código do produto vem: é por ele que a unidade acha o produto');
t.eq(esq.itens[0].quantidade, 1, 'e a quantidade, que é o único número que interessa aqui');

// ── O que ela NÃO pode trazer ──
for (const [oq, valor] of [
  ['o nome de quem recebeu', 'Fulana de Tal'],
  ['o CPF',                  '000.000.000-00'],
  ['o e-mail',               'fulana@example.com'],
  ['o telefone',             '(11) 90000-0000'],
  ['o endereço',             'Avenida Qualquer'],
  ['o CEP',                  '00000-000'],
]) {
  t.ok(!texto.includes(valor), `a sonda não devolve ${oq}`);
}

// ── Allowlist positiva: campo novo nasce mascarado ──
// Se a lista fosse de proibidos, um campo que o Bling criasse amanhã ("nomeSocial", "documento")
// sairia exposto até alguém reparar. Aqui ele já nasce como tipo, não como valor.
const comCampoNovo = esqueletoBling({ ...NOTA, nomeSocial: 'Outro Nome', observacoes: 'anotação interna' });
t.ok(!JSON.stringify(comCampoNovo).includes('Outro Nome'), 'campo novo que o Bling mandar nasce mascarado');
t.ok(!JSON.stringify(comCampoNovo).includes('anotação interna'), 'inclusive observação livre');
t.eq(comCampoNovo.nomeSocial, '<string>', 'aparecendo como tipo, pra sonda continuar mostrando a FORMA da resposta');

// ── Campo vazio é vazio, não um bloco ilegível ──
// `typeof null` é 'object': sem tratar, um campo sem valor saía como "<object>" e parecia um
// pedaço que a sonda não conseguiu ler. Aconteceu na primeira rodada, com o pedido zerado.
t.eq(esqueletoBling(null), null, 'campo nulo continua nulo em vez de virar "<object>"');
t.eq(esqueletoBling({ loja: null }).loja, null, 'inclusive aninhado');

// ── A natureza vem como ID, e é assim que ela precisa ser lida ──
// Confirmado ao vivo: a nota traz `naturezaOperacao: { id }`, SEM descrição. Uma leitura que
// procure só o nome devolve "sem natureza" para todas as notas e não separa nada.
const comId = esqueletoBling({ naturezaOperacao: { id: 15110849801 } });
t.eq(comId.naturezaOperacao.id, 15110849801, 'o id da natureza chega inteiro para poder ser cruzado com o nome');

const bling = fs.readFileSync(path.join(ROOT, 'src', 'bling.js'), 'utf8');
t.ok(/naturezas-operacoes/.test(bling), 'a sonda busca a tabela de nomes das naturezas');
t.ok(/n\.naturezaOperacao\?\.id/.test(bling), 'e agrupa as notas pelo id da natureza, não pelo nome que não vem');

// ── Nada pode parar em 100 fingindo que acabou ──
// Uma página é o tamanho da página, não o tamanho do período. Foi o que aconteceu na primeira
// rodada: 100 notas e 100 pedidos, os dois truncados sem dizer.
t.ok(/incompleta = true/.test(bling), 'a paginação declara quando parou antes do fim');
// As DUAS listas paginam (notas e pedidos). Procurar a condição no arquivo inteiro passaria com
// uma das duas parando na primeira página, porque a outra ainda casa com a busca.
const paginam = (bling.match(/if \(lote\.length < 100\) break/g) || []).length;
t.eq(paginam, 2, 'as duas listas só terminam quando a página vem incompleta');

// ── A conta da bonificação precisa ser fechada, não amostrada ──
// A pergunta aqui não é "qual a forma do dado" (isso já se sabe), é "quantas unidades sairam".
// Uma amostra responderia a pergunta errada e pareceria uma resposta.
t.ok(/for \(const \[i, n\] of daBonificacao\.entries\(\)\)/.test(bling),
  'a sonda detalha todas as notas de bonificação, não uma amostra');
t.ok(/detalhesIncompleto = true/.test(bling), 'e declara quando o teto interrompeu a leitura');

// Nota de bonificação COM valor existe (confirmado ao vivo: a 000222 saiu com R$ 129,99). Filtrar
// doação por "valor zero" perderia essa nota, e somar o valor dela inventaria receita.
t.ok(/comValorNaoZero\+\+/.test(bling), 'a sonda conta as notas de doação que saíram com valor');

// Cancelada não pode contar como doação enviada. Sem separar por situação, ela entraria na conta.
t.ok(/porSituacao\[sit\]/.test(bling), 'e separa as notas por situação');
t.ok(/p\.unidades \+= Number\(it\.quantidade\)/.test(bling), 'somando UNIDADES, não notas');

// ── Quem decide é a NATUREZA, e ela precisa ser lida com precisão ──
// A loja de onde a doação sai pode mudar (decisão do Luan: depender da natureza, não da loja).
// E a conta tem AS DUAS bonificações: "Saída em bonificação" e "Entrada de bonificação". Casar por
// "bonifica" contaria mercadoria ENTRANDO como doada — o número exatamente ao contrário.
//
// A lista abaixo são as 25 naturezas REAIS da conta, lidas ao vivo em 04/09/2026. Exatamente uma
// pode casar.
const NATUREZAS_REAIS = [
  'Compra de mercadoria', 'Compra de mercadoria com ST', 'Devolução de compra',
  'Devolução de Compra - Industrialização', 'Devolução de compra com ST', 'Devolução de venda',
  'Devolução de venda com ST', 'Entrada de bonificação', 'Importação de mercadoria',
  'Remessa de mercadoria para conserto', 'Remessa de mercadoria para demonstração',
  'Remessa FBA (Mesmo Estado)', 'Remessa para armazém geral', 'Remessa simbólica',
  'Retorno de Mercadoria', 'Retorno de mercadoria enviada para conserto',
  'Retorno de mercadoria para demonstração', 'Saída em bonificação',
  'Transferência de comercialização', 'Transferência para comercialização', 'Venda (teste)',
  'Venda de mercadoria', 'Venda de mercadoria - Filial SP',
  'Venda de mercadoria a não contribuinte', 'Venda de mercadoria com ST',
];

const casam = NATUREZAS_REAIS.filter(ehNaturezaDeBonificacao);
t.eq(casam.length, 1, `exatamente uma das 25 naturezas da conta é doação (casaram: ${casam.join(', ') || 'nenhuma'})`);
t.eq(casam[0], 'Saída em bonificação', 'e é a de SAÍDA');
t.ok(!ehNaturezaDeBonificacao('Entrada de bonificação'), 'entrada de bonificação nunca conta como doação enviada');

// Acento e caixa não podem decidir nada: o mesmo nome digitado "Saida" tem que casar igual.
t.ok(ehNaturezaDeBonificacao('Saida em bonificacao'), 'sem acento casa igual');
t.ok(ehNaturezaDeBonificacao('SAÍDA EM BONIFICAÇÃO'), 'em maiúsculas também');
t.ok(!ehNaturezaDeBonificacao(''), 'nome vazio não casa');
t.ok(!ehNaturezaDeBonificacao(null), 'e natureza desconhecida também não');

// A regra não pode voltar a depender da loja: ela muda, e no dia em que mudar a contagem pararia
// sem nada acusar.
t.ok(!/206202176/.test(bling), 'a captura não fica presa ao id da loja de onde a doação sai hoje');

// A função pode estar certa e ninguém usá-la: a sonda tinha o próprio /bonifica/i inline, que era
// justamente o filtro que pegava a ENTRADA junto. Uma regra dessas precisa existir num lugar só.
t.ok(/ehBonificacao = id => ehNaturezaDeBonificacao\(/.test(bling),
  'a sonda decide pela função compartilhada, não por um filtro próprio');
// A forma antiga era um literal "bonifica/i". Fora dos comentários, ela não pode voltar a existir.
const semComentarios = bling.replace(/^\s*\/\/.*$/gm, '');
t.ok(!semComentarios.includes('bonifica/i'),
  'nenhum outro lugar decide bonificação com um filtro solto');

// ── A sonda é de administrador ──
// A resposta descreve a operação da empresa. `syncLimiter` sozinho não é controle de acesso.
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
t.ok(/app\.get\('\/api\/bling\/probe-bonificacao', requireAdmin/.test(server),
  'o endereço da sonda exige administrador');

t.fim();
