/* ==================================================================
   PONTE VECTRA <-> ANTI-GRAVITY
   ==================================================================

   Liga o dashboard ao motor Python que roda na sua maquina.

   COMO USAR
   ---------
   Uma linha no index.html, ANTES do fechamento do </body> e DEPOIS
   do main.js:

       <script src="./ponte_antigravity.js"></script>

   E rodar o motor:  python -m antigravity BTCUSDT

   O QUE ELA FAZ
   -------------
   1. Manda pro motor toda linha de tendencia que voce desenha (ray) e
      toda linha horizontal, do tempo grafico atual.
   2. Recebe do motor a leitura continua dos quatro tempos (6m/15m/1h/4h)
      e a friccao entre o preco e cada uma das suas linhas.
   3. Mostra isso num painel proprio, arrastavel e recolhivel.

   ESTE ARQUIVO NAO ALTERA O main.js. Ele so embrulha `redrawDrawings`,
   que ja e o ponto por onde toda mudanca de desenho passa. Se a ponte
   falhar ou o motor estiver desligado, o dashboard segue funcionando
   exatamente como antes - e por isso que ela e um arquivo separado e
   nao um patch.

   POR QUE ws:// E NAO wss://
   --------------------------
   O motor roda na SUA maquina, sem TLS. Isso significa que esta ponte
   so funciona com o dashboard servido por http://localhost. A versao
   publicada em https://atlas-v10.onrender.com NAO consegue conectar:
   o navegador bloqueia ws:// vindo de pagina https (mixed content), e
   mesmo sem o bloqueio, 127.0.0.1 do ponto de vista do Render seria a
   maquina do Render, nao a sua. Verificado nos dois casos.
   ================================================================== */

(function () {
  "use strict";

  var hostsCandidatos = ["127.0.0.1"];
  if (typeof location !== "undefined" && location.hostname && location.hostname !== "127.0.0.1" && location.hostname !== "") {
    hostsCandidatos.unshift(location.hostname);
  }
  var idxHost = 0;
  function getUrlMotor() {
    if (typeof location !== "undefined" && location.protocol === "https:") {
      return "wss://" + location.host + "/ws";
    }
    return "ws://" + hostsCandidatos[idxHost % hostsCandidatos.length] + ":8765";
  }
  var ESPERA_RECONEXAO = 3000;
  var DEBOUNCE_SYNC = 400;

  // Tempos que o motor acompanha. Desenhar numa linha de 5m e legitimo,
  // mas o motor nao vigia esse tempo - o painel avisa em vez de fingir.
  var TF_DO_MOTOR = ["6m", "15m", "1h", "4h"];

  var ws = null;
  var conectado = false;
  var timerSync = null;
  var ultimoEnvio = "";
  var estado = { tempos: {}, vies_macro: "?", fonte: "?", linhas: {}, diagnostico: {} };
  var eventos = [];

  // ---------------------------------------------------------------
  // COLETA DAS LINHAS
  // ---------------------------------------------------------------

  function tfAtual() {
    return (typeof currentTF !== "undefined") ? currentTF : "15m";
  }

  function desenhosAtuais() {
    if (typeof drawStore === "undefined" || typeof storeKey !== "function") return [];
    return drawStore[storeKey()] || [];
  }

  /* Converte os desenhos da Vectra no payload do motor.

     'ray'        -> dois pontos, direto.
     'horizontal' -> tambem e uma reta: coeficiente zero. Ela so guarda p0,
                     entao sintetizo o p1 uma hora antes, no mesmo preco.
                     Suporte/resistencia horizontal e exatamente o tipo de
                     nivel que o motor deveria vigiar, seria desperdicio
                     ignorar. */
  function coletarLinhas() {
    var tf = tfAtual();
    var saida = [];
    desenhosAtuais().forEach(function (d, i) {
      if (d.type === "ray" && d.p0 && d.p1) {
        saida.push({
          id: "ray_" + i,
          timeframe: tf,
          rotulo: "LT " + (i + 1),
          p0: { x: d.p0.time, y: d.p0.price },
          p1: { x: d.p1.time, y: d.p1.price }
        });
      } else if (d.type === "horizontal" && d.p0) {
        saida.push({
          id: "hor_" + i,
          timeframe: tf,
          rotulo: "H " + d.p0.price.toFixed(2),
          p0: { x: d.p0.time - 3600, y: d.p0.price },
          p1: { x: d.p0.time, y: d.p0.price }
        });
      }
    });
    return saida;
  }

  function enviar(acao, dados) {
    if (!conectado || !ws) return;
    try { ws.send(JSON.stringify({ acao: acao, dados: dados || {} })); } catch (e) { /* socket morrendo */ }
  }

  /* Sincroniza limpando e reenviando. Parece grosseiro, mas e o certo
     aqui: os desenhos da Vectra nao tem id estavel (o indice muda quando
     voce apaga um do meio), entao tentar casar por id produziria linha
     fantasma no motor. Reenviar tudo e idempotente e barato - sao
     poucas linhas, e so acontece quando voce mexe no desenho. */
  function sincronizar(forcar) {
    var linhas = coletarLinhas();
    var assinatura = JSON.stringify(linhas);
    if (!forcar && assinatura === ultimoEnvio) return;
    ultimoEnvio = assinatura;

    enviar("linhas_limpar", { timeframe: tfAtual() });
    linhas.forEach(function (l) { enviar("linha_upsert", l); });
    render();
  }

  function agendarSync() {
    clearTimeout(timerSync);
    timerSync = setTimeout(function () { sincronizar(false); }, DEBOUNCE_SYNC);
  }

  // ---------------------------------------------------------------
  // GANCHO: embrulha redrawDrawings sem alterar main.js
  // ---------------------------------------------------------------

  function instalarGancho() {
    if (typeof window.redrawDrawings !== "function") return false;
    var original = window.redrawDrawings;
    window.redrawDrawings = function () {
      var r = original.apply(this, arguments);
      try { agendarSync(); } catch (e) { /* nunca quebrar o desenho */ }
      try { desenharSMC(); } catch (e) { /* nunca quebrar o desenho */ }
      return r;
    };
    return true;
  }

  // ---------------------------------------------------------------
  // CONEXAO
  // ---------------------------------------------------------------

  function conectar() {
    var url = getUrlMotor();
    try { ws = new WebSocket(url); } catch (e) { idxHost++; agendarReconexao(); return; }

    ws.onopen = function () {
      conectado = true;
      registrar("motor conectado (" + url + ")");
      sincronizar(true);
      render();
    };

    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      tratar(msg);
    };

    ws.onclose = function () {
      conectado = false;
      idxHost++;
      render();
      agendarReconexao();
    };

    ws.onerror = function () { /* onclose cuida da reconexao */ };
  }

  function agendarReconexao() {
    setTimeout(conectar, ESPERA_RECONEXAO);
  }

  function tratar(msg) {
    var d = msg.dados || {};
    switch (msg.tipo) {
      case "snapshot":
        estado.tempos = d.tempos || {};
        estado.smc_ativo = d.smc_ativo;
        Object.keys(d.tempos || {}).forEach(function (tf) {
          if (d.tempos[tf].smc) smcPorTF[tf] = d.tempos[tf].smc;
          if (d.tempos[tf].gatilho_fib) estado.gatilho_fib = d.tempos[tf].gatilho_fib;
        });
        desenharSMC();
        estado.vies_macro = d.vies_macro;
        estado.fonte = d.fonte;
        estado.simbolo = d.simbolo;
        estado.nuvem = d.nuvem;
        estado.diagnostico = d.diagnostico || {};
        break;
      case "matriz":
        // Chega a cada vela fechada, com o acumulado do tempo grafico.
        if (d.diagnostico) estado.diagnostico[d.timeframe] = d.diagnostico;
        break;
      case "tempo":
        estado.tempos[d.timeframe] = d;
        (d.linhas || []).forEach(function (l) { estado.linhas[l.id] = l; });
        // O P_cross e a probabilidade mudam a cada tick, entao o canvas
        // precisa ser repintado aqui, nao so quando chega SMC nova.
        if (d.timeframe === tfAtual()) desenharSMC();
        break;
      case "cruzamento":
        registrar("CRUZAMENTO " + d.timeframe + " -> " + d.direcao);
        break;
      case "linha_rompida":
        registrar("ROMPEU linha " + d.id + " (" + d.lado + ")");
        break;
      case "linha_confirmou":
        registrar("SEM RETORNO: " + d.id + " rompeu e ficou (" + d.lado + ")");
        break;
      case "linha_falso":
        registrar("FALSO: " + d.id + " voltou - a reta segurou");
        break;
      case "linha_rompeu_foco":
        registrar((d.ema_foco === "rapida" ? "EMA8" : "EMA16") +
                  " rompeu a linha " + d.id + " (" + d.lado_foco + ")");
        break;
      case "linha_rompimento_conjunto":
        registrar("EMAs romperam JUNTAS a linha " + d.id);
        break;
      case "silencio":
        registrar("feed em silencio ha " + Math.round(d.segundos) + "s");
        break;
      case "nuvem":
        estado.nuvem = d;
        desenharSMC();
        break;
      case "smc":
        smcPorTF[d.timeframe] = d.smc;
        if (d.timeframe === tfAtual()) estado.gatilho_fib = d.gatilho_fib;
        desenharSMC();
        break;
      case "gatilho_fib":
        registrar("FIB " + d.timeframe + ": " + d.motivo);
        break;
      case "linha_ok":
        estado.linhas[d.id] = estado.linhas[d.id] || {};
        break;
    }
    render();
  }

  function registrar(txt) {
    eventos.unshift({ t: new Date(), txt: txt });
    if (eventos.length > 8) eventos.pop();
  }

  // ---------------------------------------------------------------
  // PAINEL
  // ---------------------------------------------------------------

  var painel, corpo, recolhido = false;

  function criarPainel() {
    painel = document.createElement("div");
    painel.id = "ponte-ag";
    painel.innerHTML =
      '<div id="ponte-ag-cab">' +
        '<span id="ponte-ag-luz"></span>' +
        '<b>ANTI-GRAVITY</b>' +
        '<span id="ponte-ag-fonte"></span>' +
        '<span id="ponte-ag-toggle">-</span>' +
      '</div>' +
      '<div id="ponte-ag-corpo"></div>';

    var css = document.createElement("style");
    css.textContent =
      '#ponte-ag{position:fixed;right:8px;bottom:8px;left:auto;z-index:99999;width:420px;max-width:calc(100vw - 16px);' +
        'background:rgba(8,14,22,.95);border:1px solid rgba(0,200,255,.35);border-radius:6px;' +
        'font:11px/1.45 ui-monospace,Consolas,monospace;color:#cfe9f7;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.45);backdrop-filter:blur(4px)}' +
      '#ponte-ag.recolhido{width:auto;max-width:240px;box-shadow:0 2px 12px rgba(0,0,0,.5);}' +
      '#ponte-ag.recolhido #ponte-ag-cab{border-bottom:none;padding:5px 8px;}' +
      '#ponte-ag-cab{display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:move;' +
        'border-bottom:1px solid rgba(0,200,255,.2);letter-spacing:1.5px;font-size:10px}' +
      '#ponte-ag-cab b{flex:1;color:#4fd8ff}' +
      '#ponte-ag-luz{width:7px;height:7px;border-radius:50%;background:#e2453c;flex:0 0 auto}' +
      '#ponte-ag-luz.on{background:#22e07a;box-shadow:0 0 7px #22e07a}' +
      '#ponte-ag-fonte{font-size:9px;opacity:.55}' +
      '#ponte-ag-toggle{cursor:pointer;padding:0 5px;opacity:.7;font-weight:700}' +
      '#ponte-ag-corpo{padding:8px 9px;max-height:60vh;overflow:auto}' +
      '.pag-linha{display:flex;justify-content:space-between;gap:6px;padding:1px 0}' +
      '.pag-tit{font-size:9px;letter-spacing:1.5px;opacity:.5;margin:7px 0 3px}' +
      '.pag-tf{display:grid;grid-template-columns:34px 1fr 52px;gap:5px;align-items:center;padding:2px 0}' +
      '.pag-tf b{color:#8fd4ee;font-weight:600}' +
      '.pag-barra{height:3px;background:rgba(255,255,255,.09);border-radius:2px;overflow:hidden}' +
      '.pag-barra i{display:block;height:100%}' +
      '.pag-alta{color:#22e07a}.pag-baixa{color:#ff5a6e}.pag-neutro{opacity:.5}' +
      '.pag-ev{font-size:10px;opacity:.72;padding:1px 0;border-bottom:1px dotted rgba(255,255,255,.07)}' +
      '.pag-aviso{color:#ffb547;font-size:10px;padding:3px 0}' +
      '#pag-camadas{display:flex;flex-wrap:wrap;gap:3px 10px}' +
      '.pag-cam{font-size:10px;cursor:pointer;user-select:none;display:flex;align-items:center;gap:3px}' +
      '.pag-cam input{margin:0;width:11px;height:11px;cursor:pointer}' +
      /* --- layout reorganizado --- */
      '#ponte-ag-corpo{max-height:78vh}' +
      '.pag-sec{border-top:1px solid rgba(0,243,255,.12)}' +
      '.pag-sec:first-child{border-top:none}' +
      '.pag-sec-hd{display:flex;align-items:center;gap:6px;padding:6px 2px;cursor:pointer;user-select:none}' +
      '.pag-sec-hd:hover{background:rgba(0,243,255,.05)}' +
      '.pag-sec-seta{opacity:.5;font-size:9px;width:9px}' +
      '.pag-sec-tit{flex:1;font-size:9.5px;letter-spacing:1.6px;color:#4fd8ff}' +
      '.pag-sec-res{font-size:9px;opacity:.5}' +
      '.pag-sec-bd{padding:2px 2px 8px 15px}' +
      '.pag-tit2{font-size:8.5px;letter-spacing:1.4px;opacity:.45;margin:7px 0 3px}' +
      '.pag-sub{font-size:9px;opacity:.45;line-height:1.35;margin:1px 0 2px}' +
      '.pag-tf{display:grid;grid-template-columns:32px 1fr 44px;gap:6px;align-items:center;padding:2px 0;font-size:10px}' +
      /* score */
      '.pag-score{display:flex;align-items:baseline;gap:5px;margin:2px 0 4px}' +
      '.pag-score-n{font-size:30px;font-weight:800;line-height:1}' +
      '.pag-score-m{font-size:13px;opacity:.4}' +
      '.pag-score-d{margin-left:auto;font-size:12px;letter-spacing:1.5px;font-weight:700}' +
      '.pag-veredito{font-size:10px;letter-spacing:2px;text-align:center;margin:4px 0 6px;font-weight:700}' +
      '.pag-item{font-size:9px;line-height:1.35;padding:1px 0 1px 2px;border-left:2px solid transparent}' +
      '.pag-ok{color:#8ce6b4;border-left-color:#22e07a}' +
      '.pag-blq{color:#ffa0ab;border-left-color:#ff5a6e}' +
      '.pag-falta{color:#7f8fa0;opacity:.7}' +
      '.pag-tri{display:flex;justify-content:space-between;font-size:9px;opacity:.5;padding:1px 0}' +
      '#pag-fase{width:100%;height:auto;display:block;margin:4px 0 3px;border:1px solid rgba(0,243,255,.15);border-radius:3px}' +
      '.pag-alvo{display:grid;grid-template-columns:38px 1fr 44px 42px;gap:5px;align-items:center;font-size:9.5px;padding:1px 0}' +
      '.pag-alvo-foco{background:rgba(0,243,255,.06);border-left:2px solid #4fd8ff;padding-left:3px;margin-left:-5px}' +
      '.pag-alvo-rot{opacity:.65}' +
      '.pag-alvo-val{text-align:right;font-weight:600}' +
      '.pag-alvo-lado{opacity:.4;font-size:8.5px}' +
      /* projecao */
      '#pag-cone{width:100%;height:auto;display:block;margin:4px 0 3px;border:1px solid rgba(0,243,255,.15);border-radius:3px}' +
      '.pag-proj{display:grid;grid-template-columns:1fr 50px 38px 36px 36px;gap:4px;align-items:center;font-size:9px;padding:1.5px 0;border-bottom:1px solid rgba(255,255,255,.04)}' +
      '.pag-proj b{text-align:right;font-weight:600}' +
      '.pag-proj-hd{opacity:.35;font-size:8px;letter-spacing:.5px;border-bottom:1px solid rgba(255,255,255,.1)}' +
      '.pag-proj-rot{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.pag-proj-v50{opacity:.5;font-size:8px;margin-left:3px;color:#4fd8ff}' +
      /* diagnostico */
      '.pag-crit{display:grid;grid-template-columns:1fr 54px 44px;gap:4px;align-items:center;font-size:9px;padding:1.5px 0}' +
      '.pag-crit b{text-align:right;font-weight:600}' +
      '.pag-crit-morto{color:#ff5a6e}' +
      '.pag-crit-det{font-size:8px;opacity:.4;margin:0 0 3px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';

    document.head.appendChild(css);
    document.body.appendChild(painel);
    corpo = painel.querySelector("#ponte-ag-corpo");

    // abre recolhido no canto: o gráfico nasce limpo
    recolhido = true;
    corpo.style.display = "none";
    painel.classList.add("recolhido");
    var tg0 = painel.querySelector("#ponte-ag-toggle");
    if (tg0) tg0.textContent = "+";

    painel.querySelector("#ponte-ag-toggle").onclick = function (e) {
      e.stopPropagation();
      recolhido = !recolhido;
      corpo.style.display = recolhido ? "none" : "block";
      painel.classList.toggle("recolhido", recolhido);
      this.textContent = recolhido ? "+" : "-";
      // mantém sempre encostado no canto inferior direito
      painel.style.left = "auto";
      painel.style.top = "auto";
      painel.style.right = "8px";
      painel.style.bottom = "8px";
      var r = painel.getBoundingClientRect();
      if (r.top < 8) painel.style.bottom = (window.innerHeight - 8 - r.height) + "px";
    };
    arrastavel(painel, painel.querySelector("#ponte-ag-cab"));
  }

  function arrastavel(el, alca) {
    var ox = 0, oy = 0, ativo = false;
    alca.addEventListener("mousedown", function (e) {
      if (e.target.id === "ponte-ag-toggle") return;
      ativo = true;
      var r = el.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!ativo) return;
      el.style.left = (e.clientX - ox) + "px";
      el.style.top = (e.clientY - oy) + "px";
      el.style.bottom = "auto";
    });
    document.addEventListener("mouseup", function () { ativo = false; });
  }

  function n(v, casas) {
    return (v === null || v === undefined || isNaN(v)) ? "--" : Number(v).toFixed(casas === undefined ? 2 : casas);
  }

  /* ---------------------------------------------------------------
     RETRATO DE FASE (q, p)
     ---------------------------------------------------------------
     Eixo horizontal: q = preco - AVWAP (deslocamento da ancora).
     Eixo vertical:   p = RVol * dq     (momento; volume como massa).

     A trajetoria vem NORMALIZADA do motor, cada eixo pela propria
     escala. Sem isso o "circulo" seria uma agulha: q esta em dolares e
     p em dolares*RVol por vela, escalas que nao se comparam.

     O rastro desvanece com a idade - o ponto claro e agora, e a cauda
     e de onde veio. E isso que deixa ver a geometria: orbita fecha o
     laco, escape abre e some pela borda.
  --------------------------------------------------------------- */
  function desenharFase() {
    var cv = document.getElementById("pag-fase");
    if (!cv) return;
    var estT = estado.tempos[tfAtual()];
    var f = estT && estT.fase;
    if (!f || !f.ok) return;

    // Desenha a trajetoria FISICA (ATR), nao a normalizada.
    //
    // A normalizada forca o maximo de cada eixo em 1.00 sempre, entao o
    // retrato preenchia a mesma caixa com o mercado comprimido ou
    // explodindo - o tamanho nao dizia nada. Em ATR o blob pequeno e mola
    // enrolada de verdade, e o rastro que sai da caixa e escape de verdade.
    var pts = f.trajetoria_atr && f.trajetoria_atr.length ? f.trajetoria_atr : null;
    var escala = f.escala_atr;
    if (!pts || !escala) return;

    var ctx = cv.getContext("2d");
    var W = cv.width, H = cv.height;
    var cx = W / 2, cy = H / 2;
    var margem = 14;
    // Escala IGUAL nos dois eixos: o retrato so tem sentido geometrico se
    // um ATR na horizontal medir o mesmo que um ATR na vertical. Escalas
    // separadas por eixo esticariam a forma ate preencher a tela - que era
    // exatamente o defeito anterior, so que no desenho.
    var uni = Math.min(cx, cy) - margem;
    var k = uni / escala;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(3,8,14,.9)";
    ctx.fillRect(0, 0, W, H);

    // Grade em passos de 1 ATR, para o tamanho ser LEGIVEL e nao so relativo.
    ctx.strokeStyle = "rgba(0,243,255,.07)";
    ctx.lineWidth = 1;
    for (var a = 1; a * k < Math.max(cx, cy); a++) {
      ctx.beginPath();
      ctx.arc(cx, cy, a * k, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(0,243,255,.2)";
    ctx.beginPath();
    ctx.moveTo(6, cy); ctx.lineTo(W - 6, cy);
    ctx.moveTo(cx, 6); ctx.lineTo(cx, H - 6);
    ctx.stroke();

    var cor = f.regime === "orbita" ? "34,224,122"
            : f.regime === "escape" ? "255,90,110"
            : f.regime === "compressao" ? "79,216,255" : "127,143,160";

    var X = function (q) { return cx + q * k; };
    var Y = function (pp) { return cy - pp * k; };

    var nP = pts.length;
    for (var i2 = 1; i2 < nP; i2++) {
      var a0 = pts[i2 - 1], a1 = pts[i2];
      var idade = i2 / nP;
      ctx.strokeStyle = "rgba(" + cor + "," + (0.07 + idade * 0.65).toFixed(3) + ")";
      ctx.lineWidth = 0.7 + idade * 1.8;
      ctx.beginPath();
      ctx.moveTo(X(a0[0]), Y(a0[1]));
      ctx.lineTo(X(a1[0]), Y(a1[1]));
      ctx.stroke();
    }

    var ult = pts[nP - 1];
    ctx.save();
    ctx.shadowColor = "rgba(" + cor + ",.9)";
    ctx.shadowBlur = 13;
    ctx.fillStyle = "rgb(" + cor + ")";
    ctx.beginPath();
    ctx.arc(X(ult[0]), Y(ult[1]), 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.font = "8px ui-monospace,Consolas,monospace";
    ctx.fillStyle = "rgba(140,180,200,.55)";
    ctx.fillText("q (preco-AVWAP, ATR)", W - 118, cy - 4);
    ctx.fillText("p (momento)", cx + 5, 11);
    ctx.fillText("anel = 1 ATR", 6, H - 6);
    ctx.fillStyle = "rgba(" + cor + ",.9)";
    ctx.fillText(f.regime + "  ·  escala " + escala.toFixed(1) + " atr", 6, 11);
  }


  /* ---------------------------------------------------------------
     PAINEL
     ---------------------------------------------------------------
     Reorganizado pela ORDEM DA DECISAO, nao pela ordem em que os
     modulos foram escritos:

       1. VEREDITO    o score e o que ele autoriza
       2. ESTRUTURA   quem define o lado (macro, feixe, AVWAP)
       3. FLUXO       quem confirma (CVD, Wyckoff, delta ao vivo)
       4. FISICA      P_cross, colisao, Fokker-Planck, fase
       5. LIQUIDEZ    nuvem, perfil, suas linhas

     Metade do que o motor calcula nao aparecia aqui - inclusive o
     SCORE, que e a saida que decide. Cada bloco agora e recolhivel,
     porque a lista inteira aberta nao cabe em tela alguma.
  --------------------------------------------------------------- */

  var abertos = { veredito: true, estrutura: true, fluxo: true, fisica: true, liquidez: false };

  function desenharCone() {
    var cv = document.getElementById("pag-cone");
    if (!cv) return;
    var estT = estado.tempos[tfAtual()];
    var pj = estT && estT.projecao;
    if (!pj || !pj.ok || !pj.cone || !pj.cone.length) return;

    var ctx = cv.getContext("2d");
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    var x0 = 4, x1 = W - 88;          // 88px de calha para rotulo + prob
    var y0 = 10, y1 = H - 16;

    // ESCALA VERTICAL: o cone manda, nao os alvos.
    //
    // Antes a escala esticava para conter todo alvo visivel, e um POC a 2 ATR
    // achatava o cone inteiro numa faixa fina no meio da tela - o desenho
    // ficava sobre o alvo distante em vez de sobre a distribuicao. Agora a
    // escala e a do cone; alvo que nao cabe vira uma seta na borda, para
    // continuar existindo sem sequestrar a escala.
    var lo = pj.preco, hi = pj.preco;
    pj.cone.forEach(function (f) { lo = Math.min(lo, f.p05); hi = Math.max(hi, f.p95); });
    var folga = (hi - lo) * 0.15;
    var alvos = pj.alvos || [];
    alvos.forEach(function (a) {
      if (a.preco >= lo - folga && a.preco <= hi + folga) {
        lo = Math.min(lo, a.preco); hi = Math.max(hi, a.preco);
      }
    });
    if (hi <= lo) return;
    var pad = (hi - lo) * 0.05;
    lo -= pad; hi += pad;

    var N = pj.cone.length;
    function px(k) { return x0 + (x1 - x0) * (k / N); }
    function py(v) { return y1 - (y1 - y0) * ((v - lo) / (hi - lo)); }

    // ---- REGUA DE PRECO --------------------------------------------------
    // Sem ela o cone e uma forma bonita sem unidade: da para ver que abre,
    // nao da para dizer ate onde. Passo em 1/2/5 x 10^k para cair em numero
    // redondo - regua com 76837.4 nao se le de relance.
    var bruto = (hi - lo) / 5;
    var mag = Math.pow(10, Math.floor(Math.log(bruto) / Math.LN10));
    var norm = bruto / mag;
    var passo = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    ctx.font = "9px ui-monospace,monospace";
    ctx.textBaseline = "bottom";
    for (var v = Math.ceil(lo / passo) * passo; v <= hi; v += passo) {
      var yv = py(v);
      ctx.strokeStyle = "rgba(255,255,255,.055)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, yv); ctx.lineTo(x1, yv); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.34)";
      ctx.fillText(Math.round(v).toLocaleString("pt-BR"), x0 + 2, yv - 1.5);
    }

    // ---- FAIXAS ----------------------------------------------------------
    // Duas, nao uma. A externa (5-95) e o envelope de 90%; a interna (25-75)
    // e onde o preco passa metade do tempo. Um cone unico nao distingue
    // "provavel" de "possivel", e e essa diferenca que se opera.
    function faixa(nomeLo, nomeHi, cor) {
      ctx.beginPath();
      ctx.moveTo(px(0), py(pj.preco));
      pj.cone.forEach(function (f, i) { ctx.lineTo(px(i + 1), py(f[nomeHi])); });
      for (var i = pj.cone.length - 1; i >= 0; i--) {
        ctx.lineTo(px(i + 1), py(pj.cone[i][nomeLo]));
      }
      ctx.closePath();
      ctx.fillStyle = cor;
      ctx.fill();
    }
    faixa("p05", "p95", "rgba(79,216,255,.13)");
    faixa("p25", "p75", "rgba(79,216,255,.30)");

    ctx.strokeStyle = "#4fd8ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px(0), py(pj.preco));
    pj.cone.forEach(function (f, i) { ctx.lineTo(px(i + 1), py(f.p50)); });
    ctx.stroke();

    // preco de agora
    var ypa = py(pj.preco);
    ctx.strokeStyle = "rgba(255,255,255,.3)";
    ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, ypa); ctx.lineTo(x1, ypa); ctx.stroke();
    ctx.setLineDash([]);

    // ---- ALVOS, com anticolisao -----------------------------------------
    // Quatro niveis dentro de meio ATR e o caso NORMAL (AVWAP, as duas EMAs e
    // o VAL costumam andar juntos). Sem separar os rotulos eles viram um
    // borrao e a secao inteira perde a serventia.
    var ALT = 10;
    var itens = alvos.map(function (a) {
      var dentro = a.preco >= lo && a.preco <= hi;
      return {
        a: a,
        dentro: dentro,
        y: dentro ? py(a.preco) : (a.preco > hi ? y0 : y1),
        alvoY: dentro ? py(a.preco) : (a.preco > hi ? y0 : y1)
      };
    }).sort(function (m, n) { return m.y - n.y; });

    // empurra para baixo, depois corrige de baixo para cima: duas passagens
    // bastam e mantem a ordem de preco, que e o que faz a coluna ser lida
    // como uma escada.
    for (var i = 1; i < itens.length; i++) {
      if (itens[i].y - itens[i - 1].y < ALT) itens[i].y = itens[i - 1].y + ALT;
    }
    for (var i = itens.length - 2; i >= 0; i--) {
      if (itens[i + 1].y - itens[i].y < ALT) itens[i].y = itens[i + 1].y - ALT;
    }
    var teto = y0 + 5, piso = y1 - 8;   // -8 mantem o rotulo fora do eixo do tempo
    itens.forEach(function (it) { it.y = Math.max(teto, Math.min(piso, it.y)); });

    ctx.textBaseline = "middle";
    itens.forEach(function (it) {
      var a = it.a;
      var cor = a.tipo === "parede" ? "#ff4fa3"
              : a.tipo === "pcross" ? "#ffd24f"
              : a.lado === "acima" ? "#22e07a" : "#ff5a6e";
      // A opacidade segue P(toque): o provavel salta, o remoto some. Da para
      // ler a secao sem olhar numero nenhum.
      var op = 0.28 + 0.62 * Math.min(1, a.p_toque / 100);

      if (it.dentro) {
        ctx.strokeStyle = cor; ctx.globalAlpha = op;
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, it.alvoY); ctx.lineTo(x1, it.alvoY); ctx.stroke();
        ctx.setLineDash([]);
        // conector ate o rotulo deslocado, senao a escada mente sobre qual
        // linha e qual
        if (Math.abs(it.y - it.alvoY) > 2) {
          ctx.globalAlpha = op * 0.5;
          ctx.beginPath();
          ctx.moveTo(x1, it.alvoY); ctx.lineTo(x1 + 5, it.y); ctx.stroke();
        }
      } else {
        // fora de escala: seta na borda, para o nivel nao sumir da leitura
        ctx.globalAlpha = op; ctx.fillStyle = cor;
        var yb = a.preco > hi ? y0 + 1 : y1 - 1;
        var dy = a.preco > hi ? -4 : 4;
        ctx.beginPath();
        ctx.moveTo(x1 - 4, yb); ctx.lineTo(x1 + 4, yb); ctx.lineTo(x1, yb + dy);
        ctx.closePath(); ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = cor;
      ctx.font = "9px ui-monospace,monospace";
      ctx.fillText(String(a.rotulo).slice(0, 8), x1 + 7, it.y);
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.font = "8px ui-monospace,monospace";
      ctx.textAlign = "right";
      ctx.fillText(Math.round(a.p_toque) + "%", W - 2, it.y);
      ctx.textAlign = "left";
    });
    ctx.globalAlpha = 1;

    // marcador e etiqueta do preco atual
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(px(0), ypa, 2.4, 0, Math.PI * 2); ctx.fill();

    // ---- EIXO DO TEMPO ---------------------------------------------------
    ctx.font = "8px ui-monospace,monospace";
    ctx.textBaseline = "top";
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    for (var k = 1; k <= N; k++) {
      ctx.beginPath(); ctx.moveTo(px(k), y0); ctx.lineTo(px(k), y1); ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.fillText("agora", x0 + 1, y1 + 3);
    for (var k = 2; k <= N; k += 2) {
      ctx.fillText("t+" + k, px(k) - 8, y1 + 3);
    }
  }

  function secao(id, titulo, conteudo, resumo) {
    var ab = abertos[id];
    var h = '<div class="pag-sec">';
    h += '<div class="pag-sec-hd" data-sec="' + id + '">' +
         '<span class="pag-sec-seta">' + (ab ? "▾" : "▸") + '</span>' +
         '<span class="pag-sec-tit">' + titulo + '</span>' +
         '<span class="pag-sec-res">' + (resumo || "") + '</span></div>';
    if (ab) h += '<div class="pag-sec-bd">' + conteudo + '</div>';
    return h + '</div>';
  }

  function linha(rot, val, cls, sub) {
    return '<div class="pag-linha"><span>' + rot + '</span>' +
           '<b' + (cls ? ' class="' + cls + '"' : '') + '>' + val + '</b></div>' +
           (sub ? '<div class="pag-sub">' + sub + '</div>' : '');
  }

  function barra(frac, cor) {
    var pc = Math.max(0, Math.min(100, frac * 100));
    return '<div class="pag-barra"><i style="width:' + pc.toFixed(0) +
           '%;background:' + cor + '"></i></div>';
  }

  function render() {
    if (!corpo) return;
    var luz = painel.querySelector("#ponte-ag-luz");
    luz.className = conectado ? "on" : "";
    painel.querySelector("#ponte-ag-fonte").textContent =
      conectado ? (estado.fonte === "rest" ? "via REST" : "via WS") : "desligado";

    if (!conectado) {
      corpo.innerHTML = '<div class="pag-aviso">Motor desligado.</div>' +
        '<div class="pag-sub">Rode <code>python -m antigravity BTCUSDT</code> ' +
        'ou use o atalho Anti-Gravity. A ponte reconecta sozinha.</div>';
      return;
    }

    var tf = tfAtual();
    var t = estado.tempos[tf] || {};
    var d = t.direcional || {};
    var h = "";

    // ---------- 1. VEREDITO ----------
    var dec = t.decisao;
    var vc = "";
    if (dec) {
      var corS = dec.executa ? "#22e07a" : dec.bloqueios.length ? "#ff5a6e" : "#f5a623";
      vc += '<div class="pag-score">' +
            '<span class="pag-score-n" style="color:' + corS + '">' + dec.score + '</span>' +
            '<span class="pag-score-m">/' + dec.maximo + '</span>' +
            '<span class="pag-score-d" style="color:' + corS + '">' +
            (dec.direcao ? dec.direcao.toUpperCase() : "--") + '</span></div>';
      vc += barra(dec.score / dec.maximo, corS);
      vc += '<div class="pag-veredito" style="color:' + corS + '">' +
            (dec.executa ? "EXECUTA" : dec.bloqueios.length ? "BLOQUEADO" : "AGUARDA CONFLUENCIA") +
            '</div>';
      (dec.pontos || []).forEach(function (x) {
        vc += '<div class="pag-item pag-ok">+ ' + x + '</div>';
      });
      (dec.bloqueios || []).forEach(function (x) {
        vc += '<div class="pag-item pag-blq">X ' + x + '</div>';
      });
      (dec.faltou || []).forEach(function (x) {
        vc += '<div class="pag-item pag-falta">. ' + x + '</div>';
      });
    } else {
      vc = '<div class="pag-sub">matriz so avalia no fechamento de vela</div>';
    }
    h += secao("veredito", "VEREDITO", vc,
               dec ? dec.score + "/" + dec.maximo : "--");

    // ---------- 2. ESTRUTURA ----------
    var ec = "";
    var vm = estado.vies_macro;
    ec += linha("vies macro (4h)", String(vm).toUpperCase(),
                vm === "alta" ? "pag-alta" : vm === "baixa" ? "pag-baixa" : "pag-neutro");
    TF_DO_MOTOR.forEach(function (k) {
      var dd = (estado.tempos[k] || {}).direcional;
      if (!dd || dd.distancia_atr == null) return;
      var da = dd.distancia_atr;
      var c = da > 0 ? "#22e07a" : "#ff5a6e";
      ec += '<div class="pag-tf"><b>' + k + (k === estado.tf_macro ? "*" : "") + '</b>' +
            '<span class="pag-barra"><i style="width:' +
            Math.min(100, Math.abs(da) * 60).toFixed(0) + '%;background:' + c + '"></i></span>' +
            '<span style="color:' + c + ';text-align:right">' + n(da, 2) + '</span></div>';
    });
    var av = t.avwap;
    if (av && av.avwap) {
      ec += '<div class="pag-tit2">AVWAP</div>';
      ec += linha("ancora", n(av.avwap, 1),
                  av.defendendo ? "pag-alta" : "",
                  av.ancora_motivo + " ha " + av.barras_desde_ancora + " velas" +
                  (av.defendendo ? " - DEFENDENDO" : ""));
      ec += linha("distancia", n(av.distancia_pct, 2) + "% (" + n(av.distancia_atr, 2) + " atr)",
                  av.lado === "acima" ? "pag-alta" : "pag-baixa");
    }
    var ex = t.exaustao;
    if (ex && ex.razao_volume != null) {
      ec += linha("volume vs media", n(ex.razao_volume, 2) + "x",
                  ex.perdendo_volume ? "pag-baixa" : "",
                  ex.perdendo_volume ? "mercado secando" : "");
    }
    h += secao("estrutura", "ESTRUTURA", ec, String(vm).toUpperCase());

    // ---------- 3. FLUXO ----------
    var fc = "";
    var fl = t.fluxo, wy = t.wyckoff, dv = t.delta_vivo;
    if (fl && fl.cvd != null) {
      var pj = fl.pressao_janela;
      fc += linha("CVD acumulado", n(fl.cvd, 0),
                  fl.subindo ? "pag-alta" : "pag-baixa",
                  fl.subindo ? "subindo na janela" : "caindo na janela");
      fc += linha("pressao janela", n(pj, 1) + "%", pj > 0 ? "pag-alta" : "pag-baixa");
      fc += linha("delta da vela", n(fl.delta_vela, 1) + "  (" + n(fl.pressao_vela, 1) + "%)",
                  fl.pressao_vela > 0 ? "pag-alta" : "pag-baixa");
      if (fl.divergencia) {
        fc += '<div class="pag-item pag-ok">DIVERGENCIA ' + fl.divergencia.toUpperCase() + '</div>';
      }
      if (fl.absorcao) {
        fc += '<div class="pag-item pag-ok">ABSORCAO ' + fl.absorcao.toUpperCase() + '</div>';
      }
      fc += '<div class="pag-sub">' + fl.detalhe + '</div>';
    } else {
      fc += '<div class="pag-sub">sem volume agressor na serie</div>';
    }
    if (dv && dv.negocios) {
      fc += '<div class="pag-tit2">TICK AO VIVO (aggTrade)</div>';
      fc += linha("delta da vela em curso", n(dv.pressao, 1) + "%",
                  dv.pressao > 0 ? "pag-alta" : "pag-baixa",
                  dv.negocios + " negocios");
    }
    if (wy && wy.rvol != null) {
      fc += '<div class="pag-tit2">WYCKOFF</div>';
      fc += linha("RVol", n(wy.rvol, 2) + "x", wy.climax ? "pag-alta" : "");
      fc += linha("resultado", n(wy.resultado_atr, 2) + " atr", "");
      var sinais = [];
      if (wy.absorcao) sinais.push("ABSORCAO");
      if (wy.fuga) sinais.push("fuga");
      if (wy.climax) sinais.push("climax");
      if (wy.spring) sinais.push("SPRING");
      if (wy.upthrust) sinais.push("UPTHRUST");
      if (sinais.length) {
        fc += '<div class="pag-item pag-ok">' + sinais.join(" · ") + '</div>';
      }
    }
    h += secao("fluxo", "FLUXO E WYCKOFF", fc,
               fl && fl.pressao_janela != null ? n(fl.pressao_janela, 0) + "%" : "--");

    // ---------- 4. FISICA ----------
    var pc = "";
    var cz = d.cruzamento, col = t.colisao, onda = t.onda, fase = t.fase;
    if (cz && cz.p_cross) {
      pc += linha("P_cross", n(cz.p_cross, 1),
                  cz.alcancavel ? "" : "pag-neutro",
                  "cruza para " + (cz.cruza_para || "?") + " · " + n(cz.distancia_pct, 2) + "%");
      pc += linha("projecao t+1", n(cz.p_cross_t1, 1), "");
    }
    if (col && col.ok) {
      pc += linha("P(toque)", n(col.p_toque, 2) + "%",
                  col.p_toque >= 20 ? "pag-alta" : "pag-neutro");
      pc += linha("P(fecha alem)", n(col.p_fechamento, 2) + "%",
                  col.p_fechamento >= 40 ? "pag-alta" : "pag-neutro",
                  "Z " + n(col.z, 2) + " · " + col.segundos_restantes + "s · livro " +
                  n(col.fracao_livro * 100, 0) + "%");
    }
    if (onda && onda.ok) {
      pc += linha("Fokker-Planck", n(onda.p_colisao, 3) + "%", "",
                  "gamma " + n(onda.gamma, 4) + " · " + onda.passos + " subpassos" +
                  (onda.estavel ? "" : " (TETO)"));
    }
    if (fase && fase.ok) {
      var corR = fase.regime === "orbita" ? "#22e07a"
               : fase.regime === "escape" ? "#ff5a6e"
               : fase.regime === "compressao" ? "#4fd8ff" : "#7f8fa0";
      pc += '<div class="pag-tit2">RETRATO DE FASE</div>';
      pc += '<div class="pag-linha"><span>regime</span><b style="color:' + corR + '">' +
            fase.regime.toUpperCase() + '</b></div>';
      pc += '<canvas id="pag-fase" width="380" height="200"></canvas>';
      pc += '<div class="pag-tri">' +
            '<span>voltas ' + n(fase.enrolamento, 2) + '</span>' +
            '<span>coer ' + n(fase.coerencia * 100, 0) + '%</span>' +
            '<span>raio ' + n(fase.tendencia_radial * 100, 0) + '%</span></div>';
      if (fase.amplitude_atr != null) {
        pc += '<div class="pag-tri"><span>amplitude ' + n(fase.amplitude_atr, 2) + ' atr</span>' +
              '<span>regul ' + n(fase.regularidade * 100, 0) + '%</span>' +
              '<span>' + (fase.p_vivo != null ? "tick vivo" : "vela") + '</span></div>';
      }
      var T = fase.energia_cinetica || 0, V = fase.energia_potencial || 0, soma = (T + V) || 1;
      pc += '<div class="pag-linha" style="margin-top:5px"><span>T cinetica</span>' +
            '<b style="color:#4fd8ff">' + (T / soma * 100).toFixed(0) + '%</b></div>';
      pc += barra(T / soma, "#4fd8ff");
      pc += '<div class="pag-linha"><span>V potencial</span>' +
            '<b style="color:#ff4fa3">' + (V / soma * 100).toFixed(0) + '%</b></div>';
      pc += barra(V / soma, "#ff4fa3");
      pc += '<div class="pag-sub">' + fase.motivo + '</div>';
    }
    var gf = estado.gatilho_fib;
    if (gf && gf.atual_pct != null) {
      pc += '<div class="pag-tit2">FIBONACCI ' + n(gf.alvo_pct, 1) + '%</div>';
      pc += linha("retracao", n(gf.atual_pct, 1) + "% (" + n(gf.distancia_pct, 1) + ")",
                  gf.na_faixa ? "pag-alta" : "pag-neutro");
    }
    h += secao("fisica", "FISICA (P_cross / fase)", pc,
               fase && fase.ok ? fase.regime : "--");

    // ---------- 5. PROJECAO ----------
    var pj = t.projecao;
    var jc = "", resumoProj = "--";
    if (pj && pj.ok && pj.cone && pj.cone.length) {
      var pri = pj.cone[0], ult = pj.cone[pj.cone.length - 1];
      resumoProj = ult.largura_atr != null ? "\u00b1" + n(ult.largura_atr / 2, 1) + " atr" : "--";

      jc += '<canvas id="pag-cone" width="400" height="250"></canvas>';
      jc += '<div class="pag-tri">' +
            '<span>' + pj.horizonte_velas + ' velas de ' + tfAtual() + '</span>' +
            '<span>gamma ' + n(pj.gamma, 3) + '</span>' +
            '<span>' + pj.subpassos + ' passos' + (pj.estavel ? "" : " TETO") + '</span></div>';

      // As duas faixas em numero tambem: ler amplitude de um desenho e chute.
      jc += '<div class="pag-tit2">FAIXA PROVAVEL</div>';
      jc += linha("t+1 \u00b7 50% central",
                  n(pri.p25, 0) + " .. " + n(pri.p75, 0), "pag-neutro");
      jc += linha("t+" + pj.horizonte_velas + " \u00b7 90% central",
                  n(ult.p05, 0) + " .. " + n(ult.p95, 0), "pag-neutro",
                  "mediana " + n(ult.p50, 0) +
                  (ult.largura_atr != null
                    ? " \u00b7 abertura " + n(ult.largura_atr, 1) + " atr" : ""));

      if (pj.alvos && pj.alvos.length) {
        jc += '<div class="pag-tit2">ALVOS \u00b7 P(toque) / P(fecha alem)</div>';
        jc += '<div class="pag-proj pag-proj-hd"><span>nivel</span>' +
              '<b>preco</b><b>atr</b><b>toca</b><b>fecha</b></div>';
        pj.alvos.forEach(function (a) {
          var cor = a.lado === "acima" ? "pag-alta" : "pag-baixa";
          var v50 = a.velas_para_50
            ? '<span class="pag-proj-v50">50%@t+' + a.velas_para_50 + '</span>' : '';
          jc += '<div class="pag-proj">' +
                '<span class="pag-proj-rot">' + a.rotulo + v50 + '</span>' +
                '<b>' + n(a.preco, 0) + '</b>' +
                '<b class="' + cor + '">' +
                (a.distancia_atr != null ? n(a.distancia_atr, 1) : "--") + '</b>' +
                '<b>' + n(a.p_toque, 0) + '%</b>' +
                '<b style="opacity:.55">' + n(a.p_fecha, 0) + '%</b></div>';
        });
      }
      jc += '<div class="pag-sub">' + pj.motivo +
            ' \u00b7 massa retida ' + n(pj.massa_retida * 100, 1) + '%</div>';
      jc += '<div class="pag-sub" style="opacity:.32">P(toque) e analitico com ' +
            'deriva linearizada; P(fecha) sai da densidade numerica. Sigma de 20 ' +
            'velas tratado como constante: o cone longo e otimista.</div>';
    } else {
      jc += '<div class="pag-sub">' +
            ((pj && pj.motivo) || "aguardando aquecimento") + '</div>';
    }
    h += secao("projecao", "PROJECAO (cone e alvos)", jc, resumoProj);

    // ---------- 6. DIAGNOSTICO DA MATRIZ ----------
    // O diagnostico e sobre a MATRIZ, nao sobre o tempo grafico que o
    // usuario esta olhando. Se o tempo atual ainda nao fechou vela, cair para
    // o que tem mais leituras e mais util que escrever "aguardando" com dado
    // pronto do lado - mas o rotulo tem de dizer de qual tempo esta falando,
    // senao vira numero orfao.
    var _dgs = estado.diagnostico || {};
    var _tfDg = tfAtual();
    if (!(_dgs[_tfDg] && (_dgs[_tfDg].criterios || []).length)) {
      var _melhor = null;
      Object.keys(_dgs).forEach(function (k) {
        var c = (_dgs[k].criterios || []).length;
        if (c && (!_melhor || c > (_dgs[_melhor].criterios || []).length)) _melhor = k;
      });
      if (_melhor) _tfDg = _melhor;
    }
    var dg = _dgs[_tfDg];
    var gc = "", resumoDg = "--";
    if (dg && dg.criterios && dg.criterios.length) {
      var teto = 0;
      dg.criterios.forEach(function (c) { if (c.acendeu > 0) teto += c.peso; });
      resumoDg = _tfDg + " · teto " + teto + "/10";

      if (_tfDg !== tfAtual()) {
        gc += '<div class="pag-sub" style="color:#ffd24f">mostrando ' + _tfDg +
              ' — o tempo em tela (' + tfAtual() + ') ainda nao fechou vela</div>';
      }
      gc += linha("observado", n(dg.horas_observadas, 1) + "h",
                  dg.suficiente ? "pag-ok" : "pag-aviso",
                  dg.leituras + " leituras" +
                  (dg.suficiente ? "" : " — amostra curta, nao concluir ainda"));
      gc += linha("score maximo visto",
                  (dg.score_max != null ? dg.score_max : "--") + "/10",
                  dg.score_max >= 8 ? "pag-ok" : "pag-baixa", "limiar de execucao: 8");

      // O numero que decide se o robo PODE operar: somando so os criterios
      // que ja acenderam alguma vez, da 8? Se nao da, o limiar e inatingivel
      // e nenhuma espera resolve.
      gc += linha("teto alcancavel", teto + "/10",
                  teto >= 8 ? "pag-ok" : "pag-baixa",
                  teto >= 8 ? "o limiar cabe nos criterios vivos"
                            : "com este teto o limiar de 8 e INATINGIVEL");

      gc += '<div class="pag-tit2">CRITERIOS · acendeu / avaliado</div>';
      dg.criterios.slice().sort(function (a, b) { return a.taxa - b.taxa; })
        .forEach(function (c) {
          var morto = c.avaliado >= 30 && c.acendeu === 0;
          gc += '<div class="pag-crit">' +
                '<span class="' + (morto ? "pag-crit-morto" : "") + '">' +
                c.id + (morto ? " · MORTO" : "") + '</span>' +
                '<b>' + c.acendeu + '/' + c.avaliado + '</b>' +
                '<b class="' + (c.taxa > 0 ? "pag-neutro" : "pag-baixa") + '">' +
                n(c.taxa, 0) + '%</b></div>';
          if (c.ultima_falha) {
            gc += '<div class="pag-crit-det">' + c.ultima_falha + '</div>';
          }
        });
      if (dg.histograma) {
        var hs = Object.keys(dg.histograma).map(function (k) {
          return k + "/10 x" + dg.histograma[k];
        }).join("  ");
        if (hs) gc += '<div class="pag-sub">histograma: ' + hs + '</div>';
      }
    } else {
      gc += '<div class="pag-sub">aguardando a primeira vela fechar</div>';
    }
    h += secao("diagnostico", "DIAGNOSTICO DA MATRIZ", gc, resumoDg);

    // ---------- 7. LIQUIDEZ ----------
    var lc = "";
    var nu = estado.nuvem, pf = t.perfil;
    if (nu && nu.ok) {
      lc += linha("desequilibrio (qtd)", n(nu.desequilibrio, 1) + "%",
                  nu.desequilibrio > 5 ? "pag-alta" : nu.desequilibrio < -5 ? "pag-baixa" : "pag-neutro",
                  "bids $" + n(nu.nocional_bid / 1e6, 1) + "M / asks $" +
                  n(nu.nocional_ask / 1e6, 1) + "M");
      lc += linha("paredes", String(nu.paredes.length), "", nu.motivo);
    }
    if (pf && pf.poc) {
      lc += '<div class="pag-tit2">PERFIL DE VOLUME</div>';
      lc += linha("POC", n(pf.poc, 1),
                  pf.dentro_do_valor ? "pag-alta" : "pag-neutro",
                  "valor " + n(pf.val, 0) + " - " + n(pf.vah, 0) +
                  (pf.dentro_do_valor ? " · DENTRO" : " · fora"));
    }
    var ids = Object.keys(estado.linhas);
    lc += '<div class="pag-tit2">SUAS LINHAS (' + ids.length + ')</div>';
    if (!ids.length) {
      lc += '<div class="pag-sub">Desenhe com a ferramenta ray ou horizontal.</div>';
    } else {
      ids.forEach(function (id) {
        var l = estado.linhas[id];
        if (!l || l.friccao_atr == null) return;
        var mf = l.ema_foco === "rapida" ? "EMA8" : "EMA16";
        var seta = l.direcao === "alta" ? "/" : l.direcao === "baixa" ? "\\" : "-";
        // O veredito do rompimento vale mais que a friccao do instante:
        // 'pendente' e uma travessia ainda em julgamento, 'confirmado' e a
        // reta morta, 'falso' e a armadilha ja revelada.
        var vd = l.veredito || "";
        var marca = vd === "confirmado" ? " SEM RETORNO"
                  : vd === "falso" ? " FALSO"
                  : vd === "pendente" ? " julgando " + l.velas_desde_rompimento + "/3"
                  : "";
        var clsV = vd === "confirmado" ? "pag-baixa"
                 : vd === "falso" ? "pag-alta"
                 : vd === "pendente" ? "" : (l.colado ? "pag-alta" : "pag-neutro");
        // Cabecalho da reta: id, direcao, media de foco e o veredito.
        lc += '<div class="pag-linha" style="margin-top:5px">' +
              '<span>' + seta + ' ' + id + ' <span style="opacity:.45">foco ' + mf + '</span></span>' +
              '<b class="' + clsV + '">' + (marca.trim() || "no lugar") + '</b></div>';

        // AS TRES LEITURAS, na mesma unidade (ATR), uma por linha.
        // Ver as tres juntas e o ponto: o preco pode ja ter cruzado
        // enquanto as medias ainda nao chegaram - e e a chegada DELAS que
        // mata a reta, nao o pavio do preco.
        function alvo(rot, v, lado, destaque) {
          if (v == null) return "";
          var c = v > 0 ? "#22e07a" : "#ff5a6e";
          var largura = Math.min(100, Math.abs(v) * 40);
          return '<div class="pag-alvo' + (destaque ? " pag-alvo-foco" : "") + '">' +
                 '<span class="pag-alvo-rot">' + rot + '</span>' +
                 '<span class="pag-barra"><i style="width:' + largura.toFixed(0) +
                 '%;background:' + c + '"></i></span>' +
                 '<span class="pag-alvo-val" style="color:' + c + '">' +
                 (v >= 0 ? "+" : "") + n(v, 2) + '</span>' +
                 '<span class="pag-alvo-lado">' + (lado || "") + '</span></div>';
        }
        lc += alvo("preco", l.friccao_atr, l.lado, false);
        lc += alvo("EMA8", l.friccao_ema_rapida, l.lado_ema_rapida, l.ema_foco === "rapida");
        lc += alvo("EMA16", l.friccao_ema_lenta, l.lado_ema_lenta, l.ema_foco === "lenta");

        if (l.aperto_emas != null) {
          var apertado = l.aperto_emas < 0.35;
          lc += '<div class="pag-sub"' + (apertado ? ' style="color:#f5a623"' : '') + '>' +
                'feixe ' + n(l.aperto_emas, 2) + ' atr de abertura' +
                (apertado ? " - COLADAS, podem atravessar juntas" : "") + '</div>';
        }
        if (l.rompimento_conjunto) {
          lc += '<div class="pag-item pag-blq">AS DUAS MEDIAS ROMPERAM JUNTAS</div>';
        }
        lc += '<div class="pag-sub">' + l.toques + " toques · estresse " + n(l.estresse, 2) +
              " · " + l.velas_no_lado + ' velas deste lado</div>';
      });
    }
    // camadas do grafico
    var s2 = smcPorTF[tf];
    var temAlgumaCamada = Object.values(camadas).some(Boolean);
    lc += '<div class="pag-tit2" style="display:flex;justify-content:space-between;align-items:center;"><span>CAMADAS NO GRAFICO</span><button type="button" id="btn-toggle-camadas-smc" style="background:transparent;border:1px solid #30363d;border-radius:4px;color:var(--t2,#8b949e);font-size:10px;cursor:pointer;padding:1px 6px;">' + (temAlgumaCamada ? 'Ocultar Todas' : 'Mostrar Todas') + '</button></div><div id="pag-camadas">';
    [["ob", "OB", (s2 && s2.order_blocks || []).length],
     ["fvg", "FVG", (s2 && s2.fvg || []).length],
     ["estrutura", "BOS", (s2 && s2.estrutura || []).length],
     ["liquidez", "LIQ", (s2 && s2.liquidez || []).length],
     ["pivos", "pivos", (s2 && s2.pivos || []).length],
     ["pcross", "P_cross", 1],
     ["nuvem", "nuvem", (nu && nu.niveis || []).length],
     ["perfil", "POC", 1],
     ["virada", "virada", 4]].forEach(function (c) {
      lc += '<label class="pag-cam"><input type="checkbox" data-cam="' + c[0] + '"' +
            (camadas[c[0]] ? " checked" : "") + '> ' + c[1] +
            ' <span style="opacity:.4">' + c[2] + '</span></label>';
    });
    lc += '</div>';
    h += secao("liquidez", "LIQUIDEZ E CAMADAS", lc,
               nu && nu.ok ? nu.paredes.length + " paredes" : "--");

    // ---------- eventos ----------
    if (eventos.length) {
      h += '<div class="pag-tit2">EVENTOS</div>';
      eventos.forEach(function (ev) {
        h += '<div class="pag-ev">' + ev.t.toLocaleTimeString("pt-BR") + '  ' + ev.txt + '</div>';
      });
    }

    corpo.innerHTML = h;
    desenharFase();
    desenharCone();

    var btnTogSMC = corpo.querySelector('#btn-toggle-camadas-smc');
    if (btnTogSMC) {
      btnTogSMC.onclick = function(e) {
        e.stopPropagation();
        var ativo = Object.values(camadas).some(Boolean);
        Object.keys(camadas).forEach(function(k) { camadas[k] = !ativo; });
        render();
        desenharSMC();
      };
    }

    // innerHTML apaga handlers: religa depois de cada render.
    corpo.querySelectorAll("input[data-cam]").forEach(function (cb) {
      cb.onchange = function () {
        camadas[cb.dataset.cam] = cb.checked;
        desenharSMC();
      };
    });
    corpo.querySelectorAll(".pag-sec-hd").forEach(function (hd) {
      hd.onclick = function () {
        abertos[hd.dataset.sec] = !abertos[hd.dataset.sec];
        render();
      };
    });
  }

  // ===============================================================
  // CAMADA SMC NO GRAFICO
  // ===============================================================
  //
  // Canvas proprio, em z-index 3: acima do #chart (2) e abaixo do
  // #draw-canvas (5). Nao desenho no draw-canvas porque o `redrawDrawings`
  // do app limpa aquele canvas inteiro a cada traco - as zonas piscariam e
  // sumiriam. Camada separada nao briga com nada.

  var cvSMC = null, ctxSMC = null;
  var smcPorTF = {};
  var camadas = { ob: true, fvg: true, estrutura: true, liquidez: true,
                  pivos: false, virada: true, pcross: true, nuvem: true, perfil: true };

  var CORES = {
    altaFill: "rgba(34,224,122,.13)", altaLinha: "rgba(34,224,122,.75)",
    baixaFill: "rgba(255,90,110,.13)", baixaLinha: "rgba(255,90,110,.75)",
    fvgAlta: "rgba(79,216,255,.10)", fvgAltaLinha: "rgba(79,216,255,.55)",
    fvgBaixa: "rgba(255,181,71,.10)", fvgBaixaLinha: "rgba(255,181,71,.55)",
    liq: "rgba(200,120,255,.85)",
    pcross: "#ff007f", pcrossGlow: "rgba(255,0,127,.85)",
    bid: "0,255,204", ask: "255,0,127",
    poc: "rgba(255,196,0,.9)", valor: "rgba(255,196,0,.25)",
    // A virada tem cor propria e quente: ela nao e uma zona do passado como
    // OB/FVG, e um nivel do FUTURO. Misturar na mesma paleta faria o olho
    // ler as duas coisas como a mesma categoria.
    vira16: "rgba(255,110,64,.95)",
    vira8:  "rgba(255,190,80,.75)"
  };

  function criarCanvasSMC() {
    var chartEl = document.getElementById("chart");
    if (!chartEl || !chartEl.parentElement) return false;
    if (document.getElementById("ag-smc-canvas")) return true;

    cvSMC = document.createElement("canvas");
    cvSMC.id = "ag-smc-canvas";
    cvSMC.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;pointer-events:none";
    chartEl.parentElement.insertBefore(cvSMC, chartEl.nextSibling);
    ctxSMC = cvSMC.getContext("2d");
    return true;
  }

  function dimensionar() {
    if (!cvSMC) return false;
    var el = document.getElementById("chart");
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return false;
    if (cvSMC.width !== Math.round(r.width * dpr) || cvSMC.height !== Math.round(r.height * dpr)) {
      cvSMC.width = Math.round(r.width * dpr);
      cvSMC.height = Math.round(r.height * dpr);
      ctxSMC.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return true;
  }

  /* t2x devolve null para tempo fora da janela visivel. Uma zona que comeca
     antes da borda esquerda ficaria invisivel inteira se eu desistisse no
     null - justamente as zonas antigas, que sao as que mais importam por
     ainda estarem abertas. Entao o tempo e grampeado na janela antes de
     virar pixel. */
  function xDe(tempo, sePassado) {
    if (typeof t2x !== "function" || typeof chart === "undefined") return null;
    var x = t2x(tempo);
    if (x === null || x === undefined || isNaN(x)) {
      if (sePassado) return -200;
      return null;
    }
    return x;
  }

  function yDe(preco) {
    if (typeof p2y !== "function") return null;
    var y = p2y(preco);
    return (y === null || y === undefined) ? null : y;
  }

  function rotulo(txt, x, y, cor) {
    ctxSMC.font = "600 9px ui-monospace,Consolas,monospace";
    var w = ctxSMC.measureText(txt).width + 6;
    ctxSMC.fillStyle = "rgba(10,16,24,.78)";
    ctxSMC.fillRect(x, y - 10, w, 12);
    ctxSMC.fillStyle = cor;
    ctxSMC.fillText(txt, x + 3, y - 1);
  }

  function desenharSMC() {
    if (!ctxSMC || !dimensionar()) return;
    var larg = cvSMC.width / (window.devicePixelRatio || 1);
    var alt = cvSMC.height / (window.devicePixelRatio || 1);
    ctxSMC.clearRect(0, 0, larg, alt);

    var dados = smcPorTF[tfAtual()];
    if (!dados || !conectado) return;

    var direita = larg;
    try { if (typeof plotWidth === "function") direita = plotWidth(); } catch (e) { /* usa a largura toda */ }

    // -- Order Blocks -------------------------------------------------
    if (camadas.ob) {
      (dados.order_blocks || []).forEach(function (o) {
        var y1 = yDe(o.topo), y2 = yDe(o.base);
        if (y1 === null || y2 === null) return;
        var x1 = xDe(o.time, true);
        if (x1 === null) return;
        // zona aberta se estende ate a borda: ela ainda vale hoje
        var x2 = o.mitigado ? xDe(o.time_fim, true) : direita;
        if (x2 === null || x2 <= x1) x2 = direita;
        var alta = o.direcao === "alta";
        ctxSMC.fillStyle = alta ? CORES.altaFill : CORES.baixaFill;
        ctxSMC.fillRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1));
        ctxSMC.strokeStyle = alta ? CORES.altaLinha : CORES.baixaLinha;
        ctxSMC.lineWidth = 1;
        ctxSMC.strokeRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1));
        rotulo("OB " + (o.forca != null ? Math.round(o.forca) + "%" : ""),
               Math.max(4, x1 + 2), Math.min(y1, y2) + 11, alta ? CORES.altaLinha : CORES.baixaLinha);
      });
    }

    // -- Fair Value Gaps ----------------------------------------------
    if (camadas.fvg) {
      (dados.fvg || []).forEach(function (g) {
        var y1 = yDe(g.topo), y2 = yDe(g.base);
        if (y1 === null || y2 === null) return;
        var x1 = xDe(g.time, true);
        if (x1 === null) return;
        var x2 = g.mitigado ? xDe(g.time_fim, true) : direita;
        if (x2 === null || x2 <= x1) x2 = direita;
        var alta = g.direcao === "alta";
        ctxSMC.fillStyle = alta ? CORES.fvgAlta : CORES.fvgBaixa;
        ctxSMC.fillRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1));
        ctxSMC.strokeStyle = alta ? CORES.fvgAltaLinha : CORES.fvgBaixaLinha;
        ctxSMC.setLineDash([3, 3]);
        ctxSMC.lineWidth = 1;
        ctxSMC.strokeRect(x1, Math.min(y1, y2), x2 - x1, Math.abs(y2 - y1));
        ctxSMC.setLineDash([]);
        rotulo("FVG", Math.max(4, x1 + 2), Math.min(y1, y2) + 11, alta ? CORES.fvgAltaLinha : CORES.fvgBaixaLinha);
      });
    }

    // -- BOS / CHoCH ---------------------------------------------------
    if (camadas.estrutura) {
      (dados.estrutura || []).forEach(function (e) {
        var y = yDe(e.nivel);
        if (y === null) return;
        var x1 = xDe(e.time, true), x2 = xDe(e.time_quebra, true);
        if (x1 === null) return;
        if (x2 === null || x2 <= x1) x2 = direita;
        var alta = e.direcao === "alta";
        var cor = alta ? CORES.altaLinha : CORES.baixaLinha;
        ctxSMC.strokeStyle = cor;
        ctxSMC.lineWidth = e.tipo === "CHoCH" ? 2 : 1;
        ctxSMC.setLineDash(e.tipo === "CHoCH" ? [] : [6, 4]);
        ctxSMC.beginPath();
        ctxSMC.moveTo(x1, y);
        ctxSMC.lineTo(x2, y);
        ctxSMC.stroke();
        ctxSMC.setLineDash([]);
        rotulo(e.tipo + " " + (alta ? "^" : "v"), Math.max(4, Math.min(x2 - 42, direita - 50)), y - 2, cor);
      });
    }

    // -- Liquidez ------------------------------------------------------
    if (camadas.liquidez) {
      (dados.liquidez || []).forEach(function (l) {
        var y = yDe(l.nivel);
        if (y === null) return;
        var x1 = xDe(l.time, true);
        if (x1 === null) return;
        var x2 = l.varrido ? xDe(l.time_varredura, true) : direita;
        if (x2 === null || x2 <= x1) x2 = direita;
        ctxSMC.strokeStyle = CORES.liq;
        ctxSMC.lineWidth = 1;
        ctxSMC.setLineDash([2, 4]);
        ctxSMC.beginPath();
        ctxSMC.moveTo(x1, y);
        ctxSMC.lineTo(x2, y);
        ctxSMC.stroke();
        ctxSMC.setLineDash([]);
        rotulo(l.varrido ? "LIQ varrida" : "LIQ", Math.max(4, x1 + 2), y - 2, CORES.liq);
      });
    }

    // -- Niveis de virada das medias (engenharia reversa) --------------
    //
    // Isto NAO e um indicador do passado: e o preco em que a EMA passa a
    // apontar para o angulo alvo na proxima vela. Por isso vem como linha
    // cheia com rotulo de preco - e um nivel operavel, nao um rastro.
    //
    // Nivel inalcancavel (a media inclinada demais para virar numa vela) e
    // OMITIDO em vez de desenhado fora da tela: linha que some na borda faz
    // o operador procurar o que nao existe.
    if (camadas.virada) {
      var est = estado.tempos[tfAtual()];
      var vd = est && est.direcional && est.direcional.virada;
      if (vd) {
        [["lenta_0", CORES.vira16, "EMA16 achata", 1.6],
         ["lenta_+1", CORES.vira16, "EMA16 +1", 0.8],
         ["lenta_-1", CORES.vira16, "EMA16 -1", 0.8],
         ["rapida_0", CORES.vira8, "EMA8 achata", 1.0]].forEach(function (cfgN) {
          var v = vd[cfgN[0]];
          if (!v || !v.alcancavel || v.preco == null) return;
          var y = yDe(v.preco);
          if (y === null) return;

          var txt = cfgN[2] + "  " + v.preco.toFixed(1) +
                    "  (" + (v.distancia_pct >= 0 ? "+" : "") + v.distancia_pct.toFixed(2) + "%)";

          // O nivel de virada costuma ficar FORA da janela de precos visivel -
          // e da natureza dele: e onde o preco ainda nao esta. priceToCoordinate
          // devolve coordenada fora do canvas nesse caso, e a linha seria
          // desenhada onde ninguem ve. Em vez de sumir em silencio, o nivel e
          // fixado na borda com uma seta apontando para onde ele esta. Some-lo
          // seria pior que mostra-lo torto: quem opera precisa saber que existe.
          var foraCima = y < 2, foraBaixo = y > alt - 2;
          if (foraCima || foraBaixo) {
            var yb = foraCima ? 9 : alt - 3;
            ctxSMC.strokeStyle = cfgN[1];
            ctxSMC.lineWidth = 1;
            ctxSMC.setLineDash([2, 6]);
            ctxSMC.beginPath();
            ctxSMC.moveTo(0, yb);
            ctxSMC.lineTo(direita, yb);
            ctxSMC.stroke();
            ctxSMC.setLineDash([]);
            rotulo((foraCima ? "^ " : "v ") + txt, 6, yb + (foraCima ? 10 : -2), cfgN[1]);
            return;
          }

          ctxSMC.strokeStyle = cfgN[1];
          ctxSMC.lineWidth = cfgN[3];
          ctxSMC.setLineDash(cfgN[0].indexOf("_0") > 0 ? [] : [5, 5]);
          ctxSMC.beginPath();
          ctxSMC.moveTo(0, y);
          ctxSMC.lineTo(direita, y);
          ctxSMC.stroke();
          ctxSMC.setLineDash([]);
          rotulo(txt, 6, y - 2, cfgN[1]);
        });
      }
    }

    // -- PERFIL DE VOLUME: a camada larga --------------------------------
    //
    // Vem primeiro por ser fundo: POC e area de valor cobrem percentuais
    // inteiros, enquanto a nuvem do livro vive em +-0.17%.
    if (camadas.perfil) {
      var estP = estado.tempos[tfAtual()];
      var pf = estP && estP.perfil;
      if (pf && pf.poc) {
        // Area de valor: SO contorno. Com o grafico aberto em semanas ela
        // cobre 10% do preco, e um bloco solido nessa altura vira uma parede
        // amarela que engole candle, EMA e o proprio P_cross.
        var yV = yDe(pf.val), yA = yDe(pf.vah);
        if (yV !== null && yA !== null) {
          ctxSMC.fillStyle = "rgba(255,196,0,.045)";
          ctxSMC.fillRect(0, Math.min(yV, yA), direita, Math.abs(yV - yA));
          ctxSMC.strokeStyle = "rgba(255,196,0,.35)";
          ctxSMC.lineWidth = 1;
          ctxSMC.setLineDash([2, 6]);
          ctxSMC.beginPath();
          ctxSMC.moveTo(0, yV); ctxSMC.lineTo(direita, yV);
          ctxSMC.moveTo(0, yA); ctxSMC.lineTo(direita, yA);
          ctxSMC.stroke();
          ctxSMC.setLineDash([]);
          rotulo("VAL " + pf.val.toFixed(0), 4, yV - 2, "rgba(255,196,0,.75)");
          rotulo("VAH " + pf.vah.toFixed(0), 4, yA - 2, "rgba(255,196,0,.75)");
        }
        var yPoc = yDe(pf.poc);
        if (yPoc !== null) {
          ctxSMC.strokeStyle = CORES.poc;
          ctxSMC.lineWidth = 1.6;
          ctxSMC.setLineDash([10, 4]);
          ctxSMC.beginPath();
          ctxSMC.moveTo(0, yPoc); ctxSMC.lineTo(direita, yPoc); ctxSMC.stroke();
          ctxSMC.setLineDash([]);
          rotulo("POC " + pf.poc.toFixed(0), 4, yPoc - 2, CORES.poc);
        }
      }
    }

    // -- NUVEM DE LIQUIDEZ: histograma do livro na borda direita ---------
    //
    // Desenhada como barras a partir da direita, e nao como faixas que
    // atravessam a tela: o livro inteiro cabe em +-0.17% do preco, entao
    // faixas horizontais viravam uma mancha unica em cima do candle. Barra
    // por profundidade e a leitura natural de livro, e nao tapa o preco.
    if (camadas.nuvem && estado.nuvem && estado.nuvem.ok) {
      var nv = estado.nuvem;
      var largMax = 78;
      (nv.niveis || []).forEach(function (lv) {
        var y = yDe(lv.preco);
        if (y === null) return;
        var rgb = lv.lado === "bid" ? CORES.bid : CORES.ask;
        var w = Math.max(2, lv.densidade * largMax);
        ctxSMC.fillStyle = "rgba(" + rgb + "," + (0.18 + lv.densidade * 0.5) + ")";
        ctxSMC.fillRect(direita - w, y - 2.5, w, 5);
        if (lv.parede) {
          ctxSMC.strokeStyle = "rgba(" + rgb + ",.95)";
          ctxSMC.lineWidth = 1;
          ctxSMC.strokeRect(direita - w, y - 2.5, w, 5);
          rotulo("PAREDE", direita - w - 48, y + 2, "rgba(" + rgb + ",1)");
        }
      });
      // desequilibrio do livro, no topo da coluna
      var dq = nv.desequilibrio;
      if (dq != null) {
        var corDq = dq > 0 ? "rgba(" + CORES.bid + ",1)" : "rgba(" + CORES.ask + ",1)";
        rotulo("LIVRO " + (dq >= 0 ? "+" : "") + dq.toFixed(0) + "%", direita - 82, 14, corDq);
      }
    }

    // -- P_cross: o alvo movel do cruzamento das EMAs --------------------
    //
    // Duas coisas distintas na tela: a LINHA no nivel do P_cross atual, e o
    // PONTO projetado uma vela a frente (p_cross_t1), que e a coordenada
    // futura. Sem o ponto, o alvo parece estatico; sem a linha, nao da pra
    // ver se o preco esta indo nele.
    if (camadas.pcross) {
      var est = estado.tempos[tfAtual()];
      var cz = est && est.direcional && est.direcional.cruzamento;
      if (cz && cz.p_cross) {
        var yC = yDe(cz.p_cross);
        if (yC !== null) {
          // O P_cross e o alvo do sistema inteiro: desenhado com brilho e
          // rotulado nas DUAS pontas, para nao se perder em zoom largo.
          ctxSMC.save();
          ctxSMC.shadowColor = CORES.pcrossGlow;
          ctxSMC.shadowBlur = 8;
          ctxSMC.strokeStyle = CORES.pcross;
          ctxSMC.lineWidth = 2.2;
          ctxSMC.setLineDash([9, 5]);
          ctxSMC.beginPath();
          ctxSMC.moveTo(0, yC);
          ctxSMC.lineTo(direita, yC);
          ctxSMC.stroke();
          ctxSMC.restore();
          ctxSMC.setLineDash([]);
          rotulo("P_cross " + cz.p_cross.toFixed(1), 4, yC - 3, CORES.pcross);
          rotulo("P_cross", direita - 52, yC - 3, CORES.pcross);
        }
        // ponto neon uma coluna a frente
        var alvo = cz.p_cross_t1 || cz.p_cross;
        var yP = yDe(alvo);
        // time_alvo e uma vela ADIANTE do ultimo fechamento, entao com o
        // grafico rolado para tras ele cai fora da janela e t2x devolve
        // null. Ancorar na borda direita mantem o alvo visivel em vez de
        // sumir justamente quando se olha o historico.
        var xP = cz.time_alvo ? xDe(cz.time_alvo, false) : null;
        if (xP === null || xP === undefined || xP > direita - 8) xP = direita - 14;
        if (yP !== null) {
          ctxSMC.save();
          ctxSMC.shadowColor = CORES.pcrossGlow;
          ctxSMC.shadowBlur = 14;
          ctxSMC.fillStyle = CORES.pcross;
          ctxSMC.beginPath();
          ctxSMC.arc(xP, yP, 5.5, 0, Math.PI * 2);
          ctxSMC.fill();
          ctxSMC.restore();
          // trilho do preco atual ate o alvo
          var yAgora = yDe(est.preco);
          if (yAgora !== null) {
            ctxSMC.strokeStyle = "rgba(255,0,127,.35)";
            ctxSMC.setLineDash([2, 4]);
            ctxSMC.beginPath();
            ctxSMC.moveTo(xP, yAgora);
            ctxSMC.lineTo(xP, yP);
            ctxSMC.stroke();
            ctxSMC.setLineDash([]);
          }
          var col = est && est.colisao;
          if (col && col.ok && col.p_toque != null) {
            rotulo(col.p_toque.toFixed(1) + "% toque", xP + 9, yP - 2, CORES.pcross);
          }
        }
      }
    }

    // -- Pivos ---------------------------------------------------------
    if (camadas.pivos) {
      (dados.pivos || []).forEach(function (p) {
        var x = xDe(p.time, false), y = yDe(p.preco);
        if (x === null || y === null) return;
        ctxSMC.fillStyle = p.tipo === "topo" ? CORES.baixaLinha : CORES.altaLinha;
        ctxSMC.beginPath();
        ctxSMC.arc(x, y, 2.5, 0, Math.PI * 2);
        ctxSMC.fill();
      });
    }
  }

  /* Redesenha quando a janela do grafico muda (pan, zoom, resize).
     A assinatura do lightweight-charts e a via limpa; o rAF comparando a
     faixa e a rede de seguranca para versoes que nao exponham o evento. */
  var faixaAnterior = "";
  function loopRedesenho() {
    try {
      if (typeof chart !== "undefined" && chart && typeof candleSeries !== "undefined" && candleSeries) {
        var lr = chart.timeScale().getVisibleLogicalRange();
        var p0 = candleSeries.coordinateToPrice(10);
        var p1 = candleSeries.coordinateToPrice(200);
        var chave = (lr ? (lr.from.toFixed(2) + "_" + lr.to.toFixed(2)) : "") + "_" + (p0 != null ? p0.toFixed(2) : "") + "_" + (p1 != null ? p1.toFixed(2) : "");
        if (chave !== faixaAnterior) {
          faixaAnterior = chave;
          desenharSMC();
        }
      }
    } catch (e) { /* grafico ainda montando */ }
    requestAnimationFrame(loopRedesenho);
  }

  // ---------------------------------------------------------------
  // PARTIDA
  // ---------------------------------------------------------------

  function iniciar() {
    criarPainel();
    // O main.js define redrawDrawings no escopo global, mas o momento em
    // que ele roda depende do carregamento. Tento algumas vezes em vez de
    // assumir que ja esta la.
    var tentativas = 0;
    var t = setInterval(function () {
      if (instalarGancho() || ++tentativas > 40) clearInterval(t);
    }, 250);
    // A camada SMC precisa do #chart montado; ele nasce depois do main.js.
    var tc = 0;
    var tcv = setInterval(function () {
      if (criarCanvasSMC() || ++tc > 60) {
        clearInterval(tcv);
        requestAnimationFrame(loopRedesenho);
      }
    }, 250);
    window.addEventListener("resize", function () { setTimeout(desenharSMC, 120); });
    conectar();
    // Rede de seguranca: se algum caminho de desenho nao passar por
    // redrawDrawings, o sync periodico pega. So envia quando mudou.
    setInterval(function () { sincronizar(false); }, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }

  window.ponteAntiGravity = {
    estado: function () { return estado; },
    sincronizar: function () { sincronizar(true); },
    conectado: function () { return conectado; },
    camadas: function () { return camadas; },
    setAllCamadas: function(val) {
      Object.keys(camadas).forEach(function(k) { camadas[k] = val; });
      try { render(); } catch(e) {}
      desenharSMC();
    },
    restoreCamadas: function(saved) {
      if (!saved) return;
      Object.keys(saved).forEach(function(k) { camadas[k] = saved[k]; });
      try { render(); } catch(e) {}
      desenharSMC();
    }
  };
  window._ponteCamadas = camadas;
  window.setAllPonteCamadas = function(val) {
    window.ponteAntiGravity.setAllCamadas(val);
  };
  window.restorePonteCamadas = function(saved) {
    window.ponteAntiGravity.restoreCamadas(saved);
  };
})();
