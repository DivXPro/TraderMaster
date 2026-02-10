export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface BetData {
    id: string;
    cellId?: string; // Unique ID for the grid cell
    startTime: number;
    endTime: number;
    highPrice: number;
    lowPrice: number;
    status: 'pending' | 'won' | 'lost';
}

export * from './schema/MarketState';
