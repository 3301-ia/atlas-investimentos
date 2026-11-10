// Núcleo puro de figuras gráficas e ângulos do Atlas.
//
// Regra do arquivo: entra candle, sai mapa. Nada de tela, nada de estado.
// A leitura é geométrica e determinística: pivôs, retas de topo e de fundo,
// inclinação em graus num sistema de escala declarado, e classificação da
// figura por pontuação, com as alternativas registradas.
//
// Sobre ângulo, que é o ponto delicado: grau em gráfico só existe com escala
// declarada. Aqui a escala é quanto de preço vale uma barra (escalaPreco).
// Com isso, 45 graus significa subir uma escala por barra, como no 1x1 de
// Gann. Sem essa declaração, ângulo é ilusão de zoom.

export const PADROES_VERSION = '1.1.0';

const RAD = 180 / Math.PI;

export function atrSimples(candles, len = 14) {
  if (!candles || candles.length < 2) return 0;
  let soma = 0, n = 0;
  const ini = Math.max(1, candles.length - len);
  for (let i = ini; i < candles.length; i++) {
    const a = candles[i], b = candles[i - 1];
    const tr = Math.max(a.h - a.l, Math.abs(a.h - b.c), Math.abs(a.l - b.c));
    soma += tr; n++;
  }
  return n ? soma / n : 0;
}

export function pivos(candles, n = 3) {
  const out = [];
  for (let i = n; i < candles.length - n; i++) {
    let ehAlta = true, ehBaixa = true;
    for (let k = 1; k <= n; k++) {
      if (candles[i].h <= candles[i - k].h || candles[i].h <= candles[i + k].h) ehAlta = false;
      if (candles[i].l >= candles[i - k].l || candles[i].l >= candles[i + k].l) ehBaixa = false;
    }
    if (ehAlta) out.push({ i, tipo: 'alta', preco: candles[i].h });
    if (ehBaixa) out.push({ i, tipo: 'baixa', preco: candles[i].l });
  }
  return out;
}

export function reta(pontos) {
  const n = pontos.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pontos) { sx += p.i; sy += p.preco; sxx += p.i * p.i; sxy += p.i * p.preco; }
  const den = n * sxx - sx * sx;
  if (!den) return null;
  const inclinacao = (n * sxy - sx * sy) / den;
  const intercepto = (sy - inclinacao * sx) / n;
  const media = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const p of pontos) {
    const prev = inclinacao * p.i + intercepto;
    ssTot += (p.preco - media) ** 2;
    ssRes += (p.preco - prev) ** 2;
  }
  const r2 = ssTot ? 1 - ssRes / ssTot : 0;
  return { inclinacao, intercepto, r2, valorEm: i => inclinacao * i + intercepto };
}

export function anguloGraus(inclinacao, escalaPreco) {
  if (!escalaPreco) return 0;
  return Math.atan(inclinacao / escalaPreco) * RAD;
}

const arred = (v, c = 2) => Math.round(v * 10 ** c) / 10 ** c;

export function classificar(candles, opcoes = {}) {
  const o = { nPivo: 3, escalaPreco: null, janela: 160, tolerancia: 0.25, ...opcoes };
  const atr = atrSimples(candles, 14) || 1;
  const escala = o.escalaPreco || atr;
  const base = candles.slice(-o.janela);
  const desloc = candles.length - base.length;

  let lista = pivos(base, o.nPivo).map(p => ({ ...p, i: p.i + desloc }));
  for (const reduzido of [2, 1]) {
    const altas = lista.filter(p => p.tipo === 'alta').length;
    const baixas = lista.filter(p => p.tipo === 'baixa').length;
    if (altas >= 2 && baixas >= 2) break;
    lista = pivos(base, reduzido).map(p => ({ ...p, i: p.i + desloc }));
  }

  const altas = lista.filter(p => p.tipo === 'alta').slice(-3);
  const baixas = lista.filter(p => p.tipo === 'baixa').slice(-3);
  const ultimo = candles[candles.length - 1];
  const iUltimo = candles.length - 1;

  if (altas.length < 2 || baixas.length < 2) {
    return {
      versao: PADROES_VERSION, figura: 'indefinida', direcao: 'indefinida',
      motivo: 'pivôs insuficientes', confianca: 0, atr, escalaPreco: escala,
      graus: null, linhas: null, alternativas: [], rompimento: 'nenhum'
    };
  }

  const rAlta = reta(altas);
  const rBaixa = reta(baixas);
  const angAlta = anguloGraus(rAlta.inclinacao, escala);
  const angBaixa = anguloGraus(rBaixa.inclinacao, escala);
  const resist = rAlta.valorEm(iUltimo);
  const suporte = rBaixa.valorEm(iUltimo);
  const iIniJanela = base[0] ? base[0].i : candles[0].i;

  const tol = o.tolerancia * atr;

  // convergência: distância entre as retas no início contra o fim da janela
  const destIni = Math.abs(rAlta.valorEm(iIniJanela) - rBaixa.valorEm(iIniJanela));
  const destFim = Math.abs(resist - suporte);
  const convergencia = destIni > 0 ? Math.max(0, (destIni - destFim) / destIni) : 0;
  const abertura = destIni > 0 ? Math.max(0, (destFim - destIni) / destIni) : 0;
  const paralelismo = 1 - Math.min(1, Math.abs(rAlta.inclinacao - rBaixa.inclinacao) / (0.5 * escala));
  const ajuste = (rAlta.r2 + rBaixa.r2) / 2;

  const separadas = (a, b) => Math.abs(a.i - b.i) >= 6;
  const valeEntre = (a, b) => {
    const ini = Math.min(a.i, b.i), fim = Math.max(a.i, b.i);
    let menor = Infinity, maior = -Infinity;
    for (let i = ini; i <= fim && i < candles.length; i++) {
      menor = Math.min(menor, candles[i].l);
      maior = Math.max(maior, candles[i].h);
    }
    return { menor, maior };
  };
  const iguais = (a, b) => Math.abs(a.preco - b.preco) <= tol && separadas(a, b);

  const candidatos = [];

  if (rAlta.inclinacao < 0 && rBaixa.inclinacao > 0) {
    candidatos.push({ figura: 'triângulo simétrico', direcao: 'indefinida', pontos: 0.55 + 0.45 * convergencia });
  }
  if (Math.abs(rAlta.inclinacao) < 0.12 * escala && rBaixa.inclinacao > 0) {
    candidatos.push({ figura: 'triângulo ascendente', direcao: 'alta', pontos: 0.6 + 0.4 * ajuste });
  }
  if (rAlta.inclinacao < 0 && Math.abs(rBaixa.inclinacao) < 0.12 * escala) {
    candidatos.push({ figura: 'triângulo descendente', direcao: 'baixa', pontos: 0.6 + 0.4 * ajuste });
  }
  if (rAlta.inclinacao > 0 && rBaixa.inclinacao > 0 && paralelismo > 0.6) {
    candidatos.push({ figura: 'canal de alta', direcao: 'alta', pontos: 0.5 + 0.5 * paralelismo * ajuste });
  }
  if (rAlta.inclinacao < 0 && rBaixa.inclinacao < 0 && paralelismo > 0.6) {
    candidatos.push({ figura: 'canal de baixa', direcao: 'baixa', pontos: 0.5 + 0.5 * paralelismo * ajuste });
  }
  if (rAlta.inclinacao > 0 && rBaixa.inclinacao > 0 && paralelismo <= 0.6 && abertura > 0.05) {
    candidatos.push({ figura: 'cunha de alta', direcao: 'baixa', pontos: 0.45 + 0.4 * ajuste });
  }
  if (rAlta.inclinacao < 0 && rBaixa.inclinacao < 0 && paralelismo <= 0.6 && abertura > 0.05) {
    candidatos.push({ figura: 'cunha de baixa', direcao: 'alta', pontos: 0.45 + 0.4 * ajuste });
  }

  let topoForca = 0, fundoForca = 0;
  const ultimasAltas = altas.slice(-2), ultimasBaixas = baixas.slice(-2);
  if (ultimasAltas.length === 2 && iguais(ultimasAltas[0], ultimasAltas[1])) {
    const v = valeEntre(ultimasAltas[0], ultimasAltas[1]);
    const piso = Math.min(ultimasAltas[0].preco, ultimasAltas[1].preco);
    const prof = (piso - v.menor) / atr;
    if (prof >= 1) {
      const nivel = 1 - Math.abs(ultimasAltas[0].preco - ultimasAltas[1].preco) / tol;
      topoForca = 0.55 + 0.25 * nivel + 0.2 * Math.min(1, prof / 3);
      const rompeu = ultimo.c < piso;
      candidatos.push({ figura: rompeu ? 'duplo topo' : 'duplo topo em formação',
                        direcao: rompeu ? 'baixa' : 'indefinida', pontos: topoForca + (rompeu ? 0.1 : 0) });
    }
  }
  if (ultimasBaixas.length === 2 && iguais(ultimasBaixas[0], ultimasBaixas[1])) {
    const v = valeEntre(ultimasBaixas[0], ultimasBaixas[1]);
    const teto = Math.max(ultimasBaixas[0].preco, ultimasBaixas[1].preco);
    const prof = (v.maior - teto) / atr;
    if (prof >= 1) {
      const nivel = 1 - Math.abs(ultimasBaixas[0].preco - ultimasBaixas[1].preco) / tol;
      fundoForca = 0.55 + 0.25 * nivel + 0.2 * Math.min(1, prof / 3);
      const rompeu = ultimo.c > teto;
      candidatos.push({ figura: rompeu ? 'duplo fundo' : 'duplo fundo em formação',
                        direcao: rompeu ? 'alta' : 'indefinida', pontos: fundoForca + (rompeu ? 0.1 : 0) });
    }
  }

  candidatos.sort((a, b) => b.pontos - a.pontos);
  const principal = candidatos[0] || { figura: 'sem figura definida', direcao: 'neutra', pontos: 0 };
  const alternativas = candidatos.slice(1, 3).map(c => ({ figura: c.figura, pontos: arred(c.pontos) }));

  const rompeuAlta = ultimo.c > resist + 0.1 * escala;
  const rompeuBaixa = ultimo.c < suporte - 0.1 * escala;

  return {
    versao: PADROES_VERSION,
    figura: principal.figura,
    direcao: principal.direcao,
    confianca: arred(Math.min(1, principal.pontos)),
    atr: arred(atr),
    escalaPreco: arred(escala),
    graus: { topo: arred(angAlta, 1), fundo: arred(angBaixa, 1) },
    linhas: { resistencia: arred(resist), suporte: arred(suporte) },
    geometria: { convergencia: arred(convergencia), paralelismo: arred(paralelismo), ajuste: arred(ajuste) },
    pivos: { altas, baixas },
    alternativas,
    rompimento: rompeuAlta ? 'alta' : rompeuBaixa ? 'baixa' : 'nenhum',
    posicaoNoCanal: resist > suporte ? arred((ultimo.c - suporte) / (resist - suporte)) : null,
    fechamento: arred(ultimo.c)
  };
}
