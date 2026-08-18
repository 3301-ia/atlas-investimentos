// ══════════════════════════════════════════════════════
// DERIV API — apenas a estrutura, nada aqui se conecta de verdade ainda.
// Para operar de fato:
//   1. Crie um app_id gratuito em https://api.deriv.com
//   2. Gere um token de API na sua conta Deriv (Configuracoes > Seguranca > API Token)
//   3. NUNCA cole esse token no chat comigo — ele deve ficar so no seu navegador,
//      idealmente vindo de um input local ou variavel de ambiente, nunca hardcoded.
// ══════════════════════════════════════════════════════
export const derivAPI = {
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
export function toggleTokenVisibility(){
  const inp=document.getElementById('deriv-token'),eye=document.getElementById('token-eye');
  const show=inp.type==='password';
  inp.type=show?'text':'password';
  eye.textContent=show?'🙈':'👁';
}

export function openDerivModal(){
  const saved=localStorage.getItem('deriv_app_id');
  if(saved)document.getElementById('deriv-appid').value=saved;
  document.getElementById('deriv-modal-overlay').classList.add('show');
}
export function closeDerivModal(){document.getElementById('deriv-modal-overlay').classList.remove('show');}

export function setDerivStatus(state,text){
  // state: 'off' | 'connecting' | 'grn'
  const d=document.getElementById('deriv-status-dot'),t=document.getElementById('deriv-status-txt');
  d.className = state==='grn' ? 'dot grn blink' : state==='connecting' ? 'dot off blink' : 'dot off';
  t.textContent=text;
  const btn=document.getElementById('deriv-connect-btn');
  if(state==='grn'){btn.textContent='Desconectar';btn.classList.add('disconnect');}
  else{btn.textContent='Conectar';btn.classList.remove('disconnect');}
}

export function onDerivConnectClick(){
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
}
