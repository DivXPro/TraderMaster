import React, { useEffect, useState, useRef } from 'react';
import type { IChartApi, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts';
import type { Bet as BetBox } from '@trader-master/shared';

interface GameOverlayProps {
    chart: IChartApi;
    series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
    socket: any;
}

interface Point {
    x: number;
    y: number;
}

export const GameOverlay: React.FC<GameOverlayProps> = ({ chart, series, socket }) => {
    const [isDrawing, setIsDrawing] = useState(false);
    const [startPoint, setStartPoint] = useState<Point | null>(null);
    const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
    const [bets, setBets] = useState<BetBox[]>([]);
    const overlayRef = useRef<HTMLDivElement>(null);

    // Sync bets position on chart scroll/zoom
    const [, setRenderTrigger] = useState(0);

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
