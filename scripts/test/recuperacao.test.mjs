// "Esqueci a senha" (src/recuperacao.js, src/email.js, rotas /api/senha/*, tela de login).
//
// A tela diz com clareza o que aconteceu (decisão do Luan, 24/09/2026). O que continua protegido, e
// nada disso dá erro quando some: chutar os 6 dígitos, encher a caixa de e-mail de alguém, usar o
// mesmo código duas vezes, continuar logado depois que o dono trocou a senha, dizer "enviado" quando
// o e-mail não saiu.
//
// Executa a regra com relógio e usuários falsos. Não faz rede e não toca no banco.
import path from 'node:path';
import { criarTeste, ler, ROOT, fontePagina } from './_lib.mjs';

const t = criarTeste('esqueci a senha');
const imp = rel => import('file:///' + path.join(ROOT, rel).replace(/\\/g, '/'));
const R = await imp('src/recuperacao.js');
const M = R.MENSAGENS;

function montar() {
  let agora = 1_000_000;
  const usuarios = [
    { id: 'u1', username: 'maria', name: 'Maria', email: 'maria@x.com' },
    { id: 'u2', username: 'joao', name: 'João', email: '' },
  ];
  const trocas = [], derrubadas = [];
  const proximo = ['111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888'];
  const rec = R.criarRecuperacao({
    acharUsuario: l => usuarios.find(u => u.username === l || (u.email && u.email === l)) || null,
    trocarSenha: (u, s) => trocas.push([u.id, s]),
    derrubarSessoes: id => derrubadas.push(id),
    agora: () => agora,
    gerar: () => proximo.shift(),
  });
  return { rec, trocas, derrubadas, passar: ms => { agora += ms; } };
}
const erro = fn => { try { fn(); return null; } catch (e) { return e.message; } };

// ── Código ──
let seisDigitos = true;
for (let i = 0; i < 200; i++) if (!/^\d{6}$/.test(R.gerarCodigo())) seisDigitos = false;
t.ok(seisDigitos, 'o código gerado tem sempre 6 dígitos (com zero à esquerda)');
t.eq(R.mascararEmail('maria.silva@gmail.com'), 'm***@gmail.com', 'o e-mail aparece mascarado na tela');

// ── Pedir: a tela diz o que aconteceu ──
{
  const { rec, passar } = montar();
  t.eq(rec.pedir('ninguem').status, 'naoEncontrado', 'usuário que não existe: diz que não encontrou');
  t.eq(rec.pedir('joao').status, 'semEmail', 'usuário sem e-mail: diz que falta cadastrar o e-mail');
  const p = rec.pedir('maria');
  t.ok(p.status === 'enviar' && p.codigo === '111111' && p.usuario.email === 'maria@x.com', 'usuário com e-mail: código gerado pra enviar');
  const espera = rec.pedir('maria@x.com');
  t.ok(espera.status === 'aguarde' && espera.segundos === 60, 'pedir de novo no mesmo minuto: diz quantos segundos esperar (pelo e-mail também)');
  passar(20 * 1000);
  t.eq(rec.pedir('maria').segundos, 40, 'e a espera diminui com o tempo');
  passar(41 * 1000);
  t.eq(rec.pedir('maria@x.com').codigo, '222222', 'depois de um minuto, dá pra pedir de novo');
  for (let i = 0; i < 3; i++) { passar(61 * 1000); rec.pedir('maria'); }
  passar(61 * 1000);
  t.eq(rec.pedir('maria').status, 'limiteHora', 'no máximo 5 códigos por hora');
  passar(60 * 60 * 1000);
  t.eq(rec.pedir('maria').status, 'enviar', 'passada a hora, volta a poder');
}

// ── E-mail que não saiu não conta ──
{
  const { rec } = montar();
  const p = rec.pedir('maria');
  rec.desfazer(p.usuario.id);
  t.eq(rec.pedir('maria').status, 'enviar', 'falhou o envio: dá pra pedir de novo na hora, sem esperar o minuto');
  t.eq(erro(() => rec.redefinir('maria', '111111', 'senhaboa123')), 'Código errado. Restam 4 tentativas.',
    'e o código que não foi entregue não vale');
}

// ── Redefinir ──
{
  const { rec, trocas, derrubadas, passar } = montar();
  rec.pedir('maria'); // 111111
  t.eq(erro(() => rec.redefinir('maria', '111111', 'curta')), `A senha precisa ter pelo menos ${R.SENHA_MINIMA} caracteres.`, 'senha fraca é recusada');
  t.eq(erro(() => rec.redefinir('maria', '111111', 'senhaboa123')), null, 'e o código continua valendo depois dela');
  t.eq(JSON.stringify(trocas), JSON.stringify([['u1', 'senhaboa123']]), 'a senha é trocada, do usuário certo');
  t.eq(JSON.stringify(derrubadas), JSON.stringify(['u1']), 'e todas as sessões dele caem');
  t.eq(erro(() => rec.redefinir('maria', '111111', 'outrasenha9')), M.semPedido, 'o código serve uma vez só');
  t.eq(erro(() => rec.redefinir('ninguem', '111111', 'senhaboa123')), M.naoEncontrado, 'usuário que não existe: diz que não encontrou');
  t.eq(erro(() => rec.redefinir('joao', '111111', 'senhaboa123')), M.semPedido, 'quem não pediu código: diz pra pedir');

  passar(61 * 1000);
  rec.pedir('maria'); // 222222
  passar(R.VALIDADE_MS + 1);
  t.eq(erro(() => rec.redefinir('maria', '222222', 'senhaboa123')), M.vencido, 'código vencido: diz que venceu');

  passar(61 * 1000);
  rec.pedir('maria'); // 333333
  t.eq(erro(() => rec.redefinir('maria', '000000', 'senhaboa123')), 'Código errado. Restam 4 tentativas.', 'código errado: diz quantas tentativas restam');
  for (let i = 0; i < 3; i++) erro(() => rec.redefinir('maria', '000000', 'senhaboa123'));
  t.eq(erro(() => rec.redefinir('maria', '000000', 'senhaboa123')), M.esgotado, 'a quinta errada esgota');
  t.eq(erro(() => rec.redefinir('maria', '333333', 'senhaboa123')), M.semPedido,
    'e depois disso nem o código certo vale (sem teto, um script chutaria o milhão)');

  passar(61 * 1000);
  rec.pedir('maria'); // 444444
  passar(61 * 1000);
  rec.pedir('maria'); // 555555
  t.eq(erro(() => rec.redefinir('maria', '444444', 'senhaboa123')), 'Código errado. Restam 4 tentativas.', 'pedir de novo invalida o código anterior');
  t.eq(erro(() => rec.redefinir('maria', ' 555555 ', 'senhaboa123')), null, 'o último vale (espaço em volta não atrapalha)');
}

// ── O código não fica guardado em texto ──
const REC = ler('src/recuperacao.js');
t.ok(/pendentes\.set\(u\.id, \{ hash: hashDoCodigo\(u\.id, codigo\), expiraEm: t \+ VALIDADE_MS, tentativas: 0 \}\);/.test(REC),
  'guarda o hash do código, nunca o código');
t.eq((REC.match(/pendentes\.set\(/g) || []).length, 1, 'e esse é o único lugar que guarda pedido pendente');
t.ok(/crypto\.timingSafeEqual\(digitado, p\.hash\)/.test(REC), 'e compara em tempo constante');
t.ok(/crypto\.randomInt\(/.test(REC), 'o código sai de gerador criptográfico');

// ── Rota ──
const SERVER = ler('server.js');
const esqueci = SERVER.slice(SERVER.indexOf("app.post('/api/senha/esqueci'"), SERVER.indexOf("app.post('/api/senha/redefinir'"));
t.ok(/await enviarEmail\(/.test(esqueci), 'a tela só diz "enviado" depois que o e-mail saiu');
t.ok(/catch \(e\) \{\s*recuperacao\.desfazer\(p\.usuario\.id\);\s*console\.error\([\s\S]*?res\.status\(502\)/.test(esqueci),
  'falha no envio desfaz o pedido, vai pro log e aparece como falha');
t.ok(esqueci.indexOf('await enviarEmail(') < esqueci.indexOf('Código enviado para'), 'e a mensagem de enviado vem depois do envio');
t.ok(/Código enviado para \$\{mascararEmail\(p\.usuario\.email\)\}/.test(esqueci), 'diz pra qual e-mail foi, mascarado');
t.ok(/comAutor\(u\.name \|\| u\.username, \(\) => auth\.changePassword/.test(SERVER), 'a troca aparece no Histórico como feita pelo próprio usuário');

// ── Cadastro ──
const AUTH = ler('src/auth.js');
t.ok(/email: u\.email \|\| '',\s*phone: u\.phone \|\| '',/.test(AUTH), 'o cadastro expõe e-mail e telefone');
t.ok(/Esse e-mail já está em outro usuário\./.test(AUTH), 'e-mail é único (senão, de quem seria a senha trocada?)');
t.ok(/campo: 'E-mail', de: null, para: null/.test(AUTH), 'o Histórico registra que o e-mail mudou, sem o valor');

// ── Envio (sem rede) ──
delete process.env.BREVO_API_KEY; delete process.env.BREVO_SENDER_EMAIL;
const E = await imp('src/email.js');
t.eq(E.emailConfigurado(), false, 'sem chave da Brevo, o envio conta como não configurado');
let falhou = null;
try { await E.enviarEmail({ para: 'a@b.com', assunto: 'x', texto: 'y' }); } catch (e) { falhou = e.message; }
t.ok(/não configurado/.test(falhou || ''), 'e enviar sem configuração dá erro, em vez de fingir que mandou');

// ── Tela ──
const tela = fontePagina('login.html').tudo;
t.ok(/id="forgotForm" hidden/.test(tela) && /\[hidden\]\{ display:none !important; \}/.test(tela),
  'o formulário de recuperação nasce escondido, e o hidden vence o form{display:flex}');
t.ok(/\/api\/senha\/canais/.test(tela), 'sem e-mail configurado, a tela avisa antes de a pessoa digitar');
t.ok(!/Se o usuário existir|Se esse usuário existir/.test(tela + SERVER), 'nenhuma mensagem vaga do tipo "se existir, chega"');

t.fim();
