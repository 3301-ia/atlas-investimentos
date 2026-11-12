// Robô do Atlas em modo papel, rodando no GitHub Actions.
//
// Roda fora da Base44 de propósito: não consome crédito de integração nenhum.
// Usa o MESMO núcleo puro do painel (atlas-ui/core), então a assinatura
// SHA-256 daqui é verificável lá, arquivo por arquivo.
//
// Três temporadas rodam no mesmo passo: 1H, 15M e 5M. Cada uma tem seu
// próprio estado e seu próprio histórico.
//
// A cada execução:
//   1. baixa velas fechadas (OKX e, em fallback, Coinbase);
//   2. roda o trailing Chandelier com ATR 14, multiplicador 2,5 e janela 22;
//   3. se existe ordem aberta, confere stop, alvo e virada de lado, e fecha;
//   4. se não existe, abre com tamanho vindo do risco em % do equity, somente
//      quando o lado VIROU e o stop tem folga mínima (o replay mostrou que
//      reentrar no mesmo lado com stop apertado é onde o spread mata);
//   5. grava o estado e o histórico de cada temporada.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { trailingStop, TRAILING_VERSION } from '../atlas-ui/core/trailing.js';
import { dimensionar, RISCO_VERSION } from '../atlas-ui/core/risco.js';
import { assinarSinal } from '../atlas-ui/core/signature.js';

const ATIVO = process.env.ATLAS_ATIVO || 'BTC-USDT';
const EQUITY = Number(process.env.ATLAS_EQUITY || 130);
const RISCO_PCT = Number(process.env.ATLAS_RISCO_PCT || 2);
const ALVO_R = Number(process.env.ATLAS_ALVO_R || 2);
const DIST_MIN_PCT = Number(process.env.ATLAS_DIST_MIN || 1);   // folga mínima do stop em % do preço
const NUCLEO = `trailing ${TRAILING_VERSION} + risco ${RISCO_VERSION}`;

const PASTA = 'observador/historico';
const PUBLICADO = 'atlas-ui/observador/historico';

// temporadas: sufixo do arquivo, código de barra para cada fonte
export const TEMPORADAS = [
  { barra: '1H', sufixo: '', okx: '1H', coinbase: 3600 },
  { barra: '15M', sufixo: '_15m', okx: '15m', coinbase: 900 },
  { barra: '5M', sufixo: '_5m', okx: '5m', coinbase: 300 }
];

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

// o núcleo lê open/high/low/close; a API entrega em outra ordem, então aqui
// tudo passa pelo mesmo formato e nunca mais some candle por nome errado
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
  const plano = trailingStop(fechadas);
  if (!plano) { console.error(t.barra + ': historico curto'); return { barra: t.barra, erro: 'historico curto' }; }

  const est = plano.estado;
  const agora = new Date().toISOString();
  const estado = ler(f.estado, { aberta: null, atualizado_em: null, versao: 2, ultimo_lado: null });
  const historico = ler(f.historico, { fechadas: [] });
  const acoes = [];

  const fechar = (o, preco_saida, motivo) => {
    const sinal = o.lado === 'compra' ? 1 : -1;
    const dist = Math.abs(o.entrada - o.stop);
    const r = ((preco_saida - o.entrada) * sinal) / dist;
    const usd = (preco_saida - o.entrada) * sinal * o.tamanho;
    const fechada = { ...o, estado: 'fechada', preco_saida: r2(preco_saida), motivo_fechamento: motivo,
      resultado_r: Math.round(r * 1000) / 1000, resultado_usd: r2(usd), fechada_em: agora };
    historico.fechadas.unshift(fechada);
    historico.fechadas = historico.fechadas.slice(0, 300);
    acoes.push({ tipo: 'fechou', motivo, resultado_r: fechada.resultado_r, resultado_usd: fechada.resultado_usd });
    estado.ultimo_lado = o.lado;
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
    const dist = Math.abs(entrada - stop0);
    const folga = entrada > 0 ? dist / entrada * 100 : 0;
    if (estado.ultimo_lado === lado) {
      acoes.push({ tipo: 'aguardando', motivo: `mesmo lado da última saída (${lado}); só reabre na virada` });
    } else if (folga < DIST_MIN_PCT) {
      acoes.push({ tipo: 'aguardando', motivo: `stop apertado: ${folga.toFixed(2)}% < ${DIST_MIN_PCT}%` });
    } else {
      const dim = dimensionar({ equity: EQUITY, entrada, stop: stop0, riscoPct: RISCO_PCT, valorPorPonto: 1 });
      if (!dim || !dim.ok) {
        acoes.push({ tipo: 'bloqueado', motivo: (dim && dim.motivos || []).join('; ') || 'dimensionamento recusado' });
      } else {
        const alvo = lado === 'compra' ? r2(entrada + ALVO_R * dist) : r2(entrada - ALVO_R * dist);
        const sinal = await assinarSinal({ core: NUCLEO, rules: 'chandelier', params: { atr: 14, mult: 2.5, janela: 22, alvo_r: ALVO_R, dist_min_pct: DIST_MIN_PCT },
          ativo: ATIVO, t: fechadas[fechadas.length - 1].time, lado, entrada, stop: stop0, alvo });
        estado.aberta = { ativo: ATIVO, timeframe: t.barra, lado, entrada, stop: stop0, alvo,
          tamanho: dim.tamanho, risco_usd: r2(dim.riscoUSD),
          risco_pct: RISCO_PCT, equity: EQUITY, motivo: `abertura na virada: lado ${est.lado}, stop com ${folga.toFixed(2)}% de folga`,
          nucleo_versao: NUCLEO, hash: sinal.hash, payload_assinado: JSON.stringify(sinal.payload),
          estado: 'aberta', preco_mercado: entrada, aberta_em: agora, modo: 'papel' };
        acoes.push({ tipo: 'abriu', lado, entrada, stop: stop0, alvo, tamanho: estado.aberta.tamanho });
      }
    }
  }

  estado.atualizado_em = agora;
  estado.preco = r2(preco);
  estado.timeframe = t.barra;
  estado.filtros = { alvo_r: ALVO_R, dist_min_pct: DIST_MIN_PCT, so_na_virada: true };
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

  // cópia na pasta que o site publica (o repositório é privado)
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

// roda sozinho quando chamado direto na linha de comando
if (process.argv[1] && /robo[\\/]run\.mjs$/.test(process.argv[1])) {
  rodarTodas().catch(e => { console.error('falhou:', e.message); process.exit(1); });
}
