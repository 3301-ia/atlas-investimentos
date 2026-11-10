// Teste de tela da Central de Alertas, em DOM de verdade (jsdom).
// Roda com: node core/test-tela.mjs   (precisa de jsdom no ambiente)
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as CORE from './alertas.js';

const fonte = fs.readFileSync(new URL('../alerta-central.js', import.meta.url), 'utf8');

// série com perna bem definida: fundo antes do topo
const candles = [];
let c = 90;
for (let i = 0; i < 60; i++) {
  c += Math.sin(i / 6) * 1.6 + (i > 30 ? 0.35 : -0.2);
  candles.push({ time: 1700000000 + i * 60, open: c - 0.4, high: c + 0.9, low: c - 0.9, close: c });
}

const dom = new JSDOM(`<!doctype html><html><body>
  <div class="side-nav-top"><div class="nav-item" id="nav-alerts"><span class="nav-icon">🔔</span><span class="nav-lbl">Alertas</span></div></div>
  <span id="rt-price">$100.00</span>
</body></html>`, { runScripts: 'outside-only', url: 'https://atlas.local/' });

const w = dom.window;
w.AtlasAlertasCore = CORE;
w.candleSeries = { data: () => candles };
w.updatePriceUI = function (p) {
  w.document.getElementById('rt-price').textContent = '$' + p.toFixed(2);
};

const dormir = ms => new Promise(r => setTimeout(r, ms));
let ok = 0;
const t = (nome) => { ok++; console.log('  ok  ' + nome); };
const $ = sel => w.document.querySelector(sel);
const $$ = sel => w.document.querySelectorAll(sel);

w.eval(fonte);
// no jsdom o documento fica em 'loading': o painel espera este evento
w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
await dormir(60);

{
  const ov = w.document.getElementById('acOv');
  assert.ok(ov, 'overlay existe');
  assert.equal(ov.classList.contains('on'), false);
  w.atlasAbrirAlertas();
  assert.equal(ov.classList.contains('on'), true);
  t('painel monta fechado e abre pela navegação');
}

{
  const abas = $$('.ac-tabs button');
  assert.equal(abas.length, 3);
  abas[1].click();
  assert.ok($('#acForm select[data-f="nivel"]'), 'fib tem seletor de nível');
  assert.ok($('#acForm select[data-f="swing"]'));
  abas[2].click();
  assert.ok($('#acForm input[data-f="valor"]'), 'preço tem campo');
  assert.ok(w.document.getElementById('ac-css').textContent.includes('font-size:16px'));
  t('abas trocam e cada uma traz seu formulário');
}

w.updatePriceUI(100);
w.AtlasAlertas.armarPreco(105, 'acima');
await dormir(60);
{
  assert.equal($$('.ac-item').length, 1);
  assert.equal(w.document.getElementById('acCount').textContent, '1');
  assert.equal($$('.ac-log-l').length, 0, 'nada no histórico ainda');
  t('armar alerta de preço cria o item e não nasce disparado');
}

w.updatePriceUI(104);
await dormir(850);
{
  assert.equal($$('.ac-log-l').length, 0, 'abaixo do alvo não dispara');
  assert.ok(w.document.getElementById('acList').textContent.includes('alvo 105.00'));
  t('preço abaixo do alvo não dispara');
}

w.updatePriceUI(106);
await dormir(900);
{
  const linhas = $$('.ac-log-l');
  assert.equal(linhas.length, 1, 'uma linha no histórico');
  assert.ok(linhas[0].textContent.includes('rompeu acima'));
  assert.ok($('.ac-toast'), 'aviso na tela');
  const bruto = w.localStorage.getItem('atlas.alertas.v1');
  assert.ok(bruto && bruto.includes('preco'), 'guardou na memória local');
  t('cruzou o alvo: dispara, registra no histórico e mostra o aviso');
}

w.updatePriceUI(106.4);
await dormir(850);
{
  assert.equal($$('.ac-log-l').length, 1, 'não repete no mesmo movimento');
  t('não repete no mesmo movimento');
}

{
  $('.ac-item [data-acao="pausar"]').click();
  assert.equal($$('.ac-item.off').length, 1);
  t('pausar desliga o item sem apagar');
}

{
  $('.ac-item [data-acao="rearmar"]').click();
  assert.ok($('#acList').textContent.includes('armado'));
  t('rearmar volta o item para armado');
}

{
  $('.ac-item [data-acao="excluir"]').click();
  assert.equal($$('.ac-item').length, 0);
  assert.equal(w.document.getElementById('acCount').textContent, '0');
  t('excluir remove da lista');
}

{
  $$('.ac-tabs button')[1].click();
  const sel = $('#acForm select[data-f="nivel"]');
  sel.value = '0.618';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  const leitura = w.document.getElementById('acLeituraFib').textContent;
  assert.ok(/n[íi]vel 0\.618 = /.test(leitura), 'mostra o preço do nível: ' + leitura);
  $('#acForm [data-acao="armar"]').click();
  assert.equal($$('.ac-item').length, 1);
  assert.ok(w.document.getElementById('acList').textContent.includes('Fib 0.618'));
  t('alerta de fib usa o nível do swing e mostra o alvo');
}

{
  $$('.ac-tabs button')[0].click();
  const leitura = w.document.getElementById('acLeituraMa').textContent;
  assert.ok(leitura.includes('EMA9'), 'leitura: ' + leitura);
  $('#acForm [data-acao="armar"]').click();
  assert.ok(w.document.getElementById('acList').textContent.includes('Média 9/18'));
  t('alerta de média arma e informa as duas EMAs');
}

{
  w.document.getElementById('acMotor').click();
  assert.equal(w.document.getElementById('acMotor').classList.contains('on'), false);
  assert.ok(w.document.getElementById('acLive').textContent.includes('MOTOR OFF'));
  w.document.getElementById('acMotor').click();
  assert.ok(w.document.getElementById('acLive').textContent.includes('MOTOR ON'));
  t('motor liga e desliga pela barra do topo');
}

{
  w.document.getElementById('acSom').click();
  assert.equal(w.document.getElementById('acSom').textContent, '🔇');
  w.document.getElementById('acSom').click();
  assert.equal(w.document.getElementById('acSom').textContent, '🔊');
  t('som alterna entre ligado e mudo');
}

console.log('\n' + ok + ' verificações de tela passaram');
process.exit(0);
