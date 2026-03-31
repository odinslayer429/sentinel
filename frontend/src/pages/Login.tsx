import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, Terminal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './Login.css';
import api from '../services/api';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await api.login(username, password);

      sessionStorage.setItem('sentinel_token', res.data.access_token);
      sessionStorage.setItem('sentinel_role', res.data.role);
      sessionStorage.setItem('sentinel_user', res.data.full_name || username);

      // Route by role
      if (res.data.role === 'admin') {
        navigate('/dashboard');
      } else {
        navigate('/officer/dashboard');
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        setError('ACCESS DENIED: INVALID CREDENTIALS');
      } else {
        setError('SYSTEM ERROR: UNABLE TO CONTACT AUTH SERVER');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <motion.div
        className="login-terminal brutal-card brutal-border-heavy"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="terminal-header">
          <Terminal size={24} color="var(--color-neon-green)" />
          <h2>AUTHENTICATION REQUIRED</h2>
        </div>

        <p className="terminal-warning">
          RESTRICTED ACCESS. UNAUTHORIZED ENTRY WILL BE LOGGED.
        </p>

        <form onSubmit={handleLogin} className="login-form">
          <div className="input-group">
            <label>BADGE ID / USERNAME</label>
            <input
              type="text"
              className="brutal-input formal-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g., officer01"
              required
            />
          </div>

          <div className="input-group">
            <label>SECURITY PASSPHRASE</label>
            <input
              type="password"
              className="brutal-input formal-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="error-text">{error}</div>}

          <button
            type="submit"
            className="brutal-btn login-btn"
            disabled={loading}
          >
            <Lock size={20} />
            {loading ? 'VERIFYING BIOMETRICS...' : 'REQUEST ACCESS'}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

export default Login;