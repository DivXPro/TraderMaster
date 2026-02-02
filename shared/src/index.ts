export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Bet {
    id: string;
    startTime: number;
    endTime: number;
    highPrice: number;
    lowPrice: number;
    status: 'pending' | 'won' | 'lost';
}
