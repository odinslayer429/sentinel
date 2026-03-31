/**
 * usePredictions — fetches /api/predict every 60s and exposes a per-zone lookup.
 * Also provides fetchZone() for on-demand single-zone detail.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';

export interface Prediction {
  crime_type: string;
  probability: number;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ZonePrediction {
  zone_id: string;
  hour: number;
  day_of_week: number;
  month: number;
  timeband: string;
  predictions: Prediction[];
  model_accuracy: number;
  top3_accuracy: number;
}

// Map zone_id → ZonePrediction
export type PredictionMap = Record<string, ZonePrediction>;

export function usePredictions(pollMs = 60_000) {
  const [predMap, setPredMap]     = useState<PredictionMap>({});
  const [lastUpdated, setLast]    = useState<Date | null>(null);
  const [loading, setLoading]     = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get<ZonePrediction[]>('/api/predict');
      const arr: ZonePrediction[] = Array.isArray(res.data) ? res.data : [];
      const map: PredictionMap = {};
      arr.forEach(z => { map[z.zone_id] = z; });
      setPredMap(map);
      setLast(new Date());
    } catch (e) {
      console.warn('[usePredictions] poll failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchZone = useCallback(async (
    zone_id: string, hour: number, day_of_week: number, month: number
  ): Promise<ZonePrediction | null> => {
    try {
      const res = await axios.get<ZonePrediction>(
        `/api/predict/crime-type?zone_id=${zone_id}&hour=${hour}&day_of_week=${day_of_week}&month=${month}`
      );
      return res.data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, pollMs);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll, pollMs]);

  return { predMap, lastUpdated, loading, fetchZone, refresh: fetchAll };
}
