// Robô do Atlas em modo papel, rodando com a Escada de Travas em Terços de R.
//
// Baseado no relatório técnico VECTRA:
// - Níveis em terços de R: 0.33, 0.67, 1.00, 1.33, 1.67
// - Fator da trava: 0.60 do lote principal
// - Alvo da trava: +0.5R | Corte da trava: -0.5R
// - Alvo principal: 2.0R | Stop principal: 1.0 ATR

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { trailingStop, TRAILING_VERSION } from '../atlas-ui/core/trailing.js';
import { dimensionar, RISCO_VERSION } from '../atlas-ui/core/risco.js';
import { assinarSinal } from '../atlas-ui/core/signature.js';
import { ema } from '../atlas-ui/core/indicators.js';

const ATIVO = process.env.ATLAS_ATIVO || 'BTC-USDT';
const EQUITY = Number(process.env.ATLAS_EQUITY || 130);
const RISCO_PCT = Number(process.env.ATLAS_RISCO_PCT || 2);
const ALVO_R = Number(process.env.ATLAS_ALVO_R || 2);
const DIST_MIN_PCT = Number(process.env.ATLAS_DIST_MIN || 1);
const NUCLEO = `escada-travas 1.0 + trailing ${TRAILING_VERSION} + risco ${RISCO_VERSION}`;

const PASTA = 'observador/historico';
const PUBLICADO = 'atlas-ui/observador/historico';

export const TEMPORADAS = [
  { barra: '1H', sufixo: '', okx: '1H', coinbase: 3600, mult: 2.5, folga: 1 },
  { barra: '15M', sufixo: '_15m', okx: '15m', coinbase: 900, mult: 1.5, folga: 1, micro: true },
  { barra: '5M', sufixo: '_5m', okx: '5m', coinbase: 300, mult: 2.5, folga: 1, micro: true }
];

const NIVEIS_TRAVA = [0.333, 0.667, 1.000, 1.333, 1.670];
const FATOR_TRAVA = 0.60;
const ALVO_TRAVA_R = 0.5;
const CORTE_TRAVA_R = 0.5;

async function votosDaCamadaAcima(barra, lado) {
  const mapa = { '15M': [{ b: '15m', nome: '15m' }, { b: '1H', nome: '1H' }],
                 '5M':  [{ b: '15m', nome: '15m' }, { b: '1H', nome: '1H' }] };
  const fontes = mapa[barra] || [];
  const votos = [], contra = [];
  for (const f of fontes) {
    try {
      const j = await (await fetch(`https://www.okx.com/api/v5/market/candles?instId=${ATIVO}&bar=${f.b}&limit=120`)).json();
      const v = (j.data || []).map(x => ({ time: Math.floor(+x[0] / 1000), close: +x[4] })).sort((a, b) => a.time - b.time).slice(0, -1);
      if (v.length < 40) continue;
      const r = ema(v.map(x => x.close), 8), l = ema(v.map(x => x.close), 16);
      const i = v.length - 1;
      if (r[i] == null || l[i] == null) continue;
      const ladoAcima = r[i] > l[i] ? 'alta' : 'baixa';
      (ladoAcima === lado ? votos : contra).push('EMA ' + f.nome);
    } catch (e) { }
  }
  return { votos, contra, forca: votos.length };
}

function ler(p, padrao) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return padrao; }
}

function arquivos(t) {
  return {
    estado: `${PASTA}/robopapel_estado${t.sufixo}.json`,
    historico: `${PASTA}/robopapel_historico${t.sufixo}.json`
  };
}

async function okx(ativo, barra) {
  const u = `https://www.okx.com/api/v5/market/candles?instId=${ativo}&bar=${barra}&limit=300`;
  const r = await fetch(u, { headers: { 'User-Agent': 'atlas-robo' } });
  if (!r.ok) throw new Error('okx ' + r.status);
  const d = await r.json();
  if (!Array.isArray(d.data) || !d.data.length) throw new Error('okx vazio');
  return d.data.map(x => velinha(Math.floor(+x[0] / 1000), x[1], x[2], x[3], x[4]));
}

async function coinbase(ativo, gran) {
  const u = `https://api.exchange.coinbase.com/products/${ativo.replace('USDT', 'USD')}/candles?granularity=${gran}&limit=300`;
  const r = await fetch(u, { headers: { 'User-Agent': 'atlas-robo' } });
  if (!r.ok) throw new Error('coinbase ' + r.status);
  const d = await r.json();
  return d.map(x => velinha(x[0], x[3], x[2], x[1], x[4]));
}

async function velas(t) {
  try { return await okx(ATIVO, t.okx); }
  catch (e) { return await coinbase(ATIVO, t.coinbase); }
}

function velinha(time, o, h, l, c) {
  return { time: +time, open: +o, high: +h, low: +l, close: +c, o: +o, h: +h, l: +l, c: +c };
}

function r2(v) { return Math.round(v * 100) / 100; }

export async function rodarRobo(temporada = TEMPORADAS[0]) {
  const t = temporada;
  const f = arquivos(t);
  mkdirSync(PASTA, { recursive: true });
  mkdirSync(PUBLICADO, { recursive: true });

  const cs = (await velas(t)).sort((a, b) => a.time - b.time);
  const fechadas = cs.slice(0, -1);
  const preco = cs[cs.length - 1].close;
  const plano = trailingStop(fechadas, { mult: temporada.mult || 2.5 });
  if (!plano) { console.error(t.barra + ': historico curto'); return { barra: t.barra, erro: 'historico curto' }; }

  const est = plano.estado;
  const agora = new Date().toISOString();
  const estado = ler(f.estado, { aberta: null, atualizado_em: null, versao: 3, ultimo_lado: null });
  const historico = ler(f.historico, { fechadas: [] });
  const acoes = [];

  const fecharPrincipal = (o, preco_saida, motivo) => {
    const sinal = o.lado === 'compra' ? 1 : -1;
    const dist = Math.abs(o.entrada - o.stop);
    const r = ((preco_saida - o.entrada) * sinal) / dist;
    
    let resultadoTravasUsd = 0;
    if (o.travas && Array.isArray(o.travas)) {
      for (const trav of o.travas) {
        if (trav.estado === 'aberta') {
          const sinalTrav = trav.lado === 'compra' ? 1 : -1;
          trav.preco_saida = r2(preco_saida);
          trav.resultado_usd = r2((preco_saida - trav.entrada) * sinalTrav * trav.tamanho);
          trav.estado = 'fechada_com_principal';
        }
        resultadoTravasUsd += (trav.resultado_usd || 0);
      }
    }

    const usdPrincipal = (preco_saida - o.entrada) * sinal * o.tamanho;
    const usdTotal = usdPrincipal + resultadoTravasUsd;
    const rTotal = r + (resultadoTravasUsd / (dist * o.tamanho));

    const fechada = { 
      ...o, 
      estado: 'fechada', 
      preco_saida: r2(preco_saida), 
      motivo_fechamento: motivo,
      resultado_r: Math.round(rTotal * 1000) / 1000, 
      resultado_usd: r2(usdTotal), 
      fechada_em: agora 
    };
    historico.fechadas.unshift(fechada);
    historico.fechadas = historico.fechadas.slice(0, 300);
    acoes.push({ tipo: 'fechou', motivo, resultado_r: fechada.resultado_r, resultado_usd: fechada.resultado_usd });
    estado.ultimo_lado = o.lado;
    return fechada;
  };

  if (estado.aberta) {
    const o = estado.aberta;
    const sinal = o.lado === 'compra' ? 1 : -1;
    const dist = Math.abs(o.entrada - o.stop);

    if (!o.travas) o.travas = [];
    for (let i = 0; i < NIVEIS_TRAVA.length; i++) {
      const nivelR = NIVEIS_TRAVA[i];
      const precoAlvoTrava = o.lado === 'compra' ? o.entrada + (nivelR * dist) : o.entrada - (nivelR * dist);
      
      const jaExiste = o.travas.some(tr => tr.nivel === i);
      const atingiuNivel = sinal > 0 ? preco >= precoAlvoTrava : preco <= precoAlvoTrava;

      if (!jaExiste && atingiuNivel) {
        const ladoTrava = o.lado === 'compra' ? 'venda' : 'compra';
        const entradaTrava = r2(precoAlvoTrava);
        const tamanhoTrava = r2(o.tamanho * FATOR_TRAVA);
        const distR = dist;
        const alvoTrava = ladoTrava === 'compra' ? r2(entradaTrava + ALVO_TRAVA_R * distR) : r2(entradaTrava - ALVO_TRAVA_R * distR);
        const corteTrava = ladoTrava === 'compra' ? r2(entradaTrava - CORTE_TRAVA_R * distR) : r2(entradaTrava + CORTE_TRAVA_R * distR);

        o.travas.push({
          nivel: i,
          lado: ladoTrava,
          entrada: entradaTrava,
          tamanho: tamanhoTrava,
          alvo: alvoTrava,
          corte: corteTrava,
          estado: 'aberta'
        });
        acoes.push({ tipo: 'trava_abriu', nivel: i + 1, lado: ladoTrava, entrada: entradaTrava });
      }
    }

    for (const trav of o.travas) {
      if (trav.estado === 'aberta') {
        const sinalTrav = trav.lado === 'compra' ? 1 : -1;
        const bateuAlvoTrav = sinalTrav > 0 ? preco >= trav.alvo : preco <= trav.alvo;
        const bateuCorteTrav = sinalTrav > 0 ? preco <= trav.corte : preco >= trav.corte;

        if (bateuAlvoTrav) {
          trav.estado = 'alvo';
          trav.preco_saida = trav.alvo;
          trav.resultado_usd = r2((trav.alvo - trav.entrada) * sinalTrav * trav.tamanho);
          acoes.push({ tipo: 'trava_alvo', nivel: trav.nivel + 1, resultado_usd: trav.resultado_usd });
        } else if (bateuCorteTrav) {
          trav.estado = 'corte';
          trav.preco_saida = trav.corte;
          trav.resultado_usd = r2((trav.corte - trav.entrada) * sinalTrav * trav.tamanho);
          acoes.push({ tipo: 'trava_corte', nivel: trav.nivel + 1, resultado_usd: trav.resultado_usd });
        }
      }
    }

    const bateuStop = sinal > 0 ? preco <= o.stop : preco >= o.stop;
    const bateuAlvo = sinal > 0 ? preco >= o.alvo : preco <= o.alvo;
    const virou = est.lado !== (o.lado === 'compra' ? 'alta' : 'baixa');

    if (bateuStop) { fecharPrincipal(o, o.stop, 'stop'); estado.aberta = null; }
    else if (bateuAlvo) { fecharPrincipal(o, o.alvo, 'alvo'); estado.aberta = null; }
    else if (virou) { fecharPrincipal(o, preco, 'virada de lado'); estado.aberta = null; }
    else { estado.aberta.preco_mercado = r2(preco); }
  }

  if (!estado.aberta) {
    const lado = est.lado === 'alta' ? 'compra' : 'venda';
    const entrada = r2(preco);
    const stop0 = r2(est.stop);
    const dist = Math.abs(entrada - stop0);
    const folga = entrada > 0 ? dist / entrada * 100 : 0;
    if (temporada.micro) {
      const v = await votosDaCamadaAcima(t.barra, est.lado);
      estado.confluencia = { forca: v.forca, votos: v.votos, contra: v.contra };
      if (v.forca < 1) acoes.push({ tipo: 'aguardando', motivo: 'sem confluencia da camada de cima: ' + lado + ' isolado' });
    }
    if (estado.ultimo_lado === lado) {
      acoes.push({ tipo: 'aguardando', motivo: `mesmo lado da última saída (${lado}); só reabre na virada` });
    } else if (temporada.micro && (estado.confluencia || {}).forca < 1) {
      acoes.push({ tipo: 'aguardando', motivo: 'confluencia insuficiente: espera a camada de cima concordar' });
    } else if (folga < (temporada.folga ?? DIST_MIN_PCT)) {
      acoes.push({ tipo: 'aguardando', motivo: `stop apertado: ${folga.toFixed(2)}% < ${temporada.folga ?? DIST_MIN_PCT}%` });
    } else {
      const dim = dimensionar({ equity: EQUITY, entrada, stop: stop0, riscoPct: RISCO_PCT, valorPorPonto: 1 });
      if (!dim || !dim.ok) {
        acoes.push({ tipo: 'bloqueado', motivo: (dim && dim.motivos || []).join('; ') || 'dimensionamento recusado' });
      } else {
        const alvo = lado === 'compra' ? r2(entrada + ALVO_R * dist) : r2(entrada - ALVO_R * dist);
        const sinal = await assinarSinal({ core: NUCLEO, rules: 'chandelier+escada', params: { atr: 14, mult: 2.5, janela: 22, alvo_r: ALVO_R, dist_min_pct: DIST_MIN_PCT, escada: 'tercos_0.6' },
          ativo: ATIVO, t: fechadas[fechadas.length - 1].time, lado, entrada, stop: stop0, alvo });
        
        estado.aberta = { 
          ativo: ATIVO, 
          timeframe: t.barra, 
          lado, 
          entrada, 
          stop: stop0, 
          alvo,
          tamanho: dim.tamanho, 
          risco_usd: r2(dim.riscoUSD),
          risco_pct: RISCO_PCT, 
          equity: EQUITY, 
          motivo: `abertura na virada com escada de travas (fator 0.6)`,
          nucleo_versao: NUCLEO, 
          hash: sinal.hash, 
          payload_assinado: JSON.stringify(sinal.payload),
          estado: 'aberta', 
          preco_mercado: entrada, 
          aberta_em: agora, 
          modo: 'papel',
          travas: [] 
        };
        acoes.push({ tipo: 'abriu', lado, entrada, stop: stop0, alvo, tamanho: estado.aberta.tamanho });
      }
    }
  }

  estado.acoes = acoes.slice(-4);
  estado.atualizado_em = agora;
  estado.preco = r2(preco);
  estado.timeframe = t.barra;
  estado.filtros = { alvo_r: ALVO_R, dist_min_pct: temporada.folga ?? DIST_MIN_PCT, mult: temporada.mult || 2.5, escada: 'tercos_0.6' };
  estado.estrutura = { lado: est.lado, stop: r2(est.stop), viradas: est.viradas, distancia: r2(est.distancia),
    folga_pct: r2(est.distancia / preco * 100) };
  writeFileSync(f.estado, JSON.stringify(estado, null, 1));

  const venc = historico.fechadas;
  const somaR = venc.reduce((s, o) => s + (o.resultado_r || 0), 0);
  const somaUsd = venc.reduce((s, o) => s + (o.resultado_usd || 0), 0);
  const acertos = venc.filter(o => o.resultado_r > 0).length;
  historico.resumo = { fechadas: venc.length, acerto_pct: venc.length ? Math.round(acertos / venc.length * 1000) / 10 : null,
    resultado_r: Math.round(somaR * 100) / 100, resultado_usd: Math.round(somaUsd * 100) / 100, atualizado_em: agora };
  writeFileSync(f.historico, JSON.stringify(historico, null, 1));

  try {
    writeFileSync(`${PUBLICADO}/robopapel_estado${t.sufixo}.json`, JSON.stringify(estado, null, 1));
    writeFileSync(`${PUBLICADO}/robopapel_historico${t.sufixo}.json`, JSON.stringify(historico, null, 1));
  } catch (e) { console.error('copia publicada falhou:', e.message); }

  const saida = { ok: true, barra: t.barra, preco: r2(preco), estrutura: estado.estrutura, acoes, aberta: estado.aberta && estado.aberta.lado };
  console.log(JSON.stringify(saida, null, 1));
  return saida;
}

export async function rodarTodas() {
  const saidas = [];
  for (const t of TEMPORADAS) {
    try { saidas.push(await rodarRobo(t)); }
    catch (e) { console.error(t.barra + ' falhou:', e.message); saidas.push({ barra: t.barra, erro: e.message }); }
  }
  return saidas;
}

if (process.argv[1] && /robo[\\/]run\.mjs$/.test(process.argv[1])) {
  rodarTodas().catch(e => { console.error('falhou:', e.message); process.exit(1); });
}
