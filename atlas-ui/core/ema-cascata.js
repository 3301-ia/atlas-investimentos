// Cascata de EMAs 8/16 — lê a virada em camadas de tempo.
//
// A ideia do painel: a EMA 8 e a EMA 16 cruzam primeiro no 1 minuto, depois no
// 5, no 15 e no 1 hora. O cruzamento que sobe em camada é o trade; o que nasce
// isolado no micro é ruído. Este núcleo é puro: recebe séries fechadas e
// devolve leitura, alinhamento e gatilhos, sem tela e sem estado global.

export const CASCATA_VERSION = '1.0.0';

export const CASCATA_PARAMS = {
  rapida: 8,
  lenta: 16,
  minimoAlinhado: 3   // quantas camadas precisam concordar
};

export const CAMADAS = ['1m', '5m', '15m', '1H'];

function emaSerie(valores, len) {
  const k = 2 / (len + 1);
  const out = new Array(valores.length).fill(null);
  if (!valores.length) return out;
  let e = valores[0];
  out[0] = e;
  for (let i = 1; i < valores.length; i++) {
    e = valores[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/** Lado de uma série: 'alta' quando a EMA rápida está acima da lenta. */
export function ladoSerie(candles, params = {}) {
  const p = { ...CASCATA_PARAMS, ...params };
  if (!Array.isArray(candles) || candles.length < p.lenta + 2) return null;
  const cs = candles.map(c => c.close);
  const r = emaSerie(cs, p.rapida);
  const l = emaSerie(cs, p.lenta);
  const i = cs.length - 1;
  const lado = r[i] > l[i] ? 'alta' : 'baixa';
  const anterior = r[i - 1] > l[i - 1] ? 'alta' : 'baixa';
  const distanciaPct = l[i] ? Math.abs(r[i] - l[i]) / l[i] * 100 : 0;
  return {
    lado,
    cruzou: lado !== anterior,
    emaRapida: Math.round(r[i] * 100) / 100,
    emaLenta: Math.round(l[i] * 100) / 100,
    distanciaPct: Math.round(distanciaPct * 1000) / 1000,
    preco: cs[i]
  };
}

/** Estado das quatro camadas e o alinhamento entre elas. */
export function cascata(series = {}, params = {}) {
  const p = { ...CASCATA_PARAMS, ...params };
  const camadas = {};
  CAMADAS.forEach(k => {
    if (Array.isArray(series[k]) && series[k].length) camadas[k] = ladoSerie(series[k], p);
  });
  const lidos = Object.keys(camadas);
  if (!lidos.length) return null;

  const doMicro = camadas['1m'] ? camadas['1m'].lado : camadas[lidos[0]].lado;
  const alinhadas = lidos.filter(k => camadas[k].lado === doMicro);
  const contra = lidos.filter(k => camadas[k].lado !== doMicro);

  return {
    ladoMicro: doMicro,
    alinhamento: alinhadas.length,
    total: lidos.length,
    concorda: alinhadas,
    contra,
    camadas,
    // gatilho: micro cruzou E as camadas de cima já concordam
    gatilho: !!(camadas['1m'] && camadas['1m'].cruzou && alinhadas.length >= p.minimoAlinhado),
    forca: Math.round((alinhadas.length / lidos.length) * 100)
  };
}

/**
 * Série histórica de gatilhos em uma camada, com o alinhamento das camadas
 * superiores no mesmo instante. Serve para imprimir todos os sinais do dia.
 */
export function gatilhosDaSerie(candles, seriesSuperiores = {}, params = {}) {
  const p = { ...CASCATA_PARAMS, ...params };
  if (!Array.isArray(candles) || candles.length < p.lenta + 3) return [];
  const cs = candles.map(c => c.close);
  const r = emaSerie(cs, p.rapida);
  const l = emaSerie(cs, p.lenta);
  const estado = {};
  Object.keys(seriesSuperiores).forEach(k => {
    const sc = seriesSuperiores[k];
    if (!sc || !sc.length) return;
    const civ = sc.map(c => c.close);
    estado[k] = { ema8: emaSerie(civ, p.rapida), ema16: emaSerie(civ, p.lenta), times: sc.map(c => c.time) };
  });

  const saida = [];
  for (let i = p.lenta + 1; i < cs.length; i++) {
    const lado = r[i] > l[i] ? 'alta' : 'baixa';
    const antes = r[i - 1] > l[i - 1] ? 'alta' : 'baixa';
    if (lado === antes) continue;

    // alinhamento das camadas de cima no instante do cruzamento
    const t = candles[i].time;
    const concordam = [];
    Object.keys(estado).forEach(k => {
      const e = estado[k];
      let j = e.times.length - 1;
      while (j >= 0 && e.times[j] > t) j--;
      if (j < 0 || e.ema8[j] == null || e.ema16[j] == null) return;
      const ladoSup = e.ema8[j] > e.ema16[j] ? 'alta' : 'baixa';
      if (ladoSup === lado) concordam.push(k);
    });

    saida.push({
      time: t,
      tempo: candles[i].time,
      lado,
      preco: cs[i],
      concordam,
      forca: Math.round((concordam.length / Math.max(Object.keys(estado).length, 1)) * 100)
    });
  }
  return saida;
}
