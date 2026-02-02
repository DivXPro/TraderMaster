import React, { useEffect, useState, useRef } from 'react';
import type { IChartApi, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts';
import type { Bet as BetBox } from '@trader-master/shared';

interface GameOverlayProps {
    chart: IChartApi;
    series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
    socket: any;
    lastTime: number | null;
}

interface Point {
    x: number;
    y: number;
}

export const GameOverlay: React.FC<GameOverlayProps> = ({ chart, series, socket, lastTime }) => {
    const [isDrawing, setIsDrawing] = useState(false);
    const [startPoint, setStartPoint] = useState<Point | null>(null);
    const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
    const [bets, setBets] = useState<BetBox[]>([]);
    const overlayRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    // Grid settings
    const TIME_GRID_STEP = 10; // seconds
    const PRICE_GRID_STEP = 0.01;

    // Sync bets position on chart scroll/zoom
    const [renderTrigger, setRenderTrigger] = useState(0);

    // Grid Drawing Logic
    const drawGrid = React.useCallback(() => {
        const canvas = canvasRef.current;
        const overlay = overlayRef.current;
        if (!canvas || !overlay) return;

        // Resize canvas to match overlay
        const width = overlay.clientWidth;
        const height = overlay.clientHeight;
        
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
        const widthPx = width; // logical width
        
        // Sample start and end time
        // Note: coordinateToTime returns null if not in data? 
        // We'll check visible logical range first to be safe, but coordinateToTime is easier for pixels.
        const startTime = timeScale.coordinateToTime(0) as number | null;
        const endTime = timeScale.coordinateToTime(widthPx) as number | null;
        
        if (startTime === null || endTime === null) return;

        // Align to grid step
        const tStart = Math.floor(startTime / TIME_GRID_STEP) * TIME_GRID_STEP;
        const tEnd = Math.ceil(endTime / TIME_GRID_STEP) * TIME_GRID_STEP;

        // Price range
        const priceTop = series.coordinateToPrice(0);
        const priceBottom = series.coordinateToPrice(height);
        
        if (priceTop === null || priceBottom === null) return;
        
        const pMax = Math.max(priceTop, priceBottom);
        const pMin = Math.min(priceTop, priceBottom);
        
        const pStart = Math.floor(pMin / PRICE_GRID_STEP) * PRICE_GRID_STEP;
        const pEnd = Math.ceil(pMax / PRICE_GRID_STEP) * PRICE_GRID_STEP;

        // Draw Rects
        for (let t = tStart; t <= tEnd; t += TIME_GRID_STEP) {
            const x1 = timeScale.timeToCoordinate(t as UTCTimestamp);
            const x2 = timeScale.timeToCoordinate((t + TIME_GRID_STEP) as UTCTimestamp);
            
            // Skip if completely invalid
            if (x1 === null && x2 === null) continue;
            
            // Handle partial visibility or future
            const finalX1 = x1;
            let finalX2 = x2;
            
            if (finalX1 === null) {
                // Try to recover? Maybe off-screen left.
                // If t is within [tStart, tEnd], it should be near screen.
                continue; 
            }
            if (finalX2 === null) {
                // Likely off-screen right. Use canvas width?
                // Or calculate based on average width?
                // Let's just use canvas width + margin to be safe.
                finalX2 = (widthPx + 100) as any; 
            }

            const w = (finalX2 as number) - (finalX1 as number);
            
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
                ctx.fillRect(finalX1 + 1, rY + 1, w - 2, rH - 2);
            }
        }
    }, [chart, series, lastTime, renderTrigger]);

    useEffect(() => {
        drawGrid();
    }, [drawGrid]);

    useEffect(() => {
        const handleTimeScaleChange = () => {
            setRenderTrigger(prev => prev + 1);
        };

        chart.timeScale().subscribeVisibleLogicalRangeChange(handleTimeScaleChange);
        chart.timeScale().subscribeVisibleTimeRangeChange(handleTimeScaleChange);

        socket.on('bet_placed', (bet: BetBox) => {
            setBets(prev => [...prev, bet]);
        });
        
        socket.on('bet_update', (updatedBet: BetBox) => {
             setBets(prev => prev.map(b => b.id === updatedBet.id ? updatedBet : b));
        });

        return () => {
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleTimeScaleChange);
            chart.timeScale().unsubscribeVisibleTimeRangeChange(handleTimeScaleChange);
            socket.off('bet_placed');
            socket.off('bet_update');
        };
    }, [chart, socket]);

    const handleMouseDown = (e: React.MouseEvent) => {
        const rect = overlayRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        setIsDrawing(true);
        setStartPoint({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        });
        setCurrentPoint({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDrawing) return;
        const rect = overlayRef.current?.getBoundingClientRect();
        if (!rect) return;

        setCurrentPoint({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        });
    };

    const handleMouseUp = () => {
        if (!isDrawing || !startPoint || !currentPoint) {
            setIsDrawing(false);
            return;
        }

        // Convert coordinates to Time/Price
        const startTime = chart.timeScale().coordinateToTime(Math.min(startPoint.x, currentPoint.x)) as UTCTimestamp | null;
        const endTime = chart.timeScale().coordinateToTime(Math.max(startPoint.x, currentPoint.x)) as UTCTimestamp | null;
        
        const price1 = series.coordinateToPrice(startPoint.y);
        const price2 = series.coordinateToPrice(currentPoint.y);

        if (startTime !== null && endTime !== null && price1 !== null && price2 !== null) {
            const bet = {
                startTime: startTime,
                endTime: endTime,
                highPrice: Math.max(price1, price2),
                lowPrice: Math.min(price1, price2)
            };
            console.log("Placing bet:", bet);
            socket.emit('place_bet', bet);
        }

        setIsDrawing(false);
        setStartPoint(null);
        setCurrentPoint(null);
    };

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
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => setIsDrawing(false)}
        >
            <canvas 
                ref={canvasRef}
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: -1 }}
            />

            {/* Drawing Preview */}
            {isDrawing && startPoint && currentPoint && renderBox(
                startPoint.x, startPoint.y, currentPoint.x, currentPoint.y,
                { border: '2px dashed #FFF', backgroundColor: 'rgba(255, 255, 255, 0.1)' }
            )}

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
