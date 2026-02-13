import React, { useEffect, useRef, useMemo } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import * as Colyseus from '@colyseus/sdk';
import type { BetData as BetBox, PredictionCellData } from '@trader-master/shared';
import { MarketState, Bet, PredictionCell, Player, MessageType } from '@trader-master/shared';
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
    const callbacks = useMemo(() => Colyseus.Callbacks.get(room), [room]);
    const bets = useGameStore((state) => state.bets);
    const predictionCells = useGameStore((state) => state.predictionCells);
    const addBet = useGameStore((state) => state.addBet);
    const updateBet = useGameStore((state) => state.updateBet);
    const addPredictionCell = useGameStore((state) => state.addPredictionCell);
    const removePredictionCell = useGameStore((state) => state.removePredictionCell);
    const setBalance = useGameStore((state) => state.setBalance);

    // Use ref to access latest lastTime in event listener without re-binding
    const lastTimeRef = useRef(lastTime);
    useEffect(() => {
        lastTimeRef.current = lastTime;
    }, [lastTime]);

    // Handle Chart Clicks for Betting
    const handleCellClick = (cellId: string) => {
         const currentCells = useGameStore.getState().predictionCells;
         const clickedCell = currentCells.find(c => c.id === cellId);

         if (!clickedCell) return;

         const currentBets = useGameStore.getState().bets;
         const existingBet = currentBets.find(b => b.cellId === clickedCell.id && b.ownerId === room.sessionId);

         if (existingBet) {
             alert("You have already placed a bet on this cell!");
             return;
         }

         // Check balance
         const currentBalance = useGameStore.getState().balance;
         const betAmount = 100;
         
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
    };
        
        // chart.subscribeClick(handleChartClick);
        // return () => {
        //    chart.unsubscribeClick(handleChartClick);
        // };
    // }, [chart, series, room]); // Dependencies

    useEffect(() => {
        if (!room) return;

        // Note: Colyseus state synchronization
        // Since we don't have the Schema classes on the client, we access generic state
        // room.state.bets is a MapSchema
        
        // Helper to convert Schema to BetBox
        const toBetBox = (bet: Bet): BetBox => ({
            id: bet.id,
            cellId: bet.cellId,
            startTime: bet.startTime,
            endTime: bet.endTime,
            highPrice: bet.highPrice,
            lowPrice: bet.lowPrice,
            amount: bet.amount,
            odds: bet.odds,
            payout: bet.payout,
            status: bet.status,
            ownerId: bet.ownerId
        });

        // Helper to convert Schema to PredictionCell
        const toPredictionCell = (cell: PredictionCell): PredictionCellData => ({
            id: cell.id,
            startTime: cell.startTime,
            endTime: cell.endTime,
            highPrice: cell.highPrice,
            lowPrice: cell.lowPrice,
            probability: cell.probability,
            odds: cell.odds
        });

        // Bets Sync (via Player)
        const handlePlayer = (player: Player) => {
             if (player.id === room.sessionId) {
                 console.log("Current player connected:", player.id);
                 
                // 1. Sync Balance
                setBalance(player.balance);
                
                callbacks.listen(player, 'balance', () => {
                    setBalance(player.balance);
                });

                // Listen for bets
                // Cast to unknown then CollectionCallback to access onAdd
                callbacks.listen(player, 'bets', (currentBets, previousBets) => {
                    console.debug('currentBets', currentBets);
                    console.debug('previousBets', previousBets);
                    currentBets.forEach((bet: Bet) => {
                        addBet(toBetBox(bet));
                    });
                });
             }
        };

        // Listen for players
        callbacks.onAdd('players', (player: Player, key: string) => {
             handlePlayer(player);
        });

        // Also check existing players
        if (room.state.players) {
            room.state.players.forEach((player: Player) => {
                handlePlayer(player);
            });
        }


        // Prediction Cells Sync
        callbacks.onAdd('predictionCells', (cell: PredictionCell, key: string) => {
            addPredictionCell(toPredictionCell(cell));
        });

        callbacks.onRemove('predictionCells', (cell: PredictionCell, key: string) => {
            removePredictionCell(cell.id);
        });

        if (room.state.predictionCells) {
            room.state.predictionCells.forEach((cell: PredictionCell) => {
                addPredictionCell(toPredictionCell(cell));
            });
        }



        return () => {
             // Cleanup if needed
        };
    }, [room, addBet, updateBet, addPredictionCell, removePredictionCell, callbacks, setBalance]);

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
