import { expectativa, simular, escada } from './giro.js';
let ok = 0, f = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { f++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };

const base = { equity: 130, riscoPct: 2, alvoR: 2, acerto: 0.45, ciclos: 100, spreadR: 0.05, semente: 11 };

const ev = expectativa(base);
t('ganho em R coerente', Math.abs(ev.ganhoR - 1.95) < 1e-6, ev.ganhoR);
t('perda em R coerente', Math.abs(ev.perdaR - 1.05) < 1e-6, ev.perdaR);
t('expectativa positiva com 45% e 1:2', ev.evR > 0, ev.evR);
t('acerto neutro perto de 35%', Math.abs(ev.acertoNeutro - 35) < 0.5, ev.acertoNeutro);

const ruim = expectativa({ ...base, acerto: 0.3 });
t('expectativa negativa com 30%', ruim.evR < 0, ruim.evR);

const r = simular(base);
t('simula e devolve mediana', r && r.mediana > 0, r && r.mediana);
t('faixa p10 < mediana < p90', r.p10 <= r.mediana && r.mediana <= r.p90);
t('tem vantagem sinalizada', r.temVantagem === true);
t('ruina baixa com 2% de risco', r.ruinaPct < 5, r.ruinaPct);

const agressivo = simular({ ...base, riscoPct: 20 });
t('risco alto aumenta a ruina', agressivo.ruinaPct > r.ruinaPct, agressivo.ruinaPct);
t('risco alto estica a cauda', agressivo.p90 > r.p90);

const esp = simular({ ...base, modo: 'espelhado', acerto: 0.4, alvoR: 3 });
const evEsp = expectativa({ ...base, modo: 'espelhado', acerto: 0.4, alvoR: 3 });
t('espelhado cobra duas pernas na perda', Math.abs(evEsp.perdaR - 2.1) < 1e-6, evEsp.perdaR);
t('espelhado com 40% e 3R NAO tem vantagem (precisa 52,5%)', evEsp.evR < 0, evEsp.evR);
t('acerto neutro do espelhado em 52,5%', Math.abs(evEsp.acertoNeutro - 52.5) < 0.15, evEsp.acertoNeutro);
t('espelhado com 60% e 3R tem vantagem', expectativa({ ...base, modo: 'espelhado', acerto: 0.6, alvoR: 3 }).evR > 0);
t('espelhado simula', esp && esp.mediana > 0);
t('espelhado perde vantagem com 25%', expectativa({ ...base, modo: 'espelhado', acerto: 0.25, alvoR: 3 }).evR < 0);

const esc = escada(base);
t('escada devolve ciclos para dobrar', esc && esc.ciclosParaDobrar > 0, esc && esc.ciclosParaDobrar);

t('deterministico com a mesma semente', simular(base).mediana === simular(base).mediana);
t('mudar o acerto muda a mediana', simular({ ...base, acerto: 0.5 }).mediana > simular(base).mediana);
t('ciclos zero devolve null', simular({ ...base, ciclos: 0 }) === null);
t('equity zero devolve null', simular({ ...base, equity: 0 }) === null);

console.log(f ? '\n' + f + ' falhas' : '\n' + ok + ' verificacoes do simulador de giro passaram');
process.exit(f ? 1 : 0);
