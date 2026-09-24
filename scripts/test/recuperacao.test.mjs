// "Esqueci a senha" (src/recuperacao.js, src/email.js, rotas /api/senha/*, tela de login).
//
// Cada regra fecha um abuso da tela de login, e nenhum deles dá erro quando a regra some:
// descobrir quais usuários existem, chutar os 6 dígitos, encher a caixa de e-mail de alguém, usar
// o mesmo código duas vezes, continuar logado depois que o dono trocou a senha.
//
// Executa a regra com relógio e usuários falsos. Não faz rede e não toca no banco.
import path from 'node:path';
import { criarTeste, ler, ROOT, fontePagina } from './_lib.mjs';

const t = criarTeste('esqueci a senha');
const imp = rel => import('file:///' + path.join(ROOT, rel).replace(/\\/g, '/'));
const R = await imp('src/recuperacao.js');

function montar() {
  let agora = 1_000_000;
  const usuarios = [
    { id: 'u1', username: 'maria', name: 'Maria', email: 'maria@x.com' },
    { id: 'u2', username: 'joao', name: 'João', email: '' },
  ];
  const trocas = [], derrubadas = [];
  let proximo = ['111111', '222222', '333333', '444444', '555555', '666666', '777777'];
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
for (let i = 0; i < 200; i++) {
  const c = R.gerarCodigo();
  if (!/^\d{6}$/.test(c)) { t.ok(false, `código com 6 dígitos (veio "${c}")`); break; }
}
t.ok(true, 'o código gerado tem sempre 6 dígitos (com zero à esquerda)');

// ── Pedir ──
{
  const { rec, passar } = montar();
  t.eq(rec.pedir('ninguem'), null, 'usuário que não existe: nada é enviado');
  t.eq(rec.pedir('joao'), null, 'usuário sem e-mail: nada é enviado');
  const p = rec.pedir('maria');
  t.ok(p && p.codigo === '111111' && p.usuario.email === 'maria@x.com', 'usuário com e-mail recebe o código');
  t.ok(rec.pedir('maria@x.com') === null, 'pedir de novo no mesmo minuto não reenvia (nem pelo e-mail)');
  passar(61 * 1000);
  t.ok(rec.pedir('maria@x.com')?.codigo === '222222', 'depois de um minuto, dá pra pedir de novo, pelo e-mail também');
  for (let i = 0; i < 3; i++) { passar(61 * 1000); rec.pedir('maria'); }
  passar(61 * 1000);
  t.eq(rec.pedir('maria'), null, 'no máximo 5 códigos por hora');
  passar(60 * 60 * 1000);
  t.ok(rec.pedir('maria') !== null, 'passada a hora, volta a poder');
}

// ── Redefinir ──
{
  const { rec, trocas, derrubadas, passar } = montar();
  rec.pedir('maria');
  t.eq(erro(() => rec.redefinir('maria', '111111', 'curta')), `A senha precisa ter pelo menos ${R.SENHA_MINIMA} caracteres.`,
    'senha fraca é recusada');
  t.eq(erro(() => rec.redefinir('maria', '111111', 'senhaboa123')), null, 'e o código continua valendo depois dela');
  t.eq(JSON.stringify(trocas), JSON.stringify([['u1', 'senhaboa123']]), 'a senha é trocada, do usuário certo');
  t.eq(JSON.stringify(derrubadas), JSON.stringify(['u1']), 'e todas as sessões dele caem');
  t.eq(erro(() => rec.redefinir('maria', '111111', 'outrasenha9')), R.ERRO_CODIGO, 'o código serve uma vez só');

  passar(61 * 1000);
  rec.pedir('maria'); // 222222
  t.eq(erro(() => rec.redefinir('ninguem', '222222', 'senhaboa123')), R.ERRO_CODIGO, 'usuário inexistente recebe a MESMA mensagem');
  t.eq(erro(() => rec.redefinir('joao', '222222', 'senhaboa123')), R.ERRO_CODIGO, 'e quem não pediu código também');
  passar(R.VALIDADE_MS + 1);
  t.eq(erro(() => rec.redefinir('maria', '222222', 'senhaboa123')), R.ERRO_CODIGO, 'código vencido não vale');

  passar(61 * 1000);
  rec.pedir('maria'); // 333333
  for (let i = 0; i < R.MAX_TENTATIVAS; i++) rec.redefinir && erro(() => rec.redefinir('maria', '000000', 'senhaboa123'));
  t.eq(erro(() => rec.redefinir('maria', '333333', 'senhaboa123')), R.ERRO_CODIGO,
    'depois de 5 erros, nem o código certo vale mais (sem teto, um script chutaria o milhão)');

  passar(61 * 1000);
  rec.pedir('maria'); // 444444
  passar(61 * 1000);
  rec.pedir('maria'); // 555555
  t.eq(erro(() => rec.redefinir('maria', '444444', 'senhaboa123')), R.ERRO_CODIGO, 'pedir de novo invalida o código anterior');
  t.eq(erro(() => rec.redefinir('maria', ' 555555 ', 'senhaboa123')), null, 'o último vale (espaço em volta não atrapalha)');
}

// ── O código não fica guardado em texto ──
const REC = ler('src/recuperacao.js');
t.ok(/pendentes\.set\(u\.id, \{ hash: hashDoCodigo\(u\.id, codigo\), expiraEm: t \+ VALIDADE_MS, tentativas: 0 \}\);/.test(REC),
  'guarda o hash do código, nunca o código');
t.eq((REC.match(/pendentes\.set\(/g) || []).length, 1, 'e esse é o único lugar que guarda pedido pendente');
t.ok(/crypto\.timingSafeEqual\(digitado, p\.hash\)/.test(REC), 'e compara em tempo constante');
t.ok(/crypto\.randomInt\(/.test(REC), 'o código sai de gerador criptográfico');

// ── Rotas ──
const SERVER = ler('server.js');
const esqueci = SERVER.slice(SERVER.indexOf("app.post('/api/senha/esqueci'"), SERVER.indexOf("app.post('/api/senha/redefinir'"));
t.ok(/res\.json\(\{ ok: true, message: RESPOSTA_PEDIDO \}\)/.test(esqueci) && (esqueci.match(/res\.json\(/g) || []).length === 1,
  'pedir código responde SEMPRE a mesma coisa, exista o usuário ou não');
t.ok(!/await enviarEmail/.test(esqueci) && /enviarEmail\([\s\S]*\.catch\(e => console\.error/.test(esqueci),
  'o e-mail sai em segundo plano (o tempo de resposta não denuncia o usuário) e a falha vai pro log');
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

t.fim();
