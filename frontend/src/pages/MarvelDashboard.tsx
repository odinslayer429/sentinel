import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import ForceAllocator    from '../components/ForceAllocator';
import DispatchBoard     from '../components/DispatchBoard';
import IntelStreamPanel  from '../components/IntelStreamPanel';
import 'leaflet/dist/leaflet.css';
import './MarvelDashboard.css';
import MahaCrimeCopilot  from '../components/MahaCrimeCopilot';
import CrimeMap          from '../components/CrimeMap';
import { useWebSocket }  from '../hooks/useWebSocket';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ZoneVelocity { zone_id:string; zone_name:string; z_score:number; current_1h:number; mean_1h:number; score?:number; }
interface Alert        { zone:string; message:string; severity:string; }
interface Event        { id?:string|number; title:string; description:string; zone:string; zone_id?:string; crime_types:string; published_at?:string; source?:string; url?:string; severity?:string; }
interface Offender     { id?:string; name:string; alias:string; fir_count:number; last_seen:string; zones:string|string[]; predicted_risk?:'High'|'Medium'|'Low'; intervention_protocol?:string; recidivism_probability?:number; }
interface Stats        { total_24h:number; critical:number; warning:number; }
interface SurgeAlert   { zone:string; ratio:number; severity:'SURGE'|'ELEVATED'; message:string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const riskToAction  = (r:string) => { const v=(r||'').toUpperCase(); if(v==='CRITICAL')return 'DEPLOY IMMEDIATELY'; if(v==='HIGH'||v==='ELEVATED')return 'INCREASE PATROLS'; if(v==='MEDIUM')return 'MONITOR CLOSELY'; return 'ROUTINE PATROL'; };
const zToHeat       = (z:number) => { if(z>5)return{label:'EXTREME SPIKE',sub:'Far above normal — send backup now',color:'#FF2D55'}; if(z>3)return{label:'HIGH ALERT',sub:'Well above normal — deploy extra units',color:'#FF3B30'}; if(z>2)return{label:'ELEVATED',sub:'Above normal — increase patrol rounds',color:'#FF9500'}; if(z>1)return{label:'ABOVE NORMAL',sub:'Slightly higher than usual',color:'#D2FF00'}; if(z>.5)return{label:'NORMAL',sub:'Within expected range',color:'#00FFFF'}; return{label:'QUIET',sub:'Below average activity',color:'#5AC8FA'}; };
const intensityToUrgency = (i:number,c:number) => { if(i>2.5)return{label:'EXPECT SURGE',detail:`${c} incidents yesterday — high chance of more in next 3 hrs`,color:'#FF3B30'}; if(i>1.5)return{label:'LIKELY ACTIVE',detail:`${c} incidents yesterday — above average activity expected`,color:'#FF9500'}; if(i>0.8)return{label:'WATCH THIS ZONE',detail:`${c} incidents yesterday — monitor closely`,color:'#D2FF00'}; return{label:'CALM',detail:`${c} incidents yesterday — no surge expected`,color:'#34C759'}; };
const anomalyToNote = (severity:string,latestCount:number,meanDaily:number) => { const excess=Math.max(0,latestCount-Math.round(meanDaily)); const s=(severity||'').toUpperCase(); if(s==='CRITICAL'||s==='HIGH')return{headline:'UNUSUAL SPIKE DETECTED',detail:`${latestCount} crimes today vs usual ${Math.round(meanDaily)}/day — ${excess} extra incidents`,color:'#FF3B30'}; if(s==='MEDIUM')return{headline:'ABOVE AVERAGE DAY',detail:`${latestCount} crimes today vs usual ${Math.round(meanDaily)}/day`,color:'#FF9500'}; return{headline:'SLIGHTLY ELEVATED',detail:`${latestCount} crimes today vs usual ${Math.round(meanDaily)}/day`,color:'#D2FF00'}; };
const riskColor  = (r?:string) => r==='High'?'#FF3B30':r==='Medium'?'#FF9500':'#34C759';
const riskBg     = (r?:string) => r==='High'?'rgba(255,59,48,0.1)':r==='Medium'?'rgba(255,149,0,0.1)':'rgba(52,199,89,0.1)';
const sevColor   = (s?:string) => { const v=(s||'').toUpperCase(); return v==='CRITICAL'?'#FF2D55':v==='HIGH'?'#FF3B30':v==='MEDIUM'?'#FF9500':'#5AC8FA'; };
const deriveSeverity = (ev:Event) => { if(ev.severity)return ev.severity.toUpperCase(); const ct=(ev.crime_types||'').toUpperCase(); if(ct.match(/MURDER|RAPE|KIDNAP|DACOITY/))return 'CRITICAL'; if(ct.match(/ROBBERY|ASSAULT|RIOT|ARSON/))return 'HIGH'; if(ct.match(/THEFT|BURGLARY|FRAUD|CYBER/))return 'MEDIUM'; return 'LOW'; };

const ZONE_CENTERS:Record<string,[number,number]> = { Z01:[18.9067,72.8147],Z02:[18.9438,72.8249],Z03:[19.0396,72.8528],Z04:[19.0596,72.8295],Z05:[19.1197,72.8468],Z06:[19.2294,72.8567],Z07:[19.0726,72.8847],Z08:[19.0867,72.9081],Z09:[19.1726,72.9563],Z10:[19.1197,72.9070],Z11:[19.0330,73.0297],Z12:[19.2183,72.9781] };

// ─── Shared UI ────────────────────────────────────────────────────────────────
const Spinner = () => (
  <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'4rem',flexDirection:'column',gap:'1rem'}}>
    <div style={{width:32,height:32,border:'2px solid rgba(255,255,255,0.06)',borderTop:'2px solid #D2FF00',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
    <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.5rem',color:'var(--text-3)',letterSpacing:'0.3em'}}>LOADING...</div>
  </div>
);
const EmptyState = ({icon,msg}:{icon:string;msg:string}) => (
  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'4rem',gap:'1rem'}}>
    <div style={{fontSize:'2.5rem',opacity:0.3}}>{icon}</div>
    <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.5rem',letterSpacing:'0.3em',color:'var(--text-3)'}}>{msg}</div>
  </div>
);
const ErrorState = ({msg,onRetry}:{msg:string;onRetry:()=>void}) => (
  <div style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'3rem',gap:'1rem'}}>
    <div style={{color:'#FF3B30',fontFamily:'Space Mono,monospace',fontSize:'0.6rem',letterSpacing:'0.15em'}}>⚠ {msg}</div>
    <button onClick={onRetry} className="back-btn">RETRY</button>
  </div>
);

// ─── Scroll-reveal hook ───────────────────────────────────────────────────────
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.scroll-section');
    const io  = new IntersectionObserver(
      entries => entries.forEach(e => { if(e.isIntersecting) e.target.classList.add('revealed'); }),
      { threshold: 0.08 }
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// ─── Scroll progress bar ─────────────────────────────────────────────────────
function ScrollBar() {
  const [pct,setPct] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el  = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setPct(max > 0 ? (window.scrollY / max) * 100 : 0);
    };
    window.addEventListener('scroll', onScroll, {passive:true});
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return <div style={{position:'fixed',top:0,left:0,height:'2px',width:`${pct}%`,background:'var(--lime)',zIndex:9999,transition:'width 0.1s linear',boxShadow:'0 0 8px var(--lime)'}} />;
}

// ─── Animated count-up ───────────────────────────────────────────────────────
function CountUp({to,duration=1200}:{to:number;duration?:number}) {
  const [val,setVal] = useState(0);
  useEffect(() => {
    if(!to) return;
    let start = 0;
    const step = Math.ceil(to / (duration / 16));
    const id = setInterval(() => {
      start = Math.min(start + step, to);
      setVal(start);
      if(start >= to) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [to]);
  return <>{val}</>;
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHead({index,eyebrow,title,status,statusColor}:{index:string;eyebrow:string;title:string;status?:string;statusColor?:string}) {
  return (
    <div style={{marginBottom:'3rem'}}>
      <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.5rem',letterSpacing:'0.35em',color:'var(--lime)',opacity:0.5,marginBottom:'0.4rem'}}>{index}</div>
      <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.48rem',letterSpacing:'0.35em',color:'var(--text-3)',marginBottom:'0.4rem'}}>{eyebrow}</div>
      <div style={{display:'flex',alignItems:'center',gap:'1rem'}}>
        <div style={{fontFamily:'Space Mono,monospace',fontSize:'clamp(1rem,2.5vw,1.5rem)',fontWeight:700,letterSpacing:'0.1em',color:'var(--text-1)'}}>{title}</div>
        {status && <div style={{marginLeft:'auto',fontFamily:'Space Mono,monospace',fontSize:'0.5rem',letterSpacing:'0.2em',color:statusColor||'var(--lime)',animation:'pulse 2s ease-in-out infinite'}}>{status}</div>}
      </div>
      <div style={{marginTop:'1.25rem',height:'1px',background:`linear-gradient(to right, var(--lime), transparent)`,opacity:0.15}} />
    </div>
  );
}

// ─── IntelBrick ───────────────────────────────────────────────────────────────
function IntelBrick({zone,zoneName,headline,detail,action,crimeType,extra,color,index}:{zone:string;zoneName?:string;headline:string;detail:string;action?:string;crimeType?:string;extra?:string;color:string;index:number}) {
  return (
    <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:index*0.05,duration:0.4,ease:[0.22,1,0.36,1]}}
      className="tactical-card" style={{borderLeft:`3px solid ${color}`,display:'flex',flexDirection:'column',gap:'0.6rem'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.45rem',color:'var(--text-3)',letterSpacing:'0.25em'}}>ZONE</div>
          <div style={{fontWeight:900,fontSize:'1.1rem',color,letterSpacing:'0.1em',fontFamily:'Space Mono,monospace'}}>{zone}</div>
          {zoneName&&<div style={{fontSize:'0.48rem',color:'var(--text-3)',letterSpacing:'0.1em',marginTop:2}}>{zoneName.toUpperCase()}</div>}
        </div>
        {action&&(
          <div style={{textAlign:'right'}}>
            <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.45rem',color:'var(--text-3)',letterSpacing:'0.2em',marginBottom:2}}>ACTION</div>
            <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.6rem',fontWeight:900,color,letterSpacing:'0.1em',padding:'4px 10px',border:`1px solid ${color}44`,background:`${color}11`,transition:'all 0.2s'}}>{action}</div>
          </div>
        )}
      </div>
      <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.8rem',fontWeight:900,color,letterSpacing:'0.08em'}}>{headline}</div>
      <div style={{fontSize:'0.65rem',color:'var(--text-2)',lineHeight:1.7}}>{detail}</div>
      {crimeType&&<div style={{display:'inline-block',padding:'3px 10px',fontFamily:'Space Mono,monospace',fontSize:'0.5rem',letterSpacing:'0.1em',border:'1px solid rgba(210,255,0,0.2)',color:'#D2FF00',background:'rgba(210,255,0,0.05)',alignSelf:'flex-start',transition:'background 0.2s'}}>{crimeType.replace(/_/g,' ')}</div>}
      {extra&&<div style={{fontFamily:'Space Mono,monospace',fontSize:'0.48rem',color:'var(--text-3)',letterSpacing:'0.1em',borderTop:'1px solid rgba(255,255,255,0.04)',paddingTop:'0.4rem',marginTop:'0.2rem'}}>{extra}</div>}
    </motion.div>
  );
}

// ─── WeeklyScheduler ─────────────────────────────────────────────────────────
function WeeklyScheduler({velocity}:{velocity:ZoneVelocity[]}) {
  const [schedule,setSchedule]=useState<any[]>([]);
  const generate=()=>{ const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']; setSchedule(days.map(day=>({day,shift:day.startsWith('S')?'Double':'Standard',mult:day.startsWith('S')?1.5:1.0}))); };
  return(
    <div style={{marginTop:'2rem'}}>
      <button onClick={generate} className="back-btn" style={{marginBottom:'1.5rem'}}>GENERATE SCHEDULE</button>
      <AnimatePresence>
        {schedule.length>0&&(
          <motion.table initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0}} style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr>
              <th>DAY</th><th>SHIFT TYPE</th><th>STAFFING</th>
            </tr></thead>
            <tbody>{schedule.map((s,i)=>(
              <motion.tr key={i} initial={{opacity:0,x:-12}} animate={{opacity:1,x:0}} transition={{delay:i*0.06}}>
                <td style={{fontFamily:'Space Mono,monospace',fontWeight:900,color:'#D2FF00'}}>{s.day.toUpperCase()}</td>
                <td style={{color:'var(--text-2)'}}>{s.shift}</td>
                <td style={{fontFamily:'Space Mono,monospace',fontWeight:900,color:s.mult>1?'#FF9500':'#34C759'}}>{s.mult>1?'DOUBLE STRENGTH':'STANDARD STRENGTH'}</td>
              </motion.tr>
            ))}</tbody>
          </motion.table>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── AIIntakeSection ──────────────────────────────────────────────────────────
function AIIntakeSection() {
  const [complaint,setComplaint]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [result,setResult]=useState<any>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [dragOver,setDragOver]=useState(false);
  const fileInputRef=useRef<HTMLInputElement>(null);
  const analyze=async()=>{ setLoading(true);setError(null); try{ let res; if(file){const fd=new FormData();fd.append('file',file);res=await axios.post('/api/fir/analyze-pdf',fd,{headers:{'Content-Type':'multipart/form-data'}});}else{res=await axios.post('/api/fir/analyze',{text:complaint});} setResult(res.data); }catch(e:any){setError(e?.response?.data?.detail||'Analysis failed.');}finally{setLoading(false);}  };
  const clearFile=()=>{setFile(null);if(fileInputRef.current)fileInputRef.current.value='';};
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem',marginBottom:'1rem'}}>
        <div
          onClick={()=>fileInputRef.current?.click()}
          onDragOver={e=>{e.preventDefault();setDragOver(true);}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault();setDragOver(false);if(e.dataTransfer.files?.[0]){setFile(e.dataTransfer.files[0]);setComplaint('');}}}
          style={{border:`2px dashed ${dragOver?'var(--lime)':file?'rgba(210,255,0,0.4)':'rgba(255,255,255,0.1)'}`,padding:'2rem',textAlign:'center',cursor:'pointer',background:dragOver?'rgba(210,255,0,0.06)':file?'rgba(210,255,0,0.03)':'transparent',transition:'all 0.2s',boxShadow:dragOver?'0 0 20px rgba(210,255,0,0.15)':'none'}}>
          <div style={{fontSize:'2rem',marginBottom:'0.5rem'}}>{file?'📄':'📤'}</div>
          <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.55rem',letterSpacing:'0.2em',color:file?'#D2FF00':'var(--text-3)'}}>{file?file.name.toUpperCase():'DROP PDF OR CLICK TO UPLOAD'}</div>
          {file&&<button onClick={e=>{e.stopPropagation();clearFile();}} style={{background:'none',border:'none',color:'#FF3B30',fontSize:'0.6rem',marginTop:'0.5rem',cursor:'pointer',fontFamily:'Space Mono,monospace',letterSpacing:'0.1em'}}>REMOVE ✕</button>}
        </div>
        <textarea value={complaint} onChange={e=>{setComplaint(e.target.value);setFile(null);}} disabled={!!file}
          placeholder="OR PASTE FIR TEXT MANUALLY..."
          style={{width:'100%',minHeight:'130px',padding:'1rem',resize:'none',opacity:file?0.3:1}}/>
      </div>
      <input type="file" ref={fileInputRef} onChange={e=>{if(e.target.files?.[0]){setFile(e.target.files[0]);setComplaint('');}}} accept=".pdf" style={{display:'none'}}/>
      <button onClick={analyze} className="back-btn" disabled={!complaint&&!file} style={{width:'100%',justifyContent:'center'}}>
        {loading?'READING FIR...':'ANALYSE FIR'}
      </button>
      {loading&&<Spinner/>}
      {error&&<ErrorState msg={error} onRetry={analyze}/>}
      <AnimatePresence>
        {result&&!loading&&(
          <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0}} style={{marginTop:'2rem',borderTop:'1px solid rgba(210,255,0,0.15)',paddingTop:'1.5rem'}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:'1px',background:'var(--border)',marginBottom:'1px'}}>
              {[{label:'ACCUSED NAME',val:result.accused_name,color:'#D2FF00'},{label:'LOCATION',val:result.location},{label:'CRIME TYPE',val:result.crime_type,color:'#FF3B30'},{label:'DATE / TIME',val:result.date_time}]
                .map((item,i)=>(<div key={i} className="tactical-card" style={{padding:'1rem'}}><div className="card-label">{item.label}</div><div style={{fontWeight:900,color:item.color||'var(--text-1)',fontSize:'0.8rem'}}>{item.val||'—'}</div></div>))}
            </div>
            <div className="tactical-card" style={{marginTop:'1px'}}><div className="card-label">CASE SUMMARY</div><div style={{fontSize:'0.75rem',lineHeight:1.7,color:'var(--text-2)'}}>{result.description_summary}</div></div>
            {result.suggested_ipc_sections?.length>0&&(
              <div className="tactical-card" style={{marginTop:'1px'}}>
                <div className="card-label">APPLICABLE IPC SECTIONS</div>
                <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',marginTop:'0.5rem'}}>
                  {result.suggested_ipc_sections.map((s:string,i:number)=>(<span key={i} style={{background:'rgba(210,255,0,0.08)',padding:'4px 10px',fontFamily:'Space Mono,monospace',fontSize:'0.55rem',border:'1px solid rgba(210,255,0,0.25)',color:'#D2FF00',letterSpacing:'0.08em',transition:'background 0.2s'}}>{s}</span>))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── NeuralNodePanel ──────────────────────────────────────────────────────────
function NeuralNodePanel() {
  const [hotspots,setHotspots]=useState<any[]>([]);
  const [anomalies,setAnomalies]=useState<any[]>([]);
  const [forecast,setForecast]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const fetch=useCallback(async()=>{ setLoading(true);setError(null); try{ const [hs,an,fc]=await Promise.allSettled([axios.get('/api/ml/hotspot-zones?top_n=8&hours_ahead=3'),axios.get('/api/ml/anomalies?days=30'),axios.get('/api/ml/hawkes-forecast?top_n=6')]); if(hs.status==='fulfilled')setHotspots(Array.isArray(hs.value.data)?hs.value.data:[]); if(an.status==='fulfilled')setAnomalies(Array.isArray(an.value.data)?an.value.data:[]); if(fc.status==='fulfilled')setForecast(Array.isArray(fc.value.data)?fc.value.data:[]); }catch(e:any){setError(e?.response?.data?.detail||'Failed.');}finally{setLoading(false);} },[]);
  useEffect(()=>{fetch();},[fetch]);
  if(loading)return<Spinner/>;
  if(error)return<ErrorState msg={error} onRetry={fetch}/>;
  if(!hotspots.length&&!anomalies.length)return<EmptyState icon="🧠" msg="NO DATA — RUN seed_real_data.py"/>;
  const criticalCount=hotspots.filter(h=>h.risk_level==='CRITICAL').length;
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',background:'var(--border)',marginBottom:'3rem'}}>
        {[{label:'DEPLOY NOW',val:criticalCount,color:'#FF3B30'},{label:'UNUSUAL SPIKES',val:anomalies.length,color:'#FF9500'},{label:'ZONES MONITORED',val:forecast.length,color:'#D2FF00'}]
          .map((s,i)=>(<div key={i} className="tactical-card" style={{textAlign:'center',padding:'2rem'}}><div style={{fontFamily:'Space Mono,monospace',fontSize:'2.5rem',fontWeight:900,color:s.color,textShadow:`0 0 20px ${s.color}44`}}>{s.val}</div><div className="card-label" style={{marginTop:'0.5rem'}}>{s.label}</div></div>))}
      </div>
      {hotspots.length>0&&(<><div className="section-label">WHERE TO DEPLOY — NEXT 3 HRS</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'1px',background:'var(--border)',marginBottom:'2rem'}}>{hotspots.map((h,i)=>{const urg=intensityToUrgency(h.predicted_intensity,h.crimes_last_24h);return<IntelBrick key={i} index={i} zone={h.zone_id} headline={urg.label} detail={urg.detail} action={riskToAction(h.risk_level)} crimeType={h.top_crime_type} color={urg.color}/>;})}</div></>)}
      {anomalies.length>0&&(<><div className="section-label">UNUSUAL ACTIVITY TODAY</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'1px',background:'var(--border)',marginBottom:'2rem'}}>{anomalies.map((a,i)=>{const note=anomalyToNote(a.severity,a.latest_count,a.mean_daily);return<IntelBrick key={i} index={i} zone={a.zone_id} headline={note.headline} detail={note.detail} action={riskToAction(a.severity)} color={note.color} extra={`30-DAY AVERAGE: ${Math.round(a.mean_daily)} crimes/day`}/>;})}</div></>)}
      {forecast.length>0&&(<><div className="section-label">6-HOUR ZONE OUTLOOK</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'1px',background:'var(--border)'}}>{forecast.map((f,i)=>{const pl=f.peak_risk==='CRITICAL'?'PEAK DANGER EXPECTED':f.peak_risk==='HIGH'?'HIGH ACTIVITY EXPECTED':'MODERATE ACTIVITY';const pc=f.peak_risk==='CRITICAL'?'#FF3B30':f.peak_risk==='HIGH'?'#FF9500':'#D2FF00';return<IntelBrick key={i} index={i} zone={f.zone_id} headline={pl} detail={`Peak in ${f.peak_hour_offset}h. ${f.crime_count_24h} incidents last 24h.`} action={riskToAction(f.peak_risk)} color={pc} extra="FORECAST WINDOW: 6 HRS"/>;})}</div></>)}
    </div>
  );
}

// ─── AnomalyIndexPanel ────────────────────────────────────────────────────────
function AnomalyIndexPanel({velocity}:{velocity:ZoneVelocity[]}) {
  if(!velocity.length)return<EmptyState icon="⚡" msg="NO VELOCITY DATA"/>;
  const sorted=  [...velocity].sort((a,b)=>b.z_score-a.z_score);
  const surging= sorted.filter(z=>z.z_score>3);
  const elevated=sorted.filter(z=>z.z_score>1&&z.z_score<=3);
  const normal=  sorted.filter(z=>z.z_score<=1);
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',background:'var(--border)',marginBottom:'3rem'}}>
        {[{label:'SURGING ZONES',val:surging.length,color:'#FF3B30'},{label:'ELEVATED ZONES',val:elevated.length,color:'#FF9500'},{label:'QUIET ZONES',val:normal.length,color:'#34C759'}]
          .map((s,i)=>(<div key={i} className="tactical-card" style={{textAlign:'center',padding:'2rem'}}><div style={{fontFamily:'Space Mono,monospace',fontSize:'2.5rem',fontWeight:900,color:s.color,textShadow:`0 0 20px ${s.color}44`}}><CountUp to={s.val}/></div><div className="card-label" style={{marginTop:'0.5rem'}}>{s.label}</div></div>))}
      </div>
      {surging.length>0&&(<><div className="section-label" style={{color:'#FF3B30'}}>⚠ NEEDS IMMEDIATE ATTENTION</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'1px',background:'var(--border)',marginBottom:'2rem'}}>{surging.map((z,i)=>{const h=zToHeat(z.z_score);return<IntelBrick key={z.zone_id} index={i} zone={z.zone_id} zoneName={z.zone_name} headline={h.label} detail={`${z.current_1h} incidents this hour vs usual ${z.mean_1h?.toFixed(0)}/hr. ${h.sub}.`} action="DEPLOY IMMEDIATELY" color={h.color}/>;})}</div></>)}
      {elevated.length>0&&(<><div className="section-label" style={{color:'#FF9500'}}>↑ ABOVE NORMAL</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:'1px',background:'var(--border)',marginBottom:'2rem'}}>{elevated.map((z,i)=>{const h=zToHeat(z.z_score);return<IntelBrick key={z.zone_id} index={i} zone={z.zone_id} zoneName={z.zone_name} headline={h.label} detail={`${z.current_1h} incidents this hour vs usual ${z.mean_1h?.toFixed(0)}/hr.`} action="INCREASE PATROLS" color={h.color}/>;})}</div></>)}
      {normal.length>0&&(<><div className="section-label" style={{color:'#34C759'}}>● QUIET ZONES</div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:'1px',background:'var(--border)'}}>{normal.map((z,i)=>(<motion.div key={z.zone_id} className="tactical-card" initial={{opacity:0}} animate={{opacity:1}} transition={{delay:Math.min(i*0.03,0.5)}} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1rem 1.5rem',borderLeft:'2px solid #34C759'}}><div><div style={{fontFamily:'Space Mono,monospace',fontWeight:900,fontSize:'0.75rem',letterSpacing:'0.15em',color:'var(--text-1)'}}>{z.zone_id}</div><div style={{fontSize:'0.48rem',color:'var(--text-3)',marginTop:2}}>{z.zone_name.toUpperCase()}</div></div><div style={{textAlign:'right'}}><div style={{fontFamily:'Space Mono,monospace',fontSize:'0.6rem',fontWeight:900,color:'#34C759'}}>QUIET</div><div style={{fontSize:'0.48rem',color:'var(--text-3)',marginTop:2}}>{z.current_1h} incident{z.current_1h!==1?'s':''} this hour</div></div></motion.div>))}</div></>)}
    </div>
  );
}

// ─── OSINTPanel ───────────────────────────────────────────────────────────────
function OSINTPanel() {
  const [target,setTarget]=useState('');
  const [scanType,setScanType]=useState<'URL'|'PHONE'|'NAME'>('URL');
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<any>(null);
  const [error,setError]=useState<string|null>(null);
  const scan=async()=>{ if(!target.trim())return; setLoading(true);setResult(null);setError(null); try{ const res=await axios.post('/api/investigation/osint-scan',{target,type:scanType}); setResult(res.data); }catch(backendErr:any){ if(backendErr.response?.status===404||backendErr.response?.status===405){ const flags:string[]=[];let score=50; if(scanType==='URL'){if(target.includes('bit.ly')||target.includes('tinyurl')){flags.push('URL SHORTENER DETECTED');score+=20;}if(!target.startsWith('https')){flags.push('NOT HTTPS');score+=15;}if(target.includes('login')||target.includes('verify')){flags.push('PHISHING KEYWORD');score+=20;}} if(/^[+]?[0-9]{10,13}$/.test(target.replace(/\s/g,''))&&target.startsWith('+91'))flags.push('INDIA-REGISTERED NUMBER'); score=Math.min(score,95); const verdict=score>70?'HIGH RISK':score>50?'SUSPICIOUS':'APPEARS CLEAN'; setResult({target,type:scanType,trust_score:score,verdict,flags,source:'HEURISTIC',scanned_at:new Date().toISOString()}); }else{setError(backendErr?.response?.data?.detail||'Scan failed.');} }finally{setLoading(false);}  };
  const verdictColor=(v:string)=>v?.includes('HIGH')?'#FF3B30':v?.includes('SUSPICIOUS')?'#FF9500':'#34C759';
  return(
    <div>
      <div style={{display:'flex',gap:'0.5rem',marginBottom:'1.5rem',flexWrap:'wrap'}}>
        {(['URL','PHONE','NAME'] as const).map(t=>(<button key={t} onClick={()=>setScanType(t)} style={{padding:'0.6rem 1.25rem',border:`1px solid ${scanType===t?'var(--lime)':'rgba(255,255,255,0.1)'}`,background:scanType===t?'rgba(210,255,0,0.08)':'transparent',color:scanType===t?'#D2FF00':'var(--text-3)',fontFamily:'Space Mono,monospace',fontSize:'0.55rem',cursor:'pointer',letterSpacing:'0.15em',transition:'all 0.2s'}}>{t==='URL'?'WEBSITE LINK':t==='PHONE'?'PHONE NUMBER':'PERSON NAME'}</button>))}
      </div>
      <div style={{display:'flex',gap:'1rem',marginBottom:'1.5rem'}}>
        <input value={target} onChange={e=>setTarget(e.target.value)} onKeyDown={e=>e.key==='Enter'&&scan()} placeholder={scanType==='URL'?'Paste suspicious link...':scanType==='PHONE'?'+91 XXXXXXXXXX':'Enter suspect name...'} style={{flex:1,padding:'0.9rem 1rem',fontSize:'0.7rem'}}/>
        <button onClick={scan} disabled={!target.trim()||loading} className="back-btn" style={{minWidth:120}}>{loading?'CHECKING...':'CHECK NOW'}</button>
      </div>
      {loading&&<Spinner/>}
      {error&&<ErrorState msg={error} onRetry={scan}/>}
      <AnimatePresence>
        {result&&!loading&&(
          <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0}}
            className="tactical-card" style={{borderLeft:`4px solid ${verdictColor(result.verdict)}`}}>
            {result.source==='HEURISTIC'&&<div style={{fontFamily:'Space Mono,monospace',fontSize:'0.5rem',color:'#FF9500',letterSpacing:'0.15em',marginBottom:'1rem',padding:'0.5rem',background:'rgba(255,149,0,0.06)',border:'1px solid rgba(255,149,0,0.2)'}}>⚠ HEURISTIC CHECK — backend scanner not connected</div>}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
              <div><div className="card-label">VERDICT</div><div style={{fontFamily:'Space Mono,monospace',fontWeight:900,fontSize:'1.4rem',color:verdictColor(result.verdict),letterSpacing:'0.1em',marginTop:4}}>{result.verdict}</div></div>
              <div style={{textAlign:'right'}}><div className="card-label">RISK SCORE</div><div style={{fontFamily:'Space Mono,monospace',fontSize:'3rem',fontWeight:900,color:verdictColor(result.verdict),lineHeight:1}}>{result.trust_score}</div></div>
            </div>
            {result.flags?.length>0&&(<div>{result.flags.map((f:string,i:number)=>(<div key={i} style={{padding:'0.6rem 1rem',marginBottom:'0.4rem',background:'rgba(255,59,48,0.05)',border:'1px solid rgba(255,59,48,0.15)',color:'#FF3B30',fontFamily:'Space Mono,monospace',fontSize:'0.6rem',letterSpacing:'0.1em'}}>⚠ {f}</div>))}</div>)}
            {result.flags?.length===0&&<div style={{fontFamily:'Space Mono,monospace',fontSize:'0.6rem',color:'#34C759',letterSpacing:'0.1em'}}>✓ NO PROBLEMS DETECTED</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── OffenderSection ─────────────────────────────────────────────────────────
function OffenderSection({offenders}:{offenders:Offender[]}) {
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState('ALL');
  const [selected,setSelected]=useState<Offender|null>(null);
  const filtered=offenders.filter(o=>filter==='ALL'||o.predicted_risk===filter).filter(o=>!search||o.name.toLowerCase().includes(search.toLowerCase())||o.alias?.toLowerCase().includes(search.toLowerCase()));
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1px',background:'var(--border)',marginBottom:'2.5rem'}}>
        {[{label:'TOTAL TRACKED',val:offenders.length,color:'#D2FF00'},{label:'HIGH RISK',val:offenders.filter(o=>o.predicted_risk==='High').length,color:'#FF3B30'},{label:'MEDIUM RISK',val:offenders.filter(o=>o.predicted_risk==='Medium').length,color:'#FF9500'},{label:'AVG PRIOR FIRs',val:offenders.length?(offenders.reduce((a,b)=>a+b.fir_count,0)/offenders.length).toFixed(1):'0',color:'#00E5FF'}]
          .map((s,i)=>(<div key={i} className="tactical-card" style={{textAlign:'center',padding:'1.75rem'}}><div style={{fontFamily:'Space Mono,monospace',fontSize:'2.2rem',fontWeight:900,color:s.color}}>{s.val}</div><div className="card-label" style={{marginTop:'0.5rem'}}>{s.label}</div></div>))}
      </div>
      <div style={{display:'flex',gap:'0.75rem',marginBottom:'1.5rem',alignItems:'center',flexWrap:'wrap'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="SEARCH BY NAME OR ALIAS..." style={{flex:1,minWidth:200,padding:'0.75rem 1rem',fontSize:'0.7rem'}}/>
        {['ALL','High','Medium','Low'].map(r=>(<button key={r} onClick={()=>setFilter(r)} style={{padding:'0.65rem 1rem',border:`1px solid ${filter===r?'var(--lime)':'rgba(255,255,255,0.1)'}`,background:filter===r?'rgba(210,255,0,0.08)':'transparent',color:filter===r?'#D2FF00':'var(--text-3)',fontFamily:'Space Mono,monospace',fontSize:'0.55rem',letterSpacing:'0.15em',cursor:'pointer',transition:'all 0.2s'}}>{r==='ALL'?'ALL':r.toUpperCase()+' RISK'}</button>))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:selected?'1fr 380px':'1fr',gap:'1px',background:'var(--border)',alignItems:'start'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:'1px',background:'var(--border)'}}>
          {filtered.map((off,i)=>(
            <motion.div key={i} className="tactical-card" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:Math.min(i*0.04,0.5)}}
              onClick={()=>setSelected(selected?.name===off.name?null:off)}
              style={{cursor:'pointer',borderLeft:`3px solid ${riskColor(off.predicted_risk)}`,outline:selected?.name===off.name?`1px solid rgba(210,255,0,0.25)`:undefined}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1rem'}}>
                <div><div style={{fontFamily:'Space Mono,monospace',fontWeight:900,fontSize:'0.85rem',letterSpacing:'0.1em',color:'var(--text-1)'}}>{off.name}</div>{off.alias&&<div style={{fontSize:'0.5rem',color:'var(--text-3)',marginTop:2}}>AKA: {off.alias}</div>}</div>
                <span style={{padding:'3px 8px',fontFamily:'Space Mono,monospace',fontSize:'0.5rem',fontWeight:900,letterSpacing:'0.1em',background:riskBg(off.predicted_risk),color:riskColor(off.predicted_risk),border:`1px solid ${riskColor(off.predicted_risk)}44`}}>{off.predicted_risk==='High'?'HIGH':off.predicted_risk==='Medium'?'MED':'LOW'}</span>
              </div>
              <div style={{display:'flex',gap:'1.5rem',marginBottom:'0.75rem'}}>
                <div><div className="card-label">FIRs</div><div style={{fontFamily:'Space Mono,monospace',fontWeight:900,color:off.fir_count>3?'#FF3B30':'var(--text-1)'}}>{off.fir_count}</div></div>
                <div><div className="card-label">LAST SEEN</div><div style={{fontSize:'0.65rem',fontWeight:700,color:'var(--text-2)'}}>{off.last_seen?new Date(off.last_seen).toLocaleDateString('en-IN'):'UNKNOWN'}</div></div>
                <div><div className="card-label">ZONE</div><div style={{fontFamily:'Space Mono,monospace',fontSize:'0.65rem',fontWeight:700,color:'var(--text-1)'}}>{Array.isArray(off.zones)?off.zones[0]:(off.zones||'?')}</div></div>
              </div>
              {off.recidivism_probability!==undefined&&(
                <div><div style={{height:'2px',background:'rgba(255,255,255,0.06)',borderRadius:1}}><motion.div initial={{width:0}} animate={{width:Math.round(off.recidivism_probability*100)+'%'}} transition={{duration:0.8,ease:[0.22,1,0.36,1]}} style={{height:'100%',background:riskColor(off.predicted_risk),borderRadius:1}}/></div></div>
              )}
            </motion.div>
          ))}
          {filtered.length===0&&<div style={{gridColumn:'1/-1'}}><EmptyState icon="👤" msg="NO MATCHES"/></div>}
        </div>
        <AnimatePresence>
          {selected&&(
            <motion.div initial={{opacity:0,x:24}} animate={{opacity:1,x:0}} exit={{opacity:0,x:24}} transition={{duration:0.35,ease:[0.22,1,0.36,1]}}
              className="tactical-card" style={{position:'sticky',top:'80px',borderColor:'rgba(210,255,0,0.15)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'2rem'}}>
                <div className="section-label" style={{margin:0,border:'none',padding:0}}>PROFILE</div>
                <button onClick={()=>setSelected(null)} style={{background:'none',border:'1px solid rgba(255,255,255,0.1)',padding:'4px 10px',cursor:'pointer',fontFamily:'Space Mono,monospace',fontSize:'0.6rem',color:'var(--text-3)',transition:'all 0.2s'}}>✕</button>
              </div>
              <div style={{fontFamily:'Space Mono,monospace',fontSize:'1rem',fontWeight:900,letterSpacing:'0.1em',color:'var(--text-1)',marginBottom:'0.25rem'}}>{selected.name}</div>
              {selected.alias&&<div style={{fontSize:'0.55rem',color:'var(--text-3)',marginBottom:'1.5rem'}}>AKA: {selected.alias}</div>}
              {[{label:'THREAT',value:selected.predicted_risk||'UNKNOWN',color:riskColor(selected.predicted_risk)},{label:'FIRs',value:String(selected.fir_count)},{label:'LAST SEEN',value:selected.last_seen?new Date(selected.last_seen).toLocaleDateString('en-IN'):'UNKNOWN'},{label:'AREAS',value:Array.isArray(selected.zones)?selected.zones.join(', '):(selected.zones||'UNKNOWN')}]
                .map((row,i)=>(<div key={i} style={{padding:'0.75rem 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}><div className="card-label">{row.label}</div><div style={{fontWeight:700,fontSize:'0.85rem',marginTop:4,color:row.color||'var(--text-1)',fontFamily:i===0?'Space Mono,monospace':undefined}}>{row.value}</div></div>))}
              {selected.recidivism_probability!==undefined&&(
                <div style={{marginTop:'1rem'}}><div className="card-label">RE-OFFEND PROBABILITY</div>
                  <div style={{display:'flex',alignItems:'center',gap:'1rem',marginTop:8}}>
                    <div style={{flex:1,height:'4px',background:'rgba(255,255,255,0.06)',borderRadius:2}}>
                      <motion.div initial={{width:0}} animate={{width:Math.round(selected.recidivism_probability*100)+'%'}} transition={{duration:1}} style={{height:'100%',background:riskColor(selected.predicted_risk),borderRadius:2}}/>
                    </div>
                    <span style={{fontFamily:'Space Mono,monospace',fontSize:'0.75rem',fontWeight:900,color:riskColor(selected.predicted_risk)}}>{Math.round(selected.recidivism_probability*100)}%</span>
                  </div>
                </div>
              )}
              {selected.intervention_protocol&&(
                <div style={{marginTop:'1.5rem',padding:'1rem',background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.06)'}}>
                  <div className="card-label" style={{marginBottom:'0.5rem'}}>RECOMMENDED ACTION</div>
                  <div style={{fontSize:'0.65rem',lineHeight:1.7,color:'var(--text-2)'}}>{selected.intervention_protocol}</div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function MarvelDashboard() {
  const [stats,    setStats]    = useState<Stats|null>(null);
  const [velocity, setVelocity] = useState<ZoneVelocity[]>([]);
  const [alerts,   setAlerts]   = useState<Alert[]>([]);
  const [events,   setEvents]   = useState<Event[]>([]);
  const [offenders,setOffenders]= useState<Offender[]>([]);
  const [surges,   setSurges]   = useState<SurgeAlert[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [wsNewCount,setWsNewCount] = useState(0);
  const [clock,    setClock]    = useState(new Date().toLocaleTimeString());
  const [patrolPct]= useState(Math.floor(Math.random()*40)+30);

  useReveal();

  useEffect(()=>{ const t=setInterval(()=>setClock(new Date().toLocaleTimeString()),1000); return()=>clearInterval(t); },[]);

  const { connected: wsConnected } = useWebSocket({
    onNewEvent:(ev)=>{
      setEvents(prev=>{ const already=prev.some(e=>e.url===ev.url); if(already)return prev; return[ev as unknown as Event,...prev].slice(0,500); });
      setStats(prev=>prev?{...prev,total_24h:prev.total_24h+1}:prev);
      setWsNewCount(c=>c+1);
      setTimeout(()=>setWsNewCount(c=>Math.max(0,c-1)),6000);
    },
    onStatsUpdate:(s)=>setStats({total_24h:s.total_24h,critical:s.critical,warning:s.warning}),
    onAlert:(a)=>setAlerts(prev=>[a,...prev].slice(0,50)),
  });

  const detectSurges=(evs:Event[])=>{ const zones=[...new Set(evs.map(e=>e.zone))].filter(Boolean); return zones.filter(z=>evs.filter(e=>e.zone===z).length>5).map(z=>({zone:z,ratio:2.0,severity:'SURGE' as const,message:'Multiple incidents — consider deploying'})); };

  const fetchAll=useCallback(async()=>{
    try{
      const [s,v,a,e,o]=await Promise.allSettled([axios.get('/api/stats'),axios.get('/api/velocity'),axios.get('/api/alerts'),axios.get('/api/events/recent?limit=200&hours=3'),axios.get('/api/investigation/offenders')]);
      if(s.status==='fulfilled')setStats(s.value.data);
      if(v.status==='fulfilled')setVelocity(Array.isArray(v.value.data)?v.value.data:v.value.data.zones||[]);
      if(a.status==='fulfilled')setAlerts(Array.isArray(a.value.data)?a.value.data:a.value.data.alerts||[]);
      if(e.status==='fulfilled'){ const raw=e.value.data; const evs=(Array.isArray(raw)?raw:raw.events||raw.items||[]) as Event[]; setEvents(evs);setSurges(detectSurges(evs)); if(evs.length>0&&(window as any).triggerSonicPulse){ const latest=evs[0];const coords=ZONE_CENTERS[latest.zone_id||latest.zone]; if(coords)(window as any).triggerSonicPulse(coords[0],coords[1],deriveSeverity(latest)==='CRITICAL'?'HIGH':'STABLE'); } }
      if(o.status==='fulfilled')setOffenders(Array.isArray(o.value.data)?o.value.data:o.value.data.offenders||[]);
    }finally{setLoading(false);}
  },[]);

  useEffect(()=>{fetchAll();const i=setInterval(fetchAll,30000);return()=>clearInterval(i);},[fetchAll]);

  if(loading) return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--bg)',flexDirection:'column',gap:'2rem'}}>
      <motion.div animate={{opacity:[0.3,1,0.3]}} transition={{repeat:Infinity,duration:2}}
        style={{fontFamily:'Space Mono,monospace',fontSize:'2rem',fontWeight:900,letterSpacing:'0.35em',color:'var(--lime)'}}>SENTINEL</motion.div>
      <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.5rem',letterSpacing:'0.4em',color:'var(--text-3)'}}>LOADING OPERATIONS CENTER...</div>
      <div style={{width:160,height:1,background:'rgba(255,255,255,0.05)',position:'relative',overflow:'hidden'}}>
        <motion.div animate={{x:['-100%','200%']}} transition={{repeat:Infinity,duration:1.4,ease:'easeInOut'}}
          style={{position:'absolute',width:'50%',height:'100%',background:'linear-gradient(90deg,transparent,var(--lime),transparent)'}}/>
      </div>
    </div>
  );

  return(
    <div className="dashboard-container">
      <ScrollBar/>
      <div className="scanline-overlay"/>

      {/* ── HEADER ── */}
      <header className="hud-header">
        <div className="system-title glitch-text">SENTINEL<span>.HUD</span></div>
        <div style={{display:'flex',gap:'2rem',alignItems:'center'}}>
          <div className="status-indicator" style={{borderRight:'1px solid var(--border)',paddingRight:'2rem'}}>
            <div className="pulse-dot"/>
            <span>{stats?`${stats.total_24h} INCIDENTS TODAY`:'CONNECTING...'}</span>
          </div>
          <div className="status-indicator">
            <div style={{width:7,height:7,borderRadius:'50%',background:wsConnected?'var(--green)':'var(--red)',boxShadow:wsConnected?'0 0 8px var(--green)':'0 0 8px var(--red)',transition:'all 0.5s'}}/>
            <span style={{color:wsConnected?'var(--green)':'var(--red)'}}>{wsConnected?'LIVE PUSH':'POLLING'}</span>
          </div>
          <AnimatePresence>
            {wsNewCount>0&&(
              <motion.div initial={{scale:0,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0,opacity:0}}
                style={{padding:'3px 10px',fontFamily:'Space Mono,monospace',fontSize:'0.5rem',letterSpacing:'0.15em',background:'rgba(210,255,0,0.1)',border:'1px solid rgba(210,255,0,0.35)',color:'var(--lime)'}}>
                +{wsNewCount} NEW
              </motion.div>
            )}
          </AnimatePresence>
          <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.65rem',color:'var(--lime)',letterSpacing:'0.15em',fontWeight:700}}>{clock}</div>
        </div>
      </header>

      {/* ════════════════════════════════════════════════
          SECTION 0 — STATS BAR
      ════════════════════════════════════════════════ */}
      <div className="scroll-section revealed" style={{padding:'3rem',borderBottom:'1px solid var(--border)'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',background:'var(--border)'}}>
          {[{label:'INCIDENTS TODAY',val:stats?.total_24h||0,color:'var(--lime)'},{label:'CRITICAL — ACT NOW',val:stats?.critical||0,color:'var(--red)'},{label:'WARNINGS',val:stats?.warning||0,color:'var(--orange)'}]
            .map((s,i)=>(
              <div key={i} className="hub-stat-cell">
                <div className="hub-stat-val" style={{color:s.color}}><CountUp to={s.val}/></div>
                <div className="card-label" style={{marginTop:'0.75rem'}}>{s.label}</div>
              </div>
            ))}
        </div>
      </div>

      {/* ════════════════════════════════════════════════
          SECTION 1 — ANOMALY INDEX
      ════════════════════════════════════════════════ */}
      <div className="scroll-section from-left" id="s-anomaly">
        <SectionHead index="01" eyebrow="REAL-TIME ZONE VELOCITY" title="ANOMALY INDEX" status="● LIVE" />
        <AnomalyIndexPanel velocity={velocity}/>
      </div>

      <div className="section-divider"/>

      {/* ════════════════════════════════════════════════
          SECTION 2 — CRIME MAP
      ════════════════════════════════════════════════ */}
      <div className="scroll-section from-right" id="s-map">
        <SectionHead index="02" eyebrow="SPATIAL INTELLIGENCE" title="CRIME HEAT MAP" status="● LIVE" />
        <div style={{border:'1px solid var(--border)',overflow:'hidden',transition:'border-color 0.3s'}}>
          <CrimeMap/>
        </div>
        <div className="strategic-tray" style={{marginTop:'1px'}}>
          <div className="tray-item"><div className="card-label">HOTTEST ZONES</div>{[...velocity].sort((a,b)=>b.z_score-a.z_score).slice(0,3).map(z=>(<div key={z.zone_id} style={{display:'flex',justifyContent:'space-between',margin:'6px 0',fontSize:'0.7rem'}}><span style={{color:'var(--text-2)'}}>{z.zone_id} – {z.zone_name}</span><span style={{color:zToHeat(z.z_score).color,fontFamily:'Space Mono,monospace',fontWeight:700}}>{zToHeat(z.z_score).label}</span></div>))}</div>
          <div className="tray-item"><div className="card-label">INCIDENT TYPES</div><div style={{display:'flex',flexDirection:'column',gap:'0.4rem',marginTop:'0.5rem'}}>{[['🔴','Theft / Robbery','#FF3B30'],['🟠','Assault','#FF9500'],['🔵','Cyber Crime','var(--cyan)']].map(([dot,label,color],i)=>(<div key={i} style={{fontSize:'0.6rem',color:color as string}}>{dot} {label}</div>))}</div></div>
          <div className="tray-item"><div className="card-label">OFFICERS ON PATROL</div><div style={{fontFamily:'Space Mono,monospace',fontSize:'2rem',fontWeight:900,color:'var(--cyan)',textShadow:'0 0 12px var(--cyan)',transition:'text-shadow 0.3s'}}>{patrolPct}%</div></div>
          <div className="tray-item"><div className="card-label">CLUSTER ALERT</div><div style={{fontFamily:'Space Mono,monospace',color:surges.length>0?'var(--red)':'var(--green)',fontWeight:900,fontSize:'0.8rem',letterSpacing:'0.1em',marginTop:4,transition:'color 0.5s'}}>{surges.length>0?`⚠ ${surges.length} ZONE${surges.length>1?'S':''} CLUSTERING`:'● ALL CLEAR'}</div></div>
        </div>
      </div>

      <div className="section-divider"/>

      {/* ════════════════════════════════════════════════
          SECTION 3 — NEURAL NODE
      ════════════════════════════════════════════════ */}
      <div className="scroll-section from-left" id="s-neural">
        <SectionHead index="03" eyebrow="AI PREDICTIONS · HAWKES PROCESS" title="NEURAL NODE" status="🧠 ACTIVE" statusColor="var(--cyan)"/>
        <NeuralNodePanel/>
      </div>

      <div className="section-divider"/>

      {/* ════════════════════════════════════════════════
          SECTION 4 — TACTICAL DEPLOY
      ════════════════════════════════════════════════ */}
      <div className="scroll-section from-right" id="s-tactical">
        <SectionHead index="04" eyebrow="LP OPTIMIZER · FORCE SCHEDULING" title="TACTICAL DEPLOY" status="⚡ DYNAMIC" statusColor="var(--orange)"/>
        <div className="section-label">WEEKLY PATROL SCHEDULE</div>
        <WeeklyScheduler velocity={velocity}/>
        <div style={{marginTop:'3rem'}}>
          <div className="section-label">FORCE ALLOCATION OPTIMIZER</div>
          <ForceAllocator/>
        </div>
      </div>

      <div className="section-divider"/>

      {/* ════════════════════════════════════════════════
          SECTION 5 — INTEL STREAM
      ════════════════════════════════════════════════ */}
      <div className="scroll-section from-left" id="s-intel">
        <SectionHead index="05" eyebrow="LIVE INCIDENT FEED · LAST 3 HRS" title="INTEL STREAM" status={wsConnected?'● STREAMING':'○ POLLING'} statusColor={wsConnected?'var(--green)':'var(--orange)'}/>
        <IntelStreamPanel/>
      </div>

      <div className="section-divider"/>

      {/* ════════════════════════════════════════════════
          SECTION 6 — OFFENDER PROFILES
      ════════════════════════════════════════════════ */}
      <div className="scroll-section from-right" id="s-offenders">
        <SectionHead index="06" eyebrow="KNOWN OFFENDERS · RECIDIVISM AI" title="OFFENDER PROFILES" status={`${offenders.length} TRACKED`} statusColor="var(--text-2)"/>
        {offenders.length===0?<EmptyState icon="👤" msg="NO OFFENDERS IN DATABASE"/>:<OffenderSection offenders={offenders}/>}
      </div>

      <div className="section-divider"/>

      {/* ════════════════════════════════════════════════
          SECTION 7 — OSINT SCANNER
      ════════════════════════════════════════════════ */}
      <div className="scroll-section from-left" id="s-osint">
        <SectionHead index="07" eyebrow="LINK · PHONE · IDENTITY CHECK" title="OSINT SCANNER" status="🔍 READY" statusColor="var(--text-2)"/>
        <OSINTPanel/>
      </div>

      <div className="section-divider"/>

      {/* ════════════════════════════════════════════════
          SECTION 8 — AI FIR INTAKE
      ════════════════════════════════════════════════ */}
      <div className="scroll-section from-right" id="s-fir">
        <SectionHead index="08" eyebrow="AUTO-EXTRACT · GEMINI AI" title="AI FIR INTAKE" status="🤖 GEMINI" statusColor="var(--cyan)"/>
        <AIIntakeSection/>
      </div>

      <div className="section-divider"/>

      {/* ════════════════════════════════════════════════
          SECTION 9 — DISPATCH BOARD
      ════════════════════════════════════════════════ */}
      <div className="scroll-section from-left" id="s-dispatch">
        <SectionHead index="09" eyebrow="OFFICER TASK TRACKING" title="DISPATCH BOARD" status="● ACTIVE" statusColor="var(--orange)"/>
        <DispatchBoard/>
      </div>

      {/* ════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════ */}
      <div style={{padding:'2rem 3rem',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'1rem'}}>
        <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.45rem',letterSpacing:'0.25em',color:'var(--text-3)'}}>SENTINEL · MAHARASHTRA POLICE AI OPERATIONS</div>
        <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.45rem',letterSpacing:'0.25em',color:'var(--text-3)'}}>CLASSIFICATION: RESTRICTED · FOR AUTHORIZED PERSONNEL ONLY</div>
        <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.45rem',letterSpacing:'0.25em',color:'var(--text-3)'}}>© 2026 SENTINEL SYSTEMS</div>
      </div>

      {/* ── TICKER ── */}
      <div className="live-ticker-wrap">
        <div style={{display:'flex',animation:'ticker 40s linear infinite',gap:'4rem',whiteSpace:'nowrap'}}>
          {alerts.map((a,i)=>(<span key={i} style={{color:a.severity==='CRITICAL'?'var(--red)':a.severity==='HIGH'?'var(--orange)':'var(--lime)',transition:'color 0.3s'}}>▸ {a.zone} : {a.message}</span>))}
          <span style={{color:'var(--text-3)'}}>[ SENTINEL v4.0 // LIVE // {new Date().toLocaleDateString('en-IN')} ]</span>
        </div>
      </div>

      {/* ── COPILOT ── */}
      <div style={{position:'fixed',bottom:'80px',right:'2.5rem',zIndex:10000}}><MahaCrimeCopilot/></div>

      {/* ── SURGE ALERTS ── */}
      <AnimatePresence>
        {surges.length>0&&(
          <motion.div initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:20}}
            style={{position:'fixed',top:'80px',right:'2rem',width:'260px',pointerEvents:'none',zIndex:999}}>
            <div style={{fontFamily:'Space Mono,monospace',fontSize:'0.5rem',letterSpacing:'0.3em',color:'var(--red)',marginBottom:'0.5rem'}}>⚠ ZONES CLUSTERING NOW</div>
            {surges.slice(0,3).map((s,i)=>(
              <motion.div key={i} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.1}}
                style={{pointerEvents:'auto',marginBottom:'2px',padding:'0.75rem 1rem',border:'1px solid rgba(255,59,48,0.25)',background:'rgba(255,59,48,0.05)',transition:'background 0.2s'}}>
                <div style={{fontFamily:'Space Mono,monospace',fontWeight:900,fontSize:'0.75rem',color:'var(--red)'}}>{s.zone}</div>
                <div style={{fontSize:'0.55rem',color:'var(--text-2)',marginTop:2}}>{s.message}</div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
