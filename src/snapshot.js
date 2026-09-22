// Monta o backup (JSON do store inteiro, comprimido) EM PARTES. Puro, pra o teste executar.
//
// Antes era `gzipSync(Buffer.from(JSON.stringify(tudo)))`: o banco inteiro virava um texto só na
// memória, depois uma cópia em bytes, depois o arquivo comprimido — três cópias ao mesmo tempo, com
// o servidor parado sem responder ninguém até acabar. Com o volume de antes da janela de 90 dias
// isso era ~115 MB de pico e ~1 s de servidor travado, todo dia (análise de custo, 22/09/2026).
//
// Aqui cada pedido é serializado sozinho e vai direto pro compressor, e a cada lote o servidor
// volta a atender requisição. O TEXTO produzido é exatamente o de JSON.stringify do objeto inteiro
// — o teste compara os dois caractere a caractere. É isso que mantém a restauração funcionando
// (scripts/restore-backup.mjs só faz JSON.parse): um backup que não restaura é pior que nenhum.
//
// O preço de soltar o servidor no meio: um sync que rode durante o backup pode entrar num pedaço e
// não em outro. A lista de ids é lida uma vez no começo; pedido apagado no meio do caminho é pulado
// e pedido atualizado sai na versão nova. Pro backup diário isso não importa — ele é um retrato de
// "mais ou menos agora", e o sync seguinte refaz qualquer pedido recente de qualquer jeito.
import zlib from 'node:zlib';

const LOTE = 500;
const respira = () => new Promise(r => setImmediate(r));

// `grandes` são as chaves de nível de cima que vão item a item (hoje só `orders`, que é quase todo
// o tamanho do backup). As outras são pequenas e vão num JSON.stringify só.
export async function snapshotGzip(obj, { grandes = ['orders'] } = {}) {
  const gz = zlib.createGzip();
  const saida = [];
  gz.on('data', c => saida.push(c));
  const fim = new Promise((ok, erro) => { gz.on('end', ok); gz.on('error', erro); });

  let pendente = '';
  const escreve = async (txt, forcar = false) => {
    pendente += txt;
    if (!forcar && pendente.length < 1 << 20) return;
    const pedaco = pendente; pendente = '';
    if (!gz.write(pedaco)) await new Promise(r => gz.once('drain', r));
  };

  await escreve('{');
  let primeira = true;
  for (const chave of Object.keys(obj)) {
    const valor = obj[chave];
    // Mesmas regras do JSON.stringify: chave com valor undefined ou função some do objeto.
    if (valor === undefined || typeof valor === 'function') continue;
    await escreve((primeira ? '' : ',') + JSON.stringify(chave) + ':');
    primeira = false;
    if (grandes.includes(chave) && valor && typeof valor === 'object' && !Array.isArray(valor)) {
      await escreve('{');
      let primeiroItem = true, n = 0;
      for (const id of Object.keys(valor)) {
        const item = valor[id];
        if (item === undefined || typeof item === 'function') continue;
        await escreve((primeiroItem ? '' : ',') + JSON.stringify(id) + ':' + JSON.stringify(item));
        primeiroItem = false;
        if (++n % LOTE === 0) await respira();
      }
      await escreve('}');
    } else {
      await escreve(JSON.stringify(valor));
    }
  }
  await escreve('}', true);
  gz.end();
  await fim;
  return Buffer.concat(saida);
}
