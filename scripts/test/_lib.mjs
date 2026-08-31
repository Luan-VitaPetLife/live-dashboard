// Base comum dos testes. Sem framework de propósito: o projeto não tem etapa de build nem
// dependência de desenvolvimento, e um runner de 40 linhas cobre o que precisamos aqui.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PUB = path.join(ROOT, 'public');

export const ler = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
export const paginas = () => fs.readdirSync(PUB).filter(f => f.endsWith('.html'));

// A lógica e o estilo de cada tela moram em arquivos próprios (js/paginas/, css/paginas/), mas
// continuam sendo a MESMA página pra quem lê o código. Um teste que só olhasse o .html deixaria de
// enxergar tudo o que saiu de dentro dele, e passaria a aprovar em silêncio — que é justamente o
// modo de falhar que esta suíte existe pra evitar. Por isso todo teste que inspeciona lógica ou
// estilo lê `tudo`; só quem confere estrutura de markup usa `html`.
export function fontePagina(nome) {
  const base = nome.replace(/\.html$/, '');
  const html = fs.readFileSync(path.join(PUB, nome), 'utf8');
  const parte = (pasta, ext) => {
    const p = path.join(PUB, pasta, base + ext);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  const js = parte('js/paginas', '.js');
  const css = parte('css/paginas', '.css');
  return { nome, html, js, css, tudo: html + '\n' + css + '\n' + js };
}


// Um teste é um arquivo que chama criarTeste(), faz suas asserções e termina com fim().
// O código de saída é o que o runner lê: 0 passou, 1 falhou, 2 pulou.
export function criarTeste(nome) {
  console.log(`\n── ${nome} ──`);
  let falhas = 0;
  return {
    ok(cond, msg) {
      console.log(`   ${cond ? 'ok  ' : 'FALHOU'} ${msg}`);
      if (!cond) falhas++;
      return !!cond;
    },
    // Igualdade: mostra o que veio quando falha, senão "FALHOU" não diz o que investigar.
    eq(recebido, esperado, msg) {
      const bate = recebido === esperado;
      console.log(`   ${bate ? 'ok  ' : 'FALHOU'} ${msg}${bate ? '' : `\n        esperava ${JSON.stringify(esperado)}, veio ${JSON.stringify(recebido)}`}`);
      if (!bate) falhas++;
      return bate;
    },
    info: msg => console.log(`   ·    ${msg}`),
    // Pular é diferente de passar: um teste que depende de rede não pode virar falha
    // quando a máquina está sem internet, mas também não pode se declarar aprovado.
    // Falha já registrada continua valendo: um teste com parte estática quebrada não vira
    // "pulado" só porque a parte que precisa de rede não pôde rodar.
    pular(motivo) {
      console.log(`   PULADO: ${motivo}`);
      console.log(falhas ? `   >>> ${falhas} falha(s)` : '   >>> pulado');
      process.exitCode = falhas ? 1 : 2;
    },
    // Marca o código de saída e DEIXA o processo terminar sozinho, em vez de chamar
    // process.exit(). Depois de um fetch, o pool de conexões ainda está se fechando, e no
    // Windows um process.exit nesse instante derruba o Node com erro interno do libuv — o
    // teste passava e o runner via um travamento. Por isso todo teste termina com fim() e
    // nada depois dele: quem precisa parar antes usa um if, não uma saída forçada.
    fim() {
      console.log(falhas ? `   >>> ${falhas} falha(s)` : '   >>> ok');
      if (falhas) process.exitCode = 1;
    },
  };
}

// Tenta uma requisição e devolve null se a máquina estiver sem rede, pra quem chamou
// decidir entre pular o teste e falhar.
// O tempo limite usa AbortController com um setTimeout que é sempre limpo, em vez de
// AbortSignal.timeout: o timer daquele fica pendurado depois da resposta e, no Windows, um
// process.exit com ele vivo derruba o Node com erro interno do libuv em vez de sair limpo.
export async function buscar(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'coco-luna-dashboard/1.0 (teste automatizado)' },
      signal: ctrl.signal,
    });
    // Consome o corpo aqui: deixar a resposta aberta também segura um handle vivo.
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: r.ok, status: r.status, tipo: r.headers.get('content-type') || '', bytes: buf.length };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
