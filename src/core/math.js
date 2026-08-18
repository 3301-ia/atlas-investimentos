/**
 * ATLAS OMNIVERSE V8.2 - CORE MATH
 * Pure mathematical functions for indicators. No UI logic.
 */

export function sma(data, period) {
    const result = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j];
        result[i] = sum / period;
    }
    return result;
}

export function ema(data, period) {
    if (!data.length) return [];
    const k = 2 / (period + 1);
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) {
        result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
}

export function rsiCalc(closes, period) {
    const result = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return result;
    
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) avgGain += diff;
        else avgLoss -= diff;
    }
    avgGain /= period;
    avgLoss /= period;
    
    result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
        result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return result;
}

export function rsiState(closes, period) {
    if (closes.length < period + 1) return null;
    let ag = 0, al = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) ag += d;
        else al -= d;
    }
    ag /= period;
    al /= period;
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        ag = (ag * (period - 1) + Math.max(d, 0)) / period;
        al = (al * (period - 1) + Math.max(-d, 0)) / period;
    }
    return { ag, al };
}

export function rsiStep(state, priceDiff, period) {
    const ag = (state.ag * (period - 1) + Math.max(priceDiff, 0)) / period;
    const al = (state.al * (period - 1) + Math.max(-priceDiff, 0)) / period;
    const val = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    return { val, state: { ag, al } };
}

export function wma(data, period) {
    const res = new Array(data.length).fill(null);
    const weightSum = (period * (period + 1)) / 2;
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j] * (period - j);
        }
        res[i] = sum / weightSum;
    }
    return res;
}

export function stdev(data, period, smaData) {
    const res = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        const mean = smaData[i];
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += Math.pow(data[i - j] - mean, 2);
        }
        res[i] = Math.sqrt(sum / period);
    }
    return res;
}
