import React, { useCallback } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import * as Colyseus from '@colyseus/sdk';
import { MarketState, MessageType } from '@trader-master/shared';
import { GridCanvas } from './GridCanvas';
import { useGameStore } from '../store/useGameStore';

interface GameOverlayProps {
    chart: IChartApi;
    series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
    room: Colyseus.Room<MarketState>;
    lastTime: number | null;
    lastPrice: number | null;
}

export const GameOverlay: React.FC<GameOverlayProps> = ({ chart, series, room, lastTime, lastPrice }) => {
    const bets = useGameStore((state) => state.bets);
    const predictionCells = useGameStore((state) => state.predictionCells);

    // Handle Chart Clicks for Betting
    const handleCellClick = useCallback((cellId: string) => {
         const currentCells = useGameStore.getState().predictionCells;
         const clickedCell = currentCells.find(c => c.id === cellId);

         if (!clickedCell) return;

         const currentBets = useGameStore.getState().bets;
         const existingBet = currentBets.find(b => b.cellId === clickedCell.id && b.ownerId === room.sessionId);

         if (existingBet) {
             alert("You have already placed a bet on this cell!");
             return;
         }

         const betAmount = 100;

         const currentBalance = useGameStore.getState().balance;
         if (currentBalance < betAmount) {
             alert("Insufficient balance!");
             return;
         }

         // Place Bet
         const bet = {
             cellId: clickedCell.id,
             amount: betAmount, // Default amount
             currency: 'USD'
         };
         console.log('Placing bet on cell:', clickedCell.id, bet);
         // Emit event to server
         room.send(MessageType.PLACE_BET, bet);
    }, [room]);

    return (
        <div 
            className="game-overlay-container"
            style={{ position: 'absolute', top:0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}
        >
            <GridCanvas
                chart={chart}
                series={series}
                bets={bets}
                predictionCells={predictionCells}
                lastTime={lastTime}
                lastPrice={lastPrice}
                onCellClick={handleCellClick}
            />
        </div>
    );
};
