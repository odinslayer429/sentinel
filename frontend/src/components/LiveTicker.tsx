import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Radio } from 'lucide-react';
import axios from 'axios';
import './LiveTicker.css';

interface NewsItem {
  id: string;
  title: string;
  timestamp: string;
  location: string;
  category: string;
}

const LiveTicker = () => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const res = await axios.get('/api/public/news');
        setNews(res.data);
      } catch (err) {
        console.error("Failed to fetch Sentinel Pulse news", err);
      }
    };

    fetchNews();
    const interval = setInterval(fetchNews, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (news.length === 0) return;
    const scrollInterval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % news.length);
    }, 5000); // Rotate every 5 seconds
    return () => clearInterval(scrollInterval);
  }, [news]);

  if (news.length === 0) return null;

  return (
    <div className="sentinel-pulse-ticker">
      <div className="ticker-label">
        <Radio size={14} className="pulse-icon" />
        <span>SENTINEL PULSE</span>
      </div>
      <div className="ticker-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="ticker-item"
          >
            <span className="ticker-category">[{news[currentIndex].category}]</span>
            <span className="ticker-location">{news[currentIndex].location}:</span>
            <span className="ticker-title">{news[currentIndex].title}</span>
            <span className="ticker-time">{new Date(news[currentIndex].timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="ticker-status">
        <Activity size={14} />
        <span>HYPERLOCAL_SYNC_ACTIVE</span>
      </div>
    </div>
  );
};

export default LiveTicker;
