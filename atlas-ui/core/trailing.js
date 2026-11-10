// Trailing stop do Atlas: Chandelier com catraca.
//
// Regra: o stop fica a k ATR do extremo das ultimas N barras e so anda a
// favor do preco, nunca contra. Quando o fechamento perde o stop, o lado
// vira e a catraca recomeca do outro extremo. Roda em candle fechado, sem
// tela e sem estado global, para poder ser assinado com hash e reaproveitado
// pelo robo.

export const TRAILING_VERSION = '1.0.0';

export const TRAILING_PARAMS = {
  atr: 14,      // periodo do ATR (Wilder)
  mult: 2.5,    // distancia em ATR
  janela: 22    // barras do extremo
};

function arred(v, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

function atrSerie(candles, periodo) {
  const n = candles.length;
  const tr = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (i === 0) { tr[i] = c.high - c.low; continue; }
    const pc = candles[i - 1].close;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  }
  const out = new Array(n).fill(null);
  if (n < periodo) return out;
  let soma = 0;
  for (let i = 0; i < periodo; i++) soma += tr[i];
  out[periodo - 1] = soma / periodo;
  for (let i = periodo; i < n; i++) out[i] = (out[i - 1] * (periodo - 1) + tr[i]) / periodo;
  return out;
}

/**
 * Serie do trailing stop e estado atual.
 * @param {Array<{time:number,open:number,high:number,low:number,close:number}>} candles fechados, ascendentes
 * @returns {object|null}
 */
export function trailingStop(candles, params = {}) {
  const p = { ...TRAILING_PARAMS, ...params };
  const n = Array.isArray(candles) ? candles.length : 0;
  if (n < p.janela + p.atr + 2) return null;

  const a = atrSerie(candles, p.atr);
  const serie = [];
  let lado = null;
  let stop = null;
  let desde = null;
  let viradas = 0;
  let ultimaVirada = null;

  for (let i = p.janela; i < n; i++) {
    if (a[i] == null || !isFinite(a[i])) continue;

    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - p.janela + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }

    const candAlta = hh - p.mult * a[i];
    const candBaixa = ll + p.mult * a[i];

    if (lado === null) {
      lado = candles[i].close >= (hh + ll) / 2 ? 'alta' : 'baixa';
      stop = lado === 'alta' ? candAlta : candBaixa;
      desde = candles[i].time;
    } else if (lado === 'alta') {
      if (candles[i].close < stop) {
        lado = 'baixa';
        stop = candBaixa;
        desde = candles[i].time;
        viradas++;
        ultimaVirada = candles[i].time;
      } else if (candAlta > stop) {
        stop = candAlta;          // catraca: so sobe
      }
    } else {
      if (candles[i].close > stop) {
        lado = 'alta';
        stop = candAlta;
        desde = candles[i].time;
        viradas++;
        ultimaVirada = candles[i].time;
      } else if (candBaixa < stop) {
        stop = candBaixa;         // catraca: so desce
      }
    }

    serie.push({ time: candles[i].time, value: arred(stop), lado });
  }

  if (!serie.length) return null;
  const ultima = serie[serie.length - 1];
  const preco = candles[n - 1].close;
  const dist = Math.abs(preco - ultima.value);

  return {
    serie,
    versao: TRAILING_VERSION,
    parametros: p,
    estado: {
      lado: ultima.lado,
      stop: ultima.value,
      preco,
      distancia: arred(dist),
      distanciaPercentual: arred(dist / preco * 100, 3),
      dentro: ultima.lado === 'alta' ? preco > ultima.value : preco < ultima.value,
      desde,
      viradas,
      ultimaVirada
    }
  };
}
