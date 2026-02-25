import { Candle } from '@trader-master/shared';

export class Market {
    private currentPrice: number;
    private history: Candle[] = [];
    private currentTime: number;

    // For aggregating real-time updates
    private pendingHigh: number = -Infinity;
    private pendingLow: number = Infinity;
    private lastUpdatePrice: number = 0;

    constructor(startPrice: number = 100) {
        this.currentPrice = startPrice;
        this.lastUpdatePrice = startPrice;
        
        // Use current time as the end of history
        const now = Math.floor(Date.now() / 1000);
        this.currentTime = now;
        
        // Generate 1 hour of history backwards
        let price = startPrice;
        // Volatility: 0.02% per second approx
        const volatility = startPrice * 0.0002; 

        const history: Candle[] = [];

        for (let i = 0; i < 3600; i++) {
            const time = now - i;
            
            // Random walk backwards
            const change = (Math.random() - 0.5) * volatility;
            const prevPrice = price - change;
            
            // Generate OHLC for the previous candle (time i)
            // We are moving backwards, so 'close' is 'price' (at t), 'open' is 'prevPrice' (at t-1)
            // But actually, for candle at time t, open is price at t-1, close is price at t.
            // Here 'price' is close of candle at 'time'. 'prevPrice' is close of candle at 'time-1'.
            // Wait, candle at 'time' should have close=price.
            // open of candle at 'time' should be close of candle at 'time-1'.
            
            const open = prevPrice;
            const close = price;
            const high = Math.max(open, close) + Math.random() * volatility * 0.5;
            const low = Math.min(open, close) - Math.random() * volatility * 0.5;
            
            history.unshift({
                time,
                open,
                high,
                low,
                close
            });
            
            price = prevPrice;
        }
        
        this.history = history;
    }

    public updatePrice(price: number) {
        this.currentPrice = price;
        this.lastUpdatePrice = price;
        
        // Update high/low for the current interval
        if (price > this.pendingHigh) this.pendingHigh = price;
        if (price < this.pendingLow) this.pendingLow = price;
    }

    public tick(): Candle {
        // Real-time tick
        let open = this.history.length > 0 ? this.history[this.history.length - 1].close : this.currentPrice;
        let close = this.currentPrice;
        let high = this.pendingHigh;
        let low = this.pendingLow;

        // Reset pending values
        this.pendingHigh = -Infinity;
        this.pendingLow = Infinity;

        // If no updates received, use last known price
        if (high === -Infinity) high = Math.max(open, close);
        if (low === Infinity) low = Math.min(open, close);

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

    public getCurrentPrice(): number {
        return this.currentPrice;
    }

    public getCurrentTime(): number {
        return this.currentTime;
    }
}
