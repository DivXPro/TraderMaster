import React, { useEffect, useState, useRef } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp, Coordinate } from 'lightweight-charts';
import type { BetData as BetBox, PredictionCellData } from '@trader-master/shared';
import { Application, Graphics, Text, TextStyle, Container } from 'pixi.js';
import { bsCallPrice, bsPutPrice, RISK_FREE_RATE, VOLATILITY } from '../utils/pricing';

interface GridCanvasProps {
    chart: IChartApi;
    series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;
    bets: BetBox[];
    predictionCells: PredictionCellData[];
    balance: number;
    lastTime: number | null;
    lastPrice: number | null;
}

export const GridCanvas: React.FC<GridCanvasProps> = ({ chart, series, bets, predictionCells, balance, lastTime, lastPrice }) => {
    const overlayRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<Application | null>(null);
    const gridGraphicsRef = useRef<Graphics | null>(null);
    const textContainerRef = useRef<Container | null>(null);
    
    const [pixiReady, setPixiReady] = useState(false);
    
    // Sync bets position on chart scroll/zoom
    const [renderTrigger, setRenderTrigger] = useState(0);

    // Initialize Pixi Application
    useEffect(() => {
        if (!overlayRef.current) return;

        const initPixi = async () => {
            console.log('Initializing PixiJS Application...');
            const app = new Application();
            await app.init({ 
                // resizeTo: overlayRef.current!, // Removed to avoid conflict with manual resize
                backgroundAlpha: 0,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true,
                antialias: true
            });
            
            console.log('PixiJS Initialized');

            if (overlayRef.current) {
                overlayRef.current.appendChild(app.canvas);
            }
            
            // Create Graphics for Grid
            const graphics = new Graphics();
            app.stage.addChild(graphics);
            gridGraphicsRef.current = graphics;

            // Create Container for Text
            const textContainer = new Container();
            app.stage.addChild(textContainer);
            textContainerRef.current = textContainer;

            appRef.current = app;
            setPixiReady(true);
        };

        initPixi();

        return () => {
            if (appRef.current) {
                appRef.current.destroy(true);
                appRef.current = null;
            }
        };
    }, []);

    // Grid Drawing Logic
    const drawGrid = React.useCallback(() => {
        if (!pixiReady || !appRef.current || !gridGraphicsRef.current || !textContainerRef.current) return;
        
        const app = appRef.current;
        const graphics = gridGraphicsRef.current;
        const textContainer = textContainerRef.current;
        const overlay = overlayRef.current;
        
        if (!overlay) return;

        // Get chart dimensions including scales
        const priceScaleWidth = chart.priceScale('right').width();
        const timeScaleHeight = chart.timeScale().height();

        // Resize canvas to match overlay but exclude scales
        // We assume overlay is 100% width/height of the container
        const width = overlay.clientWidth - priceScaleWidth;
        const height = overlay.clientHeight - timeScaleHeight;
        
        // Debug dimensions
        // console.log('DrawGrid:', width, height, 'PixiReady:', pixiReady);

        if (width <= 0 || height <= 0) return;

        // Resize Pixi app if needed
        if (app.canvas.width !== width * window.devicePixelRatio || app.canvas.height !== height * window.devicePixelRatio) {
            console.log('Pixi Resize:', width, height, 'Overlay:', overlay.clientWidth, overlay.clientHeight);
            app.renderer.resize(width, height);
            app.canvas.style.width = `${width}px`;
            app.canvas.style.height = `${height}px`;
            app.canvas.style.position = 'absolute';
            app.canvas.style.top = '0';
            app.canvas.style.left = '0';
        }

        // Clear Graphics
        graphics.clear();
        
        // Manage Text Reuse
        const existingTexts = textContainer.children as Text[];
        let textIndex = 0;

        const getText = (content: string, style: TextStyle) => {
            let text = existingTexts[textIndex];
            if (text) {
                text.text = content;
                text.style = style;
                text.visible = true;
            } else {
                text = new Text({ text: content, style });
                textContainer.addChild(text);
            }
            textIndex++;
            return text;
        };

        // Find visible time range by sampling pixels
        const timeScale = chart.timeScale();
        
        // Check if chart is ready (has data and visible range)
        if (timeScale.getVisibleLogicalRange() === null) return;
        
        // Sample start time
        const startTime = timeScale.coordinateToTime(0) as number | null;
        
        if (startTime === null) return;

        // Create Map for efficient bet lookup
        const betsMap = new Map<string, BetBox>();
        bets.forEach(bet => {
            if (bet.cellId) betsMap.set(bet.cellId, bet);
        });

        // Calculate reference parameters for time projection
        let refTime: number | null = null;
        let refLogical: number | null = null;
        let avgInterval = 1; // Default 1s
        
        const logicalRange = timeScale.getVisibleLogicalRange();
        if (logicalRange) {
            // Find two points to estimate interval and establish reference
            // We search for valid data points within the visible range (or slightly before/after)
            // We prefer points that are integers (likely bar centers)
            
            let p1: { time: number, logical: number } | null = null;
            let p2: { time: number, logical: number } | null = null;

            // Scan a few points to find valid times
            // Start from the "current" end of data if possible, or just scan visible range
            const startScan = Math.floor(logicalRange.from);
            const endScan = Math.ceil(logicalRange.to);
            
            for (let i = startScan; i <= endScan; i++) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const coord = timeScale.logicalToCoordinate(i as any);
                if (coord !== null) {
                    const t = timeScale.coordinateToTime(coord);
                    if (typeof t === 'number') {
                        if (!p1) {
                            p1 = { time: t, logical: i };
                        } else if (i > p1.logical + 2) { // Ensure some distance
                            p2 = { time: t, logical: i };
                            break; // Found two points
                        }
                    }
                }
            }

            if (p1) {
                refTime = p1.time;
                refLogical = p1.logical;
                
                if (p2) {
                    avgInterval = (p2.time - p1.time) / (p2.logical - p1.logical);
                }
            }
        }
        
        // Debug
        // console.log('Ref:', refTime, refLogical, 'Interval:', avgInterval);

        predictionCells.forEach(cell => {
            let x1 = timeScale.timeToCoordinate(cell.startTime as UTCTimestamp);
            let x2 = timeScale.timeToCoordinate(cell.endTime as UTCTimestamp);
            const y1 = series.priceToCoordinate(cell.highPrice);
            const y2 = series.priceToCoordinate(cell.lowPrice);

            // Project x1 if null (future)
            if (x1 === null && refTime !== null && refLogical !== null) {
                const diffSec = (cell.startTime as number) - refTime;
                const targetLogical = refLogical + (diffSec / avgInterval);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                x1 = timeScale.logicalToCoordinate(targetLogical as any);
            }

            // Project x2 if null (future)
            if (x2 === null && refTime !== null && refLogical !== null) {
                const diffSec = (cell.endTime as number) - refTime;
                const targetLogical = refLogical + (diffSec / avgInterval);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                x2 = timeScale.logicalToCoordinate(targetLogical as any);
            }

            if (x1 === null || x2 === null || y1 === null || y2 === null) return;

            // Skip if completely off-screen
            if (x2 < 0 || x1 > width) return;

            const w = x2 - x1;
            const h = Math.abs(y2 - y1);
            const rY = Math.min(y1, y2);

            // Determine Time Status
            let isPast = false;
            let isLocked = false;
            
            if (lastTime !== null) {
                if (cell.startTime < lastTime) {
                    isPast = true;
                } else if (cell.startTime <= lastTime + 10) {
                    isLocked = true;
                }
            }

            // Default Styles
            let defaultFillColor = 0x000000;
            let defaultFillAlpha = 0;
            let defaultStrokeColor = 0x00FF00;
            let defaultStrokeAlpha = 0.3;
            const defaultTextColor = '#ffffff'; // White text
            let defaultTextAlpha = 0.6;

            if (isPast) {
                defaultFillColor = 0x808080;
                defaultFillAlpha = 0.05;
                defaultStrokeColor = 0x808080;
                defaultStrokeAlpha = 0.1;
                defaultTextAlpha = 0.1;
            } else if (isLocked) {
                defaultFillColor = 0x3C3C3C;
                defaultFillAlpha = 0.5;
                defaultStrokeColor = 0x3C3C3C;
                defaultStrokeAlpha = 0.8;
                defaultTextAlpha = 0.2;
            }

            const bet = betsMap.get(cell.id);

            let fillColor = defaultFillColor;
            let fillAlpha = defaultFillAlpha;
            let strokeColor = defaultStrokeColor;
            let strokeAlpha = defaultStrokeAlpha;
            
            let textAlpha = defaultTextAlpha;
            let textColor = defaultTextColor;

            if (bet) {
                    if (bet.status === 'won') {
                        fillColor = 0x2ECC71; // Green
                        fillAlpha = 0.3;
                        strokeColor = 0x2ECC71;
                        strokeAlpha = 1;
                    } else if (bet.status === 'lost') {
                        fillColor = 0xE74C3C; // Red
                        fillAlpha = 0.3;
                        strokeColor = 0xE74C3C;
                        strokeAlpha = 0.8;
                    } else {
                        // Pending: Gold
                        fillColor = 0xFFD700;
                        fillAlpha = 0.2;
                        strokeColor = 0xFFD700;
                        strokeAlpha = 0.8;
                    }
                    textAlpha = 1; // Highlight text
                    textColor = '#ffffff';
            }

            // Draw Rect
            graphics.rect(x1 + 1, rY + 1, w - 2, h - 2);
            graphics.fill({ color: fillColor, alpha: fillAlpha });
            graphics.stroke({ color: strokeColor, alpha: strokeAlpha, width: 1 });

            // Option Pricing or Probability Display
            // Use cell.probability if available, otherwise calculate option price (fallback or for reference)
            
            // For now, let's display the probability from the cell if available
            let displayText = '';
            if (cell.probability !== undefined) {
                displayText = (cell.probability * 100).toFixed(1) + '%';
            } else {
                // Fallback to BS model if probability not sent
                const midPrice = (cell.highPrice + cell.lowPrice) / 2;
                const maturitySec = lastTime !== null ? cell.endTime - lastTime : (cell.endTime - cell.startTime);
                const T = Math.max(maturitySec, 0) / (365 * 24 * 3600);
                
                const S = lastPrice !== null ? lastPrice : midPrice;
                const K = midPrice;
                
                const optionPrice = K < S 
                    ? bsCallPrice(S, K, RISK_FREE_RATE, VOLATILITY, T)
                    : bsPutPrice(S, K, RISK_FREE_RATE, VOLATILITY, T);
                displayText = optionPrice.toFixed(4);
            }

            const textStyle = new TextStyle({
                fontFamily: 'sans-serif',
                fontSize: 10,
                fill: textColor,
                align: 'center',
            });

            const textObj = getText(displayText, textStyle);
            textObj.alpha = textAlpha;
            textObj.anchor.set(0.5);
            textObj.x = x1 + w / 2;
            textObj.y = rY + h / 2;
        });
        
        // Hide unused text objects
        for (let i = textIndex; i < existingTexts.length; i++) {
            existingTexts[i].visible = false;
        }

    }, [pixiReady, chart, bets, predictionCells, series, lastTime, lastPrice]);

    useEffect(() => {
        drawGrid();
    }, [drawGrid, renderTrigger]); // Add renderTrigger

    useEffect(() => {
        const handleTimeScaleChange = () => {
            setRenderTrigger(prev => prev + 1);
        };

        chart.timeScale().subscribeVisibleLogicalRangeChange(handleTimeScaleChange);
        chart.timeScale().subscribeVisibleTimeRangeChange(handleTimeScaleChange);
        chart.timeScale().subscribeSizeChange(handleTimeScaleChange);

        return () => {
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleTimeScaleChange);
            chart.timeScale().unsubscribeVisibleTimeRangeChange(handleTimeScaleChange);
            chart.timeScale().unsubscribeSizeChange(handleTimeScaleChange);
        };
    }, [chart]);

    return (
        <div 
            ref={overlayRef}
            className="grid-canvas-overlay"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}
        />
    );
};
