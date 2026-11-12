// Robô do Atlas em modo papel, rodando no GitHub Actions.
//
// Roda fora da Base44 de propósito: não consome crédito de integração nenhum.
// Usa o MESMO núcleo puro do painel (atlas-ui/core), então a assinatura
// SHA-256 daqui é verificável lá, arquivo por arquivo.
//
// A cada execução:
//   1. baixa velas de 1H (OKX e, em fallback, Coinbase);
//   2. roda o trailing Chandelier com ATR 14, multiplicador 2,5 e janela 22;
//   3. se existe ordem aberta, confere stop, alvo e virada de lado, e fecha;
//   4. se não existe, abre com tamanho vindo do risco em % do equity;
//   5. grava robo/estado.json (ordem aberta) e robo/historico.json (fechadas).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { trailingStop, TRAILING_VERSION } from '../atlas-ui/core/trailing.js';
import { dimensionar, RISCO_VERSION } from '../atlas-ui/core/risco.js';
import { assinarSinal } from '../atlas-ui/core/signature.js';

const ATIVO = process.env.ATLAS_ATIVO || 'BTC-USDT';
const BARRA = process.env.ATLAS_BARRA || '1H';
const EQUITY = Number(process.env.ATLAS_EQUITY || 130);
const RISCO_PCT = Number(process.env.ATLAS_RISCO_PCT || 2);
const ALVO_R = Number(process.env.ATLAS_ALVO_R || 2);
const ESTADO = 'observador/historico/robopapel_estado.json';
const HISTORICO = 'observador/historico/robopapel_historico.json';
const NUCLEO = `trailing ${TRAILING_VERSION} + risco ${RISCO_VERSION}`;

function ler(p, padrao) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return padrao; }
}

async function okx(ativo, barra) {
  const inst = ativo.replace('-', '-');
  const u = `https://www.okx.com/api/v5/market/candles?instId=${inst}&bar=${barra}&limit=300`;
  const r = await fetch(u, { headers: { 'User-Agent': 'atlas-robo' } });
  if (!r.ok) throw new Error('okx ' + r.status);
  const d = await r.json();
  if (!Array.isArray(d.data) || !d.data.length) throw new Error('okx vazio');
  return d.data.map(x => velinha(Math.floor(+x[0] / 1000), x[1], x[2], x[3], x[4]));
}

async function coinbase(ativo, barra) {
  const par = ativo.replace('-', '-');
  const gran = barra === '1H' ? 3600 : barra === '4H' ? 21600 : 900;
  const u = `https://api.exchange.coinbase.com/products/${par}/candles?granularity=${gran}&limit=300`;
  const r = await fetch(u, { headers: { 'User-Agent': 'atlas-robo' } });
  if (!r.ok) throw new Error('coinbase ' + r.status);
  const d = await r.json();
  return d.map(x => velinha(x[0], x[3], x[2], x[1], x[4]));
}

async function velas() {
  try { return await okx(ATIVO, BARRA); }
  catch (e) { return await coinbase(ATIVO, BARRA); }
}

// o nucleo le open/high/low/close; a API entrega em outra ordem, entao aqui
// tudo passa pelo mesmo formato e nunca mais some candle por nome errado
function velinha(time, o, h, l, c) {
  return { time: +time, open: +o, high: +h, low: +l, close: +c, o: +o, h: +h, l: +l, c: +c };
}

function r2(v) { return Math.round(v * 100) / 100; }

async function main() {
  const cs = (await velas()).sort((a, b) => a.time - b.time);
  const fechadas = cs.slice(0, -1);
  const preco = cs[cs.length - 1].close;
  const plano = trailingStop(fechadas);
  if (!plano) { console.error('historico curto'); process.exit(0); }

  const est = plano.estado;
  const agora = new Date().toISOString();
  const estado = ler(ESTADO, { aberta: null, atualizado_em: null, versao: 1 });
  const historico = ler(HISTORICO, { fechadas: [] });
  const acoes = [];

  const fechar = (o, preco_saida, motivo) => {
    const sinal = o.lado === 'compra' ? 1 : -1;
    const dist = Math.abs(o.entrada - o.stop);
    const r = ((preco_saida - o.entrada) * sinal) / dist;
    const usd = (preco_saida - o.entrada) * sinal * o.tamanho;
    const fechada = { ...o, estado: 'fechada', preco_saida: r2(preco_saida), motivo_fechamento: motivo,
      resultado_r: Math.round(r * 1000) / 1000, resultado_usd: r2(usd), fechada_em: agora };
    historico.fechadas.unshift(fechada);
    historico.fechadas = historico.fechadas.slice(0, 200);
    acoes.push({ tipo: 'fechou', motivo, resultado_r: fechada.resultado_r, resultado_usd: fechada.resultado_usd });
    return fechada;
  };

  if (estado.aberta) {
    const o = estado.aberta;
    const sinal = o.lado === 'compra' ? 1 : -1;
    const bateuStop = sinal > 0 ? preco <= o.stop : preco >= o.stop;
    const bateuAlvo = sinal > 0 ? preco >= o.alvo : preco <= o.alvo;
    const virou = est.lado !== (o.lado === 'compra' ? 'alta' : 'baixa');
    if (bateuStop) { fechar(o, o.stop, 'stop'); estado.aberta = null; }
    else if (bateuAlvo) { fechar(o, o.alvo, 'alvo'); estado.aberta = null; }
    else if (virou) { fechar(o, preco, 'virada de lado'); estado.aberta = null; }
    else { estado.aberta.preco_mercado = r2(preco); }
  }

  if (!estado.aberta) {
    const lado = est.lado === 'alta' ? 'compra' : 'venda';
    const entrada = r2(preco);
    const stop0 = r2(est.stop);
    const dim = dimensionar({ equity: EQUITY, entrada, stop: stop0, riscoPct: RISCO_PCT, valorPorPonto: 1 });
    if (!dim || !dim.ok) {
      acoes.push({ tipo: 'bloqueado', motivo: (dim && dim.motivos || []).join('; ') || 'dimensionamento recusado' });
    } else {
      const dist = Math.abs(entrada - stop0);
      const alvo = lado === 'compra' ? r2(entrada + ALVO_R * dist) : r2(entrada - ALVO_R * dist);
      const sinal = await assinarSinal({ core: NUCLEO, rules: 'chandelier', params: { atr: 14, mult: 2.5, janela: 22, alvo_r: ALVO_R },
        ativo: ATIVO, t: fechadas[fechadas.length - 1].time, lado, entrada, stop: stop0, alvo });
      estado.aberta = { ativo: ATIVO, timeframe: BARRA, lado, entrada, stop: stop0, alvo,
        tamanho: dim.tamanho, risco_usd: r2(dim.riscoUSD),
        risco_pct: RISCO_PCT, equity: EQUITY, motivo: `abertura pela estrutura: lado ${est.lado} com stop no trailing`,
        nucleo_versao: NUCLEO, hash: sinal.hash, payload_assinado: JSON.stringify(sinal.payload),
        estado: 'aberta', preco_mercado: entrada, aberta_em: agora, modo: 'papel' };
      acoes.push({ tipo: 'abriu', lado, entrada, stop: stop0, alvo, tamanho: estado.aberta.tamanho });
    }
  }

  estado.atualizado_em = agora;
  estado.preco = r2(preco);
  estado.estrutura = { lado: est.lado, stop: r2(est.stop), viradas: est.viradas, distancia: r2(est.distancia) };
  mkdirSync('observador/historico', { recursive: true });
  writeFileSync(ESTADO, JSON.stringify(estado, null, 1));
  const venc = historico.fechadas;
  const somaR = venc.reduce((s, o) => s + (o.resultado_r || 0), 0);
  const somaUsd = venc.reduce((s, o) => s + (o.resultado_usd || 0), 0);
  const acertos = venc.filter(o => o.resultado_r > 0).length;
  historico.resumo = { fechadas: venc.length, acerto_pct: venc.length ? Math.round(acertos / venc.length * 1000) / 10 : null,
    resultado_r: Math.round(somaR * 100) / 100, resultado_usd: Math.round(somaUsd * 100) / 100, atualizado_em: agora };
  writeFileSync(HISTORICO, JSON.stringify(historico, null, 1));
  console.log(JSON.stringify({ ok: true, preco: r2(preco), estrutura: estado.estrutura, acoes, aberta: estado.aberta && estado.aberta.lado }, null, 1));
}

export async function rodarRobo() { return main(); }

// roda sozinho quando chamado direto na linha de comando
if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  main().catch(e => { console.error('falhou:', e.message); process.exit(1); });
}
