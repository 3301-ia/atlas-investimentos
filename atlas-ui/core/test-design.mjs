/* Guardas da linguagem de design: o que foi decidido não pode voltar atrás
   sem alguém perceber. Lê as folhas e o runtime, sem navegador.            */
import fs from 'node:fs';

let ok = 0, falhou = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { falhou++; console.log('  FALHOU  ' + n + (x != null ? ' :: ' + x : '')); } };
const css = fs.readFileSync('vectra-design.css', 'utf8');
const ux = fs.readFileSync('vectra-ux.css', 'utf8');
const js = fs.readFileSync('vectra-tipografia.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

console.log('\n== a folha é carregada e na ordem certa ==');
const posUx = html.indexOf('vectra-ux.css'), posDesign = html.indexOf('vectra-design.css');
t('vectra-design.css entra no documento', posDesign > 0);
t('a linguagem vem depois das superfícies', posDesign > posUx);
t('o runtime da régua entra no documento', html.indexOf('vectra-tipografia.js') > 0);

console.log('\n== tokens da régua ==');
['--vx-t-micro', '--vx-t-corpo', '--vx-t-numero', '--vx-t-heroi', '--vx-toque', '--vx-foco', '--vx-respiro', '--vx-vidro'].forEach(k => {
  t('token ' + k + ' definido', css.includes(k + ':'));
});
const clamps = (css.match(/clamp\(/g) || []).length;
t('escala tipográfica usa clamp (mínimo 6 usos)', clamps >= 6, clamps);
t('alvo de toque 40 no mouse', /--vx-toque:\s*40px/.test(css));
t('alvo de 44 no dedo', /pointer:\s*coarse[\s\S]*--vx-toque:\s*var\(--vx-toque-largo\)/.test(css));
t('campo em 16px no celular (evita o zoom do iOS)', /pointer:\s*coarse[\s\S]*font-size:\s*16px/.test(css));

console.log('\n== base de renderização ==');
t('antialiasing ligado', css.includes('-webkit-font-smoothing: antialiased'));
t('número com tabular-nums', css.includes('tabular-nums'));
t('foco de teclado visível', css.includes(':focus-visible'));
t('rolagem fina padronizada', css.includes('scrollbar-width: thin'));
t('nada de borda branca nos componentes', !/border:\s*1px solid #fff/i.test(css));

console.log('\n== componentes ==');
['.vx-btn', '.vx-btn--ouro', '.vx-btn--fantasma', '.vx-campo', '.vx-chip', '.vx-card', '.vx-divisor'].forEach(c => {
  t('componente ' + c, css.includes(c));
});

console.log('\n== correções que não podem regredir ==');
t('barra de desenho com 62px de largura', /#drawing-toolbar\s*\{[^}]*width:\s*62px/.test(css));
t('botão da barra quebra em vez de cortar', /#drawing-toolbar[\s\S]{0,400}white-space:\s*normal/.test(css));
t('lateral com 78px (rótulo inteiro)', /\.side-nav[\s\S]{0,80}width:\s*78px/.test(css));
t('regra do MAIS com largura para o texto', /#nav-mais\s*\{[^}]*min-width:\s*92px/.test(css));
t('no celular a direita sai de cena', /max-width:\s*820px[\s\S]*\.rpanel[\s\S]{0,60}display:\s*none/.test(ux));
t('no celular a gaveta nasce recolhida', /max-width:\s*820px[\s\S]*max-height:\s*46px/.test(ux));

console.log('\n== runtime da régua ==');
t('piso tipográfico de 10.5px', /PISO\s*=\s*10\.5/.test(js));
t('não mexe em canvas nem no gráfico', js.includes('#chart, canvas, svg'));
t('marca o elemento para não brigar depois', js.includes('data-vx-legivel'));
t('observa tela que se monta depois', js.includes('MutationObserver'));
t('expõe o painel de controle AtlasRegua', js.includes('window.AtlasRegua'));
t('compacta a barra guardando o nome no title', js.includes("setAttribute('title'"));
t('símbolo e palavra em spans próprios', js.includes('vx-simbolo') && js.includes('vx-palavra'));

console.log('\n' + (falhou ? falhou + ' guardas falharam' : 'todas as ' + ok + ' guardas da linguagem passaram'));
process.exit(falhou ? 1 : 0);
