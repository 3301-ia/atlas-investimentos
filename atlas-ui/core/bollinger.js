// Bandas de Bollinger do Atlas, em nucleo puro.
//
// Media simples de N periodos e dois desvios-padrao em volta, calculados na
// mesma janela. Devolve as tres series alinhadas ao array de entrada e o
// estado do ultimo candle: onde o preco esta dentro da banda, a largura em
// porcentagem da media e a leitura de compressao, que e o que o painel usa
// para achar squeeze.

export const BOLLINGER_VERSION = '1.0.0';

export const BOLLINGER_PARAMS = {
  periodo: 20,
  desvios: 2,
  squeezeAbaixo: 40   // largura em % da media, em relacao a media das larguras
};

function arred(v, casas = 4) {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

/**
 * @param {Array<{c:number}>} candles ascendentes
 * @returns {object|null} { media, superior, inferior, largura, estado }
 */
export function bandas(candles, params = {}) {
  const p = { ...BOLLINGER_PARAMS, ...params };
  const n = Array.isArray(candles) ? candles.length : 0;
  if (n < p.periodo + 1) return null;

  const fech = candles.map(c => Number(c.c != null ? c.c : c.close));
  if (fech.some(v => !isFinite(v))) return null;

  const media = new Array(n).fill(null);
  const superior = new Array(n).fill(null);
  const inferior = new Array(n).fill(null);
  const largura = new Array(n).fill(null);

  for (let i = p.periodo - 1; i < n; i++) {
    let soma = 0;
    for (let j = i - p.periodo + 1; j <= i; j++) soma += fech[j];
    const m = soma / p.periodo;
    let varSum = 0;
    for (let j = i - p.periodo + 1; j <= i; j++) {
      const d = fech[j] - m;
      varSum += d * d;
    }
    const dp = Math.sqrt(varSum / p.periodo);
    media[i] = m;
    superior[i] = m + p.desvios * dp;
    inferior[i] = m - p.desvios * dp;
    largura[i] = m > 0 ? ((superior[i] - inferior[i]) / m) * 100 : null;
  }

  const ultimo = n - 1;
  if (media[ultimo] == null) return null;

  const validas = largura.filter(v => v != null);
  const larguraMedia = validas.reduce((a, b) => a + b, 0) / validas.length;
  const larguraAtual = largura[ultimo];
  const compressao = larguraMedia > 0 ? (larguraAtual / larguraMedia) * 100 : null;

  const preco = fech[ultimo];
  const posicao = preco > superior[ultimo] ? 'acima'
    : preco < inferior[ultimo] ? 'abaixo' : 'dentro';

  // posicao relativa dentro da banda, 0 no fundo e 1 no topo
  const faixa = superior[ultimo] - inferior[ultimo];
  const posicaoRelativa = faixa > 0 ? (preco - inferior[ultimo]) / faixa : null;

  return {
    versao: BOLLINGER_VERSION,
    parametros: p,
    media,
    superior,
    inferior,
    largura,
    estado: {
      preco,
      media: arred(media[ultimo]),
      superior: arred(superior[ultimo]),
      inferior: arred(inferior[ultimo]),
      posicao,
      posicaoRelativa: posicaoRelativa != null ? arred(posicaoRelativa, 3) : null,
      larguraPercentual: arred(larguraAtual, 3),
      compressaoPercentual: compressao != null ? arred(compressao, 1) : null,
      squeeze: compressao != null && compressao <= p.squeezeAbaixo
    }
  };
}
