(function(){
  var el=null;
  function txt(d,p){
    try{
      var ord=d.ordens||[], se=0, ss=0;
      for(var i=0;i<ord.length;i++){ se+=Number(ord[i].entrada); ss+=Number(ord[i].stop); }
      var n=ord.length||1, media=se/n, smed=ss/n, risco=media-smed, alvo=Number(d.alvo||0);
      var pc=Number(p||0); if(!pc && window.AtlasMercado) pc=Number(AtlasMercado.preco||0);
      var h="<div class=vx-ticket-topo><span>POSIÇÃO</span><span class=vx-ticket-preco>"+(pc?pc.toFixed(0):"--")+"</span></div>";
      for(var k=0;k<ord.length;k++){ h+="<div class=vx-ticket-linha><b>"+(k+1)+"</b> "+Number(ord[k].entrada).toFixed(0)+" <span class=vx-fraco>stop "+Number(ord[k].stop).toFixed(0)+" · risco "+(Number(ord[k].entrada)-Number(ord[k].stop)).toFixed(0)+" pts</span></div>"; }
      h+="<div class=vx-ticket-resumo>média "+media.toFixed(0)+" · stop médio "+smed.toFixed(0)+"<br>risco "+risco.toFixed(0)+" pts · alvo "+alvo.toFixed(0)+" (ganho "+(alvo-media).toFixed(0)+")<br>"+(pc?("agora "+((pc-media)/media*100).toFixed(2)+"% da média"):"lendo preço")+"</div>";
      el.innerHTML=h;
    }catch(e){ el.innerHTML="<div class=vx-ticket-topo><span>POSIÇÃO</span></div><div class=vx-ticket-resumo>erro: "+e.message+"</div>"; }
  }
  function buscar(){
    fetch("/observador/historico/posicoes.json?t="+Date.now(),{cache:"no-store"}).then(function(r){return r.json()}).then(function(d){
      fetch("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT").then(function(r){return r.json()}).then(function(j){ txt(d,j.data[0].last); }).catch(function(){ txt(d,0); });
    }).catch(function(e){ if(el) el.innerHTML="<div class=vx-ticket-topo><span>POSIÇÃO</span></div><div class=vx-ticket-resumo>sem arquivo: "+e.message+"</div>"; });
  }
  function inicia(){
    if(document.getElementById("vx-ticket")){ el=document.getElementById("vx-ticket"); return; }
    el=document.createElement("div"); el.id="vx-ticket"; document.body.appendChild(el); buscar(); setInterval(buscar,60000);
  }
  if(document.readyState!=="loading") setTimeout(inicia,1800); else document.addEventListener("DOMContentLoaded",function(){setTimeout(inicia,1800)});
})();
