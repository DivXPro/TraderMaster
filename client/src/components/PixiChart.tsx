import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Application, Container, Graphics, Text, FederatedPointerEvent } from 'pixi.js';
import type { Candle, BetData, PredictionCellData, MarketRoomConfig } from '@trader-master/shared';

// const RECENT_SETTLEMENT_WINDOW = 20;

export interface ChartViewport {
    offsetX: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
}

export interface ChartRef {
    setViewport: (viewport: Partial<ChartViewport>) => void;
    getViewport: () => ChartViewport;
    resetView: () => void;
}

// Helper to find nice step size for price
const getNicePriceStep = (minPrice: number, maxPrice: number, height: number) => {
    const range = maxPrice - minPrice;
    if (range <= 0) return 1;
    const minSpacing = 50; // min pixels between grid lines
    const rawStep = range * minSpacing / height;
    
    // Find magnitude
    const mag = Math.floor(Math.log10(rawStep));
    const base = Math.pow(10, mag);
    const residual = rawStep / base;
    
    if (residual > 5) return 10 * base;
    if (residual > 2) return 5 * base;
    if (residual > 1) return 2 * base;
    return base;
};

// Helper for time steps
const TIME_STEPS = [
    1, 2, 5, 10, 15, 30, // seconds
    60, 120, 300, 600, 900, 1800, // minutes
    3600, 7200, 14400, 21600, 43200, // hours
    86400, 172800, 604800 // days
];

const getNextPriceStep = (currentStep: number) => {
    const mag = Math.floor(Math.log10(currentStep));
    const base = currentStep / Math.pow(10, mag);
    
    let normalizedBase = 1;
    if (base >= 1.9 && base <= 2.1) normalizedBase = 2;
    else if (base >= 4.9 && base <= 5.1) normalizedBase = 5;
    
    if (normalizedBase === 1) return 2 * Math.pow(10, mag);
    if (normalizedBase === 2) return 5 * Math.pow(10, mag);
    if (normalizedBase === 5) return 1 * Math.pow(10, mag + 1);
    return currentStep * 2;
};

const getPrevPriceStep = (currentStep: number) => {
    const mag = Math.floor(Math.log10(currentStep));
    const base = currentStep / Math.pow(10, mag);
    
    let normalizedBase = 1;
    if (base >= 1.9 && base <= 2.1) normalizedBase = 2;
    else if (base >= 4.9 && base <= 5.1) normalizedBase = 5;

    if (normalizedBase === 1) return 5 * Math.pow(10, mag - 1);
    if (normalizedBase === 2) return 1 * Math.pow(10, mag);
    if (normalizedBase === 5) return 2 * Math.pow(10, mag);
    return currentStep / 2;
};

const formatPriceLabel = (price: number, step: number) => {
    if (step >= 1) return price.toFixed(0);
    const decimals = Math.ceil(-Math.log10(step));
    return price.toFixed(Math.max(0, decimals));
};

const getNextTimeStep = (currentStep: number) => {
    // Find closest
    let idx = -1;
    let minDiff = Infinity;
    for(let i=0; i<TIME_STEPS.length; i++) {
        const diff = Math.abs(TIME_STEPS[i] - currentStep);
        if (diff < minDiff) {
            minDiff = diff;
            idx = i;
        }
    }
    
    if (idx >= 0 && idx < TIME_STEPS.length - 1) return TIME_STEPS[idx + 1];
    return currentStep * 2;
};

const getPrevTimeStep = (currentStep: number) => {
    let idx = -1;
    let minDiff = Infinity;
    for(let i=0; i<TIME_STEPS.length; i++) {
        const diff = Math.abs(TIME_STEPS[i] - currentStep);
        if (diff < minDiff) {
            minDiff = diff;
            idx = i;
        }
    }
    
    if (idx > 0) return TIME_STEPS[idx - 1];
    return currentStep / 2;
};

const getNiceTimeStep = (minTime: number, maxTime: number, width: number) => {
    const range = maxTime - minTime;
    if (range <= 0) return 1;
    const minSpacing = 100; // min pixels between time labels
    const rawStep = range * minSpacing / width;
    
    for (const step of TIME_STEPS) {
        if (step >= rawStep) return step;
    }
    return TIME_STEPS[TIME_STEPS.length - 1];
};

interface PixiChartProps {
    data: Candle[];
    bets: BetData[];
    predictionCells: PredictionCellData[];
    chartMode: 'line' | 'candlestick';
    roomConfig: MarketRoomConfig | null;
    lastTime: number | null;
    lastPrice: number | null;
    onCellClick?: (cellId: string) => void;
}

export const PixiChart = forwardRef<ChartRef, PixiChartProps>(({
    data,
    bets,
    predictionCells,
    chartMode,
    roomConfig,
    // lastTime,
    // lastPrice,
    onCellClick
}, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<Application | null>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Viewport state
    const viewportRef = useRef({
        offsetX: 0,
        offsetY: 0,
        scaleX: 10,
        scaleY: -10, // Negative because Y axis is inverted in screen coords
        initialized: false,
        autoScaleY: true // Default to auto-scaling price
    });
    
    // Store handlers in ref to access latest in Pixi events
    const handlersRef = useRef({ onCellClick });
    handlersRef.current = { onCellClick };

    // Store data in ref to access latest in Pixi events/draw loop
    const dataRef = useRef({ predictionCells, bets, data, chartMode });
    dataRef.current = { predictionCells, bets, data, chartMode };

    // Pixi Containers & Graphics
    const refs = useRef<{
        mainContainer: Container | null;
        gridGraphics: Graphics | null;
        axisGraphics: Graphics | null;
        candleGraphics: Graphics | null;
        cellGraphics: Graphics | null;
        textContainer: Container | null;
        axisTextContainer: Container | null;
        priceAxisHitArea: Graphics | null;
        timeAxisHitArea: Graphics | null;
    }>({
        mainContainer: null,
        gridGraphics: null,
        axisGraphics: null,
        candleGraphics: null,
        cellGraphics: null,
        textContainer: null,
        axisTextContainer: null,
        priceAxisHitArea: null,
        timeAxisHitArea: null,
    });
    
    // Axis State for Hysteresis
    const axisStateRef = useRef({
        priceStep: 0,
        timeStep: 0
    });

    // Coordinate Conversion Helpers
    const timeToX = (time: number) => {
        const { offsetX, scaleX } = viewportRef.current;
        return offsetX + time * scaleX;
    };
    
    const xToTime = (x: number) => {
        const { offsetX, scaleX } = viewportRef.current;
        return (x - offsetX) / scaleX;
    };

    const priceToY = (price: number) => {
        const { offsetY, scaleY } = viewportRef.current;
        return offsetY + price * scaleY;
    };
    
    const yToPrice = (y: number) => {
        const { offsetY, scaleY } = viewportRef.current;
        return (y - offsetY) / scaleY;
    };

    // Helper to calculate ideal scaleX to fit N columns in available width
    const getScaleXForColumns = useCallback((columns: number, width: number) => {
        const paddingX = width * 0.1; // 10% padding
        const availableWidth = width - paddingX;
        // Each column is predictionDuration seconds
        const duration = roomConfig?.predictionDuration || 30;
        const totalTime = columns * duration;
        return availableWidth / totalTime;
    }, [roomConfig]);

    // Helper to calculate ideal scaleY to fit M layers in available height
    const getScaleYForLayers = useCallback((layers: number, height: number) => {
        const paddingY = height * 0.1; // 10% padding
        const availableHeight = height - paddingY;
        // Each layer is predictionPriceHeight units
        const priceHeight = roomConfig?.predictionPriceHeight || 10; // Default 10 to match server template
        // predictionLayers usually means N layers up AND N layers down, so total is 2 * N
        const totalHeight = layers * 2 * priceHeight;
        return -availableHeight / totalHeight; // Negative for Y-up
    }, [roomConfig]);

    const autoScale = useCallback((currentData: Candle[]) => {
        if (!appRef.current || currentData.length === 0) return;
        
        const width = appRef.current.screen.width;
        const height = appRef.current.screen.height;

        // Use room configuration if available
        if (roomConfig) {
            const layers = roomConfig.predictionLayers || 6; // Default 6 layers (was 12)
            const initialColumns = roomConfig.predictionInitialColumns || 8; // Default 8 columns
            const priceHeight = roomConfig.predictionPriceHeight || 10;
            const duration = roomConfig.predictionDuration || 30;
            
            console.log('[PixiChart] AutoScaling with config:', { layers, initialColumns, roomConfig });

            // 1. Calculate Scale Y based on layers (Primary constraint: fit layers in height)
            const scaleY = getScaleYForLayers(layers, height); // Use layers directly? Or 2 * layers?

            // 2. Calculate Scale X to enforce square aspect ratio
            // unitHeight = priceHeight * abs(scaleY)
            // unitWidth = duration * scaleX
            // unitHeight = unitWidth => scaleX = (priceHeight * abs(scaleY)) / duration
            const unitHeightPixels = priceHeight * Math.abs(scaleY);
            const scaleX = unitHeightPixels / duration;
            
            console.log('[PixiChart] Enforcing Square Aspect Ratio:', { scaleY, scaleX, unitHeightPixels });

            // ...
            
            // Center Price: Use last close price or middle of range
            const lastClose = currentData[currentData.length - 1].close;
            const centerY = height / 2;
            const offsetY = centerY - lastClose * scaleY;
            
            // Align Time: Put latest time at the center (50% of width)
            const lastTime = currentData[currentData.length - 1].time;
            // Place last candle at 50% of width to leave room for future predictions
            const targetX = width * 0.5;
            const offsetX = targetX - lastTime * scaleX;

            viewportRef.current = {
                ...viewportRef.current,
                scaleX,
                scaleY,
                offsetX,
                offsetY,
                initialized: true,
                autoScaleY: false // Disable auto-scale when using config-based initial view
            };
            return;
        }

        // Fallback to data-based auto-scaling if no config
        // Calculate Price Range
        let minPrice = Infinity;
        let maxPrice = -Infinity;
        
        // Use visible data or all data? 
        // For autoScale usually all data or a subset. Let's use last 100 candles.
        const subset = currentData.slice(-100);
        subset.forEach(c => {
            if (c.low < minPrice) minPrice = c.low;
            if (c.high > maxPrice) maxPrice = c.high;
        });

        // Include prediction cells in the price range calculation
        // We use dataRef.current because predictionCells might not be in the dependency array or arguments
        const cells = dataRef.current?.predictionCells || [];
        if (subset.length > 0) {
            const minTime = subset[0].time;
            const relevantCells = cells.filter(cell => cell.endTime >= minTime);
            relevantCells.forEach(cell => {
                if (cell.lowPrice < minPrice) minPrice = cell.lowPrice;
                if (cell.highPrice > maxPrice) maxPrice = cell.highPrice;
            });
        }
        
        if (minPrice === Infinity) { minPrice = 0; maxPrice = 100; }
        const priceRange = maxPrice - minPrice || 1;
        
        // Calculate Time Range
        const minTime = subset[0].time;
        const maxTime = subset[subset.length - 1].time;
        // const timeRange = maxTime - minTime || 1;

        // Setup Y Scale
        const paddingY = height * 0.2;
        const availableHeight = height - paddingY;
        const scaleY = -availableHeight / priceRange; // Negative for Y-up
        
        // Center Y
        const centerPrice = (minPrice + maxPrice) / 2;
        const centerY = height / 2;
        const offsetY = centerY - centerPrice * scaleY;

        // Setup X Scale
        // Fit subset in width with some padding
        const paddingX = width * 0.1;
        const availableWidth = width - paddingX;
        // We want candles to have a certain width, say 10px minimum
        // or fit all subset. Let's fit subset.
        // const scaleX = availableWidth / (maxTime - minTime || 1);
        
        // Better: fixed candle width based on subset size
        const scaleX = availableWidth / (subset.length * 1); // assuming 1s interval?
        // Actually time is in seconds.
        const timeSpan = maxTime - minTime || 1;
        const computedScaleX = availableWidth / timeSpan;
        
        // Align latest time to right
        const offsetX = (width - paddingX/2) - maxTime * computedScaleX;

        viewportRef.current = {
            ...viewportRef.current,
            scaleX: computedScaleX,
            scaleY,
            offsetX,
            offsetY,
            initialized: true
        };
    }, []);

    // Initial Setup
    useEffect(() => {
        if (!containerRef.current) return;

        const initPixi = async () => {
            const app = new Application();
            await app.init({
                background: '#1E1E1E',
                resizeTo: containerRef.current!,
                antialias: true,
                resolution: Math.max(1, window.devicePixelRatio || 1),
                autoDensity: true,
            });

            if (containerRef.current) {
                containerRef.current.appendChild(app.canvas);
            }

            // Create Layers
            const mainContainer = new Container();
            const mask = new Graphics();
            mainContainer.mask = mask;
            
            const gridGraphics = new Graphics();
            const cellGraphics = new Graphics();
            const candleGraphics = new Graphics();
            const axisGraphics = new Graphics();
            const textContainer = new Container();
            const axisTextContainer = new Container();
            
            // Interaction Areas
            const priceAxisHitArea = new Graphics();
            const timeAxisHitArea = new Graphics();

            app.stage.addChild(mainContainer);
            app.stage.addChild(mask);
            
            mainContainer.addChild(gridGraphics);
            mainContainer.addChild(cellGraphics);
            mainContainer.addChild(candleGraphics);
            mainContainer.addChild(textContainer);
            
            app.stage.addChild(axisGraphics);
            app.stage.addChild(axisTextContainer);
            app.stage.addChild(priceAxisHitArea);
            app.stage.addChild(timeAxisHitArea);

            // Store refs
            refs.current = {
                mainContainer,
                gridGraphics,
                axisGraphics,
                candleGraphics,
                cellGraphics,
                textContainer,
                axisTextContainer,
                priceAxisHitArea,
                timeAxisHitArea
            };

            appRef.current = app;

            // Interactions
            app.stage.eventMode = 'static';
            app.stage.hitArea = app.screen;
            
            priceAxisHitArea.eventMode = 'static';
            priceAxisHitArea.cursor = 'ns-resize';
            
            timeAxisHitArea.eventMode = 'static';
            timeAxisHitArea.cursor = 'ew-resize';
            
            mainContainer.eventMode = 'static';
            mainContainer.cursor = 'crosshair';

            // State
            let isDraggingChart = false;
            let isDraggingPrice = false;
            let isDraggingTime = false;
            let lastX = 0;
            let lastY = 0;

            // --- Handlers ---

            // 1. Price Axis Interaction
            priceAxisHitArea.on('pointerdown', (e) => {
                isDraggingPrice = true;
                lastY = e.global.y;
                viewportRef.current.autoScaleY = false; // Disable auto-scale on manual interaction
                e.stopPropagation();
            });

            // 2. Time Axis Interaction
            timeAxisHitArea.on('pointerdown', (e) => {
                isDraggingTime = true;
                lastX = e.global.x;
                e.stopPropagation();
            });

            // 3. Chart Area Interaction
            mainContainer.on('pointerdown', (e) => {
                isDraggingChart = true;
                lastX = e.global.x;
                lastY = e.global.y;
                mainContainer.cursor = 'grabbing';
                
                // Check for clicks (cells)
                // We'll handle clicks in pointerup if no drag occurred
            });

            // Global Move
            app.stage.on('pointermove', (e) => {
                if (isDraggingPrice) {
                    const dy = e.global.y - lastY;
                    const sensitivity = 0.002;
                    const scaleFactor = Math.exp(-dy * sensitivity);
                    
                    const chartHeight = app.screen.height - 30;
                    const centerY = chartHeight / 2;
                    // Scale around center of view for smoother feel on axis
                    const oldScaleY = viewportRef.current.scaleY;
                    const priceAtCenter = (centerY - viewportRef.current.offsetY) / oldScaleY;
                    
                    viewportRef.current.scaleY *= scaleFactor;
                    viewportRef.current.offsetY = centerY - priceAtCenter * viewportRef.current.scaleY;
                    
                    lastY = e.global.y;
                } 
                else if (isDraggingTime) {
                    const dx = e.global.x - lastX;
                    const sensitivity = 0.002;
                    const scaleFactor = Math.exp(dx * sensitivity);
                    
                    const chartWidth = app.screen.width - 50;
                    const centerX = chartWidth / 2;
                    // Scale around center of view
                    const oldScaleX = viewportRef.current.scaleX;
                    const tCenter = (centerX - viewportRef.current.offsetX) / oldScaleX;
                    
                    viewportRef.current.scaleX *= scaleFactor;
                    viewportRef.current.offsetX = centerX - tCenter * viewportRef.current.scaleX;

                    lastX = e.global.x;
                } 
                else if (isDraggingChart) {
                    const dx = e.global.x - lastX;
                    const dy = e.global.y - lastY;
                    
                    viewportRef.current.offsetX += dx;
                    
                    // Only pan Y if not in auto-scale mode
                    if (!viewportRef.current.autoScaleY) {
                        viewportRef.current.offsetY += dy;
                    }
                    
                    lastX = e.global.x;
                    lastY = e.global.y;
                }
            });

            const onDragEnd = () => {
                if (isDraggingChart) {
                    // Check for click? 
                    // If movement was small, treat as click
                }
                isDraggingChart = false;
                isDraggingPrice = false;
                isDraggingTime = false;
                mainContainer.cursor = 'crosshair';
            };

            app.stage.on('pointerup', onDragEnd);
            app.stage.on('pointerupoutside', onDragEnd);

            // Wheel Zoom
            app.canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const zoomFactor = 1.1;
                const direction = e.deltaY > 0 ? 1 / zoomFactor : zoomFactor;
                const rect = app.canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                // Check if mouse is over axes
                const width = app.screen.width;
                const height = app.screen.height;
                const isOverPriceAxis = mouseX > width - 50;
                const isOverTimeAxis = mouseY > height - 30;

                if (isOverPriceAxis || e.ctrlKey) {
                    // Zoom Price
                    viewportRef.current.autoScaleY = false;
                    const priceAtMouse = (mouseY - viewportRef.current.offsetY) / viewportRef.current.scaleY;
                    viewportRef.current.scaleY *= direction;
                    viewportRef.current.offsetY = mouseY - priceAtMouse * viewportRef.current.scaleY;
                } else if (isOverTimeAxis || !e.ctrlKey) {
                    // Zoom Time
                    const t = (mouseX - viewportRef.current.offsetX) / viewportRef.current.scaleX;
                    viewportRef.current.scaleX *= direction;
                    viewportRef.current.offsetX = mouseX - t * viewportRef.current.scaleX;
                }
            }, { passive: false });
            
            // Double Click to Reset
            // We can listen to 'dblclick' on canvas and check coordinates
            app.canvas.addEventListener('dblclick', (e) => {
                const rect = app.canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                const width = app.screen.width;
                const height = app.screen.height;

                if (mouseX > width - 50) {
                    // Double click on Price Axis -> Reset / Auto Scale
                    viewportRef.current.autoScaleY = true;
                    autoScale(dataRef.current.data); // Trigger immediate rescale
                } else if (mouseY > height - 30) {
                     // Double click on Time Axis -> Reset Time Scale?
                     // Usually resets to default view or fits all
                     autoScale(dataRef.current.data);
                }
            });

            // Trigger initial resize/draw
            setDimensions({ width: app.screen.width, height: app.screen.height });
        };

        initPixi();

        return () => {
            if (appRef.current) {
                appRef.current.destroy(true, { children: true, texture: true });
                appRef.current = null;
            }
        };
    }, []);

    // Handle Resize
    useEffect(() => {
        const handleResize = () => {
            if (appRef.current && containerRef.current) {
                appRef.current.resize();
                setDimensions({ width: appRef.current.screen.width, height: appRef.current.screen.height });
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // We need to attach/detach this listener when predictionCells changes?
    // Or just use a mutable ref for predictionCells.
    // const dataRef = useRef({ predictionCells, bets, data, chartMode });
    // dataRef.current = { predictionCells, bets, data, chartMode };
    
    // Attach listener to stage? 
    // Since stage is created once, we can use a proxy function.
    useEffect(() => {
        if (!appRef.current) return;
        
        const onDown = (e: FederatedPointerEvent) => {
            // Re-implement click check using refs
            const t = xToTime(e.global.x);
            const p = yToPrice(e.global.y);
            
            const cells = dataRef.current.predictionCells;
            const clickedCell = cells.find(c => 
                t >= c.startTime && t <= c.endTime && 
                p >= c.lowPrice && p <= c.highPrice
            );
            
            if (clickedCell && handlersRef.current.onCellClick) {
                handlersRef.current.onCellClick(clickedCell.id);
            }
        };
        
        // We already added a pointerdown for dragging in initPixi.
        // Let's just add this one too or merge them?
        // Merging is hard because of scope.
        // Let's add it to stage.
        appRef.current.stage.on('pointerdown', onDown);
        
        return () => {
            appRef.current?.stage.off('pointerdown', onDown);
        };
    }, []);

    // Main Draw Loop
    const draw = useCallback(() => {
        if (!appRef.current) return;
        const { data, bets, predictionCells, chartMode } = dataRef.current;
        const r = refs.current;
        const width = appRef.current.screen.width;
        const height = appRef.current.screen.height;
        
        // Define chart area (exclude axes)
        const chartWidth = width - 50;
        const chartHeight = height - 30;

        // Update Hit Areas
        r.priceAxisHitArea?.clear();
        r.priceAxisHitArea?.rect(width - 50, 0, 50, chartHeight);
        r.priceAxisHitArea?.fill({ color: 0x000000, alpha: 0 }); // Transparent hit area

        r.timeAxisHitArea?.clear();
        r.timeAxisHitArea?.rect(0, height - 30, chartWidth, 30);
        r.timeAxisHitArea?.fill({ color: 0x000000, alpha: 0 });

        // Update Mask
        const mask = r.mainContainer!.mask as Graphics;
        mask.clear();
        mask.rect(0, 0, chartWidth, chartHeight);
        mask.fill({ color: 0xffffff });
        
        // Clear Graphics
        r.gridGraphics?.clear();
        r.cellGraphics?.clear();
        r.candleGraphics?.clear();
        r.axisGraphics?.clear();

        // --- Auto Scale Y Logic ---
        // 1. Identify visible range based on X
        // We need to find which candles are visible.
        // x = offsetX + time * scaleX  => time = (x - offsetX) / scaleX
        const tStart = (0 - viewportRef.current.offsetX) / viewportRef.current.scaleX;
        const tEnd = (chartWidth - viewportRef.current.offsetX) / viewportRef.current.scaleX;
        
        // 2. Filter visible data (optimized binary search would be better for large data, but filter is ok for <10k)
        // We also add a buffer to ensure smooth scrolling
        const buffer = (tEnd - tStart) * 0.1;
        const visibleData = data.filter(d => d.time >= tStart - buffer && d.time <= tEnd + buffer);
        
        // 3. Update Y Scale if Auto
        if (viewportRef.current.autoScaleY && visibleData.length > 0) {
            let minP = Infinity;
            let maxP = -Infinity;
            visibleData.forEach(d => {
                if (d.low < minP) minP = d.low;
                if (d.high > maxP) maxP = d.high;
            });
            
            // Also include visible prediction cells in the auto-scale range
            const visibleCells = predictionCells.filter(c => 
                c.endTime >= tStart && c.startTime <= tEnd
            );
            
            visibleCells.forEach(c => {
                if (c.lowPrice < minP) minP = c.lowPrice;
                if (c.highPrice > maxP) maxP = c.highPrice;
            });
            
            if (minP !== Infinity) {
                const range = maxP - minP || 1;
                const padding = range * 0.1; // 10% padding top/bottom
                const targetMin = minP - padding;
                const targetMax = maxP + padding;
                const targetRange = targetMax - targetMin;
                
                // scaleY = -chartHeight / targetRange
                const newScaleY = -chartHeight / targetRange;
                // offsetY: center of chart = center of range
                // centerY = chartHeight / 2
                // centerPrice = (targetMin + targetMax) / 2
                // centerY = offsetY + centerPrice * scaleY
                // offsetY = centerY - centerPrice * scaleY
                const centerPrice = (targetMin + targetMax) / 2;
                const newOffsetY = (chartHeight / 2) - centerPrice * newScaleY;
                
                // Apply with some smoothing (optional, but pure snap is more accurate for "Auto")
                // Let's use 0.2 lerp for smoothness
                viewportRef.current.scaleY += (newScaleY - viewportRef.current.scaleY) * 0.2;
                viewportRef.current.offsetY += (newOffsetY - viewportRef.current.offsetY) * 0.2;
            }
        }
        
        // --- 1. Grid & Axes ---
        const grid = r.gridGraphics!;
        const axis = r.axisGraphics!;
        
        // Manage Text Pool
        let axisTextIndex = 0;
        const axisTexts = r.axisTextContainer?.children as Text[] || [];
        
        const getAxisText = (text: string) => {
            let t = axisTexts[axisTextIndex];
            if (!t) {
                t = new Text({ text, style: { fontFamily: 'Arial', fontSize: 12, fill: '#888' } });
                r.axisTextContainer?.addChild(t);
            } else {
                t.text = text;
                t.visible = true;
            }
            axisTextIndex++;
            return t;
        };

        // Price Lines (Adaptive with Hysteresis)
        const minPrice = yToPrice(chartHeight);
        const maxPrice = yToPrice(0);
        const priceRange = maxPrice - minPrice;

        // Initialize or Update Price Step
        let priceStep = axisStateRef.current.priceStep;
        if (priceStep === 0) {
             priceStep = getNicePriceStep(minPrice, maxPrice, chartHeight);
             axisStateRef.current.priceStep = priceStep;
        }

        // Check density
        // pxPerStep = step * scaleY (scaleY is negative, use abs)
        const pxPerPriceStep = Math.abs(priceStep * viewportRef.current.scaleY);
        const MIN_PRICE_SPACING = 50;
        const MAX_PRICE_SPACING = 130; // Allow more space before switching

        if (pxPerPriceStep < MIN_PRICE_SPACING) {
             // Too crowded -> increase step size (zoom out)
             priceStep = getNextPriceStep(priceStep);
             axisStateRef.current.priceStep = priceStep;
        } else if (pxPerPriceStep > MAX_PRICE_SPACING) {
             // Too sparse -> decrease step size (zoom in)
             priceStep = getPrevPriceStep(priceStep);
             axisStateRef.current.priceStep = priceStep;
        }

        const startPrice = Math.floor(minPrice / priceStep) * priceStep;
        
        // Draw Price Lines
        const priceStepsCount = Math.ceil((maxPrice - startPrice) / priceStep) + 2;
        
        for (let i = 0; i < priceStepsCount; i++) {
            const p = startPrice + i * priceStep;
            // Use epsilon for float comparison or just strict bounds
            // if (p < minPrice - priceStep) continue; 
            
            const y = priceToY(p);
            
            if (y >= -20 && y <= chartHeight + 20) { // Allow slight overdraw for partial lines
                grid.moveTo(0, y);
                grid.lineTo(chartWidth, y);
                
                const t = getAxisText(formatPriceLabel(p, priceStep));
                t.x = width - 45; 
                t.y = y - 6;
                // Clamp text Y to stay within axis area?
                // TradingView clips or hides.
                if (t.y < 0) t.y = 0;
                if (t.y > chartHeight - 12) t.y = chartHeight - 12;
            }
        }
        
        // Time Lines (Adaptive with Hysteresis)
        const minTime = xToTime(0);
        const maxTime = xToTime(chartWidth);
        // const timeRange = maxTime - minTime;
        
        let timeStep = axisStateRef.current.timeStep;
        if (timeStep === 0) {
             timeStep = getNiceTimeStep(minTime, maxTime, chartWidth);
             axisStateRef.current.timeStep = timeStep;
        }

        const pxPerTimeStep = timeStep * viewportRef.current.scaleX;
        const MIN_TIME_SPACING = 100;
        const MAX_TIME_SPACING = 250;

        if (pxPerTimeStep < MIN_TIME_SPACING) {
             // Too crowded -> increase step size
             timeStep = getNextTimeStep(timeStep);
             axisStateRef.current.timeStep = timeStep;
        } else if (pxPerTimeStep > MAX_TIME_SPACING) {
             // Too sparse -> decrease step size
             timeStep = getPrevTimeStep(timeStep);
             axisStateRef.current.timeStep = timeStep;
        }

        const startTime = Math.floor(minTime / timeStep) * timeStep;
        
        const timeStepsCount = Math.ceil((maxTime - startTime) / timeStep) + 2;
        
        for (let i = 0; i < timeStepsCount; i++) {
            const tVal = startTime + i * timeStep;
            const x = timeToX(tVal);
            
            if (x >= -50 && x <= chartWidth + 50) {
                grid.moveTo(x, 0);
                grid.lineTo(x, chartHeight);
            
                const d = new Date(tVal * 1000);
                let timeStr = "";
                
                if (timeStep < 60) {
                     timeStr = `${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
                } else if (timeStep < 86400) {
                     timeStr = `${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`;
                } else {
                     timeStr = `${d.getMonth()+1}/${d.getDate()}`;
                }

                const t = getAxisText(timeStr);
                t.x = x - 20;
                t.y = height - 20; 
            }
        }
        
        grid.stroke({ width: 1, color: 0x2B2B43 });
        
        // Hide unused axis texts
        for (let i = axisTextIndex; i < axisTexts.length; i++) axisTexts[i].visible = false;

        // --- 2. Cells ---
        const cells = r.cellGraphics!;
        let textIndex = 0;
        const texts = r.textContainer?.children as Text[] || [];
        
        const getCellText = (text: string) => {
            let t = texts[textIndex];
            if (!t) {
                t = new Text({ text, style: { fontFamily: 'Arial', fontSize: 10, fill: '#fff' } });
                t.anchor.set(0.5);
                r.textContainer?.addChild(t);
            } else {
                t.text = text;
                t.visible = true;
            }
            textIndex++;
            return t;
        };

        const betsMap = new Map();
        bets.forEach(b => { if(b.cellId) betsMap.set(b.cellId, b); });

        predictionCells.forEach(cell => {
            const x1 = timeToX(cell.startTime);
            const x2 = timeToX(cell.endTime);
            const y1 = priceToY(cell.highPrice);
            const y2 = priceToY(cell.lowPrice);
            
            // Cull offscreen
            if (x2 < 0 || x1 > chartWidth) return;

            const w = Math.max(1, x2 - x1);
            const h = Math.abs(y2 - y1);
            const ry = Math.min(y1, y2);
            
            let color = 0x3C3C3C;
            let alpha = 0.5;
            const bet = betsMap.get(cell.id);
            
            if (bet) {
                if (bet.status === 'won') color = 0x2ECC71;
                else if (bet.status === 'lost') color = 0xE74C3C;
                else color = 0xFFD700;
                alpha = 0.3;
            }
            
            cells.rect(x1, ry, w, h);
            cells.fill({ color, alpha });
            cells.stroke({ color, width: 1, alpha: 0.8 });
            
            let txt = "";
            if (bet) txt = bet.status === 'won' ? `+${Math.round(bet.payout)}` : `-${Math.round(bet.amount)}`;
            else txt = `${(cell.probability * 100).toFixed(0)}%`;
            
            const tObj = getCellText(txt);
            tObj.x = x1 + w/2;
            tObj.y = ry + h/2;
        });
        
        // Hide unused texts
        for (let i = textIndex; i < texts.length; i++) texts[i].visible = false;

        // --- 3. Candles ---
        const candles = r.candleGraphics!;
        const candleWidth = Math.max(1, viewportRef.current.scaleX * 0.8);
        
        // Use visibleData from earlier
        if (chartMode === 'candlestick') {
            visibleData.forEach(d => {
                const x = timeToX(d.time);
                const open = priceToY(d.open);
                const close = priceToY(d.close);
                const high = priceToY(d.high);
                const low = priceToY(d.low);
                
                const isUp = d.close >= d.open;
                const color = isUp ? 0x26a69a : 0xef5350;
                
                candles.moveTo(x, high);
                candles.lineTo(x, low);
                candles.stroke({ color, width: 1 });
                
                const bodyTop = Math.min(open, close);
                const bodyH = Math.max(1, Math.abs(close - open));
                
                candles.rect(x - candleWidth/2, bodyTop, candleWidth, bodyH);
                candles.fill({ color });
            });
        } else {
            if (visibleData.length > 0) {
                // Find first point
                const first = visibleData[0];
                candles.moveTo(timeToX(first.time), priceToY(first.close));
                for (let i = 1; i < visibleData.length; i++) {
                    const d = visibleData[i];
                    candles.lineTo(timeToX(d.time), priceToY(d.close));
                }
                candles.stroke({ color: 0x2962FF, width: 2 });
            }
        }

    }, []); // Deps removed as we use ref

    // Animation Loop
    useEffect(() => {
        let frameId: number;
        const loop = () => {
            draw();
            frameId = requestAnimationFrame(loop);
        };
        frameId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frameId);
    }, [draw]);

    // Initial AutoScale
    useEffect(() => {
        if (!viewportRef.current.initialized && data.length > 0 && appRef.current) {
            autoScale(data);
        }
    }, [data, autoScale]);

    // Apply Room Config when it loads
    useEffect(() => {
        if (roomConfig && data.length > 0 && appRef.current) {
            // Force auto-scale when room config is available to ensure correct initial view
            // This handles the case where data loaded before config
            autoScale(data);
        }
    }, [roomConfig]); // Only run when roomConfig object changes

    // Unified helper to update viewport
    const updateViewportState = useCallback((updates: Partial<ChartViewport>, disableAutoScaleY: boolean = false) => {
        viewportRef.current = {
            ...viewportRef.current,
            ...updates
        };
        
        if (disableAutoScaleY) {
            viewportRef.current.autoScaleY = false;
        }
    }, []);

    // Expose chart control methods
    useImperativeHandle(ref, () => ({
        setViewport: (viewport: Partial<ChartViewport>) => {
            // Check if Y-axis is being modified to determine if we should disable autoScale
            const shouldDisableAuto = viewport.scaleY !== undefined || viewport.offsetY !== undefined;
            updateViewportState(viewport, shouldDisableAuto);
        },
        getViewport: () => ({
            offsetX: viewportRef.current.offsetX,
            offsetY: viewportRef.current.offsetY,
            scaleX: viewportRef.current.scaleX,
            scaleY: viewportRef.current.scaleY
        }),
        resetView: () => {
            viewportRef.current.autoScaleY = true;
            if (dataRef.current.data.length > 0) {
                autoScale(dataRef.current.data);
            }
        }
    }));

    return <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />;
});
