import React, { useEffect, useState } from 'react';
import { ShieldCheck, MapPin, Clock, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import './Officer.css';

interface Task {
  id: string;
  alert_title: string;
  zone_id: string;
  severity: string;
  status: string;
  notes: string;
  created_at: string;
}

const Officer = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const fetchTasks = async () => {
    const token = localStorage.getItem('sentinel_token');
    if (!token) {
      navigate('/login');
      return;
    }
    
    try {
      const res = await axios.get('/api/ops/my-tasks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTasks(res.data || []);
      setError('');
    } catch (err: any) {
      if (err.response && err.response.status === 401) {
        localStorage.removeItem('sentinel_token');
        navigate('/login');
      } else {
        setError('REMOTE SERVER UNREACHABLE.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, []);

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    const token = localStorage.getItem('sentinel_token');
    try {
      await axios.post(`/api/ops/tasks/${taskId}/status`, { status: newStatus }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTasks(tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    } catch (err) {
      console.error("Failed to update status", err);
    }
  };

  if (loading) return <div style={{padding: '3rem', textAlign: 'center'}}>AUTHENTICATING CCTNS UPLINK...</div>;
  if (error) return <div style={{padding: '3rem', textAlign: 'center', color: 'red'}}>{error}</div>;

  return (
    <div className="officer-dashboard">
      <div className="dashboard-header">
        <h2>
          <ShieldCheck color="var(--color-primary)" size={28} />
          MARVEL TACTICAL DEPLOYMENT QUEUE
        </h2>
        <div className="badge badge-success badge-pulse">SECURE UPLINK ACTIVE</div>
      </div>

      <div className="enterprise-card">
        <div className="enterprise-header">
          <AlertTriangle color="var(--color-danger)" size={20} />
          <h3>CCTNS ASSIGNED INCIDENTS</h3>
        </div>
        
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            NO ACTIVE DEPLOYMENT DIRECTIVES OUTSTANDING.
          </div>
        ) : (
          <div className="enterprise-table-wrapper">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Time Logged</th>
                  <th>Incident Type / Title</th>
                  <th>Location Code</th>
                  <th>Current Status</th>
                  <th>Tactical Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} style={{ backgroundColor: task.status === 'PENDING' ? '#fef2f2' : 'transparent' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Clock size={14} style={{verticalAlign: 'middle', marginRight: '4px'}}/>
                      {task.created_at ? new Date(task.created_at).toLocaleTimeString() : 'N/A'}
                    </td>
                    <td style={{ fontWeight: 600 }}>{task.alert_title || 'AWAITING CCTNS DETAILS'}</td>
                    <td>
                      <MapPin size={14} style={{verticalAlign: 'middle', marginRight: '4px', color: 'var(--color-primary)'}}/>
                      {task.zone_id || 'Z_UNKNOWN'}
                    </td>
                    <td>
                      <span className={`badge badge-${task.status === 'RESOLVED' ? 'success' : (task.status === 'ACKNOWLEDGED' ? 'warning' : 'danger')}`}>
                        {task.status}
                      </span>
                      {task.severity === 'CRITICAL' && <span className="badge badge-danger" style={{marginLeft: '4px'}}>PRIORITY</span>}
                    </td>
                    <td className="action-cell">
                      {task.status === 'PENDING' && (
                        <button 
                          className="enterprise-btn btn-primary"
                          onClick={() => updateTaskStatus(task.id, 'ACKNOWLEDGED')}
                        >
                          ACKNOWLEDGE
                        </button>
                      )}
                      {task.status === 'ACKNOWLEDGED' && (
                        <button 
                          className="enterprise-btn btn-success"
                          onClick={() => updateTaskStatus(task.id, 'RESOLVED')}
                        >
                          SECURE SCENE
                        </button>
                      )}
                      {task.status === 'RESOLVED' && (
                         <span style={{color: 'var(--color-success)', fontWeight: 600, fontSize: '0.875rem'}}>INCIDENT CLOSED</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Officer;
