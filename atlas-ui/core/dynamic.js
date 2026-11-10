// Vectra Dynamic no núcleo puro: plano de operação e rastreamento (trailing).
// Calculado só em candle fechado. Nada de tela aqui: entra série, sai plano.
// É o mesmo arquivo que a tela desenha e que o robô lê para decidir.

import { ema, zlema, atr } from "./indicators.js";

export const DYNAMIC_VERSION = "1.0.0";

export const PARAMETROS_PADRAO = {
  rapida: 9,
  lenta: 21,
  filtro: 10,
  atrLen: 14,
  barrasStop: 10,
  alvosR: [1, 2, 3],
  passoTrailing: 0.5,
  margemStop: 0.1,
};

function arred(v, passo) {
  if (!passo || passo <= 0) return v;
  return Math.round(v / passo) * passo;
}

// candles: [{t,o,h,l,c,v}] em ordem crescente, apenas candles fechados.
export function dynamicPlan(candles, params = {}) {
  const p = { ...PARAMETROS_PADRAO, ...params };
  const n = candles.length;
  if (n < Math.max(p.lenta + 2, p.barrasStop + 2, p.atrLen + 2)) {
    return { lado: null, motivo: "série curta para o plano", versao: DYNAMIC_VERSION, params: p };
  }

  const closes = candles.map((c) => c.c);
  const eR = ema(closes, p.rapida);
  const eL = ema(closes, p.lenta);
  const zl = zlema(closes, p.filtro);
  const at = atr(candles, p.atrLen);

  // último cruzamento entre as médias, com o ZLEMA confirmando a direção
  let idx = -1;
  let lado = null;
  for (let i = 1; i < n; i++) {
    if (eR[i] == null || eL[i] == null || zl[i] == null || zl[i - 1] == null) continue;
    const cruzAlta = eR[i - 1] <= eL[i - 1] && eR[i] > eL[i];
    const cruzBaixa = eR[i - 1] >= eL[i - 1] && eR[i] < eL[i];
    const zlSobe = zl[i] > zl[i - 1];
    const zlCai = zl[i] < zl[i - 1];
    if (cruzAlta && zlSobe) { idx = i; lado = "long"; }
    else if (cruzBaixa && zlCai) { idx = i; lado = "short"; }
  }

  if (idx < 0 || idx >= n - 1) {
    return {
      lado: null,
      motivo: idx < 0 ? "sem cruzamento confirmado" : "cruzamento no candle em aberto",
      versao: DYNAMIC_VERSION,
      params: p,
    };
  }

  const entrada = closes[idx];
  const iniStop = Math.max(0, idx - p.barrasStop + 1);
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = iniStop; i <= idx; i++) {
    hi = Math.max(hi, candles[i].h);
    lo = Math.min(lo, candles[i].l);
  }
  const folga = (at[idx] || 0) * p.margemStop;
  const stop0 = lado === "long" ? lo - folga : hi + folga;
  const risco = Math.abs(entrada - stop0);
  if (!(risco > 0)) {
    return { lado: null, motivo: "risco nulo no cruzamento", versao: DYNAMIC_VERSION, params: p };
  }

  const sinal = lado === "long" ? 1 : -1;
  const alvos = p.alvosR.map((k) => entrada + sinal * k * risco);

  // rastreamento: só anda a favor, e só em candle fechado
  const passo = risco * p.passoTrailing;
  let stopAtual = stop0;
  let melhor = entrada;
  const trailing = [{ i: idx, preco: stopAtual }];
  let fechada = false;
  let motivoFechamento = null;
  let resultadoR = null;

  for (let i = idx + 1; i < n; i++) {
    const c = candles[i];
    if (lado === "long") {
      if (c.l <= stopAtual) { fechada = true; motivoFechamento = "stop"; resultadoR = (stopAtual - entrada) / risco; break; }
      melhor = Math.max(melhor, c.h);
      const ganho = melhor - entrada;
      if (ganho >= risco) {
        const niveis = Math.floor((ganho - risco) / passo);
        const candidato = entrada + Math.max(0, niveis) * passo;
        if (candidato > stopAtual) { stopAtual = candidato; trailing.push({ i, preco: stopAtual }); }
      }
    } else {
      if (c.h >= stopAtual) { fechada = true; motivoFechamento = "stop"; resultadoR = (entrada - stopAtual) / risco; break; }
      melhor = Math.min(melhor, c.l);
      const ganho = entrada - melhor;
      if (ganho >= risco) {
        const niveis = Math.floor((ganho - risco) / passo);
        const candidato = entrada - Math.max(0, niveis) * passo;
        if (candidato < stopAtual) { stopAtual = candidato; trailing.push({ i, preco: stopAtual }); }
      }
    }
  }

  const ultimo = candles[n - 1].c;
  const abertoR = (sinal * (ultimo - entrada)) / risco;

  return {
    lado,
    i: idx,
    t: candles[idx].t,
    entrada,
    stop: stop0,
    risco,
    alvos,
    alvoAtivo: alvos.findIndex((a) => (lado === "long" ? ultimo < a : ultimo > a)),
    trailing,
    stopAtual,
    estado: fechada ? "fechada" : "aberta",
    motivoFechamento,
    resultadoR: fechada ? resultadoR : abertoR,
    breakEvenEm: entrada,
    versao: DYNAMIC_VERSION,
    params: p,
  };
}
