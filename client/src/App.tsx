import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, LineData } from 'lightweight-charts';
import io from 'socket.io-client';
import type { Candle } from '@trader-master/shared';
import { GameOverlay } from './components/GameOverlay';
import { useGameStore } from './store/useGameStore';
import './components/GameOverlay.css';
import './App.css';

const socket = io();

function App() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [seriesApi, setSeriesApi] = useState<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const [chartMode, setChartMode] = useState<'line' | 'candlestick'>('line');
  const [marketData, setMarketData] = useState<Candle[]>([]);

  const bets = useGameStore((state) => state.bets);
  const balance = useGameStore((state) => state.balance);

  // Calculate stats
  const totalBets = bets.length;
  const wonBets = bets.filter(b => b.status === 'won').length;
  const lostBets = bets.filter(b => b.status === 'lost').length;

  // Initialize Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

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
        // Vertical Content: 474 * 0.8 (margins) = ~380px
        // Target Blocks Vertical: 8
        // Block Height: 380 / 8 = 47.5px
        // Block Width (Time): 60 seconds (60 bars)
        // BarSpacing: 47.5 / 60 ≈ 0.79 px
        barSpacing: 0.79, 
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
    
    // Keep the latest bar in the middle of the chart by adding a large right offset
    // This effectively creates empty space on the right side
    // We'll update this dynamically if needed, but a fixed value is a good start
    // chart.timeScale().scrollToPosition(50, false);

    // Custom Autoscale strategy to ensure we see exactly ~8 grid blocks vertically
    // This fixes the vertical scale so that 1 block (0.5 price units) has a constant height in pixels.
    // Combined with the fixed barSpacing, this ensures the grid is square.
    const autoscaleStrategy = (original: () => any) => {
        const res = original();
        if (res === null) return null;

        const TARGET_VISUAL_RANGE = 4.0; // 8 blocks * 0.5
        
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
    // We want the latest bar to be in the middle of the chart.
    // The width of the chart in pixels is chartContainerRef.current.clientWidth.
    // The barSpacing is 0.79.
    // Half width in bars = (width / 2) / 0.79.
    const width = chartContainerRef.current.clientWidth;
    // Reduce slightly (e.g. -20) to account for price scale width if needed
    const centerOffset = (width / 2) / 0.79;
    
    // Apply options to set the right offset
    chart.applyOptions({
        timeScale: {
            rightOffset: centerOffset,
        }
    });

    // Initial Data Load
    if (marketData.length > 0) {
      if (chartMode === 'candlestick') {
        const data: CandlestickData[] = marketData.map(item => ({
          time: item.time as UTCTimestamp,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close
        }));
        (series as ISeriesApi<"Candlestick">).setData(data);
      } else {
        const data: LineData[] = marketData.map(item => ({
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
        
        // Update center offset on resize
        const newCenterOffset = (newWidth / 2) / 0.79;
        chart.applyOptions({
            timeScale: {
                rightOffset: newCenterOffset,
            }
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [chartMode]); // Re-create chart when mode changes

  // Data Updates
  useEffect(() => {
    if (!seriesApi) return;

    const handleHistory = (data: Candle[]) => {
      const sortedData = data.sort((a, b) => a.time - b.time);
      setMarketData(sortedData);
      
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
      
      if (chartApi) {
        // Don't refit content on every update to keep the user's scroll position or our default offset
        // chartApi.timeScale().fitContent(); 
      }
    };

    const handlePrice = (data: Candle) => {
      setMarketData(prev => [...prev, data]);
      
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

    socket.on('history', handleHistory);
    socket.on('price', handlePrice);

    return () => {
      socket.off('history', handleHistory);
      socket.off('price', handlePrice);
    };
  }, [seriesApi, chartMode, chartApi]); // Re-bind when series/mode changes

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

      <div className="chart-wrapper" ref={chartContainerRef}>
        {chartApi && seriesApi && (
          <GameOverlay 
            chart={chartApi} 
            series={seriesApi} // GameOverlay needs to support both or be generic
            socket={socket} 
            lastTime={marketData.length > 0 ? (marketData[marketData.length - 1].time as number) : null}
            lastPrice={marketData.length > 0 ? marketData[marketData.length - 1].close : null}
          />
        )}
      </div>
    </div>
  );
}

export default App;
