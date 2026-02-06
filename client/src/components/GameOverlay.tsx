import React, { useEffect, useState, useRef } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp, MouseEventParams } from 'lightweight-charts';
import { Socket } from 'socket.io-client';
import type { Bet as BetBox } from '@trader-master/shared';
import { bsCallPrice, bsPutPrice, RISK_FREE_RATE, VOLATILITY } from '../utils/pricing';
import { Application, Graphics, Text, TextStyle, Container } from 'pixi.js';

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

export const GameOverlay: React.FC<GameOverlayProps> = ({ chart, series, socket, lastTime, lastPrice }) => {
    const [bets, setBets] = useState<BetBox[]>([]);
    const overlayRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<Application | null>(null);
    const gridGraphicsRef = useRef<Graphics | null>(null);
    const textContainerRef = useRef<Container | null>(null);
    
    const [pixiReady, setPixiReady] = useState(false);
    
    // Sync bets position on chart scroll/zoom
    const [renderTrigger, setRenderTrigger] = useState(0);

    // Use ref to access latest lastTime in event listener without re-binding
    const lastTimeRef = useRef(lastTime);
    useEffect(() => {
        lastTimeRef.current = lastTime;
    }, [lastTime]);

    // Initialize Pixi Application
    useEffect(() => {
        if (!overlayRef.current) return;

        const initPixi = async () => {
            const app = new Application();
            await app.init({ 
                // resizeTo: overlayRef.current!, // Removed to avoid conflict with manual resize
                backgroundAlpha: 0,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true,
                antialias: true
            });
            
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

        const getText = (content: string, style: any) => {
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

        const widthPx = width; // logical width
        
        // Sample start time
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
        let x1: number | null = timeScale.timeToCoordinate(t as UTCTimestamp);
        
        // If initial x1 is null (maybe slightly off screen), project from startTime
        if (x1 === null && xStart !== null) {
             const timeDiff = t - startTime;
             x1 = xStart + (timeDiff / TIME_GRID_STEP) * gridWidth;
        }
        
        if (x1 === null) x1 = 0;

        let safety = 0;
        while (x1 < widthPx && safety++ < 1000) {
            const nextT = t + TIME_GRID_STEP;
            let x2: number | null = timeScale.timeToCoordinate(nextT as UTCTimestamp);
            
            if (x2 === null) {
                x2 = x1 + gridWidth;
            }
            
            // Draw Column
            if (x2 > x1) {
                const w = x2 - x1;
                
                // Determine Time Status
                let isPast = false;
                let isLocked = false;
                
                if (lastTime !== null) {
                    if (t < lastTime) {
                        isPast = true;
                    } else if (t <= lastTime + 10) {
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

                for (let p = pStart; p <= pEnd; p += PRICE_GRID_STEP) {
                    const y1 = series.priceToCoordinate(p);
                    const y2 = series.priceToCoordinate(p + PRICE_GRID_STEP);
                    
                    if (y1 === null || y2 === null) continue;
                    
                    const rY = Math.min(y1, y2);
                    const rH = Math.abs(y1 - y2);
                    
                    // Generate unique ID for this grid cell
                    const cellId = getGridId(t, p);
                    const bet = betsMap.get(cellId);

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
                             // shadow equivalent?
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
                    graphics.rect(x1 + 1, rY + 1, w - 2, rH - 2);
                    graphics.fill({ color: fillColor, alpha: fillAlpha });
                    graphics.stroke({ color: strokeColor, alpha: strokeAlpha, width: 1 });

                    // Option Pricing
                    const midPrice = p + PRICE_GRID_STEP / 2;
                    const maturitySec = lastTime !== null ? (t + TIME_GRID_STEP) - lastTime : TIME_GRID_STEP;
                    const T = Math.max(maturitySec, 0) / (365 * 24 * 3600);
                    
                    const S = lastPrice !== null ? lastPrice : midPrice;
                    const K = midPrice;
                    
                    const optionPrice = K < S 
                        ? bsCallPrice(S, K, RISK_FREE_RATE, VOLATILITY, T)
                        : bsPutPrice(S, K, RISK_FREE_RATE, VOLATILITY, T);

                    const textStyle = new TextStyle({
                        fontFamily: 'sans-serif',
                        fontSize: 10,
                        fill: textColor,
                        align: 'center',
                    });

                    const textObj = getText(optionPrice.toFixed(4), textStyle);
                    textObj.alpha = textAlpha;
                    textObj.anchor.set(0.5);
                    textObj.x = x1 + w / 2;
                    textObj.y = rY + rH / 2;
                }
            }

            // Prepare for next iteration
            t = nextT;
            x1 = x2;
        }
        
        // Hide unused text objects
        for (let i = textIndex; i < existingTexts.length; i++) {
            existingTexts[i].visible = false;
        }

    }, [chart, series, lastTime, lastPrice, bets, pixiReady]);

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

    return (
        <div 
            ref={overlayRef}
            className="game-overlay"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
    );
};
