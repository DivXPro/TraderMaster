import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, LineData } from 'lightweight-charts';
import * as Colyseus from '@colyseus/sdk';
import { MarketState, MessageType } from '@trader-master/shared';
import type { Candle, MarketRoomConfig } from '@trader-master/shared';
import { GameOverlay } from './components/GameOverlay';
import { useGameStore } from './store/useGameStore';
import { syncRoomState } from './store/syncRoomState';
import { getRoomMetadata } from './api/room';
import './components/GameOverlay.css';
import './App.css';

// Initialize Colyseus Client
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const host = window.location.host;
const client = new Colyseus.Client(`${protocol}://${host}/api`);

// Define RoomAvailable interface if not exported by SDK (it should be, but let's be safe or check imports)
// Actually Colyseus SDK usually exports it. Let's check imports.
// It seems getAvailableRooms might be generic or I need to cast client.

function App() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [seriesApi, setSeriesApi] = useState<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const [chartMode, setChartMode] = useState<'line' | 'candlestick'>('line');
  const [marketData, setMarketData] = useState<Candle[]>([]);
  const [room, setRoom] = useState<Colyseus.Room<MarketState> | null>(null);
  const lastCandleTimeRef = useRef<number>(0);
  const syncCleanupRef = useRef<(() => void) | null>(null);

  const bets = useGameStore((state) => state.bets);
  const balance = useGameStore((state) => state.balance);
  const roomConfig = useGameStore((state) => state.roomConfig);
  const setRoomConfig = useGameStore((state) => state.setRoomConfig);

  // Calculate stats
  const totalBets = bets.length;
  const wonBets = bets.filter(b => b.status === 'won').length;
  const lostBets = bets.filter(b => b.status === 'lost').length;

  // Initialize Room connection
  useEffect(() => {
    let active = true;

    const connect = async () => {
      let r: Colyseus.Room<MarketState>;
      try {
        const lastToken = localStorage.getItem("reconnectionToken");
        
        if (lastToken) {
            try {
                console.log("Reconnecting with token...", lastToken);
                r = await client.reconnect<MarketState>(lastToken);
                console.log("Reconnected successfully!");
            } catch (e) {
                console.warn("Reconnection failed, joining new room:", e);
                localStorage.removeItem("reconnectionToken");
                r = await client.joinOrCreate<MarketState>("market");
            }
        } else {
            r = await client.joinOrCreate<MarketState>("market");
        }

        if (!active) {
            r.leave();
            return;
        }
        console.log("Joined room successfully!", r.sessionId);
        
        // Fetch room metadata explicitly after joining
        fetch(`${protocol === 'wss' ? 'https' : 'http'}://${host}/api/room/${r.roomId}/metadata`)
          .then(res => res.json())
          .then(metadata => {
              console.log("Fetched metadata via API:", metadata);
              if (metadata && Object.keys(metadata).length > 0) {
                  setRoomConfig(metadata as MarketRoomConfig);
              }
          })
          .catch(err => console.error("Failed to fetch room metadata:", err));

        localStorage.setItem("reconnectionToken", r.reconnectionToken);
        setRoom(r);
      } catch (e) {
        console.error("Join error:", e);
      }
    };

    connect();

    return () => {
      active = false;
      if (room) {
          room.leave();
      }
    };
  }, []); // Run once on mount

  // Apply centralized Colyseus state synchronization
  useEffect(() => {
    if (!room) return;
    if (syncCleanupRef.current) {
      syncCleanupRef.current();
      syncCleanupRef.current = null;
    }
    const cleanup = syncRoomState(room);
    syncCleanupRef.current = cleanup;
    return () => {
      if (syncCleanupRef.current) {
        syncCleanupRef.current();
        syncCleanupRef.current = null;
      }
    };
  }, [room]);

  // Initialize Chart
  useEffect(() => {
    if (!chartContainerRef.current || !roomConfig) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1E1E1E' },
        textColor: '#DDD',
      },
      grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 500,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        shiftVisibleRangeOnNewBar: true,
        // Adjust barSpacing to make grid blocks square
        // Calculation: 
        // Chart Height (500) - TimeScale (~26) = ~474px
        // Vertical Content: 474 * 0.8 (margins) = ~379px
        // Target Blocks Vertical: PREDICTION_LAYERS
        // Block Height: 379 / PREDICTION_LAYERS
        // Block Width (Time): PREDICTION_DURATION (30s)
        // BarSpacing: Block Height / PREDICTION_DURATION
        barSpacing: ((500 - 26) * 0.8 / (roomConfig.predictionLayers || 8)) / (roomConfig.predictionDuration || 30), 
        // Default right offset (empty space on the right in bars)
        // We calculate this dynamically below, but set a safe default
        rightOffset: 0, 
      },
      // Price scale configuration to adjust vertical range
      rightPriceScale: {
        // scaleMargins controls the empty space top and bottom
        scaleMargins: {
          top: 0.1,    // 10% margin at top
          bottom: 0.1, // 10% margin at bottom
        },
        // 'normal' | 'log' | 'percentage' | 'indexedTo100'
        mode: 0, 
        autoScale: true,
      },
    });
    
    // Custom Autoscale strategy to ensure we see exactly ~PREDICTION_LAYERS * 2 grid blocks vertically
    // This fixes the vertical scale so that 1 block (PREDICTION_PRICE_HEIGHT price units) has a constant height in pixels.
    // Combined with the fixed barSpacing, this ensures the grid is square.
    const autoscaleStrategy = (original: () => any) => {
        const res = original();
        if (res === null) return null;

        const TARGET_VISUAL_RANGE = (roomConfig.predictionLayers || 8) * (roomConfig.predictionPriceHeight || 10); // blocks
        
        // Calculate center of the current data
        const center = (res.priceRange.minValue + res.priceRange.maxValue) / 2;
        const half = TARGET_VISUAL_RANGE / 2;

        return {
            priceRange: {
                minValue: center - half,
                maxValue: center + half,
            },
            margins: res.margins,
        };
    };

    let series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;

    if (chartMode === 'candlestick') {
      series = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        autoscaleInfoProvider: autoscaleStrategy,
      });
    } else {
      series = chart.addSeries(LineSeries, {
        color: '#2962FF',
        lineWidth: 2,
        autoscaleInfoProvider: autoscaleStrategy,
      });
    }

    setChartApi(chart);
    setSeriesApi(series);
    
    // Initial centering logic
    // Calculate how many seconds fit in half width
    // barSpacing is pixels per second (since we divided by PREDICTION_DURATION in calculation, wait...)
    // No, barSpacing is pixels per bar. If 1 bar = 1 second.
    // PREDICTION_DURATION is 30.
    // Our barSpacing calculation was: height_per_block / 30.
    // So barSpacing is pixels per second IF 1 bar = 1 second.
    // Assuming 1 bar = 1 second for now as per server update frequency.
    
    // Center offset: shift current time to the left/center to leave room for future
    // We want right side to accommodate PREDICTION_INITIAL_COLUMNS * PREDICTION_DURATION
    // rightOffset is in bars.
    const desiredRightOffsetBars = (roomConfig.predictionInitialColumns || 20) * (roomConfig.predictionDuration || 30);
    
    // Apply options to set the right offset
    chart.applyOptions({
        timeScale: {
            rightOffset: desiredRightOffsetBars,
        }
    });

    // Initial Data Load
    if (marketData.length > 0) {
      // Ensure unique and sorted data for initial load
      const uniqueData = new Map();
      marketData.forEach(item => uniqueData.set(item.time, item));
      const sortedData = Array.from(uniqueData.values()).sort((a, b) => a.time - b.time);

      if (chartMode === 'candlestick') {
        const data: CandlestickData[] = sortedData.map(item => ({
          time: item.time as UTCTimestamp,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close
        }));
        (series as ISeriesApi<"Candlestick">).setData(data);
      } else {
        const data: LineData[] = sortedData.map(item => ({
          time: item.time as UTCTimestamp,
          value: item.close,
        }));
        (series as ISeriesApi<"Line">).setData(data);
      }
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        const newWidth = chartContainerRef.current.clientWidth;
        chart.applyOptions({ width: newWidth });
        
        // Keep the right offset consistent on resize
        const desiredRightOffsetBars = (roomConfig.predictionInitialColumns || 20) * (roomConfig.predictionDuration || 30);
        chart.applyOptions({
            timeScale: {
                rightOffset: desiredRightOffsetBars,
            }
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      setChartApi(null);
      setSeriesApi(null);
      chart.remove();
    };
  }, [chartMode, roomConfig]); // Re-create chart when mode or config changes

  // Data Updates
  useEffect(() => {
    if (!seriesApi || !room) return;

    const handleHistory = (data: Candle[]) => {
      const sortedData = data.sort((a, b) => a.time - b.time);
      setMarketData(sortedData);
      
      if (sortedData.length > 0) {
        lastCandleTimeRef.current = sortedData[sortedData.length - 1].time;
      }

      if (chartMode === 'candlestick') {
        const chartData: CandlestickData[] = sortedData.map(item => ({
          time: item.time as UTCTimestamp,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close
        }));
        (seriesApi as ISeriesApi<"Candlestick">).setData(chartData);
      } else {
        const chartData: LineData[] = sortedData.map(item => ({
          time: item.time as UTCTimestamp,
          value: item.close,
        }));
        (seriesApi as ISeriesApi<"Line">).setData(chartData);
      }
    };

    const handlePrice = (data: Candle) => {
      // Validate time order
      if (data.time < lastCandleTimeRef.current) {
        console.warn('Received out-of-order data, ignoring:', data);
        return;
      }
      
      lastCandleTimeRef.current = data.time;

      setMarketData(prev => {
        const last = prev[prev.length - 1];
        if (last && last.time === data.time) {
            // Update last candle
            const updated = [...prev];
            updated[prev.length - 1] = data;
            return updated;
        }
        return [...prev, data];
      });
      
      if (chartMode === 'candlestick') {
        const chartItem: CandlestickData = {
          time: data.time as UTCTimestamp,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close
        };
        (seriesApi as ISeriesApi<"Candlestick">).update(chartItem);
      } else {
        const chartItem: LineData = {
          time: data.time as UTCTimestamp,
          value: data.close,
        };
        (seriesApi as ISeriesApi<"Line">).update(chartItem);
      }
    };

    const handleBetResult = (data: any) => {
      const store = useGameStore.getState();
      const betsArray = Array.isArray(data.bets)
        ? data.bets
        : data.bet
        ? [data.bet]
        : [];

      betsArray.forEach((betData: any) => {
        store.updateBet(betData);

        if (betData.ownerId === room.sessionId && betData.cellId) {
          store.updatePredictionCellStatus(betData.cellId, betData.status);
        }
      });

      if (typeof data.balance === "number") {
        store.setBalance(data.balance);
      }
    };

    room.onMessage(MessageType.HISTORY, handleHistory);
    room.onMessage(MessageType.PRICE, handlePrice);
    room.onMessage(MessageType.BET_RESULT, handleBetResult);

    return () => {
        // Cleanup listeners if necessary, but room.leave() in parent effect might handle it.
        // Colyseus doesn't have an explicit 'off' for messages in the same way, 
        // but re-registering overwrites or we can rely on component unmount.
    };
  }, [seriesApi, chartMode, chartApi, room, setRoomConfig]);

  return (
    <div className="app-container">
      <header>
        <h1>TraderMaster</h1>
        <div className="header-controls">
          <p>Real-time Market Simulation</p>
          <div className="mode-switch">
            <button 
              className={chartMode === 'line' ? 'active' : ''} 
              onClick={() => setChartMode('line')}
            >
              Line
            </button>
            <button 
              className={chartMode === 'candlestick' ? 'active' : ''} 
              onClick={() => setChartMode('candlestick')}
            >
              Candle
            </button>
          </div>
        </div>
      </header>
      
      {/* Stats Container */}
      <div className="stats-container">
        <div className="balance-info">
          <span className="label">Balance</span>
          <span className="value">${balance.toLocaleString()}</span>
        </div>
        <div className="game-stats">
          <div className="stat-item">
            <span className="label">Bets</span>
            <span className="value">{totalBets}</span>
          </div>
          <div className="stat-item">
            <span className="label">Won</span>
            <span className="value win">{wonBets}</span>
          </div>
          <div className="stat-item">
            <span className="label">Lost</span>
            <span className="value loss">{lostBets}</span>
          </div>
        </div>
      </div>

      <div className="chart-wrapper" ref={chartContainerRef} style={{ position: 'relative', minHeight: '500px' }}>
        {!roomConfig && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#888' }}>
                Connecting to Market...
            </div>
        )}
        {chartApi && seriesApi && room && (
          <GameOverlay 
            chart={chartApi} 
            series={seriesApi}
            room={room} 
            lastTime={marketData.length > 0 ? (marketData[marketData.length - 1].time as number) : null}
            lastPrice={marketData.length > 0 ? marketData[marketData.length - 1].close : null}
            roomConfig={roomConfig}
          />
        )}
      </div>
    </div>
  );
}

export default App;
