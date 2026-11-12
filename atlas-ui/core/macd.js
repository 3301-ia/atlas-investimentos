// MACD do Atlas, em nucleo puro.
//
// Mesma familia do indicador original: EMA rapida menos EMA lenta, linha de
// sinal como EMA do MACD, histograma como diferenca entre as duas. Roda em
// candle fechado e devolve as series alinhadas ao array de entrada, com null
// no periodo de aquecimento, mais o estado do ultimo candle: tendencia,
// histograma e o ultimo cruzamento.

import { ema } from './indicators.js';

export const MACD_VERSION = '1.0.0';

export const MACD_PARAMS = {
  rapida: 12,
  lenta: 26,
  sinal: 9
};

function serie(precos, periodo) {
  return ema(precos, periodo);
}

function arred(v, casas = 4) {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

/**
 * @param {Array<{c:number}|{close:number}>} candles ascendentes, fechados
 * @param {object} params
 * @returns {object|null} { linha, sinal, histograma, estado }
 */
export function macd(candles, params = {}) {
  const p = { ...MACD_PARAMS, ...params };
  const n = Array.isArray(candles) ? candles.length : 0;
  if (n < p.lenta + p.sinal + 2) return null;

  const fech = candles.map(c => (c && (c.c != null ? Number(c.c) : Number(c.close))));
  if (fech.some(v => !isFinite(v))) return null;

  const eR = serie(fech, p.rapida);
  const eL = serie(fech, p.lenta);

  const linha = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (eR[i] == null || eL[i] == null || i < p.lenta - 1) continue;
    linha[i] = eR[i] - eL[i];
  }

  // sinal: EMA apenas sobre os pontos validos do MACD
  const validos = linha.map((v, i) => (v == null ? null : i)).filter(v => v != null);
  const sinal = new Array(n).fill(null);
  if (validos.length) {
    const base = validos.map(i => linha[i]);
    const eS = ema(base, p.sinal);
    validos.forEach((idx, k) => {
      if (eS[k] != null && k >= p.sinal - 1) sinal[idx] = eS[k];
    });
  }

  const histograma = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (linha[i] != null && sinal[i] != null) histograma[i] = linha[i] - sinal[i];
  }

  const ultimo = n - 1;
  if (linha[ultimo] == null) return null;

  // ultimo cruzamento entre MACD e sinal
  let cruz = null;
  for (let i = n - 1; i > 0; i--) {
    const l0 = linha[i - 1], s0 = sinal[i - 1], l1 = linha[i], s1 = sinal[i];
    if (l0 == null || s0 == null || l1 == null || s1 == null) continue;
    if (l0 <= s0 && l1 > s1) { cruz = { tipo: 'alta', i, precoCandle: fech[i] }; break; }
    if (l0 >= s0 && l1 < s1) { cruz = { tipo: 'baixa', i, precoCandle: fech[i] }; break; }
  }

  return {
    versao: MACD_VERSION,
    parametros: p,
    linha,
    sinal,
    histograma,
    estado: {
      macd: arred(linha[ultimo]),
      sinal: sinal[ultimo] != null ? arred(sinal[ultimo]) : null,
      histograma: histograma[ultimo] != null ? arred(histograma[ultimo]) : null,
      tendencia: linha[ultimo] > 0 ? 'alta' : 'baixa',
      forca: Math.abs(linha[ultimo]) > Math.abs(linha[ultimo - 1] || 0) ? 'ganhando' : 'perdendo',
      ultimoCruzamento: cruz,
      velasDesdeCruzamento: cruz ? (ultimo - cruz.i) : null
    }
  };
}
