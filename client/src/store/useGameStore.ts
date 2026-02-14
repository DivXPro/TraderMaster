import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { BetData, Candle, PredictionCellData } from '@trader-master/shared';

// Define PlayerData locally until shared package update propagates
export interface PlayerData {
    id: string;
    balance: number;
    connected: boolean;
}

interface GameState {
  // Market Data
  marketData: Candle[];
  lastTime: number | null;
  lastPrice: number | null;
  // Betting
  bets: BetData[];
  predictionCells: PredictionCellData[];
  
  // User
  player: PlayerData | null;
  balance: number; // Keep balance for backward compatibility or ease of access, sync with player.balance

  // Actions
  setMarketData: (data: Candle[]) => void;
  addCandle: (candle: Candle) => void;
  setBets: (bets: BetData[]) => void;
  addBet: (bet: BetData) => void;
  updateBet: (bet: BetData) => void;
  removeBet: (betId: string) => void;
  setPredictionCells: (cells: PredictionCellData[]) => void;
  addPredictionCell: (cell: PredictionCellData) => void;
  updatePredictionCell: (cell: PredictionCellData) => void;
  updatePredictionCellStatus: (cellId: string, status: string) => void;
  removePredictionCell: (cellId: string) => void;
  setPlayer: (player: PlayerData | null) => void;
  setBalance: (balance: number) => void;
}

export const useGameStore = create<GameState>()(
  subscribeWithSelector((set) => ({
    marketData: [],
    lastTime: null,
    lastPrice: null,
    bets: [],
    predictionCells: [],
    player: null,
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

    addBet: (bet) => set((state) => {
        if (state.bets.some(b => b.id === bet.id)) return {};
        return { bets: [...state.bets, bet] };
    }),

    updateBet: (updatedBet) => set((state) => ({
      bets: state.bets.map((b) => (b.id === updatedBet.id ? updatedBet : b)),
    })),
    
    removeBet: (betId) => set((state) => ({
      bets: state.bets.filter((b) => b.id !== betId),
    })),

    setPredictionCells: (cells) => set({ predictionCells: cells }),
    
    addPredictionCell: (cell) => set((state) => {
        if (state.predictionCells.some(c => c.id === cell.id)) return {};
        return { predictionCells: [...state.predictionCells, cell] };
    }),

    updatePredictionCell: (cell) => set((state) => ({
        predictionCells: state.predictionCells.map((c) => (c.id === cell.id ? { ...c, ...cell } : c)),
    })),
    
    updatePredictionCellStatus: (cellId: string, status: string) => set((state) => ({
        predictionCells: state.predictionCells.map((c) => (c.id === cellId ? { ...c, status } : c)),
    })),
    
    removePredictionCell: (cellId) => set((state) => ({ 
        predictionCells: state.predictionCells.filter(c => c.id !== cellId) 
    })),

    setPlayer: (player) => set((state) => ({ 
        player,
        // Sync balance if player is set
        balance: player ? player.balance : state.balance
    })),

    setBalance: (balance) => set((state) => ({ 
        balance,
        // Update player balance if player exists
        player: state.player ? { ...state.player, balance } : state.player
    })),
  }))
);
