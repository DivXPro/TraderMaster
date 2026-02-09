import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Bet, Candle } from '@trader-master/shared';

interface GameState {
  // Market Data
  marketData: Candle[];
  lastTime: number | null;
  lastPrice: number | null;
  
  // Betting
  bets: Bet[];
  
  // User
  balance: number;

  // Actions
  setMarketData: (data: Candle[]) => void;
  addCandle: (candle: Candle) => void;
  setBets: (bets: Bet[]) => void;
  addBet: (bet: Bet) => void;
  updateBet: (bet: Bet) => void;
  setBalance: (balance: number) => void;
}

export const useGameStore = create<GameState>()(
  subscribeWithSelector((set) => ({
    marketData: [],
    lastTime: null,
    lastPrice: null,
    bets: [],
    balance: 10000, // Default starting balance

    setMarketData: (data) => set((state) => {
        const last = data.length > 0 ? data[data.length - 1] : null;
        return { 
            marketData: data,
            lastTime: last ? (last.time as number) : state.lastTime,
            lastPrice: last ? last.close : state.lastPrice
        };
    }),

    addCandle: (candle) => set((state) => {
        const newData = [...state.marketData, candle];
        // Optional: limit history size to prevent memory leaks
        if (newData.length > 2000) newData.shift();
        
        return {
            marketData: newData,
            lastTime: candle.time as number,
            lastPrice: candle.close
        };
    }),

    setBets: (bets) => set({ bets }),

    addBet: (bet) => set((state) => ({ bets: [...state.bets, bet] })),

    updateBet: (updatedBet) => set((state) => ({
      bets: state.bets.map((b) => (b.id === updatedBet.id ? updatedBet : b)),
    })),

    setBalance: (balance) => set({ balance }),
  }))
);
