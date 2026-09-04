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
import { esqueletoBling } from '../../src/bling.js';

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

// ── A sonda é de administrador ──
// A resposta descreve a operação da empresa. `syncLimiter` sozinho não é controle de acesso.
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
t.ok(/app\.get\('\/api\/bling\/probe-bonificacao', requireAdmin/.test(server),
  'o endereço da sonda exige administrador');

t.fim();
