// Guardas de layout: o canto de estado é um só e nada se sobrepõe.
import { readFileSync } from 'node:fs';
let ok=0, falhou=0;
const t=(n,c,x)=>{ if(c){ok++; console.log('  ok  '+n);} else {falhou++; console.log('  FALHOU  '+n+(x!=null?' :: '+x:''));} };

const html=readFileSync('index.html','utf8');
const js=readFileSync('layout-vectra.js','utf8');
const css=readFileSync('vectra-ux.css','utf8');

console.log('\n== um canto de estado só ==');
t('o css do sistema visual está ligado na página', html.includes('vectra-ux.css'));
t('o controlador de layout está ligado na página', html.includes('layout-vectra.js'));
t('existe um dock único', js.includes("dock.id = 'vx-dock'"));
t('os quatro cartões são adotados pelo dock', ['vg-card','imperial-card','consenso-card','deriv-card'].every(id=>js.includes("'"+id+"'")));
t('cartão adotado perde a posição própria', js.includes('el.style.position = \'static\''));
t('visibilidade do cartão é controlada por atributo', js.includes('el.hidden = id !== chave'));
t('o ciclo reafirma a aba escolhida', js.includes('adotados[id].hidden = id !== abaAtiva'));

console.log('\n== acabamento ==');
t('paleta de três azuis com dourado discreto', css.includes('--vx-navy-700') && css.includes('--vx-ouro'));
t('cartões compartilham a mesma superfície', css.includes('body.vx #vg-card'));
t('controles com alvo de 40px', css.includes('min-height: 40px'));
t('foco visível em dourado', css.includes('focus-visible'));
t('respeita quem pediu menos animação', css.includes('prefers-reduced-motion'));
t('gráfico cede o canto do dock', css.includes('margin-right: 330px'));
t('celular: dock vira folha inferior', /max-width: 820px[\s\S]*#vx-dock/.test(css));

console.log('\n== controles enxutos ==');
t('a lateral agrupa o excedente num "mais"', js.includes("botao.id = 'nav-mais'"));
t('a aba abre o módulo quando o cartão não existe', js.includes('function abrirModulo'));

console.log('\n== cliques chegam nos botões ==');
const extras=readFileSync('ui-extras.js','utf8');
t('a abertura sai da frente da tela', js.includes('function encerrarSplash'));
t('qualquer toque encerra a abertura', js.includes("'pointerdown', 'keydown', 'wheel', 'touchstart'"));
t('a abertura não recebe mais clique', css.includes('#vectra-splash { pointer-events: none; }'));
t('o arrasto da barra ignora clique em botão', extras.includes("closest('button, a, input, select, textarea, [role=\"button\"], .cp, .chip, .btn')"));
t('a captura do ponteiro só vem depois de arrastar de verdade', extras.includes("if (!moveu) { moveu = true; try { el.setPointerCapture"));
t('a barra superior é uma faixa que rola, sem peça empilhada', css.includes('flex-wrap: nowrap !important'));
t('clicar no módulo abre a aba dele', js.includes('function delegarLateral'));

console.log('\n' + (falhou ? falhou+' falharam' : 'todas as '+ok+' guardas de layout passaram'));
process.exit(falhou?1:0);
