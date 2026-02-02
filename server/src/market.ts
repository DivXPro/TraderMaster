import { Candle } from '@trader-master/shared';

export class Market {
    private currentPrice: number;
    private history: Candle[] = [];
    private currentTime: number;

    constructor(startPrice: number = 100) {
        this.currentPrice = startPrice;
        // Start from 1 hour ago
        this.currentTime = Math.floor(Date.now() / 1000) - 3600; 
        
        // Generate 1 hour of history
        for (let i = 0; i < 3600; i++) {
            this.tick(false);
        }
    }

    public tick(realtime: boolean = true): Candle {
        // Simple Random Walk with volatility
        const volatility = 0.2;
        const change = (Math.random() - 0.5) * volatility;
        
        const open = this.currentPrice;
        const close = open + change;
        const high = Math.max(open, close) + Math.random() * 0.05;
        const low = Math.min(open, close) - Math.random() * 0.05;

        this.currentPrice = close;
        this.currentTime += 1; // 1 second per tick

        const candle: Candle = {
            time: this.currentTime,
            open,
            high,
            low,
            close
        };

        this.history.push(candle);
        
        // Keep only last 5000 points to save memory
        if (this.history.length > 5000) {
            this.history.shift();
        }

        return candle;
    }

    public getHistory(): Candle[] {
        return this.history;
    }
}
