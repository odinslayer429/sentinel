import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { Shield, Languages } from 'lucide-react';
import './Layout.css';

const Layout = () => {
  const [lang, setLang] = React.useState(localStorage.getItem('marvel_lang') || 'en');

  const toggleLang = () => {
    const newLang = lang === 'en' ? 'mr' : 'en';
    setLang(newLang);
    localStorage.setItem('marvel_lang', newLang);
    window.location.reload(); // Quickest way for demo to re-render all localized strings
  };

  return (
    <div className="layout-root">
      {/* Enterprise Top Nav */}
      <header className="enterprise-nav">
        <div className="nav-brand">
          <Shield color="white" size={32} />
          <div className="brand-text">
            <h1>MARVEL SYSTEM</h1>
            <span>Maharashtra Police Intelligence Network</span>
          </div>
        </div>
        
        <nav className="nav-links">
          <button className="lang-toggle" onClick={toggleLang}>
            <Languages size={18} />
            {lang === 'en' ? 'मराठी' : 'ENGLISH'}
          </button>
          <Link to="/" className="nav-link">
            {lang === 'en' ? 'Public Information' : 'सार्वजनिक माहिती'}
          </Link>
          <Link to="/login" className="nav-link">
            {lang === 'en' ? 'Secure Login' : 'सुरक्षित लॉगिन'}
          </Link>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="layout-main">
        <Outlet />
      </main>
      
      {/* Enterprise Footer */}
      <footer className="enterprise-footer">
        <p>
          {lang === 'en' 
            ? 'MARVEL (Maharashtra Advanced Research and Vigilance for Enhanced Law Enforcement) // RESTRICTED ACCESS' 
            : 'मार्बल (महाराष्ट्र प्रगत संशोधन आणि कायद्याच्या अंमलबजावणीसाठी दक्षता) // प्रतिबंधित प्रवेश'}
        </p>
      </footer>
    </div>
  );
};

export default Layout;
