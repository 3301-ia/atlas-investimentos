// VECTRA · Painel da Escada de Travas + Disjuntores + Auditoria
//
// Baseado no relatório técnico de 20/11/2026.
// Lê os ciclos de RoboCiclos (aba Ciclos) ou RoboVivo (aba Ao vivo) e exibe:
//   1. Estatísticas por nível (seção 9 do relatório)
//   2. Decomposição do lucro: principal vs travas (seção 8)
//   3. Disjuntores com os limites da seção 25
//   4. Registro de auditoria exportável (seção 24)
//   5. Curva de equity e drawdown
//   6. Conferência do backtest contra os números do relatório (seção 27)
//
// CORREÇÕES em relação à versão anterior:
//   · o cartão nascia com display:none e nunca aparecia: agora entra dentro do
//     cartão da aba Ciclos (ou fica visível sozinho, se ela não existir)
//   · decomposição usava o resultado líquido como denominador e estourava
//     quando o ciclo somava perto de zero: agora usa principal + travas
//   · reserva era 10% do resultado (podia ficar negativa): mantém a regra do
//     relatório e mostra também a leitura "10% de cada giro positivo"
//   · disjuntores não seguiam a seção 25 (acerto <33% é reduzir lote, não
//     desligar; faltava o <28% que desliga)
//   · auditoria lia campos que os robôs não preenchem (precoSaida/saida_)
//   · travas encerradas junto com o ciclo não contam como abertura de nível,
//     igual ao relatório
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  if (document.getElementById('escada-painel-card')) return;

  /* ── cores ──────────────────────────────────────────────────────── */
  var C = {
    tinta: '#1c1c1e', fraco: '#8a8f98', linha: '#e4e4e6',
    vermelho: '#c8102e', verde: '#1f7a4d', ouro: '#c8a000',
    azul: '#2962ff', laranja: '#e67e22', roxo: '#9b59b6'
  };
  var NIVEIS = [1 / 3, 2 / 3, 1, 4 / 3, 5 / 3];
  var NIVEL_LABEL = ['0,33R', '0,67R', '1,00R', '1,33R', '1,67R'];

  /* ── limites do relatório (seções 21, 25 e 27) ──────────────────── */
  var LIMITES = {
    acertoDesligar: 0.28,
    acertoReduzir: 0.33,
    quedaPausar: 30.0,
    quedaDesligar: 46.35,
    nivel1Revisar: 0.60,
    seqPerdasPausar: 15,
    aprovacaoAcerto: 0.40,
    aprovacaoLucroQueda: 20,
    reservaPct: 0.10
  };

  /* ── helpers ────────────────────────────────────────────────────── */
  function n(v, c) {
    var x = Number(v); if (!isFinite(x)) return '--';
    return x.toLocaleString('pt-BR', { minimumFractionDigits: c == null ? 2 : c, maximumFractionDigits: c == null ? 2 : c });
  }
  function usd(v) { return (v >= 0 ? '+' : '') + n(v, 2); }
  function pct(v) { return isFinite(v) ? n(v * 100, 1) + '%' : '--'; }
  function cls(v) { return v >= 0 ? 'ep-pos' : 'ep-neg'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ── normalizar ciclo (robô de teste, ao vivo ou backtest) ──────── */
  function normalizarCiclo(c, idx) {
    var principal = c.resultado_principal != null ? c.resultado_principal : (c.principal || 0);
    var travas = c.resultado_travas != null ? c.resultado_travas : (c.travas || c.pnlTravas || c.pnlT || 0);
    var total = c.resultado_total != null ? c.resultado_total : (c.total != null ? c.total : principal + travas);
    var risco = c.risco_usd != null ? c.risco_usd : (c.risco || 0);
    return {
      id: c.ciclo_id != null ? c.ciclo_id : (idx + 1),
      lado: c.lado,
      entrada: c.preco_entrada != null ? c.preco_entrada : c.entrada,
      saida: c.saida_principal != null ? c.saida_principal : (c.precoSaida != null ? c.precoSaida : c.saida_),
      motivo: c.motivo_saida || c.motivo || '--',
      risco: risco,
      principal: principal,
      travas: travas,
      total: total,
      r: c.resultado_r != null ? c.resultado_r : (c.r || 0),
      lista: c.travas && c.travas.length ? c.travas : (c.lista || [])
    };
  }

  /* ── disjuntores (seção 25) ─────────────────────────────────────── */
  function disjuntores(m) {
    var lista = [];
    var acerto = m.acerto;
    var nivel1 = m.nivelAcerto[0];
    if (acerto < LIMITES.acertoDesligar) {
      lista.push({ label: 'Acerto ' + pct(acerto) + ' < 28%', acao: 'DESLIGAR e revisar', cor: C.vermelho });
    } else if (acerto < LIMITES.acertoReduzir) {
      lista.push({ label: 'Acerto ' + pct(acerto) + ' < 33%', acao: 'Reduzir lote pela metade', cor: C.laranja });
    }
    if (m.queda > LIMITES.quedaDesligar) {
      lista.push({ label: 'Queda US$ ' + n(m.queda) + ' > 46,35', acao: 'DESLIGAR (3× o pior caso)', cor: C.vermelho });
    } else if (m.queda > LIMITES.quedaPausar) {
      lista.push({ label: 'Queda US$ ' + n(m.queda) + ' > 30,00', acao: 'Pausar 24 horas', cor: C.laranja });
    }
    // Sem nenhuma trava aberta no nível 1 não há o que avaliar: acerto 0
    // aqui seria falso positivo, não nível fraco.
    if (m.nivelAberturas[0] > 0 && isFinite(nivel1) && nivel1 < LIMITES.nivel1Revisar) {
      lista.push({ label: 'Nível 1 acerto ' + pct(nivel1) + ' < 60%', acao: 'Revisar o alvo da trava', cor: C.laranja });
    }
    if (m.seqPerdas > LIMITES.seqPerdasPausar) {
      lista.push({ label: 'Sequência de perdas ' + m.seqPerdas + ' > 15', acao: 'Pausar e revisar', cor: C.vermelho });
    }
    return lista;
  }

  /* ── analisar ciclos ────────────────────────────────────────────── */
  function analisar(ciclosBrutos) {
    if (!ciclosBrutos || !ciclosBrutos.length) return null;
    var ciclos = ciclosBrutos.map(normalizarCiclo);

    var totalPrincipal = 0, totalTravas = 0, acertos = 0, equity = 0, topo = 0, queda = 0;
    var seqPerdas = 0, maxSeq = 0;
    var nivelAberturas = [0, 0, 0, 0, 0];
    var nivelAcertos = [0, 0, 0, 0, 0];
    var nivelPnl = [0, 0, 0, 0, 0];
    var nivelCiclos = [0, 0, 0, 0, 0];
    var equityCurva = [], drawdownCurva = [];
    var reservaGiro = 0;

    ciclos.forEach(function (c) {
      totalPrincipal += c.principal;
      totalTravas += c.travas;
      if (c.total > 0) { acertos++; seqPerdas = 0; reservaGiro += c.total * LIMITES.reservaPct; }
      else { seqPerdas++; if (seqPerdas > maxSeq) maxSeq = seqPerdas; }
      equity += c.total;
      if (equity > topo) topo = equity;
      var dd = topo - equity;
      if (dd > queda) queda = dd;
      equityCurva.push(equity);
      drawdownCurva.push(-dd);

      var vistos = {};
      (c.lista || []).forEach(function (t) {
        var idx = -1;
        for (var k = 0; k < NIVEIS.length; k++) {
          if (Math.abs(t.nivel - NIVEIS[k]) < 0.01) { idx = k; break; }
        }
        if (idx < 0) return;
        nivelPnl[idx] += (t.resultado || 0);
        vistos[idx] = true;
        // Igual ao relatório: trava encerrada junto com o ciclo não é abertura.
        if (t.estado === 'alvo') { nivelAberturas[idx]++; nivelAcertos[idx]++; }
        else if (t.estado === 'corte') { nivelAberturas[idx]++; }
      });
      Object.keys(vistos).forEach(function (k) { nivelCiclos[Number(k)]++; });
    });

    var total = totalPrincipal + totalTravas;
    var nivelAcerto = nivelAberturas.map(function (ab, k) {
      return ab > 0 ? nivelAcertos[k] / ab : 0;
    });

    return {
      ciclos: ciclos.length,
      acerto: ciclos.length ? acertos / ciclos.length : 0,
      totalPrincipal: totalPrincipal,
      totalTravas: totalTravas,
      total: total,
      mediaPorCiclo: ciclos.length ? total / ciclos.length : 0,
      queda: queda,
      seqPerdas: maxSeq,
      lucroQueda: queda > 0 ? total / queda : Infinity,
      reserva: total * LIMITES.reservaPct,
      reservaGiroPositivo: reservaGiro,
      nivelAberturas: nivelAberturas,
      nivelAcertos: nivelAcertos,
      nivelAcerto: nivelAcerto,
      nivelPnl: nivelPnl,
      nivelCiclos: nivelCiclos,
      equityCurva: equityCurva,
      drawdownCurva: drawdownCurva,
      aprovado: (ciclos.length ? acertos / ciclos.length : 0) > LIMITES.aprovacaoAcerto &&
        (queda > 0 ? total / queda : Infinity) > LIMITES.aprovacaoLucroQueda
    };
  }

  /* ── fonte de ciclos ────────────────────────────────────────────── */
  function fonteCiclos() {
    var rc = window.RoboCiclos, rv = window.RoboVivo;
    if (rc && rc.estado && rc.estado.teste && rc.estado.teste.ciclos && rc.estado.teste.ciclos.length) {
      return { nome: 'teste vela por vela', ciclos: rc.estado.teste.ciclos, velas: rc.estado.velas };
    }
    if (rv && rv.estado && rv.estado.ctx && rv.estado.ctx.ciclos && rv.estado.ctx.ciclos.length) {
      return { nome: 'ao vivo', ciclos: rv.estado.ctx.ciclos, velas: rv.estado.velas };
    }
    return null;
  }

  /* ── série do estudo (a mesma do relatório de 20/11) ─────────────── */
  // O painel só mostrava números depois de rodar o simulador ao vivo (aba
  // Ciclos). A série que o robô foi desenhado para operar já acompanha o
  // repositório: 21.000 velas de 15m de BTCUSDT. Carregando aqui, o backtest
  // do robô fica estudável sem depender do simulador estar rodando.
  var URL_SERIE_ESTUDO = 'core/dados/m15_btcusdt_15m.json';
  var serieEstudoCache = null;
  var serieEstudoEmCurso = null;
  var serieEstudoFalhou = false;

  function carregarSerieEstudo(pronto) {
    if (serieEstudoCache) { if (pronto) pronto(); return; }
    if (serieEstudoEmCurso) { serieEstudoEmCurso.push(pronto); return; }
    serieEstudoEmCurso = pronto ? [pronto] : [];
    fetch(URL_SERIE_ESTUDO, { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (Array.isArray(j) && j.length) serieEstudoCache = j; else serieEstudoFalhou = true; })
      .catch(function () { serieEstudoFalhou = true; })
      .then(function () {
        var lista = serieEstudoEmCurso || [];
        serieEstudoEmCurso = null;
        lista.forEach(function (fn) { try { fn(); } catch (e) {} });
      });
  }

  /* ── backtest de referência (cache) ─────────────────────────────── */
  var cacheRef = { marca: -1, resultado: null, corrigido: null, erro: null };

  function rodarReferencia(velas) {
    if (!window.VectraBacktest || !velas || !velas.length) return null;
    if (cacheRef.marca === velas.length) return cacheRef;
    cacheRef = { marca: velas.length, resultado: null, corrigido: null, erro: null };
    try {
      var r = window.VectraBacktest.rodar(velas);
      if (r && r.erro) cacheRef.erro = r.erro;
      else {
        cacheRef.resultado = r;
        // O relatório soma as travas encerradas com o ciclo com o sinal
        // invertido. Aqui roda a mesma mecânica com a conta correta.
        cacheRef.corrigido = window.VectraBacktest.rodar(velas, { corrigirSinalEncerrada: true });
      }
    } catch (e) {
      cacheRef.erro = e && e.message ? e.message : String(e);
    }
    return cacheRef;
  }

  /* ── renderizar ─────────────────────────────────────────────────── */
  function renderizar(el) {
    if (!el || !el.corpo) return;
    var fonte = fonteCiclos();
    if (!fonte) {
      // sem ciclos ao vivo: estuda a série do próprio repositório
      if (!serieEstudoCache) {
        el.corpo.innerHTML = '<div class="ep-vazio">' + (serieEstudoFalhou
          ? 'Não foi possível carregar a série do estudo (' + URL_SERIE_ESTUDO + '). Rode o simulador na aba Ciclos (<b>▶ testar</b>) para usar o histórico ao vivo.'
          : 'Carregando a série do estudo (21.000 velas de 15m de BTCUSDT)…') + '</div>';
        carregarSerieEstudo(function () { renderizar(el); });
        return;
      }
      // 1) o robô cíclico do papel opera a série do estudo vela por vela:
      //    os ciclos dele são os que aparecem aqui, e o gráfico do cartão
      //    (Operação em papel) mostra cada giro
      var rc = window.RoboCiclos;
      if (rc && typeof rc.preparar === 'function' && rc.estado && rc.estado.velas && rc.estado.velas.length) {
        fonte = fonteCiclos(); // o robô já rodou esta série
      }
      if (!fonte && rc && typeof rc.preparar === 'function' && window.__vxEstudoNoRobo !== 'rodando' && window.__vxEstudoNoRobo !== 'pronto') {
        window.__vxEstudoNoRobo = 'rodando';
        el.corpo.innerHTML = '<div class="ep-vazio">Rodando o robô cíclico em papel sobre a série do estudo…</div>';
        // a conferência reproduz o relatório, cujos alvos são 2R de ATR: aqui o
        // robô roda em modo 'atr' para os números continuarem batendo
        if (rc.config) rc.config.alvos = 'atr';
        rc.preparar(serieEstudoCache).then(function () {
          var n = 0;
          // avança vela por vela, em silêncio; o gráfico é pintado uma vez no fim
          while (rc.passo(true) && n++ < 40000) {}
          try { rc.pintar(); } catch (e) {}
          window.__vxEstudoNoRobo = 'pronto';
          renderizar(el);
        }).catch(function () {
          window.__vxEstudoNoRobo = 'pronto';
          renderizar(el);
        });
        return;
      }
      // 2) sem o robô (ou sem ciclos dele): cai no backtest de referência
      var refSerie = rodarReferencia(serieEstudoCache);
      if (refSerie && refSerie.resultado && refSerie.resultado.listaCiclos && refSerie.resultado.listaCiclos.length) {
        fonte = { nome: 'série do estudo · 15m · BTCUSDT (referência)', ciclos: refSerie.resultado.listaCiclos, velas: serieEstudoCache };
      }
      if (!fonte) {
        el.corpo.innerHTML = '<div class="ep-vazio">' + (refSerie && refSerie.erro ? esc(refSerie.erro) : 'A série do estudo não produziu ciclos.') + '</div>';
        return;
      }
    }

    var m = analisar(fonte.ciclos);
    if (!m) return;

    var html = [];
    var ativos = disjuntores(m);

    /* 1. RESUMO */
    html.push('<div class="ep-secao"><h4>Resumo da escada · ' + esc(fonte.nome) + '</h4>');
    html.push('<div class="ep-kv">');
    html.push('<i>ciclos</i><b>' + m.ciclos + '</b>');
    html.push('<i>acerto</i><b class="' + (m.acerto >= LIMITES.aprovacaoAcerto ? 'ep-pos' : m.acerto >= LIMITES.acertoReduzir ? 'ep-warn' : 'ep-neg') + '">' + pct(m.acerto) + '</b>');
    html.push('<i>resultado total</i><b class="' + cls(m.total) + '">' + usd(m.total) + '</b>');
    html.push('<i>média por ciclo</i><b class="' + cls(m.mediaPorCiclo) + '">' + usd(m.mediaPorCiclo) + '</b>');
    html.push('<i>queda máxima</i><b class="ep-neg">−' + n(m.queda, 2) + '</b>');
    html.push('<i>pior sequência</i><b>' + m.seqPerdas + '</b>');
    html.push('<i>lucro / queda</i><b class="' + (m.lucroQueda >= LIMITES.aprovacaoLucroQueda ? 'ep-pos' : 'ep-warn') + '">' + n(m.lucroQueda, 1) + '</b>');
    html.push('<i>reserva (10%)</i><b>' + usd(m.reserva) + '</b>');
    html.push('</div>');
    html.push('<div class="ep-nota">reserva do período = 10% do resultado. Lendo a Regra do Lucas como “10% de cada giro positivo”: ' + usd(m.reservaGiroPositivo) + '.</div>');
    html.push('</div>');

    /* 2. DECOMPOSIÇÃO (seção 8) */
    var pctPrincipal = m.total !== 0 ? m.totalPrincipal / m.total : 0;
    var pctTravas = m.total !== 0 ? m.totalTravas / m.total : 0;
    html.push('<div class="ep-secao"><h4>Decomposição do lucro</h4>');
    html.push('<div class="ep-decomp">');
    html.push('<div class="ep-decomp-bar">');
    html.push('<div class="ep-decomp-seg ep-seg-principal" style="width:' + Math.max(2, Math.abs(pctPrincipal) * 100) + '%"></div>');
    html.push('<div class="ep-decomp-seg ep-seg-travas" style="width:' + Math.max(2, Math.abs(pctTravas) * 100) + '%"></div>');
    html.push('</div>');
    html.push('<div class="ep-decomp-leg">');
    html.push('<span class="ep-seg-principal">■ Principal: ' + usd(m.totalPrincipal) + ' (' + pct(pctPrincipal) + ')</span>');
    html.push('<span class="ep-seg-travas">■ Travas: ' + usd(m.totalTravas) + ' (' + pct(pctTravas) + ')</span>');
    html.push('</div></div></div>');

    /* 3. POR NÍVEL (seção 9) */
    html.push('<div class="ep-secao"><h4>Comportamento por nível</h4>');
    html.push('<table class="ep-tabela">');
    html.push('<tr><th>Nível</th><th class="n">Aberturas</th><th class="n">Acerto</th><th class="n">% ciclos</th><th class="n">Resultado</th></tr>');
    for (var k = 0; k < NIVEIS.length; k++) {
      var acNivel = m.nivelAcerto[k];
      html.push('<tr><td>' + NIVEL_LABEL[k] + '</td><td class="n">' + m.nivelAberturas[k] + '</td><td class="n ' +
        (acNivel >= 0.90 ? 'ep-pos' : acNivel >= 0.70 ? 'ep-warn' : 'ep-neg') + '">' + (m.nivelAberturas[k] ? pct(acNivel) : '--') +
        '</td><td class="n">' + (m.ciclos ? pct(m.nivelCiclos[k] / m.ciclos) : '--') +
        '</td><td class="n ' + cls(m.nivelPnl[k]) + '">' + usd(m.nivelPnl[k]) + '</td></tr>');
    }
    html.push('</table></div>');

    /* 4. CURVA DE EQUITY */
    html.push('<div class="ep-secao"><h4>Curva de equity</h4>');
    html.push('<canvas id="ep-equity-canvas" class="ep-canvas" width="460" height="96"></canvas>');
    html.push('</div>');

    /* 5. DISJUNTORES (seção 25) */
    html.push('<div class="ep-secao"><h4>Disjuntores</h4><div class="ep-disj">');
    if (!ativos.length) {
      html.push('<div class="ep-disj-status ep-pos">Todos os disjuntores desligados — sistema operacional.</div>');
    } else {
      ativos.forEach(function (d) {
        html.push('<div class="ep-disj-item ep-disj-ativo" style="border-color:' + d.cor + '">');
        html.push('<span class="ep-disj-led" style="background:' + d.cor + '"></span>');
        html.push('<span>' + esc(d.label) + '</span>');
        html.push('<span class="ep-disj-acao">⚠ ' + esc(d.acao) + '</span>');
        html.push('</div>');
      });
    }
    html.push('<div class="ep-nota">Aprovação para tamanho real (seção 27): acerto acima de 40% e lucro/queda acima de 20. ' +
      (m.aprovado ? '<b class="ep-pos">Aprovado neste recorte.</b>' : '<b class="ep-warn">Ainda não atende.</b>') + '</div>');
    html.push('</div></div>');

    /* 6. CONFERÊNCIA DO RELATÓRIO */
    var ref = rodarReferencia(fonte.velas);
    html.push('<div class="ep-secao"><h4>Conferência do relatório <button type="button" class="ep-btn" id="ep-recalc">↻ recalcular</button></h4>');
    if (!ref) {
      html.push('<div class="ep-nota">Carregue a série na aba Ciclos (botão <b>Rodar</b>) para rodar o backtest completo e conferir os números do relatório.</div>');
    } else if (ref.erro) {
      html.push('<div class="ep-nota ep-neg">' + esc(ref.erro) + '</div>');
    } else {
      var conf = window.VectraBacktest.conferir(ref.resultado);
      html.push('<div class="ep-kv">');
      html.push('<i>resultado</i><b class="' + cls(ref.resultado.resultado) + '">' + usd(ref.resultado.resultado) + ' <span class="ep-alvo">/ 684,52</span></b>');
      html.push('<i>ciclos</i><b>' + ref.resultado.ciclos + ' <span class="ep-alvo">/ 599</span></b>');
      html.push('<i>acerto</i><b>' + pct(ref.resultado.acerto) + ' <span class="ep-alvo">/ 44,2%</span></b>');
      html.push('<i>queda máxima</i><b>−' + n(ref.resultado.quedaMaxima) + ' <span class="ep-alvo">/ 15,45</span></b>');
      html.push('<i>travas</i><b>' + pct(ref.resultado.pctTravas) + ' <span class="ep-alvo">/ 75,3%</span></b>');
      html.push('</div>');
      html.push('<div class="ep-nota ' + (conf.ok ? 'ep-pos' : 'ep-warn') + '">' +
        (conf.ok ? '✓ reprodução OK — todos os números conferem com o relatório (seção 27).' :
          '⚠ divergência: ' + conf.itens.filter(function (i) { return !i.ok; }).map(function (i) { return i.nome; }).join(', ')) +
        '</div>');
      if (ref.corrigido && !ref.corrigido.erro) {
        var dif = ref.resultado.resultado - ref.corrigido.resultado;
        html.push('<div class="ep-nota ep-warn">O relatório soma as 18 travas encerradas junto com o ciclo com o ' +
          'sinal invertido. Com a contabilidade correta o mesmo mecanismo dá <b>' + usd(ref.corrigido.resultado) +
          '</b> (' + usd(-dif) + '). O executor usa o número corrigido.</div>');
      }
    }
    html.push('</div>');

    /* 7. AUDITORIA (seção 24) */
    html.push('<div class="ep-secao"><h4>Registro de auditoria <button type="button" class="ep-btn-export" id="ep-export">↓ exportar CSV</button></h4>');
    html.push('<div class="ep-scroll"><table class="ep-tabela ep-audit">');
    html.push('<tr><th>#</th><th>Lado</th><th class="n">Entrada</th><th class="n">Saída</th><th>Motivo</th><th class="n">Principal</th><th class="n">Travas</th><th class="n">Total</th><th class="n">R</th></tr>');
    var todos = m.ciclos ? fonte.ciclos.map(normalizarCiclo) : [];
    var inicio = Math.max(0, todos.length - 30);
    todos.slice(inicio).forEach(function (c, i) {
      html.push('<tr><td>' + (inicio + i + 1) + '</td>' +
        '<td>' + (c.lado === 1 ? 'C' : 'V') + '</td>' +
        '<td class="n">' + n(c.entrada, 1) + '</td>' +
        '<td class="n">' + n(c.saida, 1) + '</td>' +
        '<td><span class="rc-pill ' + (c.motivo === 'alvo' ? 'alvo' : 'corte') + '">' + esc(c.motivo) + '</span></td>' +
        '<td class="n ' + cls(c.principal) + '">' + usd(c.principal) + '</td>' +
        '<td class="n ' + cls(c.travas) + '">' + usd(c.travas) + '</td>' +
        '<td class="n ' + cls(c.total) + '">' + usd(c.total) + '</td>' +
        '<td class="n">' + n(c.r, 2) + '</td></tr>');
    });
    html.push('</table></div></div>');

    el.corpo.innerHTML = html.join('');

    // A política do painel é abrir minimizado: o estudo tem 7 seções e, todas
    // abertas, viram ~2.300px de rolagem. Só o resumo nasce aberto; o resto
    // abre no toque do título.
    Array.prototype.slice.call(el.corpo.querySelectorAll('.ep-secao')).forEach(function (sec, idx) {
      var h4 = sec.querySelector('h4');
      var corpoSec = document.createElement('div');
      corpoSec.className = 'ep-corpo';
      Array.prototype.slice.call(sec.childNodes).forEach(function (no) {
        if (no !== h4) corpoSec.appendChild(no);
      });
      sec.appendChild(corpoSec);
      if (idx > 0) sec.classList.add('ep-min');
      if (h4) {
        h4.setAttribute('role', 'button');
        h4.setAttribute('aria-expanded', idx > 0 ? 'false' : 'true');
        h4.tabIndex = 0;
        var alternar = function (ev) {
          if (ev && ev.target && ev.target.tagName === 'BUTTON') return;
          sec.classList.toggle('ep-min');
          h4.setAttribute('aria-expanded', sec.classList.contains('ep-min') ? 'false' : 'true');
        };
        h4.addEventListener('click', alternar);
        h4.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); alternar(); }
        });
      }
    });

    desenharEquity(m.equityCurva, m.drawdownCurva);

    var btnExport = document.getElementById('ep-export');
    if (btnExport) btnExport.addEventListener('click', function () { exportarCSV(todos); });
    var btnRecalc = document.getElementById('ep-recalc');
    if (btnRecalc) btnRecalc.addEventListener('click', function () {
      cacheRef = { marca: -1, resultado: null, erro: null };
      renderizar(el);
    });
  }

  /* ── canvas de equity ───────────────────────────────────────────── */
  function desenharEquity(eq, dd) {
    var canvas = document.getElementById('ep-equity-canvas');
    if (!canvas || !eq || !eq.length) return;
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1;
    var W = 460, H = 96;
    if (dpr > 1) { canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr); }
    else { canvas.width = W; canvas.height = H; }
    ctx.clearRect(0, 0, W, H);

    var min = Math.min.apply(null, eq.concat(dd));
    var max = Math.max.apply(null, eq);
    var range = max - min || 1;
    var step = W / (eq.length - 1 || 1);
    function y(v) { return H - ((v - min) / range) * (H - 8) - 4; }

    // área de drawdown
    ctx.beginPath();
    ctx.fillStyle = 'rgba(200,16,46,0.14)';
    for (var j = 0; j < dd.length; j++) {
      if (j === 0) ctx.moveTo(0, y(dd[j])); else ctx.lineTo(j * step, y(dd[j]));
    }
    ctx.lineTo((dd.length - 1) * step, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // linha de equity
    ctx.beginPath();
    ctx.strokeStyle = C.verde;
    ctx.lineWidth = 1.5;
    for (var i = 0; i < eq.length; i++) {
      if (i === 0) ctx.moveTo(0, y(eq[i])); else ctx.lineTo(i * step, y(eq[i]));
    }
    ctx.stroke();

    // zero
    if (min < 0 && max > 0) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      ctx.moveTo(0, y(0)); ctx.lineTo(W, y(0));
      ctx.stroke();
    }
  }

  /* ── exportar CSV (seção 24) ────────────────────────────────────── */
  function exportarCSV(ciclos) {
    var linhas = ['ciclo_id,lado,entrada,saida,motivo,risco_usd,principal_usd,travas_usd,total_usd,r,travas_detalhe'];
    ciclos.forEach(function (c, i) {
      var detalhe = (c.lista || []).map(function (t) {
        return Number(t.nivel).toFixed(3) + 'R:' + t.estado + ':' + Number(t.resultado || 0).toFixed(4);
      }).join('|');
      linhas.push([
        i + 1,
        c.lado === 1 ? 'compra' : 'venda',
        Number(c.entrada || 0).toFixed(2),
        Number(c.saida || 0).toFixed(2),
        c.motivo,
        Number(c.risco || 0).toFixed(2),
        Number(c.principal || 0).toFixed(4),
        Number(c.travas || 0).toFixed(4),
        Number(c.total || 0).toFixed(4),
        Number(c.r || 0).toFixed(3),
        '"' + detalhe + '"'
      ].join(','));
    });
    var blob = new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vectra_auditoria_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ── estilo ─────────────────────────────────────────────────────── */
  function estilo() {
    if (document.getElementById('ep-estilo')) return;
    var s = document.createElement('style'); s.id = 'ep-estilo';
    s.textContent = [
      '#escada-painel-card{background:#fff;border:1px solid ' + C.linha + ';border-radius:12px;padding:10px 11px;font-family:Inter,system-ui,sans-serif;color:' + C.tinta + ';font-size:11px;margin-top:8px}',
      '#escada-painel-card *{box-sizing:border-box}',
      '.ep-vazio{color:' + C.fraco + ';font-size:11px;text-align:center;padding:24px 8px;line-height:1.5}',
      '.ep-secao{border:1px solid ' + C.linha + ';border-radius:10px;padding:8px;background:#fff;margin-bottom:8px}',
      '.ep-secao h4{margin:0 0 6px;font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:' + C.fraco + ';font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:6px;cursor:pointer}',
      '.ep-secao h4::after{content:"⌄";font-size:11px;line-height:1;color:' + C.fraco + '}',
      '.ep-secao.ep-min h4{margin-bottom:0}',
      '.ep-secao.ep-min h4::after{content:"›"}',
      '.ep-secao.ep-min .ep-corpo{display:none}',
      '.ep-kv{display:grid;grid-template-columns:1fr auto;gap:3px 8px;font-size:11px;font-variant-numeric:tabular-nums}',
      '.ep-kv i{font-style:normal;color:' + C.fraco + '}', '.ep-kv b{font-weight:600;text-align:right}',
      '.ep-alvo{color:' + C.fraco + ';font-weight:400}',
      '.ep-pos{color:' + C.verde + ';font-weight:700}', '.ep-neg{color:' + C.vermelho + ';font-weight:700}',
      '.ep-warn{color:' + C.laranja + ';font-weight:700}',
      '.ep-nota{font-size:9.5px;color:' + C.fraco + ';line-height:1.45;margin-top:6px}',
      '.ep-tabela{width:100%;border-collapse:collapse;font-size:10.5px;font-variant-numeric:tabular-nums}',
      '.ep-tabela th{text-align:left;font-size:8px;letter-spacing:.5px;text-transform:uppercase;color:' + C.fraco + ';border-bottom:1px solid ' + C.linha + ';padding:3px 2px;font-weight:700}',
      '.ep-tabela td{border-bottom:1px solid #f2f2f4;padding:3px 2px;white-space:nowrap}',
      '.ep-tabela td.n,.ep-tabela th.n{text-align:right}',
      '.ep-decomp{margin-top:4px}',
      '.ep-decomp-bar{display:flex;height:16px;border-radius:8px;overflow:hidden;background:#f0f0f2}',
      '.ep-decomp-seg{min-width:4px}',
      '.ep-decomp-leg{display:flex;gap:12px;margin-top:5px;font-size:10px;flex-wrap:wrap}',
      '.ep-seg-principal{background:' + C.azul + ';color:' + C.azul + '}',
      '.ep-seg-travas{background:' + C.ouro + ';color:' + C.ouro + '}',
      '.ep-canvas{width:100%;height:96px;display:block}',
      '.ep-disj{display:flex;flex-direction:column;gap:4px}',
      '.ep-disj-item{display:flex;align-items:center;gap:6px;border:1px solid ' + C.linha + ';border-radius:8px;padding:5px 7px;font-size:10px}',
      '.ep-disj-led{width:7px;height:7px;border-radius:50%;flex:0 0 auto}',
      '.ep-disj-acao{margin-left:auto;font-weight:700;font-size:9.5px}',
      '.ep-disj-status{font-size:10px;font-weight:700}',
      '.ep-scroll{max-height:220px;overflow:auto}',
      '.ep-btn,.ep-btn-export{border:1px solid ' + C.linha + ';background:#fff;border-radius:8px;padding:4px 8px;font-size:10px;font-weight:600;cursor:pointer;color:' + C.tinta + ';font-family:inherit;min-height:26px}',
      '.rc-pill{display:inline-block;padding:1px 6px;border-radius:99px;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}',
      '.rc-pill.alvo{background:#eaf6ef;color:' + C.verde + '}', '.rc-pill.corte{background:#fdecec;color:' + C.vermelho + '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ── montar ─────────────────────────────────────────────────────── */
  function montar() {
    estilo();
    var card = document.createElement('div');
    card.id = 'escada-painel-card';
    card.innerHTML = [
      '<div class="ep-topo">',
      '  <b style="font-size:12px">📊 Painel da Escada de Travas</b>',
      '  <button type="button" class="ep-btn" id="ep-atualizar">↻ atualizar</button>',
      '</div>',
      '<div id="ep-corpo"></div>'
    ].join('');
    card.querySelector('.ep-topo').style.cssText = 'display:flex;gap:6px;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap';

    var elems = { corpo: card.querySelector('#ep-corpo') };
    card.querySelector('#ep-atualizar').addEventListener('click', function () { renderizar(elems); });

    // O cartão vive dentro da aba Ciclos, junto do robô que gera os ciclos.
    // Antes ele nascia solto e com display:none, então nunca aparecia.
    // O cartão do robô pode nascer depois deste arquivo: tenta por alguns
    // segundos antes de desistir e ficar solto na página.
    var tentativas = 0;
    (function anexar() {
      var hospedeiro = document.getElementById('robo-ciclos-card');
      if (hospedeiro) {
        hospedeiro.appendChild(card);
      } else if (tentativas++ < 20) {
        setTimeout(anexar, 250);
        return;
      } else {
        document.body.appendChild(card);
      }
      renderizar(elems);
      // auto-refresh: só quando o cartão está realmente visível
      setInterval(function () {
        if (card.offsetParent === null) return;
        renderizar(elems);
      }, 4000);
    })();
  }

  function iniciar() {
    if (document.getElementById('escada-painel-card')) return;
    montar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else setTimeout(iniciar, 90);

  window.VectraEscadaPainel = {
    atualizar: function () { renderizar({ corpo: document.getElementById('ep-corpo') }); },
    analisar: analisar,
    disjuntores: disjuntores,
    limites: LIMITES
  };
})();
