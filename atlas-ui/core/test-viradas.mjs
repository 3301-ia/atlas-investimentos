import { medirViradas, agregar } from './viradas.js';
let ok = 0, f = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { f++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };

// velas de 15 minutos, tendencia com ziguezague
const mk = (n, base = 100) => Array.from({ length: n }, (_, i) => {
  const c = base + Math.sin(i / 7) * 6 + i * 0.05;
  return { time: 1700000000 + i * 900, o: c - 0.3, h: c + 0.8, l: c - 0.8, c };
});
const v = mk(400);
const r = medirViradas(v, { spread: 0.2 });
t('mede viradas', r && r.totalViradas > 5, r && r.totalViradas);
t('atr medio coerente', r.atrMedio > 0 && r.atrMedio < 5, r.atrMedio);
t('soma dos ciclos bate', Math.abs(r.brutoAtr - r.ciclos.reduce((a, b) => a + b.brutoAtr, 0)) < 0.2);
t('liquido = bruto - custo', Math.abs(r.liquidoAtr - (r.brutoAtr - r.custoAtr)) < 0.05);
t('custo cresce com spread', medirViradas(v, { spread: 2 }).custoAtr > medirViradas(v, { spread: 0.2 }).custoAtr);
t('spread zero zera o custo', medirViradas(v, { spread: 0 }).custoAtr === 0);
t('spread grande piora o veredito', /come o ciclo/.test(medirViradas(v, { spread: 20 }).veredito), medirViradas(v, { spread: 20 }).veredito);
t('spread pequeno aprova', /baixo/.test(medirViradas(v, { spread: 0.1 }).veredito));
t('conta o ruido', r.ruidoPct >= 0 && r.ruidoPct <= 100);
t('poucas velas devolve null', medirViradas(v.slice(0, 20)) === null);

const agr = agregar(v, 4);
t('agrega 4 velas em 1', agr.length === 100, agr.length);
t('agregado preserva extremos', (() => {
  const primeiro = v.slice(0, 4);
  const a = agr[0];
  return a.h === Math.max(...primeiro.map(x => x.h)) && a.l === Math.min(...primeiro.map(x => x.l)) && a.c === primeiro[3].c;
})());
t('fator 1 devolve vazio', agregar(v, 1).length === 0);

console.log(f ? '\n' + f + ' falhas' : '\n' + ok + ' verificacoes do medidor de viradas passaram');
process.exit(f ? 1 : 0);
