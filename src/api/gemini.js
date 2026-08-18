import { escapeHtml, currentSym, currentTF } from '../main.js';

export function iaErrorBoxHtml(e,retryCall){
  if(e&&e.message==='NO_KEY'){
    return '<div class="ma-ai-box error">🧠 Configure sua chave de API no topo da aba <b>IA</b> pra ativar a analise.</div>';
  }
  const msg=e&&e.message?escapeHtml(e.message):'Erro ao gerar analise.';
  return `<div class="ma-ai-box error">🧠 ${msg} <button class="ma-ai-retry" onclick="${retryCall}">Tentar de novo</button></div>`;
}

// A chave fica so na memoria desta aba (nunca em localStorage) e some se
// a pagina for recarregada — mesmo criterio ja usado pro token da Deriv.
let aiApiKey = localStorage.getItem('atlas_ai_api_key') || null;

export function toggleIAKeyVisibility(){
  const input=document.getElementById('ia-api-key');
  input.type=input.type==='password'?'text':'password';
}

export function updateIAKeyStatus(){
  const dot=document.getElementById('ia-key-dot'),txt=document.getElementById('ia-key-status');
  const btn=document.getElementById('ia-key-connect-btn'),input=document.getElementById('ia-api-key');
  const connected=!!aiApiKey;
  dot.className='dot '+(connected?'grn':'off');
  txt.textContent=connected?'IA ativa':'IA desativada';
  btn.textContent=connected?'Desativar IA':'Ativar IA';
  btn.classList.toggle('disconnect',connected);
  input.disabled=connected;
  if(!connected) {
    input.value='';
    localStorage.removeItem('atlas_ai_api_key');
  } else {
    localStorage.setItem('atlas_ai_api_key', aiApiKey);
    if (!input.value) input.value = '********';
  }
}

export function onIAKeyConnectClick(){
  if(aiApiKey){aiApiKey=null;updateIAKeyStatus();return;}
  const input=document.getElementById('ia-api-key');
  const key=input.value.trim();
  if(!key){input.focus();return;}
  aiApiKey=key;
  updateIAKeyStatus();
}

setTimeout(() => { if (aiApiKey) updateIAKeyStatus(); }, 500);

export const GEMINI_MODEL='gemini-2.5-flash';

export async function callGemini(prompt,maxTokens){
  if(!aiApiKey)throw new Error('NO_KEY');
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-goog-api-key":aiApiKey,
    },
    body:JSON.stringify({
      contents:[{parts:[{text:prompt}]}],
      generationConfig:{maxOutputTokens:maxTokens||300},
    })
  });
  if(!response.ok){
    const errBody=await response.json().catch(()=>null);
    throw new Error(errBody&&errBody.error&&errBody.error.message?errBody.error.message:`HTTP ${response.status}`);
  }
  const data=await response.json();
  const cand=data.candidates&&data.candidates[0];
  const text=cand&&cand.content&&cand.content.parts&&cand.content.parts.map(p=>p.text||'').join('');
  if(!text){
    if(cand&&cand.finishReason==='MAX_TOKENS')throw new Error('Resposta cortada (limite de tokens). Tente de novo.');
    throw new Error('Sem resposta da IA.');
  }
  return text;
}

export async function analyzeGlobalMarket(){
  const resEl=document.getElementById('ai-global-result');
  resEl.style.display='block';
  resEl.innerHTML='<div class="ma-ai-box loading">🧠 Analisando mercado global...</div>';

  const g=mcapCache&&mcapCache.global;
  const total=g&&g.total_market_cap?g.total_market_cap.usd:null;
  const btcCap=mcapCache&&mcapCache.byId&&mcapCache.byId.bitcoin?mcapCache.byId.bitcoin.market_cap:null;
  const ethCap=mcapCache&&mcapCache.byId&&mcapCache.byId.ethereum?mcapCache.byId.ethereum.market_cap:null;
  const total2=total!=null&&btcCap!=null?total-btcCap:null;
  const total3=total2!=null&&ethCap!=null?total2-ethCap:null;
  const dominance=g&&g.market_cap_percentage
    ?Object.entries(g.market_cap_percentage).sort((a,b)=>b[1]-a[1]).slice(0,8)
      .map(([sym,v])=>`${sym.toUpperCase()}: ${v.toFixed(1)}%`).join(', ')
    :'indisponivel';
  const btcChange=g&&g.market_cap_change_percentage_24h_usd!=null?g.market_cap_change_percentage_24h_usd.toFixed(2)+'%':'indisponivel';

  const resumo={
    total_market_cap_usd:total,
    total2_usd:total2,
    total3_usd:total3,
    variacao_total_24h:btcChange,
    dominancia_top8:dominance,
  };

  const prompt=`Voce e um analista de mercado cripto ajudando um trader a interpretar o quadro macro do dia. Dados atuais:

${JSON.stringify(resumo,null,2)}

Escreva uma leitura curta (maximo 4 frases, portugues, tom direto de analista) sobre o estado geral do mercado (tendencia de TOTAL/TOTAL2/TOTAL3, dominancia do BTC e o que isso sugere pra altcoins). Nao invente numeros que nao estao nos dados.`;

  try{
    const text=await callGemini(prompt,300);
    resEl.innerHTML=`<div class="ma-ai-box"><div class="ma-ai-hd">🧠 VISAO DO MERCADO</div><div class="ma-ai-text">${escapeHtml(text)}</div></div>`;
  }catch(e){
    resEl.innerHTML=iaErrorBoxHtml(e,'analyzeGlobalMarket()');
  }
}

export async function analyzeCurrentAssetAI(){
  const resEl=document.getElementById('ai-asset-result');
  const sym=currentSym;
  resEl.style.display='block';
  resEl.innerHTML='<div class="ma-ai-box loading">🧠 Analisando ativo...</div>';

  const get=id=>{const el=document.getElementById(id);return el?el.textContent.trim():'--';};
  const resumo={
    ativo:sym.replace('USDT',''),
    timeframe_grafico:currentTF,
    preco:get('rt-price'),
    mtf_score:get('mtf-summary'),
    stochrsi_local:{k:get('stoch-k-local'),d:get('stoch-d-local')},
    stochrsi_h1:{k:get('stoch-k-h1'),d:get('stoch-d-h1'),zona:get('stoch-zone-badge')},
    antecipador:{status:get('antecip-badge'),detalhe:get('antecip-detail')},
    rsi_inverso:{atual:get('rsiinv-current'),alvo_os30:get('rsiinv-os'),alvo_ob70:get('rsiinv-ob')},
    fibonacci_direcao:get('fib-dir-badge'),
  };

  const prompt=`Voce e um analista tecnico ajudando a interpretar o painel de validacao de um trader para o ativo ${resumo.ativo}. Aqui estao os dados calculados agora:

${JSON.stringify(resumo,null,2)}

O checklist do trader segue este framework: camada macro (D1) define contexto, camada intermediaria (H1/H4) valida estrutura, camada micro so confirma timing. O Antecipador sinaliza possivel reversao ANTES do cruzamento confirmar.

Escreva uma leitura curta (maximo 4 frases, portugues, tom direto de analista) sintetizando o que esses dados juntos sugerem — nao repita os numeros soltos, interprete a COMBINACAO deles. Se houver conflito entre os indicadores, aponte isso claramente.`;

  try{
    const text=await callGemini(prompt,300);
    resEl.innerHTML=`<div class="ma-ai-box"><div class="ma-ai-hd">🧠 LEITURA IA · ${escapeHtml(resumo.ativo)}</div><div class="ma-ai-text">${escapeHtml(text)}</div></div>`;
  }catch(e){
    resEl.innerHTML=iaErrorBoxHtml(e,'analyzeCurrentAssetAI()');
  }
}

let iaChatLog=[]; // {role:'user'|'assistant', content:string}[]
try {
  const savedLog = localStorage.getItem('atlas_ia_chat_log');
  if (savedLog) {
    iaChatLog = JSON.parse(savedLog);
    setTimeout(() => {
      const history = document.getElementById('ia-chat-history');
      if (history && iaChatLog.length > 0) {
        history.innerHTML = '<div style="color:var(--t3);">Ola! Sou o Assistente ATLAS. Pergunte sobre o mercado ou o ativo em analise. (Historico restaurado)</div>';
        for (const m of iaChatLog) {
          if (m.role === 'user') {
            history.insertAdjacentHTML('beforeend', `<div class="ia-chat-msg user"><span class="who">Voce:</span> <span class="txt">${escapeHtml(m.content)}</span></div>`);
          } else {
            history.insertAdjacentHTML('beforeend', `<div class="ia-chat-msg atlas"><span class="who">ATLAS:</span> <span class="txt">${escapeHtml(m.content)}</span></div>`);
          }
        }
        history.scrollTop = history.scrollHeight;
      }
    }, 500);
  }
} catch(e) {}

export async function sendIAChat(){
  const input=document.getElementById('ia-chat-input');
  const btn=document.getElementById('ia-send-btn');
  const msg=input.value.trim();
  if(!msg)return;
  const history=document.getElementById('ia-chat-history');

  history.insertAdjacentHTML('beforeend',
    `<div class="ia-chat-msg user"><span class="who">Voce:</span> <span class="txt">${escapeHtml(msg)}</span></div>`);
  input.value='';
  input.disabled=true;btn.disabled=true;
  history.scrollTop=history.scrollHeight;

  const thinkingEl=document.createElement('div');
  thinkingEl.className='ia-chat-msg atlas';
  thinkingEl.innerHTML='<span class="who">ATLAS:</span> <span class="txt">Pensando...</span>';
  history.appendChild(thinkingEl);
  history.scrollTop=history.scrollHeight;

  const get=id=>{const el=document.getElementById(id);return el?el.textContent.trim():'--';};
  const contexto={
    ativo_em_tela:currentSym.replace('USDT',''),
    timeframe:currentTF,
    preco:get('rt-price'),
    mtf_score:get('mtf-summary'),
    stochrsi_h1:{k:get('stoch-k-h1'),zona:get('stoch-zone-badge')},
  };

  const convoText=iaChatLog.map(m=>`${m.role==='user'?'Trader':'ATLAS'}: ${m.content}`).join('\n');
  const prompt=`Voce e o "Assistente ATLAS", um analista tecnico que ajuda um trader a interpretar o dashboard ATLAS (indicadores MTF, StochRSI, Fibonacci, squeeze de EMAs). Contexto atual do ativo em tela:

${JSON.stringify(contexto,null,2)}

${convoText?`Historico da conversa ate agora:\n${convoText}\n`:''}
Nova pergunta do trader: "${msg}"

Responda em portugues, tom direto, no maximo 4 frases. Se a pergunta pedir algo que nao esta nos dados disponiveis, diga isso claramente em vez de inventar.`;

  try{
    const text=await callGemini(prompt,300);
    iaChatLog.push({role:'user',content:msg},{role:'assistant',content:text});
    localStorage.setItem('atlas_ia_chat_log', JSON.stringify(iaChatLog));
    thinkingEl.innerHTML=`<span class="who">ATLAS:</span> <span class="txt">${escapeHtml(text)}</span>`;
  }catch(e){
    const errMsg=e&&e.message==='NO_KEY'?'Configure sua chave de API no topo da aba IA pra ativar o chat.':(e&&e.message?e.message:'Erro ao responder. Tente de novo.');
    thinkingEl.innerHTML=`<span class="who">ATLAS:</span> <span class="txt" style="color:var(--red);">${escapeHtml(errMsg)}</span>`;
  }
  input.disabled=false;btn.disabled=false;
  history.scrollTop=history.scrollHeight;
  input.focus();
}

