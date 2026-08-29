
function aggregateCandles(candles, factor) {
  if (!candles || candles.length === 0) return candles;
  const result = [];
  let current = null;
  let count = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (count === 0) {
      current = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
                  compra: c.compra || 0, venda: c.venda || 0 };
    } else {
      current.high = Math.max(current.high, c.high);
      current.low = Math.min(current.low, c.low);
      current.close = c.close;
      current.volume += c.volume;
      // os lados somam junto com o volume, senao o 6m e o 15h ficariam sem bolha
      current.compra += c.compra || 0;
      current.venda  += c.venda  || 0;
    }
    count++;
    if (count === factor || i === candles.length - 1) {
      result.push(current);
      count = 0;
    }
  }
  return result;
}


// LightweightCharts is loaded via CDN in index.html

// ══════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════
const SYMBOLS = {
  // Lista validada contra a busca real de ativos "Deriv" no TradingView
  // (print do usuario, ago/2026) — nao e mais uma lista curada de adivinhacao.
  // Cada ticker cripto foi checado individualmente contra a Binance Futures
  // (fonte de dados de historico/preco do dashboard). POLUSDT foi removido:
  // nao apareceu na lista real da Deriv. XMRUSD existe na Deriv mas NAO entra
  // aqui — a Binance deslistou Monero em fev/2024, sem fonte de dado.
  //
  // Ainda de fora (existem na Deriv, sem fonte de dados — proxima etapa,
  // requer ligar o derivAPI em ticks_history direto da Deriv):
  //   Forex inteiro (EUR/GBP/AUD/NZD/USDCAD/USDCHF/USDMXN/USDZAR/USDCNH/
  //   USDSEK/USDSGD/USDHKD/USDNOK/USDTHB/USDPLN/USDJPY)
  //   Commodities: Paladio (XPD), Cobre (XCU), Platina (XPT)
  //   Indices: VIX, DXY (Dollar Index), GOLD_BASKET
  crypto: ['BTCUSDT','ETHUSDT','LTCUSDT','XRPUSDT','SOLUSDT','ADAUSDT','BNBUSDT','DOTUSDT','DOGEUSDT',
           'TRXUSDT','BCHUSDT','ETCUSDT','APTUSDT','LINKUSDT','AVAXUSDT','NEARUSDT','AAVEUSDT','SANDUSDT',
           'DASHUSDT','COMPUSDT','ALGOUSDT','IOTAUSDT','FILUSDT','XTZUSDT','APEUSDT','NEOUSDT','UNIUSDT',
           'BATUSDT','IMXUSDT','ZECUSDT','XLMUSDT'],
  metals: ['XAUUSDT','XAGUSDT'],
};

const ALL_SYMS = Object.values(SYMBOLS).flat();
const MTF_TFS = { '5':'5m','60':'1h','240':'4h','D':'1d' };
const MTF_KEYS = ['5','60','240','D'];
const MTF_LBL = {'5':'M5','60':'H1','240':'H4','D':'D1'};

// MICRO TIMING — camada separada, so pra confirmar o momento de entrada
// (M1/M5/M15). Nunca decide direcao sozinha: isso fica com o MTF acima.
const MICRO_TFS = { '1':'1m','5':'5m','15':'15m' };
const MICRO_KEYS = ['1','5','15'];
const MICRO_LBL = {'1':'M1','5':'M5','15':'M15'};
let microData={};

const P = {
  swingLen:21, sqzThr:0.5, flatThr:0.04, atlasCd:10, goldCd:15,
  stressGap:0.12, stressBars:2, rbSqzP:0.15, rbSqzB:3, minScore:2,
  rsiLen:14, stochLen:14, kSmooth:3, dSmooth:3, ob:80, os:20,
  atrLen:14, atrMult:1.5, stake:1.0, mult:100,
};
const C = {ema8:'#2979FF',ema16:'#E91E63',ema55:'#00897B',ema98:'#F5A623',ema200:'#6A1B9A',ma56:'#FF6D9E',ma89:'#00B8D9',accent:'#377cfc',orange:'#FF6D00'};

// RIBBON PHI CLUBE — 13 completa a ponta curta (junto com o EMA8 que ja
// existe como linha separada do conjunto original), depois cada periodo
// dobra o anterior (17→34→72→144→305→610), escala baseada em proporcao
// aurea/Fibonacci. A 610 precisa de bastante historico "aquecido" pra ficar
// precisa — por isso o grafico principal agora carrega mais velas.
const PHI_ANCHORS = [13,17,34,72,144,305,610];

// Ribbon "mais detalhado possivel": interpola passos extras (log-espacados)
// entre cada par de ancoras Phi Clube, igual o conceito do r1..r9 do LuxAlgo
// (que interpola entre fast e slow), so que aplicado nos 7 pontos-ancora em
// vez de so 2 — resultado bem mais denso e suave.
function buildDetailedPhiPeriods(anchors,stepsPerGap){
  const out=[];
  for(let i=0;i<anchors.length-1;i++){
    const a=anchors[i], b=anchors[i+1];
    for(let s=0;s<stepsPerGap;s++){
      const t=s/stepsPerGap;
      const p=Math.round(a*Math.pow(b/a,t)); // interpolacao geometrica (log-espacada)
      out.push(p);
    }
  }
  out.push(anchors[anchors.length-1]);
  return [...new Set(out)].sort((a,b)=>a-b); // remove duplicatas de arredondamento, ordena
}
const PHI_PERIODS = buildDetailedPhiPeriods(PHI_ANCHORS,3); // 3 passos entre cada ancora

// Cor gradiente: SO verde/vermelho quando o ribbon inteiro esta alinhado
// (todas as 7 medias em ordem certa — nao so as pontas). Se estiver
// emaranhado/fora de ordem, fica cinza neutro — sinal visual de "ainda nao
// confirma nada". Opacidade cai da mais rapida pra mais lenta, igual antes.
function phiRibbonColor(idx,total,alignment){
  // alignment: 'bull' | 'bear' | null (nao alinhado)
  const base = alignment==='bull' ? [8,153,129] : alignment==='bear' ? [242,54,69] : [120,128,138]; // cinza neutro
  const fadeFactor = alignment ? 0.55 : 0.72; // alinhado esmaece menos (fica mais visivel/confiante)
  const alpha = 1 - (idx/(total-1))*fadeFactor;
  return `rgba(${base[0]},${base[1]},${base[2]},${alpha.toFixed(2)})`;
}

// Melhoria sobre o rColor() original: em vez de comparar so a mais rapida
// (13) contra a mais lenta (610) — que e fragil, um unico recuo temporario
// pode inverter essa comparacao isolada mesmo com a tendencia de fundo
// claramente de alta — cada uma das 7 medias VOTA se esta subindo ou
// descendo (comparando com ela mesma alguns candles atras). A cor segue a
// MAIORIA dos votos, nao uma comparacao isolada e ruidosa entre duas pontas.
function computePhiAlignmentSeries(phiArrs){
  const n=phiArrs[0].length;
  const voteLookback=8; // cada media compara com ela mesma 8 velas atras
  const raw=new Array(n).fill(null);
  for(let i=0;i<n;i++){
    if(i<voteLookback){ raw[i]=null; continue; }
    let up=0, down=0;
    for(let k=0;k<phiArrs.length;k++){
      const now=phiArrs[k][i], past=phiArrs[k][i-voteLookback];
      if(now==null||past==null)continue;
      if(now>past)up++; else if(now<past)down++;
    }
    if(up===0&&down===0){ raw[i]=null; continue; }
    raw[i]=up>=down?'bull':'bear'; // maioria dos votos — empate vira bull por convencao
  }
  const MIN_RUN=5;
  const smoothed=[...raw];
  let i=0;
  while(i<n){
    let j=i;
    while(j<n && raw[j]===raw[i])j++;
    if((j-i)<MIN_RUN && i>0 && smoothed[i-1]!=null){
      for(let k=i;k<j;k++)smoothed[k]=smoothed[i-1];
    }
    i=j;
  }
  return smoothed;
}

// Desenha o ribbon como VARIOS segmentos de linha, um grupo por trecho de
// alinhamento igual — isso e o que da a cor historica real (cada pedaco do
// passado mostra a cor que ele tinha NAQUELE momento), contornando a
// limitacao do Lightweight Charts de nao aceitar cor por barra numa unica
// serie continua (diferente do Pine Script, que faz isso nativamente).
function renderPhiRibbonSegments(candlesArr,phiArrs,alignmentPerBar){
  if(!phiChart)return; // ainda nao foi criado (setup nao terminou)
  PHI_PERIODS.forEach(p=>{
    (phiSegmentSeries[p]||[]).forEach(s=>{ try{ phiChart.removeSeries(s); }catch(e){} });
    phiSegmentSeries[p]=[];
  });
  const n=alignmentPerBar.length;
  let segStart=0;
  for(let i=1;i<=n;i++){
    if(i===n || alignmentPerBar[i]!==alignmentPerBar[segStart]){
      const segEnd=i-1;
      const alignment=alignmentPerBar[segStart];
      const rangeEnd=Math.min(segEnd+1,n-1); // +1 ponto de overlap pra linha ficar continua entre segmentos
      PHI_PERIODS.forEach((p,idx)=>{
        const arr=phiArrs[idx];
        const pts=[];
        for(let k=segStart;k<=rangeEnd;k++){
          if(arr[k]!=null)pts.push({time:candlesArr[k].time,value:arr[k]});
        }
        if(pts.length<2)return;
        const s=phiChart.addLineSeries({color:phiRibbonColor(idx,PHI_PERIODS.length,alignment),lineWidth:1.4,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
        s.setData(pts);
        phiSegmentSeries[p].push(s);
      });
      segStart=i;
    }
  }
}

let currentSym='BTCUSDT', currentTF='15m', candles=[], mtfData={}, chart, candleSeries, maS={}, volS, stochChart, stochK, stochD, phiChart;
let phiSegmentSeries={}; // series dinamicas do ribbon Phi Clube, uma lista de segmentos coloridos por periodo
let signals=[], alertsOn=false, currentMarkers=[];
let fibState=mkFib(), lastSig={atlasB:-99,atlasS:-99,goldB:-99,goldS:-99,stressB:-99,stressS:-99,rbB:-99,rbS:-99,sqzBk:-99,sqzS:-99,h1B:-99,h1S:-99};
let bullFlowPrev=false, bearFlowPrev=false;
let wsKline=null;
// Estado incremental: guarda o ultimo valor CONFIRMADO de cada indicador para
// que os ticks ao vivo sejam calculados em O(1) em vez de recalcular tudo.
let liveState={ema8:null,ema16:null,ema55:null,ema98:null,ema200:null,
  sma56Win:[],sma89Win:[],rsiBase:null,rsiHist:[],kHist:[]};

// HISTORICO DO FIBO AUTOMATICO. Cada vez que o motor reancora o fibo, a
// ancora anterior e arquivada com o nivel mais alto que ela alcancou. Isso
// responde a pergunta que decide o alvo: das ancoras passadas, quantas
// chegaram no 1.618? E no 2.618? Perseguir o alvo distante so vale se o
// historico mostrar que ele costuma ser alcancado.
let fiboHistorico=[];

function arquivaFibo(idx){
  if(!fibState||!fibState.targets||!fibState.targets.length) return;
  if(fibState.p0==null||fibState.p1==null) return;
  const batidos=fibState.targets.filter(t=>t.hit);
  if(!batidos.length&&fibState.p0===fibState.p1) return;   // ancora degenerada
  const maior=batidos.length?batidos[batidos.length-1].lv:null;
  fiboHistorico.push({
    lado:fibState.bull?"alta":"baixa",
    p0:fibState.p0, p1:fibState.p1,
    barra_ancora:fibState.p1B, barra_fim:idx,
    velas_ate_fim:(fibState.p1B!=null&&idx!=null)?(idx-fibState.p1B):null,
    maior_nivel:maior,
    niveis_batidos:batidos.map(t=>t.lv)
  });
  if(fiboHistorico.length>300) fiboHistorico.shift();
}

// Distribuicao: de todas as ancoras arquivadas, quantas alcancaram cada nivel.
function estatisticaFibo(){
  const total=fiboHistorico.length;
  if(!total) return {total:0,niveis:[]};
  const alvos=fibLevels.filter(lv=>lv>=1);   // extensoes: os alvos de lucro
  const niveis=alvos.map(lv=>{
    const n=fiboHistorico.filter(h=>h.maior_nivel!=null&&h.maior_nivel>=lv).length;
    return {nivel:lv, alcancaram:n, pct:+(n/total*100).toFixed(1)};
  });
  const comAlvo=fiboHistorico.filter(h=>h.maior_nivel!=null);
  const medianaVelas=(()=>{
    const v=comAlvo.map(h=>h.velas_ate_fim).filter(x=>x!=null).sort((a,b)=>a-b);
    return v.length?v[Math.floor(v.length/2)]:null;
  })();
  return {total, niveis, ancoras_com_alvo:comAlvo.length, mediana_velas:medianaVelas};
}
window.estatisticaFibo=estatisticaFibo;

function renderFiboHistorico(){
  const box=document.getElementById("fibh-list"), cnt=document.getElementById("fibh-count");
  if(!box) return;
  let e=null;
  try{ e=estatisticaFibo(); }catch(err){}
  if(!e||!e.total){
    if(cnt) cnt.textContent="--";
    box.innerHTML='<div style="padding:5px 9px;font-size:9px;color:var(--t3);">Sem ancoras arquivadas ainda.</div>';
    return;
  }
  if(cnt) cnt.textContent=e.total+" ancoras";
  // so os alvos que alguem ja alcancou, mais o primeiro que ninguem alcancou:
  // a lista inteira dos 24 seria parede de zeros
  const uteis=[]; let achouZero=false;
  for(const n of e.niveis){
    if(n.alcancaram>0){ uteis.push(n); }
    else if(!achouZero){ uteis.push(n); achouZero=true; }
    if(uteis.length>=8) break;
  }
  box.innerHTML=uteis.map(n=>{
    const cor=n.pct>=60?"#00C853":(n.pct>=30?"#F5A623":"#FF3B30");
    const barra=Math.max(2,Math.round(n.pct));
    return '<div style="display:grid;grid-template-columns:44px 1fr 58px;gap:6px;align-items:center;'
      +'padding:3px 9px;font-size:9px;">'
      +'<span style="color:var(--t2);font-family:var(--mono);">'+n.nivel+"</span>"
      +'<span style="display:block;height:6px;background:var(--bg4);border-radius:3px;overflow:hidden;">'
      +'<span style="display:block;height:100%;width:'+barra+'%;background:'+cor+';"></span></span>'
      +'<span style="color:'+cor+';text-align:right;font-family:var(--mono);">'+n.pct+"% ("+n.alcancaram+")</span></div>";
  }).join("")
  +'<div style="padding:4px 9px;font-size:8px;color:var(--t3);border-top:1px solid var(--bd);">'
  +e.ancoras_com_alvo+" de "+e.total+" ancoras alcancaram algum alvo"
  +(e.mediana_velas!=null?" \u00b7 mediana de "+e.mediana_velas+" velas ate o fim":"")+"</div>";
}
window.renderFiboHistorico=renderFiboHistorico;

function mkFib(){return{bull:true,p0:null,p1:null,p0B:null,p1B:null,targets:[],oldTargets:[],oldBull:true,oldAge:0};}

// ══════════════════════════════════════════════════════
// INDICATORS
// ══════════════════════════════════════════════════════
function ema(d,p){const k=2/(p+1),r=[d[0]];for(let i=1;i<d.length;i++)r.push(d[i]*k+r[i-1]*(1-k));return r;}

// ══════════════════════════════════════════════════════
// RAINBOW CHART — regressao logaritmica preco x tempo. A ideia fisica: o
// preco precisa de "tempo" pra alcancar cada faixa de valorizacao, entao a
// curva central e um ajuste log-linear (log(preco) = a + b*x) sobre todo o
// historico carregado, e as 9 bandas se abrem em multiplos de desvio-padrao
// do residuo — verde (barato) embaixo, vermelho (caro) em cima.
// ══════════════════════════════════════════════════════
const RAINBOW_BANDS = [
  {mult:-2.2, color:'#00FF9C'}, // verde neon — bem abaixo da regressao
  {mult:-1.6, color:'#39FF14'},
  {mult:-1.0, color:'#7CFF00'},
  {mult:-0.4, color:'#CFFF04'},
  {mult: 0.0, color:'#FFF200'}, // amarelo neon — a propria curva central
  {mult: 0.4, color:'#FFC400'},
  {mult: 1.0, color:'#FF6E00'},
  {mult: 1.6, color:'#FF1F5A'},
  {mult: 2.2, color:'#FF00E5'}, // magenta/vermelho neon — bem acima
];

// Ajuste log-linear simples (minimos quadrados) sobre log(close) x indice.
// Retorna a funcao f(i) que da o valor previsto na escala de preco (nao log).
function fitLogRegression(closes){
  const n=closes.length;
  if(n<30)return null;
  let sx=0,sy=0,sxy=0,sxx=0,cnt=0;
  for(let i=0;i<n;i++){
    const c=closes[i]; if(c<=0)continue;
    const y=Math.log(c);
    sx+=i;sy+=y;sxy+=i*y;sxx+=i*i;cnt++;
  }
  if(cnt<30)return null;
  const b=(cnt*sxy-sx*sy)/(cnt*sxx-sx*sx);
  const a=(sy-b*sx)/cnt;
  // desvio-padrao dos residuos (log), pra abrir as bandas proporcionalmente
  let sq=0;
  for(let i=0;i<n;i++){
    const c=closes[i]; if(c<=0)continue;
    const pred=a+b*i;
    sq+=(Math.log(c)-pred)**2;
  }
  const std=Math.sqrt(sq/cnt);
  return{a,b,std};
}

// Gera as 9 series (uma por banda) alinhadas aos mesmos timestamps das candles.
function computeRainbowSeries(candlesArr){
  const closes=candlesArr.map(c=>c.close);
  const fit=fitLogRegression(closes);
  if(!fit)return null;
  return RAINBOW_BANDS.map(band=>
    candlesArr.map((c,i)=>({
      time:c.time,
      value:Math.exp(fit.a+fit.b*i+band.mult*fit.std),
    }))
  );
}

// ══════════════════════════════════════════════════════
// MA RIBBON — MA89 calculada em D1/W1/1M/3M, uma linha por timeframe, do
// verde (mais rapida, D1) ao vermelho (mais lenta, 3M) — o efeito "arco-iris
// passando pelo preco" que voce viu na thumbnail, so que com medias reais em
// vez de percentil MVRV. Fica ao lado do Rainbow de regressao (nao substitui).
// ══════════════════════════════════════════════════════
const MA_RIBBON_TFS = [
  {key:'1d', bn:'1d', label:'MA89 D1', color:'#39FF14'},
  {key:'1w', bn:'1w', label:'MA89 W1', color:'#CFFF04'},
  {key:'1M', bn:'1M', label:'MA89 M1', color:'#FF8A00'},
  {key:'3M', bn:'1M', label:'MA89 3M', color:'#FF1F5A'}, // deriva do 1M, agrupando 3 velas
];

// Agrupa velas mensais de 3 em 3 pra formar uma vela "trimestral" — a Binance
// nao tem intervalo nativo de 3 meses, entao monta na mao (ultimo close do
// grupo de 3, tempo do ultimo candle do grupo).
function resampleQuarterly(monthlyCandles){
  const out=[];
  for(let i=0;i<monthlyCandles.length;i+=3){
    const chunk=monthlyCandles.slice(i,i+3);
    if(chunk.length<1)continue;
    out.push({time:chunk[chunk.length-1].time, close:chunk[chunk.length-1].close});
  }
  return out;
}

async function fetchMaRibbon(sym){
  const out={};
  for(const tf of MA_RIBBON_TFS){
    if(out[tf.key])continue; // '3M' reaproveita o mesmo fetch do '1M' se ja veio
    try{
      const d=await fetchCandles(sym,tf.bn,500);
      if(!d)continue;
      if(tf.key==='3M'){
        const q=resampleQuarterly(d);
        out['3M']=q;
        if(!out['1M'])out['1M']=d.map(c=>({time:c.time,close:c.close}));
      }else{
        out[tf.key]=d.map(c=>({time:c.time,close:c.close}));
      }
    }catch(e){}
  }
  return out;
}


function sma(d,p){const r=new Array(d.length).fill(null);for(let i=p-1;i<d.length;i++){let s=0;for(let j=0;j<p;j++)s+=d[i-j];r[i]=s/p;}return r;}
function rsiCalc(c,p){const r=new Array(c.length).fill(null);if(c.length<p+1)return r;let ag=0,al=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>0?ag+=d:al-=d;}ag/=p;al/=p;r[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;r[i]=al===0?100:100-100/(1+ag/al);}return r;}
function stochCalc(rsi,p){const r=new Array(rsi.length).fill(null);for(let i=p-1;i<rsi.length;i++){if(rsi[i]==null)continue;let ll=1e9,hh=-1e9;for(let j=0;j<p;j++){const v=rsi[i-j];if(v==null){ll=null;break;}if(v<ll)ll=v;if(v>hh)hh=v;}if(ll!=null&&hh!==ll)r[i]=(rsi[i]-ll)/(hh-ll)*100;else if(ll!=null)r[i]=50;}return r;}
function atrCalc(h,l,c,p){const tr=[0];for(let i=1;i<h.length;i++)tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));return sma(tr,p);}
// Retorna as medias de Wilder (ganho/perda) + ultimo close, para avancar o RSI tick a tick.
function rsiState(c,p){
  if(c.length<p+1)return null;
  let ag=0,al=0;
  for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>0?ag+=d:al-=d;}
  ag/=p;al/=p;
  for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];
    ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;}
  return{ag,al,last:c[c.length-1]};
}
function rsiStep(st,px,p){
  if(!st)return null;
  const d=px-st.last;
  const ag=(st.ag*(p-1)+Math.max(d,0))/p, al=(st.al*(p-1)+Math.max(-d,0))/p;
  return{ag,al,last:px,value:al===0?100:100-100/(1+ag/al)};
}

// ══════════════════════════════════════════════════════
// RSI INVERSO — resolve pra qual PRECO o RSI(14) bateria um alvo (30/70),
// usando a mesma media de Wilder (ag/al) que ja sustenta o RSI normal. Isso
// e RSI puro (nao StochRSI), com o teto/piso classico 30/70 — diferente do
// StochRSI que o resto do dashboard usa (P.ob/P.os). Deixado separado de
// proposito pra nao misturar os dois conceitos.
// A mesma conta do calcInverseRSITargets, mas pra UM alvo qualquer — o de
// cima resolve so dois (30 e 70) porque era so isso que o painel mostrava.
function precoParaRSI(ag,al,lastClose,alvo){
  if(ag==null||al==null||!lastClose||alvo<=0||alvo>=100) return null;
  const n=14;
  const baseRSI = al===0 ? 100 : (ag===0 ? 0 : 100-(100/(1+ag/al)));
  const rsT=alvo/(100-alvo);
  let preco;
  if(baseRSI<alvo){
    preco = lastClose + (rsT*al*(n-1) - ag*(n-1));
  }else{
    preco = lastClose - ((ag*(n-1))/rsT - al*(n-1));
  }
  return (isFinite(preco)&&preco>0) ? preco : null;
}

function calcInverseRSITargets(ag,al,lastClose,osTarget=30,obTarget=70){
  if(ag==null||al==null||!lastClose)return{osPrice:null,obPrice:null};
  const n=14;
  const baseRS = al===0 ? 999999 : ag/al;
  const baseRSI = al===0 ? 100 : (ag===0 ? 0 : 100-(100/(1+baseRS)));
  const priceFor=(target)=>{
    const rsT=target/(100-target); // RS que corresponde ao RSI alvo
    let price;
    if(baseRSI<target){
      const gain = rsT*al*(n-1) - ag*(n-1);
      price = lastClose+gain;
    }else{
      const loss = (ag*(n-1))/rsT - al*(n-1);
      price = lastClose-loss;
    }
    return (isFinite(price)&&price>0) ? price : null;
  };
  return{osPrice:priceFor(osTarget), obPrice:priceFor(obTarget), baseRSI};
}

function cross(a,b,i){return i>0&&a[i]>b[i]&&a[i-1]<=b[i-1];}
function crossu(a,b,i){return i>0&&a[i]<b[i]&&a[i-1]>=b[i-1];}

// ══════════════════════════════════════════════════════
// SIGNAL ENGINE
// ══════════════════════════════════════════════════════
function runSignals(closes,highs,lows,opens){
  const n=closes.length; if(n<250)return;
  const e8=ema(closes,8),e16=ema(closes,16),e55=ema(closes,55),e98=ema(closes,98),e200=ema(closes,200);
  const m56=sma(closes,56),m89=sma(closes,89),r14=rsiCalc(closes,14);
  // o alarme das medias precisa do ultimo valor de cada uma a cada tick
  ultimasEmas={ema8:e8[n-1],ema16:e16[n-1],ema55:e55[n-1],ema98:e98[n-1],ema200:e200[n-1],
               ma56:m56[n-1],ma89:m89[n-1]};
  // e a liberacao e conferida no indice do sinal, que nem sempre e a ultima
  // vela — por isso guardo as series inteiras, nao so a ponta
  serieMedias={ema8:e8,ema16:e16,ma89:m89,ema200:e200};
  if(typeof verificaCruzamentoMedias==="function") verificaCruzamentoMedias();
  const rL=rsiCalc(closes,P.rsiLen),sL=stochCalc(rL,P.stochLen),kL=sma(sL,P.kSmooth),dL=sma(kL,P.dSmooth);
  const atrV=atrCalc(highs,lows,closes,P.atrLen);

  // Reset state
  signals=[]; liberados=[]; fiboHistorico=[]; bullFlowPrev=false; bearFlowPrev=false; currentMarkers=[];
  fibState=mkFib(); lastSig={atlasB:-99,atlasS:-99,goldB:-99,goldS:-99,stressB:-99,stressS:-99,rbB:-99,rbS:-99,sqzBk:-99,sqzS:-99,h1B:-99,h1S:-99};

  for(let i=250;i<n;i++){
    // Flow
    const bullMom=e8[i]>e16[i]&&e16[i]>e55[i];
    const bearMom=e8[i]<e16[i]&&e16[i]<e55[i];
    const bullFlow=e8[i]>e16[i]&&e16[i]>e55[i]&&e16[i]>e98[i]&&e16[i]>e200[i]&&e16[i]>m56[i]&&e16[i]>m89[i];
    const bearFlow=e8[i]<e16[i]&&e16[i]<e55[i]&&e16[i]<e98[i]&&e16[i]<e200[i]&&e16[i]<m56[i]&&e16[i]<m89[i];

    // Squeeze
    const sqzDist=Math.abs(e8[i]-e16[i])/e16[i]*100;
    const inSqueeze=sqzDist<P.sqzThr&&!bullFlow&&!bearFlow;

    // Flat blocker
    const e8c=Math.abs(e8[i]-e8[i-5])/e8[i-5]*100;
    const e16c=Math.abs(e16[i]-e16[i-5])/e16[i-5]*100;
    const e55c=Math.abs(e55[i]-e55[i-5])/e55[i-5]*100;
    const maFlat=e8c<P.flatThr&&e16c<P.flatThr&&e55c<P.flatThr*2;

    // RSI div
    const rsiDivBull=closes[i]<closes[i-3]&&r14[i]>r14[i-3]&&r14[i]<45;
    const rsiDivBear=closes[i]>closes[i-3]&&r14[i]<r14[i-3]&&r14[i]>55;

    // Pivots (lookback)
    let pH1=null,pH1B=null,pL1=null,pL1B=null;
    for(let j=i;j>=Math.max(0,i-P.swingLen*3);j--){
      let isPH=true,isPL=true;
      for(let k=1;k<=P.swingLen;k++){
        if(j-k>=0&&highs[j-k]>=highs[j])isPH=false;
        if(j+k<n&&highs[j+k]>highs[j])isPH=false;
        if(j-k>=0&&lows[j-k]<=lows[j])isPL=false;
        if(j+k<n&&lows[j+k]<lows[j])isPL=false;
      }
      if(isPH&&pH1==null){pH1=highs[j];pH1B=j;}
      if(isPL&&pL1==null){pL1=lows[j];pL1B=j;}
      if(pH1!=null&&pL1!=null)break;
    }

    // Retracement
    let impBull=0,impBear=0,retBull=0,retBear=0;
    if(pH1!=null&&pL1!=null&&pH1B>pL1B){impBull=Math.abs(pH1-pL1)/pL1*100;retBull=(pH1-closes[i])/(pH1-pL1)*100;}
    if(pH1!=null&&pL1!=null&&pL1B>pH1B){impBear=Math.abs(pH1-pL1)/pH1*100;retBear=(closes[i]-pL1)/(pH1-pL1)*100;}
    const corrBull=impBull>=0.8&&retBull>=23.6&&retBull<=61.8;
    const corrBear=impBear>=0.8&&retBear>=23.6&&retBear<=61.8;
    const flatBlock=(corrBull||corrBear)&&maFlat&&!rsiDivBull&&!rsiDivBear;

    // MTF
    const mtf=calcMTF();
    const mtfBull=mtf.scoreBull>=P.minScore;
    const mtfBear=mtf.scoreBear>=P.minScore;

    // Accumulation context
    let lastSqzEnd=-1;
    for(let j=i;j>=Math.max(0,i-60);j--){
      const sq=Math.abs(e8[j]-e16[j])/e16[j]*100<P.sqzThr;
      if(!sq&&j<i){lastSqzEnd=j;break;}
    }
    const postSqz=lastSqzEnd>=0&&(i-lastSqzEnd)<=30;
    const accumCtx=inSqueeze||postSqz;

    // ATLAS
    const emaTop=Math.max(e8[i],e16[i]),emaBot=Math.min(e8[i],e16[i]);
    const touched=lows[i]<=emaTop*1.001&&lows[i]>=emaBot*0.999;
    const touchB=highs[i]>=emaBot*0.999&&highs[i]<=emaTop*1.001;
    let newTop=true;for(let j=Math.max(0,i-10);j<i;j++)if(highs[j]>=highs[i])newTop=false;
    let newBot=true;for(let j=Math.max(0,i-10);j<i;j++)if(lows[j]<=lows[i])newBot=false;
    const pbBull=bullFlow&&touched&&closes[i]>emaTop&&closes[i]>opens[i];
    const pbBear=bearFlow&&touchB&&closes[i]<emaBot&&closes[i]<opens[i];
    const firstBull=bullFlow&&!bullFlowPrev;
    const firstBear=bearFlow&&!bearFlowPrev;

    const cdAtB=(i-lastSig.atlasB)>=P.atlasCd;
    const cdAtS=(i-lastSig.atlasS)>=P.atlasCd;
    const atlasBuy=!flatBlock&&cdAtB&&mtfBull&&((firstBull&&accumCtx)||pbBull||(bullFlow&&newTop));
    const atlasSell=!flatBlock&&cdAtS&&mtfBear&&((firstBear&&accumCtx)||pbBear||(bearFlow&&newBot));
    if(atlasBuy){lastSig.atlasB=i;addSig('ATLAS','BUY',i,closes[i]);}
    if(atlasSell){lastSig.atlasS=i;addSig('ATLAS','SELL',i,closes[i]);}

    // STRESS
    const stGap=Math.abs(e8[i]-e16[i])/e16[i]*100;
    let e8up=true,e8dn=true,e16up=true,e16dn=true;
    for(let si=1;si<P.stressBars;si++){
      if(i-si<0)break;
      e8up=e8up&&(e8[i-si+1]>e8[i-si]);e8dn=e8dn&&(e8[i-si+1]<e8[i-si]);
      e16up=e16up&&(e16[i-si+1]>e16[i-si]);e16dn=e16dn&&(e16[i-si+1]<e16[i-si]);
    }
    const preStB=stGap<P.stressGap&&e8up&&e16up&&e8[i]>e16[i];
    const preStS=stGap<P.stressGap&&e8dn&&e16dn&&e8[i]<e16[i];
    const cdSt=(i-lastSig.stressB)>=5;
    const stBuy=(cross(e8,e16,i)||preStB)&&cdSt&&!flatBlock&&bullMom;
    const stSell=(crossu(e8,e16,i)||preStS)&&cdSt&&!flatBlock&&bearMom;
    if(stBuy){lastSig.stressB=i;addSig('STRESS','BUY',i,closes[i]);}
    if(stSell){lastSig.stressS=i;addSig('STRESS','SELL',i,closes[i]);}

    // RIBBON
    const rbGap=Math.abs(m56[i]-m89[i])/m89[i]*100;
    const rbTop=Math.max(m56[i],m89[i]),rbBot=Math.min(m56[i],m89[i]);
    const rbBreakB=closes[i]>rbTop&&closes[i]>opens[i]&&bullMom;
    const rbBreakS=closes[i]<rbBot&&closes[i]<opens[i]&&bearMom;
    const cdRb=(i-lastSig.rbB)>=8;
    const rbBuy=!flatBlock&&cdRb&&bullMom&&(rbBreakB||cross(m56,m89,i))&&mtfBull;
    const rbSell=!flatBlock&&cdRb&&bearMom&&(rbBreakS||crossu(m56,m89,i))&&mtfBear;
    if(rbBuy){lastSig.rbB=i;addSig('RIBBON','BUY',i,closes[i]);}
    if(rbSell){lastSig.rbS=i;addSig('RIBBON','SELL',i,closes[i]);}

    // FIBONACCI — agora usa os mesmos 24 niveis/multiplicadores da ferramenta manual
    const fibTB=cross(e8,e16,i)||atlasBuy;
    const fibTS=crossu(e8,e16,i)||atlasSell;
    if(fibTB){
      arquivaFibo(i);   // guarda ate onde a ancora anterior chegou
      saveOldFib();
      fibState.bull=true;
      fibState.p0=pL1??lows[i];fibState.p0B=pL1B??i;
      fibState.p1=pH1??highs[i];fibState.p1B=pH1B??i-1;
      const rng=Math.abs(fibState.p1-fibState.p0);
      fibState.targets=fibLevels.map(lv=>({lv,price:fibState.p1+rng*lv,hit:false}));
      addSig('FIB','BULL',i,closes[i]);
    }
    if(fibTS&&!fibTB){
      arquivaFibo(i);
      saveOldFib();
      fibState.bull=false;
      fibState.p0=pH1??highs[i];fibState.p0B=pH1B??i;
      fibState.p1=pL1??lows[i];fibState.p1B=pL1B??i-1;
      const rng=Math.abs(fibState.p0-fibState.p1);
      fibState.targets=fibLevels.map(lv=>({lv,price:fibState.p1-rng*lv,hit:false}));
      addSig('FIB','BEAR',i,closes[i]);
    }
    // Fib hits: cadeia sequencial pelos 24 niveis (so avanca pro proximo apos o anterior bater)
    let fibPrevHit=true;
    for(const tgt of fibState.targets){
      if(!fibPrevHit)break;
      if(!tgt.hit){
        tgt.hit=fibState.bull?highs[i]>=tgt.price:lows[i]<=tgt.price;
        if(tgt.hit)addSig('FIB','HIT '+tgt.lv,i,closes[i]);
      }
      fibPrevHit=tgt.hit;
    }


    bullFlowPrev=bullFlow; bearFlowPrev=bearFlow;
  }

  // Final panel updates
  updateMTFPanel(calcMTF());
  updateStochPanel(kL[n-1],dL[n-1],calcH1Stoch());
  updateFibPanel();
  updateAntecipadorPanel(computeAntecipador(candles));
  updateRsiInversoPanel(closes);
  try{updateDirecaoPanel(closes,e8,e16,e55,e98,e200,m56,m89,atrV);}catch(e){console.error('BUSSOLA ERROR:', e);}

  updateSentimentPanel(); // assincrono, nao trava o resto do recalculo
  if(atrV[n-1]!=null)updateRiskPanel(closes[n-1],atrV[n-1]);
  document.getElementById('st-info').textContent=`${currentSym.replace('USDT','')} · ${currentTF} · ${signals.length} sinais`;
  document.getElementById('globe-cnt').textContent=`${signals.length} sinais`;
  // So os cruzamentos de EMA (STRESS) viram marcador no grafico — teto de 150
  // pra nao pesar o render mesmo em historico grande. Roda so aqui (recalculo
  // completo), nunca por tick, entao nao repete o problema de lag de antes.
  if(currentMarkers.length>150)currentMarkers=currentMarkers.slice(-150);
  if(candleSeries)candleSeries.setMarkers(currentMarkers);
}

function saveOldFib(){
  fibState.oldTargets=fibState.targets;
  fibState.oldBull=fibState.bull;
  fibState.oldAge=candles.length;
}

function calcMTF(){
  let sb=0,sd=0;const dirs={},fresh={};
  MTF_KEYS.forEach(tf=>{
    const d=mtfData[tf];if(!d||d.length<89){dirs[tf]='flat';fresh[tf]=null;return;}
    const m56t=sma(d,56),m89t=sma(d,89);const last=d.length-1;
    if(m56t[last]!=null&&m89t[last]!=null){
      if(m56t[last]>m89t[last]){sb++;dirs[tf]='buy';}
      else if(m56t[last]<m89t[last]){sd++;dirs[tf]='sell';}
      else dirs[tf]='flat';
    }else dirs[tf]='flat';
    // Cruzamento EMA8x16 recente (ultimas 3 velas) — so pra acender o ponto,
    // nao entra no calculo do score (esse continua sendo SMA56x89).
    fresh[tf]=freshCrossState(d);
  });
  return{scoreBull:sb,scoreBear:sd,dirs,fresh};
}

// Detecta se um cruzamento EMA8x16 aconteceu nas ultimas `lookback` velas
// fechadas, e em que direcao — usado so pro "ponto piscando", nao pro score.
function freshCrossState(closes,lookback=3){
  if(!closes||closes.length<20)return null;
  const e8=ema(closes,8),e16=ema(closes,16);
  const n=e8.length;
  for(let k=0;k<lookback;k++){
    const i=n-1-k;
    if(i<=0)break;
    if(cross(e8,e16,i))return'buy';
    if(crossu(e8,e16,i))return'sell';
  }
  return null;
}

function calcH1Stoch(){
  const d=mtfData['60'];if(!d||d.length<50)return{ k:null,d:null };
  const r=rsiCalc(d,P.rsiLen),s=stochCalc(r,P.stochLen),k=sma(s,P.kSmooth),dd=sma(k,P.dSmooth);
  const last=d.length-1;return{ k:k[last],d:dd[last] };
}

// ══════════════════════════════════════════════════════
// SIGNALS
// ══════════════════════════════════════════════════════
// ── LIBERACAO ────────────────────────────────────────────────────────
// A regra: o sinal so esta liberado quando a EMA8 E a EMA16 estao das duas
// acima da MA89 E da EMA200 (alta), ou das duas abaixo (baixa). E o
// empilhamento das medias curtas em relacao as longas — enquanto ele nao
// acontece, o sinal existe mas nao esta liberado.
let serieMedias=null;
let liberados=[];

function estadoLiberacao(idx){
  if(!serieMedias) return null;
  const i=(idx==null||idx<0)?serieMedias.ema8.length-1:idx;
  const e8=serieMedias.ema8[i], e16=serieMedias.ema16[i];
  const m89=serieMedias.ma89[i], e200=serieMedias.ema200[i];
  if([e8,e16,m89,e200].some(v=>v==null||!isFinite(v))) return null;
  const teto=Math.max(m89,e200), piso=Math.min(m89,e200);
  if(e8>teto&&e16>teto) return "alta";
  if(e8<piso&&e16<piso) return "baixa";
  return null;  // medias embaralhadas: nao libera
}

// Cruza o lado do sinal com o empilhamento: um sinal de compra so vale
// liberado com as medias em alta, e um de venda com as medias em baixa.
function sinalEstaLiberado(side,idx){
  const est=estadoLiberacao(idx);
  if(!est) return false;
  const compra=side.includes("BUY")||side.includes("BULL")||side.includes("HIT");
  return compra ? est==="alta" : est==="baixa";
}

function addSig(type,side,idx,price){
  const time=candles[idx]?.time||Date.now()/1000;
  const liberado=sinalEstaLiberado(side,idx);
  signals.push({type,side,price,time:time*1000,liberado});
  if(signals.length>200)signals.shift();
  if(liberado){
    liberados.push({type,side,price,time:time*1000});
    if(liberados.length>200)liberados.shift();
    renderLiberados();
  }
  // o placar so muda quando o motor reprocessa o historico, nao a cada tick
  if(!addSig._agendado){ addSig._agendado=setTimeout(()=>{ addSig._agendado=null;
    try{ atualizaPlacarSinais(); }catch(e){}
    try{ renderContraArgumento(); }catch(e){}
    try{ renderFiboHistorico(); }catch(e){} },400); }
  renderSignalLog();
  // O motor varre o historico inteiro (da vela 250 ate a ultima) a cada
  // recalculo, e chamava showToast pra CADA sinal encontrado. Com o sino
  // ligado, toda recarga repetia como aviso ao vivo dezenas de sinais de horas
  // atras — era esse o disparo em massa "sem nocao". Sinal antigo entra no log
  // e no historico, mas so o das ultimas velas vira aviso.
  const naPonta = idx >= candles.length-2;
  if(alertsOn&&naPonta){
    // o placar vai junto do aviso: "ATLAS BUY" sozinho e opiniao, com
    // "18x 61% +0,34R" ao lado vira opiniao com historico
    const pl=(typeof placarDe==="function")?placarDe(type,side):null;
    const extra=pl&&pl.n>=3 ? "  \u00b7 "+pl.n+"x "+pl.acerto.toFixed(0)+"% "
      +(pl.mediaR>=0?"+":"")+pl.mediaR.toFixed(2)+"R" : "";
    showToast(type,side+extra,price);
  }
  // addMarker(type,side,time,price); // Marcadores no gráfico desativados (performance extrema)
}

function addMarker(type,side,time,price){
  const isBuy=side==='BUY'||side==='BULL'||side.includes('HIT');
  let color,shape,text;
  switch(type){
    case'ATLAS':color=isBuy?'#00E676':'#F44336';shape=isBuy?'arrowUp':'arrowDown';text='ATLAS';break;
    case'GOLD':color='#FFD600';shape=isBuy?'arrowUp':'arrowDown';text='GOLD';break;
    case'RIBBON':color='#7B61FF';shape=isBuy?'arrowUp':'arrowDown';text='RB';break;
    case'FIB':color='#FFD600';shape='circle';text=side;break;
    default:return;
  }
  currentMarkers.push({time,position:isBuy?'belowBar':'aboveBar',color,shape,text});
}

function renderSignalLog(){
  document.getElementById('sig-count').textContent=signals.length;
  const list=document.getElementById('sig-list');
  if(!signals.length){list.innerHTML='<div style="padding:5px 9px;font-size:9px;color:var(--t3);">Aguardando sinais...</div>';return;}
  list.innerHTML=signals.slice(-40).reverse().map(s=>{
    const t=new Date(s.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const cls=`sig-${s.type.toLowerCase()}`;
    const sc=s.side.includes('BUY')||s.side.includes('BULL')||s.side.includes('HIT')?'buy':'sell';
    return`<div class="sig-item"><span class="sig-time">${t}</span><span class="sig-type ${cls}">${s.type}</span><span class="sig-side ${sc}">${s.side}</span><span class="sig-px">${s.price.toFixed(2)}</span></div>`;
  }).join('');
}

// HISTORICO · LIBERADOS do Validador. Os elementos existiam no HTML desde
// sempre sem nada que escrevesse neles — faltava a regra do que conta como
// liberado.
function renderLiberados(){
  const cnt=document.getElementById("validator-history-count");
  const list=document.getElementById("validator-history-list");
  if(cnt) cnt.textContent=liberados.length;
  if(!list) return;
  if(!liberados.length){
    list.innerHTML='<div style="padding:5px 9px;font-size:9px;color:var(--t3);">Aguardando o 1o sinal liberado...</div>';
    return;
  }
  list.innerHTML=liberados.slice(-40).reverse().map(s=>{
    const t=new Date(s.time).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    const cls="sig-"+s.type.toLowerCase();
    const sc=(s.side.includes("BUY")||s.side.includes("BULL")||s.side.includes("HIT"))?"buy":"sell";
    return '<div class="sig-item"><span class="sig-time">'+t+'</span>'
      +'<span class="sig-type '+cls+'">'+s.type+'</span>'
      +'<span class="sig-side '+sc+'">'+s.side+'</span>'
      +'<span class="sig-px">'+s.price.toFixed(2)+'</span></div>';
  }).join("");
}

// ══════════════════════════════════════════════════════
// PANELS
// ══════════════════════════════════════════════════════
function updateMTFPanel(mtf){
  const ids={'5':'m5','60':'h1','240':'h4','D':'d1'};
  MTF_KEYS.forEach(tf=>{
    const dir=mtf.dirs[tf]||'flat';
    const id=ids[tf];
    const fe=document.getElementById(`mtf-${id}-fill`),de=document.getElementById(`mtf-${id}-dir`),ce=document.getElementById(`mtf-${id}-cross`);
    if(fe){if(dir==='buy'){fe.style.width='100%';fe.style.background='var(--green)';}else if(dir==='sell'){fe.style.width='100%';fe.style.background='var(--red)';}else fe.style.width='0%';}
    if(de){de.textContent=dir==='buy'?'BUY':dir==='sell'?'SELL':'---';de.className=`mtf-dir ${dir}`;}
    if(ce){const fr=mtf.fresh?mtf.fresh[tf]:null;ce.className=`mtf-cross${fr?' fresh-'+fr:''}`;}
  });
  const score=Math.max(mtf.scoreBull,mtf.scoreBear);
  document.getElementById('mtf-score-val').textContent=score;
  document.getElementById('mtf-summary').textContent=`${score}/${P.minScore}`;
}

function updateStochPanel(kLoc,dLoc,h1){
  document.getElementById('stoch-k-local').textContent=kLoc!=null?kLoc.toFixed(1):'--';
  document.getElementById('stoch-d-local').textContent=dLoc!=null?dLoc.toFixed(1):'--';
  document.getElementById('stoch-k-h1').textContent=h1.k!=null?h1.k.toFixed(1):'--';
  document.getElementById('stoch-d-h1').textContent=h1.d!=null?h1.d.toFixed(1):'--';
  const b=document.getElementById('stoch-zone-badge');
  if(h1.k!=null){
    if(h1.k>=P.ob){b.textContent='OVERBOUGHT';b.className='stoch-zone zone-ob';}
    else if(h1.k<=P.os){b.textContent='OVERSOLD';b.className='stoch-zone zone-os';}
    else{b.textContent='NEUTRO';b.className='stoch-zone zone-n';}
  }
}

function updateAntecipadorPanel(antecip){
  const badge=document.getElementById('antecip-badge'),detail=document.getElementById('antecip-detail');
  if(!badge||!detail)return;
  if(!antecip||antecip.status==='indisponivel'||antecip.status==='nenhum'){
    badge.textContent='--';badge.className='fib-dir-badge fib-flat';
    detail.textContent='Sem convergencia + virada do StochRSI no momento.';
    return;
  }
  badge.textContent=antecip.direcao==='alta'?'POSSIVEL ALTA':'POSSIVEL BAIXA';
  badge.className=`fib-dir-badge ${antecip.direcao==='alta'?'fib-bull':'fib-bear'}`;
  detail.textContent=`StochRSI virando de zona esticada${antecip.convergindo?' + EMA8x16 convergindo':' (EMAs ainda nao convergiram)'} — sinal antecipado, cruzamento ainda nao confirmou.`;
}

// Escada de niveis do RSI com o preco que leva a cada um. O 50 vem marcado
// porque e a linha de agua: acima dele a forca e compradora.
const RSI_ESCADA=[20,30,40,50,60,70,80];

function updateRsiInversoPanel(closes){
  const curEl=document.getElementById('rsiinv-current');
  const box=document.getElementById('rsiinv-escada');
  if(!curEl||!box)return;
  const st=rsiState(closes,14);
  if(!st){curEl.textContent='--';box.innerHTML='<div class="stoch-row"><span class="stoch-lbl">sem dados</span></div>';return;}
  const baseRSI = st.al===0 ? 100 : (st.ag===0 ? 0 : 100-(100/(1+st.ag/st.al)));
  curEl.textContent=`RSI ${baseRSI.toFixed(1)}`;
  const px=st.last;
  box.innerHTML=RSI_ESCADA.map(nv=>{
    const preco=precoParaRSI(st.ag,st.al,px,nv);
    const acima=nv>baseRSI;
    // vermelho embaixo (sobrevendido), verde em cima (sobrecomprado), o 50 neutro
    const cor = nv<50 ? "var(--red)" : (nv>50 ? "var(--green)" : "var(--t2)");
    const dist = (preco!=null&&px) ? ((preco-px)/px*100) : null;
    const distTxt = dist==null ? "" : "  <span style=\"color:var(--t3);font-size:9px;\">("
      +(dist>=0?"+":"")+dist.toFixed(2)+"%)</span>";
    const valor = preco==null ? (acima?"ja acima":"ja abaixo") : preco.toFixed(2)+distTxt;
    const marca = nv===50 ? ' style="border-top:1px solid var(--bd2);border-bottom:1px solid var(--bd2);"' : "";
    return '<div class="stoch-row"'+marca+'><span class="stoch-lbl">RSI '+nv
      +(nv===30?" (OS)":nv===70?" (OB)":nv===50?" (agua)":"")+'</span>'
      +'<span class="stoch-val" style="color:'+cor+'">'+valor+'</span></div>';
  }).join("");
}

let sentimentLoadSeq=0;
async function updateSentimentPanel(){
  const body=document.getElementById('sentiment-body');
  const upd=document.getElementById('sentiment-updated');
  if(!body)return;
  const mySym=currentSym, mySeq=++sentimentLoadSeq;
  body.innerHTML='Carregando...';

  const [funding, oi, oiHist, longShort, book]=await Promise.all([
    fetchFundingRate(mySym),
    fetchOpenInterest(mySym),
    fetchOIHistory(mySym,'1h',25),
    fetchLongShortRatio(mySym,'1h'),
    fetchOrderBookImbalance(mySym,20),
  ]);
  if(mySeq!==sentimentLoadSeq||currentSym!==mySym)return; // ativo trocou enquanto buscava

  if(!funding&&!oi&&!longShort&&!book){
    body.innerHTML='Sem dado de futuros pra esse ativo (provavelmente metal/sem contrato na Binance).';
    return;
  }

  const priceDirection = candles.length>2 ? (candles[candles.length-1].close>=candles[candles.length-5]?.close ? 'alta':'baixa') : null;
  const fInterp=interpretFunding(funding?funding.rate:null);
  const oiInterp=interpretOI(oiHist,priceDirection);
  const lsInterp=interpretLongShort(longShort);
  const bookInterp=interpretBookImbalance(book);
  const volInterp=interpretVolumeConfirm(candles);

  const rows=[
    {lbl:'Funding Rate', val:fInterp.label, warn:fInterp.extreme},
    {lbl:'Open Interest', val:oiInterp.label, warn:oiInterp.healthy===false},
    {lbl:'Long/Short', val:lsInterp.label, warn:lsInterp.extreme},
    {lbl:'Book (bid×ask)', val:bookInterp.label, warn:false},
    {lbl:'Volume', val:volInterp.label, warn:false},
  ];
  body.innerHTML=rows.map(r=>
    `<div style="margin-bottom:5px;"><b style="color:${r.warn?'var(--goldd)':'var(--t2)'};">${r.lbl}:</b> <span style="color:${r.warn?'var(--goldd)':'var(--text)'};">${r.val}</span></div>`
  ).join('');

  if(upd){const now=new Date();upd.textContent=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;}
}


function updateFibPanel(){
  const db=document.getElementById('fib-dir-badge');
  if(!fibState.targets||!fibState.targets.length){db.textContent='FLAT';db.className='fib-dir-badge fib-flat';document.getElementById('fib-list').innerHTML='<div style="color:var(--t3);font-size:9px;padding:4px 0;">Aguardando ancora...</div>';return;}
  db.textContent=fibState.bull?'BULL':'BEAR';db.className=`fib-dir-badge ${fibState.bull?'fib-bull':'fib-bear'}`;
  let html='',prevHit=true;
  fibState.targets.forEach(t=>{
    const col=fibColors[t.lv]||'#FFFFFF';
    const st=t.hit?'OK':prevHit?'>>':'--';
    const cls=t.hit?'fib-hit':prevHit?'fib-pending':'fib-old';
    html+=`<div class="fib-item"><span class="fib-lvl" style="color:${col};">${t.lv}</span><span class="fib-px">${t.price.toFixed(2)}</span><span class="fib-status ${cls}">${st}</span></div>`;
    prevHit=t.hit;
  });
  if(fibState.oldTargets&&fibState.oldTargets.length){
    html+='<div style="font-size:7px;color:var(--t3);padding:3px 0 1px;letter-spacing:.1em;">MEMORIA</div>';
    fibState.oldTargets.slice(0,4).forEach(t=>{
      const col=fibColors[t.lv]||'#FFFFFF';
      html+=`<div class="fib-item" style="opacity:.5;"><span class="fib-lvl fib-old" style="color:${col};">mem ${t.lv}</span><span class="fib-px">${t.price.toFixed(2)}</span><span class="fib-status fib-old">${t.hit?'OK':'--'}</span></div>`;
    });
  }
  document.getElementById('fib-list').innerHTML=html;
}

function updateRiskPanel(close,atrV){
  if(!fibState.targets||!fibState.targets.length)return;
  // TPs usam os 3 primeiros niveis de extensao (>=1) dos 24: alvos reais de lucro,
  // nao os niveis de retracao (<1) que so marcam zona de pullback.
  const ext=fibState.targets.filter(t=>t.lv>=1).slice(0,3);
  if(ext.length<3)return;
  const [t1,t2,t3]=ext;
  const tp1=Math.abs(t1.price-close),tp2=Math.abs(t2.price-close),tp3=Math.abs(t3.price-close);
  const g1=P.stake*(tp1/close)*P.mult,g2=P.stake*(tp2/close)*P.mult,g3=P.stake*(tp3/close)*P.mult;
  const rr=g1/P.stake;
  document.getElementById('risk-rr').textContent=rr.toFixed(2)+(rr>=3.1?' [IDEAL]':rr>=2?' [OK]':' [BAIXO]');
  document.getElementById('risk-lbl1').textContent='TP '+t1.lv;
  document.getElementById('risk-lbl2').textContent='TP '+t2.lv;
  document.getElementById('risk-lbl3').textContent='TP '+t3.lv;
  // Verde na alta, vermelho na baixa — antes ficava sempre verde mesmo com fib BEAR.
  const cls=fibState.bull?'green':'red';
  [1,2,3].forEach(i=>{const el=document.getElementById('risk-tp'+i);el.className='risk-val '+cls;});
  document.getElementById('risk-tp1').textContent='+$'+g1.toFixed(2);
  document.getElementById('risk-tp2').textContent='+$'+g2.toFixed(2);
  document.getElementById('risk-tp3').textContent='+$'+g3.toFixed(2);
}

// ══════════════════════════════════════════════════════
// CHART
// ══════════════════════════════════════════════════════
function setupChart(){
  const ce=document.getElementById('chart');
  chart=LightweightCharts.createChart(ce,{
    width:ce.clientWidth,height:ce.clientHeight,
    // transparente pra bolha de tras aparecer; quem pinta o fundo agora e o
    // .chart-wrap, no CSS
    layout:{background:{color:'transparent'},textColor:'#6e7683',fontFamily:'IBM Plex Sans'},
    grid:{vertLines:{color:'#f0f1f3'},horzLines:{color:'#f0f1f3'}},
    rightPriceScale:{borderColor:'#e3e6ea',scaleMargins:{top:0.08,bottom:0.22}},
    timeScale:{borderColor:'#e3e6ea',timeVisible:true,secondsVisible:false,
      rightOffset:3,barSpacing:7,rightBarStaysOnScroll:true,shiftVisibleRangeOnNewBar:true},
    crosshair:{mode:LightweightCharts.CrosshairMode.Normal,
      vertLine:{labelBackgroundColor:'#1a1d23'},horzLine:{labelBackgroundColor:'#1a1d23'}},
    handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},
    handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true},
    kineticScroll:{mouse:true,touch:true},
  });
  candleSeries=chart.addCandlestickSeries({upColor:'#00A879',downColor:'#EC3F3F',borderUpColor:'#00A879',borderDownColor:'#EC3F3F',wickUpColor:'#00A879',wickDownColor:'#EC3F3F'});
  const maCfg={priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false};
  // Medias moveis de volta ao grafico principal. O Rainbow (regressao log)
  // e a MA Ribbon (89 D1/W1/1M/3M) continuam de fora — esses ficam isolados
  // nas abas proprias "🌈 Rainbow" e "📐 Macro", por pedido anterior.
  maS.ema8=chart.addLineSeries({color:C.ema8,lineWidth:2,...maCfg});
  maS.ema16=chart.addLineSeries({color:C.ema16,lineWidth:2,...maCfg});
  maS.ema55=chart.addLineSeries({color:C.ema55,lineWidth:2,...maCfg});
  maS.ema98=chart.addLineSeries({color:C.ema98,lineWidth:1,...maCfg});
  maS.ema200=chart.addLineSeries({color:C.ema200,lineWidth:2,...maCfg});
  maS.ma56=chart.addLineSeries({color:C.ma56,lineWidth:2,...maCfg});
  maS.ma89=chart.addLineSeries({color:C.ma89,lineWidth:2,...maCfg});
  // RIBBON PHI CLUBE — as series NAO sao criadas fixas aqui. O Lightweight
  // Charts nao deixa uma linha mudar de cor bar a bar (diferente do Pine
  // Script), entao cada linha vira VARIOS segmentos de cor, recriados a
  // cada atualizacao — isso e o que da a cor historica de verdade, igual
  // ao script original, em vez de so a cor do estado mais recente.
  phiSegmentSeries={};
  PHI_PERIODS.forEach(p=>{ phiSegmentSeries[p]=[]; });
  volS=chart.addHistogramSeries({color:'rgba(20,24,32,.06)',priceFormat:{type:'volume'},priceScaleId:'vol',lastValueVisible:false});
  chart.priceScale('vol').applyOptions({scaleMargins:{top:0.85,bottom:0}});
  const resizeMain=()=>{chart.applyOptions({width:ce.clientWidth,height:ce.clientHeight});resizeDrawCanvas();};
  new ResizeObserver(resizeMain).observe(ce);
  // Defensivo: o flex/layout novo (nav lateral + painel de abas) as vezes so
  // termina de assentar (e a fonte IBM Plex Sans so termina de carregar)
  // depois do primeiro paint — forcamos um recalculo de tamanho nesses momentos
  // pra garantir que o grafico sempre preencha 100% do espaco disponivel.
  requestAnimationFrame(resizeMain);
  setTimeout(resizeMain,150);
  setTimeout(resizeMain,500);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(resizeMain);
  window.addEventListener('resize',resizeMain);

  // Quando a aba volta a ficar visivel depois de um tempo em segundo plano,
  // o WebSocket e os timers podem ter ficado pausados/mudos. Recarrega o
  // historico do zero pra nunca deixar buraco no grafico ao voltar pra aba.
  let hiddenAt=null;
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){hiddenAt=Date.now();}
    else if(hiddenAt&&Date.now()-hiddenAt>4000){loadAll();hiddenAt=null;}
    else{hiddenAt=null;}
  });

  const se=document.getElementById('stoch-chart');
  stochChart=LightweightCharts.createChart(se,{
    layout:{background:{color:'#fbfbfc'},textColor:'#6e7683',fontFamily:'IBM Plex Sans'},
    grid:{vertLines:{color:'#f0f1f3'},horzLines:{color:'#f0f1f3'}},
    rightPriceScale:{borderColor:'#e3e6ea'},
    timeScale:{borderColor:'#e3e6ea',timeVisible:true},
  });
  stochK=stochChart.addLineSeries({color:C.accent,lineWidth:2,lastValueVisible:false,priceLineVisible:false});
  stochD=stochChart.addLineSeries({color:C.orange,lineWidth:1,lastValueVisible:false,priceLineVisible:false});
  stochK.createPriceLine({price:80,color:'rgba(236,63,63,.35)',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'OB'});
  stochK.createPriceLine({price:20,color:'rgba(0,168,121,.35)',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'OS'});
  new ResizeObserver(()=>stochChart.applyOptions({width:se.clientWidth,height:se.clientHeight})).observe(se);
  chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(r)stochChart.timeScale().setVisibleLogicalRange(r);});

  // PAINEL PHI RIBBON — mesmo padrao do StochRSI acima: grafico proprio,
  // embaixo, sincronizado com o zoom/pan do grafico principal. O preco fica
  // limpo, so com as medias normais (8/16/55/98/200/56/89) — o ribbon
  // Phi Clube (13/17/34/72/144/305/610) vive so aqui agora.
  const pe=document.getElementById('phi-chart');
  if(pe){
    const t=theme();
    phiChart=LightweightCharts.createChart(pe,{
      width:pe.clientWidth||800,height:pe.clientHeight||80,
      layout:{background:{color:t.bg2},textColor:t.text,fontFamily:'IBM Plex Sans'},
      grid:{vertLines:{color:t.grid},horzLines:{color:t.grid}},
      rightPriceScale:{borderColor:t.border},
      timeScale:{borderColor:t.border,timeVisible:true},
    });
    new ResizeObserver(()=>phiChart.applyOptions({width:pe.clientWidth,height:pe.clientHeight})).observe(pe);
    chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{if(r)phiChart.timeScale().setVisibleLogicalRange(r);});
  }

  restorePanelSizes();
  setupResizeHandle('resize-chart-stoch','stoch-wrap-el',50,320);
  setupResizeHandle('resize-stoch-phi','phi-wrap-el',40,300);

  initLazyHistory();
}

// Aplica candles[] em todas as series (velas, volume, medias, stoch) sem
// mexer no zoom/pan atual — usado tanto no carregamento inicial (com
// fitContent) quanto ao carregar mais historico pra tras (sem fitContent,
// pra nao "pular" a visao do usuario).
const BORDER_BULL='#089981', BORDER_BEAR='#f23645';

// Recalcula o ribbon Phi + a borda de todas as velas — chamada tanto no
// carregamento completo (applySeriesData) quanto A CADA FECHAMENTO DE VELA
// em tempo real (antes so rodava no load, ficando desatualizado durante o
// dia inteiro de mercado aberto).
// ══════════════════════════════════════════════════════
// CVD — DELTA DE VOLUME ACUMULADO
// ══════════════════════════════════════════════════════
// A forca do fluxo diz quem esta agredindo AGORA. O CVD soma isso desde o
// comeco do historico: e a linha de quem venceu a queda de braco ate aqui.
//
// O valor absoluto nao diz nada (depende de quanto historico foi carregado).
// O que diz e a INCLINACAO e, principalmente, a DIVERGENCIA contra o preco:
// preco fazendo topo mais alto com CVD fazendo topo mais baixo e o preco
// subindo sem dinheiro novo comprando — quem estava dentro esta distribuindo.
function serieCVD(velas){
  let acc = 0;
  return velas.map(c => {
    const compra = c.compra||0, venda = c.venda||0;
    if(compra || venda) acc += compra - venda;
    return acc;
  });
}

// Divergencia entre o preco e o CVD nas ultimas N velas. Comparo a metade
// recente contra a metade anterior, em vez de procurar topos exatos: topo
// exato depende de como voce define topo, e a leitura fica fragil.
function divergenciaCVD(velas, nVelas){
  const n = nVelas || 60;
  if(!velas || velas.length < n + 5) return null;
  const cvd = serieCVD(velas);
  const corte = velas.length - n;
  const meio = corte + Math.floor(n/2);
  const fatia = (arr, de, ate) => arr.slice(de, ate);
  const maxP1 = Math.max(...fatia(velas, corte, meio).map(c=>c.high));
  const maxP2 = Math.max(...fatia(velas, meio, velas.length).map(c=>c.high));
  const minP1 = Math.min(...fatia(velas, corte, meio).map(c=>c.low));
  const minP2 = Math.min(...fatia(velas, meio, velas.length).map(c=>c.low));
  const maxC1 = Math.max(...fatia(cvd, corte, meio));
  const maxC2 = Math.max(...fatia(cvd, meio, cvd.length));
  const minC1 = Math.min(...fatia(cvd, corte, meio));
  const minC2 = Math.min(...fatia(cvd, meio, cvd.length));

  const cvdAtual = cvd[cvd.length-1], cvdAntes = cvd[corte];
  const inclinacao = cvdAtual - cvdAntes;

  let tipo = null;
  if(maxP2 > maxP1 && maxC2 < maxC1) tipo = "baixista";   // topo mais alto, CVD mais baixo
  if(minP2 < minP1 && minC2 > minC1) tipo = "altista";    // fundo mais baixo, CVD mais alto
  return {velas:n, tipo, inclinacao,
          subindo: inclinacao > 0,
          cvd_atual: cvdAtual};
}
window.serieCVD = serieCVD;
window.divergenciaCVD = divergenciaCVD;

// ══════════════════════════════════════════════════════
// MARCOS DE VOLUME — a maior vela do dia, da semana e do mes
// ══════════════════════════════════════════════════════
// A bolha diz quanto foi o volume de cada vela. Isto aqui diz outra coisa:
// QUAL vela mandou no periodo. Sao poucas por tela, e cada uma marca um ponto
// que o mercado inteiro viu.
//
//   dourado    -> maior volume do DIA
//   prateado   -> maior volume da SEMANA
//   roxo neon  -> maior volume do MES
//
// O mais forte manda: a maior do mes tambem e a maior da semana e do dia dela,
// e sai como roxo, nao como tres marcas empilhadas.
//
// SO MARCO PERIODO MAIOR QUE O TEMPO GRAFICO. Num grafico mensal nao existe
// "maior vela do dia" — cada vela JA e um mes. Sem essa guarda toda vela do 1M
// viraria marco dos tres de uma vez.
const MARCO_CORES = {
  dia:    {corpo:'#E8A317', halo:'255,196,60',  nome:'dia'},
  semana: {corpo:'#9AA4B0', halo:'220,228,238', nome:'semana'},
  mes:    {corpo:'#A855F7', halo:'190,120,255', nome:'mes'},
};
const MARCO_ORDEM = {dia:1, semana:2, mes:3};

function chaveDoPeriodo(timeSeg, periodo){
  const d = new Date(timeSeg*1000);
  const ano = d.getUTCFullYear();
  if(periodo === 'mes')    return ano+'-'+d.getUTCMonth();
  if(periodo === 'semana'){
    // semana ISO simplificada: o domingo que abre a semana daquela data
    const dom = Math.floor((timeSeg - (d.getUTCDay()*86400)) / 86400);
    return 'w'+dom;
  }
  return ano+'-'+d.getUTCMonth()+'-'+d.getUTCDate();
}

function volumeDaVela(c){
  const notional = (c.compra||0) + (c.venda||0);
  if(notional > 0) return notional;
  // fonte sem o corte agressor: o volume em moeda ainda serve pra ranquear
  return (c.volume||0) * (c.close||1);
}

// Marca a maior vela de cada dia/semana/mes do historico carregado.
function calculaMarcosVolume(velas, tfSeg){
  const marcas = {};   // indice da vela -> 'dia' | 'semana' | 'mes'
  if(!velas || velas.length < 3) return marcas;
  const periodos = [];
  if(tfSeg < 86400)   periodos.push('dia');
  if(tfSeg < 604800)  periodos.push('semana');
  if(tfSeg < 2592000) periodos.push('mes');
  if(!periodos.length) return marcas;

  periodos.forEach(periodo => {
    const melhorPorChave = {};
    velas.forEach((c,i) => {
      const v = volumeDaVela(c);
      if(!(v > 0)) return;
      const k = chaveDoPeriodo(c.time, periodo);
      const atual = melhorPorChave[k];
      if(!atual || v > atual.v) melhorPorChave[k] = {i, v};
    });
    Object.values(melhorPorChave).forEach(({i}) => {
      // o periodo maior manda: a maior do mes nao vira "maior do dia"
      if(!marcas[i] || MARCO_ORDEM[periodo] > MARCO_ORDEM[marcas[i]]) marcas[i] = periodo;
    });
  });
  return marcas;
}

// O MARCO QUE INTERESSA E O FRIO COM RSI VIRANDO.
// Volume alto no meio de uma tendencia quente e continuacao — normal, nao
// avisa nada. Volume alto quando o ribbon esta indeciso E o RSI acabou de
// cruzar a agua e outra coisa: e o dinheiro entrando ANTES do preco decidir.
// E esse que ganha brilho forte; os demais ficam so marcados.
const MARCO_JANELA_RSI = 3;   // velas de folga entre o volume e o cruzamento

function marcoQualificado(idx, score, rsiArr){
  if(score == null || Math.abs(score) > 0.25) return false;   // nao esta frio
  if(!rsiArr) return false;
  // "acompanhando o RSI cruzando" nao quer dizer na mesma vela exata: o volume
  // costuma vir um pouco antes ou um pouco depois do cruzamento. Exigir a vela
  // exata derrubava praticamente todos — em mil velas, zero.
  for(let i = Math.max(1, idx-MARCO_JANELA_RSI); i <= Math.min(rsiArr.length-1, idx+MARCO_JANELA_RSI); i++){
    const a = rsiArr[i-1], b = rsiArr[i];
    if(a == null || b == null) continue;
    const cruzou = nv => (a < nv && b >= nv) || (a > nv && b <= nv);
    if(cruzou(50) || cruzou(30) || cruzou(70)) return true;
  }
  return false;
}

// O brilho vai no canvas de TRAS, entao ele aparece em volta da vela sem
// cobri-la — o mesmo motivo pelo qual as bolhas foram pra la.
function pintaHalosMarcos(ctx, larguraCss, velas, marcas, qualificados, t2xFn, p2yFn){
  if(!ctx || !marcas) return 0;
  let n = 0;
  Object.keys(marcas).forEach(k => {
    const i = +k, vela = velas[i];
    if(!vela) return;
    const x = t2xFn(vela.time);
    if(x == null || x < -60 || x > larguraCss + 60) return;
    const yA = p2yFn(vela.high), yB = p2yFn(vela.low);
    if(yA == null || yB == null) return;
    const cfg = MARCO_CORES[marcas[i]];
    const forte = qualificados && qualificados[i];
    const cy = (yA + yB) / 2;
    // O halo acompanha o tamanho da vela mas tem piso proprio: numa vela
    // pequena ele ainda precisa ser visto, senao o marco vira so uma vela de
    // cor diferente e o "aceso" se perde.
    const raio = Math.max(forte ? 34 : 24, Math.abs(yB - yA)/2 + (forte ? 38 : 24));
    const g = ctx.createRadialGradient(x, cy, 0, x, cy, raio);
    g.addColorStop(0,    "rgba("+cfg.halo+","+(forte ? 0.85 : 0.5)+")");
    g.addColorStop(0.35, "rgba("+cfg.halo+","+(forte ? 0.45 : 0.24)+")");
    g.addColorStop(0.7,  "rgba("+cfg.halo+","+(forte ? 0.16 : 0.08)+")");
    g.addColorStop(1,    "rgba("+cfg.halo+",0)");
    ctx.beginPath();
    ctx.arc(x, cy, raio, 0, Math.PI*2);
    ctx.fillStyle = g;
    ctx.fill();
    n++;
  });
  return n;
}

// O voto binario (bull/bear) da um degrau seco: vermelho, cinza, verde. O que
// se quer ver e a TEMPERATURA — o ribbon vermelho esfria, a vela clareia, e so
// entao esverdeia. Entao guardo a proporcao do voto, nao o vencedor.
//
// Score = (subindo - descendo) / total, de -1 a +1. Como sao 19 medias
// votando, ele muda de uma media por vez e a passagem sai suave sozinha; a EMA
// por cima so tira o tremor de uma media que vai e volta.
function computePhiScoreSeries(phiArrs){
  const n=phiArrs[0].length;
  const voteLookback=8;
  const bruto=new Array(n).fill(null);
  for(let i=0;i<n;i++){
    if(i<voteLookback) continue;
    let up=0, down=0;
    for(let k=0;k<phiArrs.length;k++){
      const now=phiArrs[k][i], past=phiArrs[k][i-voteLookback];
      if(now==null||past==null)continue;
      if(now>past)up++; else if(now<past)down++;
    }
    const tot=up+down;
    if(!tot) continue;
    bruto[i]=(up-down)/tot;
  }
  const kk=2/(6+1);   // EMA de 6: alisa sem atrasar a virada
  let ant=null;
  return bruto.map(v=>{
    if(v==null) return null;
    ant = (ant==null) ? v : v*kk + ant*(1-kk);
    return ant;
  });
}

// Vermelho cheio (-1) -> neutro claro (0) -> verde cheio (+1). Passa pelo
// neutro de proposito: interpolar vermelho direto pra verde atravessa o marrom,
// que e o que faz um gradiente desses ficar sujo.
//
// O expoente 0,7 acende a cor mais rapido perto dos extremos, entao a vela
// so fica pastel de verdade quando o ribbon esta mesmo indeciso.
function corTemperaturaVela(score){
  const escuro = (typeof darkMode!=="undefined") && darkMode;
  const neutro = escuro ? [64,70,80] : [219,224,230];
  const alvo   = score >= 0 ? [8,153,129] : [242,54,69];
  const f = Math.pow(Math.min(1, Math.abs(score)), 0.7);
  const c = neutro.map((v,i)=> Math.round(v + (alvo[i]-v)*f));
  return "rgb("+c[0]+","+c[1]+","+c[2]+")";
}

function refreshPhiRibbonAndBorders(){
  const closes=candles.map(c=>c.close);
  const phiArrs=PHI_PERIODS.map(p=>ema(closes,p));
  const alignmentPerBar=computePhiAlignmentSeries(phiArrs);
  const scorePerBar=computePhiScoreSeries(phiArrs);
  renderPhiRibbonSegments(candles,phiArrs,alignmentPerBar);

  // marcos de volume: a maior vela do dia, da semana e do mes
  const rsiArr = rsiCalc(candles.map(c=>c.close), 14);
  marcosVolume = calculaMarcosVolume(candles, tfToSeconds(currentTF));
  marcosFortes = {};
  Object.keys(marcosVolume).forEach(k=>{
    if(marcoQualificado(+k, scorePerBar[+k], rsiArr)) marcosFortes[k]=true;
  });

  // O CORPO leva a temperatura do ribbon; a BORDA guarda se a vela fechou em
  // alta ou em baixa. Antes era o contrario — corpo na cor real e borda no
  // ribbon — e a passagem de vermelho pra verde nao aparecia, porque so um
  // fiozinho de borda mudava de cor.
  candleSeries.setData(candles.map((c,i)=>{
    const s=scorePerBar[i];
    // o marco pinta por cima da temperatura: ali o que importa nao e o humor
    // do ribbon, e que ESTA vela foi a maior do periodo
    const m=marcosVolume[i];
    if(m){
      const cfg=MARCO_CORES[m];
      return {...c, color:cfg.corpo, wickColor:cfg.corpo, borderColor:cfg.corpo};
    }
    if(s==null) return c;
    const cor=corTemperaturaVela(s);
    return {...c, color:cor, wickColor:cor,
            borderColor: c.close>=c.open ? BORDER_BULL : BORDER_BEAR};
  }));
  return {phiArrs,alignmentPerBar,scorePerBar};
}

// Versao leve pra rodar A CADA TICK (nao so no fechamento) — so recalcula o
// voto de maioria da vela mais recente (a que ainda esta se formando) e
// atualiza so a borda DELA, sem re-renderizar o ribbon inteiro (isso sim so
// no fechamento, via refreshPhiRibbonAndBorders, pra nao pesar a cada trade).
function updateLiveCandleBorder(){
  if(candles.length<PHI_PERIODS[PHI_PERIODS.length-1]+10)return; // historico insuficiente ainda
  const closes=candles.map(c=>c.close);
  const n=closes.length-1, lookback=8;
  if(n<lookback)return;
  let up=0,down=0;
  PHI_PERIODS.forEach(p=>{
    const arr=ema(closes,p);
    const now=arr[n], past=arr[n-lookback];
    if(now==null||past==null)return;
    if(now>past)up++; else if(now<past)down++;
  });
  if(up===0&&down===0)return;
  const last=candles[n];
  const cor=corTemperaturaVela((up-down)/(up+down));
  try{ candleSeries.update({time:last.time,open:last.open,high:last.high,low:last.low,close:last.close,
    color:cor, wickColor:cor,
    borderColor: last.close>=last.open ? BORDER_BULL : BORDER_BEAR}); }catch(e){}
}

function applySeriesData(){
  const closes=candles.map(c=>c.close);

  // Ribbon Phi Clube + cor das velas — calculado ANTES do resto, porque e o
  // score por barra que da a TEMPERATURA do corpo de cada vela. A borda e que
  // guarda a cor real (fechou em alta ou em baixa).
  refreshPhiRibbonAndBorders();

  volS.setData(candles.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?'rgba(0,230,118,.15)':'rgba(244,67,54,.15)'})));
  const e8=ema(closes,8),e16=ema(closes,16),e55=ema(closes,55),e98=ema(closes,98),e200=ema(closes,200);
  const m56=sma(closes,56),m89=sma(closes,89);
  const map=(arr)=>candles.map((c,i)=>({time:c.time,value:arr[i]})).filter(d=>d.value!=null);
  maS.ema8.setData(map(e8));maS.ema16.setData(map(e16));maS.ema55.setData(map(e55));
  maS.ema98.setData(map(e98));maS.ema200.setData(map(e200));maS.ma56.setData(map(m56));maS.ma89.setData(map(m89));

  const rD=rsiCalc(closes,P.rsiLen),sD=stochCalc(rD,P.stochLen),kD=sma(sD,P.kSmooth),dD=sma(kD,P.dSmooth);
  stochK.setData(map(kD));stochD.setData(map(dD));
  return {closes,e8,e16,e55,e98,e200,m56,m89,rD,kD,dD};
}

// ── HISTORICO SOB DEMANDA ──────────────────────────────
// Ao dar zoom out ou arrastar pra esquerda perto da borda dos dados
// carregados, busca mais candles antigas da Binance e as insere no inicio,
// preservando exatamente a posicao de zoom/pan que o usuario ja tinha.
let loadingMoreHistory=false, noMoreHistory=false, loadingFullHistory=false;
const HIST_CAP=20000; // teto de seguranca de memoria (20 mil velas)

function initLazyHistory(){
  chart.timeScale().subscribeVisibleLogicalRangeChange(range=>{
    if(!range||loadingMoreHistory||loadingFullHistory||noMoreHistory||candles.length<10)return;
    if(range.from<15)loadOlderCandles();
  });
}

function updateHistInfo(){
  const el=document.getElementById('hist-info');
  if(!el||!candles.length)return;
  const oldest=new Date(candles[0].time*1000);
  const dd=String(oldest.getDate()).padStart(2,'0'),mm=String(oldest.getMonth()+1).padStart(2,'0'),yy=oldest.getFullYear();
  el.textContent=`${candles.length} velas · desde ${dd}/${mm}/${yy}`;
}

// Retorna true se conseguiu buscar (e prepender) mais um lote de velas antigas.
async function fetchOlderBatch(){
  const sym=currentSym,tf=currentTF;
  const oldest=candles[0].time;
  try{
    const endTime=oldest*1000-1;
    const r=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=1000&endTime=${endTime}`,{signal:AbortSignal.timeout(10000)});
    if(sym!==currentSym||tf!==currentTF)return false; // ativo trocou enquanto buscava
    if(!r.ok)return false;
    const d=await r.json();
    if(sym!==currentSym||tf!==currentTF)return false;
    if(!d.length){noMoreHistory=true;return false;}
    const older=d.map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}))
      .filter(c=>c.time<oldest);
    if(!older.length){noMoreHistory=true;return false;}

    const addedCount=older.length;
    candles=[...older,...candles];
    if(candles.length>HIST_CAP)candles=candles.slice(-HIST_CAP); // corta as mais ANTIGAS, mantem as recentes/ao vivo
    semeiaFluxoDoHistorico(); // as velas que acabaram de chegar tambem tem bolha

    const visRange=chart.timeScale().getVisibleLogicalRange();
    applySeriesData();
    if(visRange){
      chart.timeScale().setVisibleLogicalRange({from:visRange.from+addedCount,to:visRange.to+addedCount});
    }
    updateHistInfo();
    return true;
  }catch(e){return false;}
}

async function loadOlderCandles(){
  loadingMoreHistory=true;
  await fetchOlderBatch();
  loadingMoreHistory=false;
}

// Botao "Tudo": busca o historico inteiro disponivel na Binance de uma vez,
// pra analisar tendencia macro sem precisar ficar arrastando aos poucos.
async function loadFullHistory(){
  if(loadingFullHistory||loadingMoreHistory)return;
  loadingFullHistory=true;
  const btn=document.getElementById('btn-fullhist');
  const label=btn.textContent;
  let i=0;
  while(!noMoreHistory&&candles.length<HIST_CAP&&i<60){
    btn.textContent=`⏳ ${candles.length}`;
    const ok=await fetchOlderBatch();
    if(!ok)break;
    await new Promise(r=>setTimeout(r,120)); // nao martelar o rate-limit da Binance
    i++;
  }
  btn.textContent=label;
  loadingFullHistory=false;
  chart.timeScale().fitContent();
}

function renderChart(){
  if(!candles.length||!chart)return;
  const {closes,e8,e16,e55,e98,e200,m56,m89,rD,kD,dD}=applySeriesData();
  chart.timeScale().fitContent();
  updateHistInfo();

  // Baseline confirmado ate a penultima vela (a ultima ainda esta se formando).
  // Isso permite que cada tick atualize TODAS as medias em O(1), sem varrer
  // o array inteiro de 1000 velas a cada trade recebido.
  const n2=closes.length-2;
  const pick=(arr)=>n2>=0?arr[n2]:arr[arr.length-1];
  liveState.ema8=pick(e8);liveState.ema16=pick(e16);liveState.ema55=pick(e55);
  liveState.ema98=pick(e98);liveState.ema200=pick(e200);
  liveState.sma56Win=closes.slice(0,-1).slice(-56);
  liveState.sma89Win=closes.slice(0,-1).slice(-89);
  liveState.rsiBase=rsiState(closes.slice(0,-1),P.rsiLen);
  liveState.rsiHist=rD.slice(0,-1).filter(v=>v!=null).slice(-(P.stochLen+P.kSmooth+P.dSmooth+5));
  liveState.kHist=kD.slice(0,-1).filter(v=>v!=null).slice(-(P.dSmooth+5));

  redrawDrawings();
  // Run signal engine
  const highs=candles.map(c=>c.high),lows=candles.map(c=>c.low),opens=candles.map(c=>c.open);
  runSignals(closes,highs,lows,opens);
}

// Um laco de animacao so precisa rodar enquanto o desenho aparece. Os dois
// globos sao decorativos e desenhavam 60x por segundo pra sempre, mesmo com o
// painel numa aba escondida — gasto puro de bateria no celular. O
// IntersectionObserver cobre os dois casos de uma vez: sair da tela por
// rolagem e o display:none da troca de aba, ja que um elemento com
// display:none nunca intersecta. Nao trato aba em segundo plano aqui porque
// o proprio requestAnimationFrame ja pausa sozinho nesse caso.
function lacoVisivel(el,quadro){
  let rodando=false,id=null;
  const passo=()=>{if(!rodando)return;quadro();id=requestAnimationFrame(passo);};
  const liga=()=>{if(rodando)return;rodando=true;id=requestAnimationFrame(passo);};
  const desliga=()=>{rodando=false;if(id)cancelAnimationFrame(id);id=null;};
  if(typeof IntersectionObserver==="function"){
    new IntersectionObserver(es=>{es[0].isIntersecting?liga():desliga();}).observe(el);
  }else liga(); // navegador sem suporte: segue como era antes
  return{liga,desliga};
}

// ══════════════════════════════════════════════════════
// GLOBE 3D
// ══════════════════════════════════════════════════════
(function(){
  const cv=document.getElementById('globe-canvas'),ctx=cv.getContext('2d');
  const W=250,H=170,CX=125,CY=85,R=65;let ang=0;
  const pts=[[40.7,-74],[51.5,0],[35.7,139.7],[22.3,114.2],[-23.5,-46.6],[-34.6,-58.4],[48.9,2.3],[37.5,127]];
  const cols=['#00E5FF','#00E676','#F44336','#FFD600','#FFD600','#F44336','#00E676','#00E5FF'];
  function proj(lat,lon){const phi=(90-lat)*Math.PI/180,th=(lon+ang)*Math.PI/180;
    const x=R*Math.sin(phi)*Math.cos(th),y=R*Math.cos(phi),z=R*Math.sin(phi)*Math.sin(th);
    return{x:CX+x,y:CY-y,z,vis:z>-10};}
  function draw(){
    ctx.clearRect(0,0,W,H);
    const g=ctx.createRadialGradient(CX,CY,0,CX,CY,R);
    g.addColorStop(0,'rgba(245,166,35,.04)');g.addColorStop(.7,'rgba(0,229,255,.03)');g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(CX,CY,R,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba(245,166,35,.15)';ctx.lineWidth=1;ctx.beginPath();ctx.arc(CX,CY,R,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,.04)';ctx.lineWidth=.5;
    [-60,-30,0,30,60].forEach(lat=>{const phi=(90-lat)*Math.PI/180,yr=CY-R*Math.cos(phi),xr=R*Math.sin(phi);
      ctx.beginPath();ctx.ellipse(CX,yr,xr,xr*.15,0,0,Math.PI*2);ctx.stroke();});
    for(let lo=0;lo<360;lo+=30){let p2=[];for(let la=-90;la<=90;la+=5){const p=proj(la,lo);if(p.z>0)p2.push(p);}if(p2.length>1){ctx.beginPath();ctx.moveTo(p2[0].x,p2[0].y);p2.forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke();}}
    pts.forEach(([lat,lon],i)=>{
      const p=proj(lat,lon);if(!p.vis)return;
      const col=cols[i],al=Math.min(1,(p.z+R)/(2*R));
      ctx.beginPath();ctx.arc(p.x,p.y,5+3*Math.sin(Date.now()/800+lat),0,Math.PI*2);
      ctx.strokeStyle=col+'44';ctx.lineWidth=1;ctx.stroke();
      ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle=col;ctx.globalAlpha=al*.9;ctx.fill();ctx.globalAlpha=1;
      const gr=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,8);gr.addColorStop(0,col+'60');gr.addColorStop(1,'transparent');
      ctx.fillStyle=gr;ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fill();
    });
    ang+=.3;
  }
  lacoVisivel(cv,draw);
})();

// ══════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// FONTES DE DADOS ALTERNATIVAS — se a Binance falhar (rate limit, fora do
// ar, bloqueio de rede), tenta em cascata: Bybit -> OKX -> Kraken ->
// Coinbase. Cada uma tem formato de intervalo e simbolo diferente, entao
// cada fonte sabe converter o padrao Binance ('5m','1h','4h'...) pro
// formato dela. Mantem a MESMA assinatura fetchCandles(sym,tf,limit) —
// nenhum outro lugar do arquivo precisa mudar.
// ══════════════════════════════════════════════════════
let lastDataSource = 'binance'; // pra mostrar na UI qual fonte respondeu por ultimo

function toCryptoBase(sym){ return sym.replace(/USDT$/,''); } // 'BTCUSDT' -> 'BTC'

const DATA_SOURCES = [
  {
    name:'binance',
    build:(sym,tf,limit)=>`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=${limit}`,
    // k[7] e o volume em dolar da vela e k[10] a parte que veio de quem
    // comprou a mercado. Os dois ja vinham na resposta e eram jogados fora —
    // e sao exatamente o que as bolhas precisam, direto da Binance, sem
    // estimativa. Nenhuma outra fonte publica esse corte.
    parse:(d)=>d.map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5],
      compra:+k[10]||0, venda:Math.max(0,(+k[7]||0)-(+k[10]||0))})),
  },
  {
    name:'bybit',
    tfMap:{'1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240','5h':'300','6h':'360','12h':'720','1d':'D','1w':'W','1M':'M','3M':'3M','6M':'6M','9M':'9M','12M':'12M'},
    build(sym,tf,limit){ const iv=this.tfMap[tf]; if(!iv)return null; return `https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}&interval=${iv}&limit=${Math.min(limit,1000)}`; },
    parse:(d)=>{
      const list=d?.result?.list; if(!list)return null;
      // Bybit devolve do mais novo pro mais antigo — inverte pra ficar cronologico
      return list.map(k=>({time:Math.floor(+k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]})).reverse();
    },
  },
  {
    name:'okx',
    tfMap:{'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','4h':'4H','5h':'5H','6h':'6H','12h':'12H','1d':'1D','1w':'1W','1M':'1M','3M':'3M','6M':'6M','9M':'9M','12M':'1Y'},
    build(sym,tf,limit){ const iv=this.tfMap[tf]; if(!iv)return null; const inst=toCryptoBase(sym)+'-USDT'; return `https://www.okx.com/api/v5/market/candles?instId=${inst}&bar=${iv}&limit=${Math.min(limit,300)}`; },
    parse:(d)=>{
      const list=d?.data; if(!list)return null;
      return list.map(k=>({time:Math.floor(+k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]})).reverse();
    },
  },
  {
    name:'kraken',
    tfMap:{'1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240,'1d':1440,'1w':10080}, // sem suporte a '1M'
    build(sym,tf,limit){
      const iv=this.tfMap[tf]; if(!iv)return null;
      let base=toCryptoBase(sym); if(base==='BTC')base='XBT'; // Kraken usa XBT, nao BTC
      return `https://api.kraken.com/0/public/OHLC?pair=${base}USD&interval=${iv}`;
    },
    parse:(d)=>{
      if(!d?.result)return null;
      const key=Object.keys(d.result).find(k=>k!=='last'); if(!key)return null;
      const rows=d.result[key]; if(!rows)return null;
      // Kraken ja devolve em ordem cronologica (mais antigo primeiro)
      return rows.map(r=>({time:Math.floor(r[0]),open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[6]}));
    },
  },
  {
    name:'coinbase',
    tfMap:{'1m':60,'5m':300,'15m':900,'1h':3600,'1d':86400}, // sem 30m/4h/1w/1M
    build(sym,tf,limit){ const g=this.tfMap[tf]; if(!g)return null; const prod=toCryptoBase(sym)+'-USD'; return `https://api.exchange.coinbase.com/products/${prod}/candles?granularity=${g}`; },
    parse:(d)=>{
      if(!Array.isArray(d))return null;
      // Coinbase: [time, low, high, open, close, volume] — ordem diferente das outras — e mais novo primeiro
      return d.map(k=>({time:Math.floor(k[0]),low:+k[1],high:+k[2],open:+k[3],close:+k[4],volume:+k[5]})).reverse();
    },
  },
];

// ══════════════════════════════════════════════════════
// SENTIMENTO DE MERCADO — Funding Rate, Open Interest, Long/Short Ratio,
// Desequilibrio do Book, Confirmacao de Volume. Todos gratuitos na Binance
// Futures (mesma API que ja usamos pra velas). So funcionam pra ativos com
// contrato futuro na Binance (a maioria da lista cripto; metais nao tem).
// ══════════════════════════════════════════════════════

async function fetchFundingRate(sym){
  try{
    const r=await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`,{signal:AbortSignal.timeout(6000)});
    if(!r.ok)return null;
    const d=await r.json();
    return {rate:+d.lastFundingRate, markPrice:+d.markPrice, nextTime:d.nextFundingTime};
  }catch(e){ return null; }
}

async function fetchOpenInterest(sym){
  try{
    const r=await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`,{signal:AbortSignal.timeout(6000)});
    if(!r.ok)return null;
    const d=await r.json();
    return +d.openInterest;
  }catch(e){ return null; }
}

async function fetchOIHistory(sym,period='1h',limit=25){
  try{
    const r=await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=${period}&limit=${limit}`,{signal:AbortSignal.timeout(6000)});
    if(!r.ok)return null;
    const d=await r.json();
    if(!Array.isArray(d)||!d.length)return null;
    return d.map(x=>+x.sumOpenInterest);
  }catch(e){ return null; }
}

async function fetchLongShortRatio(sym,period='1h'){
  try{
    const r=await fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=${period}&limit=1`,{signal:AbortSignal.timeout(6000)});
    if(!r.ok)return null;
    const d=await r.json();
    if(!Array.isArray(d)||!d.length)return null;
    return {longAccount:+d[0].longAccount, shortAccount:+d[0].shortAccount, ratio:+d[0].longShortRatio};
  }catch(e){ return null; }
}

async function fetchOrderBookImbalance(sym,depth=20){
  try{
    const r=await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${sym}&limit=${depth}`,{signal:AbortSignal.timeout(6000)});
    if(!r.ok)return null;
    const d=await r.json();
    const bidVol=d.bids.reduce((s,[p,q])=>s+(+q),0);
    const askVol=d.asks.reduce((s,[p,q])=>s+(+q),0);
    const total=bidVol+askVol;
    if(total===0)return null;
    return {bidVol, askVol, imbalance:(bidVol-askVol)/total}; // -1 (so venda) a +1 (so compra)
  }catch(e){ return null; }
}

// ---------- Interpretacao (transforma numero cru em leitura de sentimento) ----------

// Funding tipico fica entre -0.01% e +0.01%. Acima de +-0.05% ja e extremo —
// mercado desequilibrado em alavancagem de um lado, sinal contrario classico.
function interpretFunding(rate){
  if(rate==null)return{label:'--',extreme:false,bias:null};
  const pct=rate*100;
  const extreme=Math.abs(pct)>0.05;
  const bias = pct>0 ? 'comprado' : pct<0 ? 'vendido' : 'neutro';
  return{
    pct, extreme, bias,
    label: extreme
      ? `Funding ${pct>0?'muito positivo':'muito negativo'} (${pct.toFixed(4)}%) — mercado ${bias} em excesso, risco de esticamento contrario`
      : `Funding normal (${pct.toFixed(4)}%)`,
  };
}

// Combina tendencia do OI com direcao do preco: OI subindo + preco subindo =
// dinheiro novo entrando (tendencia saudavel). OI caindo + preco subindo =
// so cobertura de venda fechando (tendencia fraca, sem gente nova comprando).
function interpretOI(oiHistory, priceDirection){
  if(!oiHistory||oiHistory.length<5)return{label:'--',healthy:null};
  const first=oiHistory[0], last=oiHistory[oiHistory.length-1];
  const oiChangePct=first>0?((last-first)/first*100):0;
  const oiRising=oiChangePct>1;
  const oiFalling=oiChangePct<-1;
  let healthy=null, label='OI estavel';
  if(priceDirection==='alta'){
    if(oiRising){healthy=true; label=`OI subindo (${oiChangePct.toFixed(1)}%) junto com o preco — dinheiro novo entrando, tendencia saudavel`;}
    else if(oiFalling){healthy=false; label=`OI caindo (${oiChangePct.toFixed(1)}%) com preco subindo — parece so cobertura de venda fechando, sem forca nova`;}
  }else if(priceDirection==='baixa'){
    if(oiRising){healthy=true; label=`OI subindo (${oiChangePct.toFixed(1)}%) junto com a queda — vendedores novos entrando, tendencia saudavel`;}
    else if(oiFalling){healthy=false; label=`OI caindo (${oiChangePct.toFixed(1)}%) com preco caindo — parece so posicao comprada sendo liquidada, sem forca nova`;}
  }
  return{oiChangePct, healthy, label};
}

// Extremos de posicionamento da massa (>70% de um lado) costumam ser
// contrarios — quando todo mundo ja esta posicionado, falta gente nova
// pra empurrar mais na mesma direcao.
function interpretLongShort(ls){
  if(!ls)return{label:'--',extreme:false};
  const longPct=ls.longAccount*100;
  const extreme = longPct>70 || longPct<30;
  return{
    longPct,
    extreme,
    label: extreme
      ? `${longPct.toFixed(0)}% comprado / ${(100-longPct).toFixed(0)}% vendido — posicionamento extremo, sinal contrario classico`
      : `${longPct.toFixed(0)}% comprado / ${(100-longPct).toFixed(0)}% vendido — equilibrado`,
  };
}

function interpretBookImbalance(book){
  if(!book)return{label:'--'};
  const pct=book.imbalance*100;
  const bias = pct>15?'compra':pct<-15?'venda':'equilibrado';
  return{pct, bias, label:`${pct>=0?'+':''}${pct.toFixed(0)}% ${bias!=='equilibrado'?'a favor de '+bias:'(equilibrado)'}`};
}

// Confirma se o candle mais recente teve volume acima da media — rompimento
// com volume forte tem mais chance de ser real que um rompimento "seco".
function interpretVolumeConfirm(candles){
  if(!candles||candles.length<21)return{label:'--',confirmed:null};
  const vols=candles.slice(-21,-1).map(c=>c.volume);
  const avgVol=vols.reduce((a,b)=>a+b,0)/vols.length;
  const lastVol=candles[candles.length-1].volume;
  const ratio=avgVol>0?lastVol/avgVol:1;
  const confirmed=ratio>1.5;
  return{ratio, confirmed, label:`Volume ${ratio.toFixed(1)}x a media${confirmed?' — rompimento com forca':''}`};
}

async function fetchCandles(sym,tf,limit=500){
  let fetchTf = tf;
  let aggFactor = 1;

  // 6m e 15h nao existem na Binance, como ja nao existiam 5h, 3M, 6M, 9M e
  // 12M: sao montados agregando o timeframe nativo mais proximo.
  if (tf === '6m') { fetchTf = '1m'; aggFactor = 6; }
  else if (tf === '15h') { fetchTf = '1h'; aggFactor = 15; }
  else if (tf === '5h') { fetchTf = '1h'; aggFactor = 5; }
  else if (tf === '3M') { fetchTf = '1M'; aggFactor = 3; }
  else if (tf === '6M') { fetchTf = '1M'; aggFactor = 6; }
  else if (tf === '9M') { fetchTf = '1M'; aggFactor = 9; }
  else if (tf === '12M') { fetchTf = '1M'; aggFactor = 12; }

  const realLimit = Math.min(limit * aggFactor, 1500);

  for(const src of DATA_SOURCES){
    try{
      const url = src.build ? src.build(sym,fetchTf,realLimit) : null;
      if(!url)continue;
      const r=await fetch(url,{signal:AbortSignal.timeout(3500)});
      if(!r.ok)continue;
      const raw=await r.json();
      let parsed=src.parse(raw);
      if(parsed&&parsed.length>0){
        if (aggFactor > 1) {
            parsed = aggregateCandles(parsed, aggFactor);
        }
        lastDataSource=src.name;
        updateDataSourceBadge(src.name, src.name!=='binance');
        return parsed;
      }
    }catch(e){ /* tenta a proxima fonte */ }
  }
  updateDataSourceBadge('nenhuma', true);
  return null;
}

// Indicador visual de qual fonte respondeu por ultimo — so aparece destacado
// quando NAO foi a Binance, pra voce saber quando um fallback entrou em acao.
function updateDataSourceBadge(name, isFallback){
  const el=document.getElementById('data-source-badge');
  if(!el)return;
  el.textContent = isFallback ? `⚠ fonte: ${name}` : '';
  el.style.display = isFallback ? 'inline' : 'none';
}

// Sequencia de carregamento: cada troca de simbolo/tf invalida a anterior.
// Sem isso, uma resposta de rede ATRASADA do simbolo antigo podia chegar
// DEPOIS da troca e sobrescrever o grafico com dados do ativo errado —
// exatamente o que causava a vela gigante fora de escala ao trocar de ativo.
let loadSeq = 0;

async function fetchMTF(){
  const mySym=currentSym, myTf=currentTF, mySeq=loadSeq;
  for(const[tf,bn]of Object.entries(MTF_TFS)){
    const d=await fetchCandles(currentSym,bn,200);
    if(mySeq!==loadSeq||currentSym!==mySym||currentTF!==myTf)return; // ativo trocou no meio do loop
    if(d)mtfData[tf]=d.map(c=>c.close);
  }
}

// Mesma logica do fetchMTF, so que pra M1/M5/M15 — limite bem menor de velas
// (60 basta pro EMA8x16), pra nao pesar a rede com mais 3 timeframes por ativo.
async function fetchMicro(){
  const mySym=currentSym, myTf=currentTF, mySeq=loadSeq;
  for(const[tf,bn]of Object.entries(MICRO_TFS)){
    const d=await fetchCandles(currentSym,bn,60);
    if(mySeq!==loadSeq||currentSym!==mySym||currentTF!==myTf)return;
    if(d)microData[tf]=d.map(c=>c.close);
  }
}

function calcMicro(){
  const dirs={},fresh={};let n=0;
  MICRO_KEYS.forEach(tf=>{
    const d=microData[tf];
    if(!d||d.length<20){dirs[tf]='flat';fresh[tf]=null;return;}
    const e8=ema(d,8),e16=ema(d,16),last=e8.length-1;
    dirs[tf]=e8[last]>e16[last]?'buy':e8[last]<e16[last]?'sell':'flat';
    if(dirs[tf]!=='flat')n++;
    fresh[tf]=freshCrossState(d);
  });
  return{dirs,fresh};
}

function updateMicroPanel(micro){
  const ids={'1':'m1','5':'m5','15':'m15'};
  let buyCt=0,sellCt=0;
  MICRO_KEYS.forEach(tf=>{
    const dir=micro.dirs[tf]||'flat';
    if(dir==='buy')buyCt++;else if(dir==='sell')sellCt++;
    const id=ids[tf];
    const fe=document.getElementById(`micro-${id}-fill`),de=document.getElementById(`micro-${id}-dir`),ce=document.getElementById(`micro-${id}-cross`);
    if(fe){if(dir==='buy'){fe.style.width='100%';fe.style.background='var(--green)';}else if(dir==='sell'){fe.style.width='100%';fe.style.background='var(--red)';}else fe.style.width='0%';}
    if(de){de.textContent=dir==='buy'?'BUY':dir==='sell'?'SELL':'---';de.className=`mtf-dir ${dir}`;}
    if(ce){const fr=micro.fresh?micro.fresh[tf]:null;ce.className=`mtf-cross${fr?' fresh-'+fr:''}`;}
  });
  const sumEl=document.getElementById('micro-summary');
  if(sumEl){
    if(buyCt>=2)sumEl.textContent=`${buyCt}/3 timing compra`;
    else if(sellCt>=2)sumEl.textContent=`${sellCt}/3 timing venda`;
    else sumEl.textContent='sem timing claro';
  }
}

// ══════════════════════════════════════════════════════
// WS LIVE
// ══════════════════════════════════════════════════════
let rtInterval = null;
let serverTimeOffset = 0; // Sincronização de relógio atômico com a Binance
let lastTradeAt = 0;      // ultimo aggTrade recebido (decide se o fallback REST roda)
let lastTitleAt = 0;      // throttle da atualizacao do titulo da aba

// O 'M' de mes vinha antes do 'm' de minuto na conta, e includes() distingue
// maiusculas: '1M'.includes('m') e false, entao o mensal caia no return 60 e
// virava UM MINUTO. Isso nao e cosmetico — esta funcao define o balde da vela
// no tick ao vivo e no fluxo, entao no grafico mensal a vela em formacao era
// agrupada em minutos.
//
// O mes vale 30 dias por convencao: e um agrupamento pra decidir de que vela um
// tick faz parte, nao um calendario.
function tfToSeconds(tf) {
  const v = parseInt(tf) || 1;
  const s = String(tf);
  if(s.includes('M')) return v * 2592000;   // mes ANTES do minuto, e case-sensitive
  if(s.includes('w')) return v * 604800;
  if(s.includes('d') || s.includes('D')) return v * 86400;
  if(s.includes('h') || s.includes('H')) return v * 3600;
  if(s.includes('m')) return v * 60;
  return 60;
}

// ── Coalescencia de ticks ─────────────────────────────
// O BTC dispara dezenas de aggTrades por segundo. Renderizar cada um trava a
// aba. Aqui guardamos apenas o ultimo preco e desenhamos uma vez por frame
// (~60fps), o que da movimento continuo sem sobrecarregar o navegador.
let pendingTick=null, tickScheduled=false, h1StochCache={k:null,d:null}, h1StochAt=0, liveBorderAt=0;

function forceChartTick(price, ts_ms){
  pendingTick={price,ts:ts_ms};
  if(tickScheduled)return;
  tickScheduled=true;
  requestAnimationFrame(()=>{tickScheduled=false;const t=pendingTick;pendingTick=null;if(t)applyTick(t.price,t.ts);});
}

// ══════════════════════════════════════════════════════
// ALARMES DE NIVEL
// ══════════════════════════════════════════════════════
// Toca quando o preco CRUZA o nivel, nao quando chega perto: guardo o preco
// do tick anterior e so disparo se o nivel ficou entre os dois. Sem isso, um
// preco oscilando em cima do nivel dispararia a cada tick.
// Cobre as tres fontes pedidas: as ferramentas de fibo (todos os niveis
// desenhados), as linhas horizontais de preco e as medias.
// Usa o mesmo botao de sino que ja existia (alertsOn) e o mesmo toast + beep
// dos sinais, pra nao criar um segundo sistema de aviso.
let ultimasEmas=null;
let alarmePrecoAnterior=null;
const alarmeUltimoDisparo={};
const ALARME_ESPERA_MS=60000;  // o mesmo nivel nao repete dentro de um minuto

const ALARME_NOMES={ema8:"EMA8",ema16:"EMA16",ema55:"EMA55",ema98:"EMA98",
                    ema200:"EMA200",ma56:"MA56",ma89:"MA89"};

// NIVEIS DE FIBO ESCOLHIDOS. Marque os que interessam clicando na lista do
// FIB MANUAL — um sino aparece no nivel ligado. Sem nenhum marcado, o fibo
// nao dispara nada.
//
// Cada marca guarda o PRECO que o nivel valia na hora, junto da ancora do
// fibo em que foi feita. Quando o fibo muda de lugar, essas marcas viram
// alarme de preco fixo naquele valor e saem da lista do fibo: quem marcou o
// 0.618 em 63941 quer 63941 vigiado, e nao um numero que anda junto toda vez
// que o fibo e redesenhado.
let fibNiveisMarcados=[];   // [{lv, preco}]
let fibAncora=null;         // "p0_p1" do fibo em que as marcas foram feitas

function chaveFibNiveis(){ return "fibniveis:"+(typeof currentSym!=="undefined"?currentSym:"?"); }
function ancoraDoFibo(d){
  return (d&&d.p0&&d.p1) ? d.p0.price.toFixed(6)+"_"+d.p1.price.toFixed(6) : null;
}
function fiboAtual(){
  try{ return [...drawings()].reverse().find(d=>d.type==="fibbo"); }catch(e){ return null; }
}
function carregaFibNiveis(){
  fibAncora=null;
  try{
    const cru=JSON.parse(localStorage.getItem(chaveFibNiveis())||"[]")||[];
    // formato antigo era uma lista de numeros; converte sem perder as marcas
    fibNiveisMarcados=cru.map(x=>typeof x==="number"?{lv:x,preco:null}:x).filter(x=>x&&x.lv!=null);
  }catch(e){ fibNiveisMarcados=[]; }
}
function salvaFibNiveis(){
  try{ localStorage.setItem(chaveFibNiveis(),JSON.stringify(fibNiveisMarcados)); }catch(e){}
}
function fibMarcado(lv){ return fibNiveisMarcados.some(x=>x.lv===lv); }

function toggleFibNivel(lv){
  const v=parseFloat(lv);
  const d=fiboAtual();
  if(fibMarcado(v)){
    fibNiveisMarcados=fibNiveisMarcados.filter(x=>x.lv!==v);
  }else{
    let preco=null;
    if(d&&d.p0&&d.p1) preco=d.p1.price+(d.p0.price-d.p1.price)*v;
    fibNiveisMarcados.push({lv:v,preco:isFinite(preco)?preco:null});
    fibAncora=ancoraDoFibo(d);
  }
  salvaFibNiveis();
  if(typeof renderFibLegend==="function"){ try{ renderFibLegend(d); }catch(e){} }
  if(typeof showInfoToast==="function"){
    showInfoToast("FIB", fibMarcado(v) ? "alarme ligado no nivel "+v : "alarme desligado no nivel "+v);
  }
}
window.toggleFibNivel=toggleFibNivel;

// Chamado a cada redesenho do fibo. Se ele mudou de lugar, o que estava
// marcado passa a ser alarme de preco — o valor congela onde estava.
function fibConfereAncora(d){
  const ancora=ancoraDoFibo(d);
  if(!ancora) return;
  if(fibAncora===null){ fibAncora=ancora; return; }   // primeira vez que vemos este fibo
  if(ancora===fibAncora) return;                       // nao mexeu
  fibAncora=ancora;
  if(!fibNiveisMarcados.length) return;

  const congelados=fibNiveisMarcados.filter(x=>x.preco!=null&&isFinite(x.preco));
  let novos=0;
  congelados.forEach(x=>{
    const preco=+x.preco.toFixed(8);
    if(alarmesManuais.some(a=>a.preco===preco)) return;
    alarmesManuais.push({preco,criado:Date.now(),origem:"fib "+x.lv});
    novos++;
  });
  fibNiveisMarcados=[];
  salvaFibNiveis();
  if(novos){
    alarmesManuais.sort((a,b)=>b.preco-a.preco);
    salvaAlarmesManuais();
    if(typeof showInfoToast==="function"){
      showInfoToast("FIB",novos===1
        ? "o fibo mudou: 1 nivel marcado virou alarme de preco"
        : "o fibo mudou: "+novos+" niveis marcados viraram alarme de preco");
    }
  }else{
    renderAlarmes();
  }
}

// O QUE PODE TOCAR. Nada de media dispara sozinho: o usuario monta o alarme
// que quer, escolhendo entre "o preco cruzou a media X" e "a media X cruzou a
// media Y". Antes as 7 medias e os 6 pares vigiavam o tempo todo, o que dava
// aviso demais sem ninguem ter pedido.
// Fibo e preco ficam com liga/desliga simples — o fibo so vigia os niveis que
// voce marcou na lista, entao ja e uma escolha sua.
let fontesAlarme={fibo:true,preco:true};
let alarmesMedias=[];   // [{tipo:"preco",a:"ema8"} , {tipo:"cruze",a:"ema8",b:"ema16"}]

const ALARME_MEDIAS_OPCOES=["ema8","ema16","ema55","ema98","ema200","ma56","ma89"];

function carregaFontesAlarme(){
  try{ Object.assign(fontesAlarme,JSON.parse(localStorage.getItem("alarme-fontes")||"{}")); }catch(e){}
  ["fibo","preco"].forEach(k=>{
    const el=document.getElementById("alf-"+k);
    if(el) el.checked=!!fontesAlarme[k];
  });
  // a configuracao de media e regra, nao preco: vale pra qualquer ativo
  try{ alarmesMedias=JSON.parse(localStorage.getItem("alarme-medias")||"[]")||[]; }catch(e){ alarmesMedias=[]; }
  montaSelectsMedia();
  renderAlarmesMedia();
}
function setFonteAlarme(k,v){
  fontesAlarme[k]=!!v;
  try{ localStorage.setItem("alarme-fontes",JSON.stringify(fontesAlarme)); }catch(e){}
}

function montaSelectsMedia(){
  const op=ALARME_MEDIAS_OPCOES.map(k=>'<option value="'+k+'">'+(ALARME_NOMES[k]||k)+"</option>").join("");
  const a=document.getElementById("alm-a"), b=document.getElementById("alm-b");
  if(a&&!a.children.length) a.innerHTML=op;
  if(b&&!b.children.length){ b.innerHTML=op; b.value="ema16"; }
  atualizaFormMedia();
}
// "media cruza" precisa da segunda media; "preco cruza" nao.
function atualizaFormMedia(){
  const t=document.getElementById("alm-tipo");
  const x=document.getElementById("alm-x"), b=document.getElementById("alm-b");
  const cruze=t&&t.value==="cruze";
  if(x) x.style.display=cruze?"":"none";
  if(b) b.style.display=cruze?"":"none";
}
window.atualizaFormMedia=atualizaFormMedia;

function addAlarmeMedia(){
  const tipo=(document.getElementById("alm-tipo")||{}).value||"preco";
  const a=(document.getElementById("alm-a")||{}).value;
  const b=(document.getElementById("alm-b")||{}).value;
  if(!a) return;
  if(tipo==="cruze"&&(!b||a===b)){
    if(typeof showInfoToast==="function") showInfoToast("ALARMES","escolha duas medias diferentes");
    return;
  }
  const novo = tipo==="cruze" ? {tipo:"cruze",a,b} : {tipo:"preco",a};
  const igual = alarmesMedias.some(x=>x.tipo===novo.tipo&&x.a===novo.a&&(x.b||"")===(novo.b||""));
  // o cruzamento e simetrico: 8x16 e o mesmo alarme que 16x8
  const espelho = tipo==="cruze"&&alarmesMedias.some(x=>x.tipo==="cruze"&&x.a===b&&x.b===a);
  if(igual||espelho){
    if(typeof showInfoToast==="function") showInfoToast("ALARMES","esse alarme ja existe");
    return;
  }
  alarmesMedias.push(novo);
  salvaAlarmesMedias();
}
function removeAlarmeMedia(i){ alarmesMedias.splice(i,1); salvaAlarmesMedias(); }
function salvaAlarmesMedias(){
  try{ localStorage.setItem("alarme-medias",JSON.stringify(alarmesMedias)); }catch(e){}
  renderAlarmesMedia();
}
function renderAlarmesMedia(){
  const list=document.getElementById("alm-list");
  if(!list) return;
  if(!alarmesMedias.length){
    list.innerHTML='<div style="padding:4px 9px;font-size:9px;color:var(--t3);">Nenhum alarme de media.</div>';
    return;
  }
  list.innerHTML=alarmesMedias.map((m,i)=>{
    const txt = m.tipo==="cruze"
      ? (ALARME_NOMES[m.a]||m.a)+" x "+(ALARME_NOMES[m.b]||m.b)
      : "preco x "+(ALARME_NOMES[m.a]||m.a);
    return '<div class="sig-item"><span class="sig-side" style="color:var(--t2);font-weight:400;">'
      +txt+'</span><button class="toast-x" onclick="removeAlarmeMedia('+i+')" style="margin-left:auto;">x</button></div>';
  }).join("");
}
window.addAlarmeMedia=addAlarmeMedia;
window.removeAlarmeMedia=removeAlarmeMedia;
window.setFonteAlarme=setFonteAlarme;
window.carregaFontesAlarme=carregaFontesAlarme;

// ALARMES MANUAIS — um preco qualquer que o usuario digita, sem depender de
// ter desenhado nada. Ficam no localStorage por simbolo: um alarme de 60000
// no BTC nao faz sentido no ouro.
function chaveAlarmes(){ return "alarmes:"+(typeof currentSym!=="undefined"?currentSym:"?"); }
let alarmesManuais=[];

function carregaAlarmesManuais(){
  try{ alarmesManuais=JSON.parse(localStorage.getItem(chaveAlarmes())||"[]")||[]; }
  catch(e){ alarmesManuais=[]; }
  renderAlarmes();
}
function salvaAlarmesManuais(){
  try{ localStorage.setItem(chaveAlarmes(),JSON.stringify(alarmesManuais)); }catch(e){}
  renderAlarmes();
}
function addAlarmeManual(){
  const inp=document.getElementById("alarme-preco");
  const v=parseFloat(inp&&inp.value);
  if(!isFinite(v)){ if(typeof showInfoToast==="function") showInfoToast("ALARMES","digite um preco"); return; }
  if(alarmesManuais.some(a=>a.preco===v)){ if(typeof showInfoToast==="function") showInfoToast("ALARMES","ja existe alarme em "+v); return; }
  alarmesManuais.push({preco:v,criado:Date.now()});
  alarmesManuais.sort((a,b)=>b.preco-a.preco);
  if(inp) inp.value="";
  salvaAlarmesManuais();
}
function removeAlarmeManual(preco){
  alarmesManuais=alarmesManuais.filter(a=>a.preco!==preco);
  salvaAlarmesManuais();
}
function renderAlarmes(){
  const cnt=document.getElementById("alarme-count"), list=document.getElementById("alarme-list");
  if(cnt) cnt.textContent=alarmesManuais.length;
  if(!list) return;
  if(!alarmesManuais.length){
    list.innerHTML='<div style="padding:5px 9px;font-size:9px;color:var(--t3);">Nenhum alarme manual.</div>';
    return;
  }
  const px=(typeof candles!=="undefined"&&candles.length)?candles[candles.length-1].close:null;
  list.innerHTML=alarmesManuais.map(a=>{
    const acima=px!=null&&a.preco>px;
    const cor=px==null?"var(--t2)":(acima?"#00C853":"#FF3B30");
    const dist=px==null?"":" ("+(acima?"+":"")+((a.preco-px)/px*100).toFixed(2)+"%)";
    const orig=a.origem?' <span style="color:var(--t3);font-size:8px;">'+a.origem+"</span>":"";
    return '<div class="sig-item"><span class="sig-time">'+(acima?"\u25b2":"\u25bc")+'</span>'
      +'<span class="sig-px" style="color:'+cor+'">'+a.preco+'</span>'+orig
      +'<span class="sig-side" style="color:var(--t3);font-weight:400;">'+dist+'</span>'
      +'<button class="toast-x" onclick="removeAlarmeManual('+a.preco+')" '
      +'style="margin-left:auto;">x</button></div>';
  }).join("");
}
window.addAlarmeManual=addAlarmeManual;
window.removeAlarmeManual=removeAlarmeManual;
window.renderAlarmes=renderAlarmes;
window.carregaAlarmesManuais=carregaAlarmesManuais;

// Todos os niveis que valem alarme agora, ja com o preco de cada um.
function niveisDeAlarme(){
  const out=[];
  let lista=[];
  try{ lista=drawings()||[]; }catch(e){ lista=[]; }
  lista.forEach((d,i)=>{
    if(fontesAlarme.preco&&d.type==="horizontal"&&d.p0&&isFinite(d.p0.price)){
      out.push({chave:"preco:"+i,rotulo:"PRECO",nome:d.p0.price.toFixed(2),preco:d.p0.price});
    }
    if(fontesAlarme.fibo&&(d.type==="fibbo"||d.type==="fibretr")&&d.p0&&d.p1){
      const diff=d.p0.price-d.p1.price;
      const lvs=d.type==="fibretr"?fibRetrLevels:[...fibLevels,...fibBreakLevels];
      lvs.forEach(lv=>{
        // so os niveis que voce marcou na lista do FIB MANUAL. Antes, sem
        // marcacao, os 29 eram vigiados — o que enchia de aviso sem pedido.
        if(!fibMarcado(lv)) return;
        const pr=d.p1.price+diff*lv;
        if(isFinite(pr)) out.push({chave:"fib:"+i+":"+lv,rotulo:"FIB",nome:String(lv),preco:pr});
      });
    }
  });
  if(fontesAlarme.preco) alarmesManuais.forEach(a=>{
    if(isFinite(a.preco)) out.push({chave:"manual:"+a.preco,rotulo:"ALARME",nome:String(a.preco),preco:a.preco});
  });
  // so as medias que voce montou como "preco cruza"
  if(ultimasEmas) alarmesMedias.filter(m=>m.tipo==="preco").forEach(m=>{
    const v=ultimasEmas[m.a];
    if(v!=null&&isFinite(v)) out.push({chave:"media:"+m.a,rotulo:"MEDIA",nome:ALARME_NOMES[m.a]||m.a,preco:v});
  });
  return out;
}

// CRUZAMENTO ENTRE MEDIAS. Isto e outro evento: nao e o preco cruzando um
// nivel, e uma media passando pela outra. Detecto pelo SINAL DA DIFERENCA:
// enquanto (a - b) mantem o sinal nao houve cruzamento; quando ele vira,
// cruzou. Comparo o penultimo com o ultimo valor da serie, entao o alarme
// toca uma vez por cruzamento e nao a cada tick com as medias coladas.
// Os pares vigiados saem do que o usuario montou (alarmesMedias), nao de uma
// lista fixa: antes seis pares tocavam sem ninguem ter pedido.
const cruzamentoAnterior={};

function verificaCruzamentoMedias(){
  if(!alertsOn||!serieMedias) return;
  // so os pares que voce montou como "media cruza"
  alarmesMedias.filter(m=>m.tipo==="cruze").forEach(({a,b})=>{
    const sa=serieMedias[a], sb=serieMedias[b];
    if(!sa||!sb||sa.length<2) return;
    const n=sa.length-1;
    const agoraDif=sa[n]-sb[n], antesDif=sa[n-1]-sb[n-1];
    if([agoraDif,antesDif].some(v=>v==null||!isFinite(v))||agoraDif===0) return;
    if(Math.sign(agoraDif)===Math.sign(antesDif)) return;  // nao cruzou
    const chave=a+"x"+b;
    // a mesma vela nao dispara duas vezes quando o motor reprocessa
    const marca=(typeof candles!=="undefined"&&candles.length)?candles[candles.length-1].time:n;
    if(cruzamentoAnterior[chave]===marca) return;
    cruzamentoAnterior[chave]=marca;
    const subiu=agoraDif>0;
    const nome=(ALARME_NOMES[a]||a)+(subiu?" \u2191 ":" \u2193 ")+(ALARME_NOMES[b]||b);
    const preco=(typeof candles!=="undefined"&&candles.length)?candles[candles.length-1].close:sa[n];
    showToast("CRUZE",(subiu?"\u25b2 ":"\u25bc ")+nome,preco);
  });
}
window.verificaCruzamentoMedias=verificaCruzamentoMedias;

// Zera a referencia de preco. OBRIGATORIO ao trocar de ativo ou de
// timeframe: sem isto o proximo tick compara o preco do BTC (109000) com o
// do ETH (3400) e dispara TODOS os niveis entre os dois de uma vez. As series
// de media tambem saem, senao o alarme compara o preco novo com as medias do
// ativo anterior ate o motor recalcular.
function resetaAlarmes(){
  alarmePrecoAnterior=null;
  ultimasEmas=null;
  serieMedias=null;
  for(const k in cruzamentoAnterior) delete cruzamentoAnterior[k];
}
window.resetaAlarmes=resetaAlarmes;

function mostraAlarmes(lista,subindo,preco,selo){
  if(!lista.length) return;
  const seta=subindo?"\u25b2":"\u25bc";
  if(lista.length===1){
    showToast(lista[0].rotulo,seta+" "+lista[0].nome+selo,preco);
    return;
  }
  const cx=document.getElementById("toasts");
  if(!cx){ showToast("ALARMES",seta+" "+lista.length+" niveis"+selo,preco); return; }
  const t=document.createElement("div");
  t.className="toast "+(subindo?"buy":"sell");
  // um gap pode cruzar dezenas de niveis; listo os mais proximos do preco novo
  // e resumo o resto, senao o aviso vira uma parede de texto
  const TETO_LINHAS=6;
  const mostra=lista.slice(0,TETO_LINHAS), resto=lista.length-TETO_LINHAS;
  const linhas=mostra.map(nv=>
    '<div style="display:flex;justify-content:space-between;gap:8px;">'
    +'<span style="color:var(--t2);">'+nv.rotulo+" "+nv.nome+"</span>"
    +'<span style="font-family:var(--mono);">'+nv.preco.toFixed(2)+"</span></div>").join("")
    +(resto>0?'<div style="color:var(--t3);">+ '+resto+" outros</div>":"");
  t.innerHTML='<div class="toast-hd"><span class="toast-title">'+seta+" "+lista.length
    +" niveis"+selo+'</span>'
    +'<button class="toast-x" onclick="this.closest(\'.toast\').remove()">x</button></div>'
    +'<div class="toast-msg">'+(typeof currentSym!=="undefined"?currentSym.replace("USDT",""):"")
    +" "+(typeof currentTF!=="undefined"?currentTF:"")+'</div>'
    +'<div class="toast-msg" style="margin-top:4px;line-height:1.5;">'+linhas+"</div>"
    +'<div class="toast-px">@ '+preco.toFixed(2)+"</div>";
  cx.appendChild(t);
  setTimeout(()=>{try{t.remove();}catch(e){}},9000);
  if(typeof beep==="function") beep();   // um beep so, nao um por nivel
}

function verificaAlarmes(preco){
  const ant=alarmePrecoAnterior;
  alarmePrecoAnterior=preco;
  // sino desligado: sigo guardando o preco, senao o primeiro tick depois de
  // ligar compararia contra um valor velho e dispararia tudo de uma vez
  if(!alertsOn||ant==null||ant===preco||!isFinite(preco)) return;
  const baixo=Math.min(ant,preco), alto=Math.max(ant,preco), subindo=preco>ant;
  const agora=Date.now();
  // Num tick normal o preco cruza um nivel, no maximo. Um gap de abertura ou
  // uma recarga do historico pode pular dezenas — todos entram num aviso so,
  // que e quem limita quantos aparecem.
  const cruzados=niveisDeAlarme().filter(nv=>{
    if(!(nv.preco>baixo&&nv.preco<=alto)) return false;
    const ultimo=alarmeUltimoDisparo[nv.chave];
    return !(ultimo&&agora-ultimo<ALARME_ESPERA_MS);
  });
  // do mais proximo do preco novo pro mais distante: o ultimo cruzado importa mais
  cruzados.sort((x,y)=>Math.abs(x.preco-preco)-Math.abs(y.preco-preco));
  cruzados.forEach(nv=>{ alarmeUltimoDisparo[nv.chave]=agora; });
  // Cruza o alarme com o empilhamento das medias: o mesmo criterio do sinal
  // liberado (EMA8 e EMA16 das duas acima da MA89 e da EMA200, ou das duas
  // abaixo). Nao escondo o cruzamento quando nao ha liberacao — marco, pra dar
  // pra ver de relance se o nivel foi rompido com as medias a favor ou contra.
  const est=(typeof estadoLiberacao==="function")?estadoLiberacao(null):null;
  const aFavor = est && ((subindo&&est==="alta")||(!subindo&&est==="baixa"));
  const selo = aFavor ? " \u2713" : (est?" !":"");
  // Um aviso por nivel enchia a tela de caixas empilhadas. Quando varios
  // cruzam no mesmo movimento, sai UM aviso listando todos — um beep so, uma
  // caixa so. Com um nivel unico, que e o caso comum, nada muda.
  mostraAlarmes(cruzados,subindo,preco,selo);
}
window.verificaAlarmes=verificaAlarmes;

function applyTick(price, ts_ms){
  verificaAlarmes(price);
  // o Multi-TF mostra o mesmo ativo em outros tempos: anda com o mesmo tick
  if(typeof mtfAplicaTick==="function") mtfAplicaTick(price,ts_ms);
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
  if(expected>last.time+tfSec){
    loadAll();
    return;
  }

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
    if(w56.length>=55)up(maS.ma56,(w56.reduce((a,b)=>a+b,0)+px)/(w56.length+1));
    if(w89.length>=88)up(maS.ma89,(w89.reduce((a,b)=>a+b,0)+px)/(w89.length+1));

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

    // Borda da vela (ribbon Phi) — atualiza a cada ~2s, nao a cada trade
    // (19 EMAs x ate 1000 velas e barato, mas nao precisa recalcular a cada
    // execucao — BTC pode disparar dezenas por segundo).
    if(Date.now()-liveBorderAt>2000){ updateLiveCandleBorder(); liveBorderAt=Date.now(); }
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

// Duas casas servem pro BTC, nao pra prata: XAG anda perto de 30 dolares e se
// move de milesimo, entao com 2 casas o preco parecia congelado entre os ticks.
function casasDoPreco(p){
  const a=Math.abs(p);
  if(a >= 1000) return 2;
  if(a >= 100)  return 2;
  if(a >= 1)    return 3;
  if(a >= 0.01) return 5;
  return 7;
}

function updatePriceUI(p){
  const casas=casasDoPreco(p);
  const rt=document.getElementById('rt-price');
  if(rt)rt.textContent=`$${p.toFixed(casas)}`;
  const big=document.getElementById('big-price'),bigSym=document.getElementById('big-sym');
  if(big){
    const oldP=parseFloat(big.dataset.p||p);
    big.textContent=`$${p.toFixed(casas)}`;
    big.dataset.p=p;
    big.style.color=p>=oldP?'var(--green)':'var(--red)';
  }
  if(bigSym)bigSym.textContent=currentSym.replace('USDT','');
  // updatePriceUI ja so roda 1x por frame (coalescido no forceChartTick/applyTick),
  // entao o titulo pode atualizar sempre — o throttle extra de 500ms so criava
  // uma defasagem visivel entre o titulo da aba e o preco na tela.
  document.title=`${p.toFixed(2)} | ${currentSym.replace('USDT','')}`;
}

// A Binance de futuros nao serve ouro nem prata. O historico ja caia nas fontes
// alternativas (Bybit, OKX, Kraken), mas o tempo real nao caia em lugar nenhum:
// o openWS pedia btcusdt-style pra fstream.binance.com, a conexao morria, e o
// grafico de XAU/XAG ficava parado no ultimo candle do historico — sem tick,
// sem alarme, sem vela em formacao.
//
// A cotacao ja existia no app: o painel Ouro mantem um WebSocket da SimpleFX
// com 377 ativos, XAUUSD e XAGUSD entre eles. Aqui so aponto o grafico
// principal pra ele quando o ativo for um desses.
const SEM_STREAM_BINANCE = {XAUUSDT:'XAUUSD', XAGUSDT:'XAGUSD'};
let fxAtivo = null;   // simbolo SimpleFX que esta alimentando o grafico principal

function ligaTempoRealSimpleFX(symFx){
  fxAtivo = symFx;
  const dot=document.getElementById('ws-dot'), st=document.getElementById('ws-st');
  const vivo = goldWs && (goldWs.readyState===0 || goldWs.readyState===1);
  if(dot) dot.className = vivo ? 'dot grn blink' : 'dot ylw blink';
  if(st)  st.textContent = vivo ? 'LIVE (SimpleFX)' : 'Conectando...';
  // O goldConnectWS basta: o goldAssetsMap ja nasce montado no carregamento do
  // arquivo, entao nao preciso do goldInitOnce inteiro (tabela, globo, RSI) so
  // pra receber cotacao.
  if(!vivo){ try{ goldConnectWS(); }catch(e){} }
}

function openWS(){
  if(wsKline){
    wsKline.onclose=null; // Previne loop infinito de reconexao
    try{wsKline.close();}catch{}
  }
  if(rtInterval)clearInterval(rtInterval);

  const fx = SEM_STREAM_BINANCE[currentSym];
  if(fx){
    // zera a referencia: o socket acima ja foi fechado, mas deixar o objeto
    // antigo em wsKline faz qualquer checagem de "estou conectado?" responder
    // sim olhando pra uma conexao morta da Binance
    wsKline = null;
    ligaTempoRealSimpleFX(fx);
    return;
  }
  fxAtivo = null;   // voltou pra um ativo que a Binance serve

  const symL=currentSym.toLowerCase();
  const wantedSym=currentSym; // guarda o simbolo desta conexao
  // Multiplex: velas (kline) + todas as execucoes em tempo real (aggTrade)
  let wsTf = currentTF;
  if (['5h', '3M', '6M', '9M', '12M'].includes(currentTF)) {
      wsTf = '1m'; // Fallback for websocket so Binance doesn't drop connection
  }
  wsKline=new WebSocket(`wss://fstream.binance.com/stream?streams=${symL}@kline_${wsTf}/${symL}@aggTrade`);

  wsKline.onopen=()=>{
    document.getElementById('ws-dot').className='dot grn blink';
    document.getElementById('ws-st').textContent='LIVE';
  };

  wsKline.onmessage=ev=>{
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
        // quantidade e lado vinham e eram descartados; sao eles que dao as
        // bolhas e o medidor de forca
        try{
          const q=parseFloat(d.q);
          if(isFinite(q)&&q>0){
            const ts=d.T||Date.now();
            const tfSec=tfToSeconds(currentTF);
            const nowSec=Math.floor(ts/1000);
            registraNegocio(p,q,!d.m,ts,nowSec-(nowSec%tfSec));
          }
        }catch(e){}
        updatePriceUI(p);
        forceChartTick(p,d.T||Date.now()); // coalescido por frame
        return;
      }

      // 2) KLINE: estrutura oficial da vela (OHLC + volume)
      if(!stream.includes('@kline'))return;
      const k=d.k;if(!k)return;
      const c={time:Math.floor(k.t/1000),open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v};
      // mesmo corte do historico, agora ao vivo: k.q e o volume em dolar da
      // vela e k.Q a parte de quem comprou a mercado. Vem acumulado da vela
      // inteira, entao substitui em vez de somar.
      if(k.q!=null&&k.Q!=null){
        c.compra=+k.Q||0; c.venda=Math.max(0,(+k.q||0)-(+k.Q||0));
        if(c.compra>0||c.venda>0){
          fluxoPorVela[c.time]={compra:c.compra, venda:c.venda, oficial:true};
          fluxoVersao++;
        }
      }
      const last=candles[candles.length-1];
      if(last&&c.time<last.time)return; // fora de ordem

      if(last&&last.time===c.time){
        c.high=Math.max(c.high,last.high);
        c.low=Math.min(c.low,last.low);
        c.close=last.close; // mantem o close do aggTrade, evita pulo pra tras
        if(c.compra==null&&last.compra!=null){c.compra=last.compra;c.venda=last.venda;}
        candles[candles.length-1]=c;
      }else if(!last||c.time>last.time){
        if(last)commitLiveState(last.close); // vela anterior fechou de fato
        candles.push(c);
        if(candles.length>1000)candles.shift();
      }

      try{candleSeries.update({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close});}catch(e){}
      try{volS.update({time:c.time,value:c.volume,color:c.close>=c.open?'rgba(0,230,118,.15)':'rgba(244,67,54,.15)'});}catch(e){}

      updateLiveIndicators(c.time,c.close);

      // Trabalho pesado (ATR, sinais, ribbon completo) apenas no FECHAMENTO da vela
      if(k.x){
        const closes=candles.map(x=>x.close),highs=candles.map(x=>x.high),
              lows=candles.map(x=>x.low),opens=candles.map(x=>x.open);
        const atrV=atrCalc(highs,lows,closes,P.atrLen);
        if(atrV[atrV.length-1]!=null)updateRiskPanel(c.close,atrV[atrV.length-1]);
        if(candles.length>250)runSignals(closes,highs,lows,opens);
        // Ribbon Phi + bordas de TODAS as velas — refeito a cada fechamento,
        // pra nunca ficar mais desatualizado que uma vela de atraso.
        try{ refreshPhiRibbonAndBorders(); }catch(e){}
        // divergencia preco x fluxo: no fechamento, que e quando as duas
        // pontas (angulo das medias e pressao das 20 velas) estao fechadas
        try{ verificaDivergenciaFluxo(); }catch(e){}
      }
    }catch(err){}
  };

  wsKline.onclose=()=>{
    document.getElementById('ws-dot').className='dot red blink';
    document.getElementById('ws-st').textContent='Reconectando...';
    setTimeout(openWS,3000);
  };

  wsKline.onerror=()=>{
    // O navegador normalmente dispara onclose logo depois do onerror, mas
    // deixa explicito aqui tambem — sem isso, um erro que nao fecha o socket
    // deixaria o indicador travado em "LIVE" mesmo sem dado chegando.
    document.getElementById('ws-dot').className='dot red blink';
    document.getElementById('ws-st').textContent='Erro de conexao';
  };

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

// ══════════════════════════════════════════════════════
// TOAST / CONTROLS
// ══════════════════════════════════════════════════════
function showToast(type,side,price){
  const a=document.getElementById('toasts'),t=document.createElement('div');
  // os alarmes de nivel usam a seta pra dizer o lado do cruzamento
  const isBuy=side.includes('BUY')||side.includes('BULL')||side.includes('HIT')||side.includes('\u25b2');
  t.className=`toast ${type==='FIB'?'fib':isBuy?'buy':'sell'}`;
  t.innerHTML=`<div class="toast-hd"><span class="toast-title">${type} ${side}</span><button class="toast-x" onclick="this.closest('.toast').remove()">x</button></div><div class="toast-msg">${currentSym.replace('USDT','')} ${currentTF}</div><div class="toast-px">@ ${price.toFixed(2)}</div>`;
  a.appendChild(t);setTimeout(()=>{try{t.remove();}catch{}},8000);beep();
}
function beep(){try{const ctx=new(window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=460;g.gain.value=.09;o.start();o.stop(ctx.currentTime+.2);setTimeout(()=>ctx.close(),300);}catch{}}
function toggleAlerts(){alertsOn=!alertsOn;const b=document.getElementById('btn-alerts');b.textContent=alertsOn?'🔔 ON':'🔔 OFF';b.classList.toggle('on',alertsOn);document.getElementById('nav-alerts').classList.toggle('active',alertsOn);}

// Aviso generico (nao e um sinal de trade, so uma notificacao curta na UI)
function showInfoToast(title,msg){
  // Aceita as duas formas em uso: showInfoToast(titulo,mensagem) e
  // showInfoToast(mensagem). A segunda vinha de uma definicao duplicada
  // deste mesmo nome, que quebrava o arquivo inteiro por redeclaracao.
  if(msg===undefined){msg=title;title='ATLAS';}
  const a=document.getElementById('toasts');
  if(!a)return;
  const t=document.createElement('div');
  t.className='toast';
  t.innerHTML=`<div class="toast-hd"><span class="toast-title">${title}</span><button class="toast-x" onclick="this.closest('.toast').remove()">x</button></div><div class="toast-msg">${msg}</div>`;
  a.appendChild(t);
  setTimeout(()=>{try{t.remove();}catch{}},5000);
}

// ══════════════════════════════════════════════════════
// TEMA CLARO / ESCURO
// O CSS resolve a interface sozinho (variaveis em body.dark), mas os graficos
// sao canvas e nao leem CSS — precisam ser re-tematizados na mao aqui.
// ══════════════════════════════════════════════════════
let darkMode=false;

const THEME={
  light:{bg:'#ffffff',bg2:'#fbfbfc',text:'#6e7683',grid:'#f0f1f3',border:'#e3e6ea',
         crosshair:'#1a1d23',vol:'rgba(20,24,32,.06)',fibLabelBg:'#ffffff'},
  dark: {bg:'#0d1117',bg2:'#131922',text:'#8b98a9',grid:'#1a222d',border:'#28323f',
         crosshair:'#e6edf3',vol:'rgba(230,237,243,.07)',fibLabelBg:'#0d1117'},
};
function theme(){return darkMode?THEME.dark:THEME.light;}

function applyChartTheme(){
  const t=theme();
  const opts={
    layout:{background:{color:'transparent'},textColor:t.text},
    grid:{vertLines:{color:t.grid},horzLines:{color:t.grid}},
    rightPriceScale:{borderColor:t.border},
    timeScale:{borderColor:t.border},
    crosshair:{vertLine:{labelBackgroundColor:t.crosshair},horzLine:{labelBackgroundColor:t.crosshair}},
  };
  try{if(chart)chart.applyOptions(opts);}catch(e){}
  // o fundo saiu do grafico (agora transparente, pra bolha de tras aparecer),
  // entao quem tem que trocar de cor com o tema e o container
  try{
    const w=document.querySelector('.chart-wrap');
    if(w) w.style.background=t.bg;
  }catch(e){}
  try{if(volS)volS.applyOptions({color:t.vol});}catch(e){}
  try{if(phiChart)phiChart.applyOptions({
    layout:{background:{color:t.bg2},textColor:t.text},
    grid:{vertLines:{color:t.grid},horzLines:{color:t.grid}},
    rightPriceScale:{borderColor:t.border},timeScale:{borderColor:t.border},
  });}catch(e){}
  try{if(stochChart)stochChart.applyOptions({
    layout:{background:{color:t.bg2},textColor:t.text},
    grid:{vertLines:{color:t.grid},horzLines:{color:t.grid}},
    rightPriceScale:{borderColor:t.border},timeScale:{borderColor:t.border},
  });}catch(e){}
  try{if(phiChart)phiChart.applyOptions({
    layout:{background:{color:t.bg2},textColor:t.text},
    grid:{vertLines:{color:t.grid},horzLines:{color:t.grid}},
    rightPriceScale:{borderColor:t.border},timeScale:{borderColor:t.border},
  });}catch(e){}
  // mini-graficos do Multi
  for(const sym in multiCharts){
    try{multiCharts[sym].chart.applyOptions(opts);}catch(e){}
  }
  try{if(rainbowChart)rainbowChart.applyOptions(opts);}catch(e){}
  try{redrawDrawings();}catch(e){}
}

// ══════════════════════════════════════════════════════
// PAINEIS REDIMENSIONAVEIS + TROCA DE POSICAO (StochRSI <-> Ribbon Phi)
// ══════════════════════════════════════════════════════
function setupResizeHandle(handleId,panelId,minH,maxH){
  const handle=document.getElementById(handleId);
  const panel=document.getElementById(panelId);
  if(!handle||!panel)return;
  let startY=0,startH=0,dragging=false;
  handle.addEventListener('mousedown',(e)=>{
    dragging=true;startY=e.clientY;startH=panel.getBoundingClientRect().height;
    handle.classList.add('dragging');document.body.style.userSelect='none';
    e.preventDefault();
  });
  window.addEventListener('mousemove',(e)=>{
    if(!dragging)return;
    const dy=e.clientY-startY;
    const newH=Math.max(minH,Math.min(maxH,startH-dy));
    panel.style.height=newH+'px';
  });
  window.addEventListener('mouseup',()=>{
    if(!dragging)return;
    dragging=false;handle.classList.remove('dragging');document.body.style.userSelect='';
    try{
      localStorage.setItem('atlas_panel_'+panelId,panel.style.height);
    }catch(e){}
  });
}

function restorePanelSizes(){
  ['stoch-wrap-el','phi-wrap-el'].forEach(id=>{
    try{
      const saved=localStorage.getItem('atlas_panel_'+id);
      if(saved){
        const el=document.getElementById(id);
        if(el)el.style.height=saved;
      }
    }catch(e){}
  });
}

let panelsSwapped=false;
function swapStochPhiPanels(){
  panelsSwapped=!panelsSwapped;
  const stochWrap=document.getElementById('stoch-wrap-el');
  const phiWrap=document.getElementById('phi-wrap-el');
  const handle2=document.getElementById('resize-stoch-phi');
  const handle1=document.getElementById('resize-chart-stoch');
  const first=panelsSwapped?phiWrap:stochWrap;
  const second=panelsSwapped?stochWrap:phiWrap;
  handle1.insertAdjacentElement('afterend',first);
  first.insertAdjacentElement('afterend',handle2);
  handle2.insertAdjacentElement('afterend',second);
  // Depois de mover no DOM, os charts precisam recalcular a largura —
  // o alto ja e cuidado pelo ResizeObserver de cada um, mas a largura as
  // vezes nao dispara sozinha na hora certa.
  setTimeout(()=>{
    try{const el=document.getElementById('stoch-chart');stochChart.applyOptions({width:el.clientWidth,height:el.clientHeight});}catch(e){}
    try{const el=document.getElementById('phi-chart');phiChart.applyOptions({width:el.clientWidth,height:el.clientHeight});}catch(e){}
  },60);
}

function toggleTheme(){
  darkMode=!darkMode;
  document.body.classList.toggle('dark',darkMode);
  document.getElementById('btn-theme').textContent=darkMode?'☀️':'🌙';
  document.getElementById('btn-theme').classList.toggle('on',darkMode);
  try{localStorage.setItem('atlas_dark',darkMode?'1':'0');}catch(e){}
  applyChartTheme();
}

function initTheme(){
  let saved=null;
  try{saved=localStorage.getItem('atlas_dark');}catch(e){}
  if(saved==='1'){
    darkMode=true;
    document.body.classList.add('dark');
    const b=document.getElementById('btn-theme');
    if(b){b.textContent='☀️';b.classList.add('on');}
  }
}

// ══════════════════════════════════════════════════════
// RSI HEATMAP — RSI de todos os ativos da lista de uma vez, tipo o
// heatmap do Bittime, mas restrito a sua central de trabalho (7 ativos).
// Eixo horizontal = market cap real (escala log), via API publica da
// CoinGecko (gratis, sem chave). Tambem alimenta TOTAL/TOTAL2/TOTAL3 e
// a dominancia dos top 8 ativos.
// ══════════════════════════════════════════════════════
const RSI_HEAT_TF='15m'; // timeframe fixo pro heatmap, independente do grafico principal
let rsiHeatTimer=null, mcapTimer=null;
const CG_ID_MAP={BTCUSDT:'bitcoin',ETHUSDT:'ethereum',LTCUSDT:'litecoin',XRPUSDT:'ripple',SOLUSDT:'solana'};
let mcapCache=null; // {byId:{bitcoin:{cap,...}}, global:{...}}

function rsiZone(v){
  if(v<30)  return {label:'Sobrevendido',  bg:'#00A879',fg:'#ffffff'};
  if(v<45)  return {label:'Fraco',         bg:'#8FBFA8',fg:'#1a1d23'};
  if(v<55)  return {label:'Neutro',        bg:'#B8BEC7',fg:'#1a1d23'};
  if(v<70)  return {label:'Forte',         bg:'#F0A0A0',fg:'#1a1d23'};
  return {label:'Sobrecomprado',bg:'#EC3F3F',fg:'#ffffff'};
}

function fmtUsdCompact(v){
  if(v==null)return'--';
  if(v>=1e12)return'$'+(v/1e12).toFixed(2)+'T';
  if(v>=1e9)return'$'+(v/1e9).toFixed(2)+'B';
  if(v>=1e6)return'$'+(v/1e6).toFixed(2)+'M';
  return'$'+v.toFixed(0);
}

// Busca market cap (CoinGecko) — nao trava o resto do dashboard se falhar
// (rede bloqueada, rate limit etc): tudo aqui e best-effort com fallback.
async function fetchMarketCapData(){
  try{
    const ids=Object.values(CG_ID_MAP).join(',');
    const [gRes,mRes]=await Promise.all([
      fetch('https://api.coingecko.com/api/v3/global',{signal:AbortSignal.timeout(10000)}),
      fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc`,{signal:AbortSignal.timeout(10000)}),
    ]);
    if(!gRes.ok||!mRes.ok)return null;
    const g=(await gRes.json()).data;
    const markets=await mRes.json();
    const byId={};
    markets.forEach(m=>{byId[m.id]=m;});
    return{global:g,byId};
  }catch(e){return null;}
}

function updateMcapTotalsPanel(){
  if(!mcapCache||!mcapCache.global)return;
  const g=mcapCache.global;
  const total=g.total_market_cap?.usd;
  const btcCap=mcapCache.byId.bitcoin?.market_cap;
  const ethCap=mcapCache.byId.ethereum?.market_cap;
  const total2=total!=null&&btcCap!=null?total-btcCap:null;
  const total3=total2!=null&&ethCap!=null?total2-ethCap:null;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=fmtUsdCompact(v);};
  set('mcap-total',total);set('mcap-total2',total2);set('mcap-total3',total3);
  const upd=document.getElementById('mcap-updated');
  if(upd){const now=new Date();upd.textContent=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;}
}

function updateDominancePanel(){
  const list=document.getElementById('dom-list');
  if(!list)return;
  if(!mcapCache||!mcapCache.global||!mcapCache.global.market_cap_percentage){
    list.innerHTML='<div style="color:var(--t3);font-size:9px;padding:4px 9px;">Sem dados (rede bloqueada?)</div>';
    return;
  }
  const pct=mcapCache.global.market_cap_percentage;
  const top8=Object.entries(pct).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const max=top8[0]?top8[0][1]:1;
  list.innerHTML=top8.map(([sym,v])=>`
    <div class="dom-row">
      <span class="dom-sym">${sym.toUpperCase()}</span>
      <div class="dom-bar-wrap"><div class="dom-bar-fill" style="width:${(v/max*100).toFixed(1)}%;"></div></div>
      <span class="dom-pct">${v.toFixed(1)}%</span>
    </div>`).join('');
}

async function updateMarketCapPanels(){
  const data=await fetchMarketCapData();
  if(data)mcapCache=data;
  updateMcapTotalsPanel();
  updateDominancePanel();
  // Reposiciona o heatmap assim que o market cap chega (nao espera o timer de 1min dele)
  updateRsiHeatmap();
}

async function startMarketCapPanels(){
  await updateMarketCapPanels();
  if(mcapTimer)clearInterval(mcapTimer);
  mcapTimer=setInterval(updateMarketCapPanels,300000); // 5 em 5 min — dado que nao muda rapido
}

async function updateRsiHeatmap(){
  const grid=document.getElementById('rsi-heat-grid');
  if(!grid)return;
  const syms=[...SYMBOLS.crypto,...SYMBOLS.metals];
  const results=await Promise.all(syms.map(async sym=>{
    try{
      const d=await fetchCandles(sym,RSI_HEAT_TF,60);
      if(!d||d.length<20)return {sym,rsi:null};
      const closes=d.map(c=>c.close);
      const r=rsiCalc(closes,14);
      return {sym,rsi:r[r.length-1]};
    }catch(e){return {sym,rsi:null};}
  }));

  // Posiciona no eixo X pelo market cap real (log), quando disponivel.
  // XAU/XAG nao tem "market cap" comparavel ao de cripto na mesma escala
  // (ouro sozinho e ~10x o mercado cripto inteiro) — ficam fixos a direita,
  // como referencia de "mega cap", sem distorcer a escala dos outros 5.
  const cryptoCaps=results
    .filter(r=>CG_ID_MAP[r.sym]&&mcapCache?.byId?.[CG_ID_MAP[r.sym]]?.market_cap)
    .map(r=>Math.log10(mcapCache.byId[CG_ID_MAP[r.sym]].market_cap));
  const minLog=cryptoCaps.length?Math.min(...cryptoCaps):0;
  const maxLog=cryptoCaps.length?Math.max(...cryptoCaps):1;
  const span=Math.max(0.01,maxLog-minLog);

  function xFor(sym){
    if(sym==='XAUUSDT')return 88;
    if(sym==='XAGUSDT')return 96;
    const cgId=CG_ID_MAP[sym];
    const cap=cgId&&mcapCache?.byId?.[cgId]?.market_cap;
    if(!cap)return 50; // sem dado de mcap ainda: centro, ate a proxima atualizacao
    const lg=Math.log10(cap);
    const pct=(lg-minLog)/span;
    return 6+Math.max(0,Math.min(1,pct))*76; // 6% a 82%, deixando 82-100% pros metais
  }

  const n=results.length;

  // Evita bolinhas se sobrepondo quando 2+ ativos ficam com RSI/posicao parecidos:
  // calcula tudo primeiro, depois um pequeno "empurra-empurra" separa quem colidiu.
  const points=results.map(({sym,rsi})=>{
    const left=xFor(sym);
    if(rsi==null)return{sym,rsi,top:50,left};
    const clamped=Math.max(10,Math.min(90,rsi));
    const top=((90-clamped)/80)*100;
    return{sym,rsi,top,left};
  });

  // Pre-espalhamento: quando varios ativos batem no mesmo extremo (ex: 5 deles
  // sobrevendidos em RSI ~0), todos caem na mesma linha da borda e o
  // empurra-empurra abaixo nao tem pra onde jogar. Aqui damos um degrade
  // vertical inicial pra cada grupo empatado, deixando o resto do trabalho facil.
  const byBand={};
  points.forEach(p=>{
    const band=Math.round(p.top/8); // agrupa quem esta praticamente na mesma altura
    (byBand[band]=byBand[band]||[]).push(p);
  });
  Object.values(byBand).forEach(group=>{
    if(group.length<2)return;
    group.sort((a,b)=>a.left-b.left);
    const atBottom=group[0].top>50;
    group.forEach((p,i)=>{
      const offset=i*9; // empilha em degrade, pra dentro do painel
      p.top+=atBottom?-offset:offset;
    });
  });

  const MIN_DIST=13; // distancia minima (em % do container) entre centros de bolinha
  for(let pass=0;pass<20;pass++){
    let moved=false;
    for(let i=0;i<points.length;i++){
      for(let j=i+1;j<points.length;j++){
        const a=points[i],b=points[j];
        const dx=a.left-b.left,dy=a.top-b.top; // sem amortecer o eixo Y: senao pontos empilham tudo na borda
        let dist=Math.hypot(dx,dy);
        if(dist<0.01){ // exatamente em cima um do outro: separa numa direcao arbitraria
          a.left+=MIN_DIST/2;b.left-=MIN_DIST/2;moved=true;continue;
        }
        if(dist<MIN_DIST){
          const push=(MIN_DIST-dist)/2,nx=dx/dist,ny=dy/dist;
          a.left+=nx*push;a.top+=ny*push;
          b.left-=nx*push;b.top-=ny*push;
          moved=true;
        }
      }
    }
    points.forEach(p=>{p.left=Math.max(4,Math.min(96,p.left));p.top=Math.max(2,Math.min(98,p.top));});
    if(!moved)break;
  }

  // Zigue-zague: bolinhas vizinhas no espaco alternam o rotulo acima/abaixo,
  // pra nunca ficarem exatamente na mesma linha mesmo se os centros ficarem perto.
  const staggerOf={};
  [...points].sort((a,b)=>a.left-b.left).forEach((p,idx)=>{staggerOf[p.sym]=idx%2;});

  const bandLabels=`<div class="rsi-heat-band-lbl" style="top:3px;">Sobrecomprado</div><div class="rsi-heat-band-lbl" style="bottom:3px;">Sobrevendido</div>`;
  grid.innerHTML=bandLabels+points.map(({sym,rsi,top,left})=>{
    const short=sym.replace('USDT','');
    const lblCls=staggerOf[sym]?' rsi-bubble-lbl-up':'';
    if(rsi==null){
      return `<div class="rsi-bubble" style="top:${top}%;left:${left}%;" title="sem dados">
        <div class="rsi-bubble-dot" style="background:#999;"></div>
        <div class="rsi-bubble-lbl${lblCls}">${short} --</div>
      </div>`;
    }
    const z=rsiZone(rsi);
    return `<div class="rsi-bubble" style="top:${top}%;left:${left}%;" title="${z.label} (${rsi.toFixed(1)})" onclick="changeSym('${sym}')">
      <div class="rsi-bubble-dot" style="background:${z.bg};"></div>
      <div class="rsi-bubble-lbl${lblCls}">${short} ${rsi.toFixed(0)}</div>
    </div>`;
  }).join('');
  const upd=document.getElementById('rsi-heat-updated');
  if(upd){
    const now=new Date();
    upd.textContent=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  }
}

async function startRsiHeatmap(){
  await startMarketCapPanels(); // ja dispara o primeiro updateRsiHeatmap() com o mcap certo
  if(rsiHeatTimer)clearInterval(rsiHeatTimer);
  rsiHeatTimer=setInterval(updateRsiHeatmap,60000); // atualiza a cada 1 min
}

// ══════════════════════════════════════════════════════
// MULTI-VIEW: BTC + ETH + XAU + XAG na mesma tela
// ══════════════════════════════════════════════════════
const MULTI_SYMS=['BTCUSDT','ETHUSDT','XAUUSDT','XAGUSDT'];
const MULTI_HIST_CAP=8000; // teto por mini-grafico (4 ao mesmo tempo, mais leve que o principal)
let multiCharts={}, multiWS=null, multiViewOpen=false;
let multiPending={}, multiTickScheduled=false;
let multiSession=0, multiTransitioning=false;

// ── UM PAINEL DE CADA VEZ ─────────────────────────────────────────────
// Todo painel desta lista ocupa a area do grafico principal. Antes cada
// toggle carregava a sua propria lista de "fecha os outros", escrita a mao:
// o Multi-TF nao fechava nada nem escondia o grafico, entao abria por cima
// dele; o Terminal e o Gold escondiam so o .chart-wrap e deixavam o stoch e
// o phi aparecendo por baixo; e a lista do Validador repetia tres entradas.
// Uma lista so, num lugar so. Modais e toasts nao entram aqui de proposito —
// esses sao os unicos que devem aparecer por cima.
const PAINEIS_EXCLUSIVOS=[
  {view:"multi-view",     toggle:"toggleMultiView"},
  {view:"mtf-view",       toggle:"toggleMtfView"},
  {view:"rsi-table-view", toggle:"toggleRsiTable"},
  {view:"rainbow-view",   toggle:"toggleRainbowTab"},
  {view:"study-view",     toggle:"toggleStudyArchive"},
  {view:"backtest-view",  toggle:"toggleBacktestTab"},
  {view:"macro-view",     toggle:"toggleMacroTab"},
  {view:"terminal-view",  toggle:"toggleTerminalTab"},
  {view:"gold-view",      toggle:"toggleGoldTab"},
];

// A classe .show no proprio elemento e a fonte da verdade, e nao as variaveis
// de estado espalhadas — elas saem de sincronia com facilidade.
function fechaOutrosPaineis(exceto){
  PAINEIS_EXCLUSIVOS.forEach(pn=>{
    if(pn.view===exceto) return;
    const el=document.getElementById(pn.view);
    if(!el||!el.classList.contains("show")) return;
    if(typeof window[pn.toggle]==="function"){
      try{ window[pn.toggle](); }catch(e){ console.warn("[paineis] falha ao fechar "+pn.view,e); }
    }
    // Garantia: varios toggles guardam o proprio booleano de aberto/fechado, e
    // esses booleanos saem de sincronia com a classe (foi exatamente o que uma
    // segunda definicao de toggleTerminalTab causava). Se depois de chamar o
    // toggle o painel ainda esta marcado como aberto, tiro a classe na mao —
    // senao ele fica na tela junto com o painel novo.
    if(el.classList.contains("show")) el.classList.remove("show");
  });
}

// A pilha do grafico principal e o trio grafico + estocastico + phi. Escondia
// so o primeiro em varios lugares, o que deixava os outros dois orfaos na tela.
function mostraGraficoPrincipal(mostrar){
  [".chart-wrap",".stoch-wrap",".phi-wrap"].forEach(sel=>{
    const el=document.querySelector(sel);
    if(el) el.style.display = mostrar ? "" : "none";
  });
}

// Todo toggle chama isto: a tela fica com exatamente um painel, ou so com o
// grafico quando o ultimo painel fecha.
function painelExclusivo(view,abrindo){
  if(abrindo) fechaOutrosPaineis(view);
  const algumAberto=PAINEIS_EXCLUSIVOS.some(pn=>{
    const el=document.getElementById(pn.view);
    return el&&(pn.view===view ? abrindo : el.classList.contains("show"));
  });
  mostraGraficoPrincipal(!algumAberto);
}

function toggleMultiView(){
  // Ignora cliques rapidos demais (abrir/fechar/abrir antes do anterior terminar)
  // — era isso que fazia sessoes antigas de carregamento ficarem rodando por
  // cima de uma sessao nova, dando a impressao de "reload" ficando repetindo.
  if(multiTransitioning)return;
  if(validatorOpen)toggleValidatorPanel(); // os dois escrevem no mesmo painel lateral — mutuamente exclusivos
  multiTransitioning=true;
  multiViewOpen=!multiViewOpen;
  document.getElementById('multi-view').classList.toggle('show',multiViewOpen);
  painelExclusivo('multi-view',multiViewOpen);
  document.querySelector('.chart-wrap').style.display=multiViewOpen?'none':'';
  document.querySelector('.stoch-wrap').style.display=multiViewOpen?'none':'';
  document.querySelector('.phi-wrap').style.display=multiViewOpen?'none':'';
  document.getElementById('btn-multi').classList.toggle('on',multiViewOpen);
  if(multiViewOpen){
    // Pausa o motor do grafico unico (WS + polling) enquanto ele fica escondido —
    // sem isso, o BTC do Multi e o BTC do grafico principal ficavam disputando
    // CPU e rede ao mesmo tempo, causando o atraso que voce sentiu.
    pauseMainEngine();
    openMultiCharts().finally(()=>{multiTransitioning=false;});
  }else{
    closeMultiCharts();
    resumeMainEngine();
    multiTransitioning=false;
  }
}

function pauseMainEngine(){
  if(wsKline){wsKline.onclose=null;try{wsKline.close();}catch(e){}wsKline=null;}
  if(rtInterval){clearInterval(rtInterval);rtInterval=null;}
  const dot=document.getElementById('ws-dot'),st=document.getElementById('ws-st');
  if(dot)dot.className='dot off';
  if(st)st.textContent='Pausado (Multi ativo)';
  // O preco unico no canto superior direito fica parado enquanto o Multi
  // esta ativo (o motor dele foi pausado) — trocar por um badge "MULTI"
  // evita parecer que os dados travaram/pararam de carregar.
  const rt=document.getElementById('rt-price');
  if(rt){rt.textContent='● MULTI ATIVO';rt.style.color='var(--accent)';}
}
function resumeMainEngine(){
  const rt=document.getElementById('rt-price');
  if(rt){rt.style.color='var(--green)';}
  openWS();
}

// Aplica candles + o mesmo conjunto de medias moveis do grafico principal
// (EMA 8/16/55/98/200 + SMA 56/89) num mini-grafico do Multi, e semeia o
// estado incremental (mc.live) pra ticks ao vivo virarem O(1) em vez de
// recalcular tudo a cada mensagem — o mesmo ganho de fluidez do grafico principal.
// O buffer segue o dpr da tela, como no canvas do grafico principal: sem isso
// o circulo sai serrilhado num monitor retina.
function dimensionaCanvasMulti(sym){
  const mc = multiCharts[sym];
  if(!mc || !mc.bcv || !mc.el) return;
  const dpr = window.devicePixelRatio || 1;
  const w = mc.el.clientWidth, h = mc.el.clientHeight;
  if(w < 2 || h < 2) return;
  mc.bcv.width = Math.round(w*dpr);
  mc.bcv.height = Math.round(h*dpr);
  mc.bctx.setTransform(dpr,0,0,dpr,0,0);
  desenhaBolhasMulti(sym);
}

// Os mini-graficos nao tem fluxoPorVela proprio — nem precisam: as velas que o
// fetchCandles devolve ja trazem compra/venda quando a fonte e a Binance, que
// e a mesma origem que alimenta o grafico principal.
function desenhaBolhasMulti(sym){
  const mc = multiCharts[sym];
  if(!mc || !mc.bctx || !mc.bcv) return;
  const dpr = window.devicePixelRatio || 1;
  mc.bctx.save();
  mc.bctx.setTransform(1,0,0,1,0,0);
  mc.bctx.clearRect(0,0,mc.bcv.width,mc.bcv.height);
  mc.bctx.restore();
  if(!bolhasLigadas || !mc.candles || !mc.candles.length) return;

  // a lista so muda quando as velas mudam, entao guardo por quantidade + ultimo
  // horario, e o pan/zoom reaproveita
  const sel = mc.candles.length+"|"+mc.candles[mc.candles.length-1].time;
  if(!mc.bolhas || mc.bolhas.sel !== sel){
    const r = alvosDeVelas(mc.candles);
    mc.bolhas = r ? {sel, corte:r.corte, alvos:r.alvos} : {sel, corte:0, alvos:[]};
  }
  if(!mc.bolhas.alvos.length) return;

  const ts = mc.chart.timeScale();
  pintaBolhas(mc.bctx, mc.el.clientWidth, mc.bolhas.alvos, mc.bolhas.corte, mc.candles,
    t => { try{ return ts.timeToCoordinate(t); }catch(e){ return null; } },
    p => { try{ return mc.series.priceToCoordinate(p); }catch(e){ return null; } });
}
window.desenhaBolhasMulti = desenhaBolhasMulti;

function applyMultiSeries(sym){
  const mc=multiCharts[sym];if(!mc)return;
  mc.series.setData(mc.candles);
  mc.bolhas=null;   // velas novas, lista de bolhas refeita no proximo desenho
  const closes=mc.candles.map(c=>c.close);
  const e8=ema(closes,8),e16=ema(closes,16),e55=ema(closes,55),e98=ema(closes,98),e200=ema(closes,200);
  const m56=sma(closes,56),m89=sma(closes,89);
  const map=(arr)=>mc.candles.map((c,i)=>({time:c.time,value:arr[i]})).filter(d=>d.value!=null);
  mc.ma.ema8.setData(map(e8));mc.ma.ema16.setData(map(e16));mc.ma.ema55.setData(map(e55));
  mc.ma.ema98.setData(map(e98));mc.ma.ema200.setData(map(e200));mc.ma.ma56.setData(map(m56));mc.ma.ma89.setData(map(m89));
  

  const n2=closes.length-2;
  const pick=(arr)=>n2>=0?arr[n2]:arr[arr.length-1];
  mc.live={
    ema8:pick(e8),ema16:pick(e16),ema55:pick(e55),ema98:pick(e98),ema200:pick(e200),
    sma56Win:closes.slice(0,-1).slice(-56),sma89Win:closes.slice(0,-1).slice(-89),
  };
}

async function openMultiCharts(){
  const mySession=multiSession;
  for(const sym of MULTI_SYMS){
    if(mySession!==multiSession)return; // fechou/reabriu no meio do carregamento
    if(multiCharts[sym])continue;
    const el=document.getElementById(`multi-chart-${sym}`);
    if(!el)continue;
    const mchart=LightweightCharts.createChart(el,{
      width:el.clientWidth,height:el.clientHeight,
      // transparente pra bolha de tras aparecer; o fundo fica no proprio
      // container do mini-grafico
      layout:{background:{color:'transparent'},textColor:'#6e7683',fontFamily:'IBM Plex Sans'},
      grid:{vertLines:{color:'#f5f6f7'},horzLines:{color:'#f5f6f7'}},
      rightPriceScale:{borderColor:'#e3e6ea'},
      timeScale:{borderColor:'#e3e6ea',timeVisible:true,secondsVisible:false,rightOffset:3},
      handleScroll:{mouseWheel:true,pressedMouseMove:true},
      handleScale:{mouseWheel:true,pinch:true},
    });
    const series=mchart.addCandlestickSeries({upColor:'#00A879',downColor:'#EC3F3F',borderUpColor:'#00A879',borderDownColor:'#EC3F3F',wickUpColor:'#00A879',wickDownColor:'#EC3F3F'});
    const maCfg={priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false};
    const ma={
      ema8:mchart.addLineSeries({color:C.ema8,lineWidth:1,...maCfg}),
      ema16:mchart.addLineSeries({color:C.ema16,lineWidth:1,...maCfg}),
      ema55:mchart.addLineSeries({color:C.ema55,lineWidth:1,...maCfg}),
      ema98:mchart.addLineSeries({color:C.ema98,lineWidth:1,...maCfg}),
      ema200:mchart.addLineSeries({color:C.ema200,lineWidth:1,...maCfg}),
      ma56:mchart.addLineSeries({color:C.ma56,lineWidth:1,...maCfg}),
      ma89:mchart.addLineSeries({color:C.ma89,lineWidth:1,...maCfg}),
      
    };
    // Canvas por cima do mini-grafico, so pras bolhas. O Multi ficou sem elas
    // ate agora porque o desenho morava dentro do desenhaBolhas, amarrado ao
    // canvas de desenho do grafico principal.
    if(getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const bcv = document.createElement('canvas');
    // z-index 0, ATRAS das telas do grafico: por cima a bolha tingia a vela e
    // escondia a cor dela, do mesmo jeito que acontecia no grafico principal
    bcv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    el.style.background = 'var(--bg1)';
    el.insertBefore(bcv, el.firstChild);
    const bctx = bcv.getContext('2d');

    // as telas que a lib cria entram depois do canvas; z-index 1 pra ficarem
    // por cima dele
    try{ [...el.querySelectorAll('canvas')].forEach(c=>{
      if(c!==bcv){ c.style.position=c.style.position||'relative'; c.style.zIndex='1'; }
    }); }catch(e){}

    const ro=new ResizeObserver(()=>{
      mchart.applyOptions({width:el.clientWidth,height:el.clientHeight});
      dimensionaCanvasMulti(sym);
    });
    ro.observe(el);
    multiCharts[sym]={chart:mchart,series,ma,candles:[],ro,noMore:false,loadingMore:false,live:null,
                      bcv,bctx,bolhas:null,el};
    dimensionaCanvasMulti(sym);

    // redesenha junto com o pan/zoom do proprio mini-grafico
    mchart.timeScale().subscribeVisibleTimeRangeChange(()=>desenhaBolhasMulti(sym));

    // Zoom/pan perto da borda esquerda -> busca mais historico pra esse simbolo
    mchart.timeScale().subscribeVisibleLogicalRangeChange(range=>{
      const m=multiCharts[sym];
      if(!m||!range||m.loadingMore||m.noMore||m.candles.length<10)return;
      if(range.from<15)fetchMultiOlderBatch(sym);
    });

    const d=await fetchCandles(sym,currentTF,500);
    if(mySession!==multiSession)return; // sessao mudou enquanto o fetch estava em voo
    if(d&&multiCharts[sym]){
      multiCharts[sym].candles=d;
      applyMultiSeries(sym);
      desenhaBolhasMulti(sym);
      mchart.timeScale().fitContent();
      const last=d[d.length-1];
      const pxEl=document.getElementById(`multi-px-${sym}`);
      if(pxEl)pxEl.textContent='$'+last.close.toFixed(sym.startsWith('XAG')?3:2);
    }
  }
  if(mySession!==multiSession)return;
  openMultiWS();
  // Carrega o historico completo (dentro do teto) de cada ativo automaticamente,
  // igual o botao "Tudo" faz no grafico principal.
  loadFullHistoryMulti(mySession);
  applyChartTheme(); // mini-graficos recem-criados herdam o tema atual
  startMultiTimers();
  startMultiAnalysis();
}

// Busca mais um lote de velas antigas pra UM simbolo do Multi, preservando o zoom.
async function fetchMultiOlderBatch(sym,mySession=multiSession){
  if(mySession!==multiSession)return false;
  const mc=multiCharts[sym];if(!mc||!mc.candles.length)return false;
  mc.loadingMore=true;
  try{
    const oldest=mc.candles[0].time;
    const r=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${currentTF}&limit=1000&endTime=${oldest*1000-1}`,{signal:AbortSignal.timeout(10000)});
    if(mySession!==multiSession||!multiCharts[sym]){mc.loadingMore=false;return false;}
    if(!r.ok){mc.loadingMore=false;return false;}
    const d=await r.json();
    if(mySession!==multiSession||!multiCharts[sym]){mc.loadingMore=false;return false;}
    if(!d.length){mc.noMore=true;mc.loadingMore=false;return false;}
    const older=d.map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}))
      .filter(c=>c.time<oldest);
    if(!older.length){mc.noMore=true;mc.loadingMore=false;return false;}
    const addedCount=older.length;
    mc.candles=[...older,...mc.candles];
    if(mc.candles.length>MULTI_HIST_CAP)mc.candles=mc.candles.slice(-MULTI_HIST_CAP);
    const visRange=mc.chart.timeScale().getVisibleLogicalRange();
    applyMultiSeries(sym);
      desenhaBolhasMulti(sym);
    if(visRange)mc.chart.timeScale().setVisibleLogicalRange({from:visRange.from+addedCount,to:visRange.to+addedCount});
    mc.loadingMore=false;
    return true;
  }catch(e){mc.loadingMore=false;return false;}
}

// Roda em background pra cada um dos 4 ativos, buscando historico ate o teto
// ou ate a Binance nao ter mais nada, sem travar a UI (pequena pausa entre lotes).
async function loadFullHistoryMulti(mySession=multiSession){
  for(const sym of MULTI_SYMS){
    let i=0;
    while(mySession===multiSession&&multiCharts[sym]&&!multiCharts[sym].noMore&&multiCharts[sym].candles.length<MULTI_HIST_CAP&&i<20){
      const ok=await fetchMultiOlderBatch(sym,mySession);
      if(!ok)break;
      await new Promise(r=>setTimeout(r,150));
      i++;
    }
  }
}

function closeMultiCharts(){
  multiSession++; // invalida qualquer loop assincrono desta sessao (loadFullHistoryMulti, fetchMultiOlderBatch, openMultiCharts em voo)
  fechaMultiWS();
  multiPending={};multiTickScheduled=false;
  stopMultiTimers();
  stopMultiAnalysis();
  for(const sym of MULTI_SYMS){
    if(multiCharts[sym]){
      try{multiCharts[sym].ro.disconnect();}catch(e){}
      try{multiCharts[sym].chart.remove();}catch(e){}
      delete multiCharts[sym];
    }
  }
}

// Timer de contagem regressiva em cada painel do Multi — serve pra auditar
// se a troca de vela de cada ativo esta acontecendo no horario certo.
let multiTimerInterval=null;
// O Multi dependia SO do WebSocket: carregava o historico uma vez e so andava
// se chegasse tick. Com o WS caido, as velas envelheciam, o contador travava
// em 00:00 e os precos congelavam — sem nada avisando que a conexao morreu.
// Agora o mesmo intervalo de 1s que desenha o contador vigia a chegada de
// dado e recarrega o historico quando ele para.
let multiUltimoTick=0;
let multiBussolaUlt=0;
let multiUltimaRecarga=0;
const MULTI_SEM_DADO_MS=20000;   // sem tick por 20s = alguma coisa errada
const MULTI_RECARGA_MS=30000;    // no maximo uma recarga a cada 30s

async function recarregaMulti(){
  const agora=Date.now();
  if(agora-multiUltimaRecarga<MULTI_RECARGA_MS) return;
  multiUltimaRecarga=agora;
  const mySession=multiSession;
  for(const sym of MULTI_SYMS){
    if(mySession!==multiSession) return;
    const mc=multiCharts[sym];
    if(!mc) continue;
    try{
      const d=await fetchCandles(sym,currentTF,300);
      if(d&&d.length&&mySession===multiSession){
        mc.candles=d;
        applyMultiSeries(sym);
      desenhaBolhasMulti(sym);
        const px=document.getElementById(`multi-px-${sym}`);
        if(px) px.textContent="$"+d[d.length-1].close.toFixed(sym.startsWith("XAG")?3:2);
      }
    }catch(e){ /* a proxima tentativa cobre */ }
  }
  // uma conexao pode ter morrido sem disparar onclose; o openMultiWS so
  // reabre as que faltam, entao chamar sempre e seguro
  MULTI_SYMS.forEach(sym=>{
    const ws=multiWSs[sym];
    if(ws&&ws.readyState>1){ try{ws.close();}catch(e){} multiWSs[sym]=null; }
  });
  if(multiViewOpen) openMultiWS();
}

// A forca vem de negocio ao vivo, entao ela precisa de um relogio proprio: os
// outros paineis so redesenham quando o motor reprocessa o historico.
let forcaTimer=null;
function iniciaForca(){
  if(forcaTimer) clearInterval(forcaTimer);
  forcaTimer=setInterval(()=>{
    try{ renderForca(); }catch(e){}
    try{ renderConsolidacao(); }catch(e){}   // mesma cadencia, mesmo motivo
  },2000);
}

function startMultiTimers(){
  if(multiTimerInterval)clearInterval(multiTimerInterval);
  multiUltimoTick=Date.now();
  multiTimerInterval=setInterval(()=>{
    const tfSec=tfToSeconds(currentTF);
    const nowSec=Math.floor((Date.now()+serverTimeOffset)/1000);
    // por ativo: com uma conexao pra cada, um simbolo pode estar mudo enquanto
    // os outros correm — dizer "sem dado" nos quatro esconderia isso
    const agoraMs=Date.now();
    const mudo=sym=>(agoraMs-(multiTickPorSym[sym]||multiUltimoTick))>MULTI_SEM_DADO_MS;
    const semDado=MULTI_SYMS.every(mudo);
    if(semDado) recarregaMulti();
    // as 4 bussolas acompanham enquanto o modal estiver aberto. A cada 2s, nao
    // a cada segundo: sao 5 EMAs e um ATR sobre 300 velas vezes 4 ativos.
    const bm=document.getElementById("bussola-modal");
    if(bm&&bm.style.display==="flex"&&multiViewOpen&&(Date.now()-multiBussolaUlt)>2000){
      multiBussolaUlt=Date.now();
      try{ renderBussolaMulti(); renderCorrelacao(); }catch(e){}
    }
    MULTI_SYMS.forEach(sym=>{
      const mc=multiCharts[sym],el=document.getElementById(`multi-timer-${sym}`);
      if(!mc||!el||!mc.candles.length)return;
      const last=mc.candles[mc.candles.length-1];
      const diff=(last.time+tfSec)-nowSec;
      // vela vencida com o dado parado e sinal de conexao morta, nao de mercado
      // parado: diz isso em vez de fingir uma contagem em 00:00
      if(diff<=0){
        el.textContent=mudo(sym)?"sem dado":"00:00";
        el.style.color=mudo(sym)?"var(--red)":"";
        return;
      }
      el.style.color="";
      const h=Math.floor(diff/3600),m=Math.floor((diff%3600)/60),s=diff%60;
      el.textContent=h>0?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    });
  },1000);
}
function stopMultiTimers(){
  if(multiTimerInterval){clearInterval(multiTimerInterval);multiTimerInterval=null;}
}

// ══════════════════════════════════════════════════════
// MULTI ANALISE: MTF Score + StochRSI + Fibonacci pros 4 ativos ao mesmo
// tempo (mais fetches, mas da pra comparar tudo sem trocar de ativo).
// ══════════════════════════════════════════════════════
let multiAnalysisTimer=null;

async function fetchMTFFor(sym){
  const out={};
  for(const[tf,bn]of Object.entries(MTF_TFS)){
    try{
      const d=await fetchCandles(sym,bn,200);
      if(d)out[tf]=d.map(c=>c.close);
    }catch(e){}
  }
  return out;
}

// Micro timing pro Validador (M1/M5/M15) — M5 e reaproveitado do mtfLocal
// (ja veio no fetchMTFFor), so busca M1 e M15 a mais por ativo.
async function fetchMicroFor(sym,mtfLocal){
  const out={'5':mtfLocal['5']||null};
  for(const tf of ['1','15']){
    try{
      const d=await fetchCandles(sym,MICRO_TFS[tf],60);
      if(d)out[tf]=d.map(c=>c.close);
    }catch(e){}
  }
  return out;
}

function calcMicroFrom(microLocal){
  const dirs={};let buyCt=0,sellCt=0;
  MICRO_KEYS.forEach(tf=>{
    const d=microLocal[tf];
    if(!d||d.length<20){dirs[tf]='flat';return;}
    const e8=ema(d,8),e16=ema(d,16),last=e8.length-1;
    dirs[tf]=e8[last]>e16[last]?'buy':e8[last]<e16[last]?'sell':'flat';
    if(dirs[tf]==='buy')buyCt++;else if(dirs[tf]==='sell')sellCt++;
  });
  return{dirs,buyCt,sellCt};
}

function calcMTFFrom(mtfLocal){
  let sb=0,sd=0;const dirs={};
  MTF_KEYS.forEach(tf=>{
    const d=mtfLocal[tf];if(!d||d.length<89){dirs[tf]='flat';return;}
    const m56t=sma(d,56),m89t=sma(d,89);const last=d.length-1;
    if(m56t[last]!=null&&m89t[last]!=null){
      if(m56t[last]>m89t[last]){sb++;dirs[tf]='buy';}
      else if(m56t[last]<m89t[last]){sd++;dirs[tf]='sell';}
      else dirs[tf]='flat';
    }else dirs[tf]='flat';
  });
  return{scoreBull:sb,scoreBear:sd,dirs};
}

// Versao leve do detector de Fibonacci: direcao (EMA8 x EMA16) + swing
// high/low das ultimas 80 velas, gerando so os 3 primeiros alvos de extensao.
// Nao roda a suite completa de sinais (ATLAS/GOLD/etc) por ativo — isso fica
// pra uma proxima fase, e um motor grande demais pra rodar 4x em paralelo.
// Leitura do FEIXE completo de medias (nao so EMA8 x EMA16) — evita marcar
// "BULL" num repique fraco que ainda esta por baixo das medias lentas.
// Tambem detecta squeeze: quando o feixe inteiro esta espremido junto,
// e um aviso separado, nem bull nem bear "de verdade" ainda.
function computeRibbonRead(candles){
  if(!candles||candles.length<210)return null;
  const closes=candles.map(c=>c.close);
  const e8=ema(closes,8),e16=ema(closes,16),e55=ema(closes,55),e98=ema(closes,98),e200=ema(closes,200);
  const last=closes.length-1;
  const v8=e8[last],v16=e16[last],v55=e55[last],v98=e98[last],v200=e200[last];
  if([v8,v16,v55,v98,v200].some(v=>v==null))return null;

  const bull=v8>v16; // direcao "rasa", so pra decidir lado do alvo de fib
  const bullAligned=v8>v16&&v16>v55&&v55>v98&&v98>v200;
  const bearAligned=v8<v16&&v16<v55&&v55<v98&&v98<v200;
  const aligned=bull?bullAligned:bearAligned;

  // Squeeze: todas as medias espremidas perto uma da outra, relativo ao preco
  const vals=[v8,v16,v55,v98,v200];
  const spread=(Math.max(...vals)-Math.min(...vals))/closes[last];
  const squeeze=spread<0.006; // <0.6% de distancia entre a mais rapida e a mais lenta
  // "Esticado": feixe bem aberto, longe de squeeze — preco ja correu, sem a
  // parede das EMAs por perto pra segurar um recuo. E o cenario de perseguicao
  // que historicamente deu mais stop (entrada tardia, sem protecao estrutural).
  const esticado=spread>0.02;

  // Squeeze ALINHADO (comprimido mas ainda na ordem certa 8>16>55>98>200, ou o
  // inverso) e diferente de squeeze DESALINHADO (comprimido e embaralhado, sem
  // ordem — indecisao de verdade). O alinhado e a entrada preferida: as EMAs
  // coladas funcionam como parede curta contra rompimento da tendencia.
  const squeezeAlinhado = squeeze && aligned;

  let strength = squeeze ? (squeezeAlinhado?'squeeze_alinhado':'squeeze_indecisao') : aligned?'forte':'fraco';
  return{bull,aligned,squeeze,squeezeAlinhado,esticado,spread,strength};
}

function computeLightFib(candles){
  if(!candles||candles.length<60)return null;
  const closes=candles.map(c=>c.close);
  const e8=ema(closes,8),e16=ema(closes,16);
  const l8=e8[e8.length-1],l16=e16[e16.length-1];
  if(l8==null||l16==null)return null;
  const bull=l8>l16;
  const win=candles.slice(-80);
  const hi=Math.max(...win.map(c=>c.high)),lo=Math.min(...win.map(c=>c.low));
  const p1=bull?hi:lo, rng=Math.abs(hi-lo);
  const targets=[1,1.618,2.444].map(lv=>bull?p1+rng*lv:p1-rng*lv);
  return{bull,targets};
}

// ══════════════════════════════════════════════════════
// ANTECIPADOR — sinal de reversao ANTES do cruzamento confirmar.
// O cruzamento EMA8x16 (sinal STRESS) so dispara depois que o cruzamento ja
// aconteceu — atrasado por definicao. O Antecipador olha 2 coisas que costumam
// aparecer ANTES do cruzamento:
//   1) Convergencia: o gap entre EMA8 e EMA16 encolhendo nas ultimas velas
//      (a tendencia atual perdendo forca, mesmo sem ter cruzado ainda)
//   2) Virada do StochRSI: K cruzando D vindo de uma zona extrema (esticado)
// Os dois juntos = reversao se formando, ainda sem confirmacao do cruzamento.
// ══════════════════════════════════════════════════════
function computeAntecipador(candles){
  if(!candles||candles.length<60)return null;
  const closes=candles.map(c=>c.close);
  const e8=ema(closes,8),e16=ema(closes,16);
  const n=closes.length,last=n-1;
  if(e8[last]==null||e16[last]==null)return null;

  const gapPct=i=>Math.abs(e8[i]-e16[i])/closes[i];
  const lookback=5;
  const idxPast=Math.max(0,last-lookback);
  const gapNow=gapPct(last), gapPast=gapPct(idxPast);
  // Convergindo = gap encolheu pelo menos 30% nas ultimas `lookback` velas
  const convergindo = gapPast>0 && gapNow < gapPast*0.7;

  const r=rsiCalc(closes,P.rsiLen),s=stochCalc(r,P.stochLen),k=sma(s,P.kSmooth),d=sma(k,P.dSmooth);
  const kL=k.length-1;
  if(kL<1||k[kL]==null||d[kL]==null||k[kL-1]==null||d[kL-1]==null){
    return{status:'indisponivel',convergindo,gapNow,gapPast};
  }
  const kNow=k[kL],dNow=d[kL],kPrev=k[kL-1],dPrev=d[kL-1];
  // Virada vindo de zona esticada: K cruza D pra baixo tendo estado perto/acima
  // do sobrecomprado, ou pra cima tendo estado perto/abaixo do sobrevendido.
  const virandoBaixo = kPrev>=dPrev && kNow<dNow && kPrev>=(P.ob-10);
  const virandoCima  = kPrev<=dPrev && kNow>dNow && kPrev<=(P.os+10);

  const bullAtual = e8[last]>e16[last]; // tendencia rasa atual (antes de reverter)

  let status='nenhum', direcao=null, forca=0;
  if(bullAtual && virandoBaixo){ status='alerta'; direcao='baixa'; forca=(convergindo?2:1); }
  else if(!bullAtual && virandoCima){ status='alerta'; direcao='alta'; forca=(convergindo?2:1); }

  return{status,direcao,forca,convergindo,gapNow,gapPast,kNow,dNow};
}

async function updateMultiAnalysis(){
  const container=document.getElementById('multi-analysis-cards');
  if(!container||!multiViewOpen)return;
  const results=await Promise.all(MULTI_SYMS.map(async sym=>{
    const mtfLocal=await fetchMTFFor(sym);
    const mtf=calcMTFFrom(mtfLocal);
    const mc=multiCharts[sym];
    let stochLocal={k:null,d:null},stochH1={k:null,d:null};
    if(mc&&mc.candles.length>50){
      const closes=mc.candles.map(c=>c.close);
      const r=rsiCalc(closes,P.rsiLen),s=stochCalc(r,P.stochLen),k=sma(s,P.kSmooth),d2=sma(k,P.dSmooth);
      stochLocal={k:k[k.length-1],d:d2[d2.length-1]};
    }
    if(mtfLocal['60']&&mtfLocal['60'].length>50){
      const r=rsiCalc(mtfLocal['60'],P.rsiLen),s=stochCalc(r,P.stochLen),k=sma(s,P.kSmooth),d2=sma(k,P.dSmooth);
      stochH1={k:k[k.length-1],d:d2[d2.length-1]};
    }
    const fib=mc?computeLightFib(mc.candles):null;
    const ribbon=mc?computeRibbonRead(mc.candles):null;
    const close=mc&&mc.candles.length?mc.candles[mc.candles.length-1].close:null;
    return{sym,mtf,stochLocal,stochH1,fib,ribbon,close};
  }));
  if(!multiViewOpen)return; // fechou enquanto os fetches rodavam
  container.innerHTML=results.map(renderMACard).join('');
  const upd=document.getElementById('multi-analysis-updated');
  if(upd){const now=new Date();upd.textContent=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;}
}

// Cache dos ultimos dados calculados por ativo (pra askAIInsight reaproveitar
// sem refazer fetches) e das respostas de IA ja geradas (sobrevivem ao
// re-render do painel a cada 60s).
let lastValidatorData = {};
let aiInsights = {};

// Gera o mesmo resumo estruturado de antes, mas em vez de chamar a API
// (que so funciona dentro do artefato do Claude.ai, nao num arquivo local
// aberto via file://), copia pro clipboard — cole aqui no chat pra receber
// a leitura de verdade.
function buildAIPrompt(sym){
  const d=lastValidatorData[sym];
  if(!d)return null;
  const {mtf,ribbon,stochH1,micro,antecipador,rsiInv,fib,close,validacao}=d;
  const estadoEMA = ribbon ? estadoEMAdoRibbon(ribbon) : 'indisponivel';
  const resumo = {
    ativo: sym.replace('USDT',''),
    preco: close,
    mtf_score: `${validacao.score}/4`,
    mtf_direcao_dominante: validacao.direcao,
    mtf_por_timeframe: mtf.dirs,
    estado_emas: estadoEMA,
    squeeze: ribbon ? {ativo: ribbon.squeeze, alinhado: ribbon.squeezeAlinhado, esticado: ribbon.esticado} : null,
    stochrsi_h1: stochH1,
    micro_timing_M1_M5_M15: micro ? micro.dirs : null,
    antecipador: antecipador && antecipador.status==='alerta' ? {direcao: antecipador.direcao, convergindo: antecipador.convergindo} : 'sem alerta',
    rsi_inverso_alvo_os30_ob70: rsiInv ? {os: rsiInv.osPrice, ob: rsiInv.obPrice} : null,
    fibonacci_targets: fib ? fib.targets : null,
    veredito_checklist: {status: validacao.status, motivo: validacao.motivo},
  };
  return `Analise esta leitura do ATLAS Validador pra ${resumo.ativo}:

${JSON.stringify(resumo, null, 2)}

O checklist segue este framework: camada macro (D1) define contexto, camada intermediaria (H1/H4) valida estrutura, camada micro (M1/M5/M15) so confirma timing (nunca decide direcao sozinha). Squeeze alinhado (EMAs comprimidas mas ordenadas) e a entrada preferida porque as EMAs coladas seguram um recuo. O Antecipador sinaliza possivel reversao ANTES do cruzamento confirmar. Feixe esticado sem squeeze e "perseguicao" (risco maior).

Da uma leitura curta sintetizando o que esses dados juntos sugerem — nao repita os numeros soltos, interprete a combinacao. Se algum indicador conflitar com os outros, aponte isso.`;
}

async function askAIInsight(sym){
  const prompt=buildAIPrompt(sym);
  if(!prompt)return;
  const card=document.getElementById(`ma-card-${sym}`);
  const box=card?card.querySelector('.ma-ai-btn,.ma-ai-box'):null;
  try{
    await navigator.clipboard.writeText(prompt);
    aiInsights[sym]={copied:true};
    if(box)box.outerHTML=`<div class="ma-ai-box copied">📋 Copiado! Cole no chat com o Claude pra receber a leitura.<br><button class="ma-ai-retry" onclick="event.stopPropagation();askAIInsight('${sym}')">Copiar de novo</button></div>`;
  }catch(e){
    // Clipboard bloqueado (ex: sem permissao) — mostra o texto pra copiar na mao
    if(box)box.outerHTML=`<div class="ma-ai-box"><div class="ma-ai-hd">📋 Copie e cole no chat com o Claude:</div><textarea class="ma-ai-textarea" onclick="event.stopPropagation();this.select();" readonly>${prompt}</textarea></div>`;
  }
}

function renderMACard({sym,mtf,stochLocal,stochH1,fib,ribbon,close,micro,antecipador,rsiInv,fundingInterp,oiInterp,validacao}){
  const short=sym.replace('USDT','');
  const dirsHtml=MTF_KEYS.map(tf=>{
    const dir=mtf.dirs[tf]||'flat';
    return `<div class="ma-mtf-dot ${dir==='buy'?'buy':dir==='sell'?'sell':''}" title="${tf}"></div>`;
  }).join('');
  const score=Math.max(mtf.scoreBull,mtf.scoreBear);
  const zone=stochH1.k!=null?(stochH1.k>=P.ob?'SOBRECOMPRADO':stochH1.k<=P.os?'SOBREVENDIDO':'neutro'):'--';

  // Badge do feixe: agora distingue squeeze ALINHADO (entrada ideal, dourado)
  // de squeeze DESALINHADO (indecisao de verdade, cinza) > BULL/BEAR FORTE > FRACO
  let ribbonBadge='<span class="ma-fib-badge ma-fib-flat">--</span>';
  if(ribbon){
    if(ribbon.squeeze&&ribbon.squeezeAlinhado){
      ribbonBadge=`<span class="ma-fib-badge ma-fib-squeeze-ideal blink-dot" title="Squeeze alinhado — EMAs coladas e na ordem certa, sua entrada preferida">SQUEEZE ${ribbon.bull?'BULL':'BEAR'} ★</span>`;
    }else if(ribbon.squeeze){
      ribbonBadge='<span class="ma-fib-badge ma-fib-squeeze blink-dot" title="Feixe emaranhado sem ordem definida — indecisao de verdade">SQUEEZE</span>';
    }else{
      const cls=ribbon.bull?'ma-fib-bull':'ma-fib-bear';
      const lbl=(ribbon.bull?'BULL':'BEAR')+(ribbon.aligned?' FORTE':' FRACO');
      ribbonBadge=`<span class="ma-fib-badge ${cls}">${lbl}</span>`;
    }
  }

  // Micro timing (M1/M5/M15) — 3 pontinhos, so pra mostrar o timing, nunca a direcao
  let microHtml='';
  if(micro){
    const dotsHtml=MICRO_KEYS.map(tf=>{
      const dir=micro.dirs[tf]||'flat';
      return `<div class="ma-mtf-dot ${dir==='buy'?'buy':dir==='sell'?'sell':''}" title="${MICRO_LBL[tf]}"></div>`;
    }).join('');
    microHtml=`<div class="ma-row"><span class="k">Micro (M1/M5/M15)</span></div><div class="ma-mtf-row">${dotsHtml}</div>`;
  }

  // Aviso de perseguicao: feixe ja bem aberto (fora do squeeze), sem a
  // parede das EMAs por perto — o padrao que historicamente deu mais stop.
  const chaseHtml = (ribbon&&ribbon.esticado&&!ribbon.squeeze)
    ? `<div class="ma-chase-warn">⚠ Feixe esticado — sem protecao das EMAs por perto</div>` : '';

  // Antecipador: alerta de possivel reversao ANTES do cruzamento confirmar.
  // Mais destacado quando conflita com a direcao que o resto do checklist aprovaria.
  let antecipadorHtml='';
  if(antecipador&&antecipador.status==='alerta'){
    const contra=validacao&&validacao.antecipadorContra;
    antecipadorHtml=`<div class="ma-antecip ${contra?'contra':''}" title="Convergencia EMA8x16${antecipador.convergindo?' (confirmada)':' (ainda nao)'} + StochRSI virando de zona esticada">
      🔮 Antecipador: possivel reversao p/ ${antecipador.direcao==='alta'?'ALTA':'BAIXA'}${contra?' ⚠':''}
    </div>`;
  }

  // RSI Inverso: preco alvo pro RSI(14) puro bater 30/70
  const rsiInvHtml = rsiInv
    ? `<div class="ma-row"><span class="k">Alvo RSI 30/70</span><span class="v">${rsiInv.osPrice!=null?rsiInv.osPrice.toFixed(2):'--'} / ${rsiInv.obPrice!=null?rsiInv.obPrice.toFixed(2):'--'}</span></div>`
    : '';

  // Funding + Open Interest — sentimento de mercado leve, so nos cards
  let sentimentHtml='';
  if(fundingInterp&&fundingInterp.pct!=null){
    const fCol=fundingInterp.extreme?'var(--goldd)':'var(--t2)';
    sentimentHtml+=`<div class="ma-row"><span class="k">Funding</span><span class="v" style="color:${fCol};">${fundingInterp.pct.toFixed(4)}%${fundingInterp.extreme?' ⚠':''}</span></div>`;
  }
  if(oiInterp&&oiInterp.oiChangePct!=null){
    const oCol=oiInterp.healthy===false?'var(--goldd)':oiInterp.healthy===true?'var(--green)':'var(--t2)';
    sentimentHtml+=`<div class="ma-row"><span class="k">OI (1h)</span><span class="v" style="color:${oCol};">${oiInterp.oiChangePct>=0?'+':''}${oiInterp.oiChangePct.toFixed(1)}%</span></div>`;
  }

  // Selo de validacao — LIBERADO / ATENCAO / BLOQUEADO, com o motivo do checklist
  let sealHtml='';
  if(validacao){
    const sealLbl=validacao.status==='aprovado'?'LIBERADO':validacao.status==='atencao'?'ATENCAO':'BLOQUEADO';
    sealHtml=`<div class="ma-seal ${validacao.status}">
      <span class="ma-seal-lbl">${sealLbl} · ${validacao.direcao==='compra'?'COMPRA':'VENDA'}</span>
      <span class="ma-seal-motivo">${validacao.motivo}</span>
    </div>`;
  }

  // Risco Deriv por ativo: mesma formula do painel unico (stake * distancia% * multiplicador)
  let riskHtml='';
  if(fib&&close!=null){
    const lvls=[1,1.618,2.444];
    const gains=fib.targets.map(t=>P.stake*(Math.abs(t-close)/close)*P.mult);
    const rr=gains[0]/P.stake;
    const rrTag=rr>=3.1?'IDEAL':rr>=2?'OK':'BAIXO';
    const gainColor=fib.bull?'var(--green)':'var(--red)';
    riskHtml=`<div class="ma-row"><span class="k">R:R (Fib 1)</span><span class="v">${rr.toFixed(2)} [${rrTag}]</span></div>`
      +fib.targets.map((t,i)=>`<div class="ma-row"><span class="k">Fib ${lvls[i]}</span><span class="v">${t.toFixed(2)} <span style="color:${gainColor};">+$${gains[i].toFixed(2)}</span></span></div>`).join('');
  }

  const sealClass=validacao?(validacao.entradaIdeal&&validacao.status==='aprovado'?'ma-card-ideal':`ma-card-${validacao.status}`):'';

  // Copiar resumo pra IA — botao sob demanda. Nao chama API nenhuma (o
  // dashboard roda como arquivo local, sem chave disponivel) — so copia o
  // resumo estruturado pra colar aqui no chat com o Claude.
  const insight=aiInsights[sym];
  let aiHtml;
  if(!insight){
    aiHtml=`<button class="ma-ai-btn" onclick="event.stopPropagation();askAIInsight('${sym}')">📋 Copiar p/ IA</button>`;
  }else if(insight.copied){
    aiHtml=`<div class="ma-ai-box copied">📋 Copiado! Cole no chat com o Claude pra receber a leitura.<br><button class="ma-ai-retry" onclick="event.stopPropagation();askAIInsight('${sym}')">Copiar de novo</button></div>`;
  }else{
    aiHtml='';
  }

  return `<div class="ma-card ${sealClass}" onclick="changeSym('${sym}')" id="ma-card-${sym}">
    <div class="ma-hd"><span>${short}</span>${ribbonBadge}</div>
    <div class="ma-body">
      <div class="ma-mtf-row">${dirsHtml}<span class="ma-mtf-score">${score}/${P.minScore}</span></div>
      <div class="ma-row"><span class="k">StochRSI H1</span><span class="v">${stochH1.k!=null?stochH1.k.toFixed(0):'--'} (${zone})</span></div>
      ${microHtml}
      ${antecipadorHtml}
      ${rsiInvHtml}
      ${sentimentHtml}
      ${chaseHtml}
      ${riskHtml}
      ${sealHtml}
      ${aiHtml}
    </div>
  </div>`;
}

function startMultiAnalysis(){
  const sa=document.getElementById('single-analysis'),ma=document.getElementById('multi-analysis');
  if(sa)sa.style.display='none';
  if(ma)ma.style.display='block';
  updateMultiAnalysis();
  if(multiAnalysisTimer)clearInterval(multiAnalysisTimer);
  multiAnalysisTimer=setInterval(updateMultiAnalysis,60000);
}
function stopMultiAnalysis(){
  if(multiAnalysisTimer){clearInterval(multiAnalysisTimer);multiAnalysisTimer=null;}
  const sa=document.getElementById('single-analysis'),ma=document.getElementById('multi-analysis');
  if(sa)sa.style.display='';
  if(ma)ma.style.display='none';
}

// ══════════════════════════════════════════════════════
// VALIDADOR — mesma logica do multi-analise (Score + Ribbon + StochRSI),
// mas por REST puro (sem abrir mini-graficos ao vivo) e pra TODOS os ativos
// da lista, nao so os 4 do grid 2x2. Roda em paralelo ao grafico principal,
// sem pausar nada — so pesquisa candles a cada 60s.
// ══════════════════════════════════════════════════════
let validatorOpen=false, validatorTimer=null;

function toggleValidatorPanel(){
  validatorOpen=!validatorOpen;
  // O Validador nao ocupa a area do grafico, entao nao entra no painelExclusivo.
  // Mas ele escreve no mesmo painel lateral que o Multi (#multi-analysis), e
  // esses dois sim se atrapalham.
  if(validatorOpen&&multiViewOpen)toggleMultiView();
  const sa=document.getElementById('single-analysis'),ma=document.getElementById('multi-analysis');
  if(validatorOpen){
    if(sa)sa.style.display='none';
    if(ma)ma.style.display='block';
  }else if(!multiViewOpen){
    if(sa)sa.style.display='';
    if(ma)ma.style.display='none';
  }
  document.getElementById('btn-validador').classList.toggle('on',validatorOpen);
  if(validatorOpen){
    updateValidatorPanel();
    if(validatorTimer)clearInterval(validatorTimer);
    validatorTimer=setInterval(updateValidatorPanel,60000);
  }else if(validatorTimer){
    clearInterval(validatorTimer);validatorTimer=null;
  }
}

// Classifica o "estado" do feixe de EMAs pro selo de validacao. Agora com uma
// 5a categoria: squeeze ALINHADO (comprimido mas ainda ordenado) — a entrada
// preferida, porque o feixe colado funciona como parede curta de protecao.
function estadoEMAdoRibbon(ribbon){
  if(!ribbon)return'indecisao';
  if(ribbon.squeeze)return ribbon.squeezeAlinhado ? (ribbon.bull?'squeeze_alta':'squeeze_baixa') : 'indecisao';
  if(ribbon.aligned)return ribbon.bull?'confianca':'medo';
  return'duvida'; // feixe existe mas nao esta alinhado -> enfraquecimento
}

// Roda o checklist completo (composicao do MTF Score + estado das EMAs + StochRSI
// + timing nos tempos micro) e devolve o veredito: aprovado / atencao / bloqueado.
// O micro (M1/M5/M15) NUNCA decide a direcao — so confirma o timing depois que
// a estrutura (macro+meso) ja aprovou.
function validarAtivo({mtf,ribbon,stochH1,micro,antecipador,fundingInterp,oiInterp}){
  const scoreBull=mtf.scoreBull,scoreBear=mtf.scoreBear;
  const direcao = scoreBull>scoreBear?'compra':scoreBear>scoreBull?'venda':(ribbon?.bull?'compra':'venda');
  const alvo = direcao==='compra'?'buy':'sell';
  const score = direcao==='compra'?scoreBull:scoreBear;

  const baseConcorda = mtf.dirs['5']===alvo;
  const macroConcorda = mtf.dirs['D']===alvo;
  const meioConcorda = mtf.dirs['60']===alvo||mtf.dirs['240']===alvo;
  const divergenciaIsolada = !baseConcorda && !macroConcorda && meioConcorda;
  const composicaoOk = score>=P.minScore && (baseConcorda||macroConcorda) && !divergenciaIsolada;

  const estadoEMA = estadoEMAdoRibbon(ribbon);
  const emaAlinhada = (direcao==='compra'&&(estadoEMA==='confianca'||estadoEMA==='squeeze_alta'))
                    || (direcao==='venda'&&(estadoEMA==='medo'||estadoEMA==='squeeze_baixa'));
  const entradaIdeal = estadoEMA==='squeeze_alta'||estadoEMA==='squeeze_baixa'; // squeeze alinhado = sua entrada preferida
  const perseguindo = ribbon && ribbon.esticado && !ribbon.squeeze; // feixe ja bem aberto, sem a parede das EMAs por perto

  let stochOk=true, stochMotivo='';
  if(stochH1.k!=null){
    if(direcao==='compra'&&stochH1.k>=P.ob){stochOk=false;stochMotivo=`StochRSI H1 esticado (${stochH1.k.toFixed(0)}) — aguardar recuo antes de comprar.`;}
    if(direcao==='venda'&&stochH1.k<=P.os){stochOk=false;stochMotivo=`StochRSI H1 esticado (${stochH1.k.toFixed(0)}) — aguardar recuo antes de vender.`;}
  }

  // Micro timing (M1/M5/M15): so avaliado se a estrutura ja passou nos checks acima.
  // Nao bloqueia — so rebaixa "aprovado" pra "atencao" (estrutura ok, falta o timing).
  let microOk=true, microCt=0;
  if(micro){
    microCt = direcao==='compra'?micro.buyCt:micro.sellCt;
    microOk = microCt>=2; // pelo menos 2 dos 3 (M1/M5/M15) confirmando o timing
  }

  // Antecipador: alerta de reversao ANTES do cruzamento confirmar (convergencia
  // EMA8x16 + virada do StochRSI vindo de zona esticada). Se aponta pro lado
  // OPOSTO da direcao que estamos validando, isso pesa mais que "passou no
  // resto do checklist" — e cautela objetiva, nao intuicao.
  const antecipadorContra = antecipador && antecipador.status==='alerta'
    && ((direcao==='compra'&&antecipador.direcao==='baixa')||(direcao==='venda'&&antecipador.direcao==='alta'));

  // Funding extremo CONTRA a direcao: comprar com funding muito positivo (mercado
  // ja esta lotado de comprado alavancado) ou vender com funding muito negativo
  // e igual perseguir — sem gente nova do seu lado pra empurrar mais.
  const fundingContra = fundingInterp && fundingInterp.extreme
    && ((direcao==='compra'&&fundingInterp.bias==='comprado')||(direcao==='venda'&&fundingInterp.bias==='vendido'));

  // OI enfraquecendo a favor da direcao (preco andando mas sem dinheiro novo,
  // so posicao antiga fechando) — mesmo aviso do "perseguindo" do feixe.
  const oiFraco = oiInterp && oiInterp.healthy===false;

  let status='bloqueado', motivo='';
  if(divergenciaIsolada)motivo=`Divergencia isolada: so o meio (H1/H4) a favor, base (M5) e macro (D1) contra.`;
  else if(!composicaoOk)motivo=`Score insuficiente (${score}/${Math.max(mtf.scoreBull,mtf.scoreBear,4)}) pra ${direcao}.`;
  else if(!emaAlinhada)motivo=`EMAs em "${estadoEMA}" — nao sustentam ${direcao} ainda.`;
  else if(!stochOk)motivo=stochMotivo;
  else if(antecipadorContra){
    status='atencao';
    motivo=`Antecipador aponta possivel reversao pra ${antecipador.direcao} (StochRSI virando${antecipador.convergindo?' + EMAs convergindo':''}) — cautela mesmo com o resto do checklist a favor.`;
  }
  else if(!microOk)status='atencao',motivo=`Estrutura ok, mas timing micro ainda nao confirmou (${microCt}/3 em M1/M5/M15).`;
  else if(fundingContra){
    status='atencao';
    motivo=`Funding esticado a favor de ${fundingInterp.bias} — mercado ja lotado nesse lado, perseguir ${direcao} aqui e igual comprar sem gente nova por perto.`;
  }
  else if(oiFraco){
    status='atencao';
    motivo=`${oiInterp.label} — movimento sem confirmacao de dinheiro novo entrando.`;
  }
  else if(entradaIdeal){
    status='aprovado';
    motivo=`Entrada ideal: squeeze alinhado + Score ${score}/4 + timing micro (${microCt}/3) — EMAs coladas seguram o recuo.`;
  }
  else if(perseguindo){
    status='atencao';
    motivo=`Estrutura ok, mas feixe ja esticado (fora do squeeze) — entrada de perseguicao, sem a parede das EMAs por perto pra segurar.`;
  }
  else{
    status = score>=P.minScore+1 ? 'aprovado' : 'atencao';
    motivo = status==='aprovado' ? `Composicao solida + EMAs + StochRSI + timing micro (${microCt}/3) ok.` : `Passa no minimo, mas score no limite (${score}/4) — confluencia fraca.`;
  }
  return{status,direcao,score,motivo,microCt,entradaIdeal,antecipadorContra};
}

async function updateValidatorPanel(){
  const container=document.getElementById('multi-analysis-cards');
  if(!container||!validatorOpen)return;
  const results=await Promise.all(ALL_SYMS.map(async sym=>{
    const mtfLocal=await fetchMTFFor(sym);
    const mtf=calcMTFFrom(mtfLocal);
    const symCandles=await fetchCandles(sym,currentTF,220);
    let stochLocal={k:null,d:null},stochH1={k:null,d:null};
    if(symCandles&&symCandles.length>50){
      const closes=symCandles.map(c=>c.close);
      const r=rsiCalc(closes,P.rsiLen),s=stochCalc(r,P.stochLen),k=sma(s,P.kSmooth),d2=sma(k,P.dSmooth);
      stochLocal={k:k[k.length-1],d:d2[d2.length-1]};
    }
    if(mtfLocal['60']&&mtfLocal['60'].length>50){
      const r=rsiCalc(mtfLocal['60'],P.rsiLen),s=stochCalc(r,P.stochLen),k=sma(s,P.kSmooth),d2=sma(k,P.dSmooth);
      stochH1={k:k[k.length-1],d:d2[d2.length-1]};
    }
    const fib=symCandles?computeLightFib(symCandles):null;
    const ribbon=symCandles?computeRibbonRead(symCandles):null;
    const antecipador=symCandles?computeAntecipador(symCandles):null;
    const close=symCandles&&symCandles.length?symCandles[symCandles.length-1].close:null;
    let rsiInv=null;
    if(symCandles&&symCandles.length>20){
      const st=rsiState(symCandles.map(c=>c.close),14);
      if(st)rsiInv=calcInverseRSITargets(st.ag,st.al,st.last);
    }
    const microLocal=await fetchMicroFor(sym,mtfLocal);
    const micro=calcMicroFrom(microLocal);
    // Sentimento (leve): so Funding + OI aqui — Long/Short e Book ficam
    // reservados pro painel de ativo unico, pra nao multiplicar 33x mais
    // chamadas de rede a cada 60s.
    const [funding, oiHist]=await Promise.all([fetchFundingRate(sym), fetchOIHistory(sym,'1h',13)]);
    const fundingInterp=interpretFunding(funding?funding.rate:null);
    const priceDir = symCandles&&symCandles.length>5 ? (symCandles[symCandles.length-1].close>=symCandles[symCandles.length-5].close?'alta':'baixa') : null;
    const oiInterp=interpretOI(oiHist,priceDir);
    const validacao=validarAtivo({mtf,ribbon,stochH1,micro,antecipador,fundingInterp,oiInterp});
    return{sym,mtf,stochLocal,stochH1,fib,ribbon,close,micro,antecipador,rsiInv,fundingInterp,oiInterp,validacao};
  }));
  if(!validatorOpen)return; // fechou enquanto os fetches rodavam
  // Ordena: bloqueados por ultimo, aprovados primeiro — pra achar oportunidade rapido
  const ordem={aprovado:0,atencao:1,bloqueado:2};
  results.sort((a,b)=>ordem[a.validacao.status]-ordem[b.validacao.status]);
  // Cache pra askAIInsight() reaproveitar sem refazer todos os fetches
  results.forEach(r=>{lastValidatorData[r.sym]=r;});
  container.innerHTML=results.map(renderMACard).join('');
  const upd=document.getElementById('multi-analysis-updated');
  if(upd){const now=new Date();upd.textContent=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;}
}

// ══════════════════════════════════════════════════════
// RSI TABLE — RSI(14) puro em M1/M5/M15/H1/H4/D1 pra todos os ativos da
// lista, com o alvo de preco inverso (OS30/OB70 no H1). Reaproveita
// fetchMTFFor/fetchMicroFor/rsiCalc/rsiState que ja existem no Validador.
// ══════════════════════════════════════════════════════
let rsiTableOpen=false, rsiTableTimer=null, rsiTableData=[], rsiTableZone='all', rsiTableSearch='';
let rsiTableSortCol='score', rsiTableSortDir=-1;
const RSIT_TF_LBL={'1':'M1','5':'M5','15':'M15','60':'H1','240':'H4','D':'D1'};
const RSIT_TFS=['1','5','15','60','240','D'];

function toggleRsiTable(){
  rsiTableOpen=!rsiTableOpen;
  if(rsiTableOpen){
    if(validatorOpen)toggleValidatorPanel();
  }
  document.getElementById('rsi-table-view').classList.toggle('show',rsiTableOpen);
  painelExclusivo('rsi-table-view',rsiTableOpen);
  document.getElementById('btn-rsitable').classList.toggle('on',rsiTableOpen);
  if(rsiTableOpen){
    updateRsiTable();
    if(rsiTableTimer)clearInterval(rsiTableTimer);
    rsiTableTimer=setInterval(updateRsiTable,60000);
  }else if(rsiTableTimer){
    clearInterval(rsiTableTimer);rsiTableTimer=null;
  }
}

function getRsiClass(v){
  if(v==null)return'rsi-c-n';
  if(v<=P.os)return'rsi-c-os2';
  if(v<=P.os+10)return'rsi-c-os1';
  if(v>=P.ob)return'rsi-c-ob2';
  if(v>=P.ob-10)return'rsi-c-ob1';
  return'rsi-c-n';
}

async function updateRsiTable(){
  const body=document.getElementById('rsit-body');
  if(!body||!rsiTableOpen)return;
  const results=await Promise.all(ALL_SYMS.map(async sym=>{
    const mtfLocal=await fetchMTFFor(sym);
    const microLocal=await fetchMicroFor(sym,mtfLocal);
    const combined={...mtfLocal,...microLocal}; // microLocal ja reaproveita o '5' do mtfLocal
    const rsis={};
    RSIT_TFS.forEach(tf=>{
      const d=combined[tf];
      if(!d||d.length<20){rsis[tf]=null;return;}
      const r=rsiCalc(d,14);
      rsis[tf]=r[r.length-1];
    });
    const vals=RSIT_TFS.map(tf=>rsis[tf]).filter(v=>v!=null);
    const bullish=vals.filter(v=>v>55).length, bearish=vals.filter(v=>v<45).length;
    const score=Math.max(bullish,bearish);
    let rsiInv={osPrice:null,obPrice:null};
    if(mtfLocal['60']&&mtfLocal['60'].length>20){
      const st=rsiState(mtfLocal['60'],14);
      if(st)rsiInv=calcInverseRSITargets(st.ag,st.al,st.last);
    }
    return{sym,rsis,score,isBull:bullish>=bearish,rsiInv};
  }));
  if(!rsiTableOpen)return;
  rsiTableData=results;
  renderRsiTable();
  const upd=document.getElementById('rsit-updated');
  if(upd){const now=new Date();upd.textContent=`atualizado ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;}
}

function renderRsiTable(){
  const body=document.getElementById('rsit-body');
  if(!body)return;
  let rows=[...rsiTableData];
  rows.sort((a,b)=>{
    let va,vb;
    if(rsiTableSortCol==='sym'){va=a.sym;vb=b.sym;return va.localeCompare(vb)*rsiTableSortDir;}
    if(rsiTableSortCol==='score'){va=a.score*(a.isBull?1:-1);vb=b.score*(b.isBull?1:-1);}
    else{va=a.rsis[rsiTableSortCol]??50;vb=b.rsis[rsiTableSortCol]??50;}
    return (vb-va)*rsiTableSortDir*-1;
  });
  body.innerHTML=rows.map(r=>{
    const short=r.sym.replace('USDT','');
    const q=rsiTableSearch;
    const matchesSearch=!q||short.toLowerCase().includes(q);
    const hasOS=Object.values(r.rsis).some(v=>v!=null&&v<=P.os);
    const hasOB=Object.values(r.rsis).some(v=>v!=null&&v>=P.ob);
    const matchesZone=rsiTableZone==='all'||(rsiTableZone==='os'&&hasOS)||(rsiTableZone==='ob'&&hasOB);
    const hidden=!matchesSearch||!matchesZone;
    const tfCells=RSIT_TFS.map(tf=>{
      const v=r.rsis[tf];
      return `<td><span class="${getRsiClass(v)}">${v!=null?v.toFixed(1):'--'}</span></td>`;
    }).join('');
    const scoreArrow=r.isBull?'↑':'↓';
    const scoreCls=r.isBull?(r.score>=5?'rsi-c-ob2':'rsi-c-ob1'):(r.score>=5?'rsi-c-os2':'rsi-c-os1');
    return `<tr class="${hidden?'filtered-out':''}">
      <td onclick="changeSym('${r.sym}')">${short}</td>
      ${tfCells}
      <td><span class="${scoreCls}">${scoreArrow} ${r.score}/${RSIT_TFS.length}</span></td>
      <td style="color:var(--red);">${r.rsiInv.osPrice!=null?r.rsiInv.osPrice.toFixed(2):'--'}</td>
      <td style="color:var(--green);">${r.rsiInv.obPrice!=null?r.rsiInv.obPrice.toFixed(2):'--'}</td>
    </tr>`;
  }).join('');
}

function sortRsiTable(col){
  if(rsiTableSortCol===col)rsiTableSortDir*=-1;
  else{rsiTableSortCol=col;rsiTableSortDir=1;}
  renderRsiTable();
}
function setRsiZone(zone,btn){
  rsiTableZone=zone;
  document.querySelectorAll('.rsit-zf').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  renderRsiTable();
}
function filterRsiTable(q){
  rsiTableSearch=q.toLowerCase().trim();
  renderRsiTable();
}

// ══════════════════════════════════════════════════════
// RAINBOW TAB — o Rainbow Chart isolado, numa instancia de grafico propria,
// sem disputar espaco com EMAs/StochRSI/desenhos do grafico principal. Usa
// velas 1D de longo prazo (nao o timeframe corrente do chart principal),
// porque regressao log so faz sentido olhando anos, nao minutos.
// ══════════════════════════════════════════════════════
let rainbowOpen=false, rainbowChart=null, rainbowCandleS=null, rainbowBandS=null, rainbowRO=null;

function setupRainbowChart(){
  if(rainbowChart)return;
  const el=document.getElementById('rainbow-chart');
  const t=theme();
  rainbowChart=LightweightCharts.createChart(el,{
    width:el.clientWidth,height:el.clientHeight,
    layout:{background:{color:t.bg},textColor:t.text},
    grid:{vertLines:{color:t.grid},horzLines:{color:t.grid}},
    rightPriceScale:{borderColor:t.border,mode:LightweightCharts.PriceScaleMode.Logarithmic},
    timeScale:{borderColor:t.border,timeVisible:false},
    crosshair:{mode:LightweightCharts.CrosshairMode.Normal},
  });
  rainbowCandleS=rainbowChart.addCandlestickSeries({upColor:'#00A879',downColor:'#EC3F3F',borderUpColor:'#00A879',borderDownColor:'#EC3F3F',wickUpColor:'#00A879',wickDownColor:'#EC3F3F'});
  const bandCfg={priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false};
  rainbowBandS=RAINBOW_BANDS.map(b=>rainbowChart.addLineSeries({color:b.color,lineWidth:2,...bandCfg}));
  rainbowRO=new ResizeObserver(()=>rainbowChart.applyOptions({width:el.clientWidth,height:el.clientHeight}));
  rainbowRO.observe(el);
}

function toggleRainbowTab(){
  rainbowOpen=!rainbowOpen;
  if(rainbowOpen){
    if(validatorOpen)toggleValidatorPanel();
  }
  document.getElementById('rainbow-view').classList.toggle('show',rainbowOpen);
  painelExclusivo('rainbow-view',rainbowOpen);
  document.getElementById('btn-rainbow').classList.toggle('on',rainbowOpen);
  if(rainbowOpen){
    setupRainbowChart();
    updateRainbowTab();
  }
}

async function updateRainbowTab(){
  if(!rainbowOpen||!rainbowChart)return;
  document.getElementById('rainbow-sym').textContent=currentSym.replace('USDT','');
  const d=await fetchCandles(currentSym,'1d',1000); // maximo de historico diario que a Binance devolve por chamada
  if(!rainbowOpen||!d)return;
  rainbowCandleS.setData(d.map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close})));
  const bands=computeRainbowSeries(d);
  if(bands)bands.forEach((series,i)=>rainbowBandS[i].setData(series));
  rainbowChart.timeScale().fitContent();
  const upd=document.getElementById('rainbow-updated');
  if(upd){const now=new Date();upd.textContent=`atualizado ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;}
}

// ══════════════════════════════════════════════════════
// MACRO TAB — 6 leituras de longo prazo, semanal/mensal/diario. Painel de
// status (nao grafico). Cada indicador vem com um selo: CONFIRMADO (ja virou),
// AGUARDANDO (perto, ainda nao fechou), ou DISTANTE (nada acontecendo ainda).
// ══════════════════════════════════════════════════════
let macroOpen=false, macroTimer=null;

function toggleMacroTab(){
  macroOpen=!macroOpen;
  if(macroOpen){
    if(validatorOpen)toggleValidatorPanel();
  }
  document.getElementById('macro-view').classList.toggle('show',macroOpen);
  painelExclusivo('macro-view',macroOpen);
  document.getElementById('btn-macro').classList.toggle('on',macroOpen);
  if(macroOpen){
    updateMacroTab();
    if(macroTimer)clearInterval(macroTimer);
    macroTimer=setInterval(updateMacroTab,300000); // 5min — dado mensal/semanal nao muda rapido
  }else if(macroTimer){
    clearInterval(macroTimer);macroTimer=null;
  }
}

// Divergencia bullish simples: acha os 2 fundos mais recentes do preco numa
// janela, compara com o RSI no mesmo ponto — preco fez fundo mais baixo,
// RSI fez fundo mais alto = divergencia de alta.
function findBullishDivergence(closes,rsiArr,lookback=30){
  const n=closes.length;
  if(n<lookback+5)return{found:false};
  const win=closes.slice(-lookback);
  const rsiWin=rsiArr.slice(-lookback);
  // acha minimos locais (vale entre vizinhos maiores)
  const lows=[];
  for(let i=1;i<win.length-1;i++){
    if(win[i]<win[i-1]&&win[i]<win[i+1])lows.push({i,price:win[i],rsi:rsiWin[i]});
  }
  if(lows.length<2)return{found:false};
  const [a,b]=lows.slice(-2); // dois fundos mais recentes
  if(a.rsi==null||b.rsi==null)return{found:false};
  const found = b.price<a.price && b.rsi>a.rsi;
  return{found,priceLow1:a.price,priceLow2:b.price,rsiLow1:a.rsi,rsiLow2:b.rsi};
}

// Canal Gaussiano — aproximacao: media ponderada por kernel gaussiano como
// linha central, bandas = centro +/- multiplicador * desvio-padrao da janela.
// Nao e o filtro recursivo exato do script popular do TradingView.
function gaussianChannel(closes,period=20,mult=2){
  if(closes.length<period)return null;
  const kernel=[];
  const sigma=period/6;
  let ksum=0;
  for(let i=0;i<period;i++){
    const x=i-(period-1)/2;
    const w=Math.exp(-(x*x)/(2*sigma*sigma));
    kernel.push(w);ksum+=w;
  }
  const win=closes.slice(-period);
  let center=0;
  for(let i=0;i<period;i++)center+=win[i]*kernel[i]/ksum;
  const mean=win.reduce((a,b)=>a+b,0)/period;
  const variance=win.reduce((a,b)=>a+(b-mean)**2,0)/period;
  const std=Math.sqrt(variance);
  return{center, upper:center+mult*std, lower:center-mult*std, last:closes[closes.length-1]};
}

function macdCalc(closes,fast=12,slow=26,signalP=9){
  if(closes.length<slow+signalP)return null;
  const eFast=ema(closes,fast),eSlow=ema(closes,slow);
  const macdLine=closes.map((_,i)=>eFast[i]-eSlow[i]);
  const signal=ema(macdLine,signalP);
  const hist=macdLine.map((v,i)=>v-signal[i]);
  return{macd:macdLine[macdLine.length-1],signal:signal[signal.length-1],hist:hist,histLast:hist[hist.length-1],histPrev:hist[hist.length-2]};
}

function ppoCalc(closes,fast=12,slow=26,signalP=9){
  if(closes.length<slow+signalP)return null;
  const eFast=ema(closes,fast),eSlow=ema(closes,slow);
  const ppoLine=closes.map((_,i)=>eSlow[i]!==0?((eFast[i]-eSlow[i])/eSlow[i])*100:0);
  const signal=ema(ppoLine,signalP);
  const hist=ppoLine.map((v,i)=>v-signal[i]);
  return{ppo:ppoLine[ppoLine.length-1],signal:signal[signal.length-1],histLast:hist[hist.length-1],histPrev:hist[hist.length-2]};
}

function piCycle(closes){
  if(closes.length<472)return{bottom:null,top:null};
  const s471=sma(closes,471), s150=sma(closes,150), s111=sma(closes,111), s350=sma(closes,350);
  const n=closes.length-1;
  const s150half=s150.map(v=>v!=null?v*0.5:null);
  const s350x2=s350.map(v=>v!=null?v*2:null);
  const distBottom = (s471[n]!=null&&s150half[n]!=null) ? (s471[n]-s150half[n])/s471[n]*100 : null;
  const distTop = (s111[n]!=null&&s350x2[n]!=null) ? (s350x2[n]-s111[n])/s350x2[n]*100 : null;
  const bottomCross = crossu(s150half,s471,n)||crossu(s150half,s471,n-1)||crossu(s150half,s471,n-2);
  const topCross = cross(s111,s350x2,n)||cross(s111,s350x2,n-1)||cross(s111,s350x2,n-2);
  return{
    distBottom, distTop, bottomCross, topCross,
    v471:s471[n], v150half:s150half[n], v111:s111[n], v350x2:s350x2[n],
  };
}

function macroCard(title,status,bodyHtml,note){
  const lbl=status==='confirmado'?'CONFIRMADO':status==='aguardando'?'AGUARDANDO':'DISTANTE';
  return `<div class="macro-card status-${status}">
    <div class="macro-card-hd"><span class="macro-card-title">${title}</span><span class="macro-badge ${status}">${lbl}</span></div>
    <div class="macro-card-body">${bodyHtml}</div>
    ${note?`<div class="macro-card-note">${note}</div>`:''}
  </div>`;
}

async function updateMacroTab(){
  const container=document.getElementById('macro-cards');
  if(!container||!macroOpen)return;
  document.getElementById('macro-sym').textContent=currentSym.replace('USDT','');
  const sym=currentSym;

  const [weekly,monthly,daily]=await Promise.all([
    fetchCandles(sym,'1w',300),
    fetchCandles(sym,'1M',300),
    fetchCandles(sym,'1d',1000),
  ]);
  if(!macroOpen||currentSym!==sym)return;

  const cards=[];

  // 1) RSI Semanal + divergencia bullish
  if(weekly&&weekly.length>30){
    const wCloses=weekly.map(c=>c.close);
    const wRsi=rsiCalc(wCloses,14);
    const lastRsi=wRsi[wRsi.length-1];
    const div=findBullishDivergence(wCloses,wRsi,30);
    const zone = lastRsi<=30?'sobrevenda':lastRsi>=70?'sobrecompra':'neutro';
    const status = (div.found&&lastRsi<50) ? 'aguardando' : (lastRsi>50?'confirmado':'distante');
    cards.push(macroCard('RSI Semanal (14)', status,
      `RSI atual: <b>${lastRsi.toFixed(1)}</b> (${zone})<br>
       Divergencia bullish: <b>${div.found?'detectada':'nao detectada'}</b>
       ${div.found?`<br>Fundo 1: preco ${div.priceLow1.toFixed(2)} / RSI ${div.rsiLow1.toFixed(1)}<br>Fundo 2: preco ${div.priceLow2.toFixed(2)} / RSI ${div.rsiLow2.toFixed(1)}`:''}`,
      `Pra alta mais explosiva, precisa romper 50 pra cima. Falta ${Math.max(0,(50-lastRsi)).toFixed(1)} pontos.`
    ));
  }

  // 2) Canal Gaussiano Mensal
  if(monthly&&monthly.length>=20){
    const mCloses=monthly.map(c=>c.close);
    const gc=gaussianChannel(mCloses,20,2);
    if(gc){
      const inLower = gc.last<=gc.lower*1.02; // dentro ou bem perto da banda inferior
      const status = inLower?'confirmado':(gc.last<gc.center?'aguardando':'distante');
      cards.push(macroCard('Canal Gaussiano Mensal', status,
        `Preco atual: <b>${gc.last.toFixed(2)}</b><br>
         Banda inferior: <b style="color:var(--red);">${gc.lower.toFixed(2)}</b><br>
         Centro: ${gc.center.toFixed(2)} · Banda superior: ${gc.upper.toFixed(2)}`,
        inLower?'Preco dentro/perto da banda inferior — zona historica de excelente posicao de longo prazo.':'Ainda fora da banda inferior.'
      ));
    }
  }

  // 3) StochRSI mensal (referido como "2 meses" — aguardando fechamento do mes)
  if(monthly&&monthly.length>30){
    const mCloses=monthly.map(c=>c.close);
    const mRsi=rsiCalc(mCloses,14);
    const mStoch=stochCalc(mRsi,14);
    const k=sma(mStoch,3),d=sma(k,3);
    const kLast=k[k.length-1],dLast=d[d.length-1],kPrev=k[k.length-2],dPrev=d[d.length-2];
    const willCross = kLast!=null&&dLast!=null&&kPrev!=null&&dPrev!=null && kLast>dLast && (dLast-kLast)>(dPrev-kPrev)*0.3 && kLast<30;
    const justCrossed = kPrev<=dPrev && kLast>dLast;
    const status = justCrossed?'confirmado':(willCross?'aguardando':'distante');
    cards.push(macroCard('StochRSI Mensal', status,
      `K: <b>${kLast!=null?kLast.toFixed(1):'--'}</b> · D: <b>${dLast!=null?dLast.toFixed(1):'--'}</b><br>
       ${justCrossed?'Cruzamento de baixo pra cima ja aconteceu.':'Ainda sem cruzamento confirmado.'}`,
      'Cruzamento de baixo pra cima costuma marcar fundos macro — so confirma de verdade no fechamento do mes.'
    ));
  }

  // 4) MACD Mensal
  if(monthly&&monthly.length>40){
    const mCloses=monthly.map(c=>c.close);
    const macd=macdCalc(mCloses);
    if(macd){
      const weakening = macd.histLast>macd.histPrev; // barra ficando "mais clara" (menos negativa)
      const status = macd.histLast>0?'confirmado':(weakening?'aguardando':'distante');
      cards.push(macroCard('MACD Mensal', status,
        `Histograma: <b>${macd.histLast.toFixed(2)}</b> (anterior: ${macd.histPrev.toFixed(2)})<br>
         MACD: ${macd.macd.toFixed(2)} · Sinal: ${macd.signal.toFixed(2)}`,
        weakening?'Barras perdendo forca vendedora — precede virada pra barra de alta.':'Ainda sem perda de forca vendedora visivel.'
      ));
    }
  }

  // 5) PPO Mensal
  if(monthly&&monthly.length>40){
    const mCloses=monthly.map(c=>c.close);
    const ppo=ppoCalc(mCloses);
    if(ppo){
      const weakening = ppo.histLast>ppo.histPrev;
      const status = ppo.histLast>0?'confirmado':(weakening?'aguardando':'distante');
      cards.push(macroCard('PPO Mensal', status,
        `Histograma: <b>${ppo.histLast.toFixed(2)}</b> (anterior: ${ppo.histPrev.toFixed(2)})<br>
         PPO: ${ppo.ppo.toFixed(2)}% · Sinal: ${ppo.signal.toFixed(2)}%`,
        weakening?'Perda de forca vendedora — aguardando virada pra sinalizar fundo.':'Ainda sem perda de forca vendedora visivel.'
      ));
    }
  }

  // 6) Pi Cycle Bottom / Top (diario, SMA 471/150 e 111/350)
  if(daily&&daily.length>200){
    const dCloses=daily.map(c=>c.close);
    const pc=piCycle(dCloses);
    if(pc.v471!=null){
      const status=pc.bottomCross?'confirmado':(pc.distBottom!=null&&Math.abs(pc.distBottom)<3?'aguardando':'distante');
      cards.push(macroCard('Pi Cycle Bottom', status,
        `SMA 471: <b>${pc.v471.toFixed(2)}</b> · SMA150 x0.5: <b>${pc.v150half.toFixed(2)}</b><br>
         Distancia entre as medias: ${pc.distBottom!=null?pc.distBottom.toFixed(2)+'%':'--'}`,
        'Costuma atrasar um pouco em relacao ao fundo real do preco — e uma confirmacao, nao um antecipador.'
      ));
    }else{
      cards.push(macroCard('Pi Cycle Bottom','distante','Historico diario insuficiente pra SMA471 (precisa de ~471 velas).',null));
    }
    if(pc.v111!=null){
      const status=pc.topCross?'confirmado':'distante';
      cards.push(macroCard('Pi Cycle Top', status,
        `SMA 111: <b>${pc.v111.toFixed(2)}</b> · SMA350 x2: <b>${pc.v350x2.toFixed(2)}</b><br>
         Distancia entre as medias: ${pc.distTop!=null?pc.distTop.toFixed(2)+'%':'--'}`,
        pc.topCross?'Cruzamento de topo ja ocorreu neste calculo.':'Sem cruzamento de topo neste calculo ate agora.'
      ));
    }
  }

  container.innerHTML = cards.length ? cards.join('') : '<div style="color:var(--t3);font-size:11px;padding:20px;text-align:center;">Historico insuficiente pra esse ativo nos timeframes semanal/mensal.</div>';
  const upd=document.getElementById('macro-updated');
  if(upd){const now=new Date();upd.textContent=`atualizado ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;}
}

// ══════════════════════════════════════════════════════
// ARQUIVO DE ESTUDO — angulo das EMAs 8/16 por timeframe (M1 a D1), com
// botao pra "arquivar" um snapshot do momento. Cada observacao arquivada
// fica salva no navegador (localStorage), pra voce construir uma base de
// estudo ao longo do tempo — exatamente o padrao que voce estava fazendo
// na mao no TradingView, so que registrado de forma consultavel depois.
// ══════════════════════════════════════════════════════
let studyOpen=false, studyTimer=null;
const STUDY_TFS = { '1':'1m', '3':'3m', '5':'5m', '15':'15m', '60':'1h', '240':'4h', 'D':'1d' };
const STUDY_KEYS = ['1','3','5','15','60','240','D'];
const STUDY_LBL = {'1':'M1','3':'M3','5':'M5','15':'M15','60':'H1','240':'H4','D':'D1'};
const STUDY_ARCHIVE_KEY = 'atlas_study_archive';

// Angulo normalizado pela volatilidade recente — comparavel entre
// timeframes diferentes (o mesmo metodo que calibramos no mobile: inclinacao
// leve ~5-10 graus, inclinacao real ~45 graus, nunca estoura 90).
function computeEmaAngle(closes, period, lookback=5){
  if(!closes||closes.length<period+lookback+5)return null;
  const arr=ema(closes,period);
  const n=arr.length-1;
  if(arr[n]==null||arr[n-lookback]==null)return null;
  const recent=closes.slice(-20);
  const mean=recent.reduce((a,b)=>a+b,0)/recent.length;
  const std=Math.sqrt(recent.reduce((a,b)=>a+(b-mean)**2,0)/recent.length)||1;
  const delta=arr[n]-arr[n-lookback];
  const x=(delta/std)*0.15; // recalibrado: 2x era exagerado demais numa serie sem ruido real de mercado — testado pra dar ~5-10° numa inclinacao leve
  return Math.atan(x)*180/Math.PI;
}

function toggleStudyArchive(){
  studyOpen=!studyOpen;
  if(studyOpen){
    if(validatorOpen)toggleValidatorPanel();
  }
  document.getElementById('study-view').classList.toggle('show',studyOpen);
  painelExclusivo('study-view',studyOpen);
  document.getElementById('btn-estudo').classList.toggle('on',studyOpen);
  if(studyOpen){
    updateStudyArchive();
    renderStudyList();
    if(studyTimer)clearInterval(studyTimer);
    studyTimer=setInterval(updateStudyArchive,60000);
  }else if(studyTimer){
    clearInterval(studyTimer);studyTimer=null;
  }
}

// ══════════════════════════════════════════════════════
// BACKTEST — motor de simulacao, adaptado do conceito do LuxAlgo Universal
// Signal Backtester. Roda o sinal contra o historico real de velas, com
// SL sempre avaliado ANTES do TP (conservador), 3 alvos parciais, e as
// mesmas metricas: Win Rate, Profit Factor, Sharpe, Recovery Factor,
// Max Stagnation, performance por hora do dia e por dia da semana.
// PnL em % (nao em ticks) — mais facil de comparar entre ativos diferentes.
// ══════════════════════════════════════════════════════
let backtestOpen=false;

function toggleBacktestTab(){
  backtestOpen=!backtestOpen;
  if(backtestOpen){
    if(validatorOpen)toggleValidatorPanel();
  }
  document.getElementById('backtest-view').classList.toggle('show',backtestOpen);
  painelExclusivo('backtest-view',backtestOpen);
  document.getElementById('btn-backtest').classList.toggle('on',backtestOpen);
  if(backtestOpen)document.getElementById('backtest-sym').textContent=currentSym.replace('USDT','');
}

function computeMASeries(closes,len,isEma){
  return isEma ? ema(closes,len) : sma(closes,len);
}

// Motor puro — recebe candles + config, devolve o resultado completo.
// Isolado de qualquer coisa de UI, pra dar pra testar sozinho.
function runBacktest(candlesArr,cfg){
  const n=candlesArr.length;
  const closes=candlesArr.map(c=>c.close), highs=candlesArr.map(c=>c.high), lows=candlesArr.map(c=>c.low);
  const fast=computeMASeries(closes,cfg.fastLen,cfg.isEma);
  // slowIsEma permite par misto (EMA 8 x MA 89); sem ele, as duas pernas
  // seguem o mesmo tipo, como era antes
  const slow=computeMASeries(closes,cfg.slowLen,
    cfg.slowIsEma===undefined?cfg.isEma:cfg.slowIsEma);
  const atr=atrCalc(highs,lows,closes,cfg.atrLen);
  const atrSma=sma(atr.map(v=>v==null?0:v),cfg.atrFilterLen);

  const trades=[];
  let active=null; // {dir, entryPx, entryIdx, entryTime, qtyLeft, pnlPct, tp:[{px,hit,qty}], sl:[{px,hit}]}

  const minBar=Math.max(cfg.slowLen,cfg.atrFilterLen,cfg.atrLen)+2;

  for(let i=minBar;i<n;i++){
    if(fast[i]==null||slow[i]==null||fast[i-1]==null||slow[i-1]==null)continue;
    const crossUp = fast[i]>slow[i] && fast[i-1]<=slow[i-1];
    const crossDown = fast[i]<slow[i] && fast[i-1]>=slow[i-1];
    const atrOk = cfg.useAtrFilter ? (atr[i]!=null && atrSma[i]!=null && atr[i]>atrSma[i]) : true;
    const longCond = crossUp && atrOk && (cfg.direction!=='short');
    const shortCond = crossDown && atrOk && (cfg.direction!=='long');

    // Gerencia trade ativo primeiro
    if(active){
      const h=highs[i], l=lows[i];
      let closedNow=false;

      // SL sempre primeiro (conservador) — testa do mais apertado ao mais largo
      for(const s of active.sl){
        if(!s.hit && ((active.dir===1&&l<=s.px)||(active.dir===-1&&h>=s.px))){
          s.hit=true;
          const pnl=((s.px-active.entryPx)/active.entryPx)*100*active.dir*active.qtyLeft;
          active.pnlPct+=pnl; active.qtyLeft=0; closedNow=true;
          break;
        }
      }
      // TPs (saida parcial) — so avalia se nao fechou no SL
      if(!closedNow){
        const activeTpCount=active.tp.filter(t=>t.use).length||1;
        const tpQty=1/activeTpCount;
        active.tp.forEach(t=>{
          if(t.use&&!t.hit&&((active.dir===1&&h>=t.px)||(active.dir===-1&&l<=t.px))){
            t.hit=true; active.tpHits.push(t.label);
            const pnl=((t.px-active.entryPx)/active.entryPx)*100*active.dir*tpQty;
            active.pnlPct+=pnl; active.qtyLeft-=tpQty;
          }
        });
        if(active.qtyLeft<=0.001)closedNow=true;
      }
      // Reversao pelo sinal oposto
      if(!closedNow && ((active.dir===1&&shortCond)||(active.dir===-1&&longCond))){
        const pnl=((closes[i]-active.entryPx)/active.entryPx)*100*active.dir*active.qtyLeft;
        active.pnlPct+=pnl; active.qtyLeft=0; closedNow=true;
      }
      if(closedNow){
        trades.push({
          dir:active.dir, entryTime:active.entryTime, exitTime:candlesArr[i].time,
          pnlPct:active.pnlPct, tpHits:active.tpHits, win:active.pnlPct>0,
        });
        active=null;
      }
    }

    // Abre trade novo (so se nao tem uma ativa)
    if(!active && (longCond||shortCond)){
      const dir = longCond?1:-1;
      const entryPx=closes[i];
      const distUnit=atr[i]||(entryPx*0.01);
      const mk=(mult,use)=>({px:entryPx+dir*mult*distUnit,hit:false,use});
      active={
        dir, entryPx, entryIdx:i, entryTime:candlesArr[i].time, qtyLeft:1, pnlPct:0, tpHits:[],
        tp:[{...mk(cfg.tp1,cfg.useTp1),label:'TP1'},{...mk(cfg.tp2,cfg.useTp2),label:'TP2'},{...mk(cfg.tp3,cfg.useTp3),label:'TP3'}],
        sl:[{px:entryPx-dir*cfg.sl1*distUnit,hit:false},{px:entryPx-dir*cfg.sl2*distUnit,hit:false},{px:entryPx-dir*cfg.sl3*distUnit,hit:false}],
      };
    }
  }
  // Fecha trade que ainda estiver aberta no fim do historico, no ultimo preco
  if(active){
    const lastPx=closes[n-1];
    const pnl=((lastPx-active.entryPx)/active.entryPx)*100*active.dir*active.qtyLeft;
    active.pnlPct+=pnl;
    trades.push({dir:active.dir, entryTime:active.entryTime, exitTime:candlesArr[n-1].time, pnlPct:active.pnlPct, tpHits:active.tpHits, win:active.pnlPct>0});
  }

  return computeBacktestStats(trades);
}

// ══════════════════════════════════════════════════════
// FLUXO AGRESSOR — bolhas de notional e medidor de forca
// ══════════════════════════════════════════════════════
// O WebSocket ja entregava cada negocio executado (@aggTrade) e o codigo lia
// so o preco, jogando fora a quantidade e o lado. Com esses dois campos saem
// duas coisas que faltavam:
//
//   as bolhas   — cada negocio grande no ponto exato de preco e tempo
//   a forca     — quanto do volume veio de comprador agredindo contra vendedor
//
// Vale registrar a diferenca pro indicador do TradingView: la o Pine precisa
// aproximar isso com request.security_lower_tf, olhando velas de um timeframe
// menor, porque indicador nao recebe tick. Aqui sao os negocios de verdade.
//
// Em d.m a Binance diz "o comprador era o maker?". Se era, quem agrediu o
// livro foi o VENDEDOR. Entao agressor comprador = !d.m — invertido do que a
// leitura ingenua do campo sugere.

const FLUXO_MAX_NEGOCIOS = 400;     // teto do que fica em memoria
// Sem teto de quantidade e sem descarte por sobreposicao: os dois dependiam do
// layout, entao mudar o zoom mudava quais bolhas sobreviviam e a bolha parecia
// trocar de lugar. Quem controla a densidade agora e so o corte (percentil 95),
// que e do dado e nao da tela.
let fluxoNegocios = [];             // {t, preco, notional, comprador}
let fluxoPorVela = {};              // time da vela -> {compra, venda}
let bolhasLigadas = true;
let fluxoVersao = 0;                // sobe a cada mudanca no fluxo por vela
let bolhasCache = null;             // {chave, corte, maior, alvos}
let estatFluxo = null;              // {versao, corte, maior} — corte global

// Minimo pra um negocio virar bolha. Nao pode ser fixo: 500 USD e enorme numa
// altcoin e invisivel no BTC. Uso a mediana do notional recente como base.
let fluxoCorte = 0;
function recalculaCorteFluxo(){
  if(fluxoNegocios.length < 30) return;
  const v = fluxoNegocios.map(n=>n.notional).sort((a,b)=>a-b);
  const mediana = v[Math.floor(v.length/2)];
  // 8x a mediana: pega o negocio que destoa, nao o fluxo normal
  fluxoCorte = mediana * 8;
}

// As bolhas nasciam so do que chegava ao vivo. Num grafico de 15m isso quer
// dizer meia hora de tela aberta antes da PRIMEIRA bolha poder aparecer (o
// corte precisa de 4 lados de vela com fluxo, e todo negocio da vela em curso
// cai num unico horario). Em 1h ou 4h, nunca. Agora o historico ja vem com o
// lado agressor de cada vela e as bolhas aparecem no primeiro quadro.
function semeiaFluxoDoHistorico(){
  if(!candles || !candles.length) return;
  let achou = 0;
  candles.forEach(c => {
    if(c.compra == null && c.venda == null) return;
    if((c.compra||0) <= 0 && (c.venda||0) <= 0) return;
    fluxoPorVela[c.time] = {compra:c.compra||0, venda:c.venda||0, oficial:true};
    achou++;
  });
  if(achou) fluxoVersao++;
  // So a Binance publica o lado agressor por vela (indices 7 e 10 do kline).
  // Bybit, OKX, Kraken e Coinbase nao — e o fallback entra justamente quando a
  // Binance esta fora. Sem aviso, a pessoa ficava olhando um grafico sem bolha
  // sem saber por que.
  if(!achou && candles.length > 50 && typeof lastDataSource!=="undefined"
     && lastDataSource && lastDataSource!=="binance" && !avisouFluxoSemFonte){
    avisouFluxoSemFonte = true;
    if(typeof showInfoToast==="function")
      showInfoToast("FLUXO", "sem bolhas: a "+lastDataSource+" nao publica o lado agressor por vela");
  }
  return achou;
}
let avisouFluxoSemFonte = false;
window.semeiaFluxoDoHistorico = semeiaFluxoDoHistorico;

function registraNegocio(preco, qtd, comprador, ts, velaTime){
  const notional = preco * qtd;
  if(!isFinite(notional) || notional <= 0) return;
  fluxoNegocios.push({t: ts, preco, notional, comprador});
  if(fluxoNegocios.length > FLUXO_MAX_NEGOCIOS) fluxoNegocios.shift();
  if(fluxoNegocios.length % 25 === 0) recalculaCorteFluxo();

  if(velaTime != null){
    const v = fluxoPorVela[velaTime] || (fluxoPorVela[velaTime] = {compra:0, venda:0});
    // vela com numero oficial da Binance nao se soma no braco: o kline manda o
    // acumulado da vela inteira, somar o negocio avulso por cima contaria duas
    // vezes. Isto aqui e o caminho de quem caiu numa fonte sem esse corte.
    if(v.oficial) return;
    if(comprador) v.compra += notional; else v.venda += notional;
    fluxoVersao++;
    // guarda so as ultimas 200 velas, senao isto cresce sem parar
    const chaves = Object.keys(fluxoPorVela);
    if(chaves.length > 200){
      chaves.sort((a,b)=>a-b).slice(0, chaves.length-200).forEach(k=>{ delete fluxoPorVela[k]; });
    }
  }
}
window.registraNegocio = registraNegocio;


function fmtNotional(v){
  const a = Math.abs(v);
  if(a >= 1e9) return (v/1e9).toFixed(2)+"B";
  if(a >= 1e6) return (v/1e6).toFixed(2)+"M";
  if(a >= 1e3) return (v/1e3).toFixed(1)+"k";
  return v.toFixed(0);
}

// Desenhadas na MAXIMA e na MINIMA da vela, nao no preco do negocio: dentro do
// corpo do candle a bolha fica enterrada e nao da pra ver. Na ponta do pavio
// ela sobra na tela e ainda diz onde a agressao aconteceu — compra empurrando
// pra maxima, venda pressionando a minima.
//
// Uma bolha por vela e por lado, com o volume somado. Antes era uma por
// negocio, o que empilhava dezenas no mesmo ponto.
// O CORTE E DO HISTORICO INTEIRO, NAO DA JANELA VISIVEL. Cheguei a calcular
// pela janela e estava errado: o corte mudava a cada zoom, entao aproximar da
// vela trocava as bolhas e os numeros na tela. Volume de vela e um fato — o
// que a bolha diz nao pode depender de quanto voce aproximou. Com o corte
// fixo, aproximar so espalha as mesmas bolhas, e um trecho calmo fica sem
// nenhuma, que e a informacao correta: ali nada destoou.
//
// Percentil 95, nao a mediana: a distribuicao de volume tem cauda longa e a
// mediana deixava passar quase um terco das velas. Como nao ha mais teto de
// quantidade nem descarte por sobreposicao, e o corte sozinho que decide a
// raridade — 5% dos lados de vela, uma a cada vinte.
function estatisticaFluxo(){
  if(estatFluxo && estatFluxo.versao === fluxoVersao) return estatFluxo;
  const totais = [];
  Object.keys(fluxoPorVela).forEach(k => {
    const v = fluxoPorVela[k];
    const t = (v.compra||0) + (v.venda||0);
    if(t > 0) totais.push(t);
  });
  if(totais.length < 6){ estatFluxo = null; return null; }
  totais.sort((a,b) => a-b);
  estatFluxo = {versao: fluxoVersao,
    // o corte nao seleciona mais nada — toda vela tem bolha. Ele so marca a
    // vela que destoa, que ganha borda mais forte
    corte: totais[Math.min(totais.length-1, Math.floor(totais.length*0.90))],
    maior: totais[totais.length-1]};
  return estatFluxo;
}

// A lista NAO olha a janela visivel. Vela com bolha e vela com bolha, ponto —
// o recorte de tela e do desenhaBolhas, que descarta o que caiu fora do
// canvas. Enquanto a janela entrava aqui, o zoom mudava quem sobrevivia e a
// bolha parecia pular de lugar.
// UMA BOLHA POR VELA. Nao ha mais selecao: toda vela com fluxo tem a sua, na
// ordem do grafico, acompanhando o candle. O que a bolha diz agora e o volume
// em dolar da vela; a cor diz quem mandou nela — verde quando quem agrediu foi
// comprador, vermelho quando foi vendedor —, e por isso ela se apoia na maxima
// ou na minima.
//
// Antes eram ate duas por vela (um lado de cada) e so nas velas que passavam
// do corte: quem estava olhando via bolha em umas velas sim, outras nao, sem o
// desenho continuo que acompanha o grafico.
function montaAlvosBolha(){
  const est = estatisticaFluxo();
  if(!est) return null;

  const alvos = [];
  candles.forEach(vela => {
    const v = fluxoPorVela[vela.time];
    if(!v) return;
    const compra = v.compra||0, venda = v.venda||0;
    const total = compra + venda;
    if(total <= 0) return;
    alvos.push({vela, notional:total, compra, venda,
      comprador: compra >= venda,
      // quem domina por pouco nao e dominio; abaixo disso a vela fica neutra
      equilibrio: total > 0 && Math.abs(compra-venda)/total < 0.10,
      destaque: total >= est.corte});
  });
  // na ordem do grafico: o desenho segue a linha do tempo, e quando duas se
  // tocam quem esta a direita (mais recente) fica por cima
  return {corte:est.corte, maior:est.maior, alvos};
}

// O DESENHO EM SI, sem saber de qual grafico veio. O principal e os quatro
// mini-graficos do Multi chamam esta mesma funcao — antes o desenho morava
// dentro do desenhaBolhas e por isso o Multi ficou sem bolha nenhuma.
//
// Recebe as funcoes de coordenada porque cada grafico tem a sua: no principal
// sao t2x/p2y, no mini sao os metodos do proprio chart.
function pintaBolhas(ctx, larguraCss, alvos, corte, velas, t2xFn, p2yFn){
  if(!ctx || !alvos || !alvos.length || !velas || !velas.length) return 0;

  // Com uma bolha por vela, o espaco entre velas e o teto natural do raio:
  // metade dele e duas vizinhas encostam sem se cobrir. E o mesmo criterio que
  // o grafico usa pra largura do candle, entao a bolha acompanha o zoom junto
  // com ele em vez de virar mancha.
  let espacamento = 12;
  try{
    const n = velas.length;
    if(n > 1){
      const x1 = t2xFn(velas[n-1].time), x0 = t2xFn(velas[n-2].time);
      if(x1 != null && x0 != null && x1 > x0) espacamento = x1 - x0;
    }
  }catch(e){}
  const raioTeto = Math.max(1.6, Math.min(26, espacamento * 0.56));

  // Uma bolha por vela sao mil circulos com o grafico todo na tela, e mil
  // pares fill+stroke custavam 4,7ms por quadro — mais de um quarto do
  // orcamento de 60fps, e num celular bem mais. Agrupo por estilo e desenho
  // cada grupo numa path so: seis fills em vez de mil. O moveTo antes de cada
  // arc e obrigatorio, senao o canvas liga um circulo no outro com uma reta.
  const grupos = new Map();
  const rotulos = [];
  let n = 0;

  for(const a of alvos){
    const x = t2xFn(a.vela.time);
    if(x == null || x < -40 || x > larguraCss + 40) continue;
    const y = p2yFn(a.comprador ? a.vela.high : a.vela.low);
    if(y == null) continue;

    // Area proporcional ao volume (dai a raiz): dobrar o volume dobra a
    // mancha, nao o raio.
    //
    // A referencia de tamanho cheio e o percentil 90, NAO o maior do
    // historico: uma unica vela de pico esmagava as outras mil pra 3px, e o
    // desenho todo virava uma fileira de pontinhos. Contra o percentil, a vela
    // grande ocupa o espaco inteiro e a mediana fica em torno de 70% dele.
    //
    // E o piso de 35%: vela fraca encolhe, mas continua visivel na fila — a
    // bolha e por vela, entao sumir uma quebra a sequencia que voce acompanha.
    const f = Math.sqrt(Math.min(1, a.notional / (corte || a.notional)));
    const raio = Math.max(1.6, raioTeto * (0.35 + 0.65*f));

    const cor = a.equilibrio ? "150,150,158" : (a.comprador ? "0,200,83" : "255,59,48");
    // ANCORADA NA MAXIMA/MINIMA, centro em cima do ponto. Antes o centro
    // ficava a "raio + 2" de distancia do pavio — e como o raio cresce com o
    // zoom, o centro viajava: aproximar afastava a bolha da vela, afastar
    // colava. Agora ela cresce e encolhe em torno do proprio ponto, que nao
    // sai do lugar em zoom nenhum.
    const yy = y;

    // a vela que destoa ganha borda mais forte — o corte deixou de escolher
    // quem aparece e passou a so marcar quem se destaca
    const chave = cor + "|" + (a.destaque ? 1 : 0);
    let g = grupos.get(chave);
    if(!g){ g = {cor, destaque:a.destaque, itens:[]}; grupos.set(chave, g); }
    g.itens.push({x, y:yy, r:raio});
    n++;

    // O numero so entra quando cabe dentro. Com uma bolha por vela, isso
    // acontece de uns 30 candles na tela pra baixo — mais afastado que isso a
    // bolha continua no lugar, so sem rotulo, porque dois numeros vizinhos se
    // sobrepondo nao se leem de qualquer jeito.
    if(raio >= 10){
      // rotulo curto: com uma bolha por vela a largura disponivel e metade do
      // espaco entre velas, e "24.57M" nunca caberia. "25M" cabe.
      const txt = fmtBolhaCurto(a.notional);
      const fonte = raio >= 19 ? 10 : raio >= 14 ? 9 : 8;
      ctx.font = fonte+"px ui-monospace, monospace";
      // 2,1x o raio em vez de 2x: deixo o texto passar de raspao da borda, que
      // e o que faz o numero caber uns cinco candles antes
      if(ctx.measureText(txt).width <= raio * 2.1) rotulos.push({txt, x, y:yy, fonte});
    }
  }

  grupos.forEach(g => {
    ctx.beginPath();
    g.itens.forEach(i => { ctx.moveTo(i.x + i.r, i.y); ctx.arc(i.x, i.y, i.r, 0, Math.PI*2); });
    // Alpha alto porque agora a bolha fica ATRAS do candle: ela nao esconde
    // nada, entao nao ha razao pra ser timida. Quando dividia o canvas de
    // desenho, na frente, precisava ser translucida pra vela aparecer por
    // baixo — e era isso que a deixava lavada.
    ctx.fillStyle = "rgba("+g.cor+","+(g.destaque ? 0.68 : 0.42)+")";
    ctx.fill();
    ctx.lineWidth = g.destaque ? 1.5 : 1;
    ctx.strokeStyle = "rgba("+g.cor+","+(g.destaque ? 1 : 0.7)+")";
    ctx.stroke();
  });

  if(rotulos.length){
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    rotulos.forEach(r => {
      ctx.font = r.fonte+"px ui-monospace, monospace";
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(r.txt, r.x, r.y);
      ctx.fillStyle = "#fff";
      ctx.fillText(r.txt, r.x, r.y);
    });
    ctx.lineJoin = "miter";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  return n;
}

// Monta os alvos direto de uma lista de velas que ja carrega compra/venda —
// e o caminho dos mini-graficos, que nao tem fluxoPorVela proprio.
function alvosDeVelas(velas){
  const totais = [];
  velas.forEach(c => {
    const t = (c.compra||0) + (c.venda||0);
    if(t > 0) totais.push(t);
  });
  if(totais.length < 6) return null;
  totais.sort((a,b) => a-b);
  const corte = totais[Math.min(totais.length-1, Math.floor(totais.length*0.90))];
  const alvos = [];
  velas.forEach(vela => {
    const compra = vela.compra||0, venda = vela.venda||0;
    const total = compra + venda;
    if(total <= 0) return;
    alvos.push({vela, notional:total, compra, venda,
      comprador: compra >= venda,
      equilibrio: Math.abs(compra-venda)/total < 0.10,
      destaque: total >= corte});
  });
  return {corte, alvos};
}

function desenhaBolhas(){
  if(!bCtx || !bCanvas || !chart || !candleSeries) return;
  // canvas proprio: limpo aqui, porque o redrawDrawings limpa o de desenho e
  // este nao passa mais por la
  const dpr = window.devicePixelRatio || 1;
  bCtx.save(); bCtx.setTransform(1,0,0,1,0,0);
  bCtx.clearRect(0,0,bCanvas.width,bCanvas.height); bCtx.restore();
  if(!bolhasLigadas) return;
  if(!candles || !candles.length) return;

  // clientWidth, nao width: o buffer e multiplicado pelo dpr e o t2x devolve
  // pixel de CSS — comparar com o buffer nunca cortava nada numa tela retina
  const larguraTela = (bCanvas && bCanvas.clientWidth) || 4000;

  // O BRILHO VEM PRIMEIRO, e antes de qualquer saida por falta de fluxo: o
  // marco de volume sai do volume da propria vela, entao ele existe mesmo numa
  // fonte que nao publica o lado agressor — e ali as bolhas nem aparecem.
  try{ pintaHalosMarcos(bCtx, larguraTela, candles, marcosVolume, marcosFortes, t2x, p2y); }catch(e){}

  // Cache so pela versao do fluxo: a lista e a mesma em qualquer zoom, o que
  // muda e quem esta na tela — e isso o t2x resolve por vela.
  if(!bolhasCache || bolhasCache.versao !== fluxoVersao){
    bolhasCache = montaAlvosBolha();
    if(bolhasCache) bolhasCache.versao = fluxoVersao;
  }
  if(!bolhasCache || !bolhasCache.alvos.length) return;

  pintaBolhas(bCtx, larguraTela, bolhasCache.alvos, bolhasCache.corte, candles, t2x, p2y);
}


// Mais curto ainda, pro rotulo de dentro da bolha: sem casa decimal acima de
// 10 unidades. "250M" no lugar de "249.7M" — a casa perdida nao muda decisao
// nenhuma, e e ela que decide se o numero aparece ou nao.
function fmtBolhaCurto(v){
  const a = Math.abs(v);
  if(a >= 1e9) return (v/1e9 >= 10 ? Math.round(v/1e9) : (v/1e9).toFixed(1))+"B";
  if(a >= 1e6) return (v/1e6 >= 10 ? Math.round(v/1e6) : (v/1e6).toFixed(1))+"M";
  if(a >= 1e3) return Math.round(v/1e3)+"k";
  return Math.round(v)+"";
}

window.desenhaBolhas = desenhaBolhas;

function toggleBolhas(){
  bolhasLigadas = !bolhasLigadas;
  // os quatro do Multi obedecem ao mesmo botao
  try{ Object.keys(multiCharts||{}).forEach(s=>desenhaBolhasMulti(s)); }catch(e){}
  const b = document.getElementById('btn-bolhas');
  if(b) b.classList.toggle('on', bolhasLigadas);
  if(typeof redrawDrawings === 'function') redrawDrawings();
  if(typeof showInfoToast === 'function'){
    showInfoToast("FLUXO", bolhasLigadas ? "bolhas ligadas" : "bolhas desligadas");
  }
}
window.toggleBolhas = toggleBolhas;

// ── A FORCA ──────────────────────────────────────────────────────────────
// Delta = notional agressor comprador menos vendedor. O RSI e o StochRSI
// medem o PRECO; isto mede quem esta pagando pra entrar, que e outra coisa.
// Preco subindo com delta negativo e alta sem comprador convicto.
function forcaDoFluxo(nVelas){
  const chaves = Object.keys(fluxoPorVela).map(Number).sort((a,b)=>a-b);
  if(!chaves.length) return null;
  const usadas = chaves.slice(-(nVelas || 20));
  let compra = 0, venda = 0;
  usadas.forEach(k => { compra += fluxoPorVela[k].compra; venda += fluxoPorVela[k].venda; });
  const total = compra + venda;
  const atualK = chaves[chaves.length-1];
  const atual = fluxoPorVela[atualK] || {compra:0, venda:0};
  const deltaAtual = atual.compra - atual.venda;
  const totalAtual = atual.compra + atual.venda;
  return {
    velas: usadas.length,
    compra, venda,
    delta: compra - venda,
    // -100 a +100: quanto do volume do periodo foi agressao compradora liquida
    pressao: total > 0 ? ((compra - venda) / total * 100) : 0,
    delta_vela: deltaAtual,
    pressao_vela: totalAtual > 0 ? (deltaAtual / totalAtual * 100) : 0
  };
}
window.forcaDoFluxo = forcaDoFluxo;

// ALARME DE DIVERGENCIA PRECO x FLUXO
// A leitura do relatorio ja detecta e descreve isto — "o preco sobe enquanto
// quem tem pressa esta vendendo" —, mas so quando voce abre o relatorio. E
// justamente a situacao que voce quer saber NA HORA, porque ela aparece antes
// do preco virar, nao depois.
//
// Toca uma vez por virada, nao uma por vela: guardo o estado anterior e so
// aviso quando ele muda. Sem isso um mercado divergente por vinte velas daria
// vinte alarmes.
const DIVERG_PRESSAO = 18;      // abaixo disso e ruido, nao divergencia
const DIVERG_ESPERA_MS = 10*60*1000;
let divergAnterior = null, divergUltimo = 0;

function verificaDivergenciaFluxo(){
  if(!alertsOn){ divergAnterior = null; return; }
  let f = null;
  try{ f = forcaDoFluxo(20); }catch(e){ return; }
  if(!f || (f.compra + f.venda) === 0) return;
  const dir = (typeof direcaoAngles!=="undefined" && direcaoAngles && typeof classifyDirecao==="function")
    ? classifyDirecao(direcaoAngles) : null;
  if(!dir || dir.isFlat) { divergAnterior = null; return; }

  const preco = dir.direcao === "alta" ? "alta" : "baixa";
  let estado = null;
  if(preco === "alta"  && f.pressao <= -DIVERG_PRESSAO) estado = "alta-sem-comprador";
  if(preco === "baixa" && f.pressao >=  DIVERG_PRESSAO) estado = "baixa-com-comprador";

  if(estado === divergAnterior) return;   // ja avisei desta
  divergAnterior = estado;
  if(!estado) return;                     // saiu da divergencia: so guarda

  const agora = Date.now();
  if(agora - divergUltimo < DIVERG_ESPERA_MS) return;
  divergUltimo = agora;

  const txt = estado === "alta-sem-comprador"
    ? "preco subindo com agressao vendedora ("+f.pressao.toFixed(0)+"%) — alta sem comprador convicto"
    : "preco caindo com agressao compradora (+"+f.pressao.toFixed(0)+"%) — alguem absorvendo a queda";
  if(typeof showInfoToast==="function") showInfoToast("DIVERGENCIA", txt);
  else if(typeof beep==="function") beep();
}
window.verificaDivergenciaFluxo = verificaDivergenciaFluxo;

function renderForca(){
  const box = document.getElementById('forca-box'), cnt = document.getElementById('forca-count');
  if(!box) return;
  const f = forcaDoFluxo(20);
  if(!f || (f.compra + f.venda) === 0){
    if(cnt) cnt.textContent = "--";
    box.innerHTML = '<div style="padding:5px 9px;font-size:9px;color:var(--t3);">Aguardando negocios ao vivo...</div>';
    return;
  }
  const cor = p => p >= 15 ? "#00C853" : (p <= -15 ? "#FF3B30" : "#F5A623");
  if(cnt){
    cnt.textContent = (f.pressao >= 0 ? "+" : "") + f.pressao.toFixed(0) + "%";
    cnt.style.color = cor(f.pressao);
  }
  // a barra e centrada em zero: o olho le de que lado esta a pressao sem ler o numero
  const barra = (p, rot) => {
    const larg = Math.min(50, Math.abs(p)/2);
    const esq = p >= 0 ? 50 : 50 - larg;
    return '<div style="font-size:9px;color:var(--t3);margin-bottom:2px;">'+rot
      +' <span style="color:'+cor(p)+';font-family:var(--mono);">'+(p>=0?"+":"")+p.toFixed(1)+'%</span></div>'
      +'<div style="position:relative;height:7px;background:var(--bg4);border-radius:3px;margin-bottom:6px;">'
      +'<span style="position:absolute;left:50%;top:-1px;width:1px;height:9px;background:var(--bd3);"></span>'
      +'<span style="position:absolute;left:'+esq+'%;width:'+larg+'%;height:100%;background:'+cor(p)+';border-radius:3px;"></span>'
      +'</div>';
  };
  box.innerHTML = barra(f.pressao_vela, "vela atual")
    + barra(f.pressao, "ultimas " + f.velas + " velas")
    + '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--t3);">'
    + '<span>compra <span style="color:#00C853;font-family:var(--mono);">'+fmtNotional(f.compra)+'</span></span>'
    + '<span>venda <span style="color:#FF3B30;font-family:var(--mono);">'+fmtNotional(f.venda)+'</span></span></div>'
    + '<div style="font-size:8px;color:var(--t3);margin-top:3px;">delta '
    + (f.delta>=0?"+":"") + fmtNotional(f.delta) + ' · ' + fluxoNegocios.length + ' negocios em memoria</div>'
    + blocoCVD();
}

// O CVD entra debaixo da forca porque responde a mesma coisa em outra escala:
// a forca e agora, o CVD e o acumulado. O numero absoluto nao vale nada (varia
// com quanto historico carregou) — o que vale e a inclinacao e a divergencia.
function blocoCVD(){
  let dv = null;
  try{ dv = divergenciaCVD(candles, 60); }catch(e){}
  if(!dv) return '';
  const seta = dv.subindo ? '&uarr;' : '&darr;';
  const cor = dv.subindo ? '#00C853' : '#FF3B30';
  let s = '<div style="border-top:1px solid var(--bd2);margin-top:6px;padding-top:5px;">'
    + '<div style="font-size:9px;color:var(--t3);">CVD nas ultimas '+dv.velas+' velas '
    + '<span style="color:'+cor+';font-family:var(--mono);">'+seta+' '
    + (dv.inclinacao>=0?"+":"-") + fmtNotional(Math.abs(dv.inclinacao)) + '</span></div>';
  if(dv.tipo){
    const c = dv.tipo === 'baixista' ? '#FF3B30' : '#00C853';
    s += '<div style="font-size:8.5px;color:'+c+';margin-top:3px;line-height:1.4;"><b>divergencia '
      + dv.tipo + '</b>: '
      + (dv.tipo === 'baixista'
          ? 'topo mais alto no preco com topo mais baixo no CVD — sobe sem dinheiro novo comprando'
          : 'fundo mais baixo no preco com fundo mais alto no CVD — cai com alguem absorvendo')
      + '</div>';
  }
  return s + '</div>';
}
window.renderForca = renderForca;

// ══════════════════════════════════════════════════════
// RELATORIO PARA OS AGENTES DE ANALISE
// ══════════════════════════════════════════════════════
// O painel calcula muita coisa e tudo morre na tela. Aqui esse estado vira
// arquivo: um retrato do ativo no instante em que voce guarda a observacao —
// preco, angulos das medias, liberacao, placar dos sinais, contra-argumentos,
// fibo com os niveis atingidos, escada do RSI, alarmes montados e o Multi-TF.
//
// Guardo o retrato JUNTO da observacao, nao so o texto: reler "achei que ia
// subir" tres dias depois nao diz nada; reler com os numeros que estavam na
// tela naquele instante e o que deixa comparar o que voce achou com o que
// aconteceu. E o que tira a emocao da conta.
function chaveObs(){ return "obs:"+(typeof currentSym!=="undefined"?currentSym:"?"); }
let observacoes=[];

function carregaObservacoes(){
  try{ observacoes=JSON.parse(localStorage.getItem(chaveObs())||"[]")||[]; }
  catch(e){ observacoes=[]; }
  renderObservacoes();
}

// O retrato completo do que o painel sabe agora. Cada bloco em seu try: uma
// parte indisponivel nao pode derrubar o relatorio inteiro.
// "312 velas" nao diz nada sozinho num grafico de 15m. Converte pra tempo de
// relogio, que e como a pergunta e feita: ha quanto tempo esta acima?
function duracaoHumana(seg){
  if(seg == null || !isFinite(seg) || seg <= 0) return "--";
  const dias = Math.floor(seg/86400), h = Math.floor((seg%86400)/3600), m = Math.floor((seg%3600)/60);
  if(dias >= 1) return dias+"d"+(h?" "+h+"h":"");
  if(h >= 1)    return h+"h"+(m?" "+m+"min":"");
  return m+"min";
}

function retratoDoAtivo(){
  const r={};
  r.ativo = typeof currentSym!=="undefined"?currentSym:null;
  r.timeframe = typeof currentTF!=="undefined"?currentTF:null;
  r.momento = new Date().toISOString();
  r.preco = (typeof candles!=="undefined"&&candles.length)?candles[candles.length-1].close:null;
  r.velas_carregadas = (typeof candles!=="undefined")?candles.length:0;
  r.fonte = typeof lastDataSource!=="undefined"?lastDataSource:null;

  try{
    r.direcao={angulos:{},soma:null,estado:null,liberacao:null};
    if(typeof direcaoAngles!=="undefined"&&direcaoAngles){
      Object.keys(direcaoAngles).forEach(k=>{
        r.direcao.angulos[k]=direcaoAngles[k]==null?null:+direcaoAngles[k].toFixed(2);
      });
      const cls=classifyDirecao(direcaoAngles);
      r.direcao.soma=cls.sumAngle==null?null:+cls.sumAngle.toFixed(2);
      r.direcao.estado=cls.isFlat?"lateral":(cls.direcao==="alta"?"alta":"baixa");
    }
    if(typeof estadoLiberacao==="function") r.direcao.liberacao=estadoLiberacao(null);
  }catch(e){}

  // ── CVD E MARCOS DE VOLUME
  try{
    const dv = divergenciaCVD(candles, 60);
    if(dv) r.cvd = {velas:dv.velas, inclinacao:Math.round(dv.inclinacao),
                    subindo:dv.subindo, divergencia:dv.tipo};
  }catch(e){}
  try{
    const idx = Object.keys(marcosVolume||{}).map(Number).sort((a,b)=>b-a);
    if(idx.length){
      const ult = idx[0], vela = candles[ult];
      r.marco_volume = {
        periodo: marcosVolume[ult],
        quando: vela ? new Date(vela.time*1000).toISOString() : null,
        velas_atras: candles.length-1-ult,
        preco: vela ? vela.close : null,
        em_momento_frio_com_rsi: !!(marcosFortes||{})[ult],
        total_na_tela: {dia:0, semana:0, mes:0}
      };
      Object.values(marcosVolume).forEach(p=>{ r.marco_volume.total_na_tela[p]++; });
    }
  }catch(e){}

  // ── AS DUAS PONTAS: BINANCE E DERIV
  try{
    if(typeof consolidaOfertaProcura==="function"){
      const c = consolidaOfertaProcura(20);
      if(c && (c.binance || c.deriv)){
        r.oferta_procura = {
          binance_pressao_dinheiro: c.binance ? +c.binance.pressao.toFixed(1) : null,
          deriv_pressao_ticks:      c.deriv   ? +c.deriv.pressao.toFixed(1)   : null,
          deriv_ticks:              c.deriv   ? c.deriv.ticks : null,
          acordo: c.acordo,
          nota: "unidades diferentes: Binance mede dolar agressor do livro; Deriv conta ticks pra cima, pois nao publica volume negociado"
        };
      }
    }
  }catch(e){}

  // ── QUANTO TEMPO DO MESMO LADO DA EMA200
  // Nao e so "esta acima": ha diferenca entre estar acima ha tres velas e ha
  // trezentas. A segunda e tendencia estabelecida, a primeira e um repique
  // que ainda nao provou nada.
  //
  // A ema() e semeada com o primeiro preco, entao as ~200 primeiras velas do
  // array sao aquecimento e nao valem como leitura. Se a sequencia chega la,
  // devolvo como "pelo menos", nunca como numero exato.
  try{
    const e200 = (typeof serieMedias!=="undefined") && serieMedias && serieMedias.ema200;
    const n = candles.length;
    if(e200 && e200.length === n && n > 210){
      const piso = 200;                       // antes disso a media nao convergiu
      const acima = candles[n-1].close > e200[n-1];
      let i = n-1, velas = 0;
      while(i >= piso && (candles[i].close > e200[i]) === acima){ velas++; i--; }
      const seg = tfToSeconds(currentTF) * velas;
      r.ema200_lado = {
        lado: acima ? "acima" : "abaixo",
        velas,
        truncado: i < piso,                   // encostou no aquecimento da media
        segundos: seg,
        duracao: duracaoHumana(seg),
        desde: new Date(candles[n-velas].time*1000).toISOString(),
        distancia_pct: +(((candles[n-1].close - e200[n-1]) / e200[n-1]) * 100).toFixed(2)
      };
    }
  }catch(e){}

  // ── O VALOR DO VOLUME
  // Em dolar, nao em moeda: e o numero que a bolha mostra. Sozinho nao diz
  // nada, entao vai junto com a media das ultimas 30 velas e com o corte que
  // faz uma vela virar bolha.
  try{
    const n = candles.length, atual = candles[n-1];
    const v = fluxoPorVela[atual.time];
    if(v){
      const totais = [];
      for(let i = Math.max(0, n-30); i < n; i++){
        const x = fluxoPorVela[candles[i].time];
        if(x) totais.push((x.compra||0) + (x.venda||0));
      }
      const media = totais.length ? totais.reduce((s,x)=>s+x,0)/totais.length : null;
      const total = (v.compra||0) + (v.venda||0);
      const est = (typeof estatisticaFluxo==="function") ? estatisticaFluxo() : null;
      r.volume = {
        vela_atual_usd: Math.round(total),
        compra_usd: Math.round(v.compra||0),
        venda_usd: Math.round(v.venda||0),
        media_30_usd: media==null?null:Math.round(media),
        vs_media_pct: (media && media>0) ? +(((total/media)-1)*100).toFixed(1) : null,
        corte_bolha_usd: est ? Math.round(est.corte) : null,
        vira_bolha: !!(est && (v.compra >= est.corte || v.venda >= est.corte))
      };
    }
  }catch(e){}

  try{
    r.placar=Object.values(placarSinais||{}).filter(g=>g.n>=3).map(g=>({
      sinal:g.chave, ocorrencias:g.n, acerto_pct:+g.acerto.toFixed(1),
      profit_factor:g.pf>=99?null:+g.pf.toFixed(2), media_R:+g.mediaR.toFixed(2)}));
    r.placar_regua="stop 1 ATR, alvo 2 ATR, teto de 50 velas";
  }catch(e){ r.placar=[]; }

  try{
    const ca=(typeof contraArgumentos==="function")?contraArgumentos():[];
    r.contra_argumentos=ca.map(x=>({peso:x.peso,argumento:x.txt,porque:x.det}));
    r.contra_peso_total=ca.reduce((s,x)=>s+x.peso,0);
  }catch(e){ r.contra_argumentos=[]; }

  try{
    const f=[...drawings()].reverse().find(d=>d.type==="fibbo");
    if(f&&f.p0&&f.p1){
      const diff=f.p0.price-f.p1.price;
      r.fibo={ancora:{p0:f.p0.price,p1:f.p1.price},
        niveis:[...fibLevels,...fibBreakLevels].map(lv=>{
          const preco=f.p1.price+diff*lv;
          return {nivel:lv, preco:+preco.toFixed(6),
            atingido:(r.preco!=null)&&(diff>0?r.preco>=preco:r.preco<=preco),
            alarme:(typeof fibMarcado==="function")&&fibMarcado(lv)};
        })};
      // O ALVO e o primeiro nivel ainda NAO atingido no sentido da ancora —
      // e pra ele que a extensao aponta. Sem isso o relatorio listava doze
      // niveis e deixava a pergunta "e o alvo, qual e?" sem resposta.
      // Nivel a menos de 0,1% do preco nao e alvo: o preco esta EM CIMA dele.
      // Sem esse filtro o relatorio anunciava "alvo a 0,00% do preco", que nao
      // responde nada — o alvo tem que ser o proximo lugar aonde ir.
      const LONGE=0.001;
      const naoAtingidos=r.fibo.niveis.filter(n=>!n.atingido
        && Math.abs(n.preco-r.preco)/r.preco > LONGE);
      const alvo=naoAtingidos.length
        ? naoAtingidos.reduce((a,b)=>Math.abs(b.preco-r.preco)<Math.abs(a.preco-r.preco)?b:a)
        : null;
      if(alvo){
        r.fibo.alvo={nivel:alvo.nivel, preco:alvo.preco, alarme:alvo.alarme,
          distancia_pct:+(((alvo.preco-r.preco)/r.preco)*100).toFixed(2),
          sentido: alvo.preco>r.preco ? "acima" : "abaixo"};
        // quantos ja ficaram pra tras diz o quanto do movimento ja andou
        r.fibo.atingidos=r.fibo.niveis.filter(n=>n.atingido).length;
        r.fibo.total_niveis=r.fibo.niveis.length;
      }
    }
  }catch(e){}

  try{
    const st=rsiState(candles.map(c=>c.close),14);
    if(st){
      const base=st.al===0?100:(st.ag===0?0:100-(100/(1+st.ag/st.al)));
      r.rsi={atual:+base.toFixed(1), escada:RSI_ESCADA.map(nv=>{
        const p=precoParaRSI(st.ag,st.al,st.last,nv);
        return {nivel:nv, preco_necessario:p==null?null:+p.toFixed(6)};
      })};
    }
  }catch(e){}

  try{
    const mt=(typeof mtfEstado!=="undefined")?mtfEstado.filter(Boolean):[];
    if(mt.length) r.multi_tf=mt.map(e=>({tempo:e.tf,
      soma:+e.cls.sumAngle.toFixed(1),
      estado:e.cls.isFlat?"lateral":(e.cls.direcao==="alta"?"alta":"baixa")}));
  }catch(e){}

  try{
    if(typeof correlacaoMulti==="function"){
      const c=correlacaoMulti();
      if(c) r.correlacao={media:+c.media.toFixed(3),
        pares:c.pares.map(p=>({a:p.a,b:p.b,valor:+p.c.toFixed(3)}))};
    }
  }catch(e){}

  try{
    r.alarmes={precos:(alarmesManuais||[]).map(a=>a.preco),
      medias:(alarmesMedias||[]).map(m=>m.tipo==="cruze"?m.a+" x "+m.b:"preco x "+m.a),
      fibo_marcados:(fibNiveisMarcados||[]).map(x=>x.lv)};
  }catch(e){}

  try{
    const ef=(typeof estatisticaFibo==="function")?estatisticaFibo():null;
    if(ef&&ef.total) r.fibo_historico=ef;
  }catch(e){}

  try{
    r.ultimos_sinais=(signals||[]).slice(-12).map(x=>({tipo:x.type,lado:x.side,
      preco:x.price,quando:new Date(x.time).toISOString(),liberado:!!x.liberado}));
    r.liberados=(liberados||[]).slice(-12).map(x=>({tipo:x.type,lado:x.side,
      preco:x.price,quando:new Date(x.time).toISOString()}));
  }catch(e){}

  return r;
}

// O retrato inteiro pesa 6,8 KB, e o teto de 200 e POR ATIVO: 1,36 MB cada,
// e o navegador da uns 5 MB no total. Com quatro ativos acompanhados isso
// estoura, e ai a observacao que voce acabou de escrever nao e gravada.
//
// Quase todo o peso esta em tres listas que ninguem rele numa observacao
// antiga: os 29 niveis do fibo, a escada inteira do RSI e os ultimos sinais.
// O que se rele e o estado do mercado naquele instante — direcao, fluxo, o
// que pesava contra, o preco. Guardo isso, e do fibo guardo so o alvo, que e
// a unica linha que a observacao costuma citar.
function retratoEnxuto(r){
  if(!r) return r;
  const e = Object.assign({}, r);
  if(e.fibo){
    e.fibo = {ancora:e.fibo.ancora, alvo:e.fibo.alvo,
              atingidos:e.fibo.atingidos, total_niveis:e.fibo.total_niveis};
  }
  if(e.rsi) e.rsi = {atual:e.rsi.atual};       // a escada se recalcula, o valor nao
  delete e.ultimos_sinais;                     // estao no log de sinais
  delete e.liberados;
  delete e.correlacao;                         // e do painel Multi, nao do ativo
  if(e.fibo_historico) e.fibo_historico = {total:e.fibo_historico.total};
  return e;
}
window.retratoEnxuto = retratoEnxuto;

// ALARME NO ALVO DO FIBO
// O relatorio ja escreve "nao ha alarme nesse nivel — chegar ate ali depende
// de voce estar olhando". Faltava o botao que resolve isso na hora: um clique
// e o alvo vira alarme de preco, no mesmo caminho dos alarmes manuais, entao
// toca igual e some da lista igual.
function alarmeNoAlvoFibo(){
  const r = retratoDoAtivo();
  const alvo = r.fibo && r.fibo.alvo;
  if(!alvo){
    if(typeof showInfoToast==="function")
      showInfoToast("ALARMES","sem ancora de fibo tracada — nao ha alvo pra marcar");
    return;
  }
  const preco = +Number(alvo.preco).toFixed(8);
  if(alarmesManuais.some(a=>a.preco===preco)){
    if(typeof showInfoToast==="function") showInfoToast("ALARMES","ja existe alarme em "+preco);
    return;
  }
  alarmesManuais.push({preco, criado:Date.now(), origem:"alvo fib "+alvo.nivel});
  alarmesManuais.sort((a,b)=>b.preco-a.preco);
  salvaAlarmesManuais();
  if(typeof showInfoToast==="function")
    showInfoToast("ALARMES","alarme no alvo "+alvo.nivel+" ("+preco+"), "
      +Math.abs(alvo.distancia_pct).toFixed(2)+"% "+alvo.sentido);
}
window.alarmeNoAlvoFibo = alarmeNoAlvoFibo;

function salvaObservacao(){
  const el=document.getElementById("rel-obs");
  const txt=(el&&el.value||"").trim();
  if(!txt){
    if(typeof showInfoToast==="function") showInfoToast("RELATORIO","escreva a observacao antes de guardar");
    return;
  }
  observacoes.push({observacao:txt, retrato:retratoEnxuto(retratoDoAtivo())});
  if(observacoes.length>200) observacoes.shift();
  try{ localStorage.setItem(chaveObs(),JSON.stringify(observacoes)); }
  catch(e){
    // o retrato e grande: se o armazenamento encher, aviso em vez de perder calado
    if(typeof showInfoToast==="function") showInfoToast("RELATORIO","nao coube no armazenamento — baixe e limpe");
  }
  if(el) el.value="";
  renderObservacoes();
  if(typeof showInfoToast==="function") showInfoToast("RELATORIO","observacao guardada com o retrato do ativo");
}

function removeObservacao(i){
  observacoes.splice(i,1);
  try{ localStorage.setItem(chaveObs(),JSON.stringify(observacoes)); }catch(e){}
  renderObservacoes();
}

function renderObservacoes(){
  const box=document.getElementById("rel-list"), cnt=document.getElementById("rel-count");
  if(cnt) cnt.textContent=observacoes.length?observacoes.length+" guardadas":"--";
  if(!box) return;
  if(!observacoes.length){
    box.innerHTML='<div style="padding:5px 9px;font-size:9px;color:var(--t3);">Nenhuma observacao guardada.</div>';
    return;
  }
  box.innerHTML=observacoes.slice().reverse().map((o,k)=>{
    const i=observacoes.length-1-k;
    const q=new Date(o.retrato.momento).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
    const est=(o.retrato.direcao&&o.retrato.direcao.estado)||"--";
    return '<div style="display:flex;gap:5px;align-items:flex-start;padding:4px 9px;border-bottom:1px solid var(--bd);">'
      +'<span style="color:var(--t3);font-size:8px;white-space:nowrap;">'+q+'</span>'
      +'<span style="font-size:9px;color:var(--t2);flex:1;line-height:1.4;">'+o.observacao
      +' <span style="color:var(--t3);">('+est+' @ '+(o.retrato.preco==null?"--":o.retrato.preco)+')</span></span>'
      +'<button class="toast-x" onclick="removeObservacao('+i+')">x</button></div>';
  }).join("");
}

// JSON e nao texto: agente de analise le JSON melhor, e o campo legenda evita
// que ele tenha que adivinhar o que cada numero significa.
function montaRelatorio(){
  return {
    gerado_em:new Date().toISOString(),
    origem:"Atlas Dashboard",
    agora:retratoDoAtivo(),
    observacoes:observacoes,
    legenda:{
      soma:"soma dos angulos das medias em graus; positivo = inclinacao de alta",
      liberacao:"alta/baixa quando EMA8 e EMA16 estao as duas do mesmo lado da MA89 e da EMA200; null = embaralhadas",
      media_R:"resultado medio em multiplos do risco, com stop a 1 ATR e alvo a 2 ATR",
      contra_peso_total:"soma do peso das objecoes; 2 e um argumento forte, 4 ou mais sao varios"
    }
  };
}

// ══════════════════════════════════════════════════════
// RELATORIO EM PDF
// ══════════════════════════════════════════════════════
// Sem biblioteca. Monto o documento numa janela propria e chamo o print do
// navegador, que oferece "Salvar como PDF" — dependencia zero, e o desenho
// fica sob controle total do CSS, o que uma lib de PDF nao daria de graca.
//
// O JSON continua existindo pro agente de analise ler. O PDF e pra pessoa: a
// capa, a leitura de mercado, o que pesa contra e as suas observacoes.

function pdfFmt(v, casas){
  if(v == null || !isFinite(v)) return "--";
  return (v >= 0 ? "" : "") + Number(v).toFixed(casas == null ? 2 : casas);
}
function pdfSinal(v, casas){
  if(v == null || !isFinite(v)) return "--";
  return (v >= 0 ? "+" : "") + Number(v).toFixed(casas == null ? 1 : casas);
}
function pdfEsc(t){
  return String(t == null ? "" : t)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// Barra horizontal centrada em zero, pra leitura de forca e pressao sem
// precisar interpretar o numero.
function pdfBarra(pct, cor){
  const p = Math.max(-100, Math.min(100, pct || 0));
  const larg = Math.abs(p) / 2;
  const esq = p >= 0 ? 50 : 50 - larg;
  return '<div class="barra"><span class="zero"></span>'
    + '<span class="preenche" style="left:'+esq+'%;width:'+larg+'%;background:'+cor+'"></span></div>';
}

// ── A LEITURA ────────────────────────────────────────────────────────────
// O relatorio dizia os numeros e parava ali — quem lia tinha que juntar as
// pontas sozinho. Isto aqui junta: cruza direcao, fluxo, contra-argumento,
// historico dos sinais e os niveis, e escreve o que os numeros dizem quando
// vistos juntos.
//
// Tudo aqui e DERIVADO do retrato, frase por frase, com o numero citado no
// meio da frase. Nada de opiniao sem numero atras: se um dado nao existe, a
// frase correspondente nao e escrita. E leitura de dado, nao recomendacao —
// o rodape do documento repete isso.

// Concordancia entre os tempos do multi-TF: quantos apontam pro mesmo lado.
function analiseTempos(r){
  const mt = r.multi_tf || [];
  if(!mt.length) return null;
  const alta = mt.filter(m => m.estado === "alta").length;
  const baixa = mt.filter(m => m.estado === "baixa").length;
  const lateral = mt.length - alta - baixa;
  return {n:mt.length, alta, baixa, lateral,
          lado: alta > baixa ? "alta" : (baixa > alta ? "baixa" : null),
          unanime: alta === mt.length || baixa === mt.length};
}

// O nivel de Fibonacci mais proximo acima e abaixo do preco. Sao eles que
// viram "o que confirma" e "o que invalida", em vez de um palpite redondo.
function analiseNiveis(r){
  if(!r.fibo || !r.fibo.niveis || r.preco == null) return null;
  let acima = null, abaixo = null;
  r.fibo.niveis.forEach(n => {
    if(n.preco > r.preco && (!acima || n.preco < acima.preco)) acima = n;
    if(n.preco < r.preco && (!abaixo || n.preco > abaixo.preco)) abaixo = n;
  });
  const dist = n => n ? Math.abs(n.preco - r.preco) / r.preco * 100 : null;
  return {acima, abaixo, distAcima:dist(acima), distAbaixo:dist(abaixo)};
}

function analiseDoMercado(r){
  const p = [];                    // paragrafos
  const dir = r.direcao || {};
  const nome = (r.ativo||"o ativo").replace("USDT","");
  const num = v => (v==null||!isFinite(v)) ? "--" : Number(v).toFixed(2);
  const sin = v => (v==null||!isFinite(v)) ? "--" : (v>=0?"+":"")+Number(v).toFixed(1);

  // 1) DIRECAO — o que as medias dizem, e o que a liberacao acrescenta
  if(dir.estado){
    let t = "As medias de "+nome+" somam <b>"+sin(dir.soma)+"&deg;</b>, o que classifica o "
          + pdfEsc(r.timeframe)+" como <b>"+pdfEsc(dir.estado)+"</b>.";
    if(dir.liberacao === "alta" || dir.liberacao === "baixa"){
      t += " O sinal esta <b>liberado para "+dir.liberacao+"</b>: a EMA8 e a EMA16 estao as duas "
        + (dir.liberacao === "alta" ? "acima" : "abaixo")
        + " da MA89 e da EMA200, que e a condicao mais restritiva do painel.";
      if(dir.estado !== dir.liberacao){
        t += " Repare que a soma dos angulos aponta para "+pdfEsc(dir.estado)
          + " e a liberacao para "+dir.liberacao+": a inclinacao ja virou antes do empilhamento,"
          + " ou esta virando agora. Divergencia entre os dois pede paciencia, nao pressa.";
      }
    }else{
      t += " O sinal <b>nao esta liberado</b>: as medias curtas nao estao as duas do mesmo lado"
        + " da MA89 e da EMA200. Enquanto ficarem embaralhadas, qualquer entrada e contra a"
        + " regra que o proprio painel usa para separar tendencia de repique.";
    }
    p.push(t);
  }

  // 2) OS OUTROS TEMPOS — concordam ou brigam com o que esta na tela
  const tp = analiseTempos(r);
  if(tp && tp.lado){
    let t = "Nos "+tp.n+" tempos acompanhados, <b>"+(tp.lado==="alta"?tp.alta:tp.baixa)
          + " apontam para "+tp.lado+"</b>"
          + (tp.lateral ? " e "+tp.lateral+" esta"+(tp.lateral>1?"o":"")+" lateral" : "")+".";
    if(tp.unanime){
      t += " Sao todos, sem excecao — o cenario em que o tempo grafico da tela tem menos"
        + " chance de estar contando uma historia isolada.";
    }else if(dir.estado && tp.lado !== dir.estado){
      t += " <b>Isso contradiz a tela.</b> Operar o "+pdfEsc(r.timeframe)+" contra a maioria dos"
        + " tempos maiores e possivel, mas e o tipo de operacao que precisa de alvo curto e"
        + " stop obedecido, porque a mare esta do outro lado.";
    }else{
      t += " Vai no mesmo sentido do que a tela mostra.";
    }
    p.push(t);
  }

  // 3) FLUXO — quem esta pagando pra entrar, e se isso bate com o preco
  try{
    const f = forcaDoFluxo(20);
    if(f && (f.compra + f.venda) > 0){
      const lado = f.pressao >= 0 ? "compradora" : "vendedora";
      let t = "A agressao das ultimas "+f.velas+" velas esta <b>"+sin(f.pressao)+"%</b>"
            + " — pressao "+lado+". Na vela em curso, <b>"+sin(f.pressao_vela)+"%</b>.";
      const forte = Math.abs(f.pressao) >= 15;
      if(dir.estado === "alta" && f.pressao < -15){
        t += " <b>Isso e uma divergencia:</b> o preco sobe enquanto quem tem pressa esta vendendo."
          + " Alta sustentada por falta de vendedor, e nao por comprador convicto, costuma"
          + " devolver o caminho rapido quando o vendedor aparece.";
      }else if(dir.estado === "baixa" && f.pressao > 15){
        t += " <b>Isso e uma divergencia:</b> o preco cai enquanto o agressor e comprador —"
          + " alguem esta absorvendo a queda. Nao e sinal de compra sozinho, mas e o tipo de"
          + " leitura que costuma anteceder o fim de uma perna de baixa.";
      }else if(forte){
        t += " O fluxo <b>confirma</b> o que as medias mostram: preco e agressao no mesmo lado.";
      }else{
        t += " E uma pressao fraca, perto do equilibrio: o fluxo nao esta confirmando nem"
          + " desmentindo o preco, so acompanhando.";
      }
      // a vela em curso destoando da media das 20 e informacao: pro outro lado
      // e comeco de virada, pro mesmo lado e pressao se acumulando agora
      if(Math.abs(f.pressao_vela - f.pressao) >= 20 && Math.abs(f.pressao_vela) >= 20){
        const mesmoLado = (f.pressao_vela >= 0) === (f.pressao >= 0);
        t += mesmoLado
          ? " A vela em curso esta bem mais carregada que a media das "+f.velas
            + ": a pressao esta se acumulando agora, e nao ha "+f.velas+" velas."
          : " A vela em curso, porem, esta puxando para o outro lado da media das "+f.velas
            + ": e cedo para chamar de virada, mas e onde ela comecaria a aparecer.";
      }
      p.push(t);
    }
  }catch(e){}

  // 3a2) AS DUAS PONTAS — mesma pergunta, dois livros
  if(r.oferta_procura && r.oferta_procura.acordo){
    const o = r.oferta_procura;
    let t = "Cruzando as duas fontes: na Binance o dinheiro agressor esta <b>"+sin(o.binance_pressao_dinheiro)
          + "%</b>; na Deriv, <b>"+sin(o.deriv_pressao_ticks)+"%</b> dos ticks foram pra cima ("
          + (o.deriv_ticks||0).toLocaleString("pt-BR")+" ticks).";
    t += o.acordo === "concordam"
      ? " <b>As duas apontam pro mesmo lado</b> — e a leitura mais firme que este painel consegue dar,"
        + " porque sao livros diferentes chegando na mesma conclusao."
      : o.acordo === "divergem"
        ? " <b>As duas discordam.</b> O livro da Binance e o feed da Deriv estao contando historias"
          + " diferentes sobre quem esta com pressa. Divergencia entre fontes nao diz quem esta certo,"
          + " diz que a leitura ainda nao esta pronta."
        : " Pelo menos uma das duas nao tem lado definido, entao o cruzamento nao confirma nada aqui.";
    t += " Vale lembrar que nao sao a mesma medida: a Binance conta dolar, a Deriv conta tick —"
      + " ela nao publica volume negociado.";
    p.push(t);
  }

  // 3b) O VALOR DO VOLUME — o numero que a bolha mostra, com contexto
  if(r.volume && r.volume.vela_atual_usd != null){
    const v = r.volume;
    let t = "A vela em curso negociou <b>"+fmtNotional(v.vela_atual_usd)+"</b> ("
          + fmtNotional(v.compra_usd)+" comprando contra "+fmtNotional(v.venda_usd)+" vendendo)";
    if(v.media_30_usd) t += ", contra uma media de "+fmtNotional(v.media_30_usd)
      + " nas ultimas 30 velas — <b>"+sin(v.vs_media_pct)+"%</b>";
    t += ".";
    if(v.vira_bolha){
      t += " Passa do corte de "+fmtNotional(v.corte_bolha_usd)+" e por isso aparece como"
        + " bolha no grafico: e volume que destoa, nao volume de rotina.";
    }else if(v.corte_bolha_usd){
      t += " Fica abaixo do corte de "+fmtNotional(v.corte_bolha_usd)+" que faz uma vela virar"
        + " bolha — volume dentro do normal deste ativo.";
    }
    if(v.vs_media_pct != null && v.vs_media_pct <= -40){
      t += " Movimento com volume bem abaixo da media costuma nao sustentar: falta gente do"
        + " outro lado pra continuar empurrando.";
    }
    p.push(t);
  }

  // 3b2) CVD — o acumulado, nao o instante
  if(r.cvd){
    let t = "O volume acumulado (CVD) das ultimas "+r.cvd.velas+" velas esta <b>"
          + (r.cvd.subindo ? "subindo" : "descendo")+"</b>, "
          + (r.cvd.inclinacao>=0?"+":"-")+fmtNotional(Math.abs(r.cvd.inclinacao))+" no periodo.";
    if(r.cvd.divergencia === "baixista"){
      t += " E ha <b>divergencia baixista</b>: o preco fez topo mais alto e o CVD fez topo mais"
        + " baixo. Isso quer dizer que a alta aconteceu sem dinheiro novo comprando — quem estava"
        + " dentro aproveitou pra distribuir. E a objecao mais dificil de enxergar no grafico,"
        + " porque o preco parece otimo justamente enquanto ela se forma.";
    }else if(r.cvd.divergencia === "altista"){
      t += " E ha <b>divergencia altista</b>: o preco fez fundo mais baixo e o CVD fez fundo mais"
        + " alto — alguem esta absorvendo a queda em vez de acompanha-la.";
    }else{
      t += " Preco e CVD estao andando juntos, sem divergencia no recorte.";
    }
    p.push(t);
  }

  // 3b3) MARCO DE VOLUME — qual vela mandou no periodo
  if(r.marco_volume){
    const m = r.marco_volume;
    const nomes = {dia:"do dia", semana:"da semana", mes:"do mes"};
    let t = "A maior vela "+nomes[m.periodo]+" foi ha <b>"+m.velas_atras+" velas</b>, em "
          + num(m.preco)+".";
    const tot = m.total_na_tela;
    t += " No historico carregado ha "+tot.mes+" marco(s) de mes, "+tot.semana+" de semana e "
      + tot.dia+" de dia.";
    if(m.em_momento_frio_com_rsi){
      t += " <b>Essa caiu em momento frio, com o RSI cruzando</b> — volume grande enquanto as"
        + " medias estavam indecisas e o RSI virava. E o caso que interessa: dinheiro entrando"
        + " ANTES do preco decidir, e nao no meio de uma tendencia ja formada.";
    }else{
      t += " Nenhum marco recente caiu em momento frio com o RSI cruzando; os que ha sao volume"
        + " de continuacao, dentro de tendencia ja definida.";
    }
    p.push(t);
  }

  // 3c) HA QUANTO TEMPO DO MESMO LADO DA EMA200 — persistencia, nao posicao
  if(r.ema200_lado){
    const e = r.ema200_lado;
    let t = "O preco esta <b>"+e.lado+" da EMA200 ha "+(e.truncado?"pelo menos ":"")
          + "<b>"+e.duracao+"</b></b> ("+e.velas+" velas de "+pdfEsc(r.timeframe)
          + "), hoje a "+num(Math.abs(e.distancia_pct))+"% dela.";
    if(e.truncado){
      t += " A sequencia vai alem do historico carregado, entao o numero e um piso:"
        + " e mais tempo do que isso, nao menos.";
    }else if(e.velas <= 5){
      t += " Sao poucas velas — cruzou agora. Cruzamento recente da EMA200 e o momento em que"
        + " ela mais devolve: ainda nao provou que virou lado.";
    }else if(e.velas >= 100){
      t += " E uma permanencia longa. Tendencia que se sustenta desse tempo raramente inverte"
        + " sem antes perder a media, entao o proprio cruzamento vira o aviso a esperar.";
    }
    if(Math.abs(e.distancia_pct) >= 12){
      t += " A distancia de "+num(Math.abs(e.distancia_pct))+"% e grande: entrar aqui e"
        + " comprar longe do chao, com a media longe pra servir de stop.";
    }
    p.push(t);
  }

  // 3d) O ALVO DO FIBO — a pergunta "pra onde isso vai" respondida com nivel
  if(r.fibo && r.fibo.alvo){
    const al = r.fibo.alvo;
    let t = "O proximo alvo do Fibonacci e o <b>"+al.nivel+"</b> em <b>"+num(al.preco)
          + "</b>, "+num(Math.abs(al.distancia_pct))+"% "+al.sentido+" do preco de agora";
    if(r.fibo.atingidos != null){
      t += ", com "+r.fibo.atingidos+" dos "+r.fibo.total_niveis+" niveis da ancora ja para tras";
    }
    t += ".";
    t += al.alarme
      ? " Voce ja tem alarme nesse nivel — ele avisa sozinho quando o preco encostar."
      : " <b>Nao ha alarme nesse nivel.</b> Sem ele, chegar ate ali depende de voce estar olhando.";
    p.push(t);
  }else if(r.preco != null){
    p.push("<b>Nao ha ancora de Fibonacci ativa</b> neste ativo, entao o relatorio nao tem alvo"
      + " para apontar. Enquanto nao houver uma tracada, a leitura fica sem o unico numero que"
      + " diria ate onde o movimento costuma ir.");
  }

  // 4) O QUE PESA CONTRA — o painel ja levanta as objecoes, aqui elas entram
  //    na conta com peso
  const ca = r.contra_argumentos || [];
  if(ca.length){
    const peso = r.contra_peso_total || 0;
    let t = "Contra a leitura pesa"+(ca.length>1?"m":"")+" <b>"+ca.length+" objec"
          + (ca.length>1?"oes":"ao")+"</b> (peso "+peso+"): "
          + ca.map(x => pdfEsc(x.argumento)).join("; ")+".";
    if(peso >= 4){
      t += " Peso 4 ou mais nao e um detalhe — sao varias coisas erradas ao mesmo tempo."
        + " Se a operacao ainda parece boa com esse peso contra, vale reler o motivo.";
    }else if(peso >= 2){
      t += " E um argumento forte contra, do tamanho de reduzir posicao ou esperar mais confirmacao.";
    }
    p.push(t);
  }else{
    p.push("<b>Nenhuma objecao</b> foi levantada pelo painel: preco, volume e distancia das"
      + " medias estao dentro do que o proprio historico considera normal.");
  }

  // 5) O QUE O HISTORICO DIZ DESSE SINAL — sem isso a leitura vira opiniao
  const pl = (r.placar||[]).slice().sort((a,b) => b.ocorrencias - a.ocorrencias);
  if(pl.length){
    const m = pl[0];
    let t = "No historico carregado, o sinal <b>"+pdfEsc(m.sinal)+"</b> apareceu "
          + m.ocorrencias+" vezes, com acerto de "+Math.round(m.acerto_pct)+"% e media de <b>"
          + sin(m.media_R)+"R</b> ("+pdfEsc(r.placar_regua)+").";
    if(m.media_R < 0){
      t += " <b>Media negativa:</b> nesse recorte, esse sinal perdeu dinheiro mesmo com"
        + " esse acerto. Acerto alto com media negativa e ganho pequeno pago com perda grande.";
    }else if(m.media_R >= 0.5){
      t += " Media positiva e folgada — o sinal se pagou nesse recorte.";
    }else{
      t += " Media positiva, mas apertada: e um sinal que depende de execucao boa pra sobrar algo.";
    }
    p.push(t);
  }

  // 6) ONDE ESTAO AS LINHAS — o que confirma e o que invalida, com preco
  const nv = analiseNiveis(r);
  if(nv && (nv.acima || nv.abaixo)){
    let t = "O preco esta em <b>"+num(r.preco)+"</b>.";
    if(nv.acima) t += " O proximo nivel de Fibonacci acima e <b>"+num(nv.acima.preco)
      + "</b> ("+nv.acima.nivel+"), a "+num(nv.distAcima)+"% daqui.";
    if(nv.abaixo) t += " Abaixo, <b>"+num(nv.abaixo.preco)+"</b> ("+nv.abaixo.nivel
      + "), a "+num(nv.distAbaixo)+"%.";
    if(nv.acima && nv.abaixo){
      // a frase precisa apontar pro lado da leitura, senao fala de alta num
      // documento que acabou de classificar o ativo como baixa
      t += dir.estado === "baixa"
        ? " Sao esses dois numeros que transformam a leitura em decisao: perder <b>"
          + num(nv.abaixo.preco)+"</b> confirma a baixa; recuperar <b>"+num(nv.acima.preco)
          + "</b> tira o argumento dela."
        : " Sao esses dois numeros que transformam a leitura em decisao: superar <b>"
          + num(nv.acima.preco)+"</b> confirma a alta; perder <b>"+num(nv.abaixo.preco)
          + "</b> tira o argumento dela.";
    }
    p.push(t);
  }

  // 7) ATE ONDE COSTUMA IR — o historico das ancoras, quando existe
  if(r.fibo_historico && r.fibo_historico.total >= 3 && r.fibo_historico.niveis){
    const nvs = r.fibo_historico.niveis;
    const chegam = nvs.filter(n => n.pct >= 60);
    if(chegam.length){
      const longe = chegam[chegam.length-1];
      // o primeiro alvo que o historico NAO sustenta e a fronteira util:
      // ate ali costuma chegar, dali pra frente e torcida
      const alem = nvs.filter(n => n.pct < 60)[0];
      let t = "Nas "+r.fibo_historico.total+" ancoras arquivadas deste ativo, o alvo <b>"
            + longe.nivel+"</b> foi alcancado em "+Math.round(longe.pct)+"% das vezes.";
      t += alem
        ? " Ja o <b>"+alem.nivel+"</b> so em "+Math.round(alem.pct)+"%: e ali que o historico"
          + " para de sustentar o alvo. Perseguir alem disso e torcida, nao estatistica."
        : " Nenhum dos alvos arquivados ficou abaixo de 60%, o que com so "
          + r.fibo_historico.total+" ancoras diz mais sobre a amostra pequena do que sobre o ativo.";
      p.push(t);
    }
  }

  return p;
}
window.analiseDoMercado = analiseDoMercado;

function montaHtmlPdf(){
  const r = retratoDoAtivo();
  const d = new Date();
  const dataLonga = d.toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"});
  const hora = d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  const ativo = (r.ativo||"").replace("USDT","");
  const dir = r.direcao || {};
  const corEstado = dir.estado === "alta" ? "#00A85A" : dir.estado === "baixa" ? "#D93025" : "#B7791F";

  // ── direcao: uma linha por media
  const medias = Object.keys(dir.angulos||{}).map(k => {
    const v = dir.angulos[k];
    const cor = v == null ? "#8a8a8a" : (v >= 0 ? "#00A85A" : "#D93025");
    return '<tr><td class="k">'+k.toUpperCase()+'</td>'
      + '<td class="v" style="color:'+cor+'">'+pdfSinal(v,1)+'&deg;</td></tr>';
  }).join("");

  // ── forca do fluxo
  let forcaBloco = '<p class="vazio">Sem negocios ao vivo capturados nesta sessao.</p>';
  try{
    const f = forcaDoFluxo(20);
    if(f && (f.compra + f.venda) > 0){
      const c = p => p >= 15 ? "#00A85A" : (p <= -15 ? "#D93025" : "#B7791F");
      forcaBloco =
        '<div class="rot">vela atual <b style="color:'+c(f.pressao_vela)+'">'+pdfSinal(f.pressao_vela)+'%</b></div>'
        + pdfBarra(f.pressao_vela, c(f.pressao_vela))
        + '<div class="rot">ultimas '+f.velas+' velas <b style="color:'+c(f.pressao)+'">'+pdfSinal(f.pressao)+'%</b></div>'
        + pdfBarra(f.pressao, c(f.pressao))
        + '<p class="nota">Agressao compradora contra vendedora. Mede quem esta pagando '
        + 'para entrar, e nao o preco — preco subindo com pressao negativa e alta sem comprador convicto.</p>';
    }
  }catch(e){}

  // ── os tres numeros que se pergunta primeiro, em destaque
  const cartoes = [];
  if(r.volume && r.volume.vela_atual_usd != null){
    cartoes.push({rot:"volume da vela", val:fmtNotional(r.volume.vela_atual_usd),
      pe:(r.volume.vs_media_pct==null ? "" : pdfSinal(r.volume.vs_media_pct)+"% vs media de 30")
         + (r.volume.vira_bolha ? " &middot; vira bolha" : "")});
  }
  if(r.fibo && r.fibo.alvo){
    cartoes.push({rot:"alvo no fibo", val:pdfFmt(r.fibo.alvo.preco),
      pe:"nivel "+r.fibo.alvo.nivel+" &middot; "+pdfFmt(Math.abs(r.fibo.alvo.distancia_pct),2)+"% "
         +r.fibo.alvo.sentido+(r.fibo.alvo.alarme?" &middot; com alarme":" &middot; sem alarme")});
  }else{
    cartoes.push({rot:"alvo no fibo", val:"--", pe:"nenhuma ancora tracada"});
  }
  if(r.ema200_lado){
    cartoes.push({rot:r.ema200_lado.lado+" da EMA200",
      val:(r.ema200_lado.truncado?"&ge; ":"")+r.ema200_lado.duracao,
      pe:r.ema200_lado.velas+" velas &middot; "+pdfFmt(Math.abs(r.ema200_lado.distancia_pct),2)+"% da media"});
  }
  const cartoesHtml = cartoes.length
    ? '<div class="cartoes">'+cartoes.map(c =>
        '<div class="cartao"><div class="c-rot">'+c.rot+'</div>'
        + '<div class="c-val">'+c.val+'</div><div class="c-pe">'+c.pe+'</div></div>').join("")
      + '</div>'
    : "";

  // ── a leitura: os numeros cruzados, em texto
  let leitura = "";
  try{
    const ps = analiseDoMercado(r);
    if(ps && ps.length) leitura = ps.map(t => '<p class="an">'+t+'</p>').join("");
  }catch(e){}

  // ── placar
  const placar = (r.placar||[]).length
    ? '<table class="tab"><thead><tr><th>sinal</th><th>vezes</th><th>acerto</th><th>PF</th><th>media</th></tr></thead><tbody>'
      + r.placar.map(p => '<tr><td>'+pdfEsc(p.sinal)+'</td><td>'+p.ocorrencias+'</td>'
        + '<td>'+pdfFmt(p.acerto_pct,0)+'%</td><td>'+(p.profit_factor==null?"--":pdfFmt(p.profit_factor,2))+'</td>'
        + '<td style="color:'+(p.media_R>=0?"#00A85A":"#D93025")+'"><b>'+pdfSinal(p.media_R,2)+'R</b></td></tr>').join("")
      + '</tbody></table><p class="nota">'+pdfEsc(r.placar_regua)
      + '. A media em R decide, nao o acerto: muito ganho pequeno pago por poucas perdas grandes tambem da acerto alto.</p>'
    : '<p class="vazio">Sem sinais suficientes no historico carregado.</p>';

  // ── contra-argumento
  const contra = (r.contra_argumentos||[]).length
    ? '<ul class="contra">' + r.contra_argumentos.map(x =>
        '<li class="'+(x.peso>=2?"forte":"leve")+'"><b>'+pdfEsc(x.argumento)+'</b>'
        + '<span>'+pdfEsc(x.porque)+'</span></li>').join("") + '</ul>'
    : '<p class="ok">Nada pesando contra no momento.</p>';

  // ── fibo: so os niveis relevantes, nao os 29
  let fibo = '<p class="vazio">Nenhum fibo desenhado.</p>';
  if(r.fibo && r.fibo.niveis){
    const uteis = r.fibo.niveis.filter(n => n.nivel >= 0 && n.nivel <= 4.7);
    fibo = '<table class="tab"><thead><tr><th>nivel</th><th>preco</th><th>estado</th></tr></thead><tbody>'
      + uteis.map(n => '<tr><td>'+n.nivel+'</td><td>'+pdfFmt(n.preco)+'</td>'
        + '<td>'+(n.atingido?'<span class="tag ok">atingido</span>':'<span class="tag">aguarda</span>')
        + (n.alarme?' <span class="tag alarme">alarme</span>':'')+'</td></tr>').join("")
      + '</tbody></table>';
  }

  // ── ate onde o fibo costuma ir
  let fibHist = "";
  if(r.fibo_historico && r.fibo_historico.total){
    const h = r.fibo_historico;
    const linhas = h.niveis.filter(n => n.alcancaram > 0).slice(0,6);
    if(linhas.length){
      fibHist = '<h2>Ate onde o fibo costuma ir</h2><table class="tab">'
        + '<thead><tr><th>alvo</th><th>alcancaram</th><th></th></tr></thead><tbody>'
        + linhas.map(n => '<tr><td>'+n.nivel+'</td><td>'+n.pct+'% ('+n.alcancaram+' de '+h.total+')</td>'
          + '<td><div class="minibar"><span style="width:'+Math.max(2,n.pct)+'%"></span></div></td></tr>').join("")
        + '</tbody></table><p class="nota">De '+h.total+' ancoras arquivadas. '
        + 'Perseguir o alvo distante so vale se o historico mostrar que ele costuma ser alcancado.</p>';
    }
  }

  // ── escada do RSI
  const rsi = r.rsi
    ? '<table class="tab"><thead><tr><th>RSI</th><th>preco necessario</th></tr></thead><tbody>'
      + r.rsi.escada.map(e => '<tr'+(e.nivel===50?' class="agua"':'')+'><td>'+e.nivel
        + (e.nivel===30?' (OS)':e.nivel===70?' (OB)':e.nivel===50?' (agua)':'')+'</td>'
        + '<td>'+(e.preco_necessario==null?"--":pdfFmt(e.preco_necessario))+'</td></tr>').join("")
      + '</tbody></table><p class="nota">RSI atual '+pdfFmt(r.rsi.atual,1)+'. O preco que leva o RSI(14) a cada nivel.</p>'
    : '<p class="vazio">Sem dados de RSI.</p>';

  // ── observacoes
  const obs = (observacoes||[]).length
    ? observacoes.slice().reverse().map(o => {
        const q = new Date(o.retrato.momento).toLocaleString("pt-BR",
          {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
        const e = (o.retrato.direcao && o.retrato.direcao.estado) || "--";
        return '<div class="obs"><div class="obs-cab">'+q
          + ' &middot; '+pdfEsc(e)+' &middot; '+pdfFmt(o.retrato.preco)+'</div>'
          + '<div class="obs-txt">'+pdfEsc(o.observacao)+'</div></div>';
      }).join("")
    : '<p class="vazio">Nenhuma observacao guardada para este ativo.</p>';

  const multi = (r.multi_tf||[]).length
    ? '<table class="tab"><thead><tr><th>tempo</th><th>soma</th><th>estado</th></tr></thead><tbody>'
      + r.multi_tf.map(m => '<tr><td>'+pdfEsc(m.tempo).toUpperCase()+'</td>'
        + '<td style="color:'+(m.soma>=0?"#00A85A":"#D93025")+'"><b>'+pdfSinal(m.soma)+'&deg;</b></td>'
        + '<td>'+pdfEsc(m.estado)+'</td></tr>').join("") + '</tbody></table>'
    : "";

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Vectra — ${pdfEsc(ativo)} ${pdfEsc(r.timeframe)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  *{box-sizing:border-box;}
  body{margin:0;font:11px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif;color:#1a1d23;}

  /* CAPA — pagina inteira, fundo escuro. O print do Chrome so pinta fundo com
     print-color-adjust:exact, senao a capa sai branca. */
  .capa{position:relative;height:calc(100vh - 32mm);min-height:245mm;display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;
    background:#0b0e13;color:#fff;margin:-16mm -14mm 0;padding:16mm 14mm;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-after:always;}
  .capa img{width:150px;height:150px;border-radius:50%;object-fit:cover;
    box-shadow:0 0 0 2px rgba(245,166,35,.55),0 0 60px rgba(245,166,35,.28);margin-bottom:26px;}
  .marca{font-size:34px;font-weight:800;letter-spacing:9px;color:#F5A623;margin:0;}
  .marca-sub{font-size:9px;letter-spacing:5px;color:#8a93a3;margin:6px 0 40px;text-transform:uppercase;}
  .capa-ativo{font-size:44px;font-weight:800;letter-spacing:2px;margin:0;}
  .capa-tf{font-size:13px;color:#8a93a3;letter-spacing:3px;margin:6px 0 34px;text-transform:uppercase;}
  .capa-preco{font-size:20px;font-family:ui-monospace,monospace;color:#F5A623;}
  .capa-estado{display:inline-block;margin-top:18px;padding:6px 20px;border-radius:20px;
    font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;}
  /* sem o position:relative na capa esta data ancorava no body e vazava por
     cima do corpo do documento */
  .capa-data{position:absolute;left:0;right:0;bottom:20mm;text-align:center;
    font-size:9px;color:#6b7280;letter-spacing:2px;}

  /* Os tres numeros que se pergunta primeiro, antes de qualquer tabela. */
  .cartoes{display:flex;gap:8px;margin:0 0 14px;}
  .cartao{flex:1;border:1px solid #e3e6ea;border-radius:5px;padding:8px 10px;background:#fafbfc;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .c-rot{font-size:8px;text-transform:uppercase;letter-spacing:1.2px;color:#6b7280;}
  .c-val{font-size:17px;font-weight:800;font-family:ui-monospace,monospace;margin:3px 0 1px;
    letter-spacing:-.4px;}
  .c-pe{font-size:8.5px;color:#6b7280;}

  /* A leitura e o unico bloco de texto corrido do documento, entao ganha
     entrelinha maior e uma barra na lateral pra se separar das tabelas. */
  .leitura{border-left:3px solid #F5A623;padding-left:11px;margin-bottom:16px;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .an{margin:0 0 7px;font-size:10.5px;line-height:1.62;text-align:justify;}
  .an b{color:#0b0e13;}

  h1{font-size:15px;margin:0 0 2px;letter-spacing:.5px;}
  .sub{font-size:9px;color:#6b7280;margin:0 0 16px;letter-spacing:1px;text-transform:uppercase;}
  h2{font-size:11px;text-transform:uppercase;letter-spacing:1.6px;color:#6b7280;
    margin:20px 0 7px;padding-bottom:4px;border-bottom:1px solid #e3e6ea;}
  section{page-break-inside:avoid;}

  .tab{width:100%;border-collapse:collapse;font-size:10px;}
  .tab th{text-align:left;font-weight:600;color:#6b7280;font-size:8.5px;
    text-transform:uppercase;letter-spacing:.8px;padding:3px 6px;border-bottom:1px solid #e3e6ea;}
  .tab td{padding:3px 6px;border-bottom:1px solid #f1f3f5;}
  .tab tr.agua td{background:#fafbfc;font-weight:600;}
  td.k{color:#6b7280;} td.v{font-family:ui-monospace,monospace;font-weight:700;text-align:right;}

  .duas{display:flex;gap:22px;} .duas>*{flex:1;min-width:0;}

  .barra{position:relative;height:9px;background:#eef0f2;border-radius:5px;margin:3px 0 10px;}
  .barra .zero{position:absolute;left:50%;top:-2px;width:1px;height:13px;background:#c9ced6;}
  .barra .preenche{position:absolute;height:100%;border-radius:5px;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .rot{font-size:9px;color:#6b7280;}
  .minibar{height:6px;background:#eef0f2;border-radius:3px;overflow:hidden;}
  .minibar span{display:block;height:100%;background:#377cfc;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;}

  .contra{list-style:none;padding:0;margin:0;}
  .contra li{padding:6px 9px;margin-bottom:5px;border-left:3px solid #B7791F;background:#fcfbf7;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .contra li.forte{border-left-color:#D93025;background:#fdf7f6;}
  .contra li b{display:block;font-size:10px;}
  .contra li span{display:block;font-size:8.5px;color:#6b7280;margin-top:2px;}
  .ok{color:#00A85A;font-size:10px;}
  .vazio{color:#9aa1ab;font-size:9.5px;font-style:italic;}
  .nota{font-size:8.5px;color:#6b7280;margin:5px 0 0;line-height:1.45;}

  .tag{font-size:8px;padding:1px 6px;border-radius:9px;background:#eef0f2;color:#6b7280;}
  .tag.ok{background:#e6f6ed;color:#00A85A;} .tag.alarme{background:#fdf3e3;color:#B7791F;}

  .obs{border-left:2px solid #F5A623;padding:5px 10px;margin-bottom:8px;background:#fdfcfa;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;}
  .obs-cab{font-size:8px;color:#9aa1ab;letter-spacing:.5px;text-transform:uppercase;}
  .obs-txt{font-size:10.5px;margin-top:2px;}

  .rodape{margin-top:26px;padding-top:8px;border-top:1px solid #e3e6ea;
    font-size:8px;color:#9aa1ab;line-height:1.6;}
</style></head><body>

<div class="capa">
  <img src="${location.origin}${location.pathname.replace(/[^/]*$/,'')}vectra-icon.png" alt="">
  <p class="marca">VECTRA</p>
  <p class="marca-sub">Global Data Intelligence</p>
  <p class="capa-ativo">${pdfEsc(ativo)}</p>
  <p class="capa-tf">${pdfEsc(r.timeframe)} &middot; leitura de mercado</p>
  <p class="capa-preco">${pdfFmt(r.preco)}</p>
  <div><span class="capa-estado" style="background:${corEstado};color:#fff;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;">
    ${pdfEsc(dir.estado||"sem leitura")}</span></div>
  <p class="capa-data">${dataLonga} &middot; ${hora}</p>
</div>

<h1>${pdfEsc(ativo)} &middot; ${pdfEsc(r.timeframe)}</h1>
<p class="sub">${dataLonga} as ${hora} &middot; ${r.velas_carregadas} velas &middot; fonte ${pdfEsc(r.fonte||"--")}</p>

${cartoesHtml}
${leitura ? '<section class="leitura"><h2>A leitura</h2>'+leitura
  + '<p class="nota">Cada frase acima sai de um numero deste mesmo documento. Onde o dado nao'
  + ' existe, a frase nao foi escrita.</p></section>' : ''}

<div class="duas">
  <section>
    <h2>Direcao</h2>
    <table class="tab"><tbody>${medias}
      <tr><td class="k"><b>soma</b></td>
        <td class="v" style="color:${corEstado}"><b>${pdfSinal(dir.soma)}&deg;</b></td></tr>
      <tr><td class="k">liberacao</td><td class="v">${pdfEsc(dir.liberacao||"nao liberado")}</td></tr>
    </tbody></table>
    <p class="nota">Liberado quando EMA8 e EMA16 estao as duas do mesmo lado da MA89 e da EMA200.</p>
  </section>
  <section>
    <h2>Forca do fluxo</h2>
    ${forcaBloco}
  </section>
</div>

<section><h2>O que pesa contra</h2>${contra}</section>
<section><h2>Placar dos sinais</h2>${placar}</section>
${multi ? '<section><h2>Multi-timeframe</h2>'+multi+'</section>' : ''}
<section>${fibHist}</section>
<div class="duas">
  <section><h2>Fibonacci</h2>${fibo}</section>
  <section><h2>Escada do RSI</h2>${rsi}</section>
</div>
<section><h2>Observacoes</h2>${obs}</section>

<div class="rodape">
  Gerado pelo Atlas Dashboard em ${dataLonga} as ${hora}.
  Os numeros sao do historico carregado no momento da geracao e nao constituem
  recomendacao de investimento &mdash; sao leitura de dados para apoiar a sua decisao.
</div>
</body></html>`;
}

function geraPdf(){
  const w = window.open("", "_blank");
  if(!w){
    if(typeof showInfoToast === "function") showInfoToast("PDF","o navegador bloqueou a janela — libere o pop-up");
    return;
  }
  w.document.write(montaHtmlPdf());
  w.document.close();
  // espera a imagem da capa carregar, senao o print sai sem ela
  const imprimir = () => { try{ w.focus(); w.print(); }catch(e){} };
  const img = w.document.querySelector(".capa img");
  if(img && !img.complete){
    img.onload = imprimir;
    img.onerror = imprimir;
    setTimeout(imprimir, 2500);   // nao deixa preso se a imagem nunca resolver
  }else{
    setTimeout(imprimir, 300);
  }
  if(typeof showInfoToast === "function"){
    showInfoToast("PDF","escolha 'Salvar como PDF' no destino da impressao");
  }
}
window.geraPdf = geraPdf;
window.montaHtmlPdf = montaHtmlPdf;

function baixaRelatorio(){
  const dados=JSON.stringify(montaRelatorio(),null,2);
  const nome="atlas-"+(currentSym||"ativo")+"-"+(currentTF||"")+"-"
    +new Date().toISOString().slice(0,16).replace(/[:T-]/g,"")+".json";
  try{
    const blob=new Blob([dados],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=nome; document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    if(typeof showInfoToast==="function") showInfoToast("RELATORIO",nome);
  }catch(e){
    if(typeof showInfoToast==="function") showInfoToast("RELATORIO","falha ao baixar: "+e.message);
  }
}

function copiaRelatorio(){
  const dados=JSON.stringify(montaRelatorio(),null,2);
  const ok=()=>{ if(typeof showInfoToast==="function") showInfoToast("RELATORIO","copiado — cole no agente de analise"); };
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(dados).then(ok).catch(()=>copiaFallback(dados,ok));
  }else copiaFallback(dados,ok);
}
// navigator.clipboard so existe em contexto seguro; no file:// ele nao esta la
function copiaFallback(txt,ok){
  try{
    const ta=document.createElement("textarea");
    ta.value=txt; ta.style.position="fixed"; ta.style.left="-9999px";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy");
    document.body.removeChild(ta); ok();
  }catch(e){
    if(typeof showInfoToast==="function") showInfoToast("RELATORIO","nao consegui copiar; use o botao baixar");
  }
}
window.salvaObservacao=salvaObservacao;
window.removeObservacao=removeObservacao;
window.baixaRelatorio=baixaRelatorio;
window.copiaRelatorio=copiaRelatorio;
window.retratoDoAtivo=retratoDoAtivo;
window.montaRelatorio=montaRelatorio;

// ══════════════════════════════════════════════════════
// CONTRA-ARGUMENTO
// ══════════════════════════════════════════════════════
// Todo o resto do dashboard responde "por que entrar". Nada respondia "o que
// pesa contra" — e o que evita operacao ruim nao e mais confirmacao, e a
// objecao que voce nao viu.
//
// Cada verificacao devolve um item ou nada. Nenhuma delas e um veto: sao
// argumentos, com peso, pra voce decidir sabendo o que esta ignorando.

function contraArgumentos(){
  const itens=[];
  if(!candles||candles.length<210) return itens;
  const closes=candles.map(c=>c.close), highs=candles.map(c=>c.high), lows=candles.map(c=>c.low);
  const vols=candles.map(c=>c.volume==null?null:c.volume);
  const i=closes.length-1, px=closes[i];
  const atrV=atrCalc(highs,lows,closes,P.atrLen), atr=atrV[i];
  const e200=ema(closes,200), e8=ema(closes,8), e16=ema(closes,16);

  // 0. DIVERGENCIA DE CVD. O preco faz o topo, o dinheiro nao acompanha. E a
  //    objecao mais dificil de ver no grafico, porque o preco parece otimo.
  try{
    const dv = divergenciaCVD(candles, 60);
    if(dv && dv.tipo === "baixista"){
      itens.push({peso:2,
        txt:"divergencia de CVD: topo mais alto no preco, topo mais baixo no volume acumulado",
        det:"o preco sobe sem dinheiro novo comprando — quem estava dentro esta distribuindo na alta"});
    }
  }catch(e){}

  // 1. PRECO ESTICADO. Longe demais da media longa, a reversao a media joga
  //    contra: o movimento pode continuar, mas o preco de entrada e ruim.
  if(atr>0&&e200[i]!=null){
    const dist=Math.abs(px-e200[i])/atr;
    if(dist>=3){
      itens.push({peso:dist>=5?2:1,
        txt:"preco a "+dist.toFixed(1)+" ATR da EMA200 — esticado, entrada cara",
        det:"quanto mais longe da media longa, pior o preco de entrada e maior o espaco pra devolver"});
    }
  }

  // 2. VOLUME FRACO. Movimento sem volume costuma nao sustentar. So conta se a
  //    fonte trouxe volume — nem todas trazem.
  const volOk=vols.slice(-30).every(v=>v!=null&&isFinite(v));
  if(volOk){
    const med=vols.slice(-31,-1).reduce((a,b)=>a+b,0)/30;
    if(med>0&&vols[i]<med*0.6){
      itens.push({peso:1,
        txt:"volume da vela em "+((vols[i]/med)*100).toFixed(0)+"% da media de 30",
        det:"movimento sem volume costuma nao sustentar"});
    }
  }

  // 3. TIMEFRAMES BRIGANDO. Se o Multi-TF esta aberto e os tempos discordam, a
  //    entrada e contra um dos lados por definicao.
  if(typeof mtfEstado!=="undefined"&&mtfEstado.filter(Boolean).length>=2){
    const somas=mtfEstado.filter(Boolean).map(e=>e.cls.sumAngle).filter(v=>v!=null);
    if(somas.length>=2){
      const pos=somas.filter(v=>v>0).length, neg=somas.length-pos;
      if(pos&&neg){
        itens.push({peso:2,
          txt:"timeframes discordam: "+pos+" pra cima, "+neg+" pra baixo",
          det:"entrar aqui e ir contra pelo menos um dos tempos"});
      }
    }
  }

  // 4. SEM LIBERACAO. A sua propria regra: EMA8 e EMA16 das duas acima ou das
  //    duas abaixo da MA89 e da EMA200.
  if(typeof estadoLiberacao==="function"){
    const est=estadoLiberacao(null);
    if(!est){
      itens.push({peso:2,txt:"medias embaralhadas — sinal nao liberado",
        det:"pela sua regra, EMA8 e EMA16 precisam estar as duas do mesmo lado da MA89 e da EMA200"});
    }
  }

  // 5. O PLACAR DO PROPRIO SETUP. Se o ultimo sinal e de um tipo que historicamente
  //    perde, isso pesa mais que qualquer leitura de grafico.
  if(typeof placarDe==="function"&&signals&&signals.length){
    const ult=signals[signals.length-1];
    const pl=placarDe(ult.type,ult.side);
    if(pl&&pl.n>=5&&pl.mediaR<0){
      itens.push({peso:2,
        txt:ult.type+" "+ult.side+" rende "+pl.mediaR.toFixed(2)+"R em "+pl.n+" vezes aqui",
        det:"o historico deste setup neste ativo e timeframe e negativo"});
    }
  }

  // 6. CARTEIRA CONCENTRADA. Quatro posicoes correlacionadas sao uma aposta so.
  if(typeof multiViewOpen!=="undefined"&&multiViewOpen&&typeof correlacaoMulti==="function"){
    const c=correlacaoMulti();
    if(c&&Math.abs(c.media)>=0.7){
      itens.push({peso:1,
        txt:"ativos do Multi correlacionados ("+c.media.toFixed(2)+")",
        det:"abrir nos quatro nao divide risco, multiplica o mesmo"});
    }
  }

  // 7. EMA8 x EMA16 ACABOU DE VIRAR CONTRA o lado esticado — sinal de que o
  //    impulso curto ja perdeu forca.
  if(e8[i]!=null&&e16[i]!=null&&e8[i-1]!=null&&e16[i-1]!=null){
    const agora=Math.sign(e8[i]-e16[i]), antes=Math.sign(e8[i-1]-e16[i-1]);
    if(agora!==antes&&agora!==0){
      itens.push({peso:1,
        txt:"EMA8 acabou de cruzar a EMA16 pra "+(agora>0?"cima":"baixo"),
        det:"o impulso curto mudou de lado agora — esperar confirmar costuma sair mais barato"});
    }
  }

  return itens.sort((a,b)=>b.peso-a.peso);
}

function renderContraArgumento(){
  const box=document.getElementById("contra-list"), cnt=document.getElementById("contra-count");
  if(!box) return;
  let itens=[];
  try{ itens=contraArgumentos(); }catch(e){ itens=[]; }
  const peso=itens.reduce((s,x)=>s+x.peso,0);
  if(cnt){
    cnt.textContent=itens.length?itens.length+" ("+peso+")":"nenhum";
    cnt.style.color=peso>=4?"#FF3B30":(peso>=2?"#F5A623":"#00C853");
  }
  if(!itens.length){
    box.innerHTML='<div style="padding:5px 9px;font-size:9px;color:#00C853;">Nada pesando contra no momento.</div>';
    return;
  }
  box.innerHTML=itens.map(x=>{
    const cor=x.peso>=2?"#FF3B30":"#F5A623";
    // layout proprio: o .sig-item tem colunas de largura fixa e espremia o
    // texto numa palavra por linha
    return '<div title="'+x.det+'" style="display:flex;align-items:flex-start;gap:5px;'
      +'padding:4px 9px;border-bottom:1px solid var(--bd);">'
      +'<span style="color:'+cor+';font-size:8px;line-height:1.6;flex-shrink:0;">'
      +(x.peso>=2?"\u25cf\u25cf":"\u25cf")+"</span>"
      +'<span style="font-size:9px;color:var(--t2);line-height:1.45;">'+x.txt+"</span></div>";
  }).join("");
}
window.renderContraArgumento=renderContraArgumento;
window.contraArgumentos=contraArgumentos;

// ══════════════════════════════════════════════════════
// PLACAR DOS SINAIS
// ══════════════════════════════════════════════════════
// O dashboard tinha 25 paineis de opiniao e nenhum numero dizendo se elas
// funcionam. Aqui cada tipo de sinal ganha o seu historico: pego os sinais que
// o motor achou nas velas carregadas, simulo o que aconteceu depois de cada um
// e conto.
//
// A regua e a MESMA pra todos de proposito — stop a 1 ATR contra, alvo a 2 ATR
// a favor, teto de 50 velas. O objetivo e comparar os tipos entre si, e pra
// isso eles precisam ser medidos igual. Nao e promessa de resultado: e o que
// aquele setup fez neste ativo e neste timeframe, no historico que esta na tela.
//
// O runBacktest nao serve aqui: ele gera as proprias entradas por cruzamento de
// medias, nao avalia os sinais do motor.
const PLACAR_STOP_ATR=1, PLACAR_ALVO_ATR=2, PLACAR_TETO_VELAS=50;
let placarSinais={};

function avaliaSinais(candlesArr,sinais){
  const out={};
  if(!candlesArr||candlesArr.length<60||!sinais||!sinais.length) return out;
  const n=candlesArr.length;
  const closes=candlesArr.map(c=>c.close), highs=candlesArr.map(c=>c.high), lows=candlesArr.map(c=>c.low);
  const atrV=atrCalc(highs,lows,closes,P.atrLen);
  // tempo -> indice, pra achar a vela de cada sinal sem varrer o array toda vez
  const porTempo={};
  for(let i=0;i<n;i++) porTempo[candlesArr[i].time]=i;

  sinais.forEach(sig=>{
    const i=porTempo[Math.floor(sig.time/1000)];
    if(i==null||i>=n-2) return;                  // sinal da vela em curso ainda nao tem desfecho
    const atr=atrV[i];
    if(atr==null||!isFinite(atr)||atr<=0) return;
    const compra=sig.side.includes("BUY")||sig.side.includes("BULL")||sig.side.includes("HIT");
    const dir=compra?1:-1;
    const entrada=sig.price;
    const stop=entrada-dir*PLACAR_STOP_ATR*atr;
    const alvo=entrada+dir*PLACAR_ALVO_ATR*atr;

    let r=null;
    const ate=Math.min(n-1,i+PLACAR_TETO_VELAS);
    for(let j=i+1;j<=ate;j++){
      // stop antes do alvo dentro da mesma vela: o conservador, senao o placar
      // fica otimista de graca
      if((dir===1&&lows[j]<=stop)||(dir===-1&&highs[j]>=stop)){ r=-1; break; }
      if((dir===1&&highs[j]>=alvo)||(dir===-1&&lows[j]<=alvo)){ r=PLACAR_ALVO_ATR/PLACAR_STOP_ATR; break; }
    }
    // nao bateu nem um nem outro no teto: fecha no preco e mede em R
    if(r===null) r=((closes[ate]-entrada)*dir)/(PLACAR_STOP_ATR*atr);

    const chave=sig.type+" "+(compra?"COMPRA":"VENDA");
    const g=out[chave]||(out[chave]={chave,n:0,ganhos:0,somaR:0,somaGanho:0,somaPerda:0});
    g.n++;
    if(r>0){ g.ganhos++; g.somaGanho+=r; } else { g.somaPerda+=Math.abs(r); }
    g.somaR+=r;
  });

  Object.values(out).forEach(g=>{
    g.acerto = g.n ? (g.ganhos/g.n*100) : 0;
    g.mediaR = g.n ? (g.somaR/g.n) : 0;
    g.pf = g.somaPerda>0 ? (g.somaGanho/g.somaPerda) : (g.somaGanho>0?99:0);
  });
  return out;
}

function atualizaPlacarSinais(){
  try{ placarSinais=avaliaSinais(candles,signals); }catch(e){ placarSinais={}; }
  renderPlacarSinais();
}

function renderPlacarSinais(){
  const box=document.getElementById("placar-list"), cnt=document.getElementById("placar-count");
  if(!box) return;
  const linhas=Object.values(placarSinais).filter(g=>g.n>=3).sort((a,b)=>b.mediaR-a.mediaR);
  if(cnt) cnt.textContent=linhas.length?linhas.length+" tipos":"--";
  if(!linhas.length){
    box.innerHTML='<div style="padding:5px 9px;font-size:9px;color:var(--t3);">Sem sinais suficientes no historico carregado (minimo 3 por tipo).</div>';
    return;
  }
  box.innerHTML=linhas.map(g=>{
    // a media em R e o numero que decide: acerto alto com R medio negativo e
    // muito ganho pequeno pago por poucas perdas grandes
    const cor=g.mediaR>=0.15?"#00C853":(g.mediaR<=-0.15?"#FF3B30":"#F5A623");
    const compra=g.chave.includes("COMPRA");
    // grid de colunas fixas: com o .sig-item o nome do tipo colidia com o "103x"
    return '<div title="'+g.n+' sinais no historico carregado \u00b7 stop 1 ATR, alvo 2 ATR, teto de 50 velas"'
      +' style="display:grid;grid-template-columns:1fr auto auto auto auto;gap:6px;align-items:center;'
      +'padding:4px 9px;border-bottom:1px solid var(--bd);font-size:9px;">'
      +'<span style="color:'+(compra?"#00C853":"#FF3B30")+';font-weight:800;white-space:nowrap;'
      +'overflow:hidden;text-overflow:ellipsis;">'+g.chave+"</span>"
      +'<span style="color:var(--t3);">'+g.n+"x</span>"
      +'<span style="color:var(--t2);">'+g.acerto.toFixed(0)+"%</span>"
      +'<span style="color:var(--t2);">PF '+(g.pf>=99?"--":g.pf.toFixed(2))+"</span>"
      +'<span style="color:'+cor+';font-weight:800;font-family:var(--mono);">'
      +(g.mediaR>=0?"+":"")+g.mediaR.toFixed(2)+"R</span></div>";
  }).join("");
}

// O placar de um tipo de sinal, pra mostrar junto do aviso
function placarDe(type,side){
  const compra=side.includes("BUY")||side.includes("BULL")||side.includes("HIT");
  return placarSinais[type+" "+(compra?"COMPRA":"VENDA")]||null;
}
window.atualizaPlacarSinais=atualizaPlacarSinais;

function computeBacktestStats(trades){
  const total=trades.length;
  const wins=trades.filter(t=>t.win).length;
  const losses=total-wins;
  const winRate=total>0?(wins/total*100):0;
  const grossWin=trades.filter(t=>t.pnlPct>0).reduce((s,t)=>s+t.pnlPct,0);
  const grossLoss=Math.abs(trades.filter(t=>t.pnlPct<0).reduce((s,t)=>s+t.pnlPct,0));
  const profitFactor=grossLoss>0?grossWin/grossLoss:(grossWin>0?99.9:0);
  const netPnl=trades.reduce((s,t)=>s+t.pnlPct,0);

  const pnls=trades.map(t=>t.pnlPct);
  const mean=pnls.length?pnls.reduce((a,b)=>a+b,0)/pnls.length:0;
  const variance=pnls.length?pnls.reduce((a,b)=>a+(b-mean)**2,0)/pnls.length:0;
  const std=Math.sqrt(variance);
  const sharpe=std>0?mean/std:0;

  // Equity curve + drawdown/estagnacao
  let running=0, peak=0, maxDd=0, lastHighTime=trades[0]?.entryTime||0, maxStagMs=0;
  const equityCurve=[];
  trades.forEach(t=>{
    running+=t.pnlPct;
    equityCurve.push(running);
    if(running>peak){peak=running; lastHighTime=t.exitTime;}
    const dd=peak-running;
    if(dd>maxDd)maxDd=dd;
    const stag=t.exitTime-lastHighTime;
    if(stag>maxStagMs)maxStagMs=stag;
  });
  const recoveryFactor=maxDd>0?netPnl/maxDd:(netPnl>0?99.9:0);

  const tp1Hits=trades.filter(t=>t.tpHits.includes('TP1')).length;
  const tp2Hits=trades.filter(t=>t.tpHits.includes('TP2')).length;
  const tp3Hits=trades.filter(t=>t.tpHits.includes('TP3')).length;

  // Performance por hora do dia (0-23) e dia da semana (0=domingo)
  const hourlyPnl=new Array(24).fill(0);
  const dailyPnl=new Array(7).fill(0);
  trades.forEach(t=>{
    const d=new Date(t.entryTime*1000);
    hourlyPnl[d.getHours()]+=t.pnlPct;
    dailyPnl[d.getDay()]+=t.pnlPct;
  });

  return{total,wins,losses,winRate,profitFactor,netPnl,sharpe,recoveryFactor,maxStagMs,
    tp1Hits,tp2Hits,tp3Hits,equityCurve,hourlyPnl,dailyPnl,trades};
}

async function runBacktestUI(){
  const btn=document.getElementById('btn-backtest-run');
  const resultsEl=document.getElementById('backtest-results');
  btn.disabled=true; btn.textContent='Rodando...';
  resultsEl.innerHTML='<div style="color:var(--t3);font-size:12px;text-align:center;padding:30px;">Buscando histórico...</div>';

  const sym=currentSym;
  const tf=document.getElementById('bt-tf').value;
  const signalKey=document.getElementById('bt-signal').value;
  const direction=document.getElementById('bt-direction').value;
  const useAtrFilter=document.getElementById('bt-choppy').value==='1';

  // Os tres primeiros sao os classicos que ja estavam. Os demais sao as medias
  // que o painel de fato usa — nao adiantava medir cruzamentos que voce nao olha.
  // Os dois ultimos misturam EMA com SMA, entao o runBacktest precisa aceitar
  // um isEma por perna em vez de um so pro par.
  const signalMap={
    '9-21-ema':{fastLen:9,slowLen:21,isEma:true},
    '12-26-ema':{fastLen:12,slowLen:26,isEma:true},
    '50-200-sma':{fastLen:50,slowLen:200,isEma:false},
    '8-16-ema':{fastLen:8,slowLen:16,isEma:true},
    '8-55-ema':{fastLen:8,slowLen:55,isEma:true},
    '16-55-ema':{fastLen:16,slowLen:55,isEma:true},
    '8-98-ema':{fastLen:8,slowLen:98,isEma:true},
    '16-98-ema':{fastLen:16,slowLen:98,isEma:true},
    '8-200-ema':{fastLen:8,slowLen:200,isEma:true},
    '16-200-ema':{fastLen:16,slowLen:200,isEma:true},
    '55-200-ema':{fastLen:55,slowLen:200,isEma:true},
    '56-89-sma':{fastLen:56,slowLen:89,isEma:false},
    '8-89-mix':{fastLen:8,slowLen:89,isEma:true,slowIsEma:false},
    '16-89-mix':{fastLen:16,slowLen:89,isEma:true,slowIsEma:false},
  };
  const sig=signalMap[signalKey];

  const cfg={
    ...sig, direction, useAtrFilter, atrFilterLen:50, atrLen:14,
    tp1:+document.getElementById('bt-tp1').value, tp2:+document.getElementById('bt-tp2').value, tp3:+document.getElementById('bt-tp3').value,
    sl1:+document.getElementById('bt-sl1').value, sl2:+document.getElementById('bt-sl2').value, sl3:+document.getElementById('bt-sl3').value,
    useTp1:true, useTp2:true, useTp3:true,
  };

  const d=await fetchCandles(sym,tf,1000);
  if(!backtestOpen||currentSym!==sym){btn.disabled=false;btn.textContent='▶ Rodar backtest';return;}
  if(!d||d.length<250){
    resultsEl.innerHTML='<div style="color:var(--red);font-size:12px;text-align:center;padding:30px;">Histórico insuficiente pra esse ativo/timeframe.</div>';
    btn.disabled=false; btn.textContent='▶ Rodar backtest';
    return;
  }

  const results=runBacktest(d,cfg);
  renderBacktestResults(results);
  btn.disabled=false; btn.textContent='▶ Rodar backtest';
}

function renderBacktestResults(r){
  const el=document.getElementById('backtest-results');
  if(r.total===0){
    el.innerHTML='<div style="color:var(--t3);font-size:12px;text-align:center;padding:30px;">Nenhum trade gerado com essa configuração nesse histórico.</div>';
    return;
  }
  const days=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const maxHourAbs=Math.max(...r.hourlyPnl.map(v=>Math.abs(v)),0.001);
  const maxDayAbs=Math.max(...r.dailyPnl.map(v=>Math.abs(v)),0.001);

  const statBox=(lbl,val,color)=>`<div class="stat-card" style="background:linear-gradient(160deg,var(--bg4),var(--bg3));border:1px solid var(--bd2);border-radius:9px;padding:10px 12px;box-shadow:0 3px 10px rgba(0,0,0,.18);">
    <div style="font-family:var(--mono);font-size:16px;font-weight:800;color:${color||'var(--text)'};">${val}</div>
    <div style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;margin-top:2px;">${lbl}</div>
  </div>`;

  el.innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:16px;">
      ${statBox('Total Trades', r.total)}
      ${statBox('Win Rate', r.winRate.toFixed(1)+'%', r.winRate>=50?'var(--green)':'var(--red)')}
      ${statBox('Profit Factor', r.profitFactor.toFixed(2), r.profitFactor>=1?'var(--green)':'var(--red)')}
      ${statBox('PnL Líquido', (r.netPnl>=0?'+':'')+r.netPnl.toFixed(1)+'%', r.netPnl>=0?'var(--green)':'var(--red)')}
      ${statBox('Sharpe', r.sharpe.toFixed(2))}
      ${statBox('Recovery Factor', r.recoveryFactor.toFixed(2))}
      ${statBox('Estagnação Máx.', Math.round(r.maxStagMs/86400000)+'d')}
    </div>

    <div class="sp-sec"><span>ALVOS PARCIAIS</span></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
      ${statBox('TP1 Hits', r.tp1Hits+' ('+(r.total?(r.tp1Hits/r.total*100).toFixed(0):0)+'%)','var(--green)')}
      ${statBox('TP2 Hits', r.tp2Hits+' ('+(r.total?(r.tp2Hits/r.total*100).toFixed(0):0)+'%)','var(--green)')}
      ${statBox('TP3 Hits', r.tp3Hits+' ('+(r.total?(r.tp3Hits/r.total*100).toFixed(0):0)+'%)','var(--green)')}
    </div>

    <div class="sp-sec"><span>DESEMPENHO POR HORA DO DIA</span></div>
    <div style="display:flex;align-items:flex-end;gap:2px;height:60px;margin-bottom:16px;padding:0 4px;">
      ${r.hourlyPnl.map((v,h)=>{
        const heightPct=Math.max(4,Math.abs(v)/maxHourAbs*100);
        const color=v>=0?'var(--green)':'var(--red)';
        return `<div title="${h}h: ${v.toFixed(1)}%" style="flex:1;height:${heightPct}%;background:${color};border-radius:2px 2px 0 0;opacity:.8;"></div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:2px;padding:0 4px;margin-top:-12px;margin-bottom:16px;">
      ${r.hourlyPnl.map((_,h)=>`<div style="flex:1;font-size:7.5px;color:var(--t3);text-align:center;">${h%3===0?h:''}</div>`).join('')}
    </div>

    <div class="sp-sec"><span>DESEMPENHO POR DIA DA SEMANA</span></div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:10px;">
      ${r.dailyPnl.map((v,i)=>{
        const alpha=0.15+Math.abs(v)/maxDayAbs*0.7;
        const bg=v>=0?`rgba(38,208,160,${alpha.toFixed(2)})`:`rgba(255,92,92,${alpha.toFixed(2)})`;
        return `<div style="background:${bg};border-radius:7px;padding:8px 4px;text-align:center;">
          <div style="font-size:9px;color:var(--t3);text-transform:uppercase;">${days[i]}</div>
          <div style="font-family:var(--mono);font-size:11px;font-weight:800;margin-top:3px;">${v.toFixed(1)}%</div>
        </div>`;
      }).join('')}
    </div>
    <div style="font-size:10px;color:var(--t3);line-height:1.5;">Simulação sem custo de spread/comissão. SL sempre avaliado antes do TP (conservador). PnL em % por trade, somado (não composto).</div>
  `;
}

let lastStudySnapshot=null;

async function updateStudyArchive(){
  const container=document.getElementById('study-cards');
  if(!container||!studyOpen)return;
  document.getElementById('study-sym').textContent=currentSym.replace('USDT','');
  const sym=currentSym;

  const results={};
  for(const tf of STUDY_KEYS){
    const d=await fetchCandles(sym, STUDY_TFS[tf], 60);
    if(!studyOpen||currentSym!==sym)return;
    if(d&&d.length>25){
      const closes=d.map(c=>c.close);
      results[tf]={
        ema8: computeEmaAngle(closes,8),
        ema16: computeEmaAngle(closes,16),
        fresh: freshCrossState(closes),
      };
    }else{
      results[tf]=null;
    }
  }
  lastStudySnapshot={sym, results, time:Date.now()};

  container.innerHTML=`<table style="width:100%;font-size:11.5px;border-collapse:collapse;">
    <thead><tr style="color:var(--t3);text-align:left;">
      <th style="padding:6px 10px;">TF</th><th style="padding:6px 10px;text-align:right;">Ângulo EMA8</th>
      <th style="padding:6px 10px;text-align:right;">Ângulo EMA16</th><th style="padding:6px 10px;text-align:center;">Cruzamento recente</th>
    </tr></thead>
    <tbody>
      ${STUDY_KEYS.map(tf=>{
        const r=results[tf];
        const e8=r&&r.ema8!=null?r.ema8.toFixed(1)+'°':'--';
        const e16=r&&r.ema16!=null?r.ema16.toFixed(1)+'°':'--';
        const e8Col=r&&r.ema8!=null?(r.ema8>=0?'var(--green)':'var(--red)'):'var(--t3)';
        const e16Col=r&&r.ema16!=null?(r.ema16>=0?'var(--green)':'var(--red)'):'var(--t3)';
        const fresh=r&&r.fresh;
        const freshTxt=fresh==='buy'?'🟢 compra':fresh==='sell'?'🔴 venda':'--';
        return `<tr style="border-top:1px solid var(--bd2);">
          <td style="padding:7px 10px;font-family:var(--mono);font-weight:800;">${STUDY_LBL[tf]}</td>
          <td style="padding:7px 10px;text-align:right;font-family:var(--mono);color:${e8Col};">${e8}</td>
          <td style="padding:7px 10px;text-align:right;font-family:var(--mono);color:${e16Col};">${e16}</td>
          <td style="padding:7px 10px;text-align:center;">${freshTxt}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function loadStudyArchiveList(){
  try{ return JSON.parse(localStorage.getItem(STUDY_ARCHIVE_KEY))||[]; }catch(e){ return []; }
}
function saveStudyArchiveList(list){ localStorage.setItem(STUDY_ARCHIVE_KEY, JSON.stringify(list)); }

function archiveStudyObservation(){
  if(!lastStudySnapshot){ alert('Aguarde o snapshot carregar antes de arquivar.'); return; }
  const list=loadStudyArchiveList();
  list.unshift({id:Date.now(), sym:lastStudySnapshot.sym, time:lastStudySnapshot.time, results:lastStudySnapshot.results});
  saveStudyArchiveList(list);
  renderStudyList();
}

function deleteStudyObservation(id){
  saveStudyArchiveList(loadStudyArchiveList().filter(o=>o.id!==id));
  renderStudyList();
}

function renderStudyList(){
  const list=loadStudyArchiveList();
  document.getElementById('study-archive-count').textContent=list.length;
  const el=document.getElementById('study-archive-list');
  if(!list.length){ el.innerHTML='<div style="color:var(--t3);font-size:11px;padding:10px 0;">Nenhuma observação arquivada ainda.</div>'; return; }
  el.innerHTML=list.map(o=>{
    const d=new Date(o.time);
    const dataStr=`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const cells=STUDY_KEYS.map(tf=>{
      const r=o.results[tf];
      const e8=r&&r.ema8!=null?r.ema8.toFixed(0):'--';
      const e16=r&&r.ema16!=null?r.ema16.toFixed(0):'--';
      return `<span style="margin-right:10px;font-family:var(--mono);font-size:10px;color:var(--t2);">${STUDY_LBL[tf]}: ${e8}/${e16}</span>`;
    }).join('');
    return `<div style="background:var(--bg3);border:1px solid var(--bd2);border-radius:8px;padding:9px 12px;margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-weight:800;font-family:var(--mono);">${o.sym.replace('USDT','')}</span>
        <span style="color:var(--t3);font-size:10.5px;">${dataStr}</span>
        <button onclick="deleteStudyObservation(${o.id})" style="background:none;border:none;color:var(--t3);cursor:pointer;">✕</button>
      </div>
      <div>${cells}</div>
    </div>`;
  }).join('');
}


// Ticks sao coalescidos por frame (igual o grafico principal) — com 4 ativos
// gerando aggTrade ao mesmo tempo, sem isso a aba travaria facil.
function scheduleMultiTick(sym,price,ts){
  multiPending[sym]={price,ts};
  if(multiTickScheduled)return;
  multiTickScheduled=true;
  requestAnimationFrame(()=>{
    multiTickScheduled=false;
    const batch=multiPending;multiPending={};
    for(const s in batch)applyMultiTick(s,batch[s].price,batch[s].ts);
  });
}

function applyMultiTick(sym,price,ts_ms){
  multiUltimoTick=Date.now();   // o vigia usa isto pra saber se ainda chega dado
  const mc=multiCharts[sym];if(!mc||!mc.candles.length||!mc.live)return;
  let last=mc.candles[mc.candles.length-1];
  const tfSec=tfToSeconds(currentTF);
  const nowSec=Math.floor(ts_ms/1000);
  const expected=nowSec-(nowSec%tfSec);
  // Salto grande (aba em segundo plano etc.): nao cria vela solta com buraco,
  // so espera o proximo reload/zoom resincronizar direitinho.
  if(expected>last.time+tfSec)return;

  let commit=false;
  if(expected>last.time){
    commit=true;
    const newC={time:expected,open:price,high:price,low:price,close:price,volume:0};
    mc.candles.push(newC);
    if(mc.candles.length>MULTI_HIST_CAP)mc.candles.shift();
    last=newC;
    try{mc.series.update(newC);}catch(e){}
  }else{
    last.close=price;
    if(price>last.high)last.high=price;
    if(price<last.low)last.low=price;
    try{mc.series.update({time:last.time,open:last.open,high:last.high,low:last.low,close:last.close});}catch(e){}
  }

  // O(1): avanca as medias a partir do baseline confirmado, sem varrer o array inteiro.
  const k=p=>2/(p+1);
  const e8=price*k(8)+(mc.live.ema8??price)*(1-k(8));
  const e16=price*k(16)+(mc.live.ema16??price)*(1-k(16));
  const e55=price*k(55)+(mc.live.ema55??price)*(1-k(55));
  const e98=price*k(98)+(mc.live.ema98??price)*(1-k(98));
  const e200=price*k(200)+(mc.live.ema200??price)*(1-k(200));
  const up=(s,v)=>{try{s.update({time:last.time,value:v});}catch(e){}};
  up(mc.ma.ema8,e8);up(mc.ma.ema16,e16);up(mc.ma.ema55,e55);up(mc.ma.ema98,e98);up(mc.ma.ema200,e200);
  const w56=[...mc.live.sma56Win,price].slice(-56),w89=[...mc.live.sma89Win,price].slice(-89);
  if(w56.length===56)up(mc.ma.ma56,w56.reduce((a,b)=>a+b,0)/56);
  if(w89.length===89)up(mc.ma.ma89,w89.reduce((a,b)=>a+b,0)/89);
  if(commit){
    mc.live.ema8=e8;mc.live.ema16=e16;mc.live.ema55=e55;mc.live.ema98=e98;mc.live.ema200=e200;
    mc.live.sma56Win=w56;mc.live.sma89Win=w89;
  }

  const pxEl=document.getElementById(`multi-px-${sym}`);
  if(pxEl)pxEl.textContent='$'+price.toFixed(sym.startsWith('XAG')?3:2);
}

// aggTrade = preco de cada execucao (delay zero), igual o grafico principal.
// Antes era so kline (~1x/seg) — por isso os precos do Multi pareciam "atrasados".
// UMA CONEXAO POR ATIVO. Antes os quatro iam num stream combinado
// (btcusdt@aggTrade/ethusdt@aggTrade/...), e XAUUSDT e XAGUSDT nao existem no
// futures da Binance: um nome invalido derruba a assinatura inteira, entao
// BTC e ETH morriam junto com o ouro e a prata. Por isso "os candles nao
// atualizam" — nenhum dos quatro recebia.
//
// Com uma conexao por ativo, um simbolo que a corretora nao serve fica so ele
// sem dado, e os outros seguem em tempo real. Quem nao recebe cai no vigia
// que recarrega as velas por HTTP.
let multiWSs={};
let multiTickPorSym={};

function fechaMultiWS(){
  Object.values(multiWSs).forEach(ws=>{ if(!ws)return; ws.onclose=null; try{ws.close();}catch(e){} });
  multiWSs={};
  multiWS=null;
}

function openMultiWS(){
  if(!multiViewOpen)return;
  const mySession=multiSession;
  MULTI_SYMS.forEach(sym=>{
    const atual=multiWSs[sym];
    if(atual&&atual.readyState<=1) return;   // ja conectando ou conectado
    let ws;
    try{ ws=new WebSocket(`wss://fstream.binance.com/ws/${sym.toLowerCase()}@aggTrade`); }
    catch(e){ return; }
    multiWSs[sym]=ws;
    multiWS=ws;   // compatibilidade: o resto do codigo olha esta referencia
    ws.onmessage=ev=>{
      try{
        const d=JSON.parse(ev.data);
        if(!d||!d.p) return;
        const price=parseFloat(d.p), ts=d.T||Date.now();
        if(!isFinite(price)||!multiCharts[sym]) return;
        multiTickPorSym[sym]=Date.now();
        scheduleMultiTick(sym,price,ts);
      }catch(e){}
    };
    ws.onclose=()=>{
      if(multiWSs[sym]===ws) multiWSs[sym]=null;
      // so reconecta se ainda for a mesma sessao, senao o Multi fechado e
      // reaberto acumularia conexoes
      if(multiViewOpen&&mySession===multiSession){
        setTimeout(()=>{ if(multiViewOpen&&mySession===multiSession) openMultiWS(); },3000);
      }
    };
  });
}

// ══════════════════════════════════════════════════════
// PAINEL DIREITO: abas OPERAR / ANALISE
// ══════════════════════════════════════════════════════
function switchRTab(tab){
  document.getElementById('tab-operar').classList.toggle('active',tab==='operar');
  document.getElementById('tab-analise').classList.toggle('active',tab==='analise');
  document.getElementById('body-operar').classList.toggle('active',tab==='operar');
  document.getElementById('body-analise').classList.toggle('active',tab==='analise');
  document.getElementById('nav-analise').classList.toggle('active',tab==='analise');
}

// ══════════════════════════════════════════════════════
// TICKET DE OPERACAO (estilo Deriv Multipliers)
// ══════════════════════════════════════════════════════
let ttSide='up', ttMultiplier=100;
const TF_LABELS={'1m':'1 minuto','5m':'5 minutos','15m':'15 minutos','30m':'30 minutos','1h':'1 hora','4h':'4 horas','1d':'1 dia'};

function setTTSide(side){
  ttSide=side;
  document.getElementById('tt-up').classList.toggle('sel',side==='up');
  document.getElementById('tt-down').classList.toggle('sel',side==='down');
  const b=document.getElementById('tt-buy-btn');
  b.className='tt-buy '+side;
  b.textContent=side==='up'?'Comprar':'Vender';
}

document.addEventListener('click',e=>{
  if(e.target.classList.contains('tt-chip')){
    document.querySelectorAll('.tt-chip').forEach(c=>c.classList.remove('sel'));
    e.target.classList.add('sel');
    ttMultiplier=parseInt(e.target.dataset.m,10);
    updateTTCalc();
  }
});

function updateTTCalc(){
  const stake=parseFloat(document.getElementById('tt-stake').value)||0;
  document.getElementById('tt-stopout').textContent='$'+stake.toFixed(2);
  document.getElementById('tt-expires').textContent=TF_LABELS[currentTF]||currentTF;
}


function onBuyClick(){
  const stake=parseFloat(document.getElementById('tt-stake').value)||0;
  const order={symbol:currentSym,side:ttSide,multiplier:ttMultiplier,stake,tf:currentTF};
  if(!derivAPI.connected){
    showInfoToast('Conecte sua conta Deriv em Configuracoes para operar de verdade. Ordem preparada: '+JSON.stringify(order));
    return;
  }
  derivAPI.buyContract(order);
}
updateTTCalc();

// ══════════════════════════════════════════════════════
// DADOS DE MERCADO DA DERIV — segunda leitura de oferta e procura
// ══════════════════════════════════════════════════════
// O derivAPI daqui de baixo e pra ENVIAR ORDEM e precisa de token. Este aqui e
// so leitura de mercado, que na Deriv e publica: basta o App ID, nenhum token.
//
// UMA RESSALVA QUE MUDA COMO SE LE O NUMERO:
// A Deriv NAO publica volume negociado. Ela e corretora de CFD, nao bolsa —
// nao ha livro central cujo volume dê pra publicar. O ticks_history devolve
// preco e horario, mais nada.
//
// O que da pra extrair dai e VOLUME DE TICK: quantas vezes o preco foi
// atualizado dentro da vela, e quantas dessas foram pra cima e pra baixo. E o
// padrao de quem opera cambio e CFD, onde volume real nao existe pra ninguem —
// atividade de tick anda junto com atividade de mercado.
//
// Entao NAO sao "dois pontos de volume" na mesma unidade. Sao duas medidas
// diferentes da mesma pergunta:
//   Binance  -> quanto DINHEIRO foi agressor comprador (dolar, do livro real)
//   Deriv    -> quantos TICKS foram pra cima (contagem, do feed da corretora)
// Quando as duas apontam junto, a leitura fica mais firme. Quando divergem,
// isso tambem e informacao: alguma das duas pontas esta vendo outra coisa.
const DERIV_SIMBOLO = {
  BTCUSDT:'cryBTCUSD', ETHUSDT:'cryETHUSD',
  XAUUSDT:'frxXAUUSD', XAGUSDT:'frxXAGUSD',
};
const DERIV_TICKS_HIST = 5000;   // teto que a API aceita por pedido

const derivDados = {
  ws:null, aberto:false, sym:null, pedido:0,
  porVela:{},          // time da vela -> {ticks, sobe, desce}
  ultimo:null,         // ultimo preco visto, pra classificar o proximo tick
  versao:0,
  erro:null,

  appId(){ try{ return localStorage.getItem('deriv_app_id')||''; }catch(e){ return ''; } },

  liga(){
    const id = this.appId();
    if(!id){ this.erro = "sem App ID"; renderConsolidacao(); return; }
    if(this.ws && (this.ws.readyState===0 || this.ws.readyState===1)){ this.pedeHistorico(); return; }
    this.erro = null;
    try{
      this.ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id="+encodeURIComponent(id));
    }catch(e){ this.erro = "nao abriu: "+e.message; renderConsolidacao(); return; }
    this.ws.onopen = () => { this.aberto = true; this.pedeHistorico(); renderConsolidacao(); };
    this.ws.onclose = () => { this.aberto = false; renderConsolidacao(); };
    this.ws.onerror = () => { this.erro = "conexao recusada"; renderConsolidacao(); };
    this.ws.onmessage = ev => { try{ this.recebe(JSON.parse(ev.data)); }catch(e){} };
  },

  desliga(){
    try{ if(this.ws) this.ws.close(1000); }catch(e){}
    this.ws=null; this.aberto=false; this.zera();
  },

  zera(){ this.porVela={}; this.ultimo=null; this.versao++; },

  pedeHistorico(){
    const alvo = DERIV_SIMBOLO[typeof currentSym!=="undefined"?currentSym:""];
    if(!this.ws || this.ws.readyState!==1) return;
    if(!alvo){ this.sym=null; this.zera(); this.erro="a Deriv nao tem este ativo"; renderConsolidacao(); return; }
    if(this.sym && this.sym!==alvo){
      // cancela a assinatura do ativo anterior, senao os ticks continuam vindo
      try{ this.ws.send(JSON.stringify({forget_all:"ticks"})); }catch(e){}
    }
    this.sym = alvo; this.erro = null; this.zera();
    // style:"ticks" e nao "candles" de proposito: a vela da Deriv vem sem
    // volume nenhum, entao ela nao acrescentaria nada ao que a Binance ja da.
    // O tick cru e que permite contar quantos houve e quantos subiram.
    this.ws.send(JSON.stringify({
      ticks_history: alvo, adjust_start_time:1, count:DERIV_TICKS_HIST,
      end:"latest", start:1, style:"ticks", subscribe:1, req_id:++this.pedido
    }));
  },

  balde(epochSeg){
    const tf = (typeof tfToSeconds==="function" && typeof currentTF!=="undefined")
      ? tfToSeconds(currentTF) : 900;
    return epochSeg - (epochSeg % tf);
  },

  // REGRA DO TICK: preco subiu = quem tinha pressa era comprador; desceu =
  // vendedor; igual nao conta pra lado nenhum. E aproximacao, nao a bandeira
  // de agressor que a Binance manda de verdade — mas e a mesma aproximacao que
  // o mercado de cambio usa ha decadas, por nao ter outra.
  come(preco, epochSeg){
    if(!isFinite(preco)) return;
    const t = this.balde(epochSeg);
    const v = this.porVela[t] || (this.porVela[t] = {ticks:0, sobe:0, desce:0});
    v.ticks++;
    if(this.ultimo != null){
      if(preco > this.ultimo) v.sobe++;
      else if(preco < this.ultimo) v.desce++;
    }
    this.ultimo = preco;
    const chaves = Object.keys(this.porVela);
    if(chaves.length > 400){
      chaves.sort((a,b)=>a-b).slice(0, chaves.length-400).forEach(k=>{ delete this.porVela[k]; });
    }
  },

  recebe(msg){
    if(msg.error){ this.erro = msg.error.message||"erro na Deriv"; renderConsolidacao(); return; }
    if(msg.msg_type === "history" && msg.history){
      const p = msg.history.prices||[], t = msg.history.times||[];
      this.zera();
      for(let i=0;i<p.length;i++) this.come(+p[i], +t[i]);
      this.versao++;
      renderConsolidacao();
      return;
    }
    if(msg.msg_type === "tick" && msg.tick){
      this.come(+msg.tick.quote, +msg.tick.epoch);
      this.versao++;
      return;
    }
  },

  // Pressao de tick das ultimas N velas: -100 (so desceu) a +100 (so subiu)
  pressao(nVelas){
    const chaves = Object.keys(this.porVela).map(Number).sort((a,b)=>a-b);
    if(!chaves.length) return null;
    const usadas = chaves.slice(-(nVelas||20));
    let sobe=0, desce=0, ticks=0;
    usadas.forEach(k=>{ const v=this.porVela[k]; sobe+=v.sobe; desce+=v.desce; ticks+=v.ticks; });
    const dir = sobe + desce;
    if(!dir) return null;
    return {velas:usadas.length, ticks, sobe, desce,
            pressao: (sobe-desce)/dir*100};
  }
};
window.derivDados = derivDados;

// ── CONSOLIDACAO: as duas pontas lado a lado ────────────────────────────
// A pergunta que as duas respondem e a mesma — de que lado esta a pressao —
// mas com dados diferentes e de livros diferentes. Concordancia reforca;
// divergencia e aviso de que uma das pontas esta vendo outra coisa.
function consolidaOfertaProcura(nVelas){
  let bin = null, der = null;
  try{ bin = forcaDoFluxo(nVelas||20); }catch(e){}
  try{ der = derivDados.pressao(nVelas||20); }catch(e){}
  const pb = (bin && (bin.compra+bin.venda) > 0) ? bin.pressao : null;
  const pd = der ? der.pressao : null;
  let acordo = null, quemEstaMorno = null;
  if(pb != null && pd != null){
    const mesmoLado = (pb >= 0) === (pd >= 0);
    const binForte = Math.abs(pb) >= 10, derForte = Math.abs(pd) >= 10;
    acordo = (binForte && derForte) ? (mesmoLado ? "concordam" : "divergem") : "morno";
    // dizer "fraca nos dois" quando so uma esta fraca e mentira pequena que
    // custa confianca: nomeio qual delas nao se decidiu
    if(acordo === "morno"){
      quemEstaMorno = (!binForte && !derForte) ? "ambas" : (binForte ? "deriv" : "binance");
    }
  }
  return {
    binance: pb==null ? null : {pressao:pb, compra:bin.compra, venda:bin.venda, velas:bin.velas},
    deriv:   pd==null ? null : {pressao:pd, ticks:der.ticks, sobe:der.sobe, desce:der.desce, velas:der.velas},
    acordo, quemEstaMorno,
    // media so quando as duas existem; peso igual, porque nao ha razao pra
    // confiar mais numa que na outra
    media: (pb!=null && pd!=null) ? (pb+pd)/2 : (pb!=null ? pb : pd)
  };
}
window.consolidaOfertaProcura = consolidaOfertaProcura;

function renderConsolidacao(){
  const box = document.getElementById('consolida-box'), cnt = document.getElementById('consolida-count');
  if(!box) return;
  const c = consolidaOfertaProcura(20);
  const cor = p => p >= 10 ? "#00C853" : (p <= -10 ? "#FF3B30" : "#F5A623");
  const linha = (rot, p, det) => p==null
    ? '<div style="font-size:9px;color:var(--t3);margin-bottom:5px;">'+rot+' <span style="color:var(--t3);">'+det+'</span></div>'
    : '<div style="font-size:9px;color:var(--t3);margin-bottom:2px;">'+rot
      +' <span style="color:'+cor(p)+';font-family:var(--mono);">'+(p>=0?"+":"")+p.toFixed(1)+'%</span>'
      +' <span style="color:var(--t3);">'+det+'</span></div>'
      +'<div style="position:relative;height:6px;background:var(--bg4);border-radius:3px;margin-bottom:6px;">'
      +'<span style="position:absolute;left:50%;top:-1px;width:1px;height:8px;background:var(--bd3);"></span>'
      +'<span style="position:absolute;left:'+(p>=0?50:50-Math.min(50,Math.abs(p)/2))+'%;width:'
      +Math.min(50,Math.abs(p)/2)+'%;height:100%;background:'+cor(p)+';border-radius:3px;"></span></div>';

  const detDeriv = c.deriv
    ? c.deriv.ticks.toLocaleString('pt-BR')+' ticks'
    : (derivDados.erro ? derivDados.erro : (derivDados.aberto ? 'aguardando...' : 'desligado'));

  if(cnt){
    cnt.textContent = c.acordo ? c.acordo : '--';
    cnt.style.color = c.acordo==="concordam" ? "#00C853"
      : c.acordo==="divergem" ? "#FF3B30" : "var(--t3)";
  }

  box.innerHTML =
      linha('Binance &middot; dinheiro agressor', c.binance?c.binance.pressao:null,
            c.binance ? 'em '+c.binance.velas+' velas' : 'aguardando negocios')
    + linha('Deriv &middot; ticks pra cima', c.deriv?c.deriv.pressao:null, detDeriv)
    + (c.acordo
        ? '<div style="font-size:8.5px;color:var(--t3);line-height:1.45;margin-top:3px;">'
          + (c.acordo==="concordam"
              ? 'As duas pontas apontam pro mesmo lado. E a leitura mais firme que da pra ter aqui.'
              : c.acordo==="divergem"
                ? 'As duas pontas discordam. O livro da Binance e o feed da Deriv estao contando historias diferentes — vale esperar.'
                : c.quemEstaMorno === "ambas"
                  ? 'Pressao fraca nos dois. Nao ha lado definido pra confirmar nem desmentir.'
                  : c.quemEstaMorno === "binance"
                    ? 'A Deriv tem lado, a Binance nao. Uma ponta so nao confirma nada — o dinheiro do livro grande esta indeciso.'
                    : 'A Binance tem lado, a Deriv nao. O dinheiro se moveu sem que o feed da corretora acompanhasse.')
          + '</div>'
        : '')
    + '<div style="font-size:8px;color:var(--t3);line-height:1.4;margin-top:4px;opacity:.8;">'
    + 'Unidades diferentes: a Binance mede DINHEIRO agressor, a Deriv conta TICKS pra cima — '
    + 'ela nao publica volume negociado. Sao duas medidas da mesma pergunta, nao a mesma medida duas vezes.</div>';
}
window.renderConsolidacao = renderConsolidacao;

// ══════════════════════════════════════════════════════
// DERIV API — apenas a estrutura, nada aqui se conecta de verdade ainda.
// Para operar de fato:
//   1. Crie um app_id gratuito em https://api.deriv.com
//   2. Gere um token de API na sua conta Deriv (Configuracoes > Seguranca > API Token)
//   3. NUNCA cole esse token no chat comigo — ele deve ficar so no seu navegador,
//      idealmente vindo de um input local ou variavel de ambiente, nunca hardcoded.
// ══════════════════════════════════════════════════════
const derivAPI = {
  ws:null, connected:false, appId:null, connectTimeout:null, attemptStartedAt:0,
  connect(appId){
    this.appId=appId;
    this.wasAuthorizing=false;
    this.attemptStartedAt=Date.now();
    try{
      this.ws=new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);
    }catch(e){
      setDerivStatus('off','App ID invalido ou malformado: '+e.message);
      return;
    }
    // Se o socket nao abrir em 8s, provavelmente o app_id nao existe ou a rede bloqueou.
    this.connectTimeout=setTimeout(()=>{
      if(!this.connected){
        setDerivStatus('off','Nao respondeu em 8s (timeout) — confira o App ID');
        try{this.ws.close();}catch(e){}
      }
    },8000);
    this.ws.onopen=()=>{
      console.log('[Deriv] socket aberto (ainda nao autorizado)');
      setDerivStatus('connecting','Autorizando...');
      const tokenEl=document.getElementById('deriv-token');
      const token=tokenEl?tokenEl.value.trim():'';
      this.wasAuthorizing=!!token;
      if(token)this.authorize(token);
      else{clearTimeout(this.connectTimeout);setDerivStatus('off','Cole o token de API tambem, ai clica em Conectar de novo');}
    };
    this.ws.onmessage=ev=>{try{this.handleMessage(JSON.parse(ev.data));}catch(e){}};
    this.ws.onclose=(ev)=>{
      clearTimeout(this.connectTimeout);
      this.connected=false;
      const ms=Date.now()-this.attemptStartedAt;
      // Sempre mostra codigo + tempo decorrido — mesmo um fechamento "normal" (1000)
      // logo apos abrir e um sinal de que o app_id foi rejeitado na hora.
      const code=ev&&ev.code!=null?ev.code:'?';
      const reason=ev&&ev.reason?': '+ev.reason:'';
      setDerivStatus('off',`Desconectado apos ${ms}ms (codigo ${code}${reason})`);
    };
    this.ws.onerror=(ev)=>{
      setDerivStatus('off','Erro no WebSocket — confira o App ID e sua internet');
    };
  },
  authorize(token){
    // O token so existe na memoria do seu navegador durante a sessao.
    if(this.ws)this.ws.send(JSON.stringify({authorize:token}));
  },
  handleMessage(msg){
    if(msg.msg_type==='authorize'){
      clearTimeout(this.connectTimeout);
      if(msg.error){setDerivStatus('off','Falha: '+msg.error.message+(msg.error.code?' ('+msg.error.code+')':''));return;}
      this.connected=true;
      setDerivStatus('grn','Conectado — '+(msg.authorize?.loginid||'conta autorizada'));
    }
    if(msg.error){
      console.warn('[Deriv] erro na resposta:',msg.error);
    }
    // TODO: tratar 'proposal', 'buy', 'portfolio', 'balance' quando vierem
  },
  disconnect(){
    clearTimeout(this.connectTimeout);
    if(this.ws)try{this.ws.close(1000);}catch(e){}
    this.connected=false;
    setDerivStatus('off','Desconectado');
  },
  buyContract({symbol,side,multiplier,stake}){
    // TODO: montar o payload real 'proposal' -> 'buy' da API da Deriv aqui.
    // Doc: https://api.deriv.com/api-explorer#buy
    console.log('[Deriv] compra (stub):',{symbol,side,multiplier,stake});
  }
};

// ══════════════════════════════════════════════════════
// MODAL DE CONFIGURACAO DA DERIV
// ══════════════════════════════════════════════════════
function toggleTokenVisibility(){
  const inp=document.getElementById('deriv-token'),eye=document.getElementById('token-eye');
  const show=inp.type==='password';
  inp.type=show?'text':'password';
  eye.textContent=show?'🙈':'👁';
}

function openDerivModal(){
  const saved=localStorage.getItem('deriv_app_id');
  if(saved)document.getElementById('deriv-appid').value=saved;
  document.getElementById('deriv-modal-overlay').classList.add('show');
}
function closeDerivModal(){document.getElementById('deriv-modal-overlay').classList.remove('show');}

function setDerivStatus(state,text){
  // state: 'off' | 'connecting' | 'grn'
  const d=document.getElementById('deriv-status-dot'),t=document.getElementById('deriv-status-txt');
  d.className = state==='grn' ? 'dot grn blink' : state==='connecting' ? 'dot off blink' : 'dot off';
  t.textContent=text;
  const btn=document.getElementById('deriv-connect-btn');
  if(state==='grn'){btn.textContent='Desconectar';btn.classList.add('disconnect');}
  else{btn.textContent='Conectar';btn.classList.remove('disconnect');}
}

function onDerivConnectClick(){
  if(derivAPI.connected){derivAPI.disconnect();return;}
  const appId=document.getElementById('deriv-appid').value.trim();
  if(!appId){alert('Preencha o App ID primeiro (crie um gratis em api.deriv.com).');return;}
  const token=document.getElementById('deriv-token').value.trim();
  if(token&&token.length<15){
    alert('Esse token parece curto demais (token de API da Deriv costuma ter varias dezenas de caracteres). Confere se colou o valor certo — usa o botao 👁 pra ver o que esta no campo.');
    return;
  }
  setDerivStatus('connecting','Conectando...');
  derivAPI.connect(appId);
  // O App ID tambem serve pra LEITURA de mercado, que nao precisa de token.
  // Sem esta linha, digitar o App ID nao ligava o painel Binance x Deriv ate a
  // proxima recarga da pagina — parecia que o App ID nao funcionava.
  try{ localStorage.setItem('deriv_app_id', appId); }catch(e){}
  try{ derivDados.desliga(); derivDados.liga(); }catch(e){}
}

// Botao proprio pra so a leitura de mercado: quem nao quer operar pela Deriv
// nao precisa passar pelo caminho de conta nenhuma pra ter o cruzamento.
function ligaDadosDeriv(){
  const campo=document.getElementById('deriv-appid');
  const appId=(campo&&campo.value||'').trim();
  if(!appId){ alert('Preencha o App ID primeiro (crie um gratis em api.deriv.com).'); return; }
  try{ localStorage.setItem('deriv_app_id', appId); }catch(e){}
  try{ derivDados.desliga(); derivDados.liga(); }catch(e){}
  if(typeof showInfoToast==="function")
    showInfoToast("DERIV","pedindo os ticks — o painel Binance x Deriv responde em instantes");
}
window.ligaDadosDeriv = ligaDadosDeriv;
function resetLive(){
  pendingTick=null; dragDraw=null; isDragging=false;
  lastTradeAt=0; h1StochAt=0; h1StochCache={k:null,d:null};
  signals=[]; currentMarkers=[]; fibState=mkFib();
  bullFlowPrev=false; bearFlowPrev=false;
  noMoreHistory=false; loadingMoreHistory=false; loadingFullHistory=false;
  lastSig={atlasB:-99,atlasS:-99,goldB:-99,goldS:-99,stressB:-99,stressS:-99,rbB:-99,rbS:-99,sqzBk:-99,sqzS:-99,h1B:-99,h1S:-99};
  renderSignalLog();
}
async function changeSym(sym){
  currentSym=sym;candles=[];resetLive();
  // negocio do ativo anterior nao vale aqui
  fluxoNegocios=[]; fluxoPorVela={}; fluxoCorte=0; bolhasCache=null; estatFluxo=null;
  avisouFluxoSemFonte=false; divergAnterior=null;
  // ativo novo: o historico de ticks e de outro simbolo, e o balde da vela
  // muda com o tempo grafico — pede tudo de novo
  try{ derivDados.pedeHistorico(); }catch(e){}
  resetaAlarmes();
  // alarmes e niveis de fibo sao guardados por simbolo
  carregaAlarmesManuais(); carregaFibNiveis(); carregaFontesAlarme(); carregaObservacoes();
  if(typeof iniciaForca==="function") iniciaForca();
  const sel=document.getElementById('sym-select');
  if(sel&&sel.value!==sym)sel.value=sym;
  await loadAll();
  if(rainbowOpen)updateRainbowTab();
  if(confluatorGoldOpen)updateConfluatorGold();
}
async function changeTF(tf){
  currentTF=tf;candles=[];resetLive();
  // o balde da vela e o tempo grafico: mudou o tempo, os ticks da Deriv
  // precisam ser reagrupados do zero
  try{ derivDados.pedeHistorico(); }catch(e){}
  // os desenhos sao guardados por simbolo+TF, entao o fibo do 15m nao vale no
  // 1h — a referencia de preco tem que zerar junto
  resetaAlarmes();
  if(multiViewOpen){closeMultiCharts();openMultiCharts();}
  await loadAll();
}
async function loadAll(){
  // o loadAll tambem roda quando a aba volta do segundo plano depois de um
  // salto de varias velas; sem zerar, o primeiro tick depois disso dispararia
  // todo o caminho que o preco andou enquanto ninguem olhava
  resetaAlarmes();
  const mySeq=++loadSeq, mySym=currentSym, myTf=currentTF;
  document.getElementById('ws-st').textContent='Carregando...';
  const d=await fetchCandles(mySym,myTf,1000);
  if(mySeq!==loadSeq)return;
  if(!d){document.getElementById('ws-st').textContent='Erro de Conexao';return;}
  candles=d;
  fluxoPorVela={}; bolhasCache=null; estatFluxo=null;
  semeiaFluxoDoHistorico();

  // RENDERIZA O GRAFICO PRINCIPAL + STOCHRSI + RIBBON PHI INSTANTANEAMENTE!
  renderChart();
  if(!multiViewOpen)openWS();

  // MTF e Micro carregam em segundo plano sem travar a tela
  Promise.all([fetchMTF(), fetchMicro()]).then(()=>{
    if(mySeq===loadSeq){
      try{ updateMTFPanel(calcMTF()); }catch(e){}
      try{ updateMicroPanel(calcMicro()); }catch(e){}
    }
  });
}

// ══════════════════════════════════════════════════════
// DRAWING ENGINE (overlay em canvas)
// ══════════════════════════════════════════════════════
// Antes cada nivel do fib virava um createPriceLine, e os 24 rotulos se
// empilhavam ilegiveis no eixo. Agora tudo e desenhado num canvas por cima do
// grafico: o chart continua 100% interativo e temos controle total do texto.

// Niveis e cores do setup original (24 niveis) - inalterados
const fibColors = {
  0: '#9e9e9e', 0.236: '#F44336', 0.382: '#FF9800', 0.5: '#4CAF50',
  0.618: '#009688', 0.786: '#00BCD4', 1: '#00BCD4', 1.618: '#2196F3',
  2.444: '#E91E63', 2.666: '#E91E63', 3.444: '#FF9800', 3.666: '#009688',
  4.666: '#9C27B0', 5.555: '#FF9800', 5.666: '#9C27B0', 6.999: '#F44336',
  7.333: '#F44336', 7.777: '#2196F3', 8.111: '#00BCD4', 8.222: '#00BCD4',
  8.333: '#00BCD4', 8.444: '#9e9e9e', 9.999: '#2196F3', 11.101: '#F44336'
};
const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.444, 2.666, 3.444, 3.666, 4.666, 5.555, 5.666, 6.999, 7.333, 7.777, 8.111, 8.222, 8.333, 8.444, 9.999, 11.101];

// Fib de RETRACAO pra acumulacoes — niveis proprios (nao sao os fib
// tradicionais), incluindo extensao NEGATIVA. Os niveis negativos marcam onde
// voce opera possiveis quebras/springs da acumulacao. Vai so ate 1.633 —
// esse fib nao serve pra alvo longo, e pra ler a estrutura interna do range.
const fibRetrColors = {
  '-0.888':'#9C27B0', '-0.555':'#E91E63', '-0.333':'#F44336', '-0.222':'#FF9800', '-0.111':'#FFC107',
  0:'#9e9e9e',
  0.111:'#FFC107', 0.222:'#FF9800', 0.333:'#F44336', 0.555:'#E91E63', 0.888:'#9C27B0',
  1:'#00BCD4', 1.555:'#2196F3', 1.633:'#3F51B5'
};
const fibRetrLevels = [-0.888,-0.555,-0.333,-0.222,-0.111,0,0.111,0.222,0.333,0.555,0.888,1,1.555,1.633];

// Zona de quebra — os mesmos niveis negativos do Fib Retracao, agora ligados
// tambem na extensao de 24 niveis (fibbo). So a ZONA visual, nao entra na
// cascata de hits do motor automatico (fibState), que continua 100% intacta.
// Regra: so conta como quebra real se o preco FECHAR abaixo do 0 — s
// pavio tocando nao e o choque de oferta/demanda que muda a direcao.
const fibBreakLevels = [-0.111,-0.222,-0.333,-0.555,-0.888];

let dCanvas, dCtx;
// canvas proprio das bolhas, atras do grafico. Antes elas dividiam o canvas de
// desenho, que fica NA FRENTE — e por isso tingiam a vela por cima.
let bCanvas, bCtx;
// indice da vela -> 'dia'|'semana'|'mes', e quais deles cairam em momento frio
// com o RSI cruzando (esses ganham brilho forte)
let marcosVolume = {}, marcosFortes = {};
let activeTool = 'cursor';
let drawColor = '#FFEB3B';
let magnetOn = false;
let drawStore = {};          // chave: SIMBOLO_TF -> lista de desenhos
let dragDraw = null;         // desenho em andamento (clique -> arrasta -> solta)
let isDragging = false;
const TWO_POINT = ['ray','rect','fibbo','fibretr'];
const FREEHAND = ['pencil']; // traco livre: clica, arrasta, solta — captura varios pontos
const PENCIL_MAX = 3; // mantem so os ultimos 3 tracos de lapis por simbolo/timeframe

function storeKey(){ return `${currentSym}_${currentTF}`; }
function drawings(){
  const k = storeKey();
  if(!drawStore[k]) drawStore[k] = [];
  return drawStore[k];
}

function initDrawingTools(){
  dCanvas = document.getElementById('draw-canvas');
  dCtx = dCanvas.getContext('2d');
  bCanvas = document.getElementById('bolha-canvas');
  if(bCanvas) bCtx = bCanvas.getContext('2d');
  resizeDrawCanvas();

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn=>{
    btn.addEventListener('click',()=>setTool(btn.dataset.tool===activeTool?'cursor':btn.dataset.tool));
  });
  document.getElementById('tool-clear').addEventListener('click',()=>{
    drawStore[storeKey()] = [];
    dragDraw = null; isDragging = false;
    redrawDrawings();
  });
  document.getElementById('tool-undo').addEventListener('click',undoDrawing);
  const magBtn = document.getElementById('tool-magnet');
  magBtn.addEventListener('click',()=>{
    magnetOn = !magnetOn;
    magBtn.classList.toggle('magnet-on',magnetOn);
    magBtn.querySelector('.tool-tip').textContent = `Ima OHLC: ${magnetOn?'ON':'OFF'}`;
  });

  const colorSw = document.getElementById('tool-color-sw');
  const swatches = document.getElementById('tool-swatches');
  colorSw.addEventListener('click',e=>{e.stopPropagation();swatches.classList.toggle('show');});
  document.addEventListener('click',()=>swatches.classList.remove('show'));
  swatches.querySelectorAll('.tool-sw').forEach(sw=>{
    sw.addEventListener('click',e=>{
      e.stopPropagation();
      drawColor = sw.dataset.c;
      colorSw.style.background = drawColor;
      swatches.querySelectorAll('.tool-sw').forEach(s=>s.classList.remove('sel'));
      sw.classList.add('sel');
      swatches.classList.remove('show');
    });
  });

  dCanvas.addEventListener('mousedown',onCanvasDown);
  dCanvas.addEventListener('mousemove',onCanvasMove);
  window.addEventListener('mouseup',onCanvasUp);
  dCanvas.addEventListener('mouseleave',()=>{
    if(isDragging){ /* mantem o arrasto ativo mesmo se sair do canvas por um instante */ }
  });

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){dragDraw=null;isDragging=false;setTool('cursor');}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undoDrawing();}
  });

  // Os desenhos sao ancorados em tempo/preco, entao seguem pan e zoom
  // Sincronizacao continua: sem isso, arrastar o eixo de preco (zoom vertical)
  // ou o autoscale ao vivo empurrando o range nao redesenhava os tracos —
  // so o pan/zoom horizontal disparava redraw. Agora qualquer mudanca visual
  // (preco, tempo, resize, autoscale) mantem os desenhos grudados no lugar certo.
  chart.timeScale().subscribeVisibleLogicalRangeChange(()=>redrawDrawings());
  startDrawSyncLoop();
}

let syncLoopRunning = false;
function startDrawSyncLoop(){
  if(syncLoopRunning) return;
  syncLoopRunning = true;
  const loop = () => {
    // Blindado: se redrawDrawings() lancar qualquer excecao (ex: um estado
    // transitorio do chart durante troca de simbolo), o loop NAO pode morrer —
    // antes, um unico erro parava a sincronizacao do zoom pra sempre.
    try{
      if(drawings().length || isDragging) redrawDrawings();
    }catch(e){
      console.warn('[draw-sync] erro num frame, seguindo pro proximo:',e);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function setTool(tool){
  activeTool = tool;
  dragDraw = null; isDragging = false;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
  dCanvas.className = tool==='cursor' ? '' : `armed tool-${tool}`;
  redrawDrawings();
}

function undoDrawing(){
  const arr = drawings();
  if(isDragging){dragDraw=null;isDragging=false;}
  else if(arr.length){arr.pop();}
  redrawDrawings();
}

function resizeDrawCanvas(){
  if(!dCanvas) return;
  const r = document.getElementById('chart').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  dCanvas.width = Math.max(1, r.width*dpr);
  dCanvas.height = Math.max(1, r.height*dpr);
  dCtx.setTransform(dpr,0,0,dpr,0,0);
  if(bCanvas){
    bCanvas.width = dCanvas.width; bCanvas.height = dCanvas.height;
    bCtx.setTransform(dpr,0,0,dpr,0,0);
  }
  redrawDrawings();
}

// ── conversoes tempo/preco <-> pixel ──
function t2x(t){ return chart.timeScale().timeToCoordinate(t); }
function p2y(p){ return candleSeries.priceToCoordinate(p); }
function chartRect(){ return document.getElementById('chart').getBoundingClientRect(); }
// Largura util: desconta o eixo de precos, senao linhas e rotulos ficam por baixo dele
function plotWidth(){
  const w = chartRect().width;
  try{ return w - chart.priceScale('right').width(); }catch(e){ return w-70; }
}

function eventToPoint(e){
  const r = dCanvas.getBoundingClientRect();
  const x = e.clientX-r.left, y = e.clientY-r.top;
  const time = chart.timeScale().coordinateToTime(x);
  let price = candleSeries.coordinateToPrice(y);
  if(time==null||price==null) return null;
  if(magnetOn) price = snapOHLC(time,price);
  return {x,y,time,price};
}

// Ima: encruva o clique no O/H/L/C mais proximo da vela
function snapOHLC(time,raw){
  const c = candles.find(x=>x.time===time);
  if(!c) return raw;
  return [c.high,c.low,c.open,c.close]
    .map(v=>({v,d:Math.abs(raw-v)}))
    .sort((a,b)=>a.d-b.d)[0].v;
}

function onCanvasMove(e){
  if(!isDragging||!dragDraw) return;
  const pt = eventToPoint(e);
  if(!pt) return;
  if(dragDraw.type==='pencil'){
    // So adiciona o ponto se ele mudou de vela, pra nao inflar o array com pontos repetidos
    const lastPt=dragDraw.points[dragDraw.points.length-1];
    if(!lastPt||lastPt.time!==pt.time||lastPt.price!==pt.price)dragDraw.points.push({time:pt.time,price:pt.price});
  }else{
    dragDraw.p1 = {time:pt.time,price:pt.price};
  }
  redrawDrawings();
}

function onCanvasDown(e){
  if(activeTool==='cursor') return;
  const pt = eventToPoint(e);
  if(!pt) return;

  if(activeTool==='eraser'){ eraseAt(pt.x,pt.y); return; }

  if(activeTool==='horizontal'){
    drawings().push({type:'horizontal',p0:{time:pt.time,price:pt.price},color:drawColor});
    redrawDrawings(); return; // ferramenta continua armada: da pra desenhar mais sem reclicar
  }
  if(activeTool==='vertical'){
    drawings().push({type:'vertical',p0:{time:pt.time,price:pt.price},color:drawColor});
    redrawDrawings(); return;
  }
  if(activeTool==='text'){
    const txt = prompt('Texto:');
    if(txt) drawings().push({type:'text',p0:{time:pt.time,price:pt.price},text:txt,color:drawColor});
    redrawDrawings(); return;
  }

  if(FREEHAND.includes(activeTool)){
    isDragging = true;
    dragDraw = {type:activeTool,points:[{time:pt.time,price:pt.price}],color:drawColor};
    redrawDrawings();
    return;
  }

  if(TWO_POINT.includes(activeTool)){
    // Clique -> arrasta -> solta, igual TradingView. p0 fica no ponto onde
    // o botao foi pressionado (a ancora do fib); p1 acompanha o mouse.
    isDragging = true;
    dragDraw = {type:activeTool,p0:{time:pt.time,price:pt.price},p1:{time:pt.time,price:pt.price},color:drawColor};
    redrawDrawings();
  }
}

function onCanvasUp(e){
  if(!isDragging||!dragDraw) return;
  const pt = eventToPoint(e);
  isDragging = false;

  if(dragDraw.type==='pencil'){
    if(dragDraw.points.length>1){
      const arr=drawings();
      arr.push(dragDraw);
      // Mantem so os ultimos 3 tracos de lapis: some com o mais antigo alem disso.
      let pencilCount=arr.filter(d=>d.type==='pencil').length;
      for(let i=0;i<arr.length&&pencilCount>PENCIL_MAX;i++){
        if(arr[i].type==='pencil'){arr.splice(i,1);i--;pencilCount--;}
      }
    }
  }else if(pt && pt.time!==dragDraw.p0.time){
    drawings().push({...dragDraw,p1:{time:pt.time,price:pt.price}});
  }
  dragDraw = null;
  // Ferramenta continua armada: da pra desenhar outro fib/linha em seguida
  // sem precisar clicar no botao de novo. So o Esc ou o botao Cursor tiram do modo.
  redrawDrawings();
}

function eraseAt(x,y){
  const arr = drawings();
  for(let i=arr.length-1;i>=0;i--){
    if(hitTest(arr[i],x,y,8)){ arr.splice(i,1); redrawDrawings(); return; }
  }
}

function hitTest(d,x,y,tol){
  if(d.type==='pencil'){
    if(!d.points||d.points.length<2)return false;
    for(let i=1;i<d.points.length;i++){
      const x0=t2x(d.points[i-1].time),y0=p2y(d.points[i-1].price);
      const x1=t2x(d.points[i].time),y1=p2y(d.points[i].price);
      if(x0==null||y0==null||x1==null||y1==null)continue;
      const dx=x1-x0,dy=y1-y0,len2=dx*dx+dy*dy;
      let t=len2?((x-x0)*dx+(y-y0)*dy)/len2:0;
      t=Math.max(0,Math.min(1,t));
      if(Math.hypot(x-(x0+t*dx),y-(y0+t*dy))<tol)return true;
    }
    return false;
  }
  const x0=t2x(d.p0.time), y0=p2y(d.p0.price);
  if(x0==null||y0==null) return false;
  if(d.type==='text')       return Math.hypot(x-x0,y-y0)<20;
  if(d.type==='horizontal') return Math.abs(y-y0)<tol;
  if(d.type==='vertical')   return Math.abs(x-x0)<tol;

  const x1=t2x(d.p1.time), y1=p2y(d.p1.price);
  if(x1==null||y1==null) return false;

  if(d.type==='rect'){
    const a=Math.min(x0,x1),b=Math.max(x0,x1),c=Math.min(y0,y1),e=Math.max(y0,y1);
    const edge=Math.abs(x-a)<tol||Math.abs(x-b)<tol||Math.abs(y-c)<tol||Math.abs(y-e)<tol;
    return x>=a-tol&&x<=b+tol&&y>=c-tol&&y<=e+tol&&edge;
  }
  if(d.type==='fibbo'||d.type==='fibretr'){
    const diff = d.p0.price-d.p1.price;
    const levels = d.type==='fibretr' ? fibRetrLevels : [...fibLevels,...fibBreakLevels];
    return levels.some(lv=>{
      const py = p2y(d.p1.price+diff*lv);
      return py!=null && Math.abs(y-py)<tol;
    });
  }
  if(d.type==='ray'){
    // O raio e desenhado esticado ate a borda do grafico — testa contra o
    // segmento inteiro (ancora ate a ponta esticada), nao so ate o 2o clique.
    const r=chartRect();
    const ext=extendRay(x0,y0,x1,y1,r.width,r.height);
    const dx=ext.x-x0,dy=ext.y-y0,len2=dx*dx+dy*dy;
    let t=len2?((x-x0)*dx+(y-y0)*dy)/len2:0;
    t=Math.max(0,Math.min(1,t));
    return Math.hypot(x-(x0+t*dx),y-(y0+t*dy))<tol;
  }
  // fallback generico: distancia ponto-segmento
  const dx=x1-x0, dy=y1-y0, len2=dx*dx+dy*dy;
  let t = len2 ? ((x-x0)*dx+(y-y0)*dy)/len2 : 0;
  t = Math.max(0,Math.min(1,t));
  return Math.hypot(x-(x0+t*dx), y-(y0+t*dy)) < tol;
}

// Estica o segmento p0->p1 alem de p1, ate encostar na borda do retangulo do
// grafico (width x height), formando um raio de extensao "infinita".
function extendRay(x0,y0,x1,y1,width,height){
  const dx=x1-x0,dy=y1-y0;
  if(dx===0&&dy===0)return{x:x1,y:y1};
  let tMax=Infinity;
  if(dx>0)tMax=Math.min(tMax,(width-x0)/dx);
  else if(dx<0)tMax=Math.min(tMax,(0-x0)/dx);
  if(dy>0)tMax=Math.min(tMax,(height-y0)/dy);
  else if(dy<0)tMax=Math.min(tMax,(0-y0)/dy);
  if(!isFinite(tMax)||tMax<1)tMax=1;
  return{x:x0+dx*tMax,y:y0+dy*tMax};
}

function redrawDrawings(){
  if(!dCtx||!dCanvas||!chart) return;
  const r = chartRect();
  dCtx.clearRect(0,0,r.width,r.height);
  const arr = drawings();
  arr.forEach(d=>{
    try{paint(d,false);}catch(e){console.warn('[draw] falha ao desenhar um item, seguindo:',e);}
  });
  // as bolhas por ultimo, por cima dos desenhos
  try{ desenhaBolhas(); }catch(e){}
  if(isDragging&&dragDraw){
    try{paint(dragDraw,true);}catch(e){}
  }
  // Legenda lateral reflete o ultimo fib desenhado — um pra cada tipo
  const lastFib = [...arr].reverse().find(d=>d.type==='fibbo');
  renderFibLegend(lastFib);
  const lastFibRetr = [...arr].reverse().find(d=>d.type==='fibretr');
  renderFibRetrLegend(lastFibRetr);
}

function paint(d,ghost){
  const r = chartRect();
  dCtx.save();
  dCtx.lineWidth = 1.6;
  dCtx.font = '600 10px IBM Plex Sans, sans-serif';
  dCtx.strokeStyle = d.color; dCtx.fillStyle = d.color;
  dCtx.globalAlpha = ghost ? .7 : 1;
  if(ghost) dCtx.setLineDash([5,4]);

  if(d.type==='pencil'){
    if(!d.points||d.points.length<2){dCtx.restore();return;}
    dCtx.lineJoin='round';dCtx.lineCap='round';
    dCtx.beginPath();
    let started=false;
    d.points.forEach(pt=>{
      const x=t2x(pt.time),y=p2y(pt.price);
      if(x==null||y==null)return;
      if(!started){dCtx.moveTo(x,y);started=true;}else dCtx.lineTo(x,y);
    });
    dCtx.stroke();
    dCtx.restore();
    return;
  }

  const x0=t2x(d.p0.time), y0=p2y(d.p0.price);
  if(x0==null||y0==null){ dCtx.restore(); return; }

  if(d.type==='text'){
    dCtx.fillText(d.text, x0+5, y0-5);
    dCtx.beginPath(); dCtx.arc(x0,y0,2.5,0,Math.PI*2); dCtx.fill();
    dCtx.restore(); return;
  }
  if(d.type==='horizontal'){
    const pw = plotWidth();
    dCtx.beginPath(); dCtx.moveTo(0,y0); dCtx.lineTo(pw,y0); dCtx.stroke();
    label(d.p0.price.toFixed(2), pw-6, y0-4, d.color, 'right');
    dCtx.restore(); return;
  }
  if(d.type==='vertical'){
    dCtx.beginPath(); dCtx.moveTo(x0,0); dCtx.lineTo(x0,r.height); dCtx.stroke();
    dCtx.restore(); return;
  }

  const x1=t2x(d.p1.time), y1=p2y(d.p1.price);
  if(x1==null||y1==null){ dCtx.restore(); return; }

  if(d.type==='ray'){
    // Estica alem do 2o ponto ate a borda do grafico — raio de extensao "infinita".
    const ext=extendRay(x0,y0,x1,y1,r.width,r.height);
    dCtx.beginPath(); dCtx.moveTo(x0,y0); dCtx.lineTo(ext.x,ext.y); dCtx.stroke();
    dCtx.setLineDash([]);
    // So marca os 2 pontos que definem o angulo, nao a ponta esticada
    [[x0,y0],[x1,y1]].forEach(([px,py])=>{dCtx.beginPath();dCtx.arc(px,py,3,0,Math.PI*2);dCtx.fill();});
  }
  else if(d.type==='rect'){
    const rx=Math.min(x0,x1), ry=Math.min(y0,y1);
    const rw=Math.abs(x1-x0), rh=Math.abs(y1-y0);
    dCtx.globalAlpha = ghost?.1:.14; dCtx.fillRect(rx,ry,rw,rh);
    dCtx.globalAlpha = ghost?.7:1;   dCtx.strokeRect(rx,ry,rw,rh);
  }
  else if(d.type==='fibbo'||d.type==='fibretr'){
    // Nivel 0 no 2o ponto e nivel 1 na ancora: mesma convencao do setup original
    const diff = d.p0.price-d.p1.price;
    // No fibbo (extensao), soma a zona de quebra negativa por cima dos 24
    // niveis normais — sao dois conceitos (continuacao x invalidacao), mas
    // desenhados juntos pra voce ver os dois de uma vez no mesmo fib.
    const levels = d.type==='fibretr' ? fibRetrLevels : [...fibLevels,...fibBreakLevels];
    const colors = d.type==='fibretr' ? fibRetrColors : {...fibColors,...fibRetrColors};
    const rows = levels
      .map(lv=>({lv, price:d.p1.price+diff*lv, y:p2y(d.p1.price+diff*lv)}))
      .filter(r0=>r0.y!=null && r0.y>-40 && r0.y<r.height+40)
      .sort((a,b)=>a.y-b.y);
    const pw = plotWidth();
    let lastY = -99;
    rows.forEach(row=>{
      const col = colors[row.lv] || '#FFFFFF';
      const isBreak = d.type==='fibbo' && row.lv<0;
      dCtx.strokeStyle = col; dCtx.fillStyle = col;
      dCtx.globalAlpha = ghost?.5:.85;
      if(isBreak)dCtx.setLineDash([4,3]); // tracejado pra diferenciar visualmente da extensao normal
      dCtx.beginPath(); dCtx.moveTo(0,row.y); dCtx.lineTo(pw,row.y); dCtx.stroke();
      if(isBreak)dCtx.setLineDash(ghost?[5,4]:[]);
      // Rotulo apenas quando nao colide com o anterior: evita a pilha ilegivel
      if(row.y-lastY > 11){
        label(`${row.lv}${isBreak?' quebra':''}  ${row.price.toFixed(2)}`, pw-6, row.y-3, col, 'right');
        lastY = row.y;
      }
    });
  }
  dCtx.restore();
}

// Texto com fundo contrastante pra continuar legivel sobre as velas.
// O fundo acompanha o tema: claro no modo claro, escuro no modo escuro.
function label(txt,x,y,color,align){
  dCtx.save();
  dCtx.font='600 10px IBM Plex Sans, sans-serif';
  dCtx.textAlign = align||'left';
  const w = dCtx.measureText(txt).width;
  dCtx.globalAlpha=.8; dCtx.fillStyle=(typeof theme==='function'?theme().fibLabelBg:'#ffffff');
  dCtx.fillRect(align==='right'?x-w-4:x-2, y-9, w+6, 12);
  dCtx.globalAlpha=1; dCtx.fillStyle=color;
  dCtx.fillText(txt,x,y);
  dCtx.restore();
}

// Lista completa dos 24 niveis + zona de quebra negativa, com preco exato
function renderFibLegend(d){
  // se o fibo mudou de lugar, o que estava marcado vira alarme de preco
  try{ fibConfereAncora(d); }catch(e){}
  const list=document.getElementById('mfib-list'), cnt=document.getElementById('mfib-count');
  if(!list) return;
  if(!d){
    list.innerHTML='<div style="color:var(--t3);font-size:9px;padding:4px 0;">Desenhe um fib no grafico...</div>';
    cnt.textContent='--'; return;
  }
  const diff = d.p0.price-d.p1.price;
  const px = candles.length ? candles[candles.length-1].close : null;
  const allLevels=[...fibLevels,...fibBreakLevels];
  cnt.textContent = `${allLevels.length} niv`;
  list.innerHTML = allLevels.map(lv=>{
    const price = d.p1.price+diff*lv;
    const col = (fibColors[lv]||fibRetrColors[lv])||'#FFFFFF';
    const isBreak = lv<0;
    // destaca o nivel que o preco ja atingiu — pra quebra, so conta fechamento
    // abaixo, entao usa close (nao high/low) igual a regra combinada
    const hit = px!=null && (isBreak ? px<=price : (diff>0 ? px>=price : px<=price));
    // clicar no nivel liga/desliga o alarme dele
    const alarmado=fibMarcado(lv);
    return `<div class="mfib-item" style="opacity:${hit?1:.62};cursor:pointer;"
      onclick="toggleFibNivel(${lv})" title="clique para ligar/desligar o alarme deste nivel">
      <span style="width:11px;display:inline-block;font-size:9px;">${alarmado?'\u{1F514}':''}</span>
      <span class="mfib-dot" style="background:${col};"></span>
      <span class="mfib-lvl" style="color:${col};">${lv}${isBreak?' <span style="color:var(--goldd);font-weight:700;">quebra</span>':''}</span>
      <span class="mfib-px">${price.toFixed(2)}</span></div>`;
  }).join('');
}

// Fib de retracao (acumulacao) — mesma ideia, mas os niveis negativos ganham
// uma tag "quebra/spring" porque e ali que voce opera a possivel varredura
// antes do movimento seguir (o padrao rompimento -> recuo -> spring -> alvo).
function renderFibRetrLegend(d){
  const list=document.getElementById('mfibretr-list'), cnt=document.getElementById('mfibretr-count');
  if(!list) return;
  if(!d){
    list.innerHTML='<div style="color:var(--t3);font-size:9px;padding:4px 0;">Desenhe um fib retracao no grafico...</div>';
    if(cnt)cnt.textContent='--'; return;
  }
  const diff = d.p0.price-d.p1.price;
  const px = candles.length ? candles[candles.length-1].close : null;
  if(cnt)cnt.textContent = `${fibRetrLevels.length} niv`;
  list.innerHTML = fibRetrLevels.map(lv=>{
    const price = d.p1.price+diff*lv;
    const col = fibRetrColors[lv]||'#FFFFFF';
    const hit = px!=null && (diff>0 ? px>=price : px<=price);
    const isSpringZone = lv<0;
    return `<div class="mfib-item" style="opacity:${hit?1:.62};">
      <span class="mfib-dot" style="background:${col};"></span>
      <span class="mfib-lvl" style="color:${col};">${lv}${isSpringZone?' <span style="color:var(--goldd);font-weight:700;">quebra/spring</span>':''}</span>
      <span class="mfib-px">${price.toFixed(2)}</span></div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
let catF='all';

function initApp(){
  initTheme();
  carregaAlarmesManuais(); carregaFibNiveis(); carregaFontesAlarme(); carregaObservacoes();
  // Leitura de mercado da Deriv: so precisa do App ID, nao do token. Sem App
  // ID salvo o painel apenas diz isso, em vez de tentar conectar sem parar.
  // (Aqui no initApp, nao no changeSym: no changeSym so conectaria depois de
  // voce trocar de ativo, que foi exatamente o bug que o carregaFontesAlarme
  // ja teve neste arquivo.)
  try{ derivDados.liga(); }catch(e){}
  if(typeof iniciaForca==="function") iniciaForca();
  const cb=document.getElementById('cat-bar');
  if(cb && !cb.children.length){
    const catBtn=document.createElement('button');catBtn.className='cp active';catBtn.textContent='TODOS';catBtn.setAttribute('data-cat','all');catBtn.onclick=function(){setCat(this);};cb.appendChild(catBtn);
    Object.entries(SYMBOLS).forEach(([cat,syms])=>{
      const b=document.createElement('button');b.className='cp';b.textContent=cat.toUpperCase();b.setAttribute('data-cat',cat);
      b.onclick=function(){setCat(this);};cb.appendChild(b);
    });
  }
  populateSelect(ALL_SYMS);
  setupChart();
  applyChartTheme();
  initDrawingTools();
  loadAll();
  startRsiHeatmap();
}

if(document.readyState==='complete'||document.readyState==='interactive'){
  initApp();
}else{
  document.addEventListener('DOMContentLoaded',initApp);
}

function populateSelect(syms) {
  const sel = document.getElementById('sym-select');
  sel.innerHTML = '';
  syms.forEach(sym => {
    const opt = document.createElement('option');
    opt.value = sym;
    opt.textContent = sym;
    if (sym === currentSym) opt.selected = true;
    sel.appendChild(opt);
  });
}

function setCat(btn){
  catF=btn.getAttribute('data-cat')||(btn.dataset?btn.dataset.cat:'all');
  document.querySelectorAll('.cp').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const syms = catF === 'all' ? ALL_SYMS : SYMBOLS[catF];
  populateSelect(syms);
  if(syms && syms[0]){changeSym(syms[0]);}
}


window.setupChart = setupChart;
window.applyChartTheme = applyChartTheme;
window.loadAll = loadAll;
window.toggleMtfView = typeof toggleMtfView !== 'undefined' ? toggleMtfView : null;
window.toggleValidatorPanel = typeof toggleValidatorPanel !== 'undefined' ? toggleValidatorPanel : null;
window.toggleRsiTable = typeof toggleRsiTable !== 'undefined' ? toggleRsiTable : null;
window.toggleRainbowTab = typeof toggleRainbowTab !== 'undefined' ? toggleRainbowTab : null;
window.toggleMacroTab = typeof toggleMacroTab !== 'undefined' ? toggleMacroTab : null;
window.toggleTerminalTab = typeof toggleTerminalTab !== 'undefined' ? toggleTerminalTab : null;
window.toggleGoldTab = typeof toggleGoldTab !== 'undefined' ? toggleGoldTab : null;
window.toggleStudyArchive = typeof toggleStudyArchive !== 'undefined' ? toggleStudyArchive : null;
window.toggleBacktestTab = typeof toggleBacktestTab !== 'undefined' ? toggleBacktestTab : null;
window.swapStochPhiPanels = typeof swapStochPhiPanels !== 'undefined' ? swapStochPhiPanels : null;
window.runBacktest = typeof runBacktest !== 'undefined' ? runBacktest : null;
window.archiveStudyObservation = typeof archiveStudyObservation !== 'undefined' ? archiveStudyObservation : null;
window.refreshPhiRibbonAndBorders = typeof refreshPhiRibbonAndBorders !== 'undefined' ? refreshPhiRibbonAndBorders : null;
window.updateLiveCandleBorder = typeof updateLiveCandleBorder !== 'undefined' ? updateLiveCandleBorder : null;




// UI TOGGLES RESTORED
let terminalOpen = false;
let bussolaOpen = false;
let potentialOpen = false;
let goldOpen = false;


async function updateTerminalUI() {
  const tCards = document.getElementById('terminal-cards');
  if(!tCards) return;
  tCards.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:20px;text-align:center;">Carregando leitura terminal...</div>';
  
  const sym = currentSym;
  // Terminal timeframes from user screenshot
  const tfs = ['3m', '15m', '1h', '4h', '5h', '6h', '12h', '1d', '1w', '1M', '3M', '6M', '9M', '12M'];
  let html = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:10px; padding:16px;">';
  
  try {
    const promises = tfs.map(t => fetchCandles(sym, t, 50));
    const results = await Promise.all(promises);
    
    for(let i = 0; i < tfs.length; i++) {
       const t = tfs[i];
       const data = results[i];
       if(data && data.length > 0) {
          const last = data[data.length-1];
          // Very basic rendering for now to show the TF is working
          html += `<div style="background:var(--bg2); padding:10px; border-radius:8px; border:1px solid var(--bd2); text-align:center;">
            <div style="font-weight:bold; color:var(--gold); font-size:14px; margin-bottom:4px;">${t.toUpperCase()}</div>
            <div style="font-family:var(--mono); color:var(--t2); font-size:12px;">$${last.close.toFixed(2)}</div>
          </div>`;
       } else {
          html += `<div style="background:var(--bg2); padding:10px; border-radius:8px; border:1px dashed var(--red); text-align:center; opacity:0.6;">
            <div style="font-weight:bold; color:var(--t3); font-size:14px; margin-bottom:4px;">${t.toUpperCase()}</div>
            <div style="font-size:10px; color:var(--red);">Sem dados</div>
          </div>`;
       }
    }
  } catch(e) {
    html = `<div style="color:red;padding:20px;">Falha ao carregar dados do Terminal. ${e.message}</div>`;
  }
  html += '</div>';
  tCards.innerHTML = html;
}

// Hook it to the toggle
function toggleTerminalTab() {
  terminalOpen = !terminalOpen;
  painelExclusivo('terminal-view',terminalOpen);
  const el = document.getElementById('terminal-view');
  if(el) el.classList.toggle('show', terminalOpen);
  if(terminalOpen) updateTerminalUI();
}
window.toggleTerminalTab = toggleTerminalTab;
window.updateTerminalUI = updateTerminalUI;


// A BUSSOLA DOS 4 ATIVOS. Com o modo Multi ligado, o modal deixa de mostrar o
// ativo do grafico principal e passa a mostrar os quatro do painel, cada um
// com a sua bussola e o seu placar. Reusa o maAngleDeg e o classifyDirecao,
// entao a leitura e a mesma do painel lateral e do Multi-TF.
const BUSSOLA_MEDIAS=[
  {key:"ema8",p:8},{key:"ema16",p:16},{key:"ema55",p:55},
  {key:"ema98",p:98},{key:"ema200",p:200},
];

// CORRELACAO ENTRE OS ATIVOS. Quando as quatro bussolas apontam pro mesmo
// lado, isso NAO e quatro confirmacoes — pode ser uma aposta so, quadruplicada.
// BTC, ETH, ouro e prata andam juntos em boa parte do tempo, e sem esse numero
// da pra abrir quatro posicoes achando que diversificou.
//
// Correlacao de Pearson sobre os RETORNOS (nao sobre os precos: preco e serie
// nao estacionaria, e dois ativos subindo dao correlacao alta mesmo sem terem
// nada a ver um com o outro).
const CORR_VELAS=120;

function correlacao(a,b){
  const n=Math.min(a.length,b.length);
  if(n<20) return null;
  const x=a.slice(-n), y=b.slice(-n);
  const mx=x.reduce((s,v)=>s+v,0)/n, my=y.reduce((s,v)=>s+v,0)/n;
  let sxy=0,sxx=0,syy=0;
  for(let i=0;i<n;i++){ const dx=x[i]-mx, dy=y[i]-my; sxy+=dx*dy; sxx+=dx*dx; syy+=dy*dy; }
  const d=Math.sqrt(sxx*syy);
  return d>0 ? sxy/d : null;
}

function retornosDe(velas,quantas){
  if(!velas||velas.length<2) return [];
  const c=velas.slice(-(quantas+1)).map(v=>v.close);
  const r=[];
  for(let i=1;i<c.length;i++){ if(c[i-1]>0) r.push((c[i]-c[i-1])/c[i-1]); }
  return r;
}

// Devolve os pares e o "aglomerado": a maior correlacao media de um ativo com
// os outros, que e o numero que diz se a carteira e uma aposta so.
function correlacaoMulti(){
  const ret={};
  MULTI_SYMS.forEach(s=>{
    const mc=multiCharts[s];
    if(mc&&mc.candles&&mc.candles.length>20) ret[s]=retornosDe(mc.candles,CORR_VELAS);
  });
  const simbolos=Object.keys(ret);
  if(simbolos.length<2) return null;
  const pares=[];
  for(let i=0;i<simbolos.length;i++) for(let j=i+1;j<simbolos.length;j++){
    const c=correlacao(ret[simbolos[i]],ret[simbolos[j]]);
    if(c!=null) pares.push({a:simbolos[i],b:simbolos[j],c});
  }
  if(!pares.length) return null;
  const media=pares.reduce((s,p)=>s+p.c,0)/pares.length;
  const maior=pares.reduce((m,p)=>Math.abs(p.c)>Math.abs(m.c)?p:m,pares[0]);
  return {pares,media,maior};
}
window.correlacaoMulti=correlacaoMulti;

function renderCorrelacao(){
  const box=document.getElementById("corr-box");
  if(!box) return;
  const r=correlacaoMulti();
  if(!r){ box.innerHTML='<div style="font-size:9px;color:var(--t3);">sem dado suficiente</div>'; return; }
  // acima de 0,7 os ativos andam praticamente juntos: quatro posicoes viram uma
  const aviso = Math.abs(r.media)>=0.7
    ? "os ativos andam juntos: 4 posicoes = 1 aposta"
    : (Math.abs(r.media)>=0.4 ? "correlacao moderada" : "andam separados");
  const cor = Math.abs(r.media)>=0.7?"#FF3B30":(Math.abs(r.media)>=0.4?"#F5A623":"#00C853");
  box.innerHTML='<div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:3px;">'
    +'<span style="color:var(--t2);">media dos pares</span>'
    +'<span style="color:'+cor+';font-weight:800;font-family:var(--mono);">'+r.media.toFixed(2)+"</span></div>"
    +'<div style="font-size:9px;color:'+cor+';margin-bottom:4px;">'+aviso+"</div>"
    +r.pares.map(p=>{
      const c2=Math.abs(p.c)>=0.7?"#FF3B30":(Math.abs(p.c)>=0.4?"#F5A623":"var(--t2)");
      return '<div style="display:flex;justify-content:space-between;font-size:9px;">'
        +'<span style="color:var(--t3);">'+p.a.replace("USDT","")+" x "+p.b.replace("USDT","")+"</span>"
        +'<span style="color:'+c2+';font-family:var(--mono);">'+p.c.toFixed(2)+"</span></div>";
    }).join("");
}
window.renderCorrelacao=renderCorrelacao;

function renderBussolaMulti(){
  const box=document.getElementById("bussola-body-multi");
  if(!box) return;
  // a moldura de cada ativo so e criada uma vez; depois so os valores mudam
  if(!box.children.length){
    box.style.display="grid";
    box.style.gridTemplateColumns="1fr 1fr";
    box.style.gap="8px";
    box.innerHTML=MULTI_SYMS.map(sym=>
      '<div style="border:1px solid var(--bd2);border-radius:6px;padding:6px;">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">'
      +'<span style="font-size:10px;font-weight:800;">'+sym.replace("USDT","")+"</span>"
      +'<span id="bm-est-'+sym+'" style="font-size:9px;font-weight:700;color:var(--t3);">--</span></div>'
      +'<div style="display:flex;gap:6px;align-items:center;">'
      +'<svg id="bm-svg-'+sym+'" width="62" height="62" viewBox="0 0 110 110" style="flex-shrink:0;"></svg>'
      +'<div style="font-size:9px;font-family:var(--mono);line-height:1.5;" id="bm-leg-'+sym+'"></div>'
      +"</div></div>").join("");
  }

  MULTI_SYMS.forEach(sym=>{
    const mc=multiCharts[sym];
    const est=document.getElementById("bm-est-"+sym), leg=document.getElementById("bm-leg-"+sym);
    if(!mc||!mc.candles||mc.candles.length<210){
      if(est){ est.textContent="sem dado"; est.style.color="var(--t3)"; }
      if(leg) leg.innerHTML="";
      return;
    }
    const closes=mc.candles.map(c=>c.close), highs=mc.candles.map(c=>c.high), lows=mc.candles.map(c=>c.low);
    const atrV=atrCalc(highs,lows,closes,14), idx=closes.length-1;
    const angles={};
    BUSSOLA_MEDIAS.forEach(m=>{ angles[m.key]=maAngleDeg(ema(closes,m.p),atrV,idx,DIRECAO_LOOKBACK); });
    const cls=classifyDirecao(angles);
    renderDirecaoCompass(angles,"bm-svg-"+sym);
    const soma=cls.sumAngle;
    const rotulo=cls.isFlat?"LATERAL":(cls.direcao==="alta"?"ALTA":"BAIXA");
    const cor=cls.isFlat?"#8b9bb4":(cls.direcao==="alta"?"#00C853":"#FF3B30");
    if(est){ est.textContent=rotulo; est.style.color=cor; }
    if(leg){
      const graus=BUSSOLA_MEDIAS.map(m=>{
        const a=angles[m.key];
        return '<div style="color:'+clarear(C[m.key],.45)+'">'+m.key.toUpperCase()+" "
          +(a==null?"--":(a>=0?"+":"")+a.toFixed(0)+"\u00b0")+"</div>";}).join("");
      leg.innerHTML=graus+'<div style="color:'+cor+';font-weight:700;">soma '
        +(soma==null?"--":(soma>=0?"+":"")+soma.toFixed(0)+"\u00b0")+"</div>";
    }
  });
}
window.renderBussolaMulti=renderBussolaMulti;

// Esta era a TERCEIRA definicao do mesmo toggle: havia duas sobrescritas mais
// abaixo, e so a ultima rodava. Ficou uma so, com o que cada uma fazia.
function toggleBussolaModal() {
  const el = document.getElementById("bussola-modal");
  if(!el) return;
  const aberto = el.style.display === "flex" || el.style.display === "block";
  if(aberto){ el.style.display="none"; return; }

  const cg=document.getElementById("confluator-gold-modal");
  if(cg && cg.style.display!=="none" && typeof toggleConfluatorGoldModal==="function") toggleConfluatorGoldModal();
  el.style.display="flex";

  // multiViewOpen e "let" no escopo do modulo, entao NAO existe em window:
  // usar window.multiViewOpen dava undefined e os dois corpos apareciam juntos
  const noMulti=(typeof multiViewOpen!=="undefined")&&!!multiViewOpen;
  const multi=document.getElementById("bussola-body-multi");
  const atual=document.getElementById("bussola-body-atual");
  if(atual) atual.style.display=noMulti?"none":"";
  if(multi) multi.style.display=noMulti?"grid":"none";
  const cx=document.getElementById("corr-box");
  if(cx) cx.style.display=noMulti?"block":"none";
  // 380px nao comportam o grid 2x2 — as caixas transbordavam por cima do titulo
  el.style.width=noMulti?"440px":"380px";

  if(noMulti){ renderBussolaMulti(); renderCorrelacao(); return; }

  if(typeof renderDirecaoCompass==="function" && typeof direcaoAngles!=="undefined"){
    renderDirecaoCompass(direcaoAngles);
    if(typeof classifyDirecao==="function"){
      renderDirecaoReadout(direcaoAngles, classifyDirecao(direcaoAngles));
      renderDirecaoStateBadge(classifyDirecao(direcaoAngles));
    }
    if(typeof renderDirecaoHistory==="function") renderDirecaoHistory();
  }
}
window.toggleBussolaModal = toggleBussolaModal;

// ══════════════════════════════════════════════════════
// ATLAS GOLD (CONFLUATOR) — RSI + StochRSI (K/D) do ativo atual em
// 4 timeframes (5m/1h/4h/1d). Reaproveita rsiCalc/stochCalc/sma e
// fetchMTFFor, a mesma base de calculo ja usada na aba RSI Table.
// ══════════════════════════════════════════════════════
let confluatorGoldOpen=false, confluatorGoldTimer=null;
const CONFLUATOR_TF_LABELS={'5':'5m','60':'1h','240':'4h','D':'1d'};

function toggleConfluatorGoldModal(){
  const el=document.getElementById('confluator-gold-modal');
  if(!el)return;
  confluatorGoldOpen = el.style.display==='none' || el.style.display==='';
  if(confluatorGoldOpen){
    const bm=document.getElementById('bussola-modal');
    if(bm && bm.style.display!=='none' && bm.style.display!=='')bm.style.display='none';
  }
  el.style.display=confluatorGoldOpen?'block':'none';
  if(confluatorGoldOpen){
    updateConfluatorGold();
    if(confluatorGoldTimer)clearInterval(confluatorGoldTimer);
    confluatorGoldTimer=setInterval(updateConfluatorGold,60000);
  }else if(confluatorGoldTimer){
    clearInterval(confluatorGoldTimer);confluatorGoldTimer=null;
  }
}

async function updateConfluatorGold(){
  const table=document.getElementById('confluator-gold-table');
  const sigEl=document.getElementById('confluator-gold-signal');
  if(!table||!confluatorGoldOpen)return;
  const mtfLocal=await fetchMTFFor(currentSym);
  let bull=0,bear=0,valid=0;
  const rows=Object.keys(CONFLUATOR_TF_LABELS).map(tf=>{
    const d=mtfLocal[tf];
    if(!d||d.length<P.rsiLen+P.stochLen+P.kSmooth+P.dSmooth){
      return `<tr><td>${CONFLUATOR_TF_LABELS[tf]}</td><td>--</td><td>--</td><td>--</td></tr>`;
    }
    const r=rsiCalc(d,P.rsiLen),s=stochCalc(r,P.stochLen),k=sma(s,P.kSmooth),dd=sma(k,P.dSmooth);
    const last=d.length-1;
    const rsiV=r[last],kV=k[last],dV=dd[last];
    if(rsiV!=null){valid++;if(rsiV>=P.ob)bear++;else if(rsiV<=P.os)bull++;}
    return `<tr>
      <td>${CONFLUATOR_TF_LABELS[tf]}</td>
      <td class="${getRsiClass(rsiV)}">${rsiV!=null?rsiV.toFixed(1):'--'}</td>
      <td>${kV!=null?kV.toFixed(1):'--'}</td>
      <td>${dV!=null?dV.toFixed(1):'--'}</td>
    </tr>`;
  }).join('');
  table.innerHTML=`<tr style="color:var(--t3);border-bottom:1px solid var(--bd3);"><th>TF</th><th>RSI</th><th>Stoch-K</th><th>Stoch-D</th></tr>${rows}`;
  if(sigEl){
    if(valid===0){sigEl.textContent='Sem dados suficientes';sigEl.style.color='var(--t3)';}
    else if(bull>bear){sigEl.textContent=`${bull}/${valid} TFs em sobrevenda`;sigEl.style.color='var(--green)';}
    else if(bear>bull){sigEl.textContent=`${bear}/${valid} TFs em sobrecompra`;sigEl.style.color='var(--red)';}
    else{sigEl.textContent='Neutro';sigEl.style.color='var(--t3)';}
  }
}
window.toggleConfluatorGoldModal=toggleConfluatorGoldModal;


// ══════════════════════════════════════════════════════
// PAINEL DE IA — ainda nao implementado (nunca chegou a funcionar).
// Essas 5 funcoes existem so pra parar de dar erro no clique; quando
// o recurso for definido de verdade (provedor de IA, chave, etc.),
// substitua o corpo delas pela integracao real.
// ══════════════════════════════════════════════════════
function onIAKeyConnectClick(){
  showInfoToast('IA','Recurso de IA ainda em construcao.');
}
function toggleIAKeyVisibility(){
  const inp=document.getElementById('ia-api-key');
  const eye=document.getElementById('ia-key-eye');
  if(!inp)return;
  const show=inp.type==='password';
  inp.type=show?'text':'password';
  if(eye)eye.textContent=show?'🙈':'👁';
}
function analyzeGlobalMarket(){
  showInfoToast('IA','Analise de mercado ainda em construcao.');
}
function analyzeCurrentAssetAI(){
  showInfoToast('IA',`Analise de ${currentSym.replace('USDT','')} ainda em construcao.`);
}
function sendIAChat(){
  const inp=document.getElementById('ia-chat-input');
  if(!inp)return;
  if(!inp.value.trim())return;
  showInfoToast('IA','Chat ainda em construcao — sua mensagem nao foi enviada.');
  inp.value='';
}
window.onIAKeyConnectClick=onIAKeyConnectClick;
window.toggleIAKeyVisibility=toggleIAKeyVisibility;
window.analyzeGlobalMarket=analyzeGlobalMarket;
window.analyzeCurrentAssetAI=analyzeCurrentAssetAI;
window.sendIAChat=sendIAChat;


function togglePotential() {
  const card = document.getElementById('potential-card');
  if (!card) return;
  const show = card.style.display === 'none' || card.style.display === '';
  card.style.display = show ? 'flex' : 'none';
  if (show) updatePotential();
}


function updatePotential() {
  const card = document.getElementById('potential-card');
  if(!card || card.style.display === 'none') return;
  
  const levEl = document.getElementById('pot-lev');
  const lotEl = document.getElementById('pot-lot');
  const stopEl = document.getElementById('pot-stop-price');
  const targetEl = document.getElementById('pot-target-price');
  const eqEl = document.getElementById('pot-equity');
  const riskPctEl = document.getElementById('pot-risk-pct');
  
  if(!levEl) return;
  
  const lev = parseFloat(levEl.value) || 800;
  const lot = parseFloat(lotEl.value) || 0;
  const stop = parseFloat(stopEl.value) || 0;
  const target = parseFloat(targetEl.value) || 0;
  const equity = parseFloat(eqEl.value) || 0;
  const riskPct = parseFloat(riskPctEl.value) || 0;
  
  // Use the last close price from candles
  let price = 0;
  if(typeof candles !== 'undefined' && candles.length > 0) {
      price = candles[candles.length - 1].close;
  }
  
  document.getElementById('pot-price').textContent = price.toFixed(2);
  
  // Basic forex/crypto logic: Notional = Lot * ContractSize * Price. 
  // Let's assume standard Deriv crypto/forex Contract Size = 1 for simplicity if not defined.
  // Actually, standard lot is 100,000 for forex. For BTCUSD on Deriv it might be 1.
  // Let's assume 1.
  const contractSize = 1;
  const notional = lot * contractSize * price;
  const margin = lev > 0 ? notional / lev : 0;
  const tickValue = lot * contractSize; // value of $1 move in price
  const liqDist = tickValue > 0 ? margin / tickValue : 0;
  
  document.getElementById('pot-notional').textContent = '$' + notional.toFixed(2);
  document.getElementById('pot-margin').textContent = '$' + margin.toFixed(2);
  document.getElementById('pot-tick').textContent = '$' + tickValue.toFixed(4);
  document.getElementById('pot-liq').textContent = '$' + liqDist.toFixed(2);
  
  const stopDist = stop > 0 ? Math.abs(price - stop) : 0;
  const targetDist = target > 0 ? Math.abs(price - target) : 0;
  
  document.getElementById('pot-stop-dist').textContent = '$' + stopDist.toFixed(2);
  document.getElementById('pot-target-dist').textContent = '$' + targetDist.toFixed(2);
  
  const riskReal = stopDist * tickValue;
  const rewardReal = targetDist * tickValue;
  const rr = riskReal > 0 ? rewardReal / riskReal : 0;
  
  document.getElementById('pot-risk-real').textContent = '$' + riskReal.toFixed(2);
  document.getElementById('pot-reward-real').textContent = '$' + rewardReal.toFixed(2);
  document.getElementById('pot-rr').textContent = rr.toFixed(2);
  
  const riskGoal = equity * (riskPct / 100);
  document.getElementById('pot-risk-goal').textContent = '$' + riskGoal.toFixed(2);
  
  const suggestedLot = (stopDist > 0 && contractSize > 0) ? riskGoal / (stopDist * contractSize) : 0;
  document.getElementById('pot-lot-suggested').textContent = suggestedLot.toFixed(3);
}

// O lote sugerido ja saia certo — risco em dinheiro dividido pela distancia do
// stop — mas o stop tinha que ser digitado a mao ou vir de um clique no fib.
// Adivinhar o stop e o erro que estraga a conta toda, entao aqui ele sai da
// volatilidade: 1,5 ATR do preco, no lado certo conforme a direcao escolhida.
const STOP_ATR_MULT=1.5;
function stopPorATR(){
  if(!candles||candles.length<P.atrLen+2){
    if(typeof showInfoToast==="function") showInfoToast("STOP","sem velas suficientes");
    return;
  }
  const highs=candles.map(c=>c.high), lows=candles.map(c=>c.low), closes=candles.map(c=>c.close);
  const atrV=atrCalc(highs,lows,closes,P.atrLen);
  const atr=atrV[atrV.length-1];
  if(atr==null||!isFinite(atr)||atr<=0){
    if(typeof showInfoToast==="function") showInfoToast("STOP","ATR indisponivel");
    return;
  }
  const px=closes[closes.length-1];
  // ttSide diz se a operacao e de alta ou de baixa; o stop vai do lado oposto
  const paraCima=(typeof ttSide==="undefined")||ttSide==="up";
  const stop=paraCima ? px-STOP_ATR_MULT*atr : px+STOP_ATR_MULT*atr;
  const el=document.getElementById("pot-stop-price");
  if(el){
    el.value=stop.toFixed(2);
    if(typeof updatePotential==="function") updatePotential();
  }
  if(typeof showInfoToast==="function"){
    showInfoToast("STOP","stop a "+STOP_ATR_MULT+" ATR: "+stop.toFixed(2)
      +"  (ATR "+atr.toFixed(2)+")");
  }
}
window.stopPorATR=stopPorATR;

window.togglePotential = togglePotential;
window.updatePotential = updatePotential;



// ══════════════════════════════════════════════════════
// GOLD TAB — mercados globais (377 ativos: cripto/forex/indices/
// commodities/acoes por regiao). Cotacao ao vivo via WebSocket
// publico da SimpleFX (sem chave/login) + RSI multi-timeframe via
// Binance (cripto/principais forex) ou RSI local calculado a partir
// do proprio stream de cotacao pra quem nao tem par na Binance.
// Portado de um prototipo isolado (atlas_gold.html) que funcionava
// sozinho; aqui so os nomes de funcao/variavel/id foram adaptados
// pra bater com o gold-view que ja existe neste index.html.
// ══════════════════════════════════════════════════════
const GOLD_ASSET_RAW = [["BTCUSD", "CRYPTO", "Bitcoin / USD", 2], ["ETHUSD", "CRYPTO", "Ethereum / USD", 2], ["SOLUSD", "CRYPTO", "Solana / USD", 2], ["BNBUSD", "CRYPTO", "Binance Coin / USD", 2], ["XRPUSD", "CRYPTO", "Ripple / USD", 4], ["ADAUSD", "CRYPTO", "Cardano / USD", 4], ["AVAXUSD", "CRYPTO", "Avalanche / USD", 2], ["DOTUSD", "CRYPTO", "Polkadot / USD", 3], ["LINKUSD", "CRYPTO", "Chainlink / USD", 3], ["LTCUSD", "CRYPTO", "Litecoin / USD", 2], ["DOGEUSD", "CRYPTO", "Dogecoin / USD", 5], ["MATICUSD", "CRYPTO", "Polygon / USD", 4], ["UNIUSD", "CRYPTO", "Uniswap / USD", 3], ["ATOMUSD", "CRYPTO", "Cosmos / USD", 3], ["NEARUSD", "CRYPTO", "Near Protocol / USD", 3], ["APTUSD", "CRYPTO", "Aptos / USD", 3], ["ARBUSD", "CRYPTO", "Arbitrum / USD", 4], ["OPUSD", "CRYPTO", "Optimism / USD", 3], ["INJUSD", "CRYPTO", "Injective / USD", 3], ["SUIUSD", "CRYPTO", "Sui / USD", 4], ["TIAUSD", "CRYPTO", "Celestia / USD", 3], ["FTMUSD", "CRYPTO", "Fantom / USD", 4], ["SANDUSD", "CRYPTO", "The Sandbox / USD", 4], ["AXSUSD", "CRYPTO", "Axie Infinity / USD", 3], ["AAEUSD", "CRYPTO", "Aave / USD", 2], ["MKRUSD", "CRYPTO", "Maker / USD", 2], ["LDOUSD", "CRYPTO", "Lido DAO / USD", 3], ["FETUSD", "CRYPTO", "Fetch.ai / USD", 4], ["WLDUSD", "CRYPTO", "Worldcoin / USD", 3], ["PEPEUSD", "CRYPTO", "Pepe / USD", 7], ["BONKUSD", "CRYPTO", "Bonk / USD", 7], ["SHIBUSDT", "CRYPTO", "Shiba Inu / USDT", 6], ["XAUUSD", "CRYPTO", "Gold / USD", 2], ["XAGUSD", "CRYPTO", "Silver / USD", 3], ["EURUSD", "FOREX", "Euro / US Dollar", 5], ["GBPUSD", "FOREX", "British Pound / US Dollar", 5], ["USDJPY", "FOREX", "US Dollar / Japanese Yen", 3], ["USDCHF", "FOREX", "US Dollar / Swiss Franc", 5], ["AUDUSD", "FOREX", "Australian Dollar / US Dollar", 5], ["NZDUSD", "FOREX", "New Zealand Dollar / US Dollar", 5], ["USDCAD", "FOREX", "US Dollar / Canadian Dollar", 5], ["EURGBP", "FOREX", "Euro / British Pound", 5], ["EURJPY", "FOREX", "Euro / Japanese Yen", 3], ["GBPJPY", "FOREX", "British Pound / Japanese Yen", 3], ["EURCHF", "FOREX", "Euro / Swiss Franc", 5], ["AUDJPY", "FOREX", "Australian Dollar / Japanese Yen", 3], ["GBPAUD", "FOREX", "British Pound / Australian Dollar", 5], ["GBPCAD", "FOREX", "British Pound / Canadian Dollar", 5], ["GBPCHF", "FOREX", "British Pound / Swiss Franc", 5], ["EURAUD", "FOREX", "Euro / Australian Dollar", 5], ["EURCAD", "FOREX", "Euro / Canadian Dollar", 5], ["EURNZD", "FOREX", "Euro / New Zealand Dollar", 5], ["AUDCAD", "FOREX", "Australian Dollar / Canadian Dollar", 5], ["AUDNZD", "FOREX", "Australian Dollar / New Zealand Dollar", 5], ["AUDCHF", "FOREX", "Australian Dollar / Swiss Franc", 5], ["CADCHF", "FOREX", "Canadian Dollar / Swiss Franc", 5], ["CADJPY", "FOREX", "Canadian Dollar / Japanese Yen", 3], ["NZDJPY", "FOREX", "New Zealand Dollar / Japanese Yen", 3], ["NZDCHF", "FOREX", "New Zealand Dollar / Swiss Franc", 5], ["NZDCAD", "FOREX", "New Zealand Dollar / Canadian Dollar", 5], ["CHFJPY", "FOREX", "Swiss Franc / Japanese Yen", 3], ["USDNOK", "FOREX", "US Dollar / Norwegian Krone", 4], ["USDSEK", "FOREX", "US Dollar / Swedish Krona", 4], ["USDDKK", "FOREX", "US Dollar / Danish Krone", 4], ["USDPLN", "FOREX", "US Dollar / Polish Zloty", 4], ["USDHUF", "FOREX", "US Dollar / Hungarian Forint", 2], ["USDCZK", "FOREX", "US Dollar / Czech Koruna", 4], ["USDMXN", "FOREX", "US Dollar / Mexican Peso", 4], ["USDBRL", "FOREX", "US Dollar / Brazilian Real", 4], ["USDTRY", "FOREX", "US Dollar / Turkish Lira", 4], ["USDZAR", "FOREX", "US Dollar / South African Rand", 4], ["USDINR", "FOREX", "US Dollar / Indian Rupee", 3], ["USDCNY", "FOREX", "US Dollar / Chinese Yuan", 4], ["USDSGD", "FOREX", "US Dollar / Singapore Dollar", 4], ["USDKRW", "FOREX", "US Dollar / Korean Won", 2], ["USDHKD", "FOREX", "US Dollar / Hong Kong Dollar", 4], ["USDTHB", "FOREX", "US Dollar / Thai Baht", 3], ["USDMYR", "FOREX", "US Dollar / Malaysian Ringgit", 4], ["USDIDR", "FOREX", "US Dollar / Indonesian Rupiah", 1], ["USDPHP", "FOREX", "US Dollar / Philippine Peso", 3], ["USDVND", "FOREX", "US Dollar / Vietnamese Dong", 0], ["USDAED", "FOREX", "US Dollar / UAE Dirham", 4], ["USDILN", "FOREX", "US Dollar / Israeli Shekel", 4], ["USDRUB", "FOREX", "US Dollar / Russian Ruble", 2], ["USDEGP", "FOREX", "US Dollar / Egyptian Pound", 3], ["USDNGN", "FOREX", "US Dollar / Nigerian Naira", 2], ["EURTRY", "FOREX", "Euro / Turkish Lira", 4], ["EURRUB", "FOREX", "Euro / Russian Ruble", 2], ["EURSEK", "FOREX", "Euro / Swedish Krona", 4], ["EURNOK", "FOREX", "Euro / Norwegian Krone", 4], ["EURHUF", "FOREX", "Euro / Hungarian Forint", 2], ["EURPLN", "FOREX", "Euro / Polish Zloty", 4], ["EURZAR", "FOREX", "Euro / South African Rand", 4], ["US500", "INDICES", "S&P 500 Index", 2], ["US100", "INDICES", "Nasdaq 100 Index", 2], ["US30", "INDICES", "Dow Jones 30 Index", 1], ["US2000", "INDICES", "Russell 2000 Index", 2], ["GER40", "INDICES", "DAX 40 Index", 1], ["UK100", "INDICES", "FTSE 100 Index", 1], ["FRA40", "INDICES", "CAC 40 Index", 1], ["ESP35", "INDICES", "IBEX 35 Index", 1], ["ITA40", "INDICES", "FTSE MIB Index", 1], ["NED25", "INDICES", "AEX Index", 2], ["SWI20", "INDICES", "SMI Index", 1], ["AUT20", "INDICES", "ATX Index", 1], ["BEL20", "INDICES", "BEL 20 Index", 1], ["POR20", "INDICES", "PSI 20 Index", 1], ["GRE20", "INDICES", "Athex 20 Index", 1], ["FIN25", "INDICES", "OMX Helsinki 25", 1], ["JPN225", "INDICES", "Nikkei 225 Index", 1], ["AUS200", "INDICES", "ASX 200 Index", 1], ["HKG50", "INDICES", "Hang Seng Index", 1], ["CHN50", "INDICES", "China A50 Index", 1], ["SGP30", "INDICES", "Straits Times Index", 1], ["KOR200", "INDICES", "KOSPI 200 Index", 2], ["TWN50", "INDICES", "MSCI Taiwan Index", 2], ["IND50", "INDICES", "Nifty 50 Index", 1], ["VIX", "INDICES", "Volatility Index", 2], ["DOLLAR", "INDICES", "US Dollar Index", 2], ["USOIL", "COMMODITIES", "WTI Crude Oil", 2], ["UKOIL", "COMMODITIES", "Brent Crude Oil", 2], ["NGAS", "COMMODITIES", "Natural Gas", 3], ["COPPER", "COMMODITIES", "High Grade Copper", 4], ["WHEAT", "COMMODITIES", "Chicago Wheat", 2], ["CORN", "COMMODITIES", "Corn Futures", 2], ["SOYBEAN", "COMMODITIES", "Soybeans", 2], ["COFFEE", "COMMODITIES", "Arabica Coffee", 2], ["SUGAR", "COMMODITIES", "Raw Sugar", 4], ["COTTON", "COMMODITIES", "Cotton No. 2", 2], ["COCOA", "COMMODITIES", "Cocoa Futures", 1], ["RICE", "COMMODITIES", "Rough Rice", 3], ["OJ", "COMMODITIES", "Orange Juice", 2], ["LUMBER", "COMMODITIES", "Random Length Lumber", 2], ["PLATINUM", "COMMODITIES", "Platinum Futures", 2], ["PALLADIUM", "COMMODITIES", "Palladium Futures", 2], ["ZINC", "COMMODITIES", "Zinc Futures", 2], ["ALUMINUM", "COMMODITIES", "Aluminum Futures", 2], ["NICKEL", "COMMODITIES", "Nickel Futures", 2], ["LEAD", "COMMODITIES", "Lead Futures", 2], ["TIN", "COMMODITIES", "Tin Futures", 2], ["TSM.US", "ASIA-PAC", "Taiwan Semiconductor", 2], ["BABA.US", "ASIA-PAC", "Alibaba Group", 2], ["SONY.US", "ASIA-PAC", "Sony Group", 2], ["BIDU.US", "ASIA-PAC", "Baidu Inc", 2], ["JD.US", "ASIA-PAC", "JD.com Inc", 2], ["PDD.US", "ASIA-PAC", "PDD Holdings", 2], ["NTES.US", "ASIA-PAC", "NetEase Inc", 2], ["BILI.US", "ASIA-PAC", "Bilibili Inc", 2], ["IQ.US", "ASIA-PAC", "iQIYI Inc", 2], ["TME.US", "ASIA-PAC", "Tencent Music", 2], ["NIO.US", "ASIA-PAC", "NIO Inc", 2], ["XPEV.US", "ASIA-PAC", "XPeng Inc", 2], ["LI.US", "ASIA-PAC", "Li Auto Inc", 2], ["DIDI.US", "ASIA-PAC", "DiDi Global", 2], ["BEKE.US", "ASIA-PAC", "KE Holdings", 2], ["EDU.US", "ASIA-PAC", "New Oriental Education", 2], ["TAL.US", "ASIA-PAC", "TAL Education", 2], ["YUMC.US", "ASIA-PAC", "Yum China", 2], ["INFY.US", "ASIA-PAC", "Infosys Ltd", 2], ["WIT.US", "ASIA-PAC", "Wipro Ltd", 2], ["HDB.US", "ASIA-PAC", "HDFC Bank", 2], ["IBN.US", "ASIA-PAC", "ICICI Bank", 2], ["VEDL.US", "ASIA-PAC", "Vedanta Ltd", 2], ["TTM.US", "ASIA-PAC", "Tata Motors", 2], ["BHP.US", "ASIA-PAC", "BHP Group US", 2], ["RIO.US", "ASIA-PAC", "Rio Tinto US", 2], ["VALE3.SA", "ASIA-PAC", "Vale SA B3", 2], ["NTCOY.US", "ASIA-PAC", "Natura & Co", 2], ["FUJIY.US", "ASIA-PAC", "Fujifilm ADR", 2], ["LNVGY.US", "ASIA-PAC", "Lenovo Group ADR", 2], ["HTHIY.US", "ASIA-PAC", "Hitachi ADR", 2], ["KB.US", "ASIA-PAC", "KB Financial Group", 2], ["SHG.US", "ASIA-PAC", "Shinhan Financial", 2], ["9984.JP", "ASIA-PAC", "SoftBank Group", 1], ["7203.JP", "ASIA-PAC", "Toyota Motor", 1], ["6758.JP", "ASIA-PAC", "Sony Corp JP", 1], ["9432.JP", "ASIA-PAC", "NTT Corp", 1], ["8306.JP", "ASIA-PAC", "Mitsubishi UFJ", 1], ["7267.JP", "ASIA-PAC", "Honda Motor", 1], ["700.HK", "ASIA-PAC", "Tencent Holdings HK", 2], ["941.HK", "ASIA-PAC", "China Mobile HK", 2], ["1299.HK", "ASIA-PAC", "AIA Group HK", 2], ["2318.HK", "ASIA-PAC", "Ping An Insurance HK", 2], ["3690.HK", "ASIA-PAC", "Meituan HK", 2], ["9999.HK", "ASIA-PAC", "NetEase HK", 2], ["005930.KR", "ASIA-PAC", "Samsung Electronics", 0], ["000660.KR", "ASIA-PAC", "SK Hynix", 0], ["035420.KR", "ASIA-PAC", "NAVER Corp", 0], ["CBA.AU", "ASIA-PAC", "Commonwealth Bank AU", 2], ["BHP.AU", "ASIA-PAC", "BHP Group AU", 2], ["WBC.AU", "ASIA-PAC", "Westpac Banking AU", 2], ["ANZ.AU", "ASIA-PAC", "ANZ Group AU", 2], ["NAB.AU", "ASIA-PAC", "National Australia Bank", 2], ["WES.AU", "ASIA-PAC", "Wesfarmers AU", 2], ["ASML.US", "EUR/ME/AFR", "ASML Holding", 2], ["SAP.DE", "EUR/ME/AFR", "SAP SE", 2], ["SIE.DE", "EUR/ME/AFR", "Siemens AG", 2], ["ALV.DE", "EUR/ME/AFR", "Allianz SE", 2], ["BMW.DE", "EUR/ME/AFR", "Bayerische Motoren Werke", 2], ["VOW.DE", "EUR/ME/AFR", "Volkswagen AG", 2], ["DTE.DE", "EUR/ME/AFR", "Deutsche Telekom", 2], ["DBK.DE", "EUR/ME/AFR", "Deutsche Bank", 2], ["BAS.DE", "EUR/ME/AFR", "BASF SE", 2], ["BAY.DE", "EUR/ME/AFR", "Bayer AG", 2], ["MBG.DE", "EUR/ME/AFR", "Mercedes-Benz Group", 2], ["ADS.DE", "EUR/ME/AFR", "Adidas AG", 2], ["MC.FR", "EUR/ME/AFR", "LVMH Moet Hennessy", 2], ["OR.FR", "EUR/ME/AFR", "L'Oreal SA", 2], ["TTE.FR", "EUR/ME/AFR", "TotalEnergies SE", 2], ["BNP.FR", "EUR/ME/AFR", "BNP Paribas", 2], ["SAN.FR", "EUR/ME/AFR", "Sanofi SA", 2], ["AIR.FR", "EUR/ME/AFR", "Airbus SE", 2], ["KER.FR", "EUR/ME/AFR", "Kering SA", 2], ["SGO.FR", "EUR/ME/AFR", "Saint-Gobain", 2], ["DG.FR", "EUR/ME/AFR", "Vinci SA", 2], ["SU.FR", "EUR/ME/AFR", "Schneider Electric", 2], ["CS.FR", "EUR/ME/AFR", "AXA SA", 2], ["GLE.FR", "EUR/ME/AFR", "Societe Generale", 2], ["NESN.CH", "EUR/ME/AFR", "Nestle SA", 2], ["NOVN.CH", "EUR/ME/AFR", "Novartis AG", 2], ["ROG.CH", "EUR/ME/AFR", "Roche Holding", 2], ["UBSG.CH", "EUR/ME/AFR", "UBS Group AG", 2], ["CSGN.CH", "EUR/ME/AFR", "Credit Suisse", 2], ["ABBN.CH", "EUR/ME/AFR", "ABB Ltd", 2], ["ZURN.CH", "EUR/ME/AFR", "Zurich Insurance", 2], ["SREN.CH", "EUR/ME/AFR", "Swiss Re AG", 2], ["SHEL.UK", "EUR/ME/AFR", "Shell plc", 2], ["BP.UK", "EUR/ME/AFR", "BP plc", 2], ["HSBA.UK", "EUR/ME/AFR", "HSBC Holdings", 2], ["AZN.UK", "EUR/ME/AFR", "AstraZeneca plc", 2], ["GSK.UK", "EUR/ME/AFR", "GSK plc", 2], ["ULVR.UK", "EUR/ME/AFR", "Unilever plc", 2], ["DGE.UK", "EUR/ME/AFR", "Diageo plc", 2], ["BA.UK", "EUR/ME/AFR", "BAE Systems", 2], ["VOD.UK", "EUR/ME/AFR", "Vodafone Group", 2], ["BT.UK", "EUR/ME/AFR", "BT Group", 2], ["BARC.UK", "EUR/ME/AFR", "Barclays plc", 2], ["LLOY.UK", "EUR/ME/AFR", "Lloyds Banking Group", 2], ["NWG.UK", "EUR/ME/AFR", "NatWest Group", 2], ["RIO.UK", "EUR/ME/AFR", "Rio Tinto plc UK", 2], ["GLEN.UK", "EUR/ME/AFR", "Glencore plc", 2], ["AAL.UK", "EUR/ME/AFR", "Anglo American", 2], ["ITX.ES", "EUR/ME/AFR", "Inditex SA", 2], ["IBE.ES", "EUR/ME/AFR", "Iberdrola SA", 2], ["BBVA.ES", "EUR/ME/AFR", "Banco Bilbao Vizcaya", 2], ["SAN.ES", "EUR/ME/AFR", "Banco Santander ES", 2], ["REP.ES", "EUR/ME/AFR", "Repsol SA", 2], ["TEF.ES", "EUR/ME/AFR", "Telefonica SA", 2], ["ENI.IT", "EUR/ME/AFR", "Eni SpA", 2], ["ENEL.IT", "EUR/ME/AFR", "Enel SpA", 2], ["UCG.IT", "EUR/ME/AFR", "UniCredit SpA", 2], ["ISP.IT", "EUR/ME/AFR", "Intesa Sanpaolo", 2], ["STM.IT", "EUR/ME/AFR", "STMicroelectronics", 2], ["NPN.ZA", "EUR/ME/AFR", "Naspers Ltd", 2], ["AGL.ZA", "EUR/ME/AFR", "Anglo American ZA", 2], ["MTN.ZA", "EUR/ME/AFR", "MTN Group", 2], ["SBK.ZA", "EUR/ME/AFR", "Standard Bank", 2], ["FSR.ZA", "EUR/ME/AFR", "FirstRand Ltd", 2], ["SBER.US", "EUR/ME/AFR", "Sberbank ADR", 2], ["YNDX.US", "EUR/ME/AFR", "Yandex NV", 2], ["SABIC.SA", "EUR/ME/AFR", "SABIC Tadawul", 2], ["ARAMCO.SA", "EUR/ME/AFR", "Saudi Aramco", 2], ["EMAAR.AE", "EUR/ME/AFR", "Emaar Properties", 2], ["FAB.AE", "EUR/ME/AFR", "First Abu Dhabi Bank", 2], ["PBR.US", "LATAM", "Petrobras ADR", 2], ["VALE.US", "LATAM", "Vale SA ADR", 2], ["ITUB.US", "LATAM", "Itai Unibanco ADR", 2], ["BBD.US", "LATAM", "Banco Bradesco ADR", 2], ["ABEV.US", "LATAM", "Ambev SA ADR", 2], ["NU.US", "LATAM", "Nu Holdings Ltd", 2], ["XP.US", "LATAM", "XP Inc", 2], ["MELI.US", "LATAM", "MercadoLibre Inc", 2], ["STNE.US", "LATAM", "StoneCo Ltd", 2], ["PAGS.US", "LATAM", "PagSeguro Digital", 2], ["CASH3.SA", "LATAM", "Meliuz SA B3", 2], ["RENT3.SA", "LATAM", "Localiza B3", 2], ["MGLU3.SA", "LATAM", "Magazine Luiza B3", 2], ["VIIA3.SA", "LATAM", "Via SA B3", 2], ["LREN3.SA", "LATAM", "Lojas Renner B3", 2], ["BRFS3.SA", "LATAM", "BRF SA B3", 2], ["JBSS3.SA", "LATAM", "JBS SA B3", 2], ["PCAR3.SA", "LATAM", "Pao de Acucar B3", 2], ["BBAS3.SA", "LATAM", "Banco do Brasil B3", 2], ["SANB11.SA", "LATAM", "Santander Brasil B3", 2], ["YPF.US", "LATAM", "YPF SA ADR", 2], ["PAM.US", "LATAM", "Pampa Energia ADR", 2], ["VIST.US", "LATAM", "Vista Energy", 2], ["EC.US", "LATAM", "Ecopetrol SA ADR", 2], ["CIB.US", "LATAM", "Bancolombia ADR", 2], ["SCCO.US", "LATAM", "Southern Copper", 2], ["BAP.US", "LATAM", "Credicorp Ltd", 2], ["IFS.US", "LATAM", "Intercorp Financial", 2], ["AMX.US", "LATAM", "America Movil ADR", 2], ["FMX.US", "LATAM", "Fomento Economico Mexicano", 2], ["BSMX.US", "LATAM", "Banco Santander Mexico", 2], ["AC.US", "LATAM", "Arca Continental", 2], ["WALMEX.US", "LATAM", "Wal-Mart de Mexico", 2], ["BSANTANDER.CL", "LATAM", "Banco Santander Chile", 2], ["ENDESA.CL", "LATAM", "Enel Chile SA", 2], ["COPEC.CL", "LATAM", "Empresas Copec", 2], ["FALABELLA.CL", "LATAM", "SACI Falabella", 2], ["AAPL.US", "AMER NORTH", "Apple Inc", 2], ["MSFT.US", "AMER NORTH", "Microsoft Corp", 2], ["NVDA.US", "AMER NORTH", "NVIDIA Corp", 2], ["AMZN.US", "AMER NORTH", "Amazon.com Inc", 2], ["GOOGL.US", "AMER NORTH", "Alphabet Inc Class A", 2], ["GOOG.US", "AMER NORTH", "Alphabet Inc Class C", 2], ["META.US", "AMER NORTH", "Meta Platforms Inc", 2], ["TSLA.US", "AMER NORTH", "Tesla Inc", 2], ["BRK.B.US", "AMER NORTH", "Berkshire Hathaway", 2], ["JPM.US", "AMER NORTH", "JPMorgan Chase", 2], ["V.US", "AMER NORTH", "Visa Inc", 2], ["MA.US", "AMER NORTH", "Mastercard Inc", 2], ["UNH.US", "AMER NORTH", "UnitedHealth Group", 2], ["XOM.US", "AMER NORTH", "Exxon Mobil Corp", 2], ["WMT.US", "AMER NORTH", "Walmart Inc", 2], ["JNJ.US", "AMER NORTH", "Johnson & Johnson", 2], ["PG.US", "AMER NORTH", "Procter & Gamble", 2], ["HD.US", "AMER NORTH", "Home Depot Inc", 2], ["ABBV.US", "AMER NORTH", "AbbVie Inc", 2], ["MRK.US", "AMER NORTH", "Merck & Co Inc", 2], ["CVX.US", "AMER NORTH", "Chevron Corp", 2], ["LLY.US", "AMER NORTH", "Eli Lilly & Co", 2], ["BAC.US", "AMER NORTH", "Bank of America", 2], ["KO.US", "AMER NORTH", "Coca-Cola Co", 2], ["PFE.US", "AMER NORTH", "Pfizer Inc", 2], ["AVGO.US", "AMER NORTH", "Broadcom Inc", 2], ["COST.US", "AMER NORTH", "Costco Wholesale", 2], ["MCD.US", "AMER NORTH", "McDonald's Corp", 2], ["DIS.US", "AMER NORTH", "Walt Disney Co", 2], ["NFLX.US", "AMER NORTH", "Netflix Inc", 2], ["CSCO.US", "AMER NORTH", "Cisco Systems", 2], ["AMD.US", "AMER NORTH", "Advanced Micro Devices", 2], ["INTC.US", "AMER NORTH", "Intel Corp", 2], ["QCOM.US", "AMER NORTH", "QUALCOMM Inc", 2], ["TXN.US", "AMER NORTH", "Texas Instruments", 2], ["ORCL.US", "AMER NORTH", "Oracle Corp", 2], ["CRM.US", "AMER NORTH", "Salesforce Inc", 2], ["ADBE.US", "AMER NORTH", "Adobe Inc", 2], ["NOW.US", "AMER NORTH", "ServiceNow Inc", 2], ["INTU.US", "AMER NORTH", "Intuit Inc", 2], ["UBER.US", "AMER NORTH", "Uber Technologies", 2], ["LYFT.US", "AMER NORTH", "Lyft Inc", 2], ["ABNB.US", "AMER NORTH", "Airbnb Inc", 2], ["SNAP.US", "AMER NORTH", "Snap Inc", 2], ["TWTR.US", "AMER NORTH", "Twitter Inc", 2], ["PINS.US", "AMER NORTH", "Pinterest Inc", 2], ["RBLX.US", "AMER NORTH", "Roblox Corp", 2], ["COIN.US", "AMER NORTH", "Coinbase Global", 2], ["MSTR.US", "AMER NORTH", "MicroStrategy Inc", 2], ["RIOT.US", "AMER NORTH", "Riot Platforms", 2], ["MARA.US", "AMER NORTH", "Marathon Digital", 2], ["HUT.US", "AMER NORTH", "Hut 8 Mining", 2], ["CLSK.US", "AMER NORTH", "CleanSpark Inc", 2], ["SPY.US", "AMER NORTH", "SPDR S&P 500 ETF", 2], ["QQQ.US", "AMER NORTH", "Invesco QQQ Trust", 2], ["IWM.US", "AMER NORTH", "iShares Russell 2000", 2], ["GLD.US", "AMER NORTH", "SPDR Gold Shares", 2], ["SLV.US", "AMER NORTH", "iShares Silver Trust", 2], ["TLT.US", "AMER NORTH", "iShares 20+ Year Treasury", 2], ["GS.US", "AMER NORTH", "Goldman Sachs Group", 2], ["MS.US", "AMER NORTH", "Morgan Stanley", 2], ["WFC.US", "AMER NORTH", "Wells Fargo & Co", 2], ["C.US", "AMER NORTH", "Citigroup Inc", 2], ["USB.US", "AMER NORTH", "U.S. Bancorp", 2], ["PNC.US", "AMER NORTH", "PNC Financial Services", 2], ["AXP.US", "AMER NORTH", "American Express", 2], ["COF.US", "AMER NORTH", "Capital One Financial", 2], ["RY.CA", "AMER NORTH", "Royal Bank of Canada", 2], ["TD.CA", "AMER NORTH", "Toronto-Dominion Bank", 2], ["BNS.CA", "AMER NORTH", "Bank of Nova Scotia", 2], ["CNQ.CA", "AMER NORTH", "Canadian Natural Resources", 2], ["SU.CA", "AMER NORTH", "Suncor Energy Inc", 2], ["CP.CA", "AMER NORTH", "Canadian Pacific Kansas", 2], ["ABX.CA", "AMER NORTH", "Barrick Gold Corp", 2], ["SHOP.CA", "AMER NORTH", "Shopify Inc", 2], ["MFC.CA", "AMER NORTH", "Manulife Financial", 2]];

const GOLD_BINANCE_FUTURES_MAP = {
  'BTCUSD':'BTCUSDT','ETHUSD':'ETHUSDT','SOLUSD':'SOLUSDT','BNBUSD':'BNBUSDT',
  'XRPUSD':'XRPUSDT','ADAUSD':'ADAUSDT','AVAXUSD':'AVAXUSDT','DOTUSD':'DOTUSDT',
  'LINKUSD':'LINKUSDT','LTCUSD':'LTCUSDT','DOGEUSD':'DOGEUSDT','MATICUSD':'MATICUSDT',
  'UNIUSD':'UNIUSDT','ATOMUSD':'ATOMUSDT','NEARUSD':'NEARUSDT','APTUSD':'APTUSDT',
  'ARBUSD':'ARBUSDT','OPUSD':'OPUSDT','INJUSD':'INJUSDT','SUIUSD':'SUIUSDT',
  'TIAUSD':'TIAUSDT','FTMUSD':'FTMUSDT','SANDUSD':'SANDUSDT','AXSUSD':'AXSUSDT',
  'AAEUSD':'AAVEUSDT','MKRUSD':'MKRUSDT','LDOUSD':'LDOUSDT','FETUSD':'FETUSDT',
  'WLDUSD':'WLDUSDT','PEPEUSD':'PEPEUSDT','BONKUSD':'BONKUSDT','SHIBUSDT':'SHIBUSDT',
  'XAUUSD':'XAUUSDT','XAGUSD':'XAGUSDT'
};
const GOLD_BINANCE_SPOT_MAP = {
  'EURUSD':'EURUSDT','GBPUSD':'GBPUSDT','AUDUSD':'AUDUSDT','NZDUSD':'NZDUSDT'
};

let goldActiveCategory='ALL', goldSearchQuery='', goldAlertsEnabled=false,
    goldSelectedSymbol='BTCUSD', goldQuotesCount=0, goldReqId=1, goldWs=null,
    goldInited=false, goldGlobeStarted=false;

const goldAssetsMap={}, goldPriceBuffers={}, goldRsiData={}, goldLastAlertState={};

GOLD_ASSET_RAW.forEach(item=>{
  const [sym,cat,name,dec]=item;
  goldAssetsMap[sym]={sym,cat,name,dec,bid:null,ask:null,spread:null,prevMid:null};
  goldPriceBuffers[sym]=[];
  goldRsiData[sym]={H1:null,H4:null,D1:null};
});

function goldFormatPrice(val,dec){
  if(val==null||isNaN(val))return'--';
  return Number(val).toFixed(dec);
}

// RSI Wilder (14) com media incremental — a mesma formula do prototipo,
// escolhida porque permite recalcular o RSI "ao vivo" a cada tick de
// cotacao (ve goldUpdateQuote) sem precisar rebuscar velas toda hora.
function goldComputeRSI(closes,period=14){
  if(!closes||closes.length<period+1)return null;
  let gains=0,losses=0;
  for(let i=1;i<=period;i++){const d=closes[i]-closes[i-1];if(d>=0)gains+=d;else losses+=-d;}
  let avgGain=gains/period, avgLoss=losses/period;
  for(let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    if(d>=0){avgGain=(avgGain*13+d)/14;avgLoss=(avgLoss*13)/14;}
    else{avgGain=(avgGain*13)/14;avgLoss=(avgLoss*13-d)/14;}
  }
  const rs=avgLoss===0?100:avgGain/avgLoss;
  const rsi=avgLoss===0?100:100-(100/(1+rs));
  return{rsi,avgGain,avgLoss,lastClose:closes[closes.length-1]};
}
function goldComputeInverseRSI(avgGain,avgLoss,lastClose,targetRSI){
  if(avgGain===undefined||avgLoss===undefined||!lastClose)return null;
  const R=targetRSI/(100-targetRSI);
  if(targetRSI<50){const L=13*((avgGain/R)-avgLoss);return lastClose-L;}
  const G=13*(R*avgLoss-avgGain);return lastClose+G;
}

async function goldFetchBinanceKlines(sym,interval){
  try{
    let url='';
    if(GOLD_BINANCE_FUTURES_MAP[sym]){
      url=`https://fapi.binance.com/fapi/v1/klines?symbol=${GOLD_BINANCE_FUTURES_MAP[sym]}&interval=${interval}&limit=56`;
    }else if(GOLD_BINANCE_SPOT_MAP[sym]){
      url=`https://api.binance.com/api/v3/klines?symbol=${GOLD_BINANCE_SPOT_MAP[sym]}&interval=${interval}&limit=56`;
    }else return null;
    const res=await fetch(url);
    if(!res.ok)return null;
    const data=await res.json();
    const closes=data.map(c=>parseFloat(c[4]));
    const calc=goldComputeRSI(closes,14);
    if(!calc)return null;
    const p30=goldComputeInverseRSI(calc.avgGain,calc.avgLoss,calc.lastClose,30);
    const p70=goldComputeInverseRSI(calc.avgGain,calc.avgLoss,calc.lastClose,70);
    return{rsi:calc.rsi,avgGain:calc.avgGain,avgLoss:calc.avgLoss,lastClose:calc.lastClose,p30,p70};
  }catch(e){return null;}
}

async function goldLoadAllBinanceRsi(){
  const syms=Object.keys(goldAssetsMap).filter(s=>GOLD_BINANCE_FUTURES_MAP[s]||GOLD_BINANCE_SPOT_MAP[s]);
  const tfMap={H1:'1h',H4:'4h',D1:'1d'};
  for(let i=0;i<syms.length;i+=5){
    if(!goldOpen)return;
    const chunk=syms.slice(i,i+5);
    await Promise.all(chunk.map(async sym=>{
      for(const tf of['H1','H4','D1']){
        const data=await goldFetchBinanceKlines(sym,tfMap[tf]);
        if(data)goldRsiData[sym][tf]=data;
      }
      goldUpdateMtfBadge(sym);
    }));
    renderGoldTable();
    renderGoldWatchlist();
    if(chunk.includes(goldSelectedSymbol))updateGoldDetailCard();
  }
  const upd=document.getElementById('gold-updated');
  if(upd){const now=new Date();upd.textContent=`atualizado ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;}
}

function goldConnectWS(){
  const st=document.getElementById('gold-ws-st');
  try{ if(goldWs)goldWs.close(); }catch(e){}
  goldWs=new WebSocket('wss://web-quotes-core.simplefx.com/websocket/quotes');
  goldWs.onopen=()=>{
    if(st)st.textContent='Conectado (377 ativos)';
    const allSymbols=Object.keys(goldAssetsMap);
    goldWs.send(JSON.stringify({p:'/subscribe/addList',i:goldReqId++,d:allSymbols}));
    goldWs.send(JSON.stringify({p:'/lastprices/list',i:goldReqId++,d:allSymbols}));
  };
  goldWs.onmessage=(evt)=>{
    try{
      const msg=JSON.parse(evt.data);
      if(msg.d&&Array.isArray(msg.d)){
        msg.d.forEach(q=>{if(q.s&&goldAssetsMap[q.s])goldUpdateQuote(q.s,q.b,q.a);});
      }
    }catch(e){}
  };
  goldWs.onclose=()=>{
    if(st)st.textContent='Desconectado - reconectando...';
    if(goldOpen)setTimeout(goldConnectWS,4000);
  };
  goldWs.onerror=()=>{try{goldWs.close();}catch(e){}};
}

function goldUpdateMtfBadge(sym){
  const el=document.getElementById(`gold-mtf-${sym}`);
  if(!el)return;
  const d=goldRsiData[sym];
  let bull=0,bear=0;
  ['H1','H4','D1'].forEach(tf=>{
    const r=d[tf];
    if(r&&r.rsi!=null){if(r.rsi>=50)bull++;else bear++;}
  });
  if(bull+bear===0){el.textContent='--';el.style.color='var(--t3)';return;}
  el.textContent=`${bull}B/${bear}S`;
  el.style.color=bull>bear?'var(--green)':bear>bull?'var(--red)':'var(--t2)';
}

function goldUpdateQuote(sym,bid,ask){
  goldQuotesCount++;
  const cntEl=document.getElementById('gold-globe-cnt');
  if(cntEl)cntEl.textContent=goldQuotesCount.toLocaleString('pt-BR')+' cotacoes';

  const a=goldAssetsMap[sym];
  if(!a)return;
  const mid=(bid+ask)/2;
  a.prevMid=mid;a.bid=bid;a.ask=ask;a.spread=Math.abs(ask-bid);

  // Ouro e prata no grafico principal andam por aqui. Passa pelo mesmo
  // forceChartTick da Binance, entao ganham de graca a vela em formacao, os
  // alarmes, o Multi-TF e o resto — nao e so o numero do topo mudando.
  if(fxAtivo && sym===fxAtivo){
    try{
      updatePriceUI(mid);
      forceChartTick(mid, Date.now());
      const dot=document.getElementById('ws-dot'), st=document.getElementById('ws-st');
      if(dot) dot.className='dot grn blink';
      if(st && st.textContent!=='LIVE (SimpleFX)') st.textContent='LIVE (SimpleFX)';
    }catch(e){}
  }

  if(!GOLD_BINANCE_FUTURES_MAP[sym]&&!GOLD_BINANCE_SPOT_MAP[sym]){
    const buf=goldPriceBuffers[sym];
    buf.push(mid);
    if(buf.length>56)buf.shift();
    if(buf.length>=15){
      const calc=goldComputeRSI(buf,14);
      if(calc){
        const p30=goldComputeInverseRSI(calc.avgGain,calc.avgLoss,calc.lastClose,30);
        const p70=goldComputeInverseRSI(calc.avgGain,calc.avgLoss,calc.lastClose,70);
        goldRsiData[sym].H1={rsi:calc.rsi,avgGain:calc.avgGain,avgLoss:calc.avgLoss,lastClose:calc.lastClose,p30,p70};
        goldRsiData[sym].H4=goldRsiData[sym].H1;
        goldRsiData[sym].D1=goldRsiData[sym].H1;
      }
    }
  }else{
    ['H1','H4','D1'].forEach(tf=>{
      const r=goldRsiData[sym][tf];
      if(r&&r.avgGain!==undefined){
        const diff=mid-r.lastClose;
        const g=Math.max(diff,0),l=Math.max(-diff,0);
        const liveAG=(r.avgGain*13+g)/14, liveAL=(r.avgLoss*13+l)/14;
        const liveRS=liveAL===0?100:liveAG/liveAL;
        r.rsi=liveAL===0?100:100-(100/(1+liveRS));
        r.p30=goldComputeInverseRSI(liveAG,liveAL,mid,30);
        r.p70=goldComputeInverseRSI(liveAG,liveAL,mid,70);
      }
    });
  }

  goldCheckAlerts(sym);
  goldUpdateMtfBadge(sym);

  const bidEl=document.getElementById(`gold-bid-${sym}`);
  const askEl=document.getElementById(`gold-ask-${sym}`);
  const spdEl=document.getElementById(`gold-spd-${sym}`);
  if(bidEl)bidEl.textContent=goldFormatPrice(a.bid,a.dec);
  if(askEl)askEl.textContent=goldFormatPrice(a.ask,a.dec);
  if(spdEl)spdEl.textContent=goldFormatPrice(a.spread,a.dec);

  ['H1','H4','D1'].forEach(tf=>{
    const r=goldRsiData[sym][tf];
    const rsiEl=document.getElementById(`gold-rsi-${tf.toLowerCase()}-${sym}`);
    const p30El=document.getElementById(`gold-p30-${tf.toLowerCase()}-${sym}`);
    const p70El=document.getElementById(`gold-p70-${tf.toLowerCase()}-${sym}`);
    if(rsiEl&&r&&r.rsi!=null){rsiEl.textContent=r.rsi.toFixed(1);rsiEl.className=getRsiClass(r.rsi);}
    if(p30El&&r&&r.p30!=null)p30El.textContent=goldFormatPrice(r.p30,a.dec);
    if(p70El&&r&&r.p70!=null)p70El.textContent=goldFormatPrice(r.p70,a.dec);
  });

  if(sym===goldSelectedSymbol)updateGoldDetailCard();
}

function renderGoldTable(){
  const tbody=document.getElementById('gold-tbody');
  if(!tbody)return;
  let html='';
  GOLD_ASSET_RAW.forEach(([sym,cat,name])=>{
    html+=`<tr id="gold-tr-${sym}" data-cat="${cat}" data-name="${(sym+' '+name).toLowerCase()}" onclick="selectGoldAsset('${sym}')">
      <td style="text-align:left;">
        <div style="font-weight:800;">${sym}</div>
        <div style="font-size:8.5px;color:var(--t3);">${name}</div>
      </td>
      <td style="font-size:9px;color:var(--t2);">${cat}</td>
      <td id="gold-bid-${sym}" style="color:var(--red);">--</td>
      <td id="gold-ask-${sym}" style="color:var(--green);">--</td>
      <td id="gold-spd-${sym}" style="color:var(--t2);">--</td>
      <td><span id="gold-rsi-h1-${sym}" class="rsi-c-n">--</span></td>
      <td style="font-size:9px;"><span style="color:var(--red);" id="gold-p30-h1-${sym}">--</span> / <span style="color:var(--green);" id="gold-p70-h1-${sym}">--</span></td>
      <td><span id="gold-rsi-h4-${sym}" class="rsi-c-n">--</span></td>
      <td><span id="gold-rsi-d1-${sym}" class="rsi-c-n">--</span></td>
      <td style="font-size:9px;"><span style="color:var(--red);" id="gold-p30-d1-${sym}">--</span> / <span style="color:var(--green);" id="gold-p70-d1-${sym}">--</span></td>
      <td id="gold-mtf-${sym}" style="color:var(--t3);">--</td>
    </tr>`;
  });
  tbody.innerHTML=html;
  goldApplyFilter();
}

function goldApplyFilter(){
  const q=goldSearchQuery;
  Object.keys(goldAssetsMap).forEach(sym=>{
    const tr=document.getElementById(`gold-tr-${sym}`);
    if(!tr)return;
    const a=goldAssetsMap[sym];
    const matchesCat=goldActiveCategory==='ALL'||a.cat===goldActiveCategory;
    const matchesSearch=!q||sym.toLowerCase().includes(q)||a.name.toLowerCase().includes(q);
    tr.classList.toggle('filtered-out', !(matchesCat&&matchesSearch));
  });
}

function goldSetCategory(cat){
  goldActiveCategory=cat;
  document.querySelectorAll('#gold-cats .cp').forEach(el=>{
    el.classList.toggle('active', el.dataset.cat===cat);
  });
  goldApplyFilter();
}
function goldOnSearch(val){
  goldSearchQuery=val.trim().toLowerCase();
  goldApplyFilter();
}

function renderGoldWatchlist(){
  const box=document.getElementById('gold-watchlist');
  if(!box)return;
  const syms=Object.keys(goldAssetsMap).filter(s=>goldAssetsMap[s].cat==='CRYPTO'||goldAssetsMap[s].cat==='FOREX').slice(0,60);
  const wlCount=document.getElementById('wl-count');
  if(wlCount)wlCount.textContent=syms.length+' ITEMS';
  box.innerHTML=syms.map(sym=>{
    const a=goldAssetsMap[sym];
    const r=goldRsiData[sym].H1;
    return `<div class="gold-wl-item" onclick="selectGoldAsset('${sym}')">
      <div><div style="font-weight:800;">${sym}</div><div style="font-size:8px;color:var(--t2);">${a.cat}</div></div>
      <div style="text-align:right;"><div style="color:var(--green);">${goldFormatPrice(a.ask,a.dec)}</div><div style="font-size:8.5px;color:var(--t2);">RSI ${r&&r.rsi!=null?r.rsi.toFixed(1):'--'}</div></div>
    </div>`;
  }).join('');
}

function updateGoldDetailCard(){
  const a=goldAssetsMap[goldSelectedSymbol];
  if(!a)return;
  const symEl=document.getElementById('gold-dt-sym');
  if(symEl)symEl.textContent=`${a.sym} — ${a.name}`;
  const grid=document.getElementById('gold-detail');
  if(!grid)return;
  const tfs=[['H1','1h'],['H4','4h'],['D1','1d']];
  grid.innerHTML=`
    <div class="gold-detail-box"><div class="gold-detail-lbl">BID</div><div class="gold-detail-val" style="color:var(--red);">${goldFormatPrice(a.bid,a.dec)}</div></div>
    <div class="gold-detail-box"><div class="gold-detail-lbl">ASK</div><div class="gold-detail-val" style="color:var(--green);">${goldFormatPrice(a.ask,a.dec)}</div></div>
    <div class="gold-detail-box"><div class="gold-detail-lbl">SPREAD</div><div class="gold-detail-val">${goldFormatPrice(a.spread,a.dec)}</div></div>
    ${tfs.map(([tf,lbl])=>{
      const r=goldRsiData[a.sym][tf];
      return `<div class="gold-detail-box">
        <div class="gold-detail-lbl">${lbl.toUpperCase()} RSI</div>
        <div class="gold-detail-val">${r&&r.rsi!=null?r.rsi.toFixed(1):'--'}</div>
        <div class="gold-detail-tgt">30: ${r?goldFormatPrice(r.p30,a.dec):'--'} · 70: ${r?goldFormatPrice(r.p70,a.dec):'--'}</div>
      </div>`;
    }).join('')}
  `;
}

function selectGoldAsset(sym){
  goldSelectedSymbol=sym;
  document.querySelectorAll('#gold-tbody tr.gold-selected').forEach(tr=>tr.classList.remove('gold-selected'));
  const tr=document.getElementById(`gold-tr-${sym}`);
  if(tr)tr.classList.add('gold-selected');
  updateGoldDetailCard();
}

// ALERTAS
function goldCheckAlerts(sym){
  ['H1','D1'].forEach(tf=>{
    const r=goldRsiData[sym][tf];
    if(!r||r.rsi==null)return;
    const key=sym+'_'+tf;
    const val=r.rsi;
    let condition=null,isExtreme=false;
    if(val<=32){condition='Sobrevenda';if(val<=22)isExtreme=true;}
    else if(val>=68){condition='Sobrecompra';if(val>=78)isExtreme=true;}
    if(condition){
      if(!goldLastAlertState[key]){goldLastAlertState[key]=true;goldTriggerAlert(sym,tf,val,condition,isExtreme);}
    }else goldLastAlertState[key]=false;
  });
}
function goldTriggerAlert(sym,tf,val,cond,isExtreme){
  goldAddAlertLog(sym,tf,val,cond,isExtreme);
  if(goldAlertsEnabled){
    goldPlayAlertSound(isExtreme);
    showInfoToast(`⚡ ${isExtreme?'EXTREMO ':''}${cond}`,`${sym} (${tf}): ${val.toFixed(1)}`);
  }
}
function goldPlayAlertSound(isExtreme){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type=isExtreme?'sawtooth':'sine';
    osc.frequency.setValueAtTime(isExtreme?880:587.33,ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(isExtreme?1320:880,ctx.currentTime+0.15);
    gain.gain.setValueAtTime(0.2,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.3);
    osc.connect(gain);gain.connect(ctx.destination);
    osc.start();osc.stop(ctx.currentTime+0.3);
    setTimeout(()=>{try{ctx.close();}catch(e){}},400);
  }catch(e){}
}
function goldAddAlertLog(sym,tf,val,cond,isExtreme){
  const box=document.getElementById('gold-alert-log');
  if(!box)return;
  const timeStr=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const cls=cond==='Sobrevenda'?'os':'ob';
  const item=document.createElement('div');
  item.className=`gold-alert-item ${cls}`;
  item.innerHTML=`<div style="display:flex;justify-content:space-between;font-weight:800;">
    <span>${sym} (${tf})</span>
    <span style="color:${cls==='os'?'var(--red)':'var(--green)'};">${cond} ${val.toFixed(1)}</span>
  </div><div style="color:var(--t3);font-size:9px;margin-top:2px;">${timeStr}${isExtreme?' · EXTREMO':''}</div>`;
  if(box.children[0]&&box.children[0].textContent.includes('Sem alertas'))box.innerHTML='';
  box.insertBefore(item,box.firstChild);
  while(box.children.length>50)box.removeChild(box.lastChild);
}
function goldClearAlertLog(){
  const box=document.getElementById('gold-alert-log');
  if(box)box.innerHTML='<div style="padding:10px;color:var(--t3);text-align:center;font-size:10px;">Sem alertas ainda</div>';
}
function goldToggleAlerts(){
  goldAlertsEnabled=!goldAlertsEnabled;
  const btn=document.getElementById('gold-btn-alerts');
  if(btn){
    btn.textContent=goldAlertsEnabled?'🔔 ON':'🔔 OFF';
    btn.classList.toggle('on',goldAlertsEnabled);
  }
  if(goldAlertsEnabled)showInfoToast('Alertas','Alertas da aba Gold ativados.');
}

// GLOBO 3D (canvas) — decorativo, so mostra contagem de cotacoes recebidas
function initGoldGlobe(){
  if(goldGlobeStarted)return;
  goldGlobeStarted=true;
  const canvas=document.getElementById('gold-globe-canvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  let angle=0;
  const cities=[
    {name:'NY',lat:40.71,lon:-74.00},{name:'LDN',lat:51.50,lon:-0.12},
    {name:'TKY',lat:35.67,lon:139.65},{name:'HK',lat:22.31,lon:114.16},
    {name:'SYD',lat:-33.86,lon:151.20},{name:'FRA',lat:50.11,lon:8.68},
    {name:'SIN',lat:1.35,lon:103.81},{name:'SP',lat:-23.55,lon:-46.63}
  ];
  function render(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const cx=canvas.width/2, cy=canvas.height/2, R=Math.min(cx,cy)*0.85;
    angle+=0.008;
    const grad=ctx.createRadialGradient(cx,cy,R*0.8,cx,cy,R*1.2);
    grad.addColorStop(0,'rgba(245,166,35,0.08)');
    grad.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=grad;
    ctx.beginPath();ctx.arc(cx,cy,R*1.2,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba(245,166,35,0.3)';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.stroke();
    for(let lon=0;lon<360;lon+=30){
      const radLon=((lon+angle*50)*Math.PI)/180;
      ctx.strokeStyle='rgba(255,255,255,0.08)';
      ctx.beginPath();
      for(let lat=-90;lat<=90;lat+=10){
        const radLat=(lat*Math.PI)/180;
        const x=R*Math.cos(radLat)*Math.sin(radLon);
        const y=R*Math.sin(radLat);
        const z=R*Math.cos(radLat)*Math.cos(radLon);
        if(z>0){
          const px=cx+x, py=cy-y;
          if(lat===-90)ctx.moveTo(px,py);else ctx.lineTo(px,py);
        }
      }
      ctx.stroke();
    }
    for(let lat=-60;lat<=60;lat+=30){
      const radLat=(lat*Math.PI)/180;
      const rLat=R*Math.cos(radLat), yLat=cy-R*Math.sin(radLat);
      ctx.strokeStyle=lat===0?'rgba(245,166,35,0.35)':'rgba(255,255,255,0.06)';
      ctx.beginPath();ctx.ellipse(cx,yLat,rLat,rLat*0.3,0,0,Math.PI*2);ctx.stroke();
    }
    const time=Date.now()*0.003;
    cities.forEach((city,idx)=>{
      const radLat=(city.lat*Math.PI)/180;
      const radLon=((city.lon+angle*50)*Math.PI)/180;
      const x=R*Math.cos(radLat)*Math.sin(radLon);
      const y=R*Math.sin(radLat);
      const z=R*Math.cos(radLat)*Math.cos(radLon);
      if(z>0){
        const px=cx+x, py=cy-y;
        const pulseR=3+Math.sin(time*3+idx)*3;
        ctx.strokeStyle='rgba(245,166,35,0.6)';ctx.lineWidth=1;
        ctx.beginPath();ctx.arc(px,py,pulseR,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle='#F5A623';
        ctx.beginPath();ctx.arc(px,py,2.5,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='rgba(255,255,255,0.65)';
        ctx.font='8px monospace';
        ctx.fillText(city.name,px+5,py+3);
      }
    });
  }
  lacoVisivel(canvas,render);
}

function goldInitOnce(){
  if(goldInited)return;
  goldInited=true;
  renderGoldTable();
  renderGoldWatchlist();
  selectGoldAsset('BTCUSD');
  initGoldGlobe();
  goldConnectWS();
  goldLoadAllBinanceRsi();
}

window.goldSetCategory=goldSetCategory;
window.goldOnSearch=goldOnSearch;
window.goldToggleAlerts=goldToggleAlerts;
window.goldClearAlertLog=goldClearAlertLog;
window.selectGoldAsset=selectGoldAsset;


function toggleGoldTab() {
  goldOpen = !goldOpen;
  painelExclusivo('gold-view',goldOpen);
  const el = document.getElementById('gold-view');
  if(el) el.classList.toggle('show', goldOpen);
  if(goldOpen) goldInitOnce();
}

window.toggleTerminalTab = toggleTerminalTab;
window.toggleBussolaModal = toggleBussolaModal;
window.togglePotential = togglePotential;
window.toggleGoldTab = toggleGoldTab;

// EXPORTACOES GLOBAIS (Gerado automaticamente)
window.archiveStudyObservation = typeof archiveStudyObservation !== 'undefined' ? archiveStudyObservation : null;
window.changeSym = typeof changeSym !== 'undefined' ? changeSym : null;
window.changeTF = typeof changeTF !== 'undefined' ? changeTF : null;
window.closeDerivModal = typeof closeDerivModal !== 'undefined' ? closeDerivModal : null;
window.filterRsiTable = typeof filterRsiTable !== 'undefined' ? filterRsiTable : null;
window.loadFullHistory = typeof loadFullHistory !== 'undefined' ? loadFullHistory : null;
window.onBuyClick = typeof onBuyClick !== 'undefined' ? onBuyClick : null;
window.onDerivConnectClick = typeof onDerivConnectClick !== 'undefined' ? onDerivConnectClick : null;
window.openDerivModal = typeof openDerivModal !== 'undefined' ? openDerivModal : null;
window.runBacktestUI = typeof runBacktestUI !== 'undefined' ? runBacktestUI : null;
window.setRsiZone = typeof setRsiZone !== 'undefined' ? setRsiZone : null;
window.setTTSide = typeof setTTSide !== 'undefined' ? setTTSide : null;
window.sortRsiTable = typeof sortRsiTable !== 'undefined' ? sortRsiTable : null;
window.swapStochPhiPanels = typeof swapStochPhiPanels !== 'undefined' ? swapStochPhiPanels : null;
window.switchRTab = typeof switchRTab !== 'undefined' ? switchRTab : null;
window.toggleAlerts = typeof toggleAlerts !== 'undefined' ? toggleAlerts : null;
window.toggleBacktestTab = typeof toggleBacktestTab !== 'undefined' ? toggleBacktestTab : null;
window.toggleMacroTab = typeof toggleMacroTab !== 'undefined' ? toggleMacroTab : null;
window.toggleMultiView = typeof toggleMultiView !== 'undefined' ? toggleMultiView : null;
window.toggleRainbowTab = typeof toggleRainbowTab !== 'undefined' ? toggleRainbowTab : null;
window.toggleRsiTable = typeof toggleRsiTable !== 'undefined' ? toggleRsiTable : null;
window.toggleStudyArchive = typeof toggleStudyArchive !== 'undefined' ? toggleStudyArchive : null;
window.toggleTheme = typeof toggleTheme !== 'undefined' ? toggleTheme : null;
window.toggleTokenVisibility = typeof toggleTokenVisibility !== 'undefined' ? toggleTokenVisibility : null;
window.toggleValidatorPanel = typeof toggleValidatorPanel !== 'undefined' ? toggleValidatorPanel : null;
window.updateTTCalc = typeof updateTTCalc !== 'undefined' ? updateTTCalc : null;

let mtfTfs = ['15m','1h','4h','1d']; // base state
// Trocar o TF de uma celula recarregava o painel MULTI (outro painel), o que
// nao fazia nada visivel aqui. Agora recarrega so a celula que mudou.
async function changeMtfTf(index, newTf){
  mtfTfs[index-1]=newTf;
  if(!window.mtfViewOpen) return;
  const i=index-1, el=document.getElementById("mtf-chart-"+index);
  if(!el||!mtfCharts[i]) return;
  try{
    const sym=typeof currentSym!=="undefined"?currentSym:"BTCUSDT";
    const data=await fetchCandles(sym,newTf,300);
    if(data&&data.length){
      mtfSeries[i].setData(data);
      mtfDesenhaCelula(index,data,mtfLinhas[i]);
      mtfAtualizaTotal();
    }
  }catch(e){ console.warn("[mtf] troca de TF falhou:",e); }
}
window.changeMtfTf = changeMtfTf;


// ====================================
// MULTI-TF LOGIC RESTORATION
// ====================================
let mtfCharts = [];
let mtfSeries = [];

function toggleMtfView() {
  if (typeof window.mtfViewOpen === 'undefined') window.mtfViewOpen = false;
  window.mtfViewOpen = !window.mtfViewOpen;
  
  const el = document.getElementById('mtf-view');
  if(!el) return;
  
  painelExclusivo('mtf-view',window.mtfViewOpen);
  if (window.mtfViewOpen) {
    el.classList.add('show');
    openMtfCharts();
  } else {
    el.classList.remove('show');
    closeMtfCharts();
  }
}

// O painel Multi-TF tinha o markup completo no index.html — preco, timer,
// seletor de TF, bussola e legenda por celula — mas o codigo so criava os
// quatro graficos e ignorava o resto. Auditado: das 9 familias de elementos
// mtf-*, so mtf-chart-1..4 tinha quem escrevesse nela. O que segue liga as
// outras oito no mesmo markup que ja estava la.

const MTF_MEDIAS=[
  {key:"ema8",  p:8,   larg:2, cor:C.ema8},
  {key:"ema16", p:16,  larg:2, cor:C.ema16},
  {key:"ema55", p:55,  larg:2, cor:C.ema55},
  {key:"ema98", p:98,  larg:1, cor:C.ema98},
  {key:"ema200",p:200, larg:2, cor:C.ema200},
];
let mtfLinhas=[];      // series de media por celula, pra remover junto
let mtfEstado=[];      // ultimo calculo de cada celula, usado pelo popup
let mtfDados=[];       // as velas de cada celula, atualizadas no tick ao vivo
let mtfTimerInt=null;

// segundos de cada timeframe, pra contagem regressiva da vela
function mtfTfSegundos(tf){
  const n=parseFloat(tf), u=tf.replace(/[\d.]/g,"");
  const mapa={m:60,h:3600,d:86400,w:604800,M:2592000};
  return (mapa[u]||60)*(isNaN(n)?1:n);
}

function mtfLeTfs(){
  for(let i=0;i<4;i++){
    const sel=document.getElementById("mtf-sel-"+(i+1));
    if(sel&&sel.value) mtfTfs[i]=sel.value;
  }
}

async function openMtfCharts() {
  const mtfView=document.getElementById("mtf-view");
  if(!mtfView) return;
  closeMtfCharts();
  mtfLeTfs();
  const sym = typeof currentSym!=="undefined" ? currentSym : "BTCUSDT";
  document.querySelectorAll("#mtf-view .mtf-sym-lbl").forEach(el=>{el.textContent=sym;});

  for(let i=0;i<4;i++){
    const n=i+1;
    const el=document.getElementById("mtf-chart-"+n);
    if(!el) continue;
    const chart=LightweightCharts.createChart(el,{
      layout:{background:{color:"transparent"},textColor:"#8b9bb4"},
      grid:{vertLines:{color:"rgba(255,255,255,0.02)"},horzLines:{color:"rgba(255,255,255,0.02)"}},
      timeScale:{timeVisible:true}
    });
    const series=chart.addCandlestickSeries({
      upColor:"#00ffaa",downColor:"#ff4444",borderUpColor:"#00ffaa",
      borderDownColor:"#ff4444",wickUpColor:"#00ffaa",wickDownColor:"#ff4444"
    });
    // as medias que faltavam no modo multi, as mesmas do grafico principal
    const linhas={};
    MTF_MEDIAS.forEach(m=>{ linhas[m.key]=chart.addLineSeries({
      color:m.cor,lineWidth:m.larg,priceLineVisible:false,
      lastValueVisible:false,crosshairMarkerVisible:false}); });
    mtfCharts.push(chart); mtfSeries.push(series); mtfLinhas.push(linhas);

    try{
      const data=await fetchCandles(sym,mtfTfs[i],300);
      if(data&&data.length){
        series.setData(data);
        mtfDados[i]=data;
        mtfDesenhaCelula(n,data,linhas);
      }
    }catch(e){ console.warn("[mtf] celula "+n+" falhou:",e); }
  }
  mtfAtualizaTotal();
  mtfIniciaTimers();
  for(let n=1;n<=4;n++) mtfArrastavel(n);
}

// Calcula as medias da celula, desenha as linhas, o preco, a bussola e a
// legenda. O angulo de cada media reusa o mesmo maAngleDeg do painel
// principal, entao a leitura e a mesma coisa em toda parte.
function mtfDesenhaCelula(n,data,linhas){
  const closes=data.map(d=>d.close), highs=data.map(d=>d.high), lows=data.map(d=>d.low);
  const series={};
  MTF_MEDIAS.forEach(m=>{
    const arr=ema(closes,m.p);
    series[m.key]=arr;
    if(linhas&&linhas[m.key]) linhas[m.key].setData(
      data.map((d,i)=>({time:d.time,value:arr[i]})).filter(x=>x.value!=null));
  });
  const atrV=atrCalc(highs,lows,closes,14);
  const idx=closes.length-1;
  const angles={};
  MTF_MEDIAS.forEach(m=>{ angles[m.key]=maAngleDeg(series[m.key],atrV,idx,DIRECAO_LOOKBACK); });
  const cls=classifyDirecao(angles);
  cls.angles=angles; // o title do placar lista grau a grau
  mtfEstado[n-1]={tf:mtfTfs[n-1],angles,cls,preco:closes[idx],ultimoT:data[data.length-1].time};

  const px=document.getElementById("mtf-px-"+n);
  // mesmo formato do painel Multi: prata tem 3 casas, o resto 2
  if(px) px.textContent="$"+closes[idx].toFixed(String(currentSym||"").startsWith("XAG")?3:2);

  renderDirecaoCompass(angles,"mtf-compass-svg-"+n);
  mtfDesenhaLegenda(n,angles,cls);
  mtfDesenhaComparacao(n,cls);
}

function mtfDesenhaLegenda(n,angles,cls){
  const el=document.getElementById("mtf-compass-legend-"+n);
  if(!el) return;
  // legenda sobre fundo escuro: as cores das medias precisam ser clareadas
  const linhas=MTF_MEDIAS.map(m=>{
    const a=angles[m.key];
    const txt=(a==null)?"--":(a>=0?"+":"")+a.toFixed(0)+"\u00b0";
    return '<span style="color:'+clarear(m.cor,.45)+'">'+m.key.toUpperCase()+' '+txt+'</span>';
  });
  const est=cls.isFlat?"LATERAL":(cls.direcao==="alta"?"ALTA":"BAIXA");
  const cor=cls.isFlat?"#8b9bb4":(cls.direcao==="alta"?"#00C853":"#FF3B30");
  linhas.push('<span style="color:'+cor+';font-weight:700">'+est+'</span>');
  el.innerHTML=linhas.join("");
}

// O placar e SOMA de graus, nao media. Cada celula soma os angulos das suas
// cinco medias; o total soma as quatro celulas. Assim uma media parada nao
// dilui as outras — ela so nao contribui — e o numero cresce com quantas
// medias estao inclinadas E com o quanto elas inclinam.
function mtfDesenhaComparacao(n,cls){
  const el=document.getElementById("mtf-comp-val-"+n);
  const lbl=document.getElementById("mtf-comp-lbl-"+n);
  if(lbl) lbl.textContent=mtfTfs[n-1].toUpperCase();
  if(!el) return;
  // Predominancia: quantas das cinco medias apontam pro lado da soma. A soma
  // sozinha nao separa "quatro medias subindo" de "uma media muito inclinada
  // carregando quatro contra" — e essa e a diferenca que interessa ler.
  // Medias praticamente paradas (menos de 4 graus) nao contam pra nenhum lado.
  const v=cls.sumAngle;
  const graus=MTF_MEDIAS.map(m=>cls.angles?cls.angles[m.key]:null).filter(x=>x!=null);
  const pos=graus.filter(x=>x>=4).length, neg=graus.filter(x=>x<=-4).length;
  const aFavor=(v>=0?pos:neg);
  // A predominancia entra menor e numa segunda linha: no quadrante do painel
  // central as duas informacoes juntas numa linha so estouravam a largura e
  // passavam por cima do quadrante vizinho.
  el.innerHTML=(v==null)?"--":(v>=0?"+":"")+v.toFixed(1)+"\u00b0"
    +'<span style="display:block;font-size:9px;font-weight:700;opacity:.75;">'
    +aFavor+"/"+graus.length+"</span>";
  // ambar quando a forca vem de poucas medias: o numero e alto mas nao ha
  // predominancia por tras dele
  el.style.color=(v==null)?"var(--t3)":(cls.isFlat?"#8b9bb4":
    (aFavor<=graus.length/2?"#F5A623":(v>=0?"#00C853":"#FF3B30")));
  const detalhe=MTF_MEDIAS.map(m=>{const a=cls.angles?cls.angles[m.key]:null;
    return m.key.toUpperCase()+" "+(a==null?"--":(a>=0?"+":"")+a.toFixed(1)+"\u00b0");}).join("  ");
  el.title=mtfTfs[n-1].toUpperCase()+": "+detalhe+"   soma "+((v==null)?"--":v.toFixed(1)+"\u00b0")+"   predominancia "+aFavor+"/"+graus.length;
}

// Soma das quatro somas. O n/4 ao lado diz quantos tempos apontam pro mesmo
// lado do total — a soma sozinha nao mostra se ela veio de todos concordando
// ou de um tempo muito inclinado contra os outros.
function mtfAtualizaTotal(){
  const el=document.getElementById("mtf-comp-total");
  if(!el) return;
  const somas=mtfEstado.filter(Boolean).map(e=>e.cls.sumAngle).filter(v=>v!=null);
  if(!somas.length){ el.textContent="--"; el.title=""; return; }
  const total=somas.reduce((a,b)=>a+b,0);
  const mesmoLado=somas.filter(v=>Math.sign(v)===Math.sign(total)).length;
  // duas linhas: o numero nao cabia junto do n/4 dentro do circulo
  el.innerHTML=(total>=0?"+":"")+total.toFixed(0)+"\u00b0"
    +'<span style="display:block;font-size:9px;opacity:.8;">'+mesmoLado+"/"+somas.length+"</span>";
  el.style.color=mesmoLado===somas.length?(total>=0?"#00C853":"#FF3B30"):"#F5A623";
  el.title=mtfEstado.filter(Boolean).map((e,i)=>
    (e.tf||"").toUpperCase()+" "+(e.cls.sumAngle>=0?"+":"")+e.cls.sumAngle.toFixed(1)+"\u00b0").join("   ")
    +"   =   "+(total>=0?"+":"")+total.toFixed(1)+"\u00b0";
}

// Contagem regressiva ate o fechamento da vela de cada celula.
function mtfIniciaTimers(){
  if(mtfTimerInt) clearInterval(mtfTimerInt);
  mtfTimerInt=setInterval(()=>{
    const agora=Math.floor((Date.now()+(typeof serverTimeOffset!=="undefined"?serverTimeOffset:0))/1000);
    for(let i=0;i<4;i++){
      const el=document.getElementById("mtf-timer-"+(i+1)), st=mtfEstado[i];
      if(!el||!st) continue;
      const falta=(st.ultimoT+mtfTfSegundos(st.tf))-agora;
      if(falta<=0){ el.textContent="00:00"; continue; }
      const h=Math.floor(falta/3600), m=Math.floor((falta%3600)/60), sg=falta%60;
      el.textContent=h>0 ? h+":"+String(m).padStart(2,"0")+":"+String(sg).padStart(2,"0")
                         : String(m).padStart(2,"0")+":"+String(sg).padStart(2,"0");
    }
  },1000);
}

// BUSSOLA ARRASTAVEL. O container nasce com pointer-events:none no style
// inline do HTML — sem mexer nisso ele nao recebe nem o clique nem o arrasto.
// Uso Pointer Events pra valer no dedo e no mouse com o mesmo codigo, e
// setPointerCapture pra nao perder o arrasto quando o dedo sai do elemento.
// A posicao de cada bussola fica no localStorage, senao ela voltaria pro
// canto toda vez que o painel reabrisse.
function mtfArrastavel(n){
  const box=document.getElementById("mtf-compass-container-"+n);
  if(!box||box.dataset.arrastavel) return;
  box.dataset.arrastavel="1";
  box.style.pointerEvents="auto";
  box.style.cursor="grab";
  box.style.touchAction="none"; // senao o navegador rola a pagina em vez de arrastar

  const chave="mtf-bussola-pos-"+n;
  try{
    const salvo=JSON.parse(localStorage.getItem(chave)||"null");
    if(salvo){ box.style.left=salvo.x+"px"; box.style.top=salvo.y+"px"; box.style.right="auto"; }
  }catch(e){}

  let arrastando=false,x0=0,y0=0,l0=0,t0=0,mexeu=false;
  box.addEventListener("pointerdown",e=>{
    arrastando=true; mexeu=false;
    const r=box.getBoundingClientRect(), pr=box.offsetParent.getBoundingClientRect();
    l0=r.left-pr.left; t0=r.top-pr.top; x0=e.clientX; y0=e.clientY;
    box.style.right="auto"; box.style.left=l0+"px"; box.style.top=t0+"px";
    box.style.cursor="grabbing"; box.setPointerCapture(e.pointerId);
  });
  box.addEventListener("pointermove",e=>{
    if(!arrastando) return;
    const dx=e.clientX-x0, dy=e.clientY-y0;
    if(Math.abs(dx)>3||Math.abs(dy)>3) mexeu=true;
    const pai=box.offsetParent.getBoundingClientRect();
    // presa dentro da celula, senao some atras do painel
    const nx=Math.max(0,Math.min(l0+dx,pai.width-box.offsetWidth));
    const ny=Math.max(0,Math.min(t0+dy,pai.height-box.offsetHeight));
    box.style.left=nx+"px"; box.style.top=ny+"px";
  });
  const solta=e=>{
    if(!arrastando) return;
    arrastando=false; box.style.cursor="grab";
    try{ box.releasePointerCapture(e.pointerId); }catch(err){}
    try{ localStorage.setItem(chave,JSON.stringify(
      {x:parseFloat(box.style.left)||0,y:parseFloat(box.style.top)||0})); }catch(err){}
    // clique sem arrasto abre o detalhe; com arrasto, nao
    if(!mexeu) mtfAbrePopup(n);
  };
  box.addEventListener("pointerup",solta);
  box.addEventListener("pointercancel",solta);
  box.title="Arraste para mover \u00b7 clique para o detalhe";
}

// Popup com a leitura daquele timeframe: angulo de cada media, o placar e o
// estado. Reusa o toast do app em vez de inventar outro modal.
function mtfAbrePopup(n){
  const st=mtfEstado[n-1];
  if(!st){ return; }
  const linhas=MTF_MEDIAS.map(m=>{
    const a=st.angles[m.key];
    return m.key.toUpperCase()+": "+(a==null?"--":(a>=0?"+":"")+a.toFixed(1)+"\u00b0");
  });
  const est=st.cls.isFlat?"LATERAL":(st.cls.direcao==="alta"?"ALTA":"BAIXA");
  const placar=st.cls.sumAngle==null?"--":(st.cls.sumAngle>=0?"+":"")+st.cls.sumAngle.toFixed(1)+"\u00b0";
  const msg=linhas.join("  \u00b7  ")+"   |   soma "+placar+"   |   "+est;
  if(typeof showInfoToast==="function") showInfoToast(st.tf.toUpperCase()+" \u00b7 "+
    (typeof currentSym!=="undefined"?currentSym:""), msg);
}

// SINCRONIA AO VIVO. O painel carregava as velas uma vez e congelava — nao
// havia WebSocket nem timer (o multiWS e do painel Multi, nao deste). Como o
// Multi-TF mostra o MESMO ativo em quatro tempos, o tick do grafico principal
// ja traz o preco de que ele precisa: nao vale abrir uma segunda conexao pro
// mesmo dado.
//
// O preco de cada celula anda a cada tick, que e barato. O recalculo das cinco
// medias, do ATR e dos angulos e caro pra fazer 4x por tick, entao roda no
// maximo a cada MTF_RECALCULO_MS — ou na hora, quando uma vela fecha, que e
// quando o numero realmente muda de patamar.
const MTF_RECALCULO_MS=1500;
let mtfUltimoCalculo=0;

function mtfAplicaTick(preco,ts_ms){
  if(!window.mtfViewOpen||!mtfDados.length||!isFinite(preco)) return;
  const nowSec=Math.floor(ts_ms/1000);
  let fechou=false;

  for(let i=0;i<4;i++){
    const velas=mtfDados[i], serie=mtfSeries[i];
    if(!velas||!velas.length||!serie) continue;
    const tfSec=mtfTfSegundos(mtfTfs[i]);
    const esperado=nowSec-(nowSec%tfSec);
    const ultima=velas[velas.length-1];

    if(esperado>ultima.time){
      // vela nova: abre no fechamento da anterior, como a corretora faz
      const nova={time:esperado,open:ultima.close,high:Math.max(ultima.close,preco),
                  low:Math.min(ultima.close,preco),close:preco};
      velas.push(nova);
      if(velas.length>400) velas.shift();
      fechou=true;
    }else if(esperado===ultima.time){
      ultima.close=preco;
      if(preco>ultima.high) ultima.high=preco;
      if(preco<ultima.low)  ultima.low=preco;
    }else{
      continue; // tick atrasado, de uma vela que ja passou
    }
    try{ serie.update(velas[velas.length-1]); }catch(e){}

    const px=document.getElementById("mtf-px-"+(i+1));
    if(px) px.textContent="$"+preco.toFixed(String(currentSym||"").startsWith("XAG")?3:2);
  }

  const agora=Date.now();
  if(!fechou&&agora-mtfUltimoCalculo<MTF_RECALCULO_MS) return;
  mtfUltimoCalculo=agora;
  for(let i=0;i<4;i++){
    if(mtfDados[i]&&mtfDados[i].length) mtfDesenhaCelula(i+1,mtfDados[i],mtfLinhas[i]);
  }
  mtfAtualizaTotal();
}
window.mtfAplicaTick=mtfAplicaTick;

function closeMtfCharts() {
  if(mtfTimerInt){ clearInterval(mtfTimerInt); mtfTimerInt=null; }
  mtfCharts.forEach(c=>{ try{c.remove();}catch(e){} });
  mtfCharts=[]; mtfSeries=[]; mtfLinhas=[]; mtfEstado=[]; mtfDados=[];
}

window.toggleMtfView = toggleMtfView;

// Re-assign modals explicitly to ensure they work on click

// A sobrescrita que existia aqui foi fundida na definicao la de cima — era
// ela que de fato rodava, e por isso a versao com os 4 ativos nao aparecia.

// Havia uma TERCEIRA sobrescrita de togglePotential aqui — a que de fato
// rodava, porque era a ultima. Ela abria o card e parava por ai, sem chamar
// updatePotential(), entao o Potencial abria com os campos em branco ate algo
// mais no app resolver atualiza-lo. Fica so a definicao la de cima, que
// preenche ao abrir. Mesma armadilha que ja tinha comido a toggleTerminalTab e
// a toggleBussolaModal: neste arquivo, quem reatribui window.X por ultimo
// ganha, e o "por ultimo" fica mil linhas longe da definicao.

// Havia uma SEGUNDA definicao de toggleTerminalTab aqui, sobrescrevendo a de
// cima: ela nao mexia no terminalOpen, escondia so o .chart-wrap e nao fechava
// nenhum outro painel — era por isso que abrir o Terminal deixava o painel
// anterior na tela. Fica so a de cima, que passa pelo painelExclusivo.



window.updatePotential = updatePotential;



// DIRECAO (BUSSOLA) — angulo de cada media em graus, normalizado por ATR
// (nao por pixel do grafico, que muda com zoom): inclinacao = variacao da
// media em unidades de ATR por vela, convertida pra grau via atan(). Assim
// 45 graus sempre significa "andou ~1 ATR por vela", comparavel entre
// ativos/timeframes diferentes.
//
// Tambem le o momentum do mercado com uma maquina de estados simples:
//   ENSAIO      — maioria das medias quase horizontal (o squeeze antes da
//                 explosao, o "ensaio" que o proprio ATLAS ja detecta como
//                 squeeze do feixe, so que aqui em graus).
//   EXPLOSAO    — saiu de um ENSAIO com angulo forte pro mesmo lado (gera
//                 sinal de verdade, entra no log de SINAIS e beipa).
//   CONTINUACAO — segue esticado e alinhado (nao veio de um ensaio recente).
//   RECUO       — alguma media perdeu boa parte do seu pico de angulo —
//                 comecando a reverter.
// ══════════════════════════════════════════════════════
// As caixas de legenda sao escuras e varias cores de media tambem — EMA8 azul,
// EMA55 verde e EMA200 roxo sumiam no fundo. Clareio a cor na direcao do
// branco so no texto; as linhas do grafico seguem com a cor original, senao
// deixariam de casar com o grafico principal.
function clarear(hex,f){
  const n=parseInt(String(hex).slice(1),16);
  if(!isFinite(n)) return hex;
  const r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  const m=v=>Math.round(v+(255-v)*(f==null?.45:f));
  return "rgb("+m(r)+","+m(g)+","+m(b)+")";
}

const DIRECAO_MAS=[
  {key:'ema8',lbl:'EMA8',color:C.ema8},
  {key:'ema16',lbl:'EMA16',color:C.ema16},
  {key:'ema55',lbl:'EMA55',color:C.ema55},
  {key:'ema98',lbl:'EMA98',color:C.ema98},
  {key:'ema200',lbl:'EMA200',color:C.ema200},
  {key:'ma56',lbl:'MA56',color:C.ma56},
  {key:'ma89',lbl:'MA89',color:C.ma89},
];
const DIRECAO_STATE_LBL={ensaio:'ENSAIO',explosao:'EXPLOSAO',continuacao:'CONTINUACAO',recuo:'RECUO',reversao:'REVERSAO',indefinido:'NEUTRO'};
const DIRECAO_LOOKBACK=5; // velas usadas pra medir a inclinacao de cada media
// Ganho de sensibilidade original era 3x, mas foi removido (1x) para mostrar o grau real.
const DIRECAO_GAIN=1;
let direcaoPeakSum = 0, direcaoSumSign = 1, lastExhaustionPeak = 0;
let direcaoAngles={}, direcaoState='indefinido', direcaoPrevState='indefinido';
let direcaoPeakAngle={}, direcaoWasFlat=true, direcaoHistory=[];
const DIRECAO_HISTORY_CAP=60;

function maAngleDeg(series,atrArr,idx,lookback){
  if(!series||!atrArr||idx<lookback||idx>=series.length)return null;
  const now=series[idx],then=series[idx-lookback],atrNow=atrArr[idx];
  if(now==null||then==null||atrNow==null||atrNow===0)return null;
  const slope=(now-then)/(lookback*atrNow);
  return Math.atan(slope*DIRECAO_GAIN)*180/Math.PI;
}

function classifyDirecao(angles){
  const vals=Object.values(angles).filter(v=>v!=null);
  if(!vals.length)return{avgAngle:null,isFlat:true,isSteep:false,direcao:null};
  const avgAngle=vals.reduce((a,b)=>a+b,0)/vals.length;
  const flatCount=vals.filter(v=>Math.abs(v)<4).length;
  const dirSign=avgAngle>=0?1:-1;
  const alignedCount=vals.filter(v=>Math.sign(v)===dirSign&&Math.abs(v)>=4).length;
  return {
      avgAngle,
      sumAngle: vals.reduce((a,b)=>a+b,0),
      isFlat:flatCount>=Math.ceil(vals.length*0.6),
      isSteep:Math.abs(avgAngle)>=12&&alignedCount>=Math.ceil(vals.length*0.6),
      direcao:avgAngle>=0?'alta':'baixa',
    };
}

function updateDirecaoTracking(angles){
  const cls=classifyDirecao(angles);
  Object.entries(angles).forEach(([k,v])=>{
    if(v==null)return;
    const av=Math.abs(v);
    if(direcaoPeakAngle[k]==null||av>direcaoPeakAngle[k])direcaoPeakAngle[k]=av;
  });

  const sumAngle = cls.sumAngle;
  if(sumAngle!=null){
    if(Math.sign(sumAngle)!==direcaoSumSign){
      direcaoPeakSum = sumAngle;
      direcaoSumSign = Math.sign(sumAngle);
      lastExhaustionPeak = 0;
    }else{
      if(Math.abs(sumAngle) > Math.abs(direcaoPeakSum)){
        direcaoPeakSum = sumAngle;
      }
    }
    if(Math.abs(direcaoPeakSum) >= 40){
      const loss = Math.abs(direcaoPeakSum) - Math.abs(sumAngle);
      if(loss >= 13 && direcaoPeakSum !== lastExhaustionPeak){
        const idx = candles.length - 1;
        const price = candles[idx] ? candles[idx].close : null;
        if(price != null) addSig('EXAUSTAO', direcaoPeakSum > 0 ? 'SELL' : 'BUY', idx, price);
        lastExhaustionPeak = direcaoPeakSum;
      }
    }
  }

  let newState='indefinido';
  if(cls.isFlat){
    newState='ensaio';
    direcaoWasFlat=true;
    direcaoPeakAngle={};
  }else if(cls.isSteep){
    newState=direcaoWasFlat?'explosao':'continuacao';
    direcaoWasFlat=false;
  }else{
    const recuando=Object.entries(angles).some(([k,v])=>{
      if(v==null||direcaoPeakAngle[k]==null)return false;
      return direcaoPeakAngle[k]>=35&&(direcaoPeakAngle[k]-Math.abs(v))>=20;
    });
    newState=recuando?'recuo':'indefinido';
    }
    
    // Se a direcao mudar em relacao ao ultimo estado de tendencia
    if(cls.isSteep && direcaoHistory.length > 0) {
       const lastTrend = direcaoHistory.find(h => h.state === 'explosao' || h.state === 'continuacao');
       if(lastTrend && lastTrend.direcao !== cls.direcao) {
           newState = 'reversao';
       }
    }

  if(newState!==direcaoPrevState){
    const idx=candles.length-1;
    const price=candles[idx]?candles[idx].close:null;
    direcaoHistory.unshift({state:newState,prevState:direcaoPrevState,direcao:cls.direcao,avgAngle:cls.avgAngle,time:Date.now()});
    if(direcaoHistory.length>DIRECAO_HISTORY_CAP)direcaoHistory.length=DIRECAO_HISTORY_CAP;
    direcaoPrevState=newState;
    // Sinal de verdade so na EXPLOSAO (entrada de continuidade) — ENSAIO e
    // RECUO sao so avisos visuais, nao entram no log de sinais nem beipam.
    if(newState==='explosao'&&price!=null)addSig('DIRECAO',cls.direcao==='alta'?'BUY':'SELL',idx,price);
    renderDirecaoHistory();
  }
  direcaoState=newState;
  return cls;
}

// O segundo argumento existe pro Multi-TF: cada celula tem a sua bussola
// (mtf-compass-svg-1..4). Sem ele o comportamento e o de sempre.
function renderDirecaoCompass(angles,svgId){
  const svg=document.getElementById(svgId||'direcao-compass');
  if(!svg)return;
  const cx=55,cy=55,r=48,needleLen=42;
  let inner=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bd3)" stroke-width="1"/>`;
  inner+=`<line x1="${cx-r}" y1="${cy}" x2="${cx+r}" y2="${cy}" stroke="var(--bd2)" stroke-width="1" stroke-dasharray="2,3"/>`;
  inner+=`<line x1="${cx}" y1="${cy-r}" x2="${cx}" y2="${cy+r}" stroke="var(--bd2)" stroke-width="1" stroke-dasharray="2,3"/>`;
  let legendHTML = '';
      DIRECAO_MAS.forEach(({key,color})=>{
          const ang=angles[key];
          if(ang==null)return;
          const rad=ang*Math.PI/180;
          const x2=cx+needleLen*Math.cos(rad),y2=cy-needleLen*Math.sin(rad);
          inner+= `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
          
          legendHTML += `<div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
              <span style="display:flex; align-items:center; gap:4px;"><span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;"></span> ${key.toUpperCase()}</span>
              <span style="color:${ang > 0 ? 'var(--green)' : 'var(--red)'};">${Math.round(ang)}&deg;</span>
          </div>`;
      });
      inner+= `<circle cx="${cx}" cy="${cy}" r="3" fill="var(--text)"/>`;
      svg.innerHTML=inner;
      // (nao atualiza nenhum "mtf-compass-legend-N" aqui — essa e a bussola
      // UNICA/global, sem indice. As 4 bussolas do Multi-TF tem sua propria
      // funcao separada, indexada de verdade, mais abaixo no arquivo. Um
      // resquicio de copy-paste dessa outra funcao tinha ficado aqui
      // referenciando uma variavel `index` que nunca existe neste escopo —
      // era isso que disparava o "ReferenceError: index is not defined" em
      // TODA atualizacao de vela/tick.)
}

function renderDirecaoReadout(angles, cls){
    const box=document.getElementById('direcao-readout');
    if(!box)return;
    box.innerHTML=DIRECAO_MAS.map(({key,lbl,color})=>{
      const v=angles[key];
      const txt=v==null?'--':(v>=0?'+':'')+v.toFixed(0)+'°';
      const strong=v!=null&&Math.abs(v)>=60;
      return `<div style="display:flex;justify-content:space-between;"><span style="color:${color};">${lbl}</span><span style="color:${v==null?'var(--t3)':v>=0?'var(--green)':'var(--red)'};font-weight:${strong?900:700};">${txt}</span></div>`;
    }).join('');
    
    // Add Forca Total
    if(cls.sumAngle!=null){
      const sumTxt=(cls.sumAngle>=0?'+':'')+cls.sumAngle.toFixed(0)+'°';
      const peakTxt=(direcaoPeakSum>=0?'+':'')+direcaoPeakSum.toFixed(0)+'°';
      const strong=Math.abs(cls.sumAngle)>=40;
      box.innerHTML += `<div style="display:flex;justify-content:space-between;margin-top:4px;border-top:1px solid var(--bd2);padding-top:4px;"><span style="color:var(--text);font-weight:bold;">FORCA TOTAL</span><span style="color:${cls.sumAngle>=0?'var(--green)':'var(--red)'};font-weight:${strong?900:700};">${sumTxt} <span style="font-size:9px;color:var(--t3);font-weight:normal;">(Pico: ${peakTxt})</span></span></div>`;
      
      // Update the force meter pointer
      const pointer = document.getElementById('direcao-force-pointer');
      if (pointer) {
         // clamp between -50 and +50 for the visual meter (previously -150 to +150)
         let clamped = cls.sumAngle;
         if(clamped < -50) clamped = -50;
         if(clamped > 50) clamped = 50;
         const percent = 50 - (clamped / 50) * 50;
         pointer.style.top = percent + '%';
      }
    }
  }
function renderDirecaoHistory(){
  const list=document.getElementById('direcao-history-list');
  if(!list)return;
  if(!direcaoHistory.length){
    list.innerHTML='<div style="padding:5px 9px;font-size:11px;color:var(--t3);">Sem mudanca de momentum ainda...</div>';
    return;
  }
  const lbl=DIRECAO_STATE_LBL;
  list.innerHTML=direcaoHistory.slice(0,30).map(h=>{
    const t=new Date(h.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const sideCls=h.direcao==='alta'?'buy':h.direcao==='baixa'?'sell':'';
    return`<div class="sig-item" style="grid-template-columns:34px 76px 1fr 44px;">
      <span class="sig-time">${t}</span>
      <span class="sig-type sig-direcao">${lbl[h.state]}</span>
      <span class="sig-side ${sideCls}">${h.direcao?h.direcao.toUpperCase():'--'}</span>
      <span class="sig-px">${h.avgAngle!=null?h.avgAngle.toFixed(0)+'°':'--'}</span>
    </div>`;
  }).join('');
}

// Escreve o badge ESTADO do modal da Bussola. O estado ja e calculado por
// updateDirecaoTracking (direcaoState); nada ligava esse valor ao elemento,
// entao o badge ficava em '--' permanentemente.
function renderDirecaoStateBadge(cls){
  const badge=document.getElementById('direcao-state-badge');
  if(!badge)return;
  const estado=DIRECAO_STATE_LBL[direcaoState]||'NEUTRO';
  const dir=cls&&cls.direcao?cls.direcao.toUpperCase():null;
  const neutro=direcaoState==='indefinido'||!dir;
  badge.textContent=neutro?estado:estado+' '+dir;
  badge.className='sp-sec-val';
  badge.style.color=neutro?'var(--goldd)':cls.direcao==='alta'?'var(--green)':'var(--red)';
  badge.style.fontWeight=neutro?'':'900';
}

function updateDirecaoPanel(closes,e8,e16,e55,e98,e200,m56,m89,atrV){
  const idx=closes.length-1;
  const seriesByKey={ema8:e8,ema16:e16,ema55:e55,ema98:e98,ema200:e200,ma56:m56,ma89:m89};
  const angles={};
  DIRECAO_MAS.forEach(({key})=>{angles[key]=maAngleDeg(seriesByKey[key],atrV,idx,DIRECAO_LOOKBACK);});
  direcaoAngles=angles;
  const cls=updateDirecaoTracking(angles);
  renderDirecaoCompass(angles);
  renderDirecaoReadout(angles,cls);
  renderDirecaoStateBadge(cls);
}

// ══════════════════════════════════════════════════════

