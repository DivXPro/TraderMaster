import { Room, Client } from "colyseus";
import { MarketState, Bet, PredictionCell, Player, MessageType, PREDICTION_DURATION, PREDICTION_PRICE_HEIGHT, PREDICTION_GENERATION_INTERVAL, PREDICTION_LAYERS, PREDICTION_INITIAL_COLUMNS } from "@trader-master/shared";
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

        this.onMessage(MessageType.PLACE_BET, (client, data) => {
            const amount = Number(data.amount);
            // 3. Bet: Minimum amount limit
            if (!amount || amount < 10) {
                 client.send(MessageType.ERROR, { message: "Minimum bet amount is 10" });
                 return;
            }

            // Check balance
            const player = this.state.players.get(client.sessionId);
            if (!player || player.balance < amount) {
                client.send(MessageType.ERROR, { message: "Insufficient balance" });
                return;
            }

            // Find Prediction Cell
            const cell = this.state.predictionCells.get(data.cellId);
            if (!cell) {
                client.send(MessageType.ERROR, { message: "Prediction cell not found or expired" });
                return;
            }

            // Check if player already placed a bet on this cell
            let alreadyBet = false;
            player.bets.forEach((b) => {
                if (b.cellId === cell.id) {
                    alreadyBet = true;
                }
            });

            if (alreadyBet) {
                client.send(MessageType.ERROR, { message: "You have already placed a bet on this cell" });
                return;
            }

            // Deduct balance
            if (player.balance < amount) {
                client.send(MessageType.ERROR, { message: "Insufficient balance" });
                return;
            }
            player.balance -= amount;
            console.log(`Player ${client.sessionId} balance deducted by ${amount}. New balance: ${player.balance}`);

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

            player.bets.set(bet.id, bet);
            console.log(`New bet placed: ${bet.id} by ${client.sessionId} Amount: ${amount} Odds: ${cell.odds}`);
            
            client.send(MessageType.BET_PLACED, { id: bet.id, odds: cell.odds, cellId: cell.id });
        });

        // 1 second tick
        this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000);

        // Initial Generation: Cover the right side of the chart (future)
        // Generate a few columns ahead so the grid looks full immediately
        const now = this.market.getCurrentTime();
        const currentPrice = this.market.getCurrentPrice();
        
        for (let i = 0; i < PREDICTION_INITIAL_COLUMNS; i++) {
            // Generate cells for: now, now+30, now+60, ...
            this.generatePredictionCells(currentPrice, now + i * PREDICTION_GENERATION_INTERVAL);
        }

        // Fast-forward lastGenerationTime so we don't regenerate these immediately in update()
        // The next generation will happen when candle.time >= (now + (N-1)*30) + 30
        this.lastGenerationTime = now + (PREDICTION_INITIAL_COLUMNS - 1) * PREDICTION_GENERATION_INTERVAL;
    }

    onJoin(client: Client, options: any) {
        console.log("Client joined:", client.sessionId);
        
        // Check if player already exists (reconnection logic)
        const existingPlayer = this.state.players.get(client.sessionId);
        if (existingPlayer) {
            existingPlayer.connected = true;
            // Send initial history
            client.send(MessageType.HISTORY, this.market.getHistory());
            return;
        }

        // Create player state
        const player = new Player();
        player.id = client.sessionId;
        player.balance = 10000; // Initial balance
        player.connected = true;
        this.state.players.set(client.sessionId, player);

        // Send initial history
        client.send(MessageType.HISTORY, this.market.getHistory());
    }

    async onLeave(client: Client, code: number) {
        console.log("Client left:", client.sessionId, "Code:", code);
        const consented = code === 1000;
        
        const player = this.state.players.get(client.sessionId);
        if (player) {
             player.connected = false;
        }

        try {
            if (consented) {
                throw new Error("consented leave");
            }

            // Allow reconnection for 60 seconds
            await this.allowReconnection(client, 60);

            // Client returned!
            if (player) {
                player.connected = true;
                console.log("Client reconnected:", client.sessionId);
            }
        } catch (e) {
             // Timeout or consented leave
             console.log("Client remove (timeout or consented):", client.sessionId);
             this.state.players.delete(client.sessionId);
        }
    }

    update(deltaTime: number) {
        const candle = this.market.tick();
        
        // Broadcast new candle
        this.broadcast(MessageType.PRICE, candle);
        this.state.currentPrice = candle.close;

        // Generate Prediction Cells (Every PREDICTION_GENERATION_INTERVAL seconds)
        if (candle.time - this.lastGenerationTime >= PREDICTION_GENERATION_INTERVAL) {
            this.generatePredictionCells(candle.close, candle.time);
            this.lastGenerationTime = candle.time;
        }

        // Check Bets
        const now = candle.time;
        const betsToRemove: string[] = [];
        const cellsToRemove: string[] = [];

        // Check Bets
        this.state.players.forEach((player) => {
            const betsToRemove: string[] = [];
            player.bets.forEach((bet: Bet, key: string) => {
                if (bet.status === "pending") {
                    // 4. Settlement: Check at time point
                    if (now >= bet.endTime) {
                        // Check if market price is in prediction cell range
                        // Use [Low, High) for inclusive low, exclusive high to prevent double wins on boundary
                        const won = candle.close >= bet.lowPrice && candle.close < bet.highPrice;
                        
                        if (won) {
                            bet.status = "won";
                            bet.payout = bet.amount * bet.odds;
                            console.log(`Bet ${bet.id} WON! Payout: ${bet.payout}`);
                            
                            // Add payout to player balance
                            player.balance += bet.payout;

                            // Notify Client
                            const client = this.clients.find(c => c.sessionId === bet.ownerId);
                            if (client) {
                                client.send(MessageType.BET_RESULT, { 
                                    id: bet.id, 
                                    status: "won", 
                                    payout: bet.payout,
                                    cellId: bet.cellId 
                                });
                            }

                        } else {
                            bet.status = "lost";
                            bet.payout = 0;
                            console.log(`Bet ${bet.id} LOST`);

                            // Notify Client
                            const client = this.clients.find(c => c.sessionId === bet.ownerId);
                            if (client) {
                                client.send(MessageType.BET_RESULT, { 
                                    id: bet.id, 
                                    status: "lost", 
                                    payout: 0,
                                    cellId: bet.cellId
                                });
                            }
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
                player.bets.delete(key);
            });
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
        // Generate standardized cells
        const endTime = currentTime + PREDICTION_DURATION;
        const timeToMaturity = PREDICTION_DURATION / 31536000; // in years
        
        // Front-end visual range is about 6 units height.
        // We generate PREDICTION_LAYERS layers up and PREDICTION_LAYERS layers down to fully cover the visible area.

        // Align generation to grid to ensure consistent vertical positioning
        const basePrice = Math.floor(currentPrice / PREDICTION_PRICE_HEIGHT) * PREDICTION_PRICE_HEIGHT;

        for (let i = 0; i < PREDICTION_LAYERS; i ++) {
            const low = basePrice + ((PREDICTION_LAYERS / 2) - i) * PREDICTION_PRICE_HEIGHT;
            const high = low + PREDICTION_PRICE_HEIGHT;
            this.createPredictionCell(low, high, currentTime, endTime, timeToMaturity);
        }
    }

    private createPredictionCell(low: number, high: number, startTime: number, endTime: number, T: number) {
        const currentPrice = this.market.getCurrentPrice();
        const probability = BlackScholes.calculateProbability(currentPrice, low, high, T);
        const odds = BlackScholes.calculateOdds(probability);

        // Always create cells to ensure grid is full, even if odds are extreme
        const cell = new PredictionCell();
        cell.id = Math.random().toString(36).substring(7);
        cell.startTime = startTime;
        cell.endTime = endTime;
        cell.lowPrice = low;
        cell.highPrice = high;
        cell.probability = probability;
        cell.odds = odds;
        
        this.state.predictionCells.set(cell.id, cell);
    }
}
