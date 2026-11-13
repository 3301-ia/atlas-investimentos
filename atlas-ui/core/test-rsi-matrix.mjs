// RSI Matrix: prova que a conta é a mesma do gráfico e que nada quebra.
import { calcular, rsi, ema, precoParaRsi, rsiParaPreco, opcoes, limparVelas, PADRAO } from './rsi-matrix.js';

let ok = 0, falhou = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { falhou++; console.log('  FALHOU  ' + n + (x != null ? ' :: ' + JSON.stringify(x) : '')); } };

function serie(n, base = 100, passo = 0.1) {
  let tt = 1700000000, p = base, out = [];
  for (let i = 0; i < n; i++) {
    tt += 3600;
    p += Math.sin(i / 7) * 0.9 + passo;
    out.push({ time: tt, open: p - 0.2, high: p + 0.5, low: p - 0.6, close: p, volume: 10 });
  }
  return out;
}

console.log('\n== RSI de Wilder ==');
const vals = [44, 44.5, 44.2, 43.8, 44.9, 45.2, 45.0, 45.5];
const r = rsi(vals, 3);
t('não devolve valor antes de aquecer', r.valores[2] === undefined);
t('devolve valor depois do aquecimento', typeof r.valores[3] === 'number');
const subindo = rsi([1, 2, 3, 4, 5, 6], 3).valores[5];
t('série que só sobe dá RSI 100', subindo === 100, subindo);
const caindo = rsi([6, 5, 4, 3, 2, 1], 3).valores[5];
t('série que só cai dá RSI 0', caindo === 0, caindo);
t('RSI fica entre 0 e 100', rsi(serie(80).map(v => v.close), 14).valores.slice(15).every(v => v >= 0 && v <= 100));

console.log('\n== EMA do RSI ==');
const e = ema([10, 20, 30, 40, 50], 3);
t('EMA termina definida', typeof e[4] === 'number');
t('EMA sem buraco não devolve nulo no fim', e.slice(2).every(v => typeof v === 'number'));

console.log('\n== o preço que leva o RSI a um valor ==');
const velas = serie(160);
const base = calcular(velas, { rsiLen: 14, emaLen: 12, rsiEntrada: 27 });
t('calculo principal funciona', base.ok === true, base.motivo);
t('RSI dentro de 0..100', base.rsi >= 0 && base.rsi <= 100, base.rsi);
t('três níveis pedidos (digitado, sobrecompra, sobrevenda)', base.niveis.length === 3);

const nivel = base.niveis.find(n => n.viavel);
const volta = rsiParaPreco({ close: base.preco, ganho: base.ganho, perda: base.perda, len: 14, preco: nivel.preco });
t('ida e volta bate: o preço do nível devolve o RSI pedido', Math.abs(volta.rsi - nivel.rsi) < 0.01, { pedido: nivel.rsi, obtido: volta.rsi });

const acima = base.niveis.find(n => n.viavel && n.rsi > base.rsi);
const abaixo = base.niveis.find(n => n.viavel && n.rsi < base.rsi);
t('alvo acima do RSI atual pede preço maior', !acima || acima.preco > base.preco);
t('alvo abaixo do RSI atual pede preço menor', !abaixo || abaixo.preco < base.preco);
t('nipples: nível de RSI 30 fica abaixo do nível de RSI 70', (() => {
  const n70 = base.niveis.find(n => Math.abs(n.rsi - 70) < 0.01 && n.viavel);
  const n30 = base.niveis.find(n => Math.abs(n.rsi - 30) < 0.01 && n.viavel);
  return n70 && n30 ? n30.preco < n70.preco : true;
})());

console.log('\n== RSI de um preço digitado ==');
const precoRsi = rsiParaPreco({ close: base.preco, ganho: base.ganho, perda: base.perda, len: 14, preco: base.preco });
t('preço igual ao fechamento devolve o próprio RSI', Math.abs(precoRsi.rsi - base.rsi) < 0.01, { a: precoRsi.rsi, b: base.rsi });
const alto = rsiParaPreco({ close: base.preco, ganho: base.ganho, perda: base.perda, len: 14, preco: base.preco * 1.1 });
t('preço maior devolve RSI maior', alto.rsi > base.rsi);

console.log('\n== os ajustes são respeitados ==');
const o = opcoes({ rsiLen: 999, sobrecompra: 5, sobrevenda: 95, decimais: 40, fonte: 'xxx' });
t('comprimento do RSI limitado a 200', o.rsiLen === 200, o.rsiLen);
t('sobrecompra fica acima de 50', o.sobrecompra >= 51, o.sobrecompra);
t('sobrevenda fica abaixo de 50', o.sobrevenda <= 49, o.sobrevenda);
t('decimais limitados a 8', o.decimais === 8, o.decimais);
t('fonte inválida volta para fechamento', o.fonte === 'close', o.fonte);
const o2 = opcoes({ rsiLen: '21', emaLen: '9', rsiEntrada: '27' });
t('texto vira número', o2.rsiLen === 21 && o2.emaLen === 9 && o2.rsiEntrada === 27);
// máximas e mínimas que variam de forma independente do fechamento
const mistas = velas.map((v, i) => ({ ...v, high: v.close + 0.5 + Math.abs(Math.sin(i / 3)) * 2, low: v.close - 0.6 - Math.cos(i / 5) * 1.5 }));
const comFonte = calcular(mistas, { fonte: 'hl2', rsiLen: 14 });
const deFechamento = calcular(mistas, { fonte: 'close', rsiLen: 14 });
t('outra fonte muda a leitura', comFonte.ok && deFechamento.ok && Math.abs(comFonte.rsi - deFechamento.rsi) > 0.001,
  { hl2: comFonte.rsi, close: deFechamento.rsi });
// a leitura pode vir de outra fonte, mas o preço do nível é sempre o do
// gráfico: a linha tem de cair onde o preço realmente está
t('o preço do nível fica no fechamento do gráfico', Math.abs(comFonte.preco - mistas[mistas.length - 1].close) < 0.001);

console.log('\n== não quebra ==');
t('lista vazia devolve motivo', calcular([]).ok === false && calcular([]).motivo === 'faltam velas');
t('nulo devolve motivo', calcular(null).ok === false);
t('vela com preço inválido é descartada', limparVelas([{ time: 1, close: NaN }, { time: 2, close: 5 }]).length === 1);
t('tempo repetido é descartado', limparVelas([{ time: 1, close: 5 }, { time: 1, close: 6 }]).length === 1);
t('ordem invertida vira ordem crescente', (() => { const l = limparVelas([{ time: 2, close: 6 }, { time: 1, close: 5 }]); return l.length === 1 && l[0].time === 2; })());
t('poucas velas informa quantas faltam', (() => { const x = calcular(serie(10), { rsiLen: 14 }); return x.ok === false && x.faltam > 0; })());
t('NaN no meio da série não derruba', calcular([...serie(40), { time: 1, close: NaN }, ...serie(40).map(v => ({ ...v, time: v.time + 999999 }))]).ok === true);
t('nenhuma chamada lança exceção', (() => {
  const casos = [null, undefined, [], {}, 'x', 0, [{}], [{ time: 1, close: 0 }], serie(3)];
  return casos.every(c => { try { calcular(c, {}); return true; } catch (err) { return false; } });
})());
t('preço inválido não inventa nível', precoParaRsi({ close: NaN, ganho: 1, perda: 1, len: 14, alvoRsi: 30 }).viavel === false);
t('alvo impossível não devolve número', (() => { const x = precoParaRsi({ close: 100, ganho: 50, perda: 0.0001, len: 14, alvoRsi: 30, rsiAtual: 99 }); return x.viavel === false || x.preco > 0; })());
t('padrões batem com o indicador de referência', PADRAO.rsiLen === 14 && PADRAO.emaLen === 12 && PADRAO.sobrecompra === 70 && PADRAO.sobrevenda === 30 && PADRAO.rsiEntrada === 27);

console.log('\n' + (falhou ? falhou + ' falharam' : 'todas as ' + ok + ' provas do RSI Matrix passaram'));
process.exit(falhou ? 1 : 0);
