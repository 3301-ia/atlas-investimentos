/**
 * ATLAS OMNIVERSE V8.2 - DOM BINDER
 * Centraliza e injeta eventos assincronamente.
 * Remove a necessidade de sujar o escopo global (window.func).
 */

import { setupBussolaHUD, openAnalyzerHUD } from './hud.js';

export function bindAllEvents() {
    // Exemplo de migracao limpa: 
    // Em vez de onclick="toggleBussolaModal()" no HTML
    // Usaremos document.getElementById ou data-action
    
    setupBussolaHUD();

    // Injetar botao do Analisador no Header se nao existir
    const headerRow = document.querySelector('.topbar');
    if(headerRow && !document.getElementById('btn-analyzer')) {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.id = 'btn-analyzer';
        btn.innerHTML = '🤖 SCANNER';
        btn.style.color = 'var(--accent)';
        btn.style.borderColor = 'var(--accent)';
        btn.title = 'Inicia varredura imersiva multifatorial';
        btn.addEventListener('click', openAnalyzerHUD);
        headerRow.appendChild(btn);
    }
    
    // Injetar estrutura do Modal do Scanner se nao existir
    if(!document.getElementById('analyzer-modal')) {
        const modal = document.createElement('div');
        modal.id = 'analyzer-modal';
        modal.style.display = 'none';
        modal.style.position = 'fixed';
        modal.style.top = '20%';
        modal.style.left = '50%';
        modal.style.transform = 'translate(-50%, 0)';
        modal.style.width = '450px';
        modal.style.background = 'rgba(10, 15, 20, 0.95)';
        modal.style.border = '1px solid var(--accent)';
        modal.style.borderRadius = '12px';
        modal.style.padding = '20px';
        modal.style.zIndex = '10000';
        modal.style.boxShadow = '0 0 30px rgba(55, 124, 252, 0.3)';
        modal.style.backdropFilter = 'blur(8px)';
        modal.style.fontFamily = 'monospace';
        
        modal.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px; margin-bottom:15px;">
                <span style="color:var(--accent); font-weight:bold; font-size:14px; letter-spacing:2px;">HUD // SCANNER TÁTICO</span>
                <button id="close-analyzer" style="background:none; border:none; color:var(--text); cursor:pointer; font-size:16px;">&times;</button>
            </div>
            <div class="scanner-text" style="color:var(--text); font-size:12px; line-height:1.6; min-height:80px;">
                Aguardando inicialização...
            </div>
        `;
        document.body.appendChild(modal);
        
        document.getElementById('close-analyzer').addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
}
