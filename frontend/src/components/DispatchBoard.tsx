import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

interface DispatchAlert { title: string; severity: string; zone_id: string | null; zone: string | null; }
interface DispatchTask {
  id: number; alert_id: number | null; user_id: number;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';
  notes: string; created_at: string | null; updated_at: string | null;
  alert: DispatchAlert | null;
}
interface Summary { counts: { PENDING: number; ACKNOWLEDGED: number; RESOLVED: number }; total: number; }

const sevColor = (s?: string) => { const v=(s||'').toUpperCase(); if(v==='CRITICAL')return'#FF2D55'; if(v==='HIGH')return'#FF3B30'; if(v==='WARNING'||v==='MEDIUM')return'#FF9500'; return'#5AC8FA'; };
const statusColor = (s: string) => { if(s==='PENDING')return'#FF3B30'; if(s==='ACKNOWLEDGED')return'#FF9500'; if(s==='RESOLVED')return'#34C759'; return'#888'; };
const statusIcon = (s: string) => { if(s==='PENDING')return'🔴'; if(s==='ACKNOWLEDGED')return'🟠'; if(s==='RESOLVED')return'✅'; return'○'; };
const fmt = (iso: string|null) => iso ? new Date(iso).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '--:--';

const G = { base:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.08)', shine:'inset 0 1px 0 rgba(255,255,255,0.08)', blur:'blur(18px) saturate(160%)' };

const Spinner = () => (
  <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'4rem',flexDirection:'column',gap:'1rem'}}>
    <div style={{width:32,height:32,border:'2px solid rgba(255,255,255,0.08)',borderTop:'2px solid #D2FF00',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />
    <div style={{fontSize:'0.55rem',color:'rgba(255,255,255,0.3)',letterSpacing:4}}>LOADING DISPATCH...</div>
  </div>
);

const EmptyCol = ({label}:{label:string}) => (
  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'3rem',gap:'0.75rem',opacity:0.3}}>
    <div style={{fontSize:'1.8rem'}}>📭</div>
    <div style={{fontSize:'0.5rem',letterSpacing:3,color:'rgba(255,255,255,0.3)'}}>NO {label} TASKS</div>
  </div>
);

function TaskCard({task,onStatusChange,updating}:{task:DispatchTask;onStatusChange:(id:number,status:string)=>void;updating:boolean}) {
  const nextStatus = task.status==='PENDING'?'ACKNOWLEDGED':task.status==='ACKNOWLEDGED'?'RESOLVED':null;
  const nextLabel  = task.status==='PENDING'?'ACKNOWLEDGE':task.status==='ACKNOWLEDGED'?'RESOLVE':null;
  return (
    <motion.div layout initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,scale:0.95}}
      whileHover={{scale:1.01,boxShadow:`0 8px 32px ${statusColor(task.status)}22`}}
      style={{background:G.base,backdropFilter:G.blur,WebkitBackdropFilter:G.blur,
        border:`1px solid ${statusColor(task.status)}28`,borderLeft:`3px solid ${statusColor(task.status)}`,
        borderRadius:2,padding:'1rem 1.25rem',display:'flex',flexDirection:'column',gap:'0.6rem',
        boxShadow:G.shine,transition:'all 0.2s ease'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div style={{fontSize:'0.5rem',color:'rgba(255,255,255,0.25)',letterSpacing:2}}>TASK #{task.id}</div>
        <div style={{fontSize:'0.5rem',color:statusColor(task.status),letterSpacing:1,fontWeight:900}}>{statusIcon(task.status)} {task.status}</div>
      </div>
      <div style={{fontWeight:900,fontSize:'0.75rem',letterSpacing:1,lineHeight:1.4,color:'rgba(255,255,255,0.92)'}}>{task.alert?.title||'Unlinked Task'}</div>
      {task.alert&&(
        <div style={{display:'flex',gap:'0.75rem',alignItems:'center'}}>
          <span style={{fontSize:'0.55rem',color:'rgba(255,255,255,0.4)',letterSpacing:1}}>{task.alert.zone||task.alert.zone_id||'—'}</span>
          <span style={{fontSize:'0.5rem',fontWeight:900,letterSpacing:1,color:sevColor(task.alert.severity),background:`${sevColor(task.alert.severity)}18`,padding:'2px 7px',border:`1px solid ${sevColor(task.alert.severity)}44`,borderRadius:2}}>{task.alert.severity}</span>
        </div>
      )}
      {task.notes&&(<div style={{fontSize:'0.55rem',color:'rgba(255,255,255,0.3)',fontStyle:'italic',borderTop:'1px solid rgba(255,255,255,0.06)',paddingTop:'0.5rem'}}>{task.notes}</div>)}
      <div style={{fontSize:'0.5rem',color:'rgba(255,255,255,0.2)',letterSpacing:1}}>CREATED {fmt(task.created_at)}{task.updated_at&&task.updated_at!==task.created_at&&(<span style={{marginLeft:'0.75rem',color:'rgba(255,255,255,0.15)'}}>· UPDATED {fmt(task.updated_at)}</span>)}</div>
      {nextStatus&&nextLabel&&(
        <motion.button disabled={updating} onClick={()=>onStatusChange(task.id,nextStatus)}
          whileHover={!updating?{scale:1.02,background:`${statusColor(nextStatus)}28`}:{}}
          whileTap={!updating?{scale:0.98}:{}}
          style={{marginTop:'0.25rem',padding:'0.5rem',background:updating?'transparent':`${statusColor(nextStatus)}14`,border:`1px solid ${statusColor(nextStatus)}55`,color:statusColor(nextStatus),fontFamily:'Space Mono,monospace',fontSize:'0.55rem',letterSpacing:2,cursor:updating?'not-allowed':'pointer',fontWeight:900,opacity:updating?0.4:1,borderRadius:2,backdropFilter:'blur(8px)',transition:'all 0.2s'}}>
          {updating?'UPDATING...':`→ ${nextLabel}`}
        </motion.button>
      )}
      {task.status==='RESOLVED'&&(<div style={{fontSize:'0.5rem',color:'#34C759',letterSpacing:2,textAlign:'center',paddingTop:'0.25rem'}}>✓ CLOSED</div>)}
    </motion.div>
  );
}

function AssignModal({alerts,onAssign,onClose}:{alerts:{id:number;title:string;zone:string;severity:string}[];onAssign:(alertId:number,notes:string)=>void;onClose:()=>void}) {
  const [selectedAlert,setSelectedAlert]=useState<number|null>(null);
  const [notes,setNotes]=useState('');
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(8px)'}}
      onClick={onClose}>
      <motion.div initial={{scale:0.95,y:20}} animate={{scale:1,y:0}} exit={{scale:0.95}}
        onClick={e=>e.stopPropagation()}
        style={{background:'rgba(10,10,20,0.85)',backdropFilter:'blur(32px) saturate(180%)',WebkitBackdropFilter:'blur(32px) saturate(180%)',border:'1px solid rgba(210,255,0,0.2)',boxShadow:'inset 0 1px 0 rgba(255,255,255,0.08),0 32px 80px rgba(0,0,0,0.6)',borderRadius:4,padding:'2rem',width:'500px',maxWidth:'90vw',maxHeight:'80vh',overflowY:'auto',display:'flex',flexDirection:'column',gap:'1.5rem'}}>
        <div style={{fontSize:'0.6rem',letterSpacing:4,color:'#D2FF00',fontWeight:900}}>ASSIGN NEW DISPATCH TASK</div>
        <div>
          <div style={{fontSize:'0.55rem',color:'rgba(255,255,255,0.3)',letterSpacing:2,marginBottom:'0.75rem'}}>SELECT ALERT</div>
          <div style={{display:'flex',flexDirection:'column',gap:'0.5rem',maxHeight:'200px',overflowY:'auto'}}>
            {alerts.length===0&&(<div style={{fontSize:'0.6rem',color:'rgba(255,255,255,0.2)',padding:'1rem',textAlign:'center'}}>No active alerts available.</div>)}
            {alerts.map(a=>(
              <motion.div key={a.id} onClick={()=>setSelectedAlert(a.id)} whileHover={{background:'rgba(210,255,0,0.04)'}}
                style={{padding:'0.75rem 1rem',cursor:'pointer',border:`1px solid ${selectedAlert===a.id?'rgba(210,255,0,0.4)':'rgba(255,255,255,0.06)'}`,background:selectedAlert===a.id?'rgba(210,255,0,0.06)':'transparent',display:'flex',justifyContent:'space-between',alignItems:'center',borderRadius:2,backdropFilter:'blur(4px)',transition:'all 0.15s'}}>
                <div><div style={{fontSize:'0.65rem',fontWeight:900,color:'rgba(255,255,255,0.9)'}}>{a.title}</div><div style={{fontSize:'0.5rem',color:'rgba(255,255,255,0.3)',marginTop:2}}>{a.zone}</div></div>
                <span style={{fontSize:'0.5rem',color:sevColor(a.severity),fontWeight:900}}>{a.severity}</span>
              </motion.div>
            ))}
          </div>
        </div>
        <div>
          <div style={{fontSize:'0.55rem',color:'rgba(255,255,255,0.3)',letterSpacing:2,marginBottom:'0.5rem'}}>NOTES (OPTIONAL)</div>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Add dispatch notes..." rows={3}
            style={{width:'100%',padding:'0.75rem',fontFamily:'Space Mono,monospace',fontSize:'0.65rem',resize:'none',boxSizing:'border-box',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.8)',borderRadius:2,outline:'none'}} />
        </div>
        <div style={{display:'flex',gap:'0.75rem'}}>
          <motion.button onClick={()=>selectedAlert&&onAssign(selectedAlert,notes)} disabled={!selectedAlert}
            whileHover={selectedAlert?{scale:1.02,background:'rgba(210,255,0,0.15)'}:{}}
            whileTap={selectedAlert?{scale:0.98}:{}}
            style={{flex:1,padding:'0.75rem',background:selectedAlert?'rgba(210,255,0,0.08)':'transparent',border:`1px solid ${selectedAlert?'rgba(210,255,0,0.4)':'rgba(255,255,255,0.08)'}`,color:selectedAlert?'#D2FF00':'rgba(255,255,255,0.2)',fontFamily:'Space Mono,monospace',fontSize:'0.6rem',letterSpacing:2,cursor:selectedAlert?'pointer':'not-allowed',fontWeight:900,borderRadius:2,backdropFilter:'blur(8px)',transition:'all 0.2s'}}>ASSIGN TASK</motion.button>
          <motion.button onClick={onClose} whileHover={{background:'rgba(255,255,255,0.04)'}}
            style={{padding:'0.75rem 1.5rem',background:'transparent',border:'1px solid rgba(255,255,255,0.08)',color:'rgba(255,255,255,0.4)',fontFamily:'Space Mono,monospace',fontSize:'0.6rem',letterSpacing:2,cursor:'pointer',borderRadius:2}}>CANCEL</motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function DispatchBoard() {
  const [tasks,setTasks]=useState<DispatchTask[]>([]);
  const [summary,setSummary]=useState<Summary|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [updating,setUpdating]=useState<number|null>(null);
  const [showAssign,setShowAssign]=useState(false);
  const [rawAlerts,setRawAlerts]=useState<any[]>([]);
  const [filter,setFilter]=useState<'ALL'|'PENDING'|'ACKNOWLEDGED'|'RESOLVED'>('ALL');

  const fetchData=useCallback(async()=>{
    setError(null);
    try {
      const [t,s,a]=await Promise.allSettled([axios.get('/api/dispatch/tasks?limit=100'),axios.get('/api/dispatch/summary'),axios.get('/api/alerts')]);
      if(t.status==='fulfilled')setTasks(t.value.data);
      if(s.status==='fulfilled')setSummary(s.value.data);
      if(a.status==='fulfilled'){const raw=a.value.data;setRawAlerts(Array.isArray(raw)?raw:raw.alerts||[]);}
    }catch(e:any){setError(e?.response?.data?.detail||'Failed to load dispatch data.');}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{fetchData();const i=setInterval(fetchData,15000);return()=>clearInterval(i);},[fetchData]);

  const handleStatusChange=async(taskId:number,newStatus:string)=>{
    setUpdating(taskId);
    try{await axios.patch(`/api/dispatch/tasks/${taskId}`,{status:newStatus,user_id:1,notes:''});await fetchData();}
    catch(e:any){alert('Failed to update task: '+(e?.response?.data?.detail||e.message));}
    finally{setUpdating(null);}
  };
  const handleAssign=async(alertId:number,notes:string)=>{
    try{await axios.post('/api/dispatch/assign',{alert_id:alertId,user_id:1,notes});setShowAssign(false);await fetchData();}
    catch(e:any){alert('Failed to assign task: '+(e?.response?.data?.detail||e.message));}
  };

  const filtered=filter==='ALL'?tasks:tasks.filter(t=>t.status===filter);
  const cols:[{status:'PENDING'|'ACKNOWLEDGED'|'RESOLVED';label:string;color:string}]=[
    {status:'PENDING',label:'PENDING',color:'#FF3B30'},
    {status:'ACKNOWLEDGED',label:'ACKNOWLEDGED',color:'#FF9500'},
    {status:'RESOLVED',label:'RESOLVED',color:'#34C759'},
  ] as any;

  if(loading)return<Spinner/>;
  if(error)return(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'3rem',gap:'1rem'}}>
      <div style={{color:'#FF3B30',fontSize:'0.65rem',letterSpacing:2}}>⚠ {error}</div>
      <button onClick={fetchData} style={{background:'none',border:'1px solid #FF3B30',color:'#FF3B30',padding:'0.5rem 1.5rem',fontFamily:'Space Mono,monospace',fontSize:'0.6rem',cursor:'pointer',letterSpacing:2}}>RETRY</button>
    </div>
  );

  return (
    <section style={{color:'rgba(255,255,255,0.85)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem',flexWrap:'wrap',gap:'1rem'}}>
        <div style={{fontSize:'0.6rem',letterSpacing:4,color:'#D2FF00',fontWeight:900}}>DISPATCH COMMAND BOARD</div>
        <div style={{display:'flex',gap:'0.75rem',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:'0.4rem'}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'#34C759',boxShadow:'0 0 8px #34C759',animation:'pulse 1.5s infinite'}} />
            <span style={{fontSize:'0.5rem',color:'#34C759',letterSpacing:2}}>LIVE · AUTO-REFRESH 15s</span>
          </div>
          <motion.button onClick={()=>setShowAssign(true)}
            whileHover={{scale:1.03,background:'rgba(210,255,0,0.14)'}} whileTap={{scale:0.97}}
            style={{padding:'0.5rem 1.25rem',background:'rgba(210,255,0,0.08)',border:'1px solid rgba(210,255,0,0.3)',backdropFilter:'blur(8px)',color:'#D2FF00',fontFamily:'Space Mono,monospace',fontSize:'0.6rem',letterSpacing:2,cursor:'pointer',fontWeight:900,borderRadius:2,transition:'all 0.2s'}}>
            + ASSIGN TASK
          </motion.button>
        </div>
      </div>

      {summary&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1px',background:'rgba(255,255,255,0.06)',marginBottom:'2rem',borderRadius:4,overflow:'hidden'}}>
          {[
            {label:'TOTAL TASKS',val:summary.total,color:'#D2FF00'},
            {label:'PENDING',val:summary.counts.PENDING,color:'#FF3B30'},
            {label:'ACKNOWLEDGED',val:summary.counts.ACKNOWLEDGED,color:'#FF9500'},
            {label:'RESOLVED',val:summary.counts.RESOLVED,color:'#34C759'},
          ].map((s,i)=>(
            <motion.div key={i} whileHover={{background:'rgba(255,255,255,0.06)'}}
              style={{background:'rgba(255,255,255,0.02)',backdropFilter:'blur(18px)',WebkitBackdropFilter:'blur(18px)',textAlign:'center',padding:'1.25rem',transition:'background 0.2s'}}>
              <div style={{fontSize:'2rem',fontWeight:900,color:s.color,textShadow:`0 0 16px ${s.color}66`}}>{s.val}</div>
              <div style={{fontSize:'0.5rem',color:s.color,letterSpacing:2,marginTop:4}}>{s.label}</div>
            </motion.div>
          ))}
        </div>
      )}

      <div style={{display:'flex',gap:'0.5rem',marginBottom:'1.5rem'}}>
        {(['ALL','PENDING','ACKNOWLEDGED','RESOLVED'] as const).map(f=>(
          <motion.button key={f} onClick={()=>setFilter(f)} whileHover={{scale:1.02}} whileTap={{scale:0.97}}
            style={{padding:'0.4rem 0.9rem',fontSize:'0.55rem',letterSpacing:2,cursor:'pointer',fontFamily:'Space Mono,monospace',border:`1px solid ${filter===f?statusColor(f==='ALL'?'':f):'rgba(255,255,255,0.08)'}`,background:filter===f?`${statusColor(f==='ALL'?'':f)}18`:'rgba(255,255,255,0.02)',color:filter===f?(f==='ALL'?'#D2FF00':statusColor(f)):'rgba(255,255,255,0.3)',backdropFilter:'blur(8px)',borderRadius:2,transition:'all 0.2s'}}>
            {f}
          </motion.button>
        ))}
        <div style={{marginLeft:'auto',fontSize:'0.5rem',color:'rgba(255,255,255,0.25)',letterSpacing:2,alignSelf:'center'}}>SHOWING {filtered.length} TASK{filtered.length!==1?'S':''}</div>
      </div>

      {filter==='ALL'?(
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',background:'rgba(255,255,255,0.06)',alignItems:'start',borderRadius:4,overflow:'hidden'}}>
          {cols.map((col:any)=>{
            const colTasks=tasks.filter(t=>t.status===col.status);
            return(
              <div key={col.status} style={{background:'rgba(255,255,255,0.02)',backdropFilter:'blur(18px)',WebkitBackdropFilter:'blur(18px)',padding:'1px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.75rem 1rem',borderBottom:`2px solid ${col.color}33`}}>
                  <div style={{fontSize:'0.55rem',fontWeight:900,color:col.color,letterSpacing:3}}>{col.label}</div>
                  <div style={{fontSize:'0.65rem',fontWeight:900,color:col.color,background:`${col.color}18`,padding:'2px 8px',border:`1px solid ${col.color}44`,borderRadius:2}}>{colTasks.length}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:'1px',padding:'0.5rem',minHeight:120}}>
                  <AnimatePresence>
                    {colTasks.length===0&&<EmptyCol label={col.label}/>}
                    {colTasks.map(task=>(<TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} updating={updating===task.id}/>))}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'1px'}}>
          <AnimatePresence>
            {filtered.length===0&&(<div style={{textAlign:'center',padding:'4rem',fontSize:'0.6rem',color:'rgba(255,255,255,0.2)',letterSpacing:3}}>NO {filter} TASKS</div>)}
            {filtered.map(task=>(<TaskCard key={task.id} task={task} onStatusChange={handleStatusChange} updating={updating===task.id}/>))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {showAssign&&(
          <AssignModal
            alerts={rawAlerts.map((a:any)=>({id:a.id,title:a.title,zone:a.zone||a.zone_id||'—',severity:a.severity||'INFO'}))}
            onAssign={handleAssign} onClose={()=>setShowAssign(false)}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
