// Vectra Imperial SuperTrend (ZEMA-KAMA + RevRSI) em nucleo puro.
//
// Traducao do Pine v6 "Vectra Imperial SuperTrend [ZEMA-KAMA + RevRSI v6]".
// Regra da casa: este arquivo nao conhece tela, canvas, DOM nem biblioteca
// externa. Entra candle, sai serie. Assim o mesmo calculo roda no navegador,
// no Node e no robo, e pode ser conferido por hash.
//
// O que o indicador faz, em uma frase: junta uma media rapida (ZEMA) com uma
// media que freia sozinha em mercado lateral (KAMA), monta um SuperTrend com
// banda ATR que so aperta, e usa dois satelites para julgar o sinal: o angulo
// da media (velocidade real, normalizada pelo ATR) e o preco onde o RSI
// bateria 70 / 30 / 50 (alvo projetado, nao retracao).

import { ema, zlema } from './indicators.js';

export const IMPERIAL_VERSION = '1.0.0';

export const IMPERIAL_PARAMS = {
  lenZema: 14,      // ZEMA (Zero-Lag)
  lenKama: 21,      // KAMA (freio adaptativo)
  atrMult: 2.2,     // multiplicador da banda
  atrLen: 14,
  lenRsi: 14,       // RSI base do alvo projetado
  ob: 70,           // alvo de sobrecompra
  os: 30,           // alvo de sobrevenda
  anguloMin: 35,    // graus para considerar ignicao
  cvdMult: 1.5,     // sensibilidade da absorcao
  cvdJanela: 20,
  pesoZema: 0.6,    // nucleo hibrido: 60% ZEMA + 40% KAMA
  pesoKama: 0.4
};

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = (v, d = 0) => (isNum(v) ? v : d);

// RMA de Wilder, igual ao ta.rma do Pine (usada no ATR e no alvo RevRSI).
export function rma(values, len) {
  const out = new Array(values.length).fill(null);
  if (!(len > 0)) return out;
  let prev = null, soma = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) continue;
    if (prev === null) {
      soma += v; n++;
      if (n === len) { prev = soma / len; out[i] = prev; }
    } else {
      prev = (prev * (len - 1) + v) / len;
      out[i] = prev;
    }
  }
  return out;
}

function somaMovel(values, len) {
  const out = new Array(values.length).fill(null);
  let soma = 0, q = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNum(v)) { soma += v; q++; }
    if (q > len) { const velho = values[i - len]; if (isNum(velho)) { soma -= velho; q--; } }
    if (q >= len) out[i] = soma / len;
  }
  return out;
}

// Ta.stdev do Pine e desvio populacional (divide por N).
function desvioPop(values, len) {
  const media = somaMovel(values, len);
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (media[i] == null) continue;
    let acc = 0, ok = true;
    for (let j = i - len + 1; j <= i; j++) {
      if (!isNum(values[j])) { ok = false; break; }
      acc += Math.pow(values[j] - media[i], 2);
    }
    if (ok) out[i] = Math.sqrt(acc / len);
  }
  return out;
}

// ta.atr = ta.rma(ta.tr, len)
export function atrWilder(candles, len = 14) {
  const tr = candles.map((c, i) => {
    const alto = Number(c.h), baixo = Number(c.l);
    if (i === 0) return alto - baixo;
    const ant = Number(candles[i - 1].c);
    return Math.max(alto - baixo, Math.abs(alto - ant), Math.abs(baixo - ant));
  });
  return rma(tr, len);
}

export function kamaSerie(values, len = 21, rapido = 2, lento = 30) {
  const out = new Array(values.length).fill(null);
  const fsc = 2 / (rapido + 1), ssc = 2 / (lento + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < len) continue;
    const atual = values[i], antes = values[i - len];
    if (!isNum(atual) || !isNum(antes)) continue;
    let ruido = 0, ok = true;
    for (let j = i - len + 1; j <= i; j++) {
      const a = values[j], b = values[j - 1];
      if (!isNum(a) || !isNum(b)) { ok = false; break; }
      ruido += Math.abs(a - b);
    }
    if (!ok) continue;
    const er = ruido === 0 ? 0 : Math.abs(atual - antes) / ruido;
    const sc = Math.pow(er * (fsc - ssc) + ssc, 2);
    prev = prev === null ? atual : prev + sc * (atual - prev);
    out[i] = prev;
  }
  return out;
}

// Preco onde o RSI bate o alvo. Resolve a equacao do RSI para o preco, do
// mesmo jeito que o Pine: sem buscar raiz, direto na algebra da media.
export function precoDoRsi(close, avgUp, avgDn, alvo, len) {
  if (!isNum(close) || !isNum(avgUp) || !isNum(avgDn)) return null;
  const r = alvo / (100 - alvo);
  const x = (len - 1) * (avgDn * r - avgUp);
  return x >= 0 ? close + x : close + x * ((100 - alvo) / alvo);
}

// Agrupa velas em blocos de tempo (ms) e devolve OHLC. Usado para montar a
// visao de 1H e de 1D a partir dos candles que o painel ja tem na tela.
export function reagrupar(candles, ms) {
  if (!ms || ms <= 0) return [];
  const out = [];
  for (const c of candles) {
    const t = Number(c.time);
    if (!Number.isFinite(t)) continue;
    const ms0 = t > 1e12 ? t : t * 1000;         // aceita segundos ou ms
    const bucket = Math.floor(ms0 / ms) * ms;
    const alto = Number(c.h != null ? c.h : c.high);
    const baixo = Number(c.l != null ? c.l : c.low);
    const fech = Number(c.c != null ? c.c : c.close);
    const ult = out[out.length - 1];
    if (!ult || ult.time !== bucket) {
      out.push({ time: bucket, h: alto, l: baixo, c: fech });
    } else {
      ult.h = Math.max(ult.h, alto);
      ult.l = Math.min(ult.l, baixo);
      ult.c = fech;
    }
  }
  return out;
}

// Leitura macro: EMA8 x EMA21 em 1H e 1D. Devolve +1 alta, -1 baixa, 0 sem dado.
export function fluxoMacro(candles) {
  const fech = arr => arr.map(c => Number(c.c));
  const umaHora = reagrupar(candles, 3600 * 1000);
  const umDia = reagrupar(candles, 86400 * 1000);
  const lado = arr => {
    if (arr.length < 25) return 0;
    const v = fech(arr);
    const e8 = ema(v, 8), e21 = ema(v, 21);
    const i = v.length - 1;
    if (e8[i] == null || e21[i] == null) return 0;
    return e8[i] > e21[i] ? 1 : -1;
  };
  return { h1: lado(umaHora), d1: lado(umDia) };
}

/**
 * Calcula o indicador inteiro sobre velas fechadas e ascendentes.
 * @param {Array<{time:number,h:number,l:number,c:number,v?:number}>} candles
 * @param {object} params
 * @returns {object|null}
 */

/**
 * Limpa a serie antes de qualquer conta. Una vela com preco invalido, tempo
 * repetido ou fora de ordem derrubava o indicador inteiro (a tela mostrava
 * "sem velas suficientes" com o grafico cheio). Aqui a vela ruim e descartada,
 * o tempo repetido fica com a ultima versao e a serie sai ascendente.
 */
export function limparVelas(candles) {
  if (!Array.isArray(candles) || !candles.length) return [];
  const porTempo = new Map();
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c || typeof c !== 'object') continue;
    let t = c.time != null ? c.time : (c.t != null ? c.t : c.openTime);
    if (typeof t === 'string' && /^\d+$/.test(t)) t = Number(t);
    if (t instanceof Date) t = Math.floor(t.getTime() / 1000);
    const h = Number(c.h != null ? c.h : c.high);
    const l = Number(c.l != null ? c.l : c.low);
    const fe = Number(c.c != null ? c.c : c.close);
    const v = Number(c.v != null ? c.v : (c.volume != null ? c.volume : 0));
    if (!Number.isFinite(Number(t)) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(fe)) continue;
    if (h < l) continue;
    porTempo.set(t, { time: t, h, l, c: fe, v: Number.isFinite(v) ? v : 0 });
  }
  return Array.from(porTempo.values()).sort((a, b) => a.time - b.time);
}

export function minimoVelas(params = {}) {
  const p = { ...IMPERIAL_PARAMS, ...params };
  return Math.max(p.lenKama, p.lenZema, p.atrLen, p.lenRsi, p.cvdJanela) + 8;
}

export function imperial(entrada, params = {}) {
  const p = { ...IMPERIAL_PARAMS, ...params };
  const candles = limparVelas(entrada);
  const n = candles.length;
  const minimo = minimoVelas(p);
  if (n < minimo) return null;

  const fech = candles.map(c => c.c);
  const alto = candles.map(c => c.h);
  const baixo = candles.map(c => c.l);

  // 1) motor de media -------------------------------------------------------
  const zema = zlema(fech, p.lenZema);
  const kama = kamaSerie(fech, p.lenKama);
  const nucleo = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (zema[i] == null || kama[i] == null) continue;
    nucleo[i] = zema[i] * p.pesoZema + kama[i] * p.pesoKama;
  }

  // 2) supertrend com banda que so aperta -----------------------------------
  const atr = atrWilder(candles, p.atrLen);
  const brutaAlta = new Array(n).fill(null);
  const brutaBaixa = new Array(n).fill(null);
  const bandaAlta = new Array(n).fill(null);
  const bandaBaixa = new Array(n).fill(null);
  const linha = new Array(n).fill(null);
  const dir = new Array(n).fill(0);
  const viradaAlta = new Array(n).fill(false);
  const viradaBaixa = new Array(n).fill(false);

  for (let i = 0; i < n; i++) {
    if (nucleo[i] == null || atr[i] == null) continue;
    brutaAlta[i] = nucleo[i] + p.atrMult * atr[i];
    brutaBaixa[i] = nucleo[i] - p.atrMult * atr[i];
  }

  for (let i = 0; i < n; i++) {
    if (brutaAlta[i] == null) continue;
    const anteriorAlta = bandaAlta[i - 1] != null ? bandaAlta[i - 1] : brutaAlta[i];
    const anteriorBaixa = bandaBaixa[i - 1] != null ? bandaBaixa[i - 1] : brutaBaixa[i];
    const fechAnterior = i > 0 ? fech[i - 1] : fech[i];

    // a banda nao afrouxa no lado que protege a posicao
    bandaAlta[i] = (brutaAlta[i] < anteriorAlta || fechAnterior > anteriorAlta) ? brutaAlta[i] : anteriorAlta;
    bandaBaixa[i] = (brutaBaixa[i] > anteriorBaixa || fechAnterior < anteriorBaixa) ? brutaBaixa[i] : anteriorBaixa;

    const linhaAnt = i > 0 ? linha[i - 1] : null;
    let d;
    if (linhaAnt == null) {
      d = 1;
    } else if (Math.abs(linhaAnt - anteriorAlta) < 1e-9) {
      // estava na banda de cima: segue em baixa ate romper para cima
      d = fech[i] > bandaAlta[i] ? 1 : -1;
    } else {
      d = fech[i] < bandaBaixa[i] ? -1 : 1;
    }
    const dAnt = i > 0 ? dir[i - 1] : 0;
    dir[i] = d;
    linha[i] = d === 1 ? bandaBaixa[i] : bandaAlta[i];
    if (dAnt !== 0) {
      viradaAlta[i] = d === 1 && dAnt === -1;
      viradaBaixa[i] = d === -1 && dAnt === 1;
    }
  }

  // 3) angulo do vetor (velocidade normalizada pelo ATR) -------------------
  const angulo = new Array(n).fill(null);
  const forte = new Array(n).fill(false);
  for (let i = 3; i < n; i++) {
    if (zema[i] == null || zema[i - 3] == null || !atr[i]) continue;
    const inclinacao = (zema[i] - zema[i - 3]) / (3 * atr[i]);
    const graus = Math.atan(inclinacao) * (180 / Math.PI);
    angulo[i] = graus;
    forte[i] = Math.abs(graus) >= p.anguloMin;
  }

  // 4) alvo projetado do RSI -------------------------------------------------
  const up = fech.map((v, i) => (i === 0 ? null : Math.max(v - fech[i - 1], 0)));
  const dn = fech.map((v, i) => (i === 0 ? null : Math.max(fech[i - 1] - v, 0)));
  const avgUp = rma(up, p.lenRsi);
  const avgDn = rma(dn, p.lenRsi);
  const alvoTopo = new Array(n).fill(null);
  const alvoFundo = new Array(n).fill(null);
  const alvoMeio = new Array(n).fill(null);
  const rsiAgora = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (avgUp[i] == null || avgDn[i] == null) continue;
    alvoTopo[i] = precoDoRsi(fech[i], avgUp[i], avgDn[i], p.ob, p.lenRsi);
    alvoFundo[i] = precoDoRsi(fech[i], avgUp[i], avgDn[i], p.os, p.lenRsi);
    alvoMeio[i] = precoDoRsi(fech[i], avgUp[i], avgDn[i], 50, p.lenRsi);
    rsiAgora[i] = avgDn[i] === 0 ? 100 : 100 - 100 / (1 + avgUp[i] / avgDn[i]);
  }

  // 5) absorcao por delta de volume (com fallback de volatilidade) ----------
  const delta = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const range = alto[i] - baixo[i];
    const v = Number(candles[i].v != null ? candles[i].v : candles[i].volume);
    const tr = i === 0 ? range : Math.max(range, Math.abs(alto[i] - fech[i - 1]), Math.abs(baixo[i] - fech[i - 1]));
    const eff = Number.isFinite(v) && v > 0 ? v : tr;
    delta[i] = (((fech[i] - baixo[i]) - (alto[i] - fech[i])) / (range === 0 ? 1 : range)) * eff;
  }
  const dMedia = somaMovel(delta, p.cvdJanela);
  const dDesvio = desvioPop(delta, p.cvdJanela);
  const absorcaoTopo = new Array(n).fill(false);
  const absorcaoFundo = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (delta[i] == null || dMedia[i] == null || dDesvio[i] == null || rsiAgora[i] == null) continue;
    absorcaoTopo[i] = delta[i] < dMedia[i] - p.cvdMult * dDesvio[i] && rsiAgora[i] >= p.ob - 3;
    absorcaoFundo[i] = delta[i] > dMedia[i] + p.cvdMult * dDesvio[i] && rsiAgora[i] <= p.os + 3;
  }

  // 6) estado do ultimo candle ----------------------------------------------
  const i = n - 1;
  const macro = fluxoMacro(candles);
  const estado = {
    indice: i,
    dir: dir[i],
    lado: dir[i] === 1 ? 'alta' : 'baixa',
    linha: linha[i],
    bandaAlta: bandaAlta[i],
    bandaBaixa: bandaBaixa[i],
    nucleo: nucleo[i],
    zema: zema[i],
    kama: kama[i],
    atr: atr[i],
    angulo: angulo[i],
    anguloForte: forte[i],
    rsi: rsiAgora[i],
    alvoTopo: alvoTopo[i],
    alvoFundo: alvoFundo[i],
    alvoMeio: alvoMeio[i],
    absorcaoTopo: absorcaoTopo[i],
    absorcaoFundo: absorcaoFundo[i],
    viradaAlta: viradaAlta[i],
    viradaBaixa: viradaBaixa[i],
    macroH1: macro.h1,
    macroD1: macro.d1,
    macroAlinhado: macro.h1 !== 0 && macro.h1 === macro.d1 ? macro.h1 : 0
  };

  // distancia pratica: quanto falta para o alvo e quanto o stop protege
  const preco = fech[i];
  estado.distAlvoTopo = estado.alvoTopo != null ? estado.alvoTopo - preco : null;
  estado.distAlvoFundo = estado.alvoFundo != null ? preco - estado.alvoFundo : null;
  estado.distLinha = estado.linha != null ? preco - estado.linha : null;
  estado.distLinhaPct = estado.linha ? ((preco - estado.linha) / estado.linha) * 100 : null;

  return {
    versao: IMPERIAL_VERSION,
    params: p,
    series: {
      nucleo, zema, kama, linha, bandaAlta, bandaBaixa,
      dir, angulo, alvoTopo, alvoFundo, alvoMeio, rsi: rsiAgora,
      delta, absorcaoTopo, absorcaoFundo, viradaAlta, viradaBaixa
    },
    estado
  };
}

// Texto curto para o cartao da tela: uma linha que resolve o estado.
export function resumoImperial(estado) {
  if (!estado) return 'sem leitura';
  const lado = estado.dir === 1 ? 'ALTA' : 'BAIXA';
  const forca = estado.anguloForte ? 'forte' : 'fraca';
  const ang = estado.angulo != null ? estado.angulo.toFixed(1) + ' graus' : 'sem angulo';
  return `${lado} ${forca} (${ang})`;
}
