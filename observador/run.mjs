// Observador do Atlas: lê candles, roda o núcleo e grava o mapa assinado.
// Roda no GitHub Actions a cada 10 minutos. Não opera nada, só observa.

import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dynamicPlan } from '../atlas-ui/core/dynamic.js';
import { fiboPlan } from '../atlas-ui/core/fibonacci.js';
import { classificar } from '../atlas-ui/core/padroes.js';
import { quadradoDeNove, ciclosTempo } from '../atlas-ui/core/gann.js';
import { assinarSinal } from '../atlas-ui/core/signature.js';

const DESTINO = process.env.ATLAS_DESTINO ||
  'https://romerito-agente-9f88b64a.base44.app/functions/mapaReceber?t=observador-atlas-2026';
const ATIVOS = (process.env.ATLAS_ATIVOS || 'BTC-USD,ETH-USD').split(',').map(s => s.trim()).filter(Boolean);
const TEMPOS = (process.env.ATLAS_TEMPOS || '300,900,3600').split(',').map(Number).filter(n => n >= 60);

async function candles(ativo, gran) {
  const r = await fetch(`https://api.exchange.coinbase.com/products/${ativo}/candles?granularity=${gran}&limit=300`);
  if (!r.ok) return [];
  const a = await r.json();
  if (!Array.isArray(a)) return [];
  return a.map(k => ({ t: k[0] * 1000, o: +k[3], h: +k[2], l: +k[1], c: +k[4], v: +k[5] }))
    .sort((x, y) => x.t - y.t);
}

function montar(ativo, gran, cs) {
  const fechadas = cs.slice(0, -1);
  const preco = cs[cs.length - 1].c;
  if (fechadas.length < 30) return { ativo, tempo: gran, preco, estado: 'historico_curto' };

  const d = dynamicPlan(fechadas);
  const f = fiboPlan(fechadas);
  const p = classificar(fechadas, {});
  const q = quadradoDeNove(preco);
  const g = ciclosTempo(new Date(Date.now() - 45 * 864e5), new Date());

  return {
    ativo, tempo: gran, preco,
    lado: d?.lado || '', entrada: d?.entrada || 0, stop: d?.stopAtual || 0,
    alvo: d?.alvos ? d.alvos[Math.min(d.alvoAtivo ?? 0, 2)] : 0,
    estado: d?.estado || '', resultado_r: d?.resultadoR ?? 0,
    figura: p?.figura || '', confianca: p?.confianca ?? 0,
    graus_topo: p?.graus?.topo ?? 0, graus_fundo: p?.graus?.fundo ?? 0,
    rompimento: p?.rompimento || '',
    fib_lado: f?.lado || '', fib_nivel: f?.alvoAtivo != null ? String(f.niveis?.[f.alvoAtivo]?.k ?? '') : '',
    fib_alvo: f?.alvoAtual || 0,
    gann_acima: q?.acima?.[0] ?? 0, gann_abaixo: q?.abaixo?.[0] ?? 0,
    ciclo_dias: g?.proximo?.dias ?? 0,
    escala: d?.risco ? +d.risco.toFixed(4) : 0,
  };
}

const mapas = [];
for (const ativo of ATIVOS) {
  for (const gran of TEMPOS) {
    try {
      const cs = await candles(ativo, gran);
      if (!cs.length) { console.log(`${ativo} ${gran}s sem dados`); continue; }
      const m = montar(ativo, gran, cs);
      const s = await assinarSinal({ ...m, versao: 'observador-1.0.0' });
      m.hash = s.hash;
      m.assinado_em = new Date().toISOString();
      mapas.push(m);
      console.log(`${ativo} ${gran}s ${m.estado} ${m.lado || '-'} fig=${m.figura || '-'} hash=${String(m.hash).slice(0, 12)}`);
    } catch (e) {
      console.log(`${ativo} ${gran}s erro: ${String(e).slice(0, 120)}`);
    }
  }
}

if (!mapas.length) { console.log('nada para gravar'); process.exit(0); }

// Gravação principal: arquivo no próprio repositório, um JSON por linha.
// Não depende de crédito de integração e guarda o histórico assinado.
const dia = new Date().toISOString().slice(0, 10);
mkdirSync('observador/historico', { recursive: true });
const arquivo = `observador/historico/${dia}.jsonl`;
let gravados = 0;
for (const m of mapas) {
  const jaTem = existsSync(arquivo) && readFileSync(arquivo, 'utf8').includes(m.hash);
  if (jaTem) continue;
  appendFileSync(arquivo, JSON.stringify(m) + '\n');
  gravados++;
}
console.log(`gravados ${gravados} de ${mapas.length} em ${arquivo}`);

// Envio opcional para a Base44, quando os créditos de integração permitirem.
if (process.env.ATLAS_ENVIAR === '1') {
  const r = await fetch(DESTINO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapas }),
  });
  console.log('envio base44:', r.status, (await r.text()).slice(0, 200));
}

// Robô em modo papel, no mesmo passo do observador.
// Roda de graça aqui: o resultado vira JSON dentro de observador/historico,
// o workflow já existente commita essa pasta e o Render publica. Nenhuma
// chamada à Base44, portanto nenhum crédito de integração.
try {
  const { rodarRobo } = await import('../robo/run.mjs');
  await rodarRobo();
  console.log('robô papel: ok');
} catch (e) {
  console.error('robô papel falhou:', e.message);
}
