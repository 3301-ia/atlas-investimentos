/* Ticket de posicionamento: le as ordens do dono e mostra risco, media e distancia. */
(function(){
  var caixa=null, dados=null, ultimo=null;
  function preco(){ if(window.AtlasMercado&&AtlasMercado.preco) return AtlasMercado.preco; return ultimo; }
  function pinta(){
    if(!caixa||!dados) return;
    var p=preco()||0, ord=dados.ordens||[], alvo=dados.alvo;
    var somaE=0,somaS=0,n=0;
    ord.forEach(function(o){ if(o.entrada){somaE+=o.entrada;somaS+=o.stop;n++;} });
    var media=n?somaE/n:0, stopMedio=n?somaS/n:0;
    var risco=media-stopMedio, pct=media?(p-media)/media*100:0;
    var h="<div class=vx-ticket-topo><span>POSIÇÃO</span><span class=vx-ticket-preco>"+p.toFixed(0)+"</span></div>";
    ord.forEach(function(o,i){
      var r=o.entrada-o.stop;
      h+="<div class=vx-ticket-linha><b>"+(i+1)+"</b> "+o.entrada.toFixed(0)+" <span class=vx-fraco>stop "+o.stop.toFixed(0)+" · risco "+r.toFixed(0)+" pts</span></div>";
    });
    h+="<div class=vx-ticket-resumo>média "+media.toFixed(0)+" · stop médio "+stopMedio.toFixed(0)+"<br>risco "+risco.toFixed(0)+" pts · alvo "+alvo.toFixed(0)+" (ganho "+(alvo-media).toFixed(0)+")<br>agora "+pct.toFixed(2)+"% da média</div>";
    caixa.innerHTML=h;
  }
  function carrega(){
    fetch("observador/historico/posicoes.json?t="+Date.now(),{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(d){ dados=d; pinta(); });
  }
  function precoVivo(){
    fetch("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT").then(function(r){return r.json()}).then(function(j){ ultimo=parseFloat(j.data[0].last); pinta(); }).catch(function(){});
  }
  function inicia(){
    if(document.getElementById("vx-ticket")){ caixa=document.getElementById("vx-ticket"); return; }
    caixa=document.createElement("div"); caixa.id="vx-ticket"; document.body.appendChild(caixa);
    carrega(); precoVivo(); setInterval(function(){ precoVivo(); },60000); setInterval(carrega,300000);
  }
  if(document.readyState!=="loading") setTimeout(inicia,2200); else document.addEventListener("DOMContentLoaded",function(){setTimeout(inicia,2200)});
})();
