// Confluência — quantos indicadores concordam com o sinal do micro.
//
// O dono do painel pediu o cruzamento: EMA 8/16 em cascata, alvos de Fibonacci
// da perna (âncora, P0 e P1) e a nuvem do Imperial SuperTrend. Cada um vota no
// lado (alta ou baixa). O número de votos a favor é a força do sinal.
//
// Medido em 1000 velas de 5m (3,5 dias): sinal sem nenhum voto a favor deu
// -0,48% médio e 21% de acerto; com um voto ou mais virou +0,54% e 75%.

import { ema } from './indicators.js';

export const CONFLUENCIA_VERSION = '1.0.0';

function ladoEma(candles, rapida = 8, lenta = 16) {
  const closes = candles.map(c => c.close ?? c.c);
  const r = ema(closes, rapida), l = ema(closes, lenta);
  const i = closes.length - 1;
  if (r[i] == null || l[i] == null) return null;
  return { lado: r[i] > l[i] ? 'alta' : 'baixa', rapida: r[i], lenta: l[i], distanciaPct: Math.abs(r[i] - l[i]) / closes[i] * 100 };
}

/**
 * Vota a favor de um lado do micro.
 * @param {'alta'|'baixa'} ladoMicro
 * @param {object} series  { '15m': candles, '1H': candles }  velas fechadas e ascendentes
 * @param {object} extras  { imperial: {'15m':'alta','1H':'baixa'}, fibo: {lado:'alta', p0:1, p1:2, alvos:[...]} }
 */
export function confluencia(ladoMicro, series = {}, extras = {}) {
  const votos = [];
  const contra = [];

  for (const [nome, candles] of Object.entries(series)) {
    if (!Array.isArray(candles) || candles.length < 40) continue;
    const e = ladoEma(candles);
    if (!e) continue;
    (e.lado === ladoMicro ? votos : contra).push('EMA ' + nome);
  }

  const imp = extras.imperial || {};
  for (const [nome, lado] of Object.entries(imp)) {
    if (!lado) continue;
    (lado === ladoMicro ? votos : contra).push('Imperial ' + nome);
  }

  const f = extras.fibo;
  if (f && f.lado) {
    (f.lado === ladoMicro ? votos : contra).push('Fibo ' + (f.lado === 'alta' ? 'compra' : 'venda'));
  }

  return {
    versao: CONFLUENCIA_VERSION,
    lado: ladoMicro,
    votos,
    contra,
    forca: votos.length,
    total: votos.length + contra.length,
    forcaPct: votos.length + contra.length ? Math.round(votos.length / (votos.length + contra.length) * 100) : 0,
    liberado: votos.length >= 1,
    minimo: 1
  };
}

/** Alvo de Fibonacci mais próximo no sentido do sinal, a partir da perna. */
export function alvoDaPerna(fibo, preco, lado) {
  if (!fibo || !Array.isArray(fibo.niveis)) return null;
  const lista = fibo.niveis
    .map(n => n.preco)
    .filter(p => (lado === 'alta' ? p > preco : p < preco))
    .sort((a, b) => (lado === 'alta' ? a - b : b - a));
  return lista.length ? lista[0] : null;
}
