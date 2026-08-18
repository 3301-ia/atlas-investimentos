export class AtlasRequestManager {
    constructor(requestsPerSecond = 5) {
        this.queue = [];
        this.isProcessing = false;
        this.delayMs = 1000 / requestsPerSecond;
    }
    
    async enqueue(taskFn, highPriority = false, shouldSkip = null) {
        return new Promise((resolve, reject) => {
            const task = { taskFn, resolve, reject, shouldSkip };
            if (highPriority) {
                this.queue.unshift(task); // Coloca no início da fila
            } else {
                this.queue.push(task); // Coloca no final
            }
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        while (this.queue.length > 0) {
            const { taskFn, resolve, reject, shouldSkip } = this.queue.shift();

            // shouldSkip deixa o CHAMADOR dizer "isso ja ficou obsoleto" (ex: o
            // usuario trocou de timeframe de novo antes deste pedido rodar).
            // Sem isso, cada troca rapida de TF/simbolo deixava um pedido morto
            // na fila que ainda assim gastava um espaco INTEIRO do rate-limit
            // (200ms a 5 req/s) so pra ser descartado depois — com fila
            // congestionada (Validator/Gold/Terminal rodando em paralelo),
            // isso sozinho fazia uma troca de TF parecer travada por 15-20s+
            // mesmo com prioridade alta. Pedido obsoleto agora resolve na
            // hora, sem gastar rede nem esperar o delay de rate-limit.
            if (shouldSkip && shouldSkip()) {
                resolve(null);
                continue;
            }

            try {
                // Watchdog: se uma tarefa individual nunca resolver (ex: um fetch
                // sem AbortSignal.timeout), ela travaria este loop pra sempre e, com
                // ele, TODA feature que depende desta fila compartilhada (Rainbow,
                // Macro, Multi-TF, etc. todas passam por aqui). O watchdog garante
                // que a fila sempre segue adiante mesmo se uma tarefa travar.
                const watchdog = new Promise((_, rej) => setTimeout(() => rej(new Error('atlasAPI: tarefa travou (watchdog 15s)')), 15000));
                const result = await Promise.race([taskFn(), watchdog]);
                resolve(result);
            } catch (e) {
                // Return empty/null on standard fetch failures instead of throwing hard, based on the implementation
                reject(e);
            }
            await new Promise(r => setTimeout(r, this.delayMs));
        }
        this.isProcessing = false;
    }
}
export const atlasAPI = new AtlasRequestManager(5); // Binance Limit safety: max 5 req/sec

export class AtlasWebSocketClient {
    constructor(urlGenerator, onMessage, onOpen = null, onError = null) {
        this.urlGenerator = urlGenerator;
        this.onMessage = onMessage;
        this.onOpenCallback = onOpen;
        this.onErrorCallback = onError;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxDelay = 60000;
        this.baseDelay = 3000;
        this.shouldReconnect = true;
    }

    connect() {
        if (!this.shouldReconnect) return; // Previne zombies
        if (this.ws) {
            this.ws.onclose = null;
            try { this.ws.close(); } catch(e){}
        }
        const url = typeof this.urlGenerator === 'function' ? this.urlGenerator() : this.urlGenerator;
        this.ws = new WebSocket(url);
        
        this.ws.onopen = (ev) => {
            this.reconnectAttempts = 0;
            if (this.onOpenCallback) this.onOpenCallback(ev);
        };
        
        this.ws.onmessage = this.onMessage;
        
        this.ws.onerror = (err) => {
            if (this.onErrorCallback) this.onErrorCallback(err);
        };

        this.ws.onclose = () => {
            if (!this.shouldReconnect) return;
            const delay = Math.min(this.maxDelay, this.baseDelay * Math.pow(2, this.reconnectAttempts));
            this.reconnectAttempts++;
            if (this.onErrorCallback) this.onErrorCallback(new Error("Connection closed"));
            
            if(this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => {
                if(this.shouldReconnect) this.connect();
            }, delay);
        };
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        }
    }

    close() {
        this.shouldReconnect = false;
        if(this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.ws) {
            this.ws.onclose = null;
            try { this.ws.close(); } catch(e) {}
            this.ws = null;
        }
    }
}