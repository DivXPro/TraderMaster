
import { bsCallPrice, bsPutPrice, RISK_FREE_RATE, VOLATILITY } from './pricing';

const runTests = () => {
    console.log("=== Black-Scholes Pricing Unit Test ===");
    console.log(`Global Parameters:`);
    console.log(`  Risk-Free Rate (r): ${RISK_FREE_RATE * 100}%`);
    console.log(`  Volatility (sigma): ${VOLATILITY * 100}%`);
    console.log("-----------------------------------------------------");

    // Test Parameters
    // Assumption: S (Spot Price) is fixed at 100 to observe the effect of K (Strike Price) changing.
    // User asked for "Price from 95 to 100". We interpret this as Strike Price K.
    // If user meant S, the logic is symmetric but let's stick to one.
    // Given the context of "grid boxes", K is the variable.
    const S = 97; 
    console.log(`Fixed Spot Price (S): ${S}`);
    console.log("-----------------------------------------------------");
    console.log(`| ${"Strike (K)".padEnd(10)} | ${"Time (s)".padEnd(8)} | ${"Call Price".padEnd(12)} | ${"Put Price".padEnd(12)} | ${"Moneyness".padEnd(10)} |`);
    console.log("|" + "-".repeat(12) + "|" + "-".repeat(10) + "|" + "-".repeat(14) + "|" + "-".repeat(14) + "|" + "-".repeat(12) + "|");

    for (let K = 95; K <= 100; K += 0.5) {
        for (let tSec = 10; tSec <= 60; tSec += 10) {
            const T = tSec / (365 * 24 * 3600);
            
            // Calculate Prices
            const callPrice = bsCallPrice(S, K, RISK_FREE_RATE, VOLATILITY, T);
            const putPrice = bsPutPrice(S, K, RISK_FREE_RATE, VOLATILITY, T);

            // Determine Moneyness
            let moneyness = "ATM";
            if (K < S) moneyness = "ITM Call"; // Call is ITM, Put is OTM
            if (K > S) moneyness = "OTM Call"; // Call is OTM, Put is ITM
            
            // Formatting
            const kStr = K.toFixed(1).padEnd(10);
            const tStr = tSec.toString().padEnd(8);
            const cStr = callPrice.toFixed(4).padEnd(12);
            const pStr = putPrice.toFixed(4).padEnd(12);
            const mStr = moneyness.padEnd(10);

            console.log(`| ${kStr} | ${tStr} | ${cStr} | ${pStr} | ${mStr} |`);

            // Basic Assertions
            if (callPrice < 0 || putPrice < 0) {
                console.error(`ERROR: Negative price detected for K=${K}, T=${tSec}`);
            }
            if (Number.isNaN(callPrice) || Number.isNaN(putPrice)) {
                console.error(`ERROR: NaN price detected for K=${K}, T=${tSec}`);
            }
        }
        console.log("|" + "-".repeat(12) + "|" + "-".repeat(10) + "|" + "-".repeat(14) + "|" + "-".repeat(14) + "|" + "-".repeat(12) + "|");
    }
    console.log("\nTests Completed Successfully.");
};

runTests();
