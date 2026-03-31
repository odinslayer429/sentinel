import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Send, CheckCircle } from 'lucide-react';
import axios from 'axios';
import './Landing.css';

const Landing = () => {
  const [tipDetails, setTipDetails] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Calls the /api/public/tip endpoint
      await axios.post('/api/public/tip', {
        details: tipDetails,
        severity: 'CRITICAL',
        zone_id: zoneId || 'Z_S_1',
      });
      setSuccess(true);
      setTipDetails('');
      setZoneId('');
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      console.error("Tip submission failed", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-container">
      {/* LEFT: Massive Brutalist Typography Splash */}
      <motion.div 
        className="splash-zone"
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        <h1 className="giant-text">
          ZERO <span className="neon-highlight">GAPS.</span><br/>
          REAL-TIME <span className="neon-highlight">INTEL.</span>
        </h1>
        <p className="sub-text">
          THE APEX PREDICTIVE POLICING ENGINE. 
          BUILT FOR MUMBAI. DESIGNED FOR VELOCITY.
        </p>
      </motion.div>

      {/* RIGHT: Active Public Tip Form */}
      <motion.div 
        className="form-zone"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
      >
        <div className="brutal-card tip-card brutal-card-hover">
          <div className="card-header">
            <AlertTriangle className="alert-icon" size={32} />
            <h2>ANONYMOUS TIP INTAKE</h2>
          </div>
          
          <AnimatePresence mode="wait">
            {success ? (
              <motion.div 
                key="success"
                className="success-state"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                <CheckCircle size={64} className="success-icon" />
                <h3>INTEL RECEIVED.</h3>
                <p>SIGNAL SECURED AND ROUTED TO COMMAND CENTER.</p>
              </motion.div>
            ) : (
              <motion.form 
                key="form"
                onSubmit={handleSubmit}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="tip-form"
              >
                <div className="input-group">
                  <label>INCIDENT DETAILS (ANONYMOUS)</label>
                  <textarea 
                    className="brutal-input brutal-textarea"
                    placeholder="Describe the incident... (e.g., Suspicious activity at Bandra Station)"
                    value={tipDetails}
                    onChange={(e) => setTipDetails(e.target.value)}
                    required
                    rows={4}
                  />
                </div>
                
                <div className="input-group">
                  <label>LOCATION / ZONE</label>
                  <select 
                    className="brutal-input"
                    value={zoneId}
                    onChange={(e) => setZoneId(e.target.value)}
                    required
                  >
                    <option value="" disabled>SELECT A ZONE...</option>
                    <option value="Z_S_1">Z_S_1 (Colaba / Nariman Point)</option>
                    <option value="Z_S_2">Z_S_2 (Byculla / Parel)</option>
                    <option value="Z_W_1">Z_W_1 (Bandra / Khar)</option>
                    <option value="Z_W_2">Z_W_2 (Andheri / Juhu)</option>
                    <option value="Z_E_1">Z_E_1 (Kurla / Chembur)</option>
                  </select>
                </div>
                
                <button 
                  type="submit" 
                  className="brutal-btn submit-btn"
                  disabled={loading}
                >
                  <Send size={20} />
                  {loading ? 'TRANSMITTING...' : 'TRANSMIT INTEL'}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default Landing;
