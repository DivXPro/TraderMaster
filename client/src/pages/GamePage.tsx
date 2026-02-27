import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, LineData } from 'lightweight-charts';
import * as Colyseus from '@colyseus/sdk';
import { MarketState, MessageType } from '@trader-master/shared';
import type { Candle } from '@trader-master/shared';
import { GameOverlay } from '../components/GameOverlay';
import { useGameStore } from '../store/useGameStore';
import { syncRoomState } from '../store/syncRoomState';
import { getRoomMetadata } from '../api/room';
import '../components/GameOverlay.css';
import '../App.css';

// Initialize Colyseus Client
// Hardcode for testing connection issue
  const client = new Colyseus.Client("ws://localhost:3000");
  // const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // const host = window.location.host;
  // const client = new Colyseus.Client(`${protocol}://${host}/api`);

export function GamePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [seriesApi, setSeriesApi] = useState<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const [chartMode, setChartMode] = useState<'line' | 'candlestick'>('line');
  const [marketData, setMarketData] = useState<Candle[]>([]);
  const [room, setRoom] = useState<Colyseus.Room<MarketState> | null>(null);
  const lastCandleTimeRef = useRef<number>(0);
  const lastPriceRef = useRef<number | null>(null);
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
    if (!roomId) {
      navigate('/');
      return;
    }

    // Use a ref to track if a connection attempt is in progress or completed for this mount
    // This persists across re-renders of the same component instance
    const connectionAttemptRef = { current: false };
    
    let active = true;
    let currentRoom: Colyseus.Room<MarketState> | null = null;

    const connect = async () => {
      // If already connecting or connected, skip
      if (connectionAttemptRef.current) return;
      connectionAttemptRef.current = true;

      try {
        const lastToken = localStorage.getItem("reconnectionToken");
        
        // Try to reconnect if token exists
        if (lastToken) {
          try {
            console.log("Reconnecting with token...", lastToken);
            const r = await client.reconnect<MarketState>(lastToken);
            console.log("Reconnected successfully!", r.sessionId);
            
            // Check if we reconnected to the requested room
            if (r.roomId === roomId) {
              currentRoom = r;
            } else {
              // Wrong room, leave and join correct one
              console.log("Reconnected to wrong room, leaving...");
              r.leave();
              localStorage.removeItem("reconnectionToken");
              currentRoom = await client.joinById<MarketState>(roomId);
            }
          } catch (e) {
            console.warn("Reconnection failed:", e);
            localStorage.removeItem("reconnectionToken");
            // Fallback to join by ID
            try {
                // Add a small delay before retry to ensure server has cleaned up or is ready
                await new Promise(resolve => setTimeout(resolve, 500));
                currentRoom = await client.joinById<MarketState>(roomId);
            } catch (joinError) {
                console.error("Join by ID failed after reconnection failure:", joinError);
            }
          }
        } else {
          // No token, join by ID
          try {
              currentRoom = await client.joinById<MarketState>(roomId);
          } catch (e) {
              console.error("Initial join failed:", e);
              // Retry once if seat reservation expired
              if (String(e).includes("seat reservation expired")) {
                  console.log("Retrying join due to expired reservation...");
                  try {
                      await new Promise(resolve => setTimeout(resolve, 1000));
                      currentRoom = await client.joinById<MarketState>(roomId);
                  } catch (retryError) {
                      console.error("Retry join failed:", retryError);
                  }
              }
          }
        }

        if (!active) {
          if (currentRoom) currentRoom.leave();
          return;
        }

        if (currentRoom) {
            console.log("Joined room successfully!", currentRoom.sessionId);
            
            // Fetch room metadata explicitly after joining
            getRoomMetadata(currentRoom.roomId).then(metadata => {
            console.log("Fetched metadata via API:", metadata);
            if (metadata && Object.keys(metadata).length > 0) {
                setRoomConfig(metadata);
            }
            });

            localStorage.setItem("reconnectionToken", currentRoom.reconnectionToken);
            setRoom(currentRoom);
        }
      } catch (e) {
        console.error("Join error:", e);
        // If join fails, maybe redirect home?
        // navigate('/'); 
      } finally {
        // We don't reset connectionAttemptRef.current to false here because
        // we want to prevent double-joins during the lifetime of this effect.
        // It will be reset when the component unmounts and remounts (new ref).
      }
    };

    connect();

    return () => {
      active = false;
      if (currentRoom) {
        currentRoom.leave();
      }
    };
  }, [roomId, navigate, setRoomConfig]);

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
        barSpacing: ((500 - 26) * 0.8 / (roomConfig.predictionLayers || 8)) / (roomConfig.predictionDuration || 30), 
        rightOffset: 0, 
      },
      rightPriceScale: {
        scaleMargins: {
          top: 0.1,    // 10% margin at top
          bottom: 0.1, // 10% margin at bottom
        },
        mode: 0, 
        autoScale: true,
      },
    });
    
    const autoscaleStrategy = (original: () => any) => {
        const res = original();
        if (res === null) return null;

        const priceHeight = roomConfig.predictionPriceHeight || 1;
        const visibleLayers = roomConfig.predictionLayers || 8;
        const currentPrice = lastPriceRef.current;
        
        // Calculate visible price range based on predictionLayers
        // Total visible height = layers * priceHeight
        const visibleRange = visibleLayers * priceHeight;
        
        let minValue = res.priceRange.minValue;
        let maxValue = res.priceRange.maxValue;

        if (currentPrice !== null && currentPrice > 0) {
            // Center around current price
            minValue = Math.max(0, currentPrice - visibleRange / 2);
            maxValue = minValue + visibleRange;
        }

        return {
            priceRange: {
                minValue: minValue,
                maxValue: maxValue,
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
    
    const desiredRightOffsetBars = (roomConfig.predictionInitialColumns || 20) * (roomConfig.predictionDuration || 30);
    
    chart.applyOptions({
        timeScale: {
            rightOffset: desiredRightOffsetBars,
        }
    });

    // Initial Data Load
    if (marketData.length > 0) {
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
  }, [chartMode, roomConfig]); 

  // Data Updates
  useEffect(() => {
    if (!seriesApi || !room) return;

    const handleHistory = (data: Candle[]) => {
      const sortedData = data.sort((a, b) => a.time - b.time);
      setMarketData(sortedData);
      
      if (sortedData.length > 0) {
        lastCandleTimeRef.current = sortedData[sortedData.length - 1].time;
        lastPriceRef.current = sortedData[sortedData.length - 1].close;
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
      if (data.time < lastCandleTimeRef.current) {
        console.warn('Received out-of-order data, ignoring:', data);
        return;
      }
      
      lastCandleTimeRef.current = data.time;
      lastPriceRef.current = data.close;

      setMarketData(prev => {
        const last = prev[prev.length - 1];
        if (last && last.time === data.time) {
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
    };
  }, [seriesApi, chartMode, chartApi, room, setRoomConfig]);

  return (
    <div className="app-container">
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: '1px solid #444', color: '#fff', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}>
            &larr; Back
          </button>
          <h1>TraderMaster</h1>
        </div>
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
