import { Room, Client } from "colyseus";
import { MarketState, Bet, PredictionCell } from "@trader-master/shared";
import { Market } from "../market";
import { BlackScholes } from "../utils/bs";

export class MarketRoom extends Room {
    state: MarketState = new MarketState();
    private market: Market;
    private lastGenerationTime: number = 0;

    onCreate(options: any) {
        console.log("MarketRoom created", options);
        this.state = new MarketState();
        this.market = new Market(100.0);

        this.onMessage("place_bet", (client, data) => {
            const amount = Number(data.amount);
            // 3. Bet: Minimum amount limit
            if (!amount || amount < 10) {
                 client.send("error", { message: "Minimum bet amount is 10" });
                 return;
            }

            // Find Prediction Cell
            const cell = this.state.predictionCells.get(data.cellId);
            if (!cell) {
                client.send("error", { message: "Prediction cell not found or expired" });
                return;
            }

            // Validate if cell is still valid (e.g. not too close to expiration)
            // But for now we trust the cell existence

            const bet = new Bet();
            bet.id = Math.random().toString(36).substring(7);
            bet.cellId = cell.id;
            bet.startTime = cell.startTime;
            bet.endTime = cell.endTime;
            bet.highPrice = cell.highPrice;
            bet.lowPrice = cell.lowPrice;
            bet.amount = amount;
            bet.odds = cell.odds;
            bet.status = "pending";
            bet.ownerId = client.sessionId;

            this.state.bets.set(bet.id, bet);
            console.log(`New bet placed: ${bet.id} by ${client.sessionId} Amount: ${amount} Odds: ${cell.odds}`);
            
            client.send("bet_placed", { id: bet.id, odds: cell.odds });
        });

        // 1 second tick
        this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000);
    }

    onJoin(client: Client) {
        console.log("Client joined:", client.sessionId);
        // Send initial history
        client.send("history", this.market.getHistory());
    }

    onLeave(client: Client) {
        console.log("Client left:", client.sessionId);
    }

    update(deltaTime: number) {
        const candle = this.market.tick();
        
        // Broadcast new candle
        this.broadcast("price", candle);
        this.state.currentPrice = candle.close;

        // Generate Prediction Cells (Every 5 seconds)
        if (candle.time - this.lastGenerationTime >= 5) {
            this.generatePredictionCells(candle.close, candle.time);
            this.lastGenerationTime = candle.time;
        }

        // Check Bets
        const now = candle.time;
        const betsToRemove: string[] = [];
        const cellsToRemove: string[] = [];

        // Check Bets
        this.state.bets.forEach((bet: Bet, key: string) => {
            if (bet.status === "pending") {
                // 4. Settlement: Check at time point
                if (now >= bet.endTime) {
                    // Check if market price is in prediction cell range
                    const won = candle.close >= bet.lowPrice && candle.close <= bet.highPrice;
                    
                    if (won) {
                        bet.status = "won";
                        bet.payout = bet.amount * bet.odds;
                        console.log(`Bet ${bet.id} WON! Payout: ${bet.payout}`);
                    } else {
                        bet.status = "lost";
                        bet.payout = 0;
                        console.log(`Bet ${bet.id} LOST`);
                    }
                }
            } else {
                // Cleanup old bets after a while
                // Logic: if bet is finished and time > endTime + 60s
                if (now > bet.endTime + 60) {
                    betsToRemove.push(key);
                }
            }
        });

        betsToRemove.forEach(key => {
            this.state.bets.delete(key);
        });

        // Cleanup expired Prediction Cells
        this.state.predictionCells.forEach((cell: PredictionCell, key: string) => {
            if (now > cell.endTime) {
                cellsToRemove.push(key);
            }
        });

        cellsToRemove.forEach(key => {
            this.state.predictionCells.delete(key);
        });
    }

    private generatePredictionCells(currentPrice: number, currentTime: number) {
        // Generate cells for different durations: 30s, 60s, 120s
        const durations = [30, 60, 120];
        // Generate cells for different price ranges: +/- 0.5%, +/- 1.0%
        const ranges = [0.005, 0.01];

        durations.forEach(duration => {
            const timeToMaturity = duration / 31536000; // in years
            const endTime = currentTime + duration;

            ranges.forEach(range => {
                // Up cell: [Current, Current * (1+range)]
                this.createPredictionCell(
                    currentPrice, 
                    currentPrice * (1 + range), 
                    endTime, 
                    timeToMaturity
                );

                // Down cell: [Current * (1-range), Current]
                this.createPredictionCell(
                    currentPrice * (1 - range), 
                    currentPrice, 
                    endTime, 
                    timeToMaturity
                );
            });
        });
    }

    private createPredictionCell(low: number, high: number, endTime: number, T: number) {
        const currentPrice = this.market.getCurrentPrice();
        const probability = BlackScholes.calculateProbability(currentPrice, low, high, T);
        const odds = BlackScholes.calculateOdds(probability);

        // Only create attractive cells
        if (odds > 1.01 && odds < 20) {
            const cell = new PredictionCell();
            cell.id = Math.random().toString(36).substring(7);
            cell.startTime = this.market.getCurrentTime();
            cell.endTime = endTime;
            cell.lowPrice = low;
            cell.highPrice = high;
            cell.probability = probability;
            cell.odds = odds;
            
            this.state.predictionCells.set(cell.id, cell);
        }
    }
}
