// ══════════════════════════════════════════════════════
// WS LIVE
// ══════════════════════════════════════════════════════
let rtInterval = null;
let serverTimeOffset = 0; // Sincronização de relógio atômico com a Binance
let lastTradeAt = 0;      // ultimo aggTrade recebido (decide se o fallback REST roda)
let lastTitleAt = 0;      // throttle da atualizacao do titulo da aba

function tfToSeconds(tf) {
  const v = parseInt(tf);
  if(tf.includes('m')) return v * 60;
  if(tf.includes('h')) return v * 3600;
  if(tf.includes('w')) return v * 604800;
  if(tf.includes('d')) return v * 86400;
  return 60;
}

// ── Coalescencia de ticks ─────────────────────────────
// O BTC dispara dezenas de aggTrades por segundo. Renderizar cada um trava a
// aba. Aqui guardamos apenas o ultimo preco e desenhamos uma vez por frame
// (~60fps), o que da movimento continuo sem sobrecarregar o navegador.
let pendingTick=null, tickScheduled=false, h1StochCache={k:null,d:null}, h1StochAt=0;

function forceChartTick(price, ts_ms){
  pendingTick={price,ts:ts_ms};
  if(tickScheduled)return;
  tickScheduled=true;
  requestAnimationFrame(()=>{tickScheduled=false;const t=pendingTick;pendingTick=null;if(t)applyTick(t.price,t.ts);});
}

function applyTick(price, ts_ms){
  if(!candles.length||!candleSeries)return;
  let last=candles[candles.length-1];
  const tfSec=tfToSeconds(currentTF);
  const nowSec=Math.floor(ts_ms/1000);
  const expected=nowSec-(nowSec%tfSec);
  let closed=false;

  // Se a aba ficou em segundo plano (requestAnimationFrame pausa quando a aba
  // nao esta visivel), o proximo tick ao voltar pode saltar varios intervalos
  // de uma vez. Criar uma unica vela la na frente deixaria um buraco vazio no
  // meio do grafico — em vez disso, recarrega o historico do zero, sem buraco.
  // Removido o loadAll() agressivo para evitar loop infinito de reload e lentidao
  // if(expected>last.time+tfSec){
  //   loadAll();
  //   return;
  // }

  // Virada de vela sintetica: cria a nova vela localmente ao cruzar a grade
  if(expected>last.time){
    commitLiveState(last.close);   // fecha os indicadores na vela que terminou
    closed=true;
    const newC={time:expected,open:price,high:price,low:price,close:price,volume:0};
    candles.push(newC);
    if(candles.length>1000)candles.shift();
    last=newC;
    try{candleSeries.update(newC);}catch(e){}
  }else{
    last.close=price;
    if(price>last.high)last.high=price;
    if(price<last.low)last.low=price;
    try{candleSeries.update({time:last.time,open:last.open,high:last.high,low:last.low,close:last.close});}catch(e){}
  }

  updateLiveIndicators(last.time,price);

  // Ao virar a vela, roda o motor de sinais uma unica vez (nao a cada tick)
  if(closed&&candles.length>250){
    try{
      const closes=candles.map(x=>x.close),highs=candles.map(x=>x.high),
            lows=candles.map(x=>x.low),opens=candles.map(x=>x.open);
      runSignals(closes,highs,lows,opens);
    }catch(e){}
  }
}

// Avanca TODAS as medias e o StochRSI em O(1) a partir do baseline confirmado
function updateLiveIndicators(time,px){
  try{
    const k=p=>2/(p+1);
    const e8=px*k(8)+(liveState.ema8??px)*(1-k(8));
    const e16=px*k(16)+(liveState.ema16??px)*(1-k(16));
    const e55=px*k(55)+(liveState.ema55??px)*(1-k(55));
    const e98=px*k(98)+(liveState.ema98??px)*(1-k(98));
    const e200=px*k(200)+(liveState.ema200??px)*(1-k(200));
    const up=(s,v)=>{if(v!=null&&s)try{s.update({time,value:v});}catch(e){}};
    up(maS.ema8,e8);up(maS.ema16,e16);up(maS.ema55,e55);up(maS.ema98,e98);up(maS.ema200,e200);

    const w56=liveState.sma56Win.length===56?liveState.sma56Win:liveState.sma56Win.slice(-56);
    const w89=liveState.sma89Win.length===89?liveState.sma89Win:liveState.sma89Win.slice(-89);
    let m56v = null, m89v = null;
    if(w56.length>=55){ m56v=(w56.reduce((a,b)=>a+b,0)+px)/(w56.length+1); up(maS.ma56,m56v); }
    if(w89.length>=88){ m89v=(w89.reduce((a,b)=>a+b,0)+px)/(w89.length+1); up(maS.ma89,m89v); }

    if (window.globalMAs && window.globalMAs.atr) {
        const liveAngles = {};
        const atrNow = window.globalMAs.atr[window.globalMAs.atr.length-1];
        
        const calcLiveAngle = (liveNow, arr) => {
            if (!arr || arr.length < DIRECAO_LOOKBACK + 1) return null;
            const then = arr[arr.length - DIRECAO_LOOKBACK];
            if(liveNow==null||then==null||atrNow==null||atrNow===0)return null;
            const slope=(liveNow-then)/(DIRECAO_LOOKBACK*atrNow);
            return Math.atan(slope*DIRECAO_GAIN)*180/Math.PI;
        };

        liveAngles['ema8'] = calcLiveAngle(e8, window.globalMAs.ema8);
        liveAngles['ema16'] = calcLiveAngle(e16, window.globalMAs.ema16);
        liveAngles['ema55'] = calcLiveAngle(e55, window.globalMAs.ema55);
        liveAngles['ema98'] = calcLiveAngle(e98, window.globalMAs.ema98);
        liveAngles['ema200'] = calcLiveAngle(e200, window.globalMAs.ema200);
        liveAngles['ma56'] = calcLiveAngle(m56v, window.globalMAs.ma56);
        liveAngles['ma89'] = calcLiveAngle(m89v, window.globalMAs.ma89);
        
        const cls = classifyDirecao(liveAngles);
        renderDirecaoCompass(liveAngles);
        renderDirecaoReadout(liveAngles, cls);
    }

    // StochRSI ao vivo a partir do RSI incremental
    const rs=rsiStep(liveState.rsiBase,px,P.rsiLen);
    if(rs){
      const hist=[...liveState.rsiHist,rs.value].slice(-(P.stochLen+P.kSmooth+P.dSmooth+5));
      const sD=stochCalc(hist,P.stochLen),kD=sma(sD,P.kSmooth),dD=sma(kD,P.dSmooth);
      const kv=kD[kD.length-1],dv=dD[dD.length-1];
      up(stochK,kv);up(stochD,dv);
      // H1 so recalcula a cada 15s (antes rodava a cada trade sobre 200 velas)
      if(Date.now()-h1StochAt>15000){h1StochCache=calcH1Stoch();h1StochAt=Date.now();}
      if(kv!=null)updateStochPanel(kv,dv,h1StochCache);
    }
  }catch(e){}
}

// Fixa os valores da vela recem-fechada como novo baseline confirmado
function commitLiveState(closePx){
  const k=p=>2/(p+1);
  liveState.ema8=closePx*k(8)+(liveState.ema8??closePx)*(1-k(8));
  liveState.ema16=closePx*k(16)+(liveState.ema16??closePx)*(1-k(16));
  liveState.ema55=closePx*k(55)+(liveState.ema55??closePx)*(1-k(55));
  liveState.ema98=closePx*k(98)+(liveState.ema98??closePx)*(1-k(98));
  liveState.ema200=closePx*k(200)+(liveState.ema200??closePx)*(1-k(200));
  liveState.sma56Win=[...liveState.sma56Win,closePx].slice(-56);
  liveState.sma89Win=[...liveState.sma89Win,closePx].slice(-89);
  const rs=rsiStep(liveState.rsiBase,closePx,P.rsiLen);
  if(rs){
    liveState.rsiBase={ag:rs.ag,al:rs.al,last:rs.last};
    liveState.rsiHist=[...liveState.rsiHist,rs.value].slice(-(P.stochLen+P.kSmooth+P.dSmooth+5));
  }
}

function updatePriceUI(p){
  const rt=document.getElementById('rt-price');
  if(rt)rt.textContent=`$${p.toFixed(2)}`;
  const big=document.getElementById('big-price'),bigSym=document.getElementById('big-sym');
  if(big){
    const oldP=parseFloat(big.dataset.p||p);
    big.textContent=`$${p.toFixed(2)}`;
    big.dataset.p=p;
    big.style.color=p>=oldP?'var(--green)':'var(--red)';
  }
  if(bigSym)bigSym.textContent=currentSym.replace('USDT','');
  // updatePriceUI ja so roda 1x por frame (coalescido no forceChartTick/applyTick),
  // entao o titulo pode atualizar sempre — o throttle extra de 500ms so criava
  // uma defasagem visivel entre o titulo da aba e o preco na tela.
  document.title=`${p.toFixed(2)} | ${currentSym.replace('USDT','')}`;
}

function openWS(){
  if(wsKline){
    wsKline.close();
  }
  if(rtInterval)clearInterval(rtInterval);

  const symL=currentSym.toLowerCase();
  const wantedSym=currentSym; // guarda o simbolo desta conexao
  // Multiplex: velas (kline) + todas as execucoes em tempo real (aggTrade)
  const urlGen = () => `wss://fstream.binance.com/stream?streams=${symL}@kline_${currentTF}/${symL}@aggTrade`;
  
  const onMsg = ev => {
    try{
      if(currentSym!==wantedSym)return; // ignora mensagens de um simbolo ja trocado
      const payload=JSON.parse(ev.data);
      if(!payload||!payload.stream)return;
      const stream=payload.stream,d=payload.data;
      if(d.E)serverTimeOffset=d.E-Date.now();

      // 1) AGGTRADE: preco direto da execucao, delay zero
      if(stream.includes('@aggTrade')){
        const p=parseFloat(d.p);
        lastTradeAt=Date.now();
        updatePriceUI(p);
        const ts = d.T || Date.now();
        forceChartTick(p, ts); // coalescido por frame
        if(typeof mtfViewOpen !== 'undefined' && mtfViewOpen){
            for(let i=1; i<=4; i++) applyMtfTick(i, p, ts);
        }
        return;
      }

      // 2) KLINE: estrutura oficial da vela (OHLC + volume)
      if(!stream.includes('@kline'))return;
      const k=d.k;if(!k)return;
      const c={time:Math.floor(k.t/1000),open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v};
      const last=candles[candles.length-1];
      if(last&&c.time<last.time)return; // fora de ordem

      if(last&&last.time===c.time){
        c.high=Math.max(c.high,last.high);
        c.low=Math.min(c.low,last.low);
        c.close=last.close; // mantem o close do aggTrade, evita pulo pra tras
        candles[candles.length-1]=c;
      }else if(!last||c.time>last.time){
        if(last)commitLiveState(last.close); // vela anterior fechou de fato
        candles.push(c);
        if(candles.length>1000)candles.shift();
      }

      try{candleSeries.update({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close});}catch(e){}
      try{volS.update({time:c.time,value:c.volume,color:c.close>=c.open?'rgba(0,230,118,.15)':'rgba(244,67,54,.15)'});}catch(e){}

      updateLiveIndicators(c.time,c.close);

      // Trabalho pesado (ATR, sinais) apenas no FECHAMENTO da vela
      if(k.x){
        const closes=candles.map(x=>x.close),highs=candles.map(x=>x.high),
              lows=candles.map(x=>x.low),opens=candles.map(x=>x.open);
        const atrV=atrCalc(highs,lows,closes,P.atrLen);
        if(atrV[atrV.length-1]!=null)updateRiskPanel(c.close,atrV[atrV.length-1]);
        if(candles.length>250)runSignals(closes,highs,lows,opens);
      }
    }catch(err){}
  };

  const onOpen = () => {
    document.getElementById('ws-dot').className='dot grn blink';
    document.getElementById('ws-st').textContent='LIVE';
  };
  
  const onError = () => {
    document.getElementById('ws-dot').className='dot red blink';
    document.getElementById('ws-st').textContent='Reconectando...';
  };

  wsKline = new AtlasWebSocketClient(urlGen, onMsg, onOpen, onError);
  wsKline.connect();

  // Timer da vela (1x/s) + fallback REST APENAS se o socket ficar mudo
  rtInterval=setInterval(async()=>{
    if(candles.length){
      const last=candles[candles.length-1];
      const diff=(last.time+tfToSeconds(currentTF))-Math.floor((Date.now()+serverTimeOffset)/1000);
      const el=document.getElementById('candle-timer');
      if(el){
        if(diff<=0)el.textContent='00:00';
        else{
          const h=Math.floor(diff/3600),m=Math.floor((diff%3600)/60),s=diff%60;
          el.textContent=h>0
            ?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
            :`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }
        el.style.color=diff<=10?'var(--red)':'var(--t2)';
      }
    }

    // So bate na REST se nao chegou nenhum trade nos ultimos 5s.
    // Antes isso rodava sempre, brigando com o websocket e causando jitter.
    if(Date.now()-lastTradeAt<5000)return;
    const symAtFetch=currentSym; // trava o simbolo desta chamada
    try{
      const res=await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symAtFetch}`);
      if(!res.ok)return;
      const data=await res.json();
      if(currentSym!==symAtFetch)return; // ativo trocou enquanto o fetch estava em voo, descarta
      if(data&&data.price){
        const p=parseFloat(data.price);
        if(data.time)serverTimeOffset=data.time-Date.now();
        updatePriceUI(p);
        forceChartTick(p,data.time||Date.now());
      }
    }catch(e){}
  },1000);
}
