// Provas do nucleo Imperial SuperTrend (ZEMA-KAMA + RevRSI).
// Cada teste imprime ok/falha e o arquivo termina com a contagem. Roda com:
//   node core/test-imperial.mjs
import { imperial, IMPERIAL_PARAMS, precoDoRsi, reagrupar, fluxoMacro, atrWilder, rma, resumoImperial } from './imperial.js';

let ok = 0, falhas = 0;
function t(nome, cond, detalhe = '') {
  if (cond) { ok++; console.log('  ok  ' + nome); }
  else { falhas++; console.log('  FALHOU  ' + nome + (detalhe ? ' -> ' + detalhe : '')); }
}

// gerador de velas sinteticas: preco base, passo por vela, ruido do range
function velas(n, inicio, passo, range = 40, volume = 12) {
  const out = [];
  let p = inicio;
  for (let i = 0; i < n; i++) {
    const abre = p;
    p = p + passo;
    const fecha = p;
    const alto = Math.max(abre, fecha) + range * 0.4;
    const baixo = Math.min(abre, fecha) - range * 0.4;
    out.push({ time: 1700000000 + i * 3600, h: alto, l: baixo, c: fecha, v: volume });
  }
  return out;
}

// 1. tendencia de alta limpa
const subida = velas(160, 70000, 45);
const r1 = imperial(subida);
t('le a serie de alta', r1 !== null);
t('alta: lado comprador', r1.estado.dir === 1, 'dir=' + r1.estado.dir);
t('alta: linha abaixo do preco', r1.estado.linha < subida[subida.length - 1].c);
t('alta: angulo positivo', r1.estado.angulo > 0, 'angulo=' + r1.estado.angulo);
// angulo e velocidade normalizada pelo ATR: a mesma subida de 45 por vela
// fica em 30 graus porque o range sintetico e largo. Para passar dos 35
// graus e preciso inclinacao maior em relacao ao range.
const subidaForte = velas(160, 70000, 95, 20);
const rForte = imperial(subidaForte);
t('alta inclinada: angulo forte', rForte.estado.anguloForte === true, 'angulo=' + rForte.estado.angulo.toFixed(1));
t('lateral larga: angulo fraco', r1.estado.anguloForte === false, 'angulo=' + r1.estado.angulo.toFixed(1));

// 2. tendencia de queda limpa
const queda = velas(160, 80000, -45);
const r2 = imperial(queda);
t('queda: lado vendedor', r2.estado.dir === -1, 'dir=' + r2.estado.dir);
t('queda: linha acima do preco', r2.estado.linha > queda[queda.length - 1].c);
t('queda: angulo negativo', r2.estado.angulo < 0, 'angulo=' + r2.estado.angulo);

// 3. viradas: sobe, desce, sobe de novo
const misto = velas(120, 70000, 40).concat(velas(120, 74800, -50)).concat(velas(120, 68800, 45));
const r3 = imperial(misto);
const viraAlta = r3.series.viradaAlta.filter(Boolean).length;
const viraBaixa = r3.series.viradaBaixa.filter(Boolean).length;
t('detectou viradas para baixo', viraBaixa >= 1, 'viradas baixa=' + viraBaixa);
t('detectou viradas para cima', viraAlta >= 1, 'viradas alta=' + viraAlta);
t('virada alta e baixa nunca no mesmo candle', !r3.series.viradaAlta.some((v, i) => v && r3.series.viradaBaixa[i]));

// 4. banda que so aperta: em alta a banda de baixo nunca cai
const bb = r3.series.bandaBaixa;
let afrouxou = false;
for (let i = 60; i < bb.length; i++) {
  if (bb[i] != null && bb[i - 1] != null && r3.series.dir[i] === 1 && r3.series.dir[i - 1] === 1 && bb[i] < bb[i - 1] - 1e-6) afrouxou = true;
}
t('banda de baixo nao afrouxa na alta', !afrouxou);

// 5. alvos de RSI na ordem certa
const e = r1.estado;
t('alvo de sobrecompra acima do equilibrio', e.alvoTopo > e.alvoMeio, `${e.alvoTopo} vs ${e.alvoMeio}`);
t('equilibrio acima do alvo de sobrevenda', e.alvoMeio > e.alvoFundo, `${e.alvoMeio} vs ${e.alvoFundo}`);
// regra do alvo projetado: com RSI acima da sobrecompra, o preco que
// devolveria o RSI a 70 esta ABAIXO do preco atual (e vice-versa).
const precoFinal = subida[subida.length - 1].c;
if (e.rsi > IMPERIAL_PARAMS.ob) {
  t('RSI esticado: alvo de 70 fica abaixo do preco', e.alvoTopo < precoFinal, `rsi=${e.rsi.toFixed(1)} alvo=${e.alvoTopo.toFixed(2)} preco=${precoFinal}`);
} else {
  t('RSI frio: alvo de 70 fica acima do preco', e.alvoTopo > precoFinal, `rsi=${e.rsi.toFixed(1)} alvo=${e.alvoTopo.toFixed(2)} preco=${precoFinal}`);
}
t('RSI acompanha o calculo', e.rsi > 0 && e.rsi <= 100, 'rsi=' + e.rsi);
t('distancia do alvo calculada', Math.abs(e.distAlvoTopo - (e.alvoTopo - subida[subida.length - 1].c)) < 1e-6);

// 6. preco do RSI devolve o inverso do RSI
{
  const len = 14;
  const avgUp = 3, avgDn = 1.5, close = 71000;
  const preco = precoDoRsi(close, avgUp, avgDn, 70, len);
  const x = (len - 1) * (avgDn * (70 / 30) - avgUp);
  const esperado = x >= 0 ? close + x : close + x * (30 / 70);
  t('preco do RSI segue a algebra do Pine', Math.abs(preco - esperado) < 1e-9, `${preco} vs ${esperado}`);
  const p30 = precoDoRsi(close, avgUp, avgDn, 30, len);
  t('alvo 30 fica abaixo do alvo 70', p30 < preco);
}

// 7. absorcao no topo: RSI esticado e candle que fecha no fundo do range
{
  const arr = velas(60, 60000, 25, 20, 10);
  const ultimo = arr[arr.length - 1];
  const base = ultimo.c;
  // candle enorme, fechando perto da minima, acima do fechamento anterior
  const anterior = arr[arr.length - 2].c;
  ultimo.h = base + 900;
  ultimo.l = base - 40;
  ultimo.c = anterior + 2;
  const r = imperial(arr);
  const algumTopo = r.series.absorcaoTopo.some(Boolean);
  t('marca absorcao de topo', algumTopo, 'rsi=' + (r.series.rsi[r.series.rsi.length - 1] || 0).toFixed(1));
}

// 8. absorcao no fundo: RSI esticado em baixa e candle que fecha no topo
{
  const arr = velas(60, 80000, -25, 20, 10);
  const ultimo = arr[arr.length - 1];
  const anterior = arr[arr.length - 2].c;
  ultimo.h = ultimo.c + 40;
  ultimo.l = ultimo.c - 900;
  ultimo.c = anterior - 2;
  const r = imperial(arr);
  t('marca absorcao de fundo', r.series.absorcaoFundo.some(Boolean),
    'rsi=' + (r.series.rsi[r.series.rsi.length - 1] || 0).toFixed(1));
}

// 9. reagrupar velas de 15 min em 1 hora
{
  const m15 = [];
  for (let i = 0; i < 8; i++) {
    m15.push({ time: 1700000000 + i * 900, h: 100 + i, l: 90 - i, c: 95 + i });
  }
  const h1 = reagrupar(m15, 3600 * 1000);
  t('reagrupou 8 velas de 15m em 2 de 1h', h1.length === 2, 'n=' + h1.length);
  t('primeira 1h fecha no candle 4', h1[0].c === 95 + 3, 'c=' + h1[0].c);
  t('primeira 1h pega a maxima do bloco', h1[0].h === 100 + 3, 'h=' + h1[0].h);
  t('primeira 1h pega a minima do bloco', h1[0].l === 90 - 3, 'l=' + h1[0].l);
}

// 10. fluxo macro: sem historico suficiente devolve zero, nao inventa lado
{
  const curto = velas(20, 70000, 30);
  const m = fluxoMacro(curto);
  t('macro sem dado nao inventa lado', m.h1 === 0 && m.d1 === 0, JSON.stringify(m));
  const longo = velas(400, 70000, 20);
  const m2 = fluxoMacro(longo);
  t('macro com 400 velas de 1h le alta', m2.h1 === 1, JSON.stringify(m2));
}

// 11. ATR e RMA: sanidade numerica
{
  const arr = velas(80, 70000, 10, 60);
  const a = atrWilder(arr, 14);
  t('ATR preenche depois do aquecimento', a[13] != null && a[13] > 0, 'atr=' + a[13]);
  const rr = rma([1, 2, 3, 4, 5], 3);
  t('RMA comeca na janela cheia', rr[1] == null && Math.abs(rr[2] - 2) < 1e-9);
}

// 12. series alinhadas e sem vazamento
{
  const n = misto.length;
  const s = r3.series;
  const tam = Object.entries(s).filter(([, v]) => Array.isArray(v) && typeof v[0] !== 'boolean');
  t('todas as series tem o tamanho da entrada', tam.every(([, v]) => v.length === n));
  t('linha do supertrend sem NaN no fim', Number.isFinite(s.linha[n - 1]));
}

// 13. determinismo (é o que permite comparar por hash)
{
  const a = JSON.stringify(imperial(subida));
  const b = JSON.stringify(imperial(subida));
  t('mesma entrada, mesma saida', a === b);
  t('versao declarada', imperial(subida).versao === '1.0.0');
  t('parametros expostos', IMPERIAL_PARAMS.atrMult === 2.2);
}

// 14. serie curta nao quebra
{
  t('serie curta devolve null', imperial(velas(5, 70000, 10)) === null);
  t('entrada vazia devolve null', imperial([]) === null);
  t('resumo em texto', /ALTA|BAIXA/.test(resumoImperial(r1.estado)));
}


// 15. o Pine do Imperial esta no catalogo e o hash bate com o arquivo
{
  const fs = await import('node:fs');
  const crypto = await import('node:crypto');
  const idx = JSON.parse(fs.readFileSync('pine/index.json', 'utf8'));
  const item = (idx.indicadores || []).find(i => i.id === 'vectra_imperial_supertrend');
  t('pine do imperial no catalogo', !!item);
  if (item) {
    const bytes = fs.readFileSync('pine/' + item.arquivo.replace('pine/', ''));
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    t('hash do pine confere', sha === item.sha256, sha + ' vs ' + item.sha256);
    t('pine tem as 8 secoes', item.linhas > 150);
  }
}

console.log(`\n${ok} verificacoes do imperial passaram`);
if (falhas) { console.log(`${falhas} falharam`); process.exitCode = 1; }
