// Consenso de microtempo para os robôs do Atlas.
//
// O mesmo FIB automático (perna que alterna sozinha) roda em três tempos ao
// mesmo tempo: 30s, 1m e 15m. O consenso não é votação de opinião: cada tempo
// só conta se a perna está viva (não perdeu a origem do impulso) e se o
// gatilho de rompimento do extremo existe. O peso cresce com o tempo, porque
// o tempo maior manda na estrutura e o menor manda no instante.
//
// Leitura de saída: lado, força (soma dos pesos), estado do gatilho do tempo
// mais rápido que já rompeu, e o motivo em uma linha, para o robô registrar.

import { fiboAuto, gatilhoDaPerna, FIB_AUTO_VERSION } from './fibonacci.js';

export const CONSENSO_VERSION = '1.0.0';

export const PESOS = { '30s': 1, '1m': 1.5, '15m': 2.5 };

function arred(v, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

/**
 * Lê um tempo isolado e devolve o que ele pensa.
 * @param {Array} candles candles fechados e ascendentes
 * @param {string} tempo rótulo do tempo ('30s', '1m', '15m')
 * @param {object} params parâmetros do FIB
 */
export function lerTempo(candles, tempo, params = {}) {
  const plano = fiboAuto(candles, params);
  if (!plano) return { tempo, valido: false, motivo: 'sem velas suficientes' };
  const preco = candles[candles.length - 1].c;
  const g = plano.gatilho || gatilhoDaPerna(plano, preco);
  const distPct = g && g.entrada ? arred(Math.abs(g.entrada - preco) / preco * 100, 3) : null;
  // gatilho longe demais do preco e perna velha: nao vota no consenso, senao
  // um lado de 15m ancorado ha horas empata com um gatilho de 30s fresco
  const relevante = !!plano.viva && distPct != null && distPct <= 1.5;
  return {
    tempo,
    valido: !!plano.viva,
    relevante,
    lado: plano.lado === 'alta' ? 'compra' : 'venda',
    estado: g ? g.estado : 'sem gatilho',
    preco: arred(preco),
    ancoraEm: plano.ancoraEm,
    p0: plano.p0, p1: plano.p1, extremo: plano.extremo,
    entrada: g ? g.entrada : null,
    stop: g ? g.stop : null,
    alvo: g ? g.alvo : null,
    rr: g ? g.rr : null,
    distPct,
    alvoAtivo: plano.alvoAtivo,
    alternancias: plano.alternancias,
    motivo: plano.invalidada ? 'perna invalidada'
      : (!relevante && distPct != null ? 'gatilho a ' + distPct + '% do preco'
        : (g && g.estado === 'acionado' ? 'gatilho rompido' : 'aguardando rompimento'))
  };
}

/**
 * Consenso entre tempos.
 * @param {Object<string,Array>} series mapa tempo -> velas
 * @param {object} opcoes { params, minimoForca }
 */
export function consenso(series, opcoes = {}) {
  const minimoForca = opcoes.minimoForca != null ? opcoes.minimoForca : 2.5;
  const tempos = Object.keys(series || {});
  if (!tempos.length) return null;

  const leituras = tempos.map(t => lerTempo(series[t], t, opcoes.params || {}));
  const validas = leituras.filter(l => l.relevante && l.entrada != null);

  const placar = { compra: 0, venda: 0 };
  validas.forEach(l => {
    const peso = PESOS[l.tempo] != null ? PESOS[l.tempo] : 1;
    placar[l.lado] += peso;
  });

  const lado = placar.compra === placar.venda ? null : (placar.compra > placar.venda ? 'compra' : 'venda');
  const forca = lado ? arred(placar[lado], 2) : 0;
  const contra = lado ? arred(placar[lado === 'compra' ? 'venda' : 'compra'], 2) : 0;

  // o gatilho que vale é o do tempo mais rápido que já rompeu; se nenhum
  // rompeu, vale o mais rápido que ainda está armado
  const doLado = validas.filter(l => l.lado === lado);
  const acionados = doLado.filter(l => l.estado === 'acionado');
  const armados = doLado.filter(l => l.estado === 'aguardando');
  const ordem = { '30s': 0, '1m': 1, '15m': 2 };
  const porVelocidade = (a, b) => (ordem[a.tempo] != null ? ordem[a.tempo] : 9) - (ordem[b.tempo] != null ? ordem[b.tempo] : 9);
  acionados.sort(porVelocidade); armados.sort(porVelocidade);
  const escolhido = acionados[0] || armados[0] || null;

  let estado = 'neutro';
  if (lado) {
    if (forca >= minimoForca) estado = acionados.length ? 'acionado' : 'armado';
    else estado = 'parcial';
  }

  return {
    versao: CONSENSO_VERSION, fib: FIB_AUTO_VERSION,
    lado: estado === 'neutro' ? null : lado,
    estado,
    forca, contra,
    minimoForca,
    acordo: validas.filter(l => l.lado === lado).length,
    temposLidos: leituras.length,
    gatilho: escolhido ? {
      tempo: escolhido.tempo, lado: escolhido.lado, entrada: escolhido.entrada,
      stop: escolhido.stop, alvo: escolhido.alvo, rr: escolhido.rr, estado: escolhido.estado
    } : null,
    leituras,
    motivo: !lado ? 'tempos divididos'
      : (estado === 'parcial' ? 'força abaixo do mínimo' : (acionados.length ? 'rompimento confirmado' : 'armado, esperando rompimento'))
  };
}

/**
 * Últimos eventos de alternância dos três tempos, do mais recente ao mais
 * antigo, para a lista de sinais da tela e para o registro do robô.
 */
export function eventosRecentes(series, limite = 12, params = {}) {
  const ordem = ['30s', '1m', '15m'];
  const saida = [];
  ordem.forEach(tempo => {
    const velas = series[tempo];
    if (!Array.isArray(velas) || velas.length < 40) return;
    const plano = fiboAuto(velas, params);
    if (!plano) return;
    const lista = (plano.historico || []).slice(-4);
    lista.forEach(p => {
      saida.push({ tempo, tipo: 'virada', lado: p.lado === 'alta' ? 'compra' : 'venda', t: p.ancoraEm, bateu: p.bateram, invalidada: p.invalidada });
    });
    if (plano.ultimaVirada) {
      saida.push({ tempo, tipo: 'atual', lado: plano.lado === 'alta' ? 'compra' : 'venda', t: plano.ultimaVirada.t, entrada: plano.gatilho ? plano.gatilho.entrada : null, estado: plano.gatilho ? plano.gatilho.estado : null });
    }
  });
  return saida.sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, limite);
}
