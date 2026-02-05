export const RISK_FREE_RATE = 0.03; // 3%
export const VOLATILITY = 0.5; // 50% Increased volatility to make short-term options visible
/**
 * Standard Normal Cumulative Distribution Function (CDF)
 * Calculates the probability that a value from a standard normal distribution is less than or equal to x.
 * Uses a numerical approximation method (Abramowitz & Stegun).
 * 
 * 标准正态分布累积分布函数
 * 计算标准正态分布变量小于或等于 x 的概率。
 * 使用数值近似法实现。
 * 
 * @param x - The value to evaluate | 需要计算概率的值
 * @returns The probability P(X <= x) | 概率值
 */
export const normCdf = (x: number) => {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const absx = Math.abs(x);
    const t = 1 / (1 + p * absx);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absx * absx);
    return 0.5 * (1 + sign * y);
};

/**
 * Black-Scholes Call Option Pricing Model
 * 
 * @param S - Current price of the underlying asset (Spot Price) | 标的资产当前价格
 * @param K - Strike price of the option | 期权行权价格
 * @param r - Risk-free interest rate (annualized, e.g. 0.05 for 5%) | 无风险利率（年化）
 * @param sigma - Volatility of the underlying asset (annualized standard deviation) | 波动率（年化标准差）
 * @param T - Time to maturity in years | 距离到期时间（年）
 * @returns Theoretical price of the call option | 看涨期权理论价格
 */
export const bsCallPrice = (S: number, K: number, r: number, sigma: number, T: number) => {
    if (T <= 0) return Math.max(S - K, 0);
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
};

/**
 * Black-Scholes Put Option Pricing Model
 * 
 * @param S - Current price of the underlying asset (Spot Price) | 标的资产当前价格
 * @param K - Strike price of the option | 期权行权价格
 * @param r - Risk-free interest rate (annualized, e.g. 0.05 for 5%) | 无风险利率（年化）
 * @param sigma - Volatility of the underlying asset (annualized standard deviation) | 波动率（年化标准差）
 * @param T - Time to maturity in years | 距离到期时间（年）
 * @returns Theoretical price of the put option | 看跌期权理论价格
 */
export const bsPutPrice = (S: number, K: number, r: number, sigma: number, T: number) => {
    if (T <= 0) return Math.max(K - S, 0);
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
};
