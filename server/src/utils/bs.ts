
export class BlackScholes {
    private static r: number = 0.0; // Risk-free rate (ignored for short-term game)
    private static sigma: number = 1500; // Volatility (High volatility for fast-paced game logic)

    /**
     * Standard Normal Cumulative Distribution Function
     */
    static cdf(x: number): number {
        var t = 1 / (1 + 0.2316419 * Math.abs(x));
        var d = 0.3989423 * Math.exp(-x * x / 2);
        var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
        if (x > 0) {
            return 1 - p;
        } else {
            return p;
        }
    }

    /**
     * Calculate probability that price will be between low and high at time T
     * Uses Arithmetic Brownian Motion (Normal Distribution) for short-term/game logic
     * @param S Current Price
     * @param L Lower Bound
     * @param H Upper Bound
     * @param T Time to maturity (in years)
     */
    static calculateProbability(S: number, L: number, H: number, T: number): number {
        if (T <= 0) return 0;
        
        // Normal Distribution Model (Bachelier)
        // Mean = S (assuming 0 drift for short term)
        // StdDev = sigma * sqrt(T)
        // Here sigma is treated as Absolute Volatility (price units per sqrt(year))
        
        const std_dev = this.sigma * Math.sqrt(T);
        
        const z_H = (H - S) / std_dev;
        const z_L = (L - S) / std_dev;

        const prob = this.cdf(z_H) - this.cdf(z_L);
        return Math.max(0, prob);
    }

    static calculateOdds(probability: number): number {
        if (probability <= 0.01) return 99; // Cap max odds
        if (probability >= 0.99) return 1.01; // Min odds
        
        // House edge of 5%
        // Fair Odds = 1 / P
        // House Odds = (1 / P) * 0.95
        
        let odds = (1 / probability) * 0.95;
        return Math.round(odds * 100) / 100; // Round to 2 decimals
    }
}
