import { useState, useEffect, useRef } from "react";
import {
  TIMEFRAMES,
  computeSig,
  mtfBias,
  computeExpertSig,
  MIN_BARS_EXPERT,
} from "./algorithm.js";
import { useDataFeed } from "./datafeed.js";
import { AlgorithmSettingsPanel } from "./AlgorithmSettingsPanel.jsx";

// ═══════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════
export default function RichAI() {
  const { allBars, livePrice, spread, tickCount, feedStatus, feedError } = useDataFeed();

  const [selTF,    setSelTF]    = useState("5m");
  const [tab,      setTab]      = useState("indicators");
  const [allSigs,  setAllSigs]  = useState({});
  const [trades,   setTrades]   = useState([]);
  const [stats,    setStats]    = useState({wins:0,total:0,profit:0});
  const [alert,    setAlert]    = useState(null);
  const [expertSigs, setExpertSigs] = useState({});
  const [alertTimeframe, setAlertTimeframe] = useState("1H");
  const [signalAlert, setSignalAlert] = useState(null);
  const [configVersion, setConfigVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selTFRef = useRef(selTF);
  const sigsRef  = useRef({});
  const alertTfRef = useRef(alertTimeframe);
  const barsRef = useRef(allBars);
  useEffect(()=>{selTFRef.current=selTF;},[selTF]);
  useEffect(()=>{sigsRef.current=allSigs;},[allSigs]);
  useEffect(()=>{alertTfRef.current=alertTimeframe;},[alertTimeframe]);
  useEffect(()=>{barsRef.current=allBars;},[allBars]);

  // ── Initial + periodic signal recompute (indicator + expert); recompute when LLM updates config ──
  useEffect(() => {
    setAllSigs(() => {
      const s = {};
      TIMEFRAMES.forEach(tf => {
        const b = allBars[tf.key];
        if (b && b.length) s[tf.key] = computeSig(b, tf);
      });
      return s;
    });
    setExpertSigs(() => {
      const e = {};
      TIMEFRAMES.forEach((tf, i) => {
        const b = allBars[tf.key];
        const lowerKey = i > 0 ? TIMEFRAMES[i - 1].key : null;
        const lowerBars = lowerKey ? allBars[lowerKey] : null;
        if (b && b.length >= MIN_BARS_EXPERT) e[tf.key] = computeExpertSig(b, tf.key, tf, lowerBars);
      });
      return e;
    });
  }, [allBars, configVersion]);

  // ── Recompute signals every 3s; signal alert on preferred TF ──
  useEffect(()=>{
    const id=setInterval(()=>{
      const cur=barsRef.current;
      const newSigs={};
      const newExpertSigs={};
      TIMEFRAMES.forEach((tf,i)=>{
        const b=cur[tf.key];
        if(b&&b.length>=25){const s=computeSig(b,tf);if(s)newSigs[tf.key]=s;}
        if(b&&b.length>=MIN_BARS_EXPERT){
          const lowerKey = i > 0 ? TIMEFRAMES[i-1].key : null;
          const lowerBars = lowerKey ? cur[lowerKey] : null;
          const ex = computeExpertSig(b, tf.key, tf, lowerBars);
          if(ex) newExpertSigs[tf.key]=ex;
        }
      });
      setAllSigs(prev=>({...prev,...newSigs}));
      setExpertSigs(prev=>({...prev,...newExpertSigs}));
      const alertTf=alertTfRef.current;
      const es=newExpertSigs[alertTf];
      if(es&&(es.signal==="LONG"||es.signal==="SHORT")){
        let msg = "Setup";
        if (es.entryType==="limit" && es.poi?.type==="unmitigated") {
          msg = `UNMITIGATED FVG LIMIT @ ${es.limitPrice}`;
        } else if (es.entryType==="market" && es.poi?.type==="liquidity" && es.sweepDetected && es.wOrShsOnLowerTF) {
          msg = "LIQUIDITY SWEEP + W/SHS";
        } else if (es.poi?.type==="liquidity") {
          msg = "LIQUIDITY POI — wait reaction";
        }
        setSignalAlert({ tf: alertTf, direction: es.signal, message: msg, price: es.price, timestamp: Date.now() });
        setTimeout(()=>setSignalAlert(null),5000);
      }
    },3000);
    return()=>clearInterval(id);
  },[]);

  // ── Derived (expert = primary signal; indicator = confluence in tab) ─────────────────
  const tfDef    = TIMEFRAMES.find(t=>t.key===selTF);
  const sig      = allSigs[selTF]||{};
  const expertSig= expertSigs[selTF]||null;
  const displaySig = expertSig ? { ...sig, ...expertSig } : sig;
  const bars     = allBars[selTF]||[];
  const sc       = displaySig.signal==="LONG"?"#00ff9d":displaySig.signal==="SHORT"?"#ff3355":"#f5c518";
  const B        = mtfBias({ ...allSigs, ...expertSigs });
  const wr       = stats.total?+(stats.wins/stats.total*100).toFixed(1):0;

  return(
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;700&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
        body{background:#eef1f6;color:#1a2332}
        .rich-ai-root{color:#1a2332}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#a8b4c8;border-radius:2px}
        @keyframes flash{0%,100%{opacity:1}50%{opacity:.2}}
        @keyframes pop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
        @keyframes glowG{0%,100%{box-shadow:0 0 0 1px rgba(0,255,157,0.25)}50%{box-shadow:0 0 0 2px rgba(0,255,157,0.4)}}
        @keyframes glowR{0%,100%{box-shadow:0 0 0 1px rgba(255,51,85,0.25)}50%{box-shadow:0 0 0 2px rgba(255,51,85,0.4)}}

        /* Responsive: stack layout on phones (iPhone 12/14 sizes and similar) */
        @media (max-width: 900px) {
          .rich-ai-root {
            max-width: 100%;
            padding: 8px 8px;
          }
          .rich-ai-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 6px;
          }
          .rich-ai-price-row {
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
          }
          .rich-ai-price-row > div {
            border-left: none !important;
            padding-left: 0 !important;
          }
          .rich-ai-main-grid {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .rich-ai-left {
            width: 100%;
            min-width: 0;
          }
          .rich-ai-tf-tabs-row {
            flex-wrap: wrap;
          }
          .rich-ai-indicators-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
      <div className="rich-ai-root" style={{fontFamily:"'IBM Plex Mono',monospace",background:"#eef1f6",minHeight:"100vh",color:"#1a2332",padding:"8px 10px",display:"flex",flexDirection:"column",gap:8,maxWidth:1260,margin:"0 auto"}}>

        {/* HEADER */}
        <div className="rich-ai-header" style={{display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid #c8d1e0",paddingBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:30,letterSpacing:4,background:"linear-gradient(90deg,#f5c518,#ffb700)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>RICH AI</div>
            <div style={{borderLeft:"1px solid #c8d1e0",paddingLeft:14}}>
              <div style={{fontSize:9,color:"#1a3050",letterSpacing:2}}>XAU/USD · GOLD</div>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:9}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:feedStatus==="open"?"#00b894":"#ff4d4f",display:"inline-block",animation:feedStatus==="open"?"flash 1.5s infinite":"none"}}/>
                <span style={{color:feedStatus==="open"?"#00b894":"#ff4d4f"}}>{feedStatus==="open"?"LIVE":feedStatus.toUpperCase()}</span>
              </div>
            </div>
          </div>
          <button type="button" onClick={()=>setSettingsOpen(true)} style={{padding:"6px 12px",fontSize:10,fontFamily:"inherit",fontWeight:600,background:"#e8eef5",color:"#1a3050",border:"1px solid #8bb6e8",borderRadius:6,cursor:"pointer",letterSpacing:1}}>Settings</button>
        </div>

        {/* SETTINGS (LLM Algorithm Tuner) — overlay */}
        {settingsOpen&&(
          <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setSettingsOpen(false)}>
            <div style={{background:"#fff",borderRadius:12,border:"1px solid #c8d1e0",maxWidth:420,width:"100%",maxHeight:"90vh",overflow:"auto",boxShadow:"0 8px 32px rgba(0,0,0,0.2)"}} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderBottom:"1px solid #c8d1e0"}}>
                <span style={{fontSize:11,color:"#1a3050",letterSpacing:2,fontWeight:700}}>SETTINGS</span>
                <button type="button" onClick={()=>setSettingsOpen(false)} style={{padding:"4px 10px",fontSize:9,fontFamily:"inherit",background:"#f5f7ff",color:"#5f6b7a",border:"1px solid #c8d1e0",borderRadius:6,cursor:"pointer"}}>Close</button>
              </div>
              <div style={{padding:12}}>
                <AlgorithmSettingsPanel onConfigApplied={()=>{setConfigVersion(v=>v+1);}} />
              </div>
            </div>
          </div>
        )}

        {/* PRICE ROW */}
        <div className="rich-ai-price-row" style={{background:"#ffffff",border:"1px solid #c8d1e0",borderRadius:8,padding:"8px 14px",display:"flex",alignItems:"center",gap:20,justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"baseline",gap:14}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:44,color:"#f5c518",letterSpacing:1,lineHeight:1}}>
              {livePrice?.mid != null ? livePrice.mid.toFixed(3) : "—"}
            </div>
            <div style={{fontSize:10,lineHeight:1.9}}>
              <div><span style={{color:"#1a3050"}}>BID </span><span style={{color:"#ff6680"}}>{livePrice?.bid.toFixed(3)||"—"}</span></div>
              <div><span style={{color:"#1a3050"}}>ASK </span><span style={{color:"#00dd88"}}>{livePrice?.ask.toFixed(3)||"—"}</span></div>
            </div>
            <div style={{fontSize:10,lineHeight:1.9}}>
              <div><span style={{color:"#1a3050"}}>SPREAD </span><span style={{color:"#f5c518"}}>{spread != null ? `${spread} pips` : "—"}</span></div>
              <div><span style={{color:"#1a3050"}}>ATR({tfDef?.label}) </span><span style={{color:"#00c8ff"}}>{displaySig.atr?.toFixed(2)||sig.atr?.toFixed(2)||"—"}</span></div>
            </div>
          </div>

          <div style={{textAlign:"center",borderLeft:"1px solid #c8d1e0",paddingLeft:18}}>
            <div style={{fontSize:8,color:"#1a3050",letterSpacing:2,marginBottom:4}}>MTF CONFLUENCE</div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:17,color:B.col,letterSpacing:2}}>{B.label}</div>
            <div style={{display:"flex",height:4,borderRadius:2,overflow:"hidden",marginTop:5,width:110}}>
              <div style={{flex:B.l,background:"#00ff9d"}}/><div style={{flex:B.w,background:"#b0c4d8"}}/><div style={{flex:B.s,background:"#ff3355"}}/>
            </div>
            <div style={{display:"flex",gap:8,fontSize:8,marginTop:4,justifyContent:"center"}}>
              <span style={{color:"#00ff9d"}}>▲{B.l}</span><span style={{color:"#ff3355"}}>▼{B.s}</span><span style={{color:"#5f6b7a"}}>—{B.w}</span>
            </div>
          </div>

          <div style={{background:`${sc}0e`,border:`1px solid ${sc}33`,borderRadius:8,padding:"8px 18px",textAlign:"center",animation:displaySig.signal&&displaySig.signal!=="WAIT"?(displaySig.signal==="LONG"?"glowG 2s infinite":"glowR 2s infinite"):"none"}}>
            <div style={{fontSize:8,color:sc,letterSpacing:3}}>{tfDef?.label} · {tfDef?.strategy?.toUpperCase()}</div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:28,color:sc,letterSpacing:2}}>{displaySig.signal||"WAIT"}</div>
            <div style={{fontSize:8,color:"#1a3050"}}>{expertSig?.entryType==="limit" ? `LIMIT @ ${expertSig.limitPrice}` : `CONF ${displaySig.conf||0}%`}</div>
          </div>

          {displaySig.signal&&displaySig.signal!=="WAIT"&&(
            <div style={{fontSize:10,display:"flex",flexDirection:"column",gap:3}}>
              {expertSig?.entryType==="limit"&&<div style={{background:"#00c8ff08",border:"1px solid #00c8ff22",borderRadius:4,padding:"3px 9px"}}>
                <span style={{color:"#1a3050",fontSize:8}}>LIMIT </span><span style={{color:"#00c8ff",fontWeight:700}}>{expertSig.limitPrice}</span>
              </div>}
              <div style={{background:"#00ff9d08",border:"1px solid #00ff9d22",borderRadius:4,padding:"3px 9px"}}>
                <span style={{color:"#1a3050",fontSize:8}}>TP1 </span><span style={{color:"#00ff9d",fontWeight:700}}>{displaySig.tp1}</span><span style={{color:"#1a4030",fontSize:8}}> +{displaySig.tpPips}p</span>
              </div>
              <div style={{background:"#00ff9d05",border:"1px solid #00ff9d14",borderRadius:4,padding:"3px 9px"}}>
                <span style={{color:"#1a3050",fontSize:8}}>TP2 </span><span style={{color:"#00ff9d55",fontWeight:700}}>{displaySig.tp2}</span>
              </div>
              <div style={{background:"#ff335508",border:"1px solid #ff335522",borderRadius:4,padding:"3px 9px"}}>
                <span style={{color:"#1a3050",fontSize:8}}>SL  </span><span style={{color:"#ff3355",fontWeight:700}}>{displaySig.sl}</span><span style={{color:"#401a20",fontSize:8}}> -{displaySig.slPips}p</span>
              </div>
              <div style={{fontSize:8,color:"#1a3050",textAlign:"right"}}>R:R 1:{tfDef?.rr}</div>
            </div>
          )}
        </div>

        {/* TF TABS */}
        <div className="rich-ai-tf-tabs" style={{display:"flex",flexDirection:"column",gap:2}}>
          <div className="rich-ai-tf-tabs-row" style={{display:"flex",gap:4}}>
            {TIMEFRAMES.map(t=>{
              const sg=expertSigs[t.key]||allSigs[t.key]||{};
              const tc=sg.signal==="LONG"?"#00b894":sg.signal==="SHORT"?"#ff4d4f":"#5f6b7a";
              const active=selTF===t.key;
              return(
                <button
                  key={t.key}
                  onClick={()=>setSelTF(t.key)}
                  style={{
                    flex:1,
                    background:active?"#e8eef5":"#ffffff",
                    border:`1px solid ${active?"#8bb6e8":"#c8d1e0"}`,
                    borderTop:`2px solid ${active?tc:"transparent"}`,
                    borderRadius:"0 0 6px 6px",
                    padding:"5px 4px",
                    cursor:"pointer",
                    transition:"all .15s",
                    textAlign:"center"
                  }}
                >
                  <div style={{fontSize:11,fontWeight:700,color:active?"#1a3050":"#2a4060",letterSpacing:1}}>{t.label}</div>
                  <div style={{fontSize:8,color:tc,fontWeight:700,marginTop:1}}>{sg.signal||"—"}</div>
                </button>
              );
            })}
          </div>
          {displaySig.signal && displaySig.signal !== "WAIT" && (
            <div style={{fontSize:8,color:(displaySig.conf||0)>=68?"#00b894":"#faad14",marginTop:2}}>
              {tfDef?.label} CONFIDENCE · {displaySig.conf?.toFixed(1) || 0}%
            </div>
          )}
        </div>

        {/* SIGNAL ALERT (expert setup on preferred TF) */}
        {signalAlert&&(
          <div style={{background:"#fff8e6",border:"1px solid #ffe58f",borderRadius:6,padding:"7px 14px",display:"flex",alignItems:"center",gap:10,animation:"pop .3s ease",fontSize:10}}>
            <span style={{fontSize:16}}>🔔</span>
            <span style={{color:"#f5c518",fontWeight:700}}>SIGNAL {signalAlert.direction}</span>
            <span style={{color:"#2a4060"}}>[{signalAlert.tf}] · {signalAlert.message} · @{signalAlert.price}</span>
          </div>
        )}

        {/* ALERT (trade P&L — kept for any future manual log) */}
        {alert&&(
          <div style={{background:`${alert.pnl>0?"#e6fffb":"#fff1f0"}`,border:`1px solid ${alert.pnl>0?"#87e8de":"#ffa39e"}`,borderRadius:6,padding:"7px 14px",display:"flex",alignItems:"center",gap:10,animation:"pop .3s ease",fontSize:10}}>
            <span style={{fontSize:16}}>⚡</span>
            <span style={{color:alert.pnl>0?"#00ff9d":"#ff3355",fontWeight:700}}>{alert.type}</span>
            <span style={{color:"#2a4060"}}>XAU/USD [{alert.tf}] · {alert.conf}% · @{alert.price}</span>
            <span style={{marginLeft:"auto",color:alert.pnl>0?"#00ff9d":"#ff3355",fontWeight:700}}>{alert.pnl>0?"+":""}{alert.pnl}p</span>
          </div>
        )}

        {/* MAIN GRID */}
        <div className="rich-ai-main-grid" style={{display:"grid",gridTemplateColumns:"1fr",gap:8,flex:1}}>
          <div className="rich-ai-left" style={{display:"flex",flexDirection:"column",gap:8}}>

            {/* Tab bar */}
            <div style={{display:"flex",gap:1,background:"#ffffff",border:"1px solid #c8d1e0",borderRadius:8,padding:3}}>
              {[["indicators","INDICATORS"],["poi","POI / EXPERT"]].map(([k,l])=>(
                <button key={k} onClick={()=>setTab(k)} style={{flex:1,background:tab===k?"#e8eef5":"transparent",border:"none",color:tab===k?"#1a3050":"#2a4060",padding:"6px 0",borderRadius:6,cursor:"pointer",fontSize:9,fontFamily:"inherit",fontWeight:tab===k?700:400,letterSpacing:1}}>{l}</button>
              ))}
            </div>

            <div style={{background:"#ffffff",border:"1px solid #c8d1e0",borderRadius:8,padding:"12px 14px",flex:1}}>

              {tab==="indicators"&&<div>
                <div style={{fontSize:9,color:"#1a3050",letterSpacing:1,marginBottom:10}}>INDICATORS · {tfDef?.label}</div>
                <div className="rich-ai-indicators-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginBottom:10}}>
                  {[
                    ["RSI (14)",sig.rsi,sig.rsi<30?"→ OVERSOLD":sig.rsi>70?"→ OVERBOUGHT":"→ NEUTRAL",sig.rsi<30?"#00ff9d":sig.rsi>70?"#ff3355":"#f5c518"],
                    ["STOCH",sig.stoch,sig.stoch<20?"→ OVERSOLD":sig.stoch>80?"→ OVERBOUGHT":"→ NEUTRAL",sig.stoch<20?"#00ff9d":sig.stoch>80?"#ff3355":"#00c8ff"],
                    ["MACD HIST",sig.macd?.h,sig.macd?.h>0?"→ BULLISH":"→ BEARISH",sig.macd?.h>0?"#00ff9d":"#ff3355"],
                    ["ATR (14)",sig.atr?.toFixed(2),`SL:${sig.slPips}p / TP:${sig.tpPips}p`,"#00c8ff"],
                    ["EMA TREND",sig.up?"UPTREND":sig.dn?"DOWNTREND":"RANGING",sig.up?"8>21>55":sig.dn?"8<21<55":"mixed",sig.up?"#00ff9d":sig.dn?"#ff3355":"#f5c518"],
                    ["BB",sig.bb?(sig.price<=sig.bb.lower?"AT LOWER":sig.price>=sig.bb.upper?"AT UPPER":"INSIDE"):"—",sig.bb?`w:${(sig.bb.upper-sig.bb.lower).toFixed(2)}`:"—","#00c8ff"],
                    ["SCORE",sig.score,`${sig.conf}% conf`,sc],
                    ["SIGNAL",sig.signal,`@ ${sig.price?.toFixed(2)||"—"}`,sc],
                    ["PRICE",livePrice?.mid != null ? livePrice.mid.toFixed(2) : "—","Live Twelve Data","#f5c518"],
                  ].map(([n,v,note,c])=>(
                    <div key={n} style={{background:"#f5f7ff",border:"1px solid #c8d1e0",borderRadius:6,padding:"8px 10px"}}>
                      <div style={{color:"#1a3050",fontSize:7,letterSpacing:1,marginBottom:2}}>{n}</div>
                      <div style={{color:c,fontWeight:700,fontSize:13}}>{v??"—"}</div>
                      <div style={{color:"#1e3050",fontSize:8,marginTop:2}}>{note}</div>
                    </div>
                  ))}
                </div>
                {sig.reasons?.length>0&&(
                  <div style={{background:"#f5f7ff",border:"1px solid #c8d1e0",borderRadius:6,padding:"9px 11px"}}>
                    <div style={{color:"#1a3050",fontSize:8,letterSpacing:1,marginBottom:7}}>SIGNAL COMPONENTS · {tfDef?.label}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {sig.reasons.map((r,i)=>(
                        <span key={i} style={{background:`${r.c}10`,border:`1px solid ${r.c}28`,borderRadius:4,padding:"3px 8px",fontSize:9,color:r.c}}>{r.t} <span style={{opacity:.4}}>{r.w}</span></span>
                      ))}
                    </div>
                  </div>
                )}
              </div>}

              {tab==="poi"&&<div>
                <div style={{fontSize:9,color:"#1a3050",letterSpacing:1,marginBottom:10}}>POI / EXPERT · Structure, BOS, FVG, Entry type</div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {TIMEFRAMES.map(t=>{
                    const ex=expertSigs[t.key];
                    if(!ex) return <div key={t.key} style={{background:"#f5f7ff",border:"1px solid #c8d1e0",borderRadius:6,padding:"8px 10px",fontSize:9,color:"#1a3050"}}>{t.label} — building…</div>;
                    return (
                      <div key={t.key} style={{background:"#f5f7ff",border:"1px solid #c8d1e0",borderRadius:6,padding:"9px 11px",fontSize:9}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                          <span style={{fontWeight:700,color:"#f5c518"}}>{t.label}</span>
                          <span style={{color:ex.signal==="LONG"?"#00ff9d":ex.signal==="SHORT"?"#ff3355":"#2a4060",fontWeight:700}}>{ex.signal}</span>
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6,fontSize:8}}>
                          <span><span style={{color:"#1a3050"}}>TREND </span><span style={{color:ex.trend==="bull"?"#00ff9d":ex.trend==="bear"?"#ff3355":"#2a4060"}}>{ex.trend||"—"}</span></span>
                          <span><span style={{color:"#1a3050"}}>BOS </span><span style={{color:ex.lastBOS?.dir==="bull"?"#00ff9d":"#ff3355"}}>{ex.lastBOS ? ex.lastBOS.dir : "—"}</span></span>
                          <span><span style={{color:"#1a3050"}}>POI </span><span style={{color:"#00c8ff"}}>{ex.poi ? `${ex.poi.type} ${ex.poi.direction}` : "—"}</span></span>
                          <span><span style={{color:"#1a3050"}}>ENTRY </span><span style={{color:"#f5c518"}}>{ex.entryType||"—"}</span></span>
                          {ex.entryType==="limit"&&<span><span style={{color:"#1a3050"}}>LIMIT </span><span style={{color:"#00c8ff"}}>{ex.limitPrice}</span></span>}
                          <span><span style={{color:"#1a3050"}}>Sweep </span><span style={{color:ex.sweepDetected?"#00ff9d":"#2a4060"}}>{ex.sweepDetected?"Y":"—"}</span></span>
                          <span><span style={{color:"#1a3050"}}>W/SHS </span><span style={{color:ex.wOrShsOnLowerTF?"#00ff9d":"#2a4060"}}>{ex.wOrShsOnLowerTF?"Y":"—"}</span></span>
                        </div>
                        {ex.poi?.zone&&<div style={{fontSize:8,color:"#2a4060",marginTop:4}}>Zone: [{ex.poi.zone[0].toFixed(2)}, {ex.poi.zone[1].toFixed(2)}]</div>}
                        {ex.reasons?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
                          {ex.reasons.map((r,i)=><span key={i} style={{background:`${r.c}14`,border:`1px solid ${r.c}33`,borderRadius:3,padding:"2px 6px",fontSize:8,color:r.c}}>{r.t}</span>)}
                        </div>}
                      </div>
                    );
                  })}
                </div>
              </div>}

              {/* MTF MATRIX and LOG tabs removed */}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
