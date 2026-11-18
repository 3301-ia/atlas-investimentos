/* VECTRA · Ω-Score
 *
 * Indicador próprio, inspirado na leitura do Omega Score: um termômetro de 0 a
 * 100 do "calor" do mercado, desenhado sobre o preço em escala logarítmica.
 *
 * A fórmula é aberta e só usa dado de preço, porque é o que a casa tem sem
 * assinatura: alongamento do preço contra a média de 50 e de 200 dias, RSI 14
 * diário, queda desde a máxima de 90 dias e volatilidade realizada de 30 dias.
 * Cada componente vira 0 a 100 e o Ω é a média ponderada. Zero é mercado frio,
 * cem é sobreaquecido. On-chain (MVRV, funding, lucro realizado) entra depois,
 * quando houver fonte assinada.
 */
(function () {
  const ID = 'omega-overlay';
  const CORES = { frio: '#3d7bff', neutro: '#26a69a', aquecendo: '#f0b90b', quente: '#ef5350' };

  function el(tag, css, html) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    return e;
  }

  async function velasDiarias(simbolo) {
    const par = simbolo.replace('USDT', '-USD');
    const r = await fetch(`https://api.exchange.coinbase.com/products/${par}/candles?granularity=86400&limit=300`, { headers: { 'User-Agent': 'vectra' } });
    if (!r.ok) throw new Error('fonte ' + r.status);
    const j = await r.json();
    return j.sort((a, b) => a[0] - b[0]).map((c) => ({ time: c[0], open: c[3], high: c[2], low: c[1], close: c[4] }));
  }

  const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  function ema(v, n) {
    const a = 2 / (n + 1); let e = media(v.slice(0, n)); const out = new Array(v.length).fill(null);
    out[n - 1] = e;
    for (let i = n; i < v.length; i++) { e = v[i] * a + e * (1 - a); out[i] = e; }
    return out;
  }
  function rsi(v, n = 14) {
    const out = new Array(v.length).fill(null);
    for (let i = n; i < v.length; i++) {
      let g = 0, p = 0;
      for (let k = i - n + 1; k <= i; k++) { const d = v[k] - v[k - 1]; if (d > 0) g += d; else p -= d; }
      g /= n; p /= n;
      out[i] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
    }
    return out;
  }
  const limite = (x) => Math.max(0, Math.min(100, x));

  function omega(closes) {
    const e50 = ema(closes, 50), e200 = ema(closes, 200), r = rsi(closes, 14);
    const out = [];
    for (let i = 0; i < closes.length; i++) {
      if (e200[i] == null || r[i] == null) { out.push(null); continue; }
      const alonga200 = ((closes[i] - e200[i]) / e200[i]) * 100;   // quanto acima da 200
      const alonga50 = ((closes[i] - e50[i]) / e50[i]) * 100;
      const janela = closes.slice(Math.max(0, i - 90), i + 1);
      const maxima = Math.max(...janela);
      const queda = ((maxima - closes[i]) / maxima) * 100;          // queda desde a máxima
      const vol30 = (() => {
        const s = closes.slice(Math.max(1, i - 30), i + 1);
        const ret = s.slice(1).map((x, k) => Math.log(x / s[k]));
        const m = media(ret);
        return Math.sqrt(media(ret.map((x) => (x - m) ** 2))) * 100;
      })();
      const c1 = limite(50 + alonga200 * 1.6);     // alongamento longo
      const c2 = limite(50 + alonga50 * 3.0);      // alongamento curto
      const c3 = limite(r[i]);                     // RSI
      const c4 = limite(100 - queda * 3.2);        // perto da máxima = quente
      const c5 = limite(vol30 * 28);               // volatilidade
      const score = c1 * 0.3 + c2 * 0.2 + c3 * 0.25 + c4 * 0.15 + c5 * 0.1;
      out.push({ i, score: Math.round(score), partes: { c1, c2, c3, c4, c5 } });
    }
    return out;
  }

  const faixa = (s) => (s < 20 ? 'frio' : s < 45 ? 'neutro' : s < 70 ? 'aquecendo' : 'quente');
  const nomeFaixa = { frio: 'FRIO', neutro: 'NEUTRO', aquecendo: 'AQUECENDO', quente: 'SOBREAQUECIDO' };

  function montar() {
    if (document.getElementById(ID)) return document.getElementById(ID);
    const caixa = el('div', `position:fixed;inset:0;z-index:9999;background:rgba(10,13,20,.97);display:none;flex-direction:column;font-family:Inter,system-ui,sans-serif;color:#dfe3ea`);
    caixa.id = ID;
    caixa.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid #242935">
        <b style="font-size:12px;letter-spacing:.18em">Ω-SCORE · VECTRA</b>
        <span id="om-sym" style="font-size:11px;color:#7c8496">--</span>
        <span id="om-valor" style="font-size:20px;font-weight:600">--</span>
        <span id="om-faixa" style="font-size:10px;letter-spacing:.16em;padding:3px 8px;border-radius:3px;border:1px solid #242935">--</span>
        <span style="margin-left:auto;font-size:10px;color:#7c8496">alongamento 50/200 · RSI 14 · queda da máxima · volatilidade 30d</span>
        <button id="om-fechar" style="background:transparent;border:1px solid #242935;color:#dfe3ea;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:10px">Fechar</button>
      </div>
      <div style="display:flex;gap:18px;padding:10px 16px;font-size:10px;color:#7c8496;border-bottom:1px solid #242935">
        <span><i style="display:inline-block;width:8px;height:8px;background:${CORES.frio};border-radius:2px;margin-right:6px"></i>FRIO</span>
        <span><i style="display:inline-block;width:8px;height:8px;background:${CORES.neutro};border-radius:2px;margin-right:6px"></i>NEUTRO</span>
        <span><i style="display:inline-block;width:8px;height:8px;background:${CORES.aquecendo};border-radius:2px;margin-right:6px"></i>AQUECENDO</span>
        <span><i style="display:inline-block;width:8px;height:8px;background:${CORES.quente};border-radius:2px;margin-right:6px"></i>SOBREAQUECIDO</span>
        <span id="om-partes" style="margin-left:auto"></span>
        <span id="om-alcance" style="display:flex;gap:6px"></span>
      </div>
      <div id="om-chart" style="flex:1;min-height:0"></div>`;
    document.body.appendChild(caixa);
    caixa.querySelector('#om-fechar').onclick = () => { caixa.style.display = 'none'; };
    return caixa;
  }

  let grafico = null;
  async function abrir() {
    const caixa = montar();
    caixa.style.display = 'flex';
    const simbolo = (typeof currentSym !== 'undefined' ? currentSym : 'BTCUSDT');
    caixa.querySelector('#om-sym').textContent = simbolo.replace('USDT', '') + ' · 1D';
    try {
      const velas = await velasDiarias(simbolo);
      const closes = velas.map((v) => v.close);
      const serie = omega(closes);
      const ultimo = [...serie].reverse().find((x) => x);
      const f = faixa(ultimo.score);
      const valor = caixa.querySelector('#om-valor');
      valor.textContent = ultimo.score;
      valor.style.color = CORES[f];
      const selo = caixa.querySelector('#om-faixa');
      selo.textContent = nomeFaixa[f];
      selo.style.color = CORES[f];
      selo.style.borderColor = CORES[f] + '66';
      caixa.querySelector('#om-partes').textContent =
        `along.200 ${ultimo.partes.c1.toFixed(0)} · along.50 ${ultimo.partes.c2.toFixed(0)} · rsi ${ultimo.partes.c3.toFixed(0)} · máxima ${ultimo.partes.c4.toFixed(0)} · vol ${ultimo.partes.c5.toFixed(0)}`;

      const alvo = caixa.querySelector('#om-chart');
      if (grafico) { grafico.remove(); grafico = null; }
      alvo.innerHTML = '';
      const LW = window.LightweightCharts;
      grafico = LW.createChart(alvo, {
        width: alvo.clientWidth, height: alvo.clientHeight,
        layout: { background: { color: 'transparent' }, textColor: '#7c8496', fontSize: 10 },
        grid: { vertLines: { color: '#1b2028' }, horzLines: { color: '#1b2028' } },
        rightPriceScale: { borderColor: '#242935' },
        leftPriceScale: { visible: true, borderColor: '#242935', scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { borderColor: '#242935', timeVisible: false },
        crosshair: { vertLine: { color: '#3a4152' }, horzLine: { color: '#3a4152' } },
      });
      const preco = grafico.addLineSeries({ color: 'rgba(223,227,234,.55)', lineWidth: 1, priceScaleId: 'right', priceLineVisible: false, lastValueVisible: false });
      preco.setData(velas.map((v) => ({ time: v.time, value: v.close })));

      const pontos = serie.filter((x) => x).map((x) => ({ time: velas[x.i].time, value: x.score, color: CORES[faixa(x.score)] }));
      const linha = grafico.addLineSeries({ lineWidth: 2, priceScaleId: 'left', priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true });
      linha.setData(pontos);
      // faixas com nome, como as linhas de referência do original
      [[0, 'FRIO'], [20, 'neutro'], [45, 'aquecendo'], [70, 'sobreaquecido'], [100, '']].forEach(([n, titulo]) => {
        if (!titulo) return;
        linha.createPriceLine({ price: n, color: '#2b3140', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: titulo });
      });
      // ponto de agora, com o mesmo destaque da leitura de referência
      const ultimoPonto = pontos[pontos.length - 1];
      if (ultimoPonto) {
        linha.setMarkers([{ time: ultimoPonto.time, position: 'inCircle', color: CORES[f], shape: 'circle', text: '' }]);
        preco.setMarkers([{ time: velas[velas.length - 1].time, position: 'inCircle', color: '#3d7bff', shape: 'circle', text: '' }]);
      }
      // alcance: 1, 2, 3 anos ou tudo
      const barra = caixa.querySelector('#om-alcance');
      barra.innerHTML = '';
      [['1A', 365], ['2A', 730], ['3A', 1095], ['Tudo', 0]].forEach(([rot, dias]) => {
        const b = document.createElement('button');
        b.textContent = rot;
        b.style.cssText = 'background:transparent;border:1px solid #242935;color:#8a92a6;border-radius:3px;padding:3px 8px;font-size:10px;cursor:pointer';
        b.onclick = () => {
          if (!dias) { grafico.timeScale().fitContent(); return; }
          const de = velas.length - dias;
          grafico.timeScale().setVisibleLogicalRange({ from: Math.max(0, de), to: velas.length + 3 });
        };
        barra.appendChild(b);
      });
      grafico.timeScale().fitContent();
    } catch (e) {
      caixa.querySelector('#om-valor').textContent = 'erro';
      caixa.querySelector('#om-partes').textContent = String(e.message || e);
    }
  }

  function botaoMenu() {
    const nav = document.querySelector('.side-nav-top') || document.querySelector('.side-nav');
    if (!nav || document.getElementById('nav-omega')) return;
    const item = el('div', null, '<span class="nav-icon">Ω</span><span class="nav-lbl">Omega</span>');
    item.className = 'nav-item'; item.id = 'nav-omega'; item.title = 'Ω-Score: termômetro de calor do mercado';
    item.onclick = abrir;
    nav.appendChild(item);
  }

  window.VectraOmega = { abrir };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', botaoMenu);
  else botaoMenu();
  setTimeout(botaoMenu, 3000);
})();
