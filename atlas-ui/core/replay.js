// Replay do Atlas: roda o MESMO núcleo do robô sobre o histórico, barra a barra.
//
// Nada de olhar o futuro: a série do trailing é causal (cada barra só usa o
// passado), então a decisão na barra i é exatamente a decisão que o robô teria
// tomado ao vivo naquele fechamento. É o teste que separa tese de evidência.
//
// Regras (idênticas às do robô em papel):
//   - abre no fechamento da barra, no lado da estrutura, com stop no trailing;
//   - alvo em R fixo (2R por padrão);
//   - fecha no stop, no alvo ou na virada de lado (no fechamento);
//   - stop e alvo tocados na mesma barra: vale o stop, que é o pessimista;
//   - não reabre na mesma barra em que saiu.

import { trailingStop, TRAILING_PARAMS, TRAILING_VERSION } from './trailing.js';

export const REPLAY_VERSION = '1.0.0';

function arred(v, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

function anoDaBarra(seg) {
  return new Date(seg * 1000).getUTCFullYear();
}

/**
 * Simula a estratégia sobre velas fechadas e ascendentes.
 * @param {Array<{time:number,open:number,high:number,low:number,close:number}>} candles
 * @param {{alvoR?:number, custoPreco?:number}} opts
 */
export function simularReplay(candles, opts = {}) {
  const cs = Array.isArray(candles) ? candles.filter(c => c && isFinite(c.close)) : [];
  const alvoR = opts.alvoR == null ? 2 : opts.alvoR;
  const custoBps = opts.custoBps == null ? 0 : opts.custoBps;
  const custoPreco = opts.custoPreco == null ? 0 : opts.custoPreco;
  const distMinPct = opts.distMinPct == null ? 0 : opts.distMinPct;
  const soNaVirada = !!opts.soNaVirada;
  const plano = trailingStop(cs, opts);
  if (!plano || !plano.serie || !plano.serie.length) return null;

  const indice = new Map();
  cs.forEach((c, i) => indice.set(c.time, i));

  const trades = [];
  let pos = null;
  let ultimaSaida = -1;
  let ultimoLado = null;

  function fechar(precoSaida, motivo, tempo, i) {
    const sinal = pos.lado === 'compra' ? 1 : -1;
    const bruto = (precoSaida - pos.entrada) * sinal;
    const custo = custoPreco + (custoBps ? pos.entrada * custoBps / 10000 : 0);
    const liquido = bruto - custo;
    trades.push({
      lado: pos.lado,
      entrada: arred(pos.entrada),
      saida: arred(precoSaida),
      stop_inicial: arred(pos.stop),
      alvo: arred(pos.alvo),
      motivo,
      barras: i - pos.i,
      aberta_em: pos.tempo,
      fechada_em: tempo,
      r_bruto: arred(bruto / pos.dist, 3),
      r: arred(liquido / pos.dist, 3),
      resultado_usd: arred(liquido * pos.tamanho)
    });
    ultimoLado = pos.lado;
    pos = null;
    ultimaSaida = i;
  }

  for (let k = 0; k < plano.serie.length; k++) {
    const s = plano.serie[k];
    const i = indice.get(s.time);
    if (i == null) continue;
    const b = cs[i];

    if (pos && i > pos.i) {
      const stopTocado = pos.lado === 'compra' ? b.low <= pos.stop : b.high >= pos.stop;
      const alvoTocado = pos.lado === 'compra' ? b.high >= pos.alvo : b.low <= pos.alvo;
      const ladoAgora = s.lado === 'alta' ? 'compra' : 'venda';
      if (stopTocado) fechar(pos.stop, 'stop', b.time, i);
      else if (alvoTocado) fechar(pos.alvo, 'alvo', b.time, i);
      else if (ladoAgora !== pos.lado) fechar(b.close, 'virada', b.time, i);
    }

    if (!pos && i > ultimaSaida) {
      const lado = s.lado === 'alta' ? 'compra' : 'venda';
      const entrada = b.close;
      const stop = s.value;
      const dist = Math.abs(entrada - stop);
      if (!(dist > 0)) continue;
      if (distMinPct && dist / entrada * 100 < distMinPct) continue;
      if (soNaVirada && ultimoLado === lado) continue;
      pos = {
        lado, entrada, stop, i, tempo: b.time, dist,
        alvo: lado === 'compra' ? entrada + alvoR * dist : entrada - alvoR * dist,
        tamanho: 1
      };
    }
  }

  // posição que ficou aberta no fim: fecha no último preço, marcada como aberta
  let aberta = null;
  if (pos) {
    const b = cs[cs.length - 1];
    const sinal = pos.lado === 'compra' ? 1 : -1;
    aberta = {
      lado: pos.lado,
      entrada: arred(pos.entrada),
      preco: arred(b.close),
      stop: arred(pos.stop),
      alvo: arred(pos.alvo),
      r: arred(((b.close - pos.entrada) * sinal) / pos.dist, 3),
      aberta_em: pos.tempo
    };
  }

  const n = trades.length;
  if (!n) return { versao: REPLAY_VERSION, nucleo: `trailing ${TRAILING_VERSION}`, alvo_r: alvoR, operacoes: 0, trades: [], aberta };

  const rs = trades.map(t => t.r);
  const soma = rs.reduce((a, v) => a + v, 0);
  const acertos = rs.filter(v => v > 0);
  const perdas = rs.filter(v => v <= 0);
  const ganho = acertos.reduce((a, v) => a + v, 0);
  const perda = Math.abs(perdas.reduce((a, v) => a + v, 0));

  let acumulado = 0, pico = 0, dd = 0, seqPerdas = 0, seqAtual = 0;
  for (const r of rs) {
    acumulado += r;
    if (acumulado > pico) pico = acumulado;
    const queda = pico - acumulado;
    if (queda > dd) dd = queda;
    if (r <= 0) { seqAtual++; if (seqAtual > seqPerdas) seqPerdas = seqAtual; } else seqAtual = 0;
  }

  const porAno = {};
  for (const t of trades) {
    const a = anoDaBarra(t.fechada_em);
    const g = porAno[a] || (porAno[a] = { operacoes: 0, r: 0, acertos: 0 });
    g.operacoes++;
    g.r = arred(g.r + t.r);
    if (t.r > 0) g.acertos++;
  }

  const porMotivo = {};
  for (const t of trades) {
    const g = porMotivo[t.motivo] || (porMotivo[t.motivo] = { operacoes: 0, r: 0 });
    g.operacoes++;
    g.r = arred(g.r + t.r);
  }

  return {
    versao: REPLAY_VERSION,
    nucleo: `trailing ${TRAILING_VERSION} · atr ${plano.parametros.atr} · mult ${plano.parametros.mult} · janela ${plano.parametros.janela}`,
    alvo_r: alvoR,
    custo_preco: custoPreco,
    custo_bps: custoBps,
    parametros: plano.parametros,
    barras: cs.length,
    de: cs[0].time,
    ate: cs[cs.length - 1].time,
    operacoes: n,
    acerto_pct: arred(acertos.length / n * 100, 1),
    r_medio: arred(soma / n, 3),
    r_total: arred(soma, 2),
    r_melhor: arred(Math.max(...rs), 3),
    r_pior: arred(Math.min(...rs), 3),
    profit_factor: perda > 0 ? arred(ganho / perda, 2) : null,
    drawdown_r: arred(dd, 2),
    sequencia_perdas: seqPerdas,
    barras_media: arred(trades.reduce((a, t) => a + t.barras, 0) / n, 1),
    por_ano: porAno,
    por_motivo: porMotivo,
    trades: trades.slice(-40),
    aberta
  };
}
