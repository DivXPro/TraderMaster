import React, { useEffect, useRef } from 'react';
import type { IChartApi, ISeriesApi, MouseEventParams } from 'lightweight-charts';
import * as Colyseus from '@colyseus/sdk';
import type { CollectionCallback, SchemaCallback } from '@colyseus/schema';
import type { BetData as BetBox, PredictionCellData } from '@trader-master/shared';
import { MarketState, Bet, PredictionCell } from '@trader-master/shared';
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
    const addBet = useGameStore((state) => state.addBet);
    const updateBet = useGameStore((state) => state.updateBet);
    const addPredictionCell = useGameStore((state) => state.addPredictionCell);
    const removePredictionCell = useGameStore((state) => state.removePredictionCell);
    const setBalance = useGameStore((state) => state.setBalance);
    const balance = useGameStore((state) => state.balance);
    const callbacks = Colyseus.Callbacks.get(room);

    // Initialize user balance
    useEffect(() => {
        setBalance(50000);
    }, [setBalance]);

    // Use ref to access latest lastTime in event listener without re-binding
    const lastTimeRef = useRef(lastTime);
    useEffect(() => {
        lastTimeRef.current = lastTime;
    }, [lastTime]);

    // Handle Chart Clicks for Betting
    useEffect(() => {
        const handleChartClick = (param: MouseEventParams) => {
            if (!param.point || !chart || !series) return;
            
            const timeScale = chart.timeScale();
            // Cast to number | null to handle both Time type and our calculated number
            let t = timeScale.coordinateToTime(param.point.x) as number | null;
            
            // If t is null (future area), estimate it using logical index
            if (t === null) {
                const logical = timeScale.coordinateToLogical(param.point.x);
                if (logical !== null) {
                    const visibleRange = timeScale.getVisibleLogicalRange();
                    if (visibleRange) {
                        // Use the start of visible range as reference (usually has data)
                        const refLogical = Math.ceil(visibleRange.from);
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const refCoordinate = timeScale.logicalToCoordinate(refLogical as any);
                        const refTime = refCoordinate !== null ? timeScale.coordinateToTime(refCoordinate) : null;
                        
                        if (refTime !== null) {
                            // Calculate interval (seconds per logical index)
                            // Sample another point to estimate interval
                            const refLogical2 = refLogical + 5; // Take a point 5 steps away
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const refCoordinate2 = timeScale.logicalToCoordinate(refLogical2 as any);
                            const refTime2 = refCoordinate2 !== null ? timeScale.coordinateToTime(refCoordinate2) : null;
                            
                            let interval = 1; // Default to 1s if calculation fails
                            if (refTime2 !== null && typeof refTime === 'number' && typeof refTime2 === 'number') {
                                interval = (refTime2 - refTime) / 5;
                            }
                            
                            // Estimate t
                            t = (refTime as number) + (logical - refLogical) * interval; 
                        }
                    }
                }
            }

            const p = series.coordinateToPrice(param.point.y);
            
            console.log('Click raw:', param.point, 't:', t, 'p:', p);

            if (t === null || p === null) return;
            
            // Find clicked Prediction Cell
            // Access latest predictionCells from store directly to ensure freshness in callback if needed,
            // but here we rely on the closure or ref if we want perfect safety.
            // Since we are inside useEffect with [predictionCells] dependency (missing in original code?), 
            // actually the original code had [chart, series, room] dependencies.
            // We should use the store getter to avoid re-binding the listener too often.
            const currentCells = useGameStore.getState().predictionCells;
            
            const clickedCell = currentCells.find(c => 
                t! >= c.startTime && t! <= c.endTime && 
                p >= c.lowPrice && p <= c.highPrice
            );

            if (clickedCell) {
                 // Place Bet
                 const bet = {
                     cellId: clickedCell.id,
                     amount: 100, // Default amount
                     currency: 'USD'
                 };
                 console.log('Placing bet on cell:', clickedCell.id, bet);
                 // Emit event to server
                 room.send('place_bet', bet);
            } else {
                console.log('Click ignored: No prediction cell found at', t, p);
            }
        };
        
        chart.subscribeClick(handleChartClick);
        return () => {
            chart.unsubscribeClick(handleChartClick);
        };
    }, [chart, series, room]); // Dependencies

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

        // Bets Sync
        callbacks.onAdd('bets', (bet: Bet, key: string) => {
            addBet(toBetBox(bet));
            (bet as unknown as SchemaCallback<Bet>).onChange(() => {
                updateBet(toBetBox(bet));
            });
        });
    
        if (room.state.bets) {
            room.state.bets.forEach((bet: Bet) => {
                addBet(toBetBox(bet));
                (bet as unknown as SchemaCallback<Bet>).onChange(() => {
                updateBet(toBetBox(bet));
                });
            });
        }


        // Prediction Cells Sync
        callbacks.onAdd('predictionCells', (cell: PredictionCell, key: string) => {
            console.log('Client received new PredictionCell:', cell.toJSON());
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
    }, [room, addBet, updateBet, addPredictionCell, removePredictionCell]);

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
                balance={balance}
                lastTime={lastTime}
                lastPrice={lastPrice}
            />
        </div>
    );
};
