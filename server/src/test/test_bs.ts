
import { BlackScholes } from '../utils/bs';

const S = 100; // Current Price
const T_values = [30/31536000, 60/31536000, 300/31536000, 1]; // 30s, 60s, 5m, 1y
const Ranges = [
    { L: 98, H: 99 },
    { L: 99, H: 100 },
    { L: 100, H: 101 },
    { L: 101, H: 102 },
    { L: 102, H: 103 },
    { L: 103, H: 104 }
];

console.log(`Current Price (S): ${S}`);
console.log('Probabilities (Rows: Price Ranges, Cols: Time to Maturity [30s, 60s, 5m, 1y])');

const table: string[][] = [];
const header = ['Range \\ Time', '30s', '60s', '5m', '1y'];
table.push(header);

for (const range of Ranges) {
    const row: string[] = [`[${range.L}, ${range.H}]`];
    for (const T of T_values) {
        const prob = BlackScholes.calculateProbability(S, range.L, range.H, T);
        const odds = BlackScholes.calculateOdds(prob);
        // Format: "Prob (Odds)"
        row.push(`${prob.toFixed(4)} (${odds.toFixed(2)})`);
    }
    table.push(row);
}

// Print 2D Array
console.table(table);

// Also verify sum of probabilities for a full coverage
console.log("\n--- Verification: Sum of probabilities for wide range ---");
const T_test = 1; // 1 year
const wide_prob = BlackScholes.calculateProbability(S, 0.1, 1000, T_test);
console.log(`Probability 0.1-1000 at 1 year: ${wide_prob.toFixed(4)}`);
