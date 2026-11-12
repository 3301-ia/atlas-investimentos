// Vigia de posicao: le uma posicao aberta e o preco, e diz onde ela esta.
//
// Nao conversa com a corretora. Recebe o que o dono digitou (lado, entrada,
// lote, stop, alvo) e o preco atual, e devolve lucro, distancia ate o stop e
// ate o alvo, quantos R ja andou, se o stop ja esta no lucro e um estado de
// aviso. Nucleo puro, sem tela, testavel e assinavel.

export const VIGIA_VERSION = '1.0.0';

export const VIGIA_LIMIARES = {
  aproximacao: 0.25   // avisa quando falta 25% ou menos da distancia
};

function n(v) {
  const x = Number(v);
  return isFinite(x) ? x : null;
}

/**
 * @param {{lado:'compra'|'venda', entrada:number, lote:number, stop?:number, alvo?:number}} posicao
 * @param {number} preco
 * @param {{aproximacao?:number, equity?:number}} opcoes
 */
export function avaliarPosicao(posicao, preco, opcoes = {}) {
  const p = preco;
  if (!posicao || !isFinite(p)) return null;

  const lado = posicao.lado === 'venda' ? -1 : 1;
  const entrada = n(posicao.entrada);
  const lote = n(posicao.lote);
  if (!entrada || entrada <= 0) return null;
  if (!lote || lote <= 0) return null;

  const stop = n(posicao.stop) && n(posicao.stop) > 0 ? n(posicao.stop) : null;
  const alvo = n(posicao.alvo) && n(posicao.alvo) > 0 ? n(posicao.alvo) : null;
  const aprox = isFinite(opcoes.aproximacao) ? opcoes.aproximacao : VIGIA_LIMIARES.aproximacao;

  const variacao = (p - entrada) * lado;
  const lucroUSD = variacao * lote;

  const riscoPreco = stop != null ? Math.abs(entrada - stop) : null;
  const retornoPreco = alvo != null ? Math.abs(alvo - entrada) : null;

  const distanciaStop = stop != null ? Math.abs(p - stop) : null;
  const distanciaAlvo = alvo != null ? Math.abs(alvo - p) : null;

  // R: quantas vezes o risco ja foi coberto
  const r = riscoPreco ? variacao / riscoPreco : null;

  // stop ja protege lucro?
  const stopNoLucro = stop != null && (lado === 1 ? stop > entrada : stop < entrada);
  const lucroTravadoUSD = stopNoLucro ? (stop - entrada) * lado * lote : 0;

  const perdaNoStopUSD = stop != null ? (stop - entrada) * lado * lote : null;

  let estado = 'normal';
  if (stop == null) estado = 'sem_stop';
  else if (lado === 1 && p <= stop) estado = 'stop_atingido';
  else if (lado === -1 && p >= stop) estado = 'stop_atingido';
  else if (alvo != null && ((lado === 1 && p >= alvo) || (lado === -1 && p <= alvo))) estado = 'alvo_atingido';
  else if (stopNoLucro && riscoPreco && distanciaStop <= riscoPreco * aprox) estado = 'stop_travado_perto';
  else if (riscoPreco && distanciaStop <= riscoPreco * aprox) estado = 'stop_proximo';
  else if (retornoPreco && distanciaAlvo != null && distanciaAlvo <= retornoPreco * aprox) estado = 'alvo_proximo';

  const riscoRetorno = riscoPreco && retornoPreco ? retornoPreco / riscoPreco : null;

  return {
    versao: VIGIA_VERSION,
    lado: posicao.lado === 'venda' ? 'venda' : 'compra',
    preco: p,
    entrada,
    lote,
    stop,
    alvo,
    lucroUSD: arred(lucroUSD),
    variacao: arred(variacao),
    variacaoPercentual: arred(variacao / entrada * 100, 3),
    riscoPreco: riscoPreco != null ? arred(riscoPreco) : null,
    retornoPreco: retornoPreco != null ? arred(retornoPreco) : null,
    distanciaStop: distanciaStop != null ? arred(distanciaStop) : null,
    distanciaAlvo: distanciaAlvo != null ? arred(distanciaAlvo) : null,
    distanciaStopPercentual: distanciaStop != null ? arred(distanciaStop / p * 100, 3) : null,
    r: r != null ? arred(r, 2) : null,
    riscoRetorno: riscoRetorno != null ? arred(riscoRetorno, 2) : null,
    perdaNoStopUSD: perdaNoStopUSD != null ? arred(perdaNoStopUSD) : null,
    stopNoLucro,
    lucroTravadoUSD: arred(lucroTravadoUSD),
    estado,
    alertar: estado === 'stop_atingido' || estado === 'alvo_atingido' ||
      estado === 'stop_proximo' || estado === 'alvo_proximo' ||
      estado === 'stop_travado_perto' || estado === 'sem_stop'
  };
}

function arred(v, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

/**
 * Texto curto do estado, para o aviso na tela.
 */
export function fraseEstado(avaliacao) {
  if (!avaliacao) return '';
  const l = avaliacao.lado === 'compra' ? 'compra' : 'venda';
  switch (avaliacao.estado) {
    case 'sem_stop':
      return 'Posicao de ' + l + ' sem stop definido';
    case 'stop_atingido':
      return 'Stop atingido na posicao de ' + l + ' a ' + avaliacao.preco.toFixed(2);
    case 'alvo_atingido':
      return 'Alvo atingido na posicao de ' + l + ' a ' + avaliacao.preco.toFixed(2);
    case 'stop_travado_perto':
      return 'Stop no lucro a ' + avaliacao.distanciaStop.toFixed(2) + ' do preco, ' +
        'travando ' + avaliacao.lucroTravadoUSD.toFixed(2) + ' USD';
    case 'stop_proximo':
      return 'Preco a ' + avaliacao.distanciaStop.toFixed(2) + ' do stop';
    case 'alvo_proximo':
      return 'Preco a ' + avaliacao.distanciaAlvo.toFixed(2) + ' do alvo';
    default:
      return '';
  }
}
