/**
 * Atlas v10 - Global State Manager
 * Substitui as variáveis globais espalhadas no main.js
 */

class AtlasState extends EventTarget {
  constructor() {
    super();
    this.data = {
      currentSym: 'BTCUSDT',
      currentTF: '15m',
      candles: [],
      signals: [],
      alertsOn: false,
      bullFlowPrev: false,
      bearFlowPrev: false,
      aiApiKey: localStorage.getItem('atlas_ai_api_key') || null,
      iaChatLog: [],
      // Adicionar mais estados conforme formos componentizando
    };

    // Tenta carregar o chat log salvo
    try {
      const savedLog = localStorage.getItem('atlas_ia_chat_log');
      if (savedLog) {
        this.data.iaChatLog = JSON.parse(savedLog);
      }
    } catch(e) {}
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
    this.dispatchEvent(new CustomEvent(`change:${key}`, { detail: { value } }));
  }

  // Helper para se inscrever em mudancas
  subscribe(key, callback) {
    this.addEventListener(`change:${key}`, (e) => callback(e.detail.value));
  }
}

export const state = new AtlasState();
