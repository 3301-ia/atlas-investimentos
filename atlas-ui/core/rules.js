// Núcleo puro de decisão. Recebe candles fechados e devolve sinais com
// entrada, stop e alvo já calculados. Nada de tela, nada de estado global.
// Um sinal só nasce em candle fechado, para nunca depender do que ainda
// está se formando.
import { ema, zlema, atr, ribbonAlinhamento, ribbon, closes, CORE_VERSION } from './indicators.js';

export const RULES_VERSION = '1.0.0';

export const PARAMS_PADRAO = Object.freeze({
  rapida: 9, lenta: 21, filtro: 10, atrLen: 14, barrasStop: 10, rr: 2,
});

function cruzou(a, b, i) {
  const [a0, a1] = [a[i - 1], a[i]];
  const [b0, b1] = [b[i - 1], b[i]];
  if ([a0, a1, b0, b1].some(v => typeof v !== 'number')) return 0;
  if (a0 <= b0 && a1 > b1) return 1;
  if (a0 >= b0 && a1 < b1) return -1;
  return 0;
}

export function gerarSinais(candles, params = {}) {
  const p = { ...PARAMS_PADRAO, ...params };
  const cs = closes(candles);
  const f = ema(cs, p.rapida), s = ema(cs, p.lenta), z = zlema(cs, p.filtro);
  const a = atr(candles, p.atrLen);
  const rib = ribbon(cs);
  const out = [];
  for (let i = Math.max(p.barrasStop, p.lenta, p.filtro) + 1; i < candles.length; i++) {
    const c = candles[i];
    if (c.fechado === false) continue;
    const dir = cruzou(f, s, i);
    if (!dir) continue;
    const zAnt = z[i - 1], zAt = z[i];
    if (typeof zAnt !== 'number' || typeof zAt !== 'number') continue;
    // o filtro só deixa passar se o ZLEMA confirma a direção do cruzamento
    if (dir === 1 && !(zAt > zAnt)) continue;
    if (dir === -1 && !(zAt < zAnt)) continue;
    const at = a[i];
    if (typeof at !== 'number') continue;
    let extremo = dir === 1 ? Infinity : -Infinity;
    for (let j = i - p.barrasStop + 1; j <= i; j++) {
      extremo = dir === 1 ? Math.min(extremo, candles[j].low) : Math.max(extremo, candles[j].high);
    }
    const entrada = c.close;
    const stop = dir === 1 ? extremo - 0.1 * at : extremo + 0.1 * at;
    const risco = Math.abs(entrada - stop);
    if (!(risco > 0)) continue;
    const alvo = dir === 1 ? entrada + p.rr * risco : entrada - p.rr * risco;
    out.push({
      i, t: c.t, lado: dir === 1 ? 'compra' : 'venda',
      entrada: round(entrada), stop: round(stop), alvo: round(alvo),
      risco: round(risco), rr: p.rr,
      motivo: dir === 1 ? 'cruzamento de alta com ZLEMA subindo' : 'cruzamento de baixa com ZLEMA caindo',
      ribbon: ribbonAlinhamento(rib, i),
      params: p, core: CORE_VERSION, rules: RULES_VERSION,
    });
  }
  return out;
}
function round(v) { return Math.round(v * 100) / 100; }
