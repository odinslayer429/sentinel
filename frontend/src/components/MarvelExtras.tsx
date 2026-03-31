import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

export const GangNetworkModule: React.FC = () => {
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        api.gang.getGraph().then(r => setData(r.data));
    }, []);

    if (!data) return <div>Loading Gang Networks...</div>;

    return (
        <div className="module-card">
            <div className="stat-label">GANG NETWORK ANALYSIS</div>
            <div className="network-summary" style={{marginTop:'1rem'}}>
                {data.nodes.map((n: any) => (
                    <div key={n.id} style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                        <span>{n.label} ({n.role})</span>
                        <span style={{color: n.anomaly > 0.8 ? 'red' : 'inherit'}}>Anomaly: {n.anomaly.toFixed(2)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export const MissingPersonsModule: React.FC = () => {
    const [matches, setMatches] = useState<any[]>([]);
    
    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const fd = new FormData();
        fd.append('file', e.target.files[0]);
        const res = await api.missing.search(fd);
        setMatches(res.data.matches);
    };

    return (
        <div className="module-card">
            <div className="stat-label">MISSING PERSONS TRACKER</div>
            <input type="file" onChange={handleUpload} style={{marginTop:'1rem'}} />
            <div className="matches-list" style={{marginTop:'1rem'}}>
                {matches.map(m => (
                    <div key={m.id} style={{borderBottom:'1px solid #333', padding:'10px 0'}}>
                        <div>Loc: {m.location} | Conf: {m.confidence.toFixed(2)}</div>
                        <small>{m.recency}</small>
                    </div>
                ))}
            </div>
        </div>
    );
};
