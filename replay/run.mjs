// Replay histórico do Atlas. Baixa anos de velas fechadas e roda o núcleo
// do robô sobre elas, barra a barra, sem olhar o futuro.
//
// Zero Base44, zero integração: roda no GitHub Actions (ou na mão) e o
// resultado vira um JSON que o painel lê na aba REPLAY.
//
// Uso:  node replay/run.mjs
// Saída: observador/historico/replay.json (+ cópia na pasta publicada)

import { mkdirSync, writeFileSync } from 'node:fs';
import { simularReplay } from '../atlas-ui/core/replay.js';

const ATIVO = process.env.REPLAY_ATIVO || 'BTC-USD';
const CUSTO_BPS = Number(process.env.REPLAY_CUSTO_BPS || 6);   // ida e volta, conservador

const PLANOS = [
  { barra: '1H', gran: 3600, dias: 1095 },
  { barra: '15M', gran: 900, dias: 180 },
  { barra: '5M', gran: 300, dias: 60 }
];

// configuração viva do robô
const FILTROS = { alvoR: 2, distMinPct: 1, soNaVirada: true };

// variantes mostradas na aba REPLAY, para o número escolhido não ficar sozinho
const VARIANTES = [
  { nome: 'sem filtro', opts: {} },
  { nome: 'só na virada', opts: { soNaVirada: true } },
  { nome: 'folga ≥ 1%', opts: { distMinPct: 1 } },
  { nome: 'folga ≥ 1% + virada', opts: { distMinPct: 1, soNaVirada: true }, escolhida: true },
  { nome: 'folga ≥ 2% + virada', opts: { distMinPct: 2, soNaVirada: true } },
  { nome: 'alvo 3R + folga ≥ 1% + virada', opts: { distMinPct: 1, soNaVirada: true, alvoR: 3 } }
];

const PASTA = 'observador/historico';
const PUBLICADO = 'atlas-ui/observador/historico';

function dorme(ms) { return new Promise(r => setTimeout(r, ms)); }

async function bloco(ativo, gran, ini, fim) {
  const u = `https://api.exchange.coinbase.com/products/${ativo}/candles?granularity=${gran}&start=${ini.toISOString()}&end=${fim.toISOString()}`;
  for (let n = 0; n < 3; n++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'atlas-replay' } });
      if (r.status === 429) { await dorme(1200); continue; }
      if (!r.ok) throw new Error('coinbase ' + r.status);
      const d = await r.json();
      if (!Array.isArray(d)) throw new Error('formato inesperado');
      return d.map(x => ({ time: +x[0], open: +x[3], high: +x[2], low: +x[1], close: +x[4] }));
    } catch (e) {
      if (n === 2) throw e;
      await dorme(800);
    }
  }
  return [];
}

async function historico(ativo, gran, dias) {
  const fim = new Date();
  const ini = new Date(fim.getTime() - dias * 24 * 3600 * 1000);
  const janela = 300 * gran * 1000;
  const mapa = new Map();
  let cursor = fim.getTime();
  let voltas = 0;
  const limite = Math.ceil((dias * 86400 * 1000) / janela) + 2;
  while (cursor > ini.getTime() && voltas < limite) {
    const cs = await bloco(ativo, gran, new Date(Math.max(cursor - janela, ini.getTime())), new Date(cursor));
    cs.forEach(c => mapa.set(c.time, c));
    if (!cs.length) break;
    const menor = Math.min(...cs.map(c => c.time * 1000));
    if (menor >= cursor) break;
    cursor = menor - gran * 1000;
    voltas++;
    await dorme(180);
  }
  return Array.from(mapa.values()).sort((a, b) => a.time - b.time);
}

function resumo(r, anos) {
  if (!r || !r.operacoes) return { erro: 'sem operacoes' };
  const anosR = anos > 0 ? anos : 1;
  return {
    operacoes: r.operacoes,
    acerto_pct: r.acerto_pct,
    r_medio: r.r_medio,
    r_total: r.r_total,
    r_ano: Math.round(r.r_total / anosR * 10) / 10,
    drawdown_r: r.drawdown_r,
    profit_factor: r.profit_factor,
    sequencia_perdas: r.sequencia_perdas,
    barras_media: r.barras_media,
    por_ano: r.por_ano,
    por_motivo: r.por_motivo
  };
}

async function main() {
  mkdirSync(PASTA, { recursive: true });
  mkdirSync(PUBLICADO, { recursive: true });
  const saida = {
    versao: '1.1.0', ativo: ATIVO, custo_bps: CUSTO_BPS,
    filtros: FILTROS, gerado_em: new Date().toISOString(), series: {}
  };

  for (const p of PLANOS) {
    try {
      const cs = (await historico(ATIVO, p.gran, p.dias)).slice(0, -1);
      const anos = (cs.length * p.gran) / (365 * 86400);
      const r = simularReplay(cs, { ...FILTROS, custoBps: CUSTO_BPS });
      const item = { barra: p.barra, dias: p.dias, barras: cs.length, anos: Math.round(anos * 100) / 100,
        de: cs.length ? new Date(cs[0].time * 1000).toISOString().slice(0, 10) : null,
        ate: cs.length ? new Date(cs[cs.length - 1].time * 1000).toISOString().slice(0, 10) : null,
        nucleo: r ? r.nucleo : null, ...resumo(r, anos) };

      if (p.barra === '1H' && r) {
        // sensibilidade a custo e variantes, só na série principal
        item.custos = [0, 3, 6, 12, 18].map(bps => {
          const x = simularReplay(cs, { ...FILTROS, custoBps: bps });
          return { bps, r_medio: x && x.r_medio, r_ano: x && Math.round(x.r_total / (anos || 1) * 10) / 10 };
        });
        item.variantes = VARIANTES.map(v => {
          const x = simularReplay(cs, { alvoR: 2, ...v.opts, custoBps: CUSTO_BPS });
          return { nome: v.nome, escolhida: !!v.escolhida, ...resumo(x, anos) };
        });
        // metade dentro, metade fora: o filtro não pode ser só sorte de amostra
        const meio = Math.floor(cs.length / 2);
        item.dentro = resumo(simularReplay(cs.slice(0, meio), { ...FILTROS, custoBps: CUSTO_BPS }), anos / 2);
        item.fora = resumo(simularReplay(cs.slice(meio - 300), { ...FILTROS, custoBps: CUSTO_BPS }), anos / 2);
        item.trades = r.trades;
        item.aberta = r.aberta;
      }
      saida.series[p.barra] = item;
      console.log(p.barra, 'barras', cs.length, 'ops', item.operacoes || 0, 'r_ano', item.r_ano ?? '-');
    } catch (e) {
      saida.series[p.barra] = { barra: p.barra, dias: p.dias, erro: e.message };
      console.error(p.barra, 'falhou:', e.message);
    }
  }

  const json = JSON.stringify(saida, null, 1);
  writeFileSync(`${PASTA}/replay.json`, json);
  writeFileSync(`${PUBLICADO}/replay.json`, json);
  console.log('gravado: ' + PASTA + '/replay.json');
}

main().catch(e => { console.error('falhou:', e.message); process.exit(1); });
