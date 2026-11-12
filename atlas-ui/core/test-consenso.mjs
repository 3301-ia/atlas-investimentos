// Provas do FIB automatico (alternancia) e do consenso de microtempo.
// Rodar de atlas-ui: node core/test-consenso.mjs

import { fiboAuto, gatilhoDaPerna, FIB_AUTO_VERSION, FIB_PARAMS } from './fibonacci.js';
import { consenso, lerTempo, eventosRecentes, CONSENSO_VERSION, PESOS } from './consenso.js';

let ok = 0, falhou = 0;
const t = (nome, cond, extra) => {
  if (cond) { ok++; console.log('  ok  ' + nome); }
  else { falhou++; console.log('  FALHOU  ' + nome + (extra != null ? ' :: ' + JSON.stringify(extra) : '')); }
};

// ── serie sintetica: ondas que garantem cruzamentos da EMA 8/16 ────────────
function ondas(n = 220, base = 100000, amp = 900, periodo = 26) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = base + Math.sin(i / periodo * Math.PI * 2) * amp + Math.sin(i / 7) * 60;
    const o = i === 0 ? c : out[i - 1].c;
    const h = Math.max(o, c) + 25;
    const l = Math.min(o, c) - 25;
    out.push({ t: 1700000000000 + i * 60000, o, h, l, c, v: 10 + (i % 7) });
  }
  return out;
}

console.log('\n== FIB automatico (alternancia) ==');
const velas = ondas();
const plano = fiboAuto(velas);
t('entrega uma perna atual', !!plano && !!plano.lado, plano && plano.lado);
t('versao nova do nucleo', plano && plano.versao === FIB_AUTO_VERSION, plano && plano.versao);
t('alternou pelo menos 3 vezes', plano && plano.alternancias >= 3, plano && plano.alternancias);
t('guardou historico de pernas', plano && plano.historico.length > 1, plano && plano.historico.length);

const lados = plano.historico.map(h => h.lado);
let alternaDeVerdade = true;
for (let i = 1; i < lados.length; i++) if (lados[i] === lados[i - 1]) alternaDeVerdade = false;
t('lados do historico alternam sem repetir', alternaDeVerdade, lados);

t('p0 e p1 formam range positivo', plano && plano.range > 0, plano && plano.range);
t('na perna de alta p1 e o topo e p0 o fundo', plano.lado === 'baixa' ? plano.p1 < plano.p0 : plano.p1 > plano.p0,
  { lado: plano.lado, p0: plano.p0, p1: plano.p1 });

// alvos sempre no sentido da perna
const alvosOk = plano.niveis.every((n, k) => k === 0 || (plano.lado === 'alta' ? n.preco > plano.niveis[k - 1].preco : n.preco < plano.niveis[k - 1].preco));
t('alvos projetados em progressao no sentido da perna', alvosOk, plano.niveis.map(n => n.preco));

t('sem velas suficientes devolve nulo', fiboAuto(velas.slice(0, 20)) === null);

console.log('\n== gatilho da perna ==');
const g = plano.gatilho;
t('entrada no p1 (extremo do impulso)', g.entrada === plano.p1, { entrada: g.entrada, p1: plano.p1 });
t('stop na origem p0', g.stop === plano.p0, { stop: g.stop, p0: plano.p0 });
t('lado traduzido para compra/venda', g.lado === (plano.lado === 'alta' ? 'compra' : 'venda'), g.lado);
t('risco igual ao range da perna', Math.abs(g.risco - plano.range) < 0.02, { risco: g.risco, range: plano.range });
t('alvo paga pelo menos 1,2R', g.rr != null && g.rr >= 1.2, g.rr);
t('tem alvo parcial no 0.618', g.parcial === plano.niveis[0].preco, g.parcial);
t('estado coerente com o preco', ['aguardando', 'acionado', 'invalidado'].includes(g.estado), g.estado);

console.log('\n== consenso ==');
const s30 = ondas(220, 100000, 900, 26);
const s1m = ondas(220, 100000, 880, 27);
const s15 = ondas(220, 100000, 860, 28);
const c = consenso({ '30s': s30, '1m': s1m, '15m': s15 });
t('consenso tem versao', c && c.versao === CONSENSO_VERSION, c && c.versao);
t('le os tres tempos', c && c.temposLidos === 3, c && c.temposLidos);
t('forca maxima 6 (1 + 1,5 + 2,5)', PESOS['30s'] + PESOS['1m'] + PESOS['15m'] === 5, PESOS);
t('forca nao passa da soma dos pesos', c.forca <= 5, c.forca);
t('lado do consenso e compra ou venda ou nulo', c.lado === null || c.lado === 'compra' || c.lado === 'venda', c.lado);
t('motivo em texto', typeof c.motivo === 'string' && c.motivo.length > 3, c.motivo);

// tempos divididos: 15m contra os outros dois
const contra = ondas(220, 100000, 900, 13);
const misto = consenso({ '30s': s30, '1m': s1m, '15m': contra });
t('consenso devolve leitura por tempo', misto.leituras.length === 3, misto.leituras.length);
const somaPesos = misto.leituras.filter(l => l.relevante).reduce((a, l) => a + (PESOS[l.tempo] || 1), 0);
t('forca e a soma dos pesos do lado vencedor', misto.lado == null || Math.abs(misto.forca + misto.contra - somaPesos) < 0.001,
  { forca: misto.forca, contra: misto.contra, somaPesos });

// perna velha e longe do preco nao vota
const velho = ondas(220, 130000, 300, 60);
const c2 = consenso({ '30s': s30, '1m': s1m, '15m': velho });
const l15 = c2.leituras.find(l => l.tempo === '15m');
t('perna longe do preco fica fora do voto', l15.relevante === false || l15.distPct <= 1.5, { relevante: l15.relevante, dist: l15.distPct });

t('lerTempo marca estado de gatilho', ['acionado', 'aguardando', 'invalidado', 'sem gatilho'].includes(lerTempo(s30, '30s').estado), lerTempo(s30, '30s').estado);
t('lerTempo sem velas avisa', lerTempo([], '30s').valido === false);

const ev = eventosRecentes({ '30s': s30, '1m': s1m, '15m': s15 }, 8);
t('eventos recentes ordenados do mais novo', ev.length > 0 && ev.every((e, i) => i === 0 || (ev[i - 1].t || 0) >= (e.t || 0)), ev.slice(0, 3));

console.log('\n' + (falhou ? falhou + ' falharam' : 'todas as ' + ok + ' verificacoes do consenso passaram'));
process.exit(falhou ? 1 : 0);
