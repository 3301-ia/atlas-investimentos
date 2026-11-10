// Teste determinístico de figuras, ângulos Gann e calendário.
// Monta séries com formato conhecido e confere se o núcleo nomeia a figura
// e mede o ângulo esperado. Duas execuções têm de dar o mesmo resultado.

import { classificar, atrSimples } from './padroes.js';
import { familiaDeAngulos, quadradoDeNove, ciclosTempo, calendarioGann, grausDaFamilia } from './gann.js';
import { assinarSinal } from './signature.js';

function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function serie(forma, n = 160, base = 74000) {
  const rnd = lcg(20261110);
  const out = [];
  for (let i = 0; i < n; i++) {
    let preco;
    if (forma === 'triangulo') {
      const topo = base + 900 - i * 9;      // topo caindo
      const fundo = base - 900 + i * 9;     // fundo subindo
      preco = fundo + (topo - fundo) * (0.5 + 0.35 * Math.sin(i * 1.1));
    } else if (forma === 'canalAlta') {
      preco = base + i * 12 + 220 * Math.sin(i * 0.35);
    } else if (forma === 'canalBaixa') {
      preco = base - i * 12 + 220 * Math.sin(i * 0.35);
    } else if (forma === 'duploTopo') {
      const p1 = n * 0.35, p2 = n * 0.65, alto = base + 480;
      if (i < p1) preco = base + (i / p1) * 480;
      else if (i < p2) preco = alto - 300 * Math.sin(((i - p1) / (p2 - p1)) * Math.PI);
      else preco = alto - ((i - p2) / (n - p2)) * 420;
    } else {
      preco = base + (rnd() - 0.5) * 60;
    }
    const o = preco + (rnd() - 0.5) * 8, c = preco + (rnd() - 0.5) * 8;
    const h = Math.max(o, c) + rnd() * 10, l = Math.min(o, c) - rnd() * 10;
    out.push({ t: 1794000000000 + i * 60000, o, h, l, c, v: 1 });
  }
  return out;
}

const resultados = {};
for (const forma of ['triangulo', 'canalAlta', 'canalBaixa', 'duploTopo', 'aleatorio']) {
  const candles = serie(forma);
  const atr = atrSimples(candles, 14);
  const r = classificar(candles, { escalaPreco: atr, nPivo: 3, janela: 160 });
  resultados[forma] = {
    figura: r.figura,
    alternativas: r.alternativas,
    direcao: r.direcao,
    confianca: r.confianca,
    graus: r.graus,
    rompimento: r.rompimento,
    posicaoNoCanal: r.posicaoNoCanal
  };
}

const fam = familiaDeAngulos(74000, 100, 20, 30);
const q9 = quadradoDeNove(74000, 3);
const ciclo = ciclosTempo('2026-08-15', new Date('2026-11-10T12:00:00Z'));
const cal = calendarioGann(new Date('2026-11-10T12:00:00Z'));

const resumo = {
  versao: '1.0.0',
  figuras: resultados,
  grausFamilia: grausDaFamilia(),
  familiaFinal: fam.map(f => ({ nome: f.nome, graus: f.graus, valorFinal: f.valorFinal })),
  quadradoDeNove: { raiz: q9.raiz, centro: q9.niveis.find(n => n.passo === 0).preco, acima: q9.niveis.filter(n => n.passo > 0).map(n => n.preco) },
  ciclos: { diasDesde: ciclo.diasDesde, proximo: ciclo.proximo },
  calendario: cal
};

const hash = await assinarSinal(resumo);
console.log(JSON.stringify({ ...resumo, hash: hash.hash }, null, 1));
