import { Schema, MapSchema, type } from "@colyseus/schema";

export class Bet extends Schema {
    @type("string") id: string = "";
    @type("string") cellId: string = "";
    @type("number") startTime: number = 0;
    @type("number") endTime: number = 0;
    @type("number") highPrice: number = 0;
    @type("number") lowPrice: number = 0;
    @type("string") status: string = "";
    @type("string") ownerId: string = "";
}

export class MarketState extends Schema {
    @type("number") currentPrice: number = 0;
    @type({ map: Bet }) bets = new MapSchema<Bet>();
}
