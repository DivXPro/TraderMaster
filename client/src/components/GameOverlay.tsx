import React, { useEffect, useState, useRef } from 'react';
import type { IChartApi, ISeriesApi, ITimeScaleApi, Time, UTCTimestamp } from 'lightweight-charts';
import { Socket } from 'socket.io-client';
import type { Bet as BetBox } from '@trader-master/shared';

interface GameOverlayProps {
    chart: IChartApi;
    series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
    socket: Socket;
    lastTime: number | null;
}


export const GameOverlay: React.FC<GameOverlayProps> = ({ chart, series, socket, lastTime }) => {
    const [bets, setBets] = useState<BetBox[]>([]);
    const overlayRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // Grid settings
    const TIME_GRID_STEP = 60; // seconds
    const PRICE_GRID_STEP = 0.5;

    // Sync bets position on chart scroll/zoom
    const [renderTrigger, setRenderTrigger] = useState(0);

    const drawGridColumn = (
        ctx: CanvasRenderingContext2D,
        series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">,
        t: number,
        pStart: number,
        pEnd: number,
        x1: number,
        x2: number,
        lastTime: number | null
    ) => {
        // Skip if width is too small or invalid
        if (x2 <= x1) return;
        
        const w = x2 - x1;
        
        // Determine Color
        // If t < lastTime (past) -> Gray
        // If t >= lastTime (future) -> Green
        const isFuture = lastTime !== null && t >= lastTime;
        const fillStyle = isFuture ? 'rgba(0, 255, 0, 0.1)' : 'rgba(128, 128, 128, 0.3)';
        
        ctx.fillStyle = fillStyle;

        for (let p = pStart; p <= pEnd; p += PRICE_GRID_STEP) {
            const y1 = series.priceToCoordinate(p);
            const y2 = series.priceToCoordinate(p + PRICE_GRID_STEP);
            
            if (y1 === null || y2 === null) continue;
            
            const rY = Math.min(y1, y2);
            const rH = Math.abs(y1 - y2);
            
            // Draw with 1px gap to look like grid
            ctx.fillRect(x1 + 1, rY + 1, w - 2, rH - 2);
        }
    };

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
            drawGridColumn(ctx, series, t, pStart, pEnd, x1, x2, lastTime);
            
            // Prepare for next iteration
            t = nextT;
            x1 = x2;
        }
    }, [chart, series, lastTime]);

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
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1 }}
            />

            {/* Active Bets */}
            {bets.map(bet => {
                const x1 = chart.timeScale().timeToCoordinate(bet.startTime as Time);
                const x2 = chart.timeScale().timeToCoordinate(bet.endTime as Time);
                const y1 = series.priceToCoordinate(bet.highPrice);
                const y2 = series.priceToCoordinate(bet.lowPrice);

                // Skip if coordinates are null (out of view or invalid)
                if (x1 === null || x2 === null || y1 === null || y2 === null) return null;

                let color = 'rgba(255, 215, 0, 0.3)'; // Pending: Gold
                if (bet.status === 'won') color = 'rgba(0, 255, 0, 0.4)';
                if (bet.status === 'lost') color = 'rgba(255, 0, 0, 0.4)';

                return (
                    <React.Fragment key={bet.id}>
                        {renderBox(x1, y1, x2, y2, { 
                            backgroundColor: color,
                            border: '1px solid rgba(255,255,255,0.5)'
                        })}
                    </React.Fragment>
                );
            })}
        </div>
    );
};
