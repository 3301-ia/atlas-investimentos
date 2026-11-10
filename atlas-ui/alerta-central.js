/* Central de Alertas do Atlas Vectra.
   Camada de tela do núcleo puro (core/alertas.js). Aqui só existe DOM, som,
   memória local e desenho. Toda a decisão de disparar ou não vem do núcleo,
   que roda igual no Node e no robô.

   Três tipos de despertador:
     Médias     travessia de EMA rápida x lenta em vela fechada
     Fibonacci  rompimento de nível do swing corrente
     Preço      um preço digitado, vigiado tick a tick

   Regras de interface que vieram do uso no celular:
     alvo de toque mínimo 40px, campo com 16px (senão o iOS dá zoom),
     nada de borda branca: navy em três tons com moldura dourada. */

(function () {
  'use strict';

  var LS = 'atlas.alertas.v1';
  var LIMITE_LOG = 40;

  var S = {
    som: true,
    motor: true,
    aba: 'ma',
    alertas: [],
    log: [],
    preco: null,
    velas: null,
    velasEm: 0,
    core: null,
    coreErro: null,
    aberto: false,
    pronto: false,
    form: {
      ma: { rapida: 8, lenta: 16, dir: 'ambas' },
      fib: { nivel: 0.618, swing: 21, dir: 'ambas' },
      preco: { valor: '', dir: 'ambas' }
    }
  };

  /* ---------------------------------------------------------------- util */

  function num(v) { return typeof v === 'number' && Number.isFinite(v); }
  function casas(p) { var a = Math.abs(p || 0); return a >= 1 ? 2 : 5; }
  function fmt(p) { return num(p) ? p.toFixed(casas(p)) : '--'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hora(t) {
    var d = new Date(t);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
  }

  /* ------------------------------------------------------------- memória */

  function carregar() {
    try {
      var bruto = localStorage.getItem(LS);
      if (!bruto) return;
      var d = JSON.parse(bruto);
      if (Array.isArray(d.alertas)) S.alertas = d.alertas;
      if (Array.isArray(d.log)) S.log = d.log.slice(0, LIMITE_LOG);
      if (typeof d.som === 'boolean') S.som = d.som;
      if (typeof d.motor === 'boolean') S.motor = d.motor;
      if (d.form && d.form.ma && d.form.fib) S.form = d.form;
    } catch (e) {}
  }

  var salvarTimer = null;
  function salvar() {
    clearTimeout(salvarTimer);
    salvarTimer = setTimeout(function () {
      try {
        localStorage.setItem(LS, JSON.stringify({
          som: S.som, motor: S.motor, form: S.form,
          alertas: S.alertas.slice(-60), log: S.log.slice(0, LIMITE_LOG)
        }));
      } catch (e) {}
    }, 250);
  }

  /* --------------------------------------------------------------- dados */

  function precoAtual() {
    if (num(S.preco)) return S.preco;
    try {
      var el = document.getElementById('rt-price') || document.getElementById('big-price');
      if (el) {
        var v = parseFloat(String(el.textContent).replace(/[^0-9.]/g, ''));
        if (num(v) && v > 0) return v;
      }
    } catch (e) {}
    try { if (typeof ultimoPreco !== 'undefined' && num(ultimoPreco) && ultimoPreco > 0) return ultimoPreco; } catch (e) {}
    try {
      var vv = window.__velas;
      if (Array.isArray(vv) && vv.length) {
        var ult = vv[vv.length - 1];
        if (ult && num(ult.c)) return ult.c;
      }
    } catch (e) {}
    return null;
  }

  // candleSeries é declarado com let no main.js: existe no escopo global, mas
  // não como propriedade de window. Por isso o typeof e o try.
  function velasFechadas() {
    var agora = Date.now();
    if (S.velas && agora - S.velasEm < 900) return S.velas;
    var cs = null;
    try { if (typeof candleSeries !== 'undefined') cs = candleSeries; } catch (e) { cs = null; }
    if (!cs || typeof cs.data !== 'function') {
      var vv = window.__velas;
      if (Array.isArray(vv) && vv.length > 4) {
        var saida2 = vv.slice(-400).map(function (k) { return { t: k.t, o: k.o, h: k.h, l: k.l, c: k.c }; });
        saida2.pop();
        S.velas = saida2;
        S.velasEm = agora;
        return saida2;
      }
      return S.velas;
    }
    var bruto;
    try { bruto = cs.data(); } catch (e) { return S.velas; }
    if (!Array.isArray(bruto) || bruto.length < 3) return S.velas;
    var saida = [];
    for (var i = 0; i < bruto.length; i++) {
      var c = bruto[i];
      var t = typeof c.time === 'number' ? c.time : (c.time && c.time.timestamp) || i;
      saida.push({ t: t, o: c.open, h: c.high, l: c.low, c: c.close });
    }
    // a última vela do gráfico ainda está em formação: só vela fechada conta
    saida.pop();
    S.velas = saida;
    S.velasEm = agora;
    return saida;
  }

  /* -------------------------------------------------------------- núcleo */

  function carregarCore() {
    // o robô e os testes podem injetar o núcleo pronto antes da tela subir
    if (window.AtlasAlertasCore) {
      S.core = window.AtlasAlertasCore;
      S.pronto = true;
      pintarLive();
      rodar();
      return;
    }
    import('./core/alertas.js').then(function (m) {
      S.core = m;
      S.pronto = true;
      pintarLive();
      rodar();
    }).catch(function (e) {
      S.coreErro = e;
      S.pronto = true;
      pintarLive();
    });
  }

  function ctx() {
    return { preco: precoAtual(), candles: velasFechadas(), agora: Date.now() };
  }

  /* ------------------------------------------------------------ disparar */

  var alarmeTimer = null;

  function tocarSom() {
    if (!S.som) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!tocarSom.ac) tocarSom.ac = new AC();
      var ac = tocarSom.ac;
      if (ac.state === 'suspended') ac.resume();
      var t0 = ac.currentTime;
      [880, 1320, 1760].forEach(function (f, i) {
        var o = ac.createOscillator();
        var g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        var t = t0 + i * 0.16;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.13);
        o.connect(g); g.connect(ac.destination);
        o.start(t); o.stop(t + 0.15);
      });
    } catch (e) {}
  }

  function vibrar() {
    try { if (navigator.vibrate) navigator.vibrate([120, 60, 120, 60, 200]); } catch (e) {}
  }

  function notificar(titulo, corpo) {
    try {
      if (window.Notification && Notification.permission === 'granted') {
        new Notification(titulo, { body: corpo, tag: 'atlas-alerta' });
      }
    } catch (e) {}
  }

  function pedirPermissaoNotificacao() {
    try {
      if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
    } catch (e) {}
  }

  function piscarTitulo() {
    clearInterval(alarmeTimer);
    var base = document.title;
    var n = 0;
    alarmeTimer = setInterval(function () {
      n++;
      document.title = (n % 2 ? '🔔 ' : '') + base.replace(/^🔔 /, '');
      if (n > 9) { clearInterval(alarmeTimer); document.title = base.replace(/^🔔 /, ''); }
    }, 700);
  }

  function toast(texto, tom) {
    var el = document.createElement('div');
    el.className = 'ac-toast ' + (tom || 'gold');
    el.innerHTML = texto;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('sai'); }, 5200);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 6000);
  }

  function disparar(a, ev) {
    var preco = num(ev && ev.preco) ? ev.preco : precoAtual();
    var lado = ev && ev.lado === 'baixa' ? 'perdeu abaixo' : 'rompeu acima';
    var alvo = ev && num(ev.alvo) ? fmt(ev.alvo) : '--';
    var rot = S.core ? S.core.rotulo(a) : a.tipo;

    S.log.unshift({
      t: Date.now(), id: a.id, rotulo: rot, lado: lado,
      alvo: ev && ev.alvo, preco: preco, hash: a.hash || null
    });
    S.log = S.log.slice(0, LIMITE_LOG);

    tocarSom();
    vibrar();
    piscarTitulo();
    toast(
      '<b>' + esc(rot) + '</b><br>' + esc(lado) + ' em <b>' + esc(fmt(preco)) + '</b>' +
      '<span class="ac-toast-sub">alvo ' + esc(alvo) + ' · ' + hora(Date.now()) + '</span>',
      ev && ev.lado === 'baixa' ? 'red' : 'green'
    );
    notificar('Atlas · ' + rot, lado + ' em ' + fmt(preco));

    autoMenu(0);

    var nav = document.getElementById('nav-alerts');
    if (nav) {
      nav.classList.add('ac-pisca');
      setTimeout(function () { nav.classList.remove('ac-pisca'); }, 2600);
    }
    salvar();
    desenharLista();
    desenharLog();
  }

  /* -------------------------------------------------------------- motor */

  function rodar() {
    if (!S.motor || !S.core) return;
    var p = precoAtual();
    if (!num(p)) return;
    var c = ctx();
    var mudou = false;

    for (var i = 0; i < S.alertas.length; i++) {
      var a = S.alertas[i];
      if (a.pausado) continue;
      var r;
      try { r = S.core.avaliar(a, a.estado || {}, c); } catch (e) { continue; }
      a.estado = r.estado;
      mudou = true;
      if (r.disparou) disparar(a, r.evento);
    }
    if (mudou) salvar();
    desenharLista();
    pintarLive();
  }

  /* --------------------------------------------------------- formulário */

  function seg(opcoes, valor, campo) {
    return '<div class="ac-seg" data-campo="' + campo + '">' + opcoes.map(function (o) {
      return '<button type="button" data-v="' + o.v + '" class="' + (String(o.v) === String(valor) ? 'on' : '') + '">' + o.t + '</button>';
    }).join('') + '</div>';
  }

  function formMa() {
    var f = S.form.ma;
    var opR = [5, 8, 9, 12, 20, 21, 34, 50];
    var opL = [16, 18, 21, 26, 34, 50, 100, 200];
    return '' +
      '<div class="ac-row">' +
        '<label class="ac-f"><span>Rápida (EMA)</span><select data-f="rapida">' +
          opR.map(function (v) { return '<option value="' + v + '"' + (v === f.rapida ? ' selected' : '') + '>' + v + '</option>'; }).join('') +
        '</select></label>' +
        '<label class="ac-f"><span>Lenta (EMA)</span><select data-f="lenta">' +
          opL.map(function (v) { return '<option value="' + v + '"' + (v === f.lenta ? ' selected' : '') + '>' + v + '</option>'; }).join('') +
        '</select></label>' +
      '</div>' +
      '<div class="ac-campo"><span>Direção</span>' +
        seg([{ v: 'acima', t: '▲ Subiu' }, { v: 'abaixo', t: '▼ Desceu' }, { v: 'ambas', t: '↕ Ambas' }], f.dir, 'dir') +
      '</div>' +
      '<div class="ac-leitura" id="acLeituraMa">calculando...</div>' +
      '<div class="ac-acoes">' +
        '<button type="button" class="ac-btn gold" data-acao="armar">🔔 Armar alerta</button>' +
        '<button type="button" class="ac-btn" data-acao="teste">▶ Testar</button>' +
      '</div>' +
      '<p class="ac-hint">Lê só vela fechada do gráfico. A travessia vale como nova quando aparece em outra vela.</p>';
  }

  function formFib() {
    var f = S.form.fib;
    var niveis = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    return '' +
      '<div class="ac-row">' +
        '<label class="ac-f"><span>Nível</span><select data-f="nivel">' +
          niveis.map(function (v) {
            return '<option value="' + v + '"' + (Number(v) === Number(f.nivel) ? ' selected' : '') + '>' +
              (v === 1 ? '1.0 (fundo/topo)' : v) + '</option>';
          }).join('') +
        '</select></label>' +
        '<label class="ac-f"><span>Swing</span><select data-f="swing">' +
          [21, 55, 120].map(function (v) { return '<option value="' + v + '"' + (v === f.swing ? ' selected' : '') + '>' + v + ' velas</option>'; }).join('') +
        '</select></label>' +
      '</div>' +
      '<div class="ac-campo"><span>Direção</span>' +
        seg([{ v: 'acima', t: '▲ Rompeu' }, { v: 'abaixo', t: '▼ Perdeu' }, { v: 'ambas', t: '↕ Ambas' }], f.dir, 'dir') +
      '</div>' +
      '<div class="ac-leitura" id="acLeituraFib">calculando...</div>' +
      '<div class="ac-acoes">' +
        '<button type="button" class="ac-btn gold" data-acao="armar">🔔 Armar alerta</button>' +
        '<button type="button" class="ac-btn" data-acao="teste">▶ Testar</button>' +
      '</div>' +
      '<p class="ac-hint">O nível acompanha o swing: se o topo ou o fundo mudar, o alerta passa a vigiar o novo preço.</p>';
  }

  function formPreco() {
    var f = S.form.preco;
    return '' +
      '<label class="ac-f"><span>Preço vigiado</span>' +
        '<input type="number" step="0.01" inputmode="decimal" data-f="valor" value="' + esc(f.valor) + '" placeholder="' + fmt(precoAtual()) + '"></label>' +
      '<div class="ac-atalhos">' +
        ['-250', '-100', '+100', '+250'].map(function (d) {
          return '<button type="button" class="ac-btn mini" data-nudge="' + d + '">' + d + '</button>';
        }).join('') +
        '<button type="button" class="ac-btn mini" data-nudge="atual">= preço atual</button>' +
      '</div>' +
      '<div class="ac-campo"><span>Direção</span>' +
        seg([{ v: 'acima', t: '▲ Subir até' }, { v: 'abaixo', t: '▼ Cair até' }, { v: 'ambas', t: '↕ Ambas' }], f.dir, 'dir') +
      '</div>' +
      '<div class="ac-acoes">' +
        '<button type="button" class="ac-btn gold" data-acao="armar">🔔 Armar alerta</button>' +
        '<button type="button" class="ac-btn" data-acao="teste">▶ Testar</button>' +
      '</div>' +
      '<p class="ac-hint">Dispara uma vez ao cruzar. Volta a valer quando o preço se afasta 0,06% do alvo.</p>';
  }

  function desenharForm() {
    var box = document.getElementById('acForm');
    if (!box) return;
    box.innerHTML = S.aba === 'ma' ? formMa() : S.aba === 'fib' ? formFib() : formPreco();
    pintarLeituras();
  }

  function pintarLeituras() {
    var c = ctx();
    if (S.aba === 'ma') {
      var el = document.getElementById('acLeituraMa');
      if (!el) return;
      if (!S.core) { el.textContent = 'núcleo carregando...'; return; }
      var f = S.form.ma;
      var cs = cruzamentoInfo(f.rapida, f.lenta);
      if (!cs) { el.innerHTML = '<span class="ac-dim">velas insuficientes para ' + f.rapida + '/' + f.lenta + '</span>'; return; }
      el.innerHTML =
        '<span class="ac-chip ' + (cs.rapida > cs.lenta ? 'green' : 'red') + '">EMA' + f.rapida + ' ' + fmt(cs.rapida) + '</span>' +
        '<span class="ac-chip ' + (cs.lenta > cs.rapida ? 'red' : 'dim') + '">EMA' + f.lenta + ' ' + fmt(cs.lenta) + '</span>' +
        '<span class="ac-dim">' + (cs.rapida > cs.lenta ? 'rápida acima' : 'rápida abaixo') + '</span>';
      return;
    }
    if (S.aba === 'fib') {
      var ef = document.getElementById('acLeituraFib');
      if (!ef) return;
      if (!S.core) { ef.textContent = 'núcleo carregando...'; return; }
      var f2 = S.form.fib;
      var sw = S.core.swingFib(c.candles, f2.swing);
      var nv = S.core.precoDoNivel(c.candles, Number(f2.nivel), f2.swing);
      if (!sw || !num(nv)) { ef.innerHTML = '<span class="ac-dim">aguardando velas do gráfico</span>'; return; }
      var perna = sw.direcao === 'alta' ? 'perna de alta' : 'perna de baixa';
      ef.innerHTML =
        '<span class="ac-chip">topo ' + fmt(sw.alto) + '</span>' +
        '<span class="ac-chip">fundo ' + fmt(sw.baixo) + '</span>' +
        '<span class="ac-chip gold">nível ' + esc(f2.nivel) + ' = ' + fmt(nv) + '</span>' +
        '<span class="ac-dim">' + perna + '</span>';
      return;
    }
    var ep = document.getElementById('acLeituraPreco');
    if (ep) ep.textContent = fmt(precoAtual());
  }

  function cruzamentoInfo(rapida, lenta) {
    if (!S.core) return null;
    var cs = velasFechadas();
    if (!cs || cs.length < Math.max(rapida, lenta) + 3) return null;
    var closes = cs.map(function (k) { return k.c; });
    var r = S.core.ema(closes, rapida);
    var l = S.core.ema(closes, lenta);
    var i = closes.length - 1;
    if (!num(r[i]) || !num(l[i])) return null;
    return { rapida: r[i], lenta: l[i] };
  }

  /* --------------------------------------------------------------- lista */

  function alvoDo(a) {
    if (!S.core) return null;
    var c = ctx();
    var d = S.core.distancia(a, c);
    return d;
  }

  function desenharLista() {
    var box = document.getElementById('acList');
    var cnt = document.getElementById('acCount');
    if (!box) return;
    if (cnt) cnt.textContent = S.alertas.length;

    if (!S.alertas.length) {
      box.innerHTML = '<div class="ac-vazio">Nenhum alerta armado. Escolha um tipo acima e toque em Armar.</div>';
      return;
    }
    var html = '';
    S.alertas.forEach(function (a) {
      var rot = S.core ? S.core.rotulo(a) : a.tipo;
      var d = alvoDo(a);
      var st = a.pausado ? 'pausado' : (a.estado && a.estado.disparos ? 'disparou ' + a.estado.disparos + 'x' : 'armado');
      var cor = a.pausado ? 'dim' : (a.estado && a.estado.disparos ? 'gold' : 'green');
      var dist = '';
      if (d) {
        var pts = Math.round(d.pontos);
        var sinal = pts > 0 ? '+' : '';
        dist = '<span class="ac-dist">alvo ' + fmt(d.alvo) + ' · ' + sinal + pts + ' pts (' + (d.percentual > 0 ? '+' : '') + d.percentual.toFixed(2) + '%)</span>';
      } else {
        dist = '<span class="ac-dist ac-dim">sem alvo calculável</span>';
      }
      html += '<div class="ac-item ' + (a.pausado ? 'off' : '') + '" data-id="' + esc(a.id) + '">' +
        '<div class="ac-item-h">' +
          '<span class="ac-item-t">' + esc(rot) + '</span>' +
          '<span class="ac-chip ' + cor + '">' + esc(st) + '</span>' +
        '</div>' +
        dist +
        '<div class="ac-item-f">' +
          (a.hash ? '<span class="ac-hash">#' + esc(a.hash) + '</span>' : '<span></span>') +
          '<span class="ac-item-b">' +
            '<button type="button" class="ac-ico sm" data-acao="pausar" title="Pausar/retomar">' + (a.pausado ? '▶' : '❚❚') + '</button>' +
            '<button type="button" class="ac-ico sm" data-acao="rearmar" title="Zerar contagem e rearmar">↺</button>' +
            '<button type="button" class="ac-ico sm danger" data-acao="excluir" title="Excluir">✕</button>' +
          '</span>' +
        '</div>' +
      '</div>';
    });
    box.innerHTML = html;
  }

  function desenharLog() {
    var box = document.getElementById('acLog');
    if (!box) return;
    if (!S.log.length) {
      box.innerHTML = '<div class="ac-vazio">Nada disparou ainda nesta sessão.</div>';
      return;
    }
    box.innerHTML = S.log.map(function (l) {
      var cor = l.lado === 'perdeu abaixo' ? 'red' : 'green';
      return '<div class="ac-log-l">' +
        '<span class="ac-dim">' + hora(l.t) + '</span>' +
        '<span class="ac-log-t">' + esc(l.rotulo) + '</span>' +
        '<span class="ac-chip ' + cor + '">' + esc(l.lado) + '</span>' +
        '<span class="ac-dim">' + fmt(l.preco) + '</span>' +
      '</div>';
    }).join('');
  }

  function pintarLive() {
    var el = document.getElementById('acLive');
    if (!el) return;
    var p = precoAtual();
    var motor = S.motor ? 'MOTOR ON' : 'MOTOR OFF';
    el.innerHTML = '<span class="ac-preco">' + (num(p) ? '$' + fmt(p) : '--') + '</span>' +
      '<span class="ac-motor ' + (S.motor ? 'on' : 'off') + '">' + motor + '</span>' +
      (S.coreErro ? '<span class="ac-chip red">núcleo falhou</span>' : '');
  }

  /* -------------------------------------------------------------- ações */

  function novoId() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function armar() {
    if (!S.core) { toast('O núcleo ainda está carregando. Um instante.', 'red'); return; }
    var a = null;

    if (S.aba === 'ma') {
      var f = S.form.ma;
      if (Number(f.rapida) >= Number(f.lenta)) { toast('A média rápida precisa ser menor que a lenta.', 'red'); return; }
      a = { tipo: 'ma', rapida: Number(f.rapida), lenta: Number(f.lenta), direcao: f.dir };
    } else if (S.aba === 'fib') {
      var f2 = S.form.fib;
      a = { tipo: 'fib', nivel: Number(f2.nivel), swing: Number(f2.swing), direcao: f2.dir };
      var nv = S.core.precoDoNivel(velasFechadas(), Number(f2.nivel), Number(f2.swing));
      if (!num(nv)) { toast('Ainda não há velas suficientes para esse swing.', 'red'); return; }
    } else {
      var f3 = S.form.preco;
      var v = parseFloat(String(f3.valor).replace(',', '.'));
      if (!num(v) || v <= 0) { toast('Digite o preço que você quer vigiar.', 'red'); return; }
      a = { tipo: 'preco', preco: v, direcao: f3.dir };
    }

    a.id = novoId();
    a.criado = Date.now();
    a.pausado = false;
    a.estado = S.core.estadoInicial();

    // a primeira leitura só memoriza o estado atual: alerta não nasce disparado
    try {
      a.estado = S.core.avaliar(a, a.estado, ctx()).estado;
    } catch (e) {}

    S.alertas.push(a);
    pedirPermissaoNotificacao();

    S.core.assinarAlerta(a).then(function (r) {
      a.hash = r.hash;
      salvar();
      desenharLista();
    }).catch(function () {});

    salvar();
    desenharLista();
    tocarSom();
    toast('<b>Alerta armado</b><br>' + esc(S.core.rotulo(a)), 'gold');
  }

  function acao(id, nome) {
    var i = -1;
    for (var k = 0; k < S.alertas.length; k++) if (S.alertas[k].id === id) { i = k; break; }
    if (i < 0) return;
    var a = S.alertas[i];
    if (nome === 'excluir') {
      S.alertas.splice(i, 1);
      toast('Alerta removido.', 'gold');
    } else if (nome === 'pausar') {
      a.pausado = !a.pausado;
      if (!a.pausado && S.core) {
        try { a.estado = S.core.estadoInicial(); a.estado = S.core.avaliar(a, a.estado, ctx()).estado; } catch (e) {}
      }
    } else if (nome === 'rearmar') {
      a.pausado = false;
      if (S.core) {
        try { a.estado = S.core.estadoInicial(); a.estado = S.core.avaliar(a, a.estado, ctx()).estado; } catch (e) {}
      }
      toast('Alerta rearmado.', 'gold');
    }
    salvar();
    desenharLista();
  }

  function nudge(d) {
    var p = precoAtual();
    if (!num(p)) { toast('Sem preço do gráfico agora.', 'red'); return; }
    var v = d === 'atual' ? p : p + Number(d);
    S.form.preco.valor = String(Math.round(v * 100) / 100);
    var inp = document.querySelector('#acForm input[data-f="valor"]');
    if (inp) inp.value = S.form.preco.valor;
    pintarLeituras();
  }

  /* ----------------------------------------------------------------- css */

  function injetarCss() {
    if (document.getElementById('ac-css')) return;
    var css = [
      '.ac-ov{position:fixed;inset:0;background:rgba(6,9,14,.72);z-index:9998;display:none;opacity:0;transition:opacity .18s}',
      '.ac-ov.on{display:block;opacity:1}',
      '.ac{position:absolute;top:0;right:0;bottom:0;width:430px;max-width:100vw;display:flex;flex-direction:column;',
      'background:linear-gradient(180deg,#111a2b 0%,#0d1522 60%,#0b1220 100%);',
      'border-left:1px solid rgba(245,166,35,.45);box-shadow:-18px 0 40px rgba(0,0,0,.45);',
      'font-family:var(--font);color:#e6ebf3;transform:translateX(14px);transition:transform .2s}',
      '.ac-ov.on .ac{transform:none}',
      '.ac-hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(245,166,35,.28);background:#0f1826}',
      '.ac-tt{flex:1;font-size:14px;font-weight:800;letter-spacing:.3px;color:#f3d59b;display:flex;flex-direction:column;gap:3px}',
      '.ac-live{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;color:#9fb0c9}',
      '.ac-preco{font-family:var(--mono);font-size:13px;color:#e6ebf3}',
      '.ac-motor{padding:1px 6px;border-radius:3px;font-size:9px;letter-spacing:.4px}',
      '.ac-motor.on{background:rgba(0,168,121,.16);color:#3ddba0;border:1px solid rgba(0,168,121,.5)}',
      '.ac-motor.off{background:rgba(236,63,63,.14);color:#ff8a8a;border:1px solid rgba(236,63,63,.5)}',
      '.ac-hd-btns{display:flex;gap:6px}',
      '.ac-ico{min-width:40px;min-height:40px;display:inline-flex;align-items:center;justify-content:center;background:#16202f;',
      'border:1px solid rgba(245,166,35,.35);color:#e6ebf3;border-radius:6px;font-size:14px;cursor:pointer;transition:.15s}',
      '.ac-ico:hover{background:#1c2839;border-color:rgba(245,166,35,.7)}',
      '.ac-ico.on{border-color:#f5a623;color:#f5a623;background:rgba(245,166,35,.12)}',
      '.ac-ico.sm{min-width:40px;min-height:40px;font-size:12px}',
      '.ac-ico.danger:hover{border-color:#ec3f3f;color:#ff8a8a}',
      '.ac-tabs{display:flex;gap:6px;padding:10px 14px 0}',
      '.ac-tabs button{flex:1;min-height:42px;background:#141d2c;border:1px solid #24314a;color:#a9b8cc;border-radius:6px;',
      'font-family:var(--font);font-size:12px;font-weight:700;cursor:pointer}',
      '.ac-tabs button.on{background:rgba(245,166,35,.12);border-color:rgba(245,166,35,.75);color:#f5c776}',
      '.ac-form{padding:12px 14px 4px;display:flex;flex-direction:column;gap:10px}',
      '.ac-row{display:flex;gap:8px}',
      '.ac-f{flex:1;display:flex;flex-direction:column;gap:5px;font-size:11px;color:#9fb0c9;font-weight:700}',
      '.ac-f select,.ac-f input{min-height:42px;background:#131c29;border:1px solid #2a3a55;color:#e6ebf3;border-radius:6px;',
      'padding:0 10px;font-size:16px;font-family:var(--mono);outline:none;width:100%}',
      '.ac-f select:focus,.ac-f input:focus{border-color:#f5a623}',
      '.ac-campo{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#9fb0c9;font-weight:700}',
      '.ac-seg{display:flex;gap:6px}',
      '.ac-seg button{flex:1;min-height:42px;background:#131c29;border:1px solid #2a3a55;color:#a9b8cc;border-radius:6px;',
      'font-family:var(--font);font-size:12px;font-weight:700;cursor:pointer}',
      '.ac-seg button.on{background:rgba(245,166,35,.12);border-color:rgba(245,166,35,.75);color:#f5c776}',
      '.ac-atalhos{display:flex;gap:6px;flex-wrap:wrap}',
      '.ac-btn{min-height:44px;padding:0 14px;background:#182334;border:1px solid #2c3c58;color:#dbe4ef;border-radius:6px;',
      'font-family:var(--font);font-size:12px;font-weight:800;cursor:pointer;transition:.15s}',
      '.ac-btn:hover{background:#1f2b3f}',
      '.ac-btn.gold{background:linear-gradient(180deg,#f7b73f,#e29a12);border-color:#f5a623;color:#1a1204}',
      '.ac-btn.gold:hover{filter:brightness(1.06)}',
      '.ac-btn.mini{min-height:40px;flex:1;padding:0 6px;font-size:11px}',
      '.ac-acoes{display:flex;gap:8px}',
      '.ac-acoes .ac-btn{flex:1}',
      '.ac-acoes .ac-btn.gold{flex:2}',
      '.ac-hint{margin:0;font-size:10px;line-height:1.5;color:#7e8ea6}',
      '.ac-leitura{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:24px}',
      '.ac-chip{font-size:10px;font-weight:800;padding:2px 6px;border-radius:3px;background:#182334;color:#a9b8cc;border:1px solid #2a3a55}',
      '.ac-chip.green{background:rgba(0,168,121,.14);color:#3ddba0;border-color:rgba(0,168,121,.5)}',
      '.ac-chip.red{background:rgba(236,63,63,.14);color:#ff8a8a;border-color:rgba(236,63,63,.5)}',
      '.ac-chip.gold{background:rgba(245,166,35,.13);color:#f5c776;border-color:rgba(245,166,35,.5)}',
      '.ac-dim{font-size:10px;color:#7e8ea6}',
      '.ac-sec{display:flex;align-items:center;gap:8px;padding:12px 14px 6px;font-size:11px;font-weight:800;',
      'letter-spacing:.6px;text-transform:uppercase;color:#8ea0b9;border-top:1px solid #1b2536;margin-top:8px}',
      '.ac-count{background:#182334;border:1px solid #2a3a55;border-radius:10px;padding:0 7px;font-size:10px;color:#f5c776}',
      '.ac-list,.ac-log{flex:0 1 auto;overflow-y:auto;padding:0 14px 8px;display:flex;flex-direction:column;gap:8px}',
      '.ac-log{flex:1 1 auto}',
      '.ac-item{background:#121b28;border:1px solid #22304a;border-left:3px solid #f5a623;border-radius:6px;padding:9px 10px;',
      'display:flex;flex-direction:column;gap:5px}',
      '.ac-item.off{opacity:.55;border-left-color:#4a5a75}',
      '.ac-item-h{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.ac-item-t{font-size:12px;font-weight:800;color:#eaf0f7}',
      '.ac-dist{font-family:var(--mono);font-size:11px;color:#a9b8cc}',
      '.ac-item-f{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.ac-hash{font-family:var(--mono);font-size:9px;color:#5f708a}',
      '.ac-item-b{display:flex;gap:6px}',
      '.ac-vazio{font-size:11px;color:#7e8ea6;padding:6px 0;line-height:1.5}',
      '.ac-log-l{display:flex;align-items:center;gap:8px;font-size:11px;padding:5px 0;border-bottom:1px solid #182234}',
      '.ac-log-t{flex:1;color:#dbe4ef;font-weight:600}',
      '.ac-toast{position:fixed;right:16px;bottom:16px;z-index:10000;max-width:330px;padding:11px 14px;border-radius:8px;',
      'background:#0f1826;color:#e9eff7;font-size:12px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.45);',
      'transition:opacity .5s,transform .5s;border:1px solid rgba(245,166,35,.6)}',
      '.ac-toast.green{border-color:rgba(0,168,121,.7)}',
      '.ac-toast.red{border-color:rgba(236,63,63,.7)}',
      '.ac-toast.sai{opacity:0;transform:translateY(8px)}',
      '.ac-toast-sub{display:block;font-size:10px;color:#9fb0c9;margin-top:2px}',
      '.ac-pisca{animation:acPisca .7s ease-in-out 3}',
      '@keyframes acPisca{0%,100%{background:transparent}50%{background:rgba(245,166,35,.28)}}',
      '@media (max-width:560px){.ac{width:100%;border-left:none}.ac-tabs button{font-size:11px}}',
      '.ac-menu{position:fixed;z-index:10001;min-width:236px;background:#0f1826;border:1px solid rgba(245,166,35,.6);',
      'border-radius:8px;padding:6px;box-shadow:0 14px 34px rgba(0,0,0,.5);font-family:var(--font)}',
      '.ac-menu-h{font-family:var(--mono);font-size:12px;font-weight:800;color:#f5c776;padding:8px 10px}',
      '.ac-menu button{display:block;width:100%;min-height:40px;text-align:left;background:transparent;border:none;',
      'color:#dbe4ef;font-family:var(--font);font-size:12px;font-weight:600;padding:0 10px;border-radius:6px;cursor:pointer}',
      '.ac-menu button:hover{background:#1b2739;color:#fff}',
      '.ac-menu-sep{height:1px;background:#22304a;margin:5px 6px}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'ac-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ----------------------------------------------------------------- dom */

  function montar() {
    if (document.getElementById('acOv')) return;
    var ov = document.createElement('div');
    ov.className = 'ac-ov';
    ov.id = 'acOv';
    ov.innerHTML =
      '<div class="ac" role="dialog" aria-label="Central de Alertas">' +
        '<div class="ac-hd">' +
          '<div class="ac-tt">🔔 Central de Alertas<span class="ac-live" id="acLive"></span></div>' +
          '<div class="ac-hd-btns">' +
            '<button type="button" class="ac-ico" id="acMotor" title="Ligar ou desligar o motor de alertas">⏻</button>' +
            '<button type="button" class="ac-ico" id="acSom" title="Som do alarme">🔊</button>' +
            '<button type="button" class="ac-ico" id="acX" title="Fechar">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="ac-tabs">' +
          '<button type="button" data-t="ma" class="on">Médias</button>' +
          '<button type="button" data-t="fib">Fibonacci</button>' +
          '<button type="button" data-t="preco">Preço</button>' +
        '</div>' +
        '<div class="ac-form" id="acForm"></div>' +
        '<div class="ac-sec">Alertas armados <span class="ac-count" id="acCount">0</span></div>' +
        '<div class="ac-list" id="acList"></div>' +
        '<div class="ac-sec">Histórico de disparos</div>' +
        '<div class="ac-log" id="acLog"></div>' +
      '</div>';
    document.body.appendChild(ov);

    ov.addEventListener('click', function (e) { if (e.target === ov) fechar(); });
    document.getElementById('acX').addEventListener('click', fechar);
    document.getElementById('acMotor').addEventListener('click', function () {
      S.motor = !S.motor;
      this.classList.toggle('on', S.motor);
      pintarLive();
      salvar();
      toast(S.motor ? 'Motor ligado.' : 'Motor pausado: nenhum alerta dispara.', 'gold');
    });
    document.getElementById('acSom').addEventListener('click', function () {
      S.som = !S.som;
      this.textContent = S.som ? '🔊' : '🔇';
      this.classList.toggle('on', S.som);
      salvar();
      if (S.som) tocarSom();
    });

    document.querySelectorAll('.ac-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.aba = b.getAttribute('data-t');
        document.querySelectorAll('.ac-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
        desenharForm();
      });
    });

    document.getElementById('acForm').addEventListener('change', function (e) {
      var t = e.target;
      var f = t.getAttribute('data-f');
      if (!f) return;
      var g = S.form[S.aba];
      g[f] = t.type === 'number' ? t.value : (f === 'rapida' || f === 'lenta' || f === 'swing' || f === 'nivel' ? Number(t.value) : t.value);
      salvar();
      pintarLeituras();
    });

    document.getElementById('acForm').addEventListener('input', function (e) {
      if (e.target.getAttribute('data-f') === 'valor') S.form.preco.valor = e.target.value;
    });

    document.getElementById('acForm').addEventListener('click', function (e) {
      var seg = e.target.closest ? e.target.closest('.ac-seg button') : null;
      if (seg) {
        var campo = seg.parentNode.getAttribute('data-campo');
        S.form[S.aba][campo] = seg.getAttribute('data-v');
        seg.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === seg); });
        salvar();
        return;
      }
      var nud = e.target.getAttribute && e.target.getAttribute('data-nudge');
      if (nud) { nudge(nud); return; }
      var acaoBtn = e.target.getAttribute && e.target.getAttribute('data-acao');
      if (acaoBtn === 'armar') armar();
      if (acaoBtn === 'teste') { tocarSom(); vibrar(); toast('<b>Teste do alarme</b><br>É assim que ele vai te acordar.', 'gold'); }
    });

    document.getElementById('acList').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-acao]') : null;
      if (!b) return;
      var item = b.closest('.ac-item');
      if (!item) return;
      acao(item.getAttribute('data-id'), b.getAttribute('data-acao'));
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.aberto) fechar();
    });
  }

  function abrir() {
    montar();
    S.aberto = true;
    document.getElementById('acOv').classList.add('on');
    document.getElementById('acMotor').classList.toggle('on', S.motor);
    document.getElementById('acSom').textContent = S.som ? '🔊' : '🔇';
    document.getElementById('acSom').classList.toggle('on', S.som);
    document.querySelectorAll('.ac-tabs button').forEach(function (x) {
      x.classList.toggle('on', x.getAttribute('data-t') === S.aba);
    });
    desenharForm();
    desenharLista();
    desenharLog();
    pintarLive();
  }

  function fechar() {
    S.aberto = false;
    var ov = document.getElementById('acOv');
    if (ov) ov.classList.remove('on');
  }

  /* ------------------------------------------------------ menu do mouse */

  var MENU_ID = 'acMenuCtx';

  function fecharMenu() {
    var m = document.getElementById(MENU_ID);
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  function abrirMenu(ev, preco, emas) {
    fecharMenu();
    if (!num(preco)) return;
    var pares = [];
    if (emas && emas.length === 2) pares.push([Number(emas[0]), Number(emas[1])]);
    [[8, 16], [9, 18]].forEach(function (p) {
      if (!pares.some(function (q) { return q[0] === p[0] && q[1] === p[1]; })) pares.push(p);
    });

    var html = '<div class="ac-menu-h">$' + fmt(preco) + '</div>' +
      '<button type="button" data-m="preco:ambas">\ud83d\udd14 Alarme neste preço</button>' +
      '<button type="button" data-m="preco:acima">\u25b2 Romper acima</button>' +
      '<button type="button" data-m="preco:abaixo">\u25bc Perder abaixo</button>' +
      '<div class="ac-menu-sep"></div>';

    pares.slice(0, 2).forEach(function (p) {
      var rot = 'EMA ' + p[0] + '/' + p[1];
      html += '<button type="button" data-m="ma:' + p[0] + ':' + p[1] + ':acima">\ud83d\udd14 ' + rot + ' \u25b2 cruzou para cima</button>';
      html += '<button type="button" data-m="ma:' + p[0] + ':' + p[1] + ':abaixo">\ud83d\udd14 ' + rot + ' \u25bc cruzou para baixo</button>';
    });

    var m = document.createElement('div');
    m.className = 'ac-menu';
    m.id = MENU_ID;
    m.innerHTML = html;
    document.body.appendChild(m);

    var w = m.offsetWidth || 236, h = m.offsetHeight || 320;
    var x = Math.min(Math.max(8, ev.clientX + 6), window.innerWidth - w - 8);
    var y = Math.min(Math.max(8, ev.clientY + 6), window.innerHeight - h - 8);
    m.style.left = x + 'px';
    m.style.top = y + 'px';

    m.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-m]') : null;
      if (!b) return;
      var partes = String(b.getAttribute('data-m')).split(':');
      fecharMenu();
      if (partes[0] === 'preco') {
        S.aba = 'preco';
        S.form.preco.valor = String(preco);
        S.form.preco.dir = partes[1] || 'ambas';
        armar();
      } else if (partes[0] === 'ma') {
        armarMa(Number(partes[1]), Number(partes[2]), partes[3] || 'ambas');
      }
    });

    setTimeout(function () {
      document.addEventListener('mousedown', foraMenu, true);
    }, 0);
  }

  function foraMenu(e) {
    var m = document.getElementById(MENU_ID);
    if (m && !m.contains(e.target)) {
      fecharMenu();
      document.removeEventListener('mousedown', foraMenu, true);
    }
  }

  // Liga o botão direito num elemento de gráfico qualquer.
  // precoDe(ev) devolve o preço embaixo do ponteiro.
  function ligarMenu(opcoes) {
    var el = opcoes && opcoes.el;
    if (!el || el.__acMenu) return;
    el.__acMenu = true;
    el.addEventListener('contextmenu', function (ev) {
      var preco = null;
      try { preco = opcoes.precoDe(ev); } catch (e) { preco = null; }
      if (!num(preco)) return;
      ev.preventDefault();
      abrirMenu(ev, preco, opcoes.emas);
    });
  }

  function autoMenu(tentativas) {
    var el = document.getElementById('chart');
    if (!el) return;
    var cs = null;
    try { if (typeof candleSeries !== 'undefined') cs = candleSeries; } catch (e) { cs = null; }
    if (!cs || typeof cs.coordinateToPrice !== 'function') {
      if ((tentativas || 0) < 12) setTimeout(function () { autoMenu((tentativas || 0) + 1); }, 1200);
      return;
    }
    ligarMenu({
      el: el, emas: [8, 16],
      precoDe: function (ev) {
        var r = el.getBoundingClientRect();
        return cs.coordinateToPrice(ev.clientY - r.top);
      }
    });
  }

  function armarMa(rapida, lenta, direcao) {
    S.form.ma.rapida = Number(rapida);
    S.form.ma.lenta = Number(lenta);
    S.form.ma.dir = direcao || 'ambas';
    S.aba = 'ma';
    armar();
  }

  /* ---------------------------------------------------------------- init */

  function ligarPreco() {
    try {
      var orig = window.updatePriceUI;
      if (typeof orig === 'function' && !orig.__ac) {
        var emb = function (p) {
          if (num(p)) { S.preco = p; if (S.aberto) pintarLive(); }
          return orig.apply(this, arguments);
        };
        emb.__ac = true;
        window.updatePriceUI = emb;
      }
    } catch (e) {}

    // rede de segurança: se o wrap não pegar, lê o preço da tela
    setInterval(function () {
      if (num(S.preco)) return;
      var p = precoAtual();
      if (num(p)) S.preco = p;
    }, 1500);
  }

  function iniciar() {
    carregar();
    // padrão por tela: o painel principal trabalha com 8/16, a tela de
    // segundos com 9/18. Só vale quando o usuário ainda não escolheu nada.
    if (!document.getElementById('chart') && window.__velas) {
      S.form.ma.rapida = 9;
      S.form.ma.lenta = 18;
    }
    injetarCss();
    montar();
    ligarPreco();
    desenharLista();
    desenharLog();
    carregarCore();

    setInterval(rodar, 700);
    setInterval(function () { if (S.aberto) { pintarLeituras(); pintarLive(); } }, 1200);

    // a navegação lateral chama esta função
    window.atlasAbrirAlertas = function () { abrir(); };
    window.AtlasAlertas = {
      abrir: abrir, fechar: fechar,
      estado: function () { return { motor: S.motor, som: S.som, alertas: S.alertas.slice(), log: S.log.slice() }; },
      armarPreco: function (preco, direcao) {
        S.aba = 'preco'; S.form.preco.valor = String(preco); S.form.preco.dir = direcao || 'ambas';
        armar();
      },
      armarMa: armarMa,
      ligarMenu: ligarMenu,
      abrirMenuEm: abrirMenu
    };

    var nav = document.getElementById('nav-alerts');
    if (nav && !nav.__acLigado) {
      nav.__acLigado = true;
      nav.onclick = function (e) { e.preventDefault(); abrir(); };
      nav.setAttribute('title', 'Central de Alertas: médias, Fibonacci e preço');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
