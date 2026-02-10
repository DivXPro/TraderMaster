import { Room, Client } from "colyseus";
import { MarketState, Bet } from "@trader-master/shared";
import { Market } from "../market";

export class MarketRoom extends Room {
    state: MarketState = new MarketState();
    private market: Market;

    onCreate(options: any) {
        console.log("MarketRoom created", options);
        this.state = new MarketState();
        this.market = new Market(100.0);

        this.onMessage("place_bet", (client, data) => {
            const bet = new Bet();
            bet.id = Math.random().toString(36).substring(7);
            bet.cellId = data.cellId;
            bet.startTime = data.startTime;
            bet.endTime = data.endTime;
            bet.highPrice = data.highPrice;
            bet.lowPrice = data.lowPrice;
            bet.status = "pending";
            bet.ownerId = client.sessionId;

            this.state.bets.set(bet.id, bet);
            console.log(`New bet placed: ${bet.id} by ${client.sessionId}`);
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

        // Check Bets
        const now = candle.time;
        const betsToRemove: string[] = [];

        this.state.bets.forEach((bet: Bet, key: string) => {
            if (bet.status === "pending") {
                // Check if active (time is within range)
                if (now >= bet.startTime && now <= bet.endTime) {
                    // Instant Win Rule: If K-line passes through (intersects) the box
                    const overlap = Math.max(candle.low, bet.lowPrice) <= Math.min(candle.high, bet.highPrice);
                    
                    if (overlap) {
                        bet.status = "won";
                        return;
                    }
                }

                // Check if bet expired and still pending (meaning it didn't win)
                if (now >= bet.endTime) {
                    bet.status = "lost";
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
    }
}
