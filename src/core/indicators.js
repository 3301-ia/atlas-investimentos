export const DIRECAO_LOOKBACK = 5;
export const DIRECAO_GAIN = 1;

export function ema(d,p){const k=2/(p+1),r=[d[0]];for(let i=1;i<d.length;i++)r.push(d[i]*k+r[i-1]*(1-k));return r;}

export function sma(d,p){const r=new Array(d.length).fill(null);for(let i=p-1;i<d.length;i++){let s=0;for(let j=0;j<p;j++)s+=d[i-j];r[i]=s/p;}return r;}

export function rsiCalc(c,p){const r=new Array(c.length).fill(null);if(c.length<p+1)return r;let ag=0,al=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>0?ag+=d:al-=d;}ag/=p;al/=p;r[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;r[i]=al===0?100:100-100/(1+ag/al);}return r;}

export function stochCalc(rsi,p){const r=new Array(rsi.length).fill(null);for(let i=p-1;i<rsi.length;i++){if(rsi[i]==null)continue;let ll=1e9,hh=-1e9;for(let j=0;j<p;j++){const v=rsi[i-j];if(v==null){ll=null;break;}if(v<ll)ll=v;if(v>hh)hh=v;}if(ll!=null&&hh!==ll)r[i]=(rsi[i]-ll)/(hh-ll)*100;else if(ll!=null)r[i]=50;}return r;}

export function atrCalc(h,l,c,p){const tr=[0];for(let i=1;i<h.length;i++)tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));return sma(tr,p);}

export function rsiState(c,p){
  if(c.length<p+1)return null;
  let ag=0,al=0;
  for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>0?ag+=d:al-=d;}
  ag/=p;al/=p;
  for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];
    ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;}
  return{ag,al,last:c[c.length-1]};
}

export function rsiStep(st,px,p){
  if(!st)return null;
  const d=px-st.last;
  const ag=(st.ag*(p-1)+Math.max(d,0))/p, al=(st.al*(p-1)+Math.max(-d,0))/p;
  return{ag,al,last:px,value:al===0?100:100-100/(1+ag/al)};
}

export function calcInverseRSITargets(ag,al,lastClose,osTarget=30,obTarget=70){
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

export function cross(a,b,i){return i>0&&a[i]>b[i]&&a[i-1]<=b[i-1];}

export function crossu(a,b,i){return i>0&&a[i]<b[i]&&a[i-1]>=b[i-1];}

export function macdCalc(closes,fast=12,slow=26,signalP=9){
  if(closes.length<slow+signalP)return null;
  const eFast=ema(closes,fast),eSlow=ema(closes,slow);
  const macdLine=closes.map((_,i)=>eFast[i]-eSlow[i]);
  const signal=ema(macdLine,signalP);
  const hist=macdLine.map((v,i)=>v-signal[i]);
  return{macd:macdLine[macdLine.length-1],signal:signal[signal.length-1],hist:hist,histLast:hist[hist.length-1],histPrev:hist[hist.length-2]};
}

export function gaussianChannel(closes,period=20,mult=2){
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

export function piCycle(closes){
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

export function maAngleDeg(series,atrArr,idx,lookback){
  if(!series||!atrArr||idx<lookback||idx>=series.length)return null;
  const now=series[idx],then=series[idx-lookback],atrNow=atrArr[idx];
  if(now==null||then==null||atrNow==null||atrNow===0)return null;
  const slope=(now-then)/(lookback*atrNow);
  return Math.atan(slope*DIRECAO_GAIN)*180/Math.PI;
}

export function classifyDirecao(angles){
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

export function calcMtfBussola(index){
  const mc = mtfCharts[index];
  if(!mc || !mc.candles.length || !mc.histMA) return;
  const closes = mc.candles.map(c=>c.close);
  const highs = mc.candles.map(c=>c.high);
  const lows = mc.candles.map(c=>c.low);
  const atrV = atrCalc(highs, lows, closes, 14);
  const idx = closes.length - 1;
  const series = {
      ema8: mc.histMA.e8, ema16: mc.histMA.e16, ema55: mc.histMA.e55,
      ema98: mc.histMA.e98, ema200: mc.histMA.e200,
      ma56: mc.histMA.m56, ma89: mc.histMA.m89
  };
  let angles = {};
  Object.keys(series).forEach(key => {
      angles[key] = maAngleDeg(series[key], atrV, idx, DIRECAO_LOOKBACK);
  });
  const cls = classifyDirecao(angles);
  mtfScores[index] = cls.sumAngle || 0;

  // Render Compass SVG
  const svg = document.getElementById('mtf-compass-svg-'+index);
  if(svg){
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
      
      const legend = document.getElementById('mtf-compass-legend-'+index);
      if(legend) legend.innerHTML = legendHTML;
  }
  
  // Render Card

  const valEl = document.getElementById('mtf-comp-val-'+index);
  if(valEl){
      valEl.textContent = (mtfScores[index]>0?'+':'') + mtfScores[index].toFixed(0) + '';
      valEl.style.color = mtfScores[index] >= 0 ? 'var(--green)' : 'var(--red)';
  }
  const lblEl = document.getElementById('mtf-comp-lbl-'+index);
  if(lblEl) lblEl.textContent = mtfTfs[index];
  
  mtfGlobalBussolaScore = mtfScores[1] + mtfScores[2] + mtfScores[3] + mtfScores[4];
  const totalEl = document.getElementById('mtf-comp-total');
  if(totalEl){
      totalEl.textContent = (mtfGlobalBussolaScore>0?'+':'') + mtfGlobalBussolaScore.toFixed(0);
      if(mtfGlobalBussolaScore > 33) totalEl.style.color = 'var(--green)';
      else if(mtfGlobalBussolaScore < -33) totalEl.style.color = 'var(--red)';
      else totalEl.style.color = 'var(--gold)';
  }
}