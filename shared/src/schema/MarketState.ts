import { Schema, MapSchema, type } from "@colyseus/schema";

export class Bet extends Schema {
    @type("string") id: string = "";
    @type("string") cellId: string = "";
    @type("number") startTime: number = 0;
    @type("number") endTime: number = 0;
    @type("number") highPrice: number = 0;
    @type("number") lowPrice: number = 0;
    @type("number") amount: number = 0;
    @type("number") odds: number = 0;
    @type("number") payout: number = 0;
    @type("string") status: string = "";
    @type("string") ownerId: string = "";
}

export class PredictionCell extends Schema {
    @type("string") id: string = "";
    @type("number") startTime: number = 0;
    @type("number") endTime: number = 0;
    @type("number") highPrice: number = 0;
    @type("number") lowPrice: number = 0;
    @type("number") probability: number = 0;
    @type("number") odds: number = 0;
}

export class MarketState extends Schema {
    @type("number") currentPrice: number = 0;
    @type({ map: Bet }) bets = new MapSchema<Bet>();
    @type({ map: PredictionCell }) predictionCells = new MapSchema<PredictionCell>();
}
