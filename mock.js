// Smoke test: carrega o main.js num DOM falso pra pegar erro de
// sintaxe ou de execucao imediata sem precisar abrir um navegador.
//
// Nao temos jsdom, entao os stubs abaixo sao o minimo necessario. Os
// objetos usam Proxy: qualquer metodo nao previsto vira uma funcao vazia
// em vez de estourar TypeError, o que evita ter que perseguir cada API de
// canvas/audio nova que o main.js passar a usar.
//
// Uso: node mock.js

// Encadeavel: toda propriedade desconhecida vira no-op, todo metodo
// devolve outro objeto igualmente permissivo.
function loose(base = {}) {
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      return () => loose();
    },
  });
}

const ctx2d = loose({
  canvas: { width: 300, height: 150 },
  fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '',
});

const el = () => loose({
  style: {},
  dataset: {},
  classList: loose({ contains: () => false }),
  children: [],
  childNodes: [],
  value: '',
  textContent: '',
  innerHTML: '',
  offsetWidth: 800,
  offsetHeight: 400,
  clientWidth: 800,
  clientHeight: 400,
  getContext: () => ctx2d,
  getBoundingClientRect: () => ({ top:0, left:0, right:800, bottom:400, width:800, height:400 }),
});

const documentMock = loose({
  getElementById: el,
  querySelector: el,
  querySelectorAll: () => [],
  createElement: el,
  createElementNS: el,
  body: el(),
  head: el(),
  documentElement: el(),
  fonts: loose({ ready: Promise.resolve(), load: () => Promise.resolve() }),
  readyState: 'complete',
  cookie: '',
});

const store = new Map();
const storageMock = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const windowMock = loose({
  document: documentMock,
  localStorage: storageMock,
  sessionStorage: storageMock,
  innerWidth: 1920,
  innerHeight: 1080,
  devicePixelRatio: 1,
  location: { search: '', hash: '', href: 'http://localhost/', origin: 'http://localhost' },
  navigator: { userAgent: 'Node', language: 'pt-BR' },
  // O main.js usa a lib de graficos pelo global vindo da CDN.
  LightweightCharts: loose({ createChart: () => loose(), CrosshairMode: {}, PriceScaleMode: {} }),
  WebSocket: class { constructor(){} send(){} close(){} },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }),
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  matchMedia: () => loose({ matches: false }),
  AudioContext: class { constructor(){ return loose({ currentTime: 0, destination: {} }); } },
});

// navigator e afins sao getters somente-leitura no Node 22, entao
// defineProperty em vez de Object.assign.
const globais = {
  window: windowMock,
  document: documentMock,
  localStorage: storageMock,
  sessionStorage: storageMock,
  location: windowMock.location,
  navigator: windowMock.navigator,
  fetch: windowMock.fetch,
  WebSocket: windowMock.WebSocket,
  LightweightCharts: windowMock.LightweightCharts,
  requestAnimationFrame: windowMock.requestAnimationFrame,
  cancelAnimationFrame: windowMock.cancelAnimationFrame,
  matchMedia: windowMock.matchMedia,
  AudioContext: windowMock.AudioContext,
  ResizeObserver: class { observe(){} unobserve(){} disconnect(){} },
  IntersectionObserver: class { observe(){} unobserve(){} disconnect(){} },
  MutationObserver: class { observe(){} disconnect(){} takeRecords(){ return []; } },
  Notification: class { static permission = 'default'; static requestPermission(){ return Promise.resolve('default'); } },
  HTMLElement: class {},
  Element: class {},
  CustomEvent: class { constructor(t, o){ this.type = t; Object.assign(this, o); } },
};
for (const [nome, valor] of Object.entries(globais)) {
  Object.defineProperty(globalThis, nome, { value: valor, writable: true, configurable: true });
}

// O main.js e script classico (o index.html o carrega sem type="module",
// porque 82 handlers inline dependem do escopo global). Por isso e lido e
// avaliado, e nao importado como modulo ES.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(fileURLToPath(import.meta.url));
const caminho = join(raiz, 'main.js');

try {
  const codigo = readFileSync(caminho, 'utf8');
  new Function(codigo).call(windowMock);
  console.log('OK: main.js carregou sem erros.');
  // O main.js agenda intervalos e animacoes que manteriam o processo vivo
  // pra sempre; o objetivo aqui e so a carga inicial.
  process.exit(0);
} catch (err) {
  console.error('FALHOU ao carregar main.js:');
  console.error(err);
  process.exit(1);
}
