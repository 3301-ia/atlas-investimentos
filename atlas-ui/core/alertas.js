// Núcleo puro de alertas do Atlas Vectra.
//
// Mesma regra dos outros módulos do núcleo: nenhuma referência a tela, DOM,
// canvas, som ou relógio do navegador. Entra série e preço, sai decisão.
// Isso permite rodar o mesmo alerta no painel, no Node e no robô, e comparar
// por hash — o alerta que o robô dispara é o mesmo que o painel acende.
//
// Tipos:
//   'ma'    cruzamento de médias sobre velas fechadas do gráfico
//   'fib'   rompimento de nível de Fibonacci do swing corrente
//   'preco' preço fixo digitado
//
// Direção, do ponto de vista do preço:
//   'acima'  rompeu para cima (travessia de baixo para cima)
//   'abaixo' perdeu para baixo
//   'ambas'  qualquer lado

import { ema } from './indicators.js';
import { canon, sha256hex } from './signature.js';

export const ALERTAS_VERSION = '1.0.0';

export const ALERTA_PARAMS = {
  rapida: 9,
  lenta: 18,
  swing: 21,
  // depois de disparar, o preço precisa voltar 0,06% para o alerta rearmar
  histerese: 0.0006,
};

export const NIVEIS_FIB = [0.236, 0.382, 0.5, 0.618, 0.786];

const num = v => typeof v === 'number' && Number.isFinite(v);

function candleValido(c) {
  return c && num(c.c);
}

/**
 * Última travessia entre duas médias, lendo só velas fechadas.
 * @returns {{lado:'alta'|'baixa',t:number,indice:number,rapida:number,lenta:number}|null}
 */
export function cruzamentoMedia(candles, rapida = ALERTA_PARAMS.rapida, lenta = ALERTA_PARAMS.lenta) {
  const n = Array.isArray(candles) ? candles.length : 0;
  if (n < Math.max(rapida, lenta) + 2) return null;

  const closes = candles.map(c => (candleValido(c) ? c.c : null));
  const r = ema(closes, rapida);
  const l = ema(closes, lenta);

  for (let i = n - 1; i >= 1; i--) {
    const a0 = r[i - 1], b0 = l[i - 1], a1 = r[i], b1 = l[i];
    if (!num(a0) || !num(b0) || !num(a1) || !num(b1)) continue;
    if (a0 <= b0 && a1 > b1) {
      return { lado: 'alta', t: candles[i].t, indice: i, rapida: a1, lenta: b1 };
    }
    if (a0 >= b0 && a1 < b1) {
      return { lado: 'baixa', t: candles[i].t, indice: i, rapida: a1, lenta: b1 };
    }
  }
  return null;
}

/**
 * Swing das últimas N velas e os níveis de retração.
 * A perna é de alta quando o fundo veio antes do topo.
 */
export function swingFib(candles, swing = ALERTA_PARAMS.swing) {
  const jan = (Array.isArray(candles) ? candles : []).slice(-Math.max(5, swing));
  if (jan.length < 5) return null;

  let alto = -Infinity, baixo = Infinity, iAlto = 0, iBaixo = 0;
  jan.forEach((c, i) => {
    if (!candleValido(c)) return;
    if (c.h > alto) { alto = c.h; iAlto = i; }
    if (c.l < baixo) { baixo = c.l; iBaixo = i; }
  });
  if (!num(alto) || !num(baixo) || alto <= baixo) return null;

  const direcao = iAlto > iBaixo ? 'alta' : 'baixa';
  const range = alto - baixo;
  const niveis = {};
  for (const nv of NIVEIS_FIB) {
    niveis[nv] = direcao === 'alta' ? alto - range * nv : baixo + range * nv;
  }
  return {
    alto, baixo, range, direcao, niveis,
    t: jan[jan.length - 1].t,
    velas: jan.length,
  };
}

/** Preço de um nível de Fibonacci do swing corrente. */
export function precoDoNivel(candles, nivel, swing = ALERTA_PARAMS.swing) {
  const s = swingFib(candles, swing);
  if (!s) return null;
  if (nivel === 1) return s.direcao === 'alta' ? s.baixo : s.alto;
  if (nivel === 0) return s.direcao === 'alta' ? s.alto : s.baixo;
  const v = s.niveis[nivel];
  return num(v) ? v : null;
}

/** Alvo em preço que o alerta está vigiando agora (null se não der para calcular). */
export function alvoAtual(alerta, ctx = {}) {
  if (!alerta) return null;
  if (alerta.tipo === 'fib') return precoDoNivel(ctx.candles, alerta.nivel, alerta.swing);
  if (num(alerta.preco)) return alerta.preco;
  return null;
}

export function estadoInicial() {
  return { ref: null, travado: false, ladoDisparo: null, ultimoT: null, disparos: 0, ultimoDisparoEm: null };
}

function cabeDirecao(direcao, lado) {
  if (!lado) return false;
  if (direcao === 'ambas') return true;
  // o usuário pensa em "acima/abaixo"; o evento pensa em "alta/baixa"
  if (direcao === 'acima') return lado === 'alta';
  if (direcao === 'abaixo') return lado === 'baixa';
  return direcao === lado;
}

/**
 * Avalia um alerta contra o estado atual do mercado.
 * Não dispara duas vezes no mesmo movimento: preço e fib travam até o preço
 * voltar ALERTA_PARAMS.histerese, média trava pela identidade da vela.
 *
 * @param {object} alerta {tipo, direcao, preco?, rapida?, lenta?, nivel?, swing?}
 * @param {object} estado  saída anterior de estadoInicial()
 * @param {object} ctx     {preco, candles, agora?}
 * @returns {{disparou:boolean, evento:object|null, estado:object}}
 */
export function avaliar(alerta, estado, ctx = {}) {
  const est = { ...estadoInicial(), ...(estado || {}) };
  const preco = ctx && ctx.preco;
  if (!alerta || !num(preco)) return { disparou: false, evento: null, estado: est };

  const direcao = alerta.direcao || 'ambas';
  est.ref = num(est.ref) ? est.ref : preco;

  if (alerta.tipo === 'ma') {
    const c = cruzamentoMedia(ctx.candles, alerta.rapida || ALERTA_PARAMS.rapida, alerta.lenta || ALERTA_PARAMS.lenta);
    if (!c) return { disparou: false, evento: null, estado: est };

    // primeira leitura só memoriza a travessia que já existia, para não
    // acordar o usuário com um cruzamento que aconteceu antes de armar
    if (est.ultimoT === null) {
      est.ultimoT = c.t;
      return { disparou: false, evento: null, estado: est };
    }
    if (c.t !== est.ultimoT) {
      est.ultimoT = c.t;
      if (cabeDirecao(direcao, c.lado)) {
        est.disparos += 1;
        est.ultimoDisparoEm = num(ctx.agora) ? ctx.agora : null;
        return {
          disparou: true,
          evento: {
            tipo: 'ma', lado: c.lado, alvo: c.lado === 'alta' ? c.lenta : c.rapida,
            preco, rapida: c.rapida, lenta: c.lenta, t: c.t,
          },
          estado: est,
        };
      }
    }
    return { disparou: false, evento: null, estado: est };
  }

  // preço fixo e fibonacci
  const alvo = alvoAtual(alerta, ctx);
  if (!num(alvo)) return { disparou: false, evento: null, estado: est };

  const folga = Math.abs(alvo) * (num(alerta.histerese) ? alerta.histerese : ALERTA_PARAMS.histerese);
  if (est.travado) {
    const longe = est.ladoDisparo === 'alta' ? preco < alvo - folga : preco > alvo + folga;
    if (longe) { est.travado = false; est.ladoDisparo = null; }
  }

  const ref = est.ref;
  let lado = null;
  if (ref < alvo && preco >= alvo) lado = 'alta';
  else if (ref > alvo && preco <= alvo) lado = 'baixa';

  if (lado && !est.travado && cabeDirecao(direcao, lado)) {
    est.travado = true;
    est.ladoDisparo = lado;
    est.disparos += 1;
    est.ultimoDisparoEm = num(ctx.agora) ? ctx.agora : null;
    est.ref = preco;
    return { disparou: true, evento: { tipo: alerta.tipo, lado, alvo, preco, nivel: alerta.nivel || null }, estado: est };
  }

  est.ref = preco;
  return { disparou: false, evento: null, estado: est };
}

/** Distância em pontos e em % entre o preço e o alvo do alerta. */
export function distancia(alerta, ctx = {}) {
  const alvo = alvoAtual(alerta, ctx);
  const preco = ctx.preco;
  if (!num(alvo) || !num(preco) || !preco) return null;
  return { alvo, pontos: alvo - preco, percentual: ((alvo - preco) / preco) * 100 };
}

/** Texto curto e determinístico da regra, útil para log e para o robô. */
export function rotulo(alerta) {
  if (!alerta) return '';
  const dir = alerta.direcao === 'acima' ? 'rompeu acima' : alerta.direcao === 'abaixo' ? 'perdeu abaixo' : 'cruzou';
  if (alerta.tipo === 'ma') {
    return `Média ${alerta.rapida || ALERTA_PARAMS.rapida}/${alerta.lenta || ALERTA_PARAMS.lenta} ${dir}`;
  }
  if (alerta.tipo === 'fib') {
    return `Fib ${alerta.nivel} ${dir}`;
  }
  return `Preço ${alerta.preco} ${dir}`;
}

/** Assinatura SHA-256 da regra: o mesmo alerta gera sempre o mesmo hash. */
export async function assinarAlerta(alerta) {
  const regra = {
    core: ALERTAS_VERSION,
    tipo: alerta.tipo,
    direcao: alerta.direcao || 'ambas',
    preco: num(alerta.preco) ? alerta.preco : null,
    rapida: alerta.rapida || null,
    lenta: alerta.lenta || null,
    nivel: num(alerta.nivel) ? alerta.nivel : null,
    swing: alerta.swing || null,
  };
  return { regra, hash: (await sha256hex(canon(regra))).slice(0, 16) };
}

export { ema };
