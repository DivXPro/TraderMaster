import React, { useEffect, useState, useRef } from 'react';
import type { IChartApi, ISeriesApi, MouseEventParams } from 'lightweight-charts';
import { Socket } from 'socket.io-client';
import type { Bet as BetBox } from '@trader-master/shared';
import { GridCanvas } from './GridCanvas';
import { TIME_GRID_STEP, PRICE_GRID_STEP, getGridId } from '../utils/grid';

interface GameOverlayProps {
    chart: IChartApi;
    series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
    socket: Socket;
    lastTime: number | null;
    lastPrice: number | null;
}

export const GameOverlay: React.FC<GameOverlayProps> = ({ chart, series, socket, lastTime, lastPrice }) => {
    const [bets, setBets] = useState<BetBox[]>([]);
    
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
            
            // Align to grid
            const tStep = Math.floor((t as number) / TIME_GRID_STEP) * TIME_GRID_STEP;
            const pStep = Math.floor(p / PRICE_GRID_STEP) * PRICE_GRID_STEP;
            
            // Check validation (Must be future > 10s)
            const currentLastTime = lastTimeRef.current;
            console.log('Click Grid:', tStep, pStep, 'LastTime:', currentLastTime);

            if (currentLastTime === null) return;
            
            if (tStep > currentLastTime + 10) {
                 // Place Bet
                 const bet = {
                     cellId: getGridId(tStep, pStep),
                     startTime: tStep,
                     endTime: tStep + TIME_GRID_STEP,
                     highPrice: pStep + PRICE_GRID_STEP,
                     lowPrice: pStep,
                     amount: 100, // Default amount
                     currency: 'USD'
                 };
                 console.log('Placing bet:', bet);
                 // Emit event to server
                 socket.emit('place_bet', bet);
            } else {
                console.log('Click ignored: Locked or Past');
            }
        };
        
        chart.subscribeClick(handleChartClick);
        return () => {
            chart.unsubscribeClick(handleChartClick);
        };
    }, [chart, series, socket]);

    useEffect(() => {
        socket.on('bet_placed', (bet: BetBox) => {
            setBets(prev => [...prev, bet]);
        });
        
        socket.on('bet_update', (updatedBet: BetBox) => {
             setBets(prev => prev.map(b => b.id === updatedBet.id ? updatedBet : b));
        });

        return () => {
            socket.off('bet_placed');
            socket.off('bet_update');
        };
    }, [socket]);

    return (
        <div 
            className="game-overlay-container"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}
        >
            <GridCanvas 
                chart={chart}
                series={series}
                bets={bets}
                lastTime={lastTime}
                lastPrice={lastPrice}
            />
        </div>
    );
};
