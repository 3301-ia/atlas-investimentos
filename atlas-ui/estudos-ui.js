// Estudos do Atlas: medidor de viradas, simulador de giro e disjuntores.
//
// Tres perguntas que antes eram opiniao:
//   1) nesse tempo grafico a virada paga o spread? (VIRADAS)
//   2) o giro e o espelhado sobrevivem a custo e a variancia? (SIMULADOR)
//   3) qual o tamanho da posicao e o que esta travado hoje? (RISCO)
//
// Toda conta mora em core/viradas.js, core/giro.js e core/risco.js. Aqui e
// tela, leitura dos candles do grafico e apresentacao.

(function () {
  'use strict';

  var abas = [
    { id: 'viradas', nome: 'VIRADAS' },
    { id: 'simulador', nome: 'SIMULADOR' },
    { id: 'risco', nome: 'RISCO' },
    { id: 'replay', nome: 'REPLAY' }
  ];
  var abaAtual = 'viradas';
  var painel = null;
  var cores = { viradas: null, giro: null, risco: null };
  var ultimoResultado = { viradas: null, simulador: null, risco: null };

  function el(tag, css, html) {
    var d = document.createElement(tag);
    if (css) d.style.cssText = css;
    if (html != null) d.innerHTML = html;
    return d;
  }

  function num(v) {
    if (v == null || v === '') return null;
    var s = String(v).replace(/[^0-9.,-]/g, '');
    var pd = s.lastIndexOf('.'), pc = s.lastIndexOf(',');
    if (pd >= 0 && pc >= 0) s = pc > pd ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (pc >= 0) s = s.replace(',', '.');
    var x = Number(s);
    return isFinite(x) ? x : null;
  }

  function carrega(nome, caminho, janela) {
    if (cores[nome]) return Promise.resolve(cores[nome]);
    var fonte = window[janela] ? Promise.resolve(window[janela]) : import(caminho).catch(function () { return null; });
    return fonte.then(function (m) { if (m) { cores[nome] = m; window[janela] = m; } return m; });
  }

  function carregarCores() {
    return Promise.all([
      carrega('viradas', './core/viradas.js', 'AtlasViradasCore'),
      carrega('giro', './core/giro.js', 'AtlasGiroCore'),
      carrega('risco', './core/risco.js', 'AtlasRiscoCore')
    ]);
  }

  function velasDoGrafico() {
    try {
      if (typeof candles !== 'undefined' && Array.isArray(candles) && candles.length > 40) {
        return candles.map(function (c) {
          return { time: c.time, o: c.open != null ? c.open : c.o, h: c.high != null ? c.high : c.h, l: c.low != null ? c.low : c.l, c: c.close != null ? c.close : c.c };
        });
      }
    } catch (e) {}
    return [];
  }

  function intervaloBase(v) {
    if (v.length < 3) return null;
    var menor = Infinity;
    for (var i = 1; i < Math.min(v.length, 30); i++) {
      var d = v[i].time - v[i - 1].time;
      if (d > 0 && d < menor) menor = d;
    }
    return isFinite(menor) ? menor : null;
  }

  // ------------------------------------------------------------------ layout
  function botao(txt, fn, extra) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.style.cssText = 'min-height:40px;min-width:40px;padding:0 12px;background:transparent;cursor:pointer;' +
      'border:1px solid rgba(217,180,91,.45);border-radius:6px;color:#D9B45B;' +
      'font:600 11px ui-monospace,Consolas,monospace;letter-spacing:.06em' + (extra || '');
    if (fn) b.addEventListener('click', fn);
    return b;
  }

  function campo(rotulo, valor, largura) {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:' + (largura || '90px');
    var l = el('span', 'font-size:9px;letter-spacing:.1em;color:#8a97a8', rotulo);
    var i = document.createElement('input');
    i.type = 'text';
    i.inputMode = 'decimal';
    i.value = valor == null ? '' : valor;
    i.style.cssText = 'min-height:40px;padding:0 8px;background:#0c1522;border:1px solid rgba(217,180,91,.3);' +
      'border-radius:5px;color:#e6f1f8;font:16px ui-monospace,Consolas,monospace;box-sizing:border-box';
    d.appendChild(l); d.appendChild(i);
    return { caixa: d, input: i };
  }

  function linha(campos) {
    var l = el('div', 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px');
    campos.forEach(function (c) { l.appendChild(c.caixa); });
    return l;
  }

  function cartao(html) {
    return el('div', 'border:1px solid rgba(217,180,91,.28);border-radius:8px;padding:10px;margin-bottom:10px;' +
      'background:linear-gradient(180deg,rgba(15,26,42,.65),rgba(8,14,22,.65))', html);
  }

  function tabela(linhas, colunas) {
    var t = document.createElement('table');
    t.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
    var th = document.createElement('tr');
    colunas.forEach(function (c) {
      var h = document.createElement('th');
      h.textContent = c;
      h.style.cssText = 'text-align:left;padding:4px 6px;color:#8a97a8;font-size:10px;letter-spacing:.08em;border-bottom:1px solid rgba(255,255,255,.1)';
      th.appendChild(h);
    });
    t.appendChild(th);
    linhas.forEach(function (l) {
      var tr = document.createElement('tr');
      l.forEach(function (v, i) {
        var td = document.createElement('td');
        td.textContent = v;
        td.style.cssText = 'padding:5px 6px;border-bottom:1px solid rgba(255,255,255,.05);' +
          (i === 0 ? 'color:#cfe9f7' : 'text-align:right;font-variant-numeric:tabular-nums');
        tr.appendChild(td);
      });
      t.appendChild(tr);
    });
    return t;
  }


  // ----------------------------------------------------------------- replay
  // Le o replay que o robo gera fora da Base44 (GitHub Actions). Nada de conta
  // na tela: o numero vem pronto e datado, e a tela so apresenta.
  var replayCache = null;

  function fmt(v, casas) {
    var n = Number(v);
    if (!isFinite(n)) return '--';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: casas == null ? 2 : casas, maximumFractionDigits: casas == null ? 2 : casas });
  }

  function desenharReplay() {
    var corpo = painel.querySelector('#estudos-corpo');
    corpo.innerHTML = '';
    corpo.appendChild(el('div', 'color:#9fb3c6;font-size:12px;margin-bottom:10px',
      'Replay do robo sobre o historico real, barra a barra, sem olhar o futuro. ' +
      'O custo entra como spread de ida e volta em pontos-base do preco.'));

    var saida = el('div', '');
    saida.id = 'estudos-replay-saida';
    saida.innerHTML = '<div style="color:#8a97a8">carregando replay...</div>';
    corpo.appendChild(saida);

    fetch('./observador/historico/replay.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        replayCache = d;
        pintarReplay(saida, d);
      })
      .catch(function () {
        saida.innerHTML = '<div style="color:#E2685F">replay ainda nao publicado. O robo gera na primeira execucao diaria.</div>';
      });
  }

  function pintarReplay(alvo, d) {
    alvo.innerHTML = '';
    if (!d || !d.series) {
      alvo.appendChild(cartao('<div style="color:#8a97a8">sem dados de replay publicados</div>'));
      return;
    }
    alvo.appendChild(cartao(
      '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<b style="color:#ffe9b0">' + (d.ativo || 'BTC-USD') + '</b>' +
        '<span style="color:#8a97a8;font-size:11px">custo ' + d.custo_bps + ' bps &middot; ' +
        (d.gerado_em ? new Date(d.gerado_em).toLocaleString('pt-BR') : '--') + '</span></div>' +
      '<div style="color:#9fb3c6;font-size:12px;margin-top:4px">regra viva: alvo ' +
        (d.filtros && d.filtros.alvoR) + 'R &middot; folga minima do stop ' +
        (d.filtros && d.filtros.distMinPct) + '% &middot; so abre na virada</div>'
    ));

    ['1H', '15M', '5M'].forEach(function (tf) {
      var s = d.series[tf];
      if (!s) return;
      if (s.erro) {
        alvo.appendChild(cartao('<b style="color:#ffe9b0">' + tf + '</b> <span style="color:#E2685F">' + s.erro + '</span>'));
        return;
      }
      var corR = Number(s.r_ano) >= 0 ? '#3FBF8F' : '#E2685F';
      var pf = s.profit_factor == null ? '--' : fmt(s.profit_factor);
      alvo.appendChild(cartao(
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">' +
          '<b style="color:#ffe9b0">' + tf + '</b>' +
          '<span style="color:#8a97a8;font-size:11px">' + (s.anos || 0) + ' anos &middot; ' +
          (s.barras || 0) + ' barras &middot; ' + (s.de || '') + ' a ' + (s.ate || '') + '</span></div>' +
        '<div style="font-size:20px;font-weight:700;color:' + corR + '">' +
          (Number(s.r_ano) >= 0 ? '+' : '') + fmt(s.r_ano, 1) + ' R/ano</div>' +
        '<div style="margin-top:4px;color:#9fb3c6;font-size:12px">' +
          s.operacoes + ' operacoes &middot; acerto ' + fmt(s.acerto_pct, 1) + '% &middot; ' +
          fmt(s.r_medio, 3) + 'R por operacao &middot; PF ' + pf + '<br>' +
          'drawdown ' + fmt(s.drawdown_r, 1) + 'R &middot; pior sequencia ' +
          (s.sequencia_perdas || 0) + ' perdas &middot; ' + fmt(s.barras_media, 1) + ' barras por operacao</div>'
      ));
    });

    var s1 = d.series['1H'];
    if (s1 && s1.variantes) {
      var linhas = s1.variantes.map(function (v) {
        return [v.nome + (v.escolhida ? ' *' : ''), v.operacoes || 0,
          v.acerto_pct == null ? '--' : fmt(v.acerto_pct, 1) + '%',
          v.r_medio == null ? '--' : fmt(v.r_medio, 3),
          v.r_ano == null ? '--' : fmt(v.r_ano, 1),
          v.drawdown_r == null ? '--' : fmt(v.drawdown_r, 1)];
      });
      alvo.appendChild(cartao('<div style="color:#8a97a8;font-size:11px;margin-bottom:6px">VARIANTES NA 1H (a escolhida tem *)</div>' +
        tabela(linhas, ['regra', 'ops', 'acerto', 'R/op', 'R/ano', 'dd R']).outerHTML));
    }

    if (s1 && s1.custos) {
      var lc = s1.custos.map(function (c) {
        return [c.bps + ' bps', c.r_medio == null ? '--' : fmt(c.r_medio, 3), c.r_ano == null ? '--' : fmt(c.r_ano, 1)];
      });
      alvo.appendChild(cartao('<div style="color:#8a97a8;font-size:11px;margin-bottom:6px">SENSIBILIDADE AO CUSTO (1H)</div>' +
        tabela(lc, ['custo', 'R/op', 'R/ano']).outerHTML));
    }

    if (s1 && s1.dentro && s1.fora) {
      var l2 = [
        ['dentro da amostra', s1.dentro.operacoes || 0, s1.dentro.acerto_pct == null ? '--' : fmt(s1.dentro.acerto_pct, 1) + '%', s1.dentro.r_ano == null ? '--' : fmt(s1.dentro.r_ano, 1)],
        ['fora da amostra', s1.fora.operacoes || 0, s1.fora.acerto_pct == null ? '--' : fmt(s1.fora.acerto_pct, 1) + '%', s1.fora.r_ano == null ? '--' : fmt(s1.fora.r_ano, 1)]
      ];
      alvo.appendChild(cartao('<div style="color:#8a97a8;font-size:11px;margin-bottom:6px">METADE DENTRO, METADE FORA (1H)</div>' +
        tabela(l2, ['trecho', 'ops', 'acerto', 'R/ano']).outerHTML));
    }

    alvo.appendChild(cartao(
      '<div style="color:#8a97a8;font-size:11px;line-height:1.6">Como ler: R/ano e o resultado somado dividido pelos anos da amostra. ' +
      'A conta ja desconta o spread de ida e volta. Numeros de replay sao evidencia do passado, ' +
      'nao promessa: a temporada em papel e que decide quando o robo vai para a conta real.</div>'
    ));
  }

  // ----------------------------------------------------------------- painel
  function montar() {
    if (painel) return painel;
    painel = el('div', 'position:fixed;inset:0;z-index:10052;background:rgba(4,8,14,.95);backdrop-filter:blur(3px);' +
      'display:flex;flex-direction:column;font:13px/1.5 ui-monospace,Consolas,monospace;color:#cfe9f7');
    painel.id = 'estudos-painel';

    var topo = el('div', 'display:flex;align-items:center;gap:10px;padding:10px 12px;flex-wrap:wrap;' +
      'border-bottom:1px solid rgba(217,180,91,.35);background:linear-gradient(180deg,rgba(15,26,42,.95),rgba(8,14,22,.95))');
    topo.appendChild(el('span', 'color:#D9B45B;font-weight:700;letter-spacing:.12em', 'ESTUDOS'));
    abas.forEach(function (a) {
      var b = botao(a.nome, function () { trocar(a.id); });
      b.dataset.aba = a.id;
      topo.appendChild(b);
    });
    topo.appendChild(el('span', 'flex:1'));
    topo.appendChild(botao('FECHAR', function () { painel.style.display = 'none'; }));
    painel.appendChild(topo);

    var corpo = el('div', 'flex:1;overflow:auto;padding:12px');
    corpo.id = 'estudos-corpo';
    painel.appendChild(corpo);
    document.body.appendChild(painel);
    return painel;
  }

  function pintarAbas() {
    if (!painel) return;
    Array.prototype.forEach.call(painel.querySelectorAll('[data-aba]'), function (b) {
      var on = b.dataset.aba === abaAtual;
      b.style.background = on ? 'rgba(217,180,91,.16)' : 'transparent';
      b.style.color = on ? '#ffe9b0' : '#D9B45B';
    });
  }

  function trocar(id) {
    abaAtual = id;
    pintarAbas();
    if (id === 'viradas') desenharViradas();
    else if (id === 'simulador') desenharSimulador();
    else if (id === 'replay') desenharReplay();
    else desenharRisco();
  }

  // ---------------------------------------------------------------- viradas
  function desenharViradas() {
    var corpo = painel.querySelector('#estudos-corpo');
    corpo.innerHTML = '';
    corpo.appendChild(el('div', 'color:#9fb3c6;font-size:12px;margin-bottom:10px',
      'Viradas medidas nas velas do grafico, agregadas para 1H e 4H. O custo usa o spread que voce informar.'));

    var spread = campo('SPREAD DO ATIVO (preco)', '40', '160px');
    var bt = botao('MEDIR', function () { medir(spread.input.value); });
    var l = linha([spread]);
    l.appendChild(bt);
    corpo.appendChild(l);

    var saida = el('div', '');
    saida.id = 'estudos-viradas-saida';
    corpo.appendChild(saida);
    medir(spread.input.value);
  }

  function medir(spreadTxt) {
    var alvo = painel.querySelector('#estudos-viradas-saida');
    if (!alvo) return;
    var v = velasDoGrafico();
    var base = intervaloBase(v);
    if (!cores.viradas || !v.length || !base) {
      alvo.innerHTML = '<div style="color:#8a97a8">sem velas suficientes no grafico ainda</div>';
      return;
    }
    var spread = num(spreadTxt);
    if (spread == null) spread = 40;

    var blocos = [];
    [['1H', 3600], ['4H', 14400]].forEach(function (par) {
      var fator = Math.round(par[1] / base);
      if (fator < 1) return;
      var agregadas = fator === 1 ? v.map(function (x) { return { time: x.time, o: x.o, h: x.h, l: x.l, c: x.c }; })
        : cores.viradas.agregar(v.map(function (x) { return { time: x.time, o: x.o, h: x.h, l: x.l, c: x.c }; }), fator);
      var r = cores.viradas.medirViradas(agregadas, { spread: spread });
      blocos.push({ rotulo: par[0], r: r, velas: agregadas.length });
    });

    ultimoResultado.viradas = blocos;
    alvo.innerHTML = '';
    blocos.forEach(function (b) {
      if (!b.r) {
        alvo.appendChild(cartao('<div style="color:#8a97a8">' + b.rotulo + ': ' + b.velas +
          ' velas agregadas, precisa de 41 para medir. Aumente o historico do grafico.</div>'));
        return;
      }
      var r = b.r;
      var cor = r.liquidoAtr > 0 ? '#3FBF8F' : '#E2685F';
      var c = cartao(
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">' +
          '<b style="color:#ffe9b0">' + b.rotulo + '</b>' +
          '<span style="color:#8a97a8;font-size:11px">' + r.velas + ' velas &middot; ATR ' + r.atrMedio.toFixed(2) + '</span>' +
        '</div>' +
        '<div style="font-size:22px;font-weight:700;color:' + cor + '">' + (r.liquidoAtr >= 0 ? '+' : '') + r.liquidoAtr +
          ' ATR <span style="font-size:12px;color:#8a97a8">liquido no periodo</span></div>' +
        '<div style="margin-top:4px;color:#9fb3c6;font-size:12px">' + r.totalViradas + ' viradas &middot; ' +
          r.porCiclo + ' ATR por ciclo &middot; custo do spread ' + r.custoMedioPctDoStop + '% do stop</div>' +
        '<div style="margin-top:4px;color:#8a97a8;font-size:11px">aproveitamento ' + r.aproveitamento +
          '% &middot; ciclos de ruido ' + r.ruidoPct + '% &middot; ' + r.veredito + '</div>'
      );
      alvo.appendChild(c);
    });
  }

  // -------------------------------------------------------------- simulador
  function desenharSimulador() {
    var corpo = painel.querySelector('#estudos-corpo');
    corpo.innerHTML = '';
    corpo.appendChild(el('div', 'color:#9fb3c6;font-size:12px;margin-bottom:10px',
      'Simula o giro repetido e o robo espelhado com o custo de spread e a chance de acerto que voce informar. Mesma semente, mesmo resultado.'));

    var eq = campo('EQUITY', '130');
    var risco = campo('RISCO POR CICLO %', '2');
    var alvo = campo('ALVO EM R', '2');
    var acerto = campo('ACERTO %', '45');
    var ciclos = campo('CICLOS', '100');
    var spreadR = campo('SPREAD EM R', '0.05');
    var modo = document.createElement('select');
    modo.style.cssText = 'min-height:40px;padding:0 8px;background:#0c1522;border:1px solid rgba(217,180,91,.3);' +
      'border-radius:5px;color:#e6f1f8;font:16px ui-monospace,Consolas,monospace;box-sizing:border-box';
    ['simples', 'espelhado'].forEach(function (m) {
      var o = document.createElement('option'); o.value = m; o.textContent = m.toUpperCase(); modo.appendChild(o);
    });
    var modoCx = document.createElement('div');
    modoCx.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:130px';
    modoCx.appendChild(el('span', 'font-size:9px;letter-spacing:.1em;color:#8a97a8', 'MODO'));
    modoCx.appendChild(modo);

    corpo.appendChild(linha([eq, risco, alvo]));
    corpo.appendChild(linha([acerto, ciclos, spreadR, { caixa: modoCx }]));

    var l = el('div', 'display:flex;gap:8px;margin-bottom:10px');
    l.appendChild(botao('SIMULAR', function () { simular({ eq: eq.input.value, risco: risco.input.value, alvo: alvo.input.value, acerto: acerto.input.value, ciclos: ciclos.input.value, spreadR: spreadR.input.value, modo: modo.value }); }));
    corpo.appendChild(l);

    var saida = el('div', '');
    saida.id = 'estudos-sim-saida';
    corpo.appendChild(saida);
    simular({ eq: eq.input.value, risco: risco.input.value, alvo: alvo.input.value, acerto: acerto.input.value, ciclos: ciclos.input.value, spreadR: spreadR.input.value, modo: modo.value });
  }

  function simular(d) {
    var alvo = painel.querySelector('#estudos-sim-saida');
    if (!alvo || !cores.giro) return;
    var params = {
      equity: num(d.eq) || 100,
      riscoPct: num(d.risco) || 2,
      alvoR: num(d.alvo) || 2,
      acerto: (num(d.acerto) || 45) / 100,
      ciclos: Math.max(1, Math.round(num(d.ciclos) || 100)),
      spreadR: num(d.spreadR) || 0,
      modo: d.modo === 'espelhado' ? 'espelhado' : 'simples'
    };
    var r = cores.giro.simular(params);
    if (!r) { alvo.textContent = 'parametros invalidos'; return; }
    ultimoResultado.simulador = r;

    var cor = r.mediana >= params.equity ? '#3FBF8F' : '#E2685F';
    alvo.innerHTML = '';
    var c = cartao(
      '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<b style="color:#ffe9b0">' + (params.modo === 'espelhado' ? 'ESPELHADO' : 'GIRO SIMPLES') + '</b>' +
        '<span style="color:#8a97a8;font-size:11px">' + r.ruinaPct + '% de ruina &middot; ' + r.metaPct + '% batem a meta</span>' +
      '</div>' +
      '<div style="font-size:22px;font-weight:700;color:' + cor + ';margin-top:4px">' + r.mediana.toFixed(2) +
        ' <span style="font-size:12px;color:#8a97a8">mediana final de ' + params.equity.toFixed(0) + '</span></div>' +
      '<div style="color:#9fb3c6;font-size:12px;margin-top:4px">p10 ' + r.p10.toFixed(2) + ' &middot; p90 ' + r.p90.toFixed(2) +
        ' &middot; x' + r.multiploMediano + ' &middot; pior queda ' + r.piorDrawdownPct + '%</div>' +
      '<div style="color:#8a97a8;font-size:11px;margin-top:4px">expectativa ' + r.expectativa.evR + 'R por ciclo &middot; ' +
        (r.temVantagem ? 'tem vantagem' : 'sem vantagem') + ' &middot; acerto neutro ' + r.expectativa.acertoNeutro + '%</div>'
    );
    alvo.appendChild(c);
  }

  // ------------------------------------------------------------------ risco
  function desenharRisco() {
    var corpo = painel.querySelector('#estudos-corpo');
    corpo.innerHTML = '';
    corpo.appendChild(el('div', 'color:#9fb3c6;font-size:12px;margin-bottom:10px',
      'Tamanho da posicao pelo risco em porcentagem do equity e disjuntores do dia. Sem stop, o dimensionamento recusa de proposito.'));

    var eq = campo('EQUITY', '130');
    var eqDia = campo('EQUITY NO INICIO DO DIA', '130');
    var entrada = campo('ENTRADA', '73000');
    var stop = campo('STOP', '72400');
    var riscoPct = campo('RISCO %', '2');

    corpo.appendChild(linha([eq, eqDia]));
    corpo.appendChild(linha([entrada, stop, riscoPct]));

    var posicoes = campo('POSICOES ABERTAS', '0', '120px');
    var posSemStop = campo('DESSAS, SEM STOP', '0', '120px');
    corpo.appendChild(linha([posicoes, posSemStop]));

    var l = el('div', 'display:flex;gap:8px;margin-bottom:10px');
    l.appendChild(botao('CALCULAR', function () {
      calcularRisco({
        eq: eq.input.value, eqDia: eqDia.input.value, entrada: entrada.input.value,
        stop: stop.input.value, riscoPct: riscoPct.input.value,
        posicoes: posicoes.input.value, semStop: posSemStop.input.value
      });
    }));
    corpo.appendChild(l);

    var saida = el('div', '');
    saida.id = 'estudos-risco-saida';
    corpo.appendChild(saida);
    calcularRisco({
      eq: eq.input.value, eqDia: eqDia.input.value, entrada: entrada.input.value,
      stop: stop.input.value, riscoPct: riscoPct.input.value,
      posicoes: posicoes.input.value, semStop: posSemStop.input.value
    });
  }

  function calcularRisco(d) {
    var alvo = painel.querySelector('#estudos-risco-saida');
    if (!alvo || !cores.risco) return;
    var dim = cores.risco.dimensionar({
      equity: num(d.eq), riscoPct: num(d.riscoPct),
      entrada: num(d.entrada), stop: num(d.stop)
    });

    var qtd = Math.max(0, Math.round(num(d.posicoes) || 0));
    var sem = Math.max(0, Math.round(num(d.semStop) || 0));
    var lista = [];
    for (var i = 0; i < qtd; i++) lista.push({ stop: i < qtd - sem ? 1 : null, riscoPct: num(d.riscoPct) || 2 });

    var dj = cores.risco.disjuntores({
      equity: num(d.eq), equityInicioDia: num(d.eqDia), posicoes: lista
    });

    var fl = cores.risco.folgaDiaria(num(d.eq), num(d.eqDia));
    ultimoResultado.risco = { dim: dim, dj: dj, folga: fl };

    alvo.innerHTML = '';

    var c1 = cartao(
      '<b style="color:#ffe9b0">TAMANHO</b>' +
      (dim.ok
        ? '<div style="font-size:22px;font-weight:700;color:#3FBF8F;margin-top:4px">' + dim.tamanho + ' <span style="font-size:12px;color:#8a97a8">lote</span></div>' +
          '<div style="color:#9fb3c6;font-size:12px;margin-top:4px">risco de ' + dim.riscoUSD + ' USD (' + dim.riscoPct +
          '%) &middot; distancia ao stop ' + dim.distancia + '</div>'
        : '<div style="color:#E2685F;font-size:13px;margin-top:4px">' + dim.motivos.join(' &middot; ') + '</div>')
    );
    alvo.appendChild(c1);

    var cor = dj.liberado ? '#3FBF8F' : '#E2685F';
    var c2 = cartao(
      '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<b style="color:#ffe9b0">DISJUNTORES</b>' +
        '<span style="color:' + cor + ';font-weight:700">' + (dj.liberado ? 'LIBERADO' : 'TRAVADO') + '</span>' +
      '</div>' +
      (dj.travas.length ? '<div style="color:#E2685F;font-size:12px;margin-top:6px">' + dj.travas.join('<br>') + '</div>' : '') +
      (dj.avisos.length ? '<div style="color:#D9B45B;font-size:12px;margin-top:6px">' + dj.avisos.join('<br>') + '</div>' : '') +
      '<div style="color:#8a97a8;font-size:11px;margin-top:6px">perda do dia ' +
        (dj.perdaDiaPct == null ? '--' : dj.perdaDiaPct + '%') + ' &middot; posicoes ' + dj.posicoesAbertas +
        ' &middot; margem para mais ' + dj.margem + '</div>' +
      (fl ? '<div style="color:#8a97a8;font-size:11px">folga diaria: limite ' + fl.limiteUSD + ' &middot; perdido ' +
        fl.perdidoUSD + ' &middot; resta ' + fl.restanteUSD + '</div>' : '')
    );
    alvo.appendChild(c2);
  }

  // ------------------------------------------------------------------- init
  function adicionarNav() {
    if (document.getElementById('nav-estudos')) return;
    var pai = document.querySelector('.nav-item');
    if (!pai || !pai.parentNode) return;
    var item = document.createElement('div');
    item.className = 'nav-item';
    item.id = 'nav-estudos';
    item.title = 'Estudos: viradas, simulador de giro e disjuntores';
    item.innerHTML = '<span class="nav-icon">\ud83d\udcd0</span><span class="nav-lbl">Estudos</span>';
    item.addEventListener('click', abrir);
    pai.parentNode.insertBefore(item, pai.parentNode.children[3] || null);
  }

  function abrir() {
    montar();
    painel.style.display = 'flex';
    pintarAbas();
    carregarCores().then(function () { trocar(abaAtual); });
  }

  window.AtlasEstudos = {
    abrir: abrir,
    fechar: function () { if (painel) painel.style.display = 'none'; },
    aba: trocar,
    resultado: function () { return ultimoResultado; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', adicionarNav);
  else adicionarNav();
})();
