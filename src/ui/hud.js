/**
 * ATLAS OMNIVERSE V8.2 - HUD IMMERSIVE (COMPASS & ANALYZER)
 * Layer UI para HUDs Flutuantes (Estilo Cyberpunk/Militar)
 */

export function setupBussolaHUD() {
    const bussolaBtn = document.getElementById('btn-bussola');
    if(bussolaBtn) {
        bussolaBtn.removeAttribute('onclick'); // Fim do hack global
        bussolaBtn.addEventListener('click', () => {
            const modal = document.getElementById('bussola-modal');
            if (modal.style.display === 'none' || modal.style.display === '') {
                modal.style.display = 'block';
                modal.classList.add('hud-open-anim');
            } else {
                modal.style.display = 'none';
            }
        });
    }

    // Drag Logic (Clean Event Listeners)
    const modal = document.getElementById('bussola-modal');
    const header = modal?.querySelector('.drag-header');
    if (header && modal) {
        let isDragging = false, startX, startY, initialX, initialY;
        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = modal.getBoundingClientRect();
            initialX = rect.left; initialY = rect.top;
            document.body.style.userSelect = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            modal.style.left = `${initialX + dx}px`;
            modal.style.top = `${initialY + dy}px`;
            modal.style.bottom = 'auto'; // override bottom
            modal.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => {
            isDragging = false;
            document.body.style.userSelect = '';
        });
    }
}

export function renderDirecaoCompassHUD(angles, DIRECAO_MAS) {
    const svg = document.getElementById('direcao-compass');
    if(!svg) return;
    
    // Efeito Radar Sweep Neon (SVG)
    const cx=55, cy=55, r=48, needleLen=42;
    let inner = `
        <defs>
            <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="rgba(0, 230, 118, 0.2)" />
                <stop offset="100%" stop-color="transparent" />
            </radialGradient>
        </defs>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#radarGlow)" stroke="var(--bd3)" stroke-width="1"/>
        <line x1="${cx-r}" y1="${cy}" x2="${cx+r}" y2="${cy}" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="2,4"/>
        <line x1="${cx}" y1="${cy-r}" x2="${cx}" y2="${cy+r}" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="2,4"/>
    `;
    
    // Desenho das Agulhas com Glow
    DIRECAO_MAS.forEach(({key, color}) => {
        const ang = angles[key];
        if(ang == null) return;
        const rad = ang * Math.PI / 180;
        const x2 = cx + needleLen * Math.cos(rad);
        const y2 = cy - needleLen * Math.sin(rad);
        
        inner += `
            <line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" 
                  stroke="${color}" stroke-width="2.5" stroke-linecap="round" 
                  style="filter: drop-shadow(0 0 4px ${color}); transition: all 0.3s ease-out;"/>
        `;
    });
    
    inner += `<circle cx="${cx}" cy="${cy}" r="4" fill="var(--goldd)" style="filter: drop-shadow(0 0 5px var(--goldd))"/>`;
    svg.innerHTML = inner;
}

export function openAnalyzerHUD() {
    // Implementacao do Novo Analisador
    const analyzer = document.getElementById('analyzer-modal');
    if(analyzer) {
        analyzer.style.display = 'block';
        analyzer.querySelector('.scanner-text').innerHTML = "Iniciando varredura profunda...<br/>Analise de Multi-Fatores...";
        
        // Simular varredura cyberpunk
        setTimeout(() => {
            analyzer.querySelector('.scanner-text').innerHTML += "<br/><span style='color:var(--green)'>[OK] Momentum Alinhado</span>";
        }, 800);
        
        setTimeout(() => {
            analyzer.querySelector('.scanner-text').innerHTML += "<br/><span style='color:var(--goldd)'>[WARN] StochRSI em Exaustão</span>";
        }, 1600);
        
        setTimeout(() => {
            analyzer.querySelector('.scanner-text').innerHTML += "<br/><b>SCORE FINAL: 78% (COMPRA MODERADA)</b>";
            // Tocar bip sutil se permitido pelo navegador
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
                osc.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.1);
            } catch(e) {}
        }, 2500);
    }
}
