import React, { useEffect, useState, useRef } from 'react';
import type { IChartApi, ISeriesApi, Time, UTCTimestamp, MouseEventParams } from 'lightweight-charts';
import { Socket } from 'socket.io-client';
import type { Bet as BetBox } from '@trader-master/shared';
import { bsCallPrice, bsPutPrice, RISK_FREE_RATE, VOLATILITY } from '../utils/pricing';

interface GameOverlayProps {
    chart: IChartApi;
    series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
    socket: Socket;
    lastTime: number | null;
    lastPrice: number | null;
}

// Grid settings
const TIME_GRID_STEP = 60; // seconds
const PRICE_GRID_STEP = 0.5;

// Helper to generate unique ID for a grid cell
const getGridId = (startTime: number, lowPrice: number) => {
    return `cell_${startTime}_${lowPrice.toFixed(2)}`;
};

const drawGridColumn = (
    ctx: CanvasRenderingContext2D,
    series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">,
    t: number,
    pStart: number,
    pEnd: number,
    x1: number,
    x2: number,
    lastTime: number | null,
    lastPrice: number | null,
    betsMap: Map<string, BetBox>
) => {
    // Skip if width is too small or invalid
    if (x2 <= x1) return;
    
    const w = x2 - x1;
    
    // Determine Color and State (Default)
    // Status 1: Past/Current - t < lastTime -> High Transparency
    // Status 2: Locked/Unbetable (Dark Gray) - t >= lastTime but <= lastTime + 10s
    // Status 3: Betable (Green) - t > lastTime + 10s
    
    let defaultFillStyle = 'rgba(0, 0, 0, 0)'; // Transparent fill
    let defaultStrokeStyle = 'rgba(0, 255, 0, 0.3)'; // Green Border for Betable
    let defaultTextFillStyle = 'rgba(255, 255, 255, 0.6)';
    let isPast = false;
    
    if (lastTime !== null) {
        if (t < lastTime) {
            // Past - High transparency
            defaultFillStyle = 'rgba(128, 128, 128, 0.05)'; 
            defaultStrokeStyle = 'rgba(128, 128, 128, 0.1)';
            defaultTextFillStyle = 'rgba(255, 255, 255, 0.1)';
            isPast = true;
        } else if (t <= lastTime + 10) {
            // Locked / Unbetable
            defaultFillStyle = 'rgba(60, 60, 60, 0.5)'; // Keep fill for locked to indicate unavailable
            defaultStrokeStyle = 'rgba(60, 60, 60, 0.8)';
            defaultTextFillStyle = 'rgba(255, 255, 255, 0.2)'; // Dim text
        }
    }
    
    // Text style
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let p = pStart; p <= pEnd; p += PRICE_GRID_STEP) {
        const y1 = series.priceToCoordinate(p);
        const y2 = series.priceToCoordinate(p + PRICE_GRID_STEP);
        
        if (y1 === null || y2 === null) continue;
        
        const rY = Math.min(y1, y2);
        const rH = Math.abs(y1 - y2);
        
        // Generate unique ID for this grid cell
        const cellId = getGridId(t, p);
        const bet = betsMap.get(cellId);

        let fillStyle = defaultFillStyle;
        let strokeStyle = defaultStrokeStyle;
        let shadowBlur = 0;
        let shadowColor = 'transparent';
        let lineWidth = 1;

        // Override styles if bet exists
        if (bet) {
             if (bet.status === 'won') {
                 fillStyle = 'rgba(46, 204, 113, 0.3)'; // Won: Green
                 strokeStyle = 'rgba(46, 204, 113, 1)';
                 shadowBlur = 10;
                 shadowColor = 'rgba(46, 204, 113, 0.4)';
                 lineWidth = 2;
             } else if (bet.status === 'lost') {
                 fillStyle = 'rgba(231, 76, 60, 0.3)'; // Lost: Red
                 strokeStyle = 'rgba(231, 76, 60, 0.8)';
             } else {
                 // Pending: Gold
                 fillStyle = 'rgba(255, 215, 0, 0.2)';
                 strokeStyle = 'rgba(255, 215, 0, 0.8)';
                 shadowBlur = 5;
                 shadowColor = 'rgba(255, 215, 0, 0.2)';
             }
        }
        
        // Save context for shadow
        ctx.save();
        if (shadowBlur > 0) {
            ctx.shadowBlur = shadowBlur;
            ctx.shadowColor = shadowColor;
        }

        // Draw Grid Cell
        ctx.fillStyle = fillStyle;
        ctx.fillRect(x1 + 1, rY + 1, w - 2, rH - 2);
        
        // Draw Border
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(x1 + 1, rY + 1, w - 2, rH - 2);
        
        ctx.restore();
        
        // Draw Text (Option Price or Result?)
        // Currently keeping Option Price. 
        // Note: For 'Past' cells, we might want to hide it if no bet, but keeping as is.
        
        // Calculate middle price
        const midPrice = p + PRICE_GRID_STEP / 2;
        
        const maturitySec = lastTime !== null ? (t + TIME_GRID_STEP) - lastTime : TIME_GRID_STEP;
        const T = Math.max(maturitySec, 0) / (365 * 24 * 3600);
        
        // Use lastPrice as S if available, otherwise fallback to midPrice (less accurate)
        const S = lastPrice !== null ? lastPrice : midPrice;
        const K = midPrice;
        
        const optionPrice = K < S 
            ? bsCallPrice(S, K, RISK_FREE_RATE, VOLATILITY, T)
            : bsPutPrice(S, K, RISK_FREE_RATE, VOLATILITY, T);

        ctx.fillStyle = defaultTextFillStyle;
        // If bet exists, maybe bold the text or change color?
        if (bet) ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        
        ctx.fillText(optionPrice.toFixed(4), x1 + w / 2, rY + rH / 2);
    }
};

export const GameOverlay: React.FC<GameOverlayProps> = ({ chart, series, socket, lastTime, lastPrice }) => {
    const [bets, setBets] = useState<BetBox[]>([]);
    const overlayRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // Sync bets position on chart scroll/zoom
    const [renderTrigger, setRenderTrigger] = useState(0);

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

    // Helper to format time for axis
    const formatTimeAxis = (t: number) => {
        const date = new Date(t * 1000);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Grid Drawing Logic
    const drawGrid = React.useCallback(() => {
        const canvas = canvasRef.current;
        const overlay = overlayRef.current;
        if (!canvas || !overlay) return;

        // Get chart dimensions including scales
        const priceScaleWidth = chart.priceScale('right').width();
        const timeScaleHeight = chart.timeScale().height();

        // Resize canvas to match overlay but exclude scales
        // We assume overlay is 100% width/height of the container
        const width = overlay.clientWidth - priceScaleWidth;
        const height = overlay.clientHeight - timeScaleHeight;
        
        // Use device pixel ratio for sharp rendering
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.resetTransform();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        // Find visible time range by sampling pixels
        const timeScale = chart.timeScale();
        
        // Check if chart is ready (has data and visible range)
        if (timeScale.getVisibleLogicalRange() === null) return;

        const widthPx = width; // logical width
        
        // Sample start time
        // Note: coordinateToTime returns null if not in data/not ready
        const startTime = timeScale.coordinateToTime(0) as number | null;
        
        if (startTime === null) return;

        // Calculate pixels per step (gridWidth)
        let gridWidth = 0;
        const xStart = timeScale.timeToCoordinate(startTime as UTCTimestamp);
        const xNext = timeScale.timeToCoordinate((startTime + TIME_GRID_STEP) as UTCTimestamp);
        
        if (xStart !== null && xNext !== null) {
            gridWidth = xNext - xStart;
        } else {
             // Try going backwards if we are at the end
             const xPrev = timeScale.timeToCoordinate((startTime - TIME_GRID_STEP) as UTCTimestamp);
             if (xStart !== null && xPrev !== null) {
                 gridWidth = xStart - xPrev;
             }
        }
        
        // Default minimal width to prevent infinite loops or freeze
        if (gridWidth <= 1) gridWidth = 10; 

        // Create Map for efficient bet lookup
        const betsMap = new Map<string, BetBox>();
        bets.forEach(bet => {
            if (bet.cellId) betsMap.set(bet.cellId, bet);
        });

        // Align to grid step
        let t = Math.floor(startTime / TIME_GRID_STEP) * TIME_GRID_STEP;

        // Price range
        const priceTop = series.coordinateToPrice(0);
        const priceBottom = series.coordinateToPrice(height);
        
        if (priceTop === null || priceBottom === null) return;
        
        const pMax = Math.max(priceTop, priceBottom);
        const pMin = Math.min(priceTop, priceBottom);
        
        const pStart = Math.floor(pMin / PRICE_GRID_STEP) * PRICE_GRID_STEP;
        const pEnd = Math.ceil(pMax / PRICE_GRID_STEP) * PRICE_GRID_STEP;

        // Draw Rects
        // Calculate initial x1
        let x1: number | null = timeScale.timeToCoordinate(t as UTCTimestamp);
        
        // If initial x1 is null (maybe slightly off screen), project from startTime
        if (x1 === null && xStart !== null) {
             const timeDiff = t - startTime;
             x1 = xStart + (timeDiff / TIME_GRID_STEP) * gridWidth;
        }
        
        // Safety check
        if (x1 === null) x1 = 0;

        let safety = 0;
        while (x1 < widthPx && safety++ < 1000) {
            const nextT = t + TIME_GRID_STEP;
            let x2: number | null = timeScale.timeToCoordinate(nextT as UTCTimestamp);
            
            // If x2 is null, project it using gridWidth
            if (x2 === null) {
                x2 = x1 + gridWidth;
            }
            
            // Draw grid column (visuals)
            drawGridColumn(ctx, series, t, pStart, pEnd, x1, x2, lastTime, lastPrice, betsMap);
            
            // Prepare for next iteration
            t = nextT;
            x1 = x2;
        }
    }, [chart, series, lastTime, lastPrice, bets]);

    useEffect(() => {
        drawGrid();
    }, [drawGrid]);

    useEffect(() => {
        const handleTimeScaleChange = () => {
            setRenderTrigger(prev => prev + 1);
        };

        chart.timeScale().subscribeVisibleLogicalRangeChange(handleTimeScaleChange);
        chart.timeScale().subscribeVisibleTimeRangeChange(handleTimeScaleChange);
        chart.timeScale().subscribeSizeChange(handleTimeScaleChange);

        socket.on('bet_placed', (bet: BetBox) => {
            setBets(prev => [...prev, bet]);
        });
        
        socket.on('bet_update', (updatedBet: BetBox) => {
             setBets(prev => prev.map(b => b.id === updatedBet.id ? updatedBet : b));
        });

        return () => {
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleTimeScaleChange);
            chart.timeScale().unsubscribeVisibleTimeRangeChange(handleTimeScaleChange);
            chart.timeScale().unsubscribeSizeChange(handleTimeScaleChange);
            socket.off('bet_placed');
            socket.off('bet_update');
        };
    }, [chart, socket]);

    // Helper to render a box
    const renderBox = (x1: number, y1: number, x2: number, y2: number, style: React.CSSProperties) => {
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);

        return (
            <div style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                pointerEvents: 'none',
                ...style
            }} />
        );
    };

    return (
        <div 
            ref={overlayRef}
            className="game-overlay"
        >
            <canvas 
                ref={canvasRef}
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 0 }}
            />

            {/* Active Bets - Removed as they are now rendered in Canvas */}
            {/* 
            {bets.map(bet => {
                const x1 = chart.timeScale().timeToCoordinate(bet.startTime as Time);
                const x2 = chart.timeScale().timeToCoordinate(bet.endTime as Time);
                const y1 = series.priceToCoordinate(bet.highPrice);
                const y2 = series.priceToCoordinate(bet.lowPrice);

                // Skip if coordinates are null (out of view or invalid)
                if (x1 === null || x2 === null || y1 === null || y2 === null) return null;

                let style: React.CSSProperties = {
                    backgroundColor: 'rgba(255, 215, 0, 0.2)', // Pending: Gold
                    border: '1px solid rgba(255, 215, 0, 0.8)',
                    boxShadow: '0 0 5px rgba(255, 215, 0, 0.2)',
                    zIndex: 10 // Ensure on top of canvas
                };

                if (bet.status === 'won') {
                    style = {
                        backgroundColor: 'rgba(46, 204, 113, 0.3)', // Won: Green
                        border: '2px solid rgba(46, 204, 113, 1)',
                        boxShadow: '0 0 10px rgba(46, 204, 113, 0.4)',
                        zIndex: 11 // Bring to front
                    };
                } else if (bet.status === 'lost') {
                    style = {
                        backgroundColor: 'rgba(231, 76, 60, 0.3)', // Lost: Red
                        border: '1px solid rgba(231, 76, 60, 0.8)',
                        zIndex: 10
                    };
                }

                return (
                    <React.Fragment key={bet.id}>
                        {renderBox(x1, y1, x2, y2, style)}
                    </React.Fragment>
                );
            })}
            */}
        </div>
    );
};
