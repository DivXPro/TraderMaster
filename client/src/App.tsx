import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, LineData } from 'lightweight-charts';
import io from 'socket.io-client';
import type { Candle } from '@trader-master/shared';
import { GameOverlay } from './components/GameOverlay';
import './components/GameOverlay.css';
import './App.css';

const socket = io();

function App() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [seriesApi, setSeriesApi] = useState<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const [chartMode, setChartMode] = useState<'line' | 'candlestick'>('line');
  const [marketData, setMarketData] = useState<Candle[]>([]);

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
      }
    });

    let series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">;

    if (chartMode === 'candlestick') {
      series = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });
    } else {
      series = chart.addSeries(LineSeries, {
        color: '#2962FF',
        lineWidth: 2,
      });
    }

    setChartApi(chart);
    setSeriesApi(series);

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
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
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
        chartApi.timeScale().fitContent();
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
      <div className="chart-wrapper" ref={chartContainerRef}>
        {chartApi && seriesApi && (
          <GameOverlay 
            chart={chartApi} 
            series={seriesApi} // GameOverlay needs to support both or be generic
            socket={socket} 
            lastTime={marketData.length > 0 ? (marketData[marketData.length - 1].time as number) : null}
          />
        )}
      </div>
    </div>
  );
}

export default App;
