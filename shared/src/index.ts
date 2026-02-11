export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface BetData {
    id: string;
    cellId: string;
    startTime: number;
    endTime: number;
    highPrice: number;
    lowPrice: number;
    amount: number;
    odds: number;
    payout: number;
    status: string;
    ownerId: string;
}

export interface PredictionCellData {
    id: string;
    startTime: number;
    endTime: number;
    highPrice: number;
    lowPrice: number;
    probability: number;
    odds: number;
}

export * from './schema/MarketState';
