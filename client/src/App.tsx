import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp, CandlestickData } from 'lightweight-charts';
import io from 'socket.io-client';
import type { Candle } from '@trader-master/shared';
import { GameOverlay } from './components/GameOverlay';
import './components/GameOverlay.css';
import './App.css';

const socket = io('http://localhost:3001');

function App() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [seriesApi, setSeriesApi] = useState<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Initialize Chart
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

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    setChartApi(chart);
    setSeriesApi(candlestickSeries);

    // Socket Event Listeners
    socket.on('history', (data: Candle[]) => {
      // Sort data by time just in case
      const sortedData = data.sort((a, b) => a.time - b.time);
      
      // Convert to Lightweight Charts format
      const chartData: CandlestickData[] = sortedData.map(item => ({
        time: item.time as UTCTimestamp,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close
      }));
      
      candlestickSeries.setData(chartData);
      chart.timeScale().fitContent();
    });

    socket.on('price', (data: Candle) => {
      const chartItem: CandlestickData = {
        time: data.time as UTCTimestamp,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close
      };
      candlestickSeries.update(chartItem);
    });

    // Resize Observer
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      socket.off('history');
      socket.off('price');
    };
  }, []);

  return (
    <div className="app-container">
      <header>
        <h1>TraderMaster</h1>
        <p>Real-time Market Simulation</p>
      </header>
      <div className="chart-wrapper" ref={chartContainerRef}>
        {chartApi && seriesApi && (
          <GameOverlay 
            chart={chartApi} 
            series={seriesApi} 
            socket={socket} 
          />
        )}
      </div>
      <div className="controls">
        <p>Hold Left Mouse Button and Drag to Place a Bet Box</p>
      </div>
    </div>
  );
}

export default App;
