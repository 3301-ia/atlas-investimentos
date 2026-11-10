// Teste determinístico do Fibonacci portado do Pine.
// Série fixa, mesma entrada, mesmo hash. Serve para provar que a tela e o
// robô leem a mesma âncora e o mesmo alvo.

import { fiboPlan, distanciaAlvo, FIB_VERSION } from './fibonacci.js';
import { assinarSinal } from './signature.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function serie(n, seed = 20261110) {
  const r = rng(seed);
  const out = [];
  let preco = 74000;
  const t0 = 1794300000;
  for (let i = 0; i < n; i++) {
    const passo = (r() - 0.48) * 90;
    const abre = preco;
    const fecha = preco + passo;
    const topo = Math.max(abre, fecha) + r() * 40;
    const fundo = Math.min(abre, fecha) - r() * 40;
    out.push({ t: t0 + i * 60, o: +abre.toFixed(2), h: +topo.toFixed(2), l: +fundo.toFixed(2), c: +fecha.toFixed(2), v: 1 });
    preco = fecha;
  }
  return out;
}

const velas = serie(600);
const plano = fiboPlan(velas);

if (!plano) {
  console.log(JSON.stringify({ erro: 'sem ancora' }));
  process.exit(1);
}

const assinatura = await assinarSinal({
  versao: FIB_VERSION,
  lado: plano.lado,
  ancoraEm: plano.ancoraEm,
  p0: plano.p0,
  p1: plano.p1,
  niveis: plano.niveis.map(n => [n.mult, n.preco, n.bateu])
});

const plano2 = fiboPlan(velas);
console.log(JSON.stringify({
  versao: FIB_VERSION,
  velas: velas.length,
  lado: plano.lado,
  ancoraEmBarra: plano.ancoraEmBarra,
  p0: plano.p0,
  p1: plano.p1,
  range: plano.range,
  niveis: plano.niveis.map(n => `${n.mult} -> ${n.preco}${n.bateu ? ' (batido)' : ''}`),
  alvoAtivo: plano.alvoAtivo,
  alvoAtual: plano.alvoAtual?.preco,
  invalidada: plano.invalidada,
  distancia: distanciaAlvo(plano, velas[velas.length - 1].c),
  assinatura,
  determinismo: JSON.stringify(plano) === JSON.stringify(plano2) ? 'estavel' : 'instavel'
}, null, 1));
