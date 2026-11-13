/* Sinais em papel: imprime na tela o que o robô decidiu e por quê. */
(function(){
  var pasta = "observador/historico/";
  var caixa = null;
  function pega(a){ return fetch(pasta+a+"?t="+Date.now(),{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).catch(function(){return null}); }
  function linha(t, e){
    if(!e) return "";
    var es = e.estrutura||{}, cf = e.confluencia||{}, ab = e.aberta||{};
    var acao = (e.acoes&&e.acoes.length)? e.acoes[e.acoes.length-1].motivo : (ab.lado? "ordem aberta: "+ab.lado : "sem ordem");
    return "<div class=vx-sinal-linha><b>"+t+"</b> "+es.lado+" <span class=vx-fraco>folga "+(es.folga_pct==null?"-":es.folga_pct)+"%</span> "+
      (cf.forca!=null? "<span class=vx-voto>confluencia "+cf.forca+"</span>" : "")+
      "<div class=vx-motivo>"+acao+"</div></div>";
  }
  function monta(){
    Promise.all([pega("posicoes.json"),pega("robopapel_estado.json"),pega("robopapel_estado_15m.json"),pega("robopapel_estado_5m.json"),pega("sinais_confluencia.json")]).then(function(r){
      if(!caixa||!document.body.contains(caixa)) return;
      var h = "<div class=vx-sinais-topo><span>SINAIS EM PAPEL</span><button id=vx-sinais-fecha aria-label=\"recolher\">×</button></div>";
      h += linha("1H", r[1]) + linha("15M", r[2]) + linha("5M", r[3]);
      var pos = r[0];
      if (pos && pos.ordens && pos.ordens.length) {
        var se = 0, ss = 0;
        for (var i = 0; i < pos.ordens.length; i++) { se += Number(pos.ordens[i].entrada); ss += Number(pos.ordens[i].stop); }
        var n = pos.ordens.length, media = se / n, smed = ss / n;
        h += "<div class=vx-sinal-linha><b>POSIÇÃO</b> compra " + pos.ordens.length + " lotes"
          + "<div class=vx-motivo>média " + media.toFixed(0) + " · stop médio " + smed.toFixed(0)
          + " · risco " + (media - smed).toFixed(0) + " pts<br>alvo " + Number(pos.alvo).toFixed(0)
          + " · ganho " + (Number(pos.alvo) - media).toFixed(0) + " pts</div></div>";
      }
      var c = r[4]||{}, res = c.resumo||{};
      if(res["0"]){var g=res["0"], m=(g.soma/g.n), ac=Math.round((g.acerto||0)/g.n*100); h += "<div class=vx-sinal-resumo>sem confluencia: "+g.n+" sinais, "+m.toFixed(2)+"% medio ("+ac+"% de acerto)</div>";}
      caixa.innerHTML = h;
      var b = document.getElementById("vx-sinais-fecha");
      if(b) b.onclick = function(){ caixa.classList.toggle("recolhido"); };
    });
  }
  function inicia(){
    if(document.getElementById("vx-sinais")) { caixa = document.getElementById("vx-sinais"); return; }
    caixa = document.createElement("div"); caixa.id = "vx-sinais"; document.body.appendChild(caixa);
    monta(); setInterval(monta, 60000);
  }
  if(document.readyState!=="loading") setTimeout(inicia,1500); else document.addEventListener("DOMContentLoaded",function(){setTimeout(inicia,1500)});
})();
