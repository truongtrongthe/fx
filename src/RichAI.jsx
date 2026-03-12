import { useState, useEffect, useRef } from "react";
import {
  TIMEFRAMES,
  computeSig,
  mtfBias,
  computeExpertSig,
  getTrendAndPOIFromHigherTF,
  TREND_POI_TF_KEYS,
  ENTRY_WATCH_TF_KEYS,
  MIN_BARS_EXPERT,
} from "./algorithm.js";
import { useDataFeed } from "./datafeed.js";
import { AlgorithmSettingsPanel } from "./AlgorithmSettingsPanel.jsx";

// ═══════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════
export default function RichAI() {
  const { allBars, livePrice, spread, tickCount, feedStatus, feedError, feedSource } = useDataFeed();

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
      const higherTFContext = getTrendAndPOIFromHigherTF(allBars);
      const e = {};
      TIMEFRAMES.forEach((tf, i) => {
        const b = allBars[tf.key];
        const lowerKey = i > 0 ? TIMEFRAMES[i - 1].key : null;
        const lowerBars = lowerKey ? allBars[lowerKey] : null;
        const ctx = ENTRY_WATCH_TF_KEYS.includes(tf.key) ? higherTFContext : null;
        if (b && b.length >= MIN_BARS_EXPERT) e[tf.key] = computeExpertSig(b, tf.key, tf, lowerBars, ctx);
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
      const higherTFContext = getTrendAndPOIFromHigherTF(cur);
      TIMEFRAMES.forEach((tf,i)=>{
        const b=cur[tf.key];
        if(b&&b.length>=25){const s=computeSig(b,tf);if(s)newSigs[tf.key]=s;}
        if(b&&b.length>=MIN_BARS_EXPERT){
          const lowerKey = i > 0 ? TIMEFRAMES[i-1].key : null;
          const lowerBars = lowerKey ? cur[lowerKey] : null;
          const ctx = ENTRY_WATCH_TF_KEYS.includes(tf.key) ? higherTFContext : null;
          const ex = computeExpertSig(b, tf.key, tf, lowerBars, ctx);
          if(ex) newExpertSigs[tf.key]=ex;
        }
      });
      setAllSigs(prev=>({...prev,...newSigs}));
      setExpertSigs(prev=>({...prev,...newExpertSigs}));
      // Alert khi TF nhỏ (M1/M5/M15) bắn LONG/SHORT (đã align với H4/1H)
      for (const tfKey of ENTRY_WATCH_TF_KEYS) {
        const es = newExpertSigs[tfKey];
        if (es && (es.signal === "LONG" || es.signal === "SHORT")) {
          let msg = "Setup";
          if (es.entryType === "limit" && es.poi?.type === "unmitigated") {
            msg = `FVG LIMIT @ ${es.limitPrice}`;
          } else if (es.entryType === "market" && es.poi?.type === "liquidity" && es.sweepDetected && es.wOrShsOnLowerTF) {
            msg = "Sweep + W/SHS";
          } else if (es.poi?.type === "liquidity") {
            msg = "Liquidity POI";
          }
          setSignalAlert({ tf: tfKey, direction: es.signal, message: msg, price: es.price, timestamp: Date.now() });
          setTimeout(() => setSignalAlert(null), 8000);
          break;
        }
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
  const sc       = displaySig.signal==="LONG"?"#059669":displaySig.signal==="SHORT"?"#dc2626":"#b45309";
  const B        = mtfBias({ ...allSigs, ...expertSigs });
  const wr       = stats.total?+(stats.wins/stats.total*100).toFixed(1):0;

  // Xu hướng từ TF lớn (H4/1H) — dùng để giải thích cho user
  const htContext = getTrendAndPOIFromHigherTF(allBars);
  const htTrendLabel = htContext.trend === "bull" ? "BULL ↑" : htContext.trend === "bear" ? "BEAR ↓" : "—";
  const htFromTf = htContext.fromTf || "—";
  // Tín hiệu điểm vào từ TF nhỏ (M1/M5/M15) — cái này alert user
  const entrySignal = ENTRY_WATCH_TF_KEYS.map(k => ({ key: k, ex: expertSigs[k] })).find(
    ({ ex }) => ex && (ex.signal === "LONG" || ex.signal === "SHORT")
  );
  const isEntryTf = ENTRY_WATCH_TF_KEYS.includes(selTF);
  const isTrendTf = TREND_POI_TF_KEYS.includes(selTF);

  return(
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;700&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;font-size:16px}
        body{background:#f5f5f5;color:#1a1a1a}
        .rich-ai-root{color:#1a1a1a;--fs-xs:10px;--fs-sm:11px;--fs-md:13px;--fs-lg:15px;--fs-xl:20px;--fs-2xl:28px;--fs-price:44px;--gap:8px;--pad:10px;--touch:44px}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#94a3b8;border-radius:3px}
        @keyframes flash{0%,100%{opacity:1}50%{opacity:.2}}
        @keyframes pop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
        @keyframes glowG{0%,100%{box-shadow:0 0 0 1px rgba(5,150,105,0.35)}50%{box-shadow:0 0 0 2px rgba(5,150,105,0.5)}}
        @keyframes glowR{0%,100%{box-shadow:0 0 0 1px rgba(220,38,38,0.35)}50%{box-shadow:0 0 0 2px rgba(220,38,38,0.5)}}

        /* Smartphone: iPhone 14 Pro Max (~430px), dễ nhìn hơn + safe area tai thỏ */
        @media (max-width: 430px) {
          html{font-size:17px}
          .rich-ai-root{--fs-xs:12px;--fs-sm:14px;--fs-md:16px;--fs-lg:18px;--fs-xl:22px;--fs-2xl:32px;--fs-price:52px;--gap:12px;--pad:14px;--touch:48px;padding:calc(var(--pad) + env(safe-area-inset-top,0)) calc(var(--pad) + env(safe-area-inset-right,0)) calc(var(--pad) + env(safe-area-inset-bottom,0)) calc(var(--pad) + env(safe-area-inset-left,0));gap:var(--gap);max-width:100%}
          .rich-ai-header{padding-bottom:var(--pad);gap:var(--gap)}
          .rich-ai-header .rich-ai-title{font-size:28px !important;letter-spacing:3px}
          .rich-ai-header .rich-ai-meta{font-size:var(--fs-sm) !important}
          .rich-ai-header .rich-ai-btn{padding:10px 16px !important;font-size:var(--fs-sm) !important;min-height:var(--touch)}
          .rich-ai-price-row{padding:var(--pad) 16px !important;gap:14px;flex-direction:column;align-items:stretch}
          .rich-ai-price-row .rich-ai-price{font-size:var(--fs-price) !important;line-height:1.1}
          .rich-ai-price-row .rich-ai-meta{font-size:var(--fs-sm) !important;line-height:1.6}
          .rich-ai-price-row .rich-ai-confluence-title{font-size:var(--fs-xs) !important}
          .rich-ai-price-row .rich-ai-confluence-label{font-size:var(--fs-md) !important}
          .rich-ai-price-row .rich-ai-signal-label{font-size:var(--fs-sm) !important}
          .rich-ai-price-row .rich-ai-signal-value{font-size:var(--fs-2xl) !important}
          .rich-ai-price-row .rich-ai-signal-note{font-size:var(--fs-xs) !important}
          .rich-ai-price-row .rich-ai-tp-sl .rich-ai-tp-sl-label{font-size:var(--fs-xs) !important}
          .rich-ai-price-row .rich-ai-tp-sl .rich-ai-tp-sl-value{font-size:var(--fs-md) !important}
          .rich-ai-trade-logic{padding:12px 16px !important;gap:14px}
          .rich-ai-trade-logic .rich-ai-section-title{font-size:var(--fs-xs) !important}
          .rich-ai-trade-logic .rich-ai-section-value{font-size:var(--fs-md) !important}
          .rich-ai-trade-logic .rich-ai-section-note{font-size:var(--fs-xs) !important}
          .rich-ai-tf-tabs-row .rich-ai-tf-btn{padding:10px 6px !important;min-height:var(--touch);font-size:var(--fs-sm) !important}
          .rich-ai-tf-tabs-row .rich-ai-tf-btn .rich-ai-tf-signal{font-size:var(--fs-sm) !important}
          .rich-ai-tab-bar button{padding:12px 0 !important;font-size:var(--fs-sm) !important;min-height:var(--touch)}
          .rich-ai-panel{padding:14px 16px !important}
          .rich-ai-panel .rich-ai-panel-title{font-size:var(--fs-md) !important}
          .rich-ai-panel .rich-ai-panel-note{font-size:var(--fs-sm) !important}
          .rich-ai-indicators-grid{gap:10px !important}
          .rich-ai-indicators-grid .rich-ai-ind-card .rich-ai-ind-name{font-size:var(--fs-xs) !important}
          .rich-ai-indicators-grid .rich-ai-ind-card .rich-ai-ind-value{font-size:var(--fs-lg) !important}
          .rich-ai-indicators-grid .rich-ai-ind-card .rich-ai-ind-note{font-size:var(--fs-xs) !important}
          .rich-ai-poi-card{padding:12px 14px !important}
          .rich-ai-poi-card .rich-ai-poi-header{font-size:var(--fs-md) !important}
          .rich-ai-poi-card .rich-ai-poi-meta{font-size:var(--fs-sm) !important}
          .rich-ai-alert{padding:14px 16px !important;font-size:var(--fs-sm) !important}
          .rich-ai-alert .rich-ai-alert-title{font-size:var(--fs-md) !important}
          .rich-ai-alert .rich-ai-alert-detail{font-size:var(--fs-sm) !important}
          .rich-ai-price-row > div{border-left:none !important;padding-left:0 !important}
        }
        @media (max-width: 900px) {
          .rich-ai-root{max-width:100%}
          .rich-ai-header{flex-direction:column;align-items:flex-start}
          .rich-ai-main-grid{display:flex;flex-direction:column;gap:12px}
          .rich-ai-left{width:100%;min-width:0}
          .rich-ai-indicators-grid{grid-template-columns:repeat(2,1fr)}
        }
      `}</style>
      <div className="rich-ai-root" style={{fontFamily:"'IBM Plex Mono',monospace",background:"#f5f5f5",minHeight:"100vh",color:"#1a1a1a",padding:"var(--pad, 10px)",display:"flex",flexDirection:"column",gap:"var(--gap, 8px)",maxWidth:1260,margin:"0 auto"}}>

        {/* HEADER */}
        <div className="rich-ai-header" style={{display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid #dde0e4",paddingBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div className="rich-ai-title" style={{fontFamily:"'Bebas Neue'",fontSize:30,letterSpacing:4,color:"#1a1a1a"}}>RICH AI</div>
            <div className="rich-ai-meta" style={{borderLeft:"1px solid #dde0e4",paddingLeft:14,fontSize:10}}>
              <div style={{color:"#374151",letterSpacing:2}}>XAU/USD · Vàng</div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:feedStatus==="open"?"#059669":"#dc2626",display:"inline-block",animation:feedStatus==="open"?"flash 1.5s infinite":"none"}}/>
                <span style={{color:feedStatus==="open"?"#059669":"#dc2626",fontWeight:600}}>{feedStatus==="open" ? (feedSource==="ws" ? "Trực tuyến · WS" : "Trực tuyến") : feedStatus.toUpperCase()}</span>
              </div>
            </div>
          </div>
          <button type="button" className="rich-ai-btn" onClick={()=>setSettingsOpen(true)} style={{padding:"6px 12px",fontSize:10,fontFamily:"inherit",fontWeight:600,background:"#fff",color:"#1a1a1a",border:"1px solid #dde0e4",borderRadius:8,cursor:"pointer",letterSpacing:1}}>Cài đặt</button>
        </div>

        {/* SETTINGS (LLM Algorithm Tuner) — overlay */}
        {settingsOpen&&(
          <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setSettingsOpen(false)}>
            <div style={{background:"#fff",borderRadius:12,border:"1px solid #dde0e4",maxWidth:420,width:"100%",maxHeight:"90vh",overflow:"auto",boxShadow:"0 8px 32px rgba(0,0,0,0.12)"}} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderBottom:"1px solid #dde0e4"}}>
                <span style={{fontSize:12,color:"#1a1a1a",letterSpacing:2,fontWeight:700}}>Cài đặt</span>
                <button type="button" onClick={()=>setSettingsOpen(false)} style={{padding:"8px 14px",fontSize:11,fontFamily:"inherit",background:"#f5f5f5",color:"#5c5c5c",border:"1px solid #dde0e4",borderRadius:8,cursor:"pointer",minHeight:44}}>Đóng</button>
              </div>
              <div style={{padding:12}}>
                <AlgorithmSettingsPanel onConfigApplied={()=>{setConfigVersion(v=>v+1);}} />
              </div>
            </div>
          </div>
        )}

        {/* PRICE ROW */}
        <div className="rich-ai-price-row" style={{background:"#ffffff",border:"1px solid #dde0e4",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:20,justifyContent:"space-between",flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"baseline",gap:14}}>
            <div className="rich-ai-price" style={{fontFamily:"'Bebas Neue'",fontSize:44,color:"#1a1a1a",letterSpacing:1,lineHeight:1.1}}>
              {livePrice?.mid != null ? livePrice.mid.toFixed(3) : "—"}
            </div>
            <div className="rich-ai-meta" style={{fontSize:11,lineHeight:1.8}}>
              <div><span style={{color:"#374151"}}>BID </span><span style={{color:"#dc2626",fontWeight:600}}>{livePrice?.bid.toFixed(3)||"—"}</span></div>
              <div><span style={{color:"#374151"}}>ASK </span><span style={{color:"#059669",fontWeight:600}}>{livePrice?.ask.toFixed(3)||"—"}</span></div>
            </div>
            <div className="rich-ai-meta" style={{fontSize:11,lineHeight:1.8}}>
              <div><span style={{color:"#374151"}}>SPREAD </span><span style={{color:"#b45309",fontWeight:600}}>{spread != null ? `${spread} pips` : "—"}</span></div>
              <div><span style={{color:"#374151"}}>ATR({tfDef?.label}) </span><span style={{color:"#0284c7",fontWeight:600}}>{displaySig.atr?.toFixed(2)||sig.atr?.toFixed(2)||"—"}</span></div>
            </div>
          </div>

          <div style={{textAlign:"center",borderLeft:"1px solid #dde0e4",paddingLeft:18}}>
            <div className="rich-ai-confluence-title" style={{fontSize:10,color:"#374151",letterSpacing:2,marginBottom:4}}>Hội tụ MTF</div>
            <div className="rich-ai-confluence-label" style={{fontFamily:"'Bebas Neue'",fontSize:17,color:B.col,letterSpacing:2}}>{B.label}</div>
            <div style={{display:"flex",height:5,borderRadius:3,overflow:"hidden",marginTop:6,width:110}}>
              <div style={{flex:B.l,background:"#059669"}}/><div style={{flex:B.w,background:"#cbd5e1"}}/><div style={{flex:B.s,background:"#dc2626"}}/>
            </div>
            <div style={{display:"flex",gap:8,fontSize:10,marginTop:4,justifyContent:"center"}}>
              <span style={{color:"#059669",fontWeight:600}}>▲{B.l}</span><span style={{color:"#dc2626",fontWeight:600}}>▼{B.s}</span><span style={{color:"#64748b"}}>—{B.w}</span>
            </div>
          </div>

          <div style={{background:sc==="#059669"?"#ecfdf5":sc==="#dc2626"?"#fef2f2":"#fffbeb",border:`1px solid ${sc==="#059669"?"#a7f3d0":sc==="#dc2626"?"#fecaca":"#fde68a"}`,borderRadius:10,padding:"10px 18px",textAlign:"center",animation:displaySig.signal&&displaySig.signal!=="WAIT"?(displaySig.signal==="LONG"?"glowG 2s infinite":"glowR 2s infinite"):"none"}}>
            <div className="rich-ai-signal-label" style={{fontSize:10,color:sc,letterSpacing:2,fontWeight:600}}>Tín hiệu từ {tfDef?.label}{isTrendTf ? " (xu hướng)" : isEntryTf ? " (điểm vào)" : ""}</div>
            <div className="rich-ai-signal-value" style={{fontFamily:"'Bebas Neue'",fontSize:28,color:sc,letterSpacing:2}}>{displaySig.signal||"WAIT"}</div>
            <div className="rich-ai-signal-note" style={{fontSize:10,color:"#374151"}}>
              {isEntryTf && htContext.trend && `Xu hướng ${htContext.trend.toUpperCase()} từ ${htFromTf} · `}
              {expertSig?.entryType==="limit" ? `LIMIT @ ${expertSig.limitPrice}` : `Độ tin cậy ${displaySig.conf||0}%`}
            </div>
          </div>

          {displaySig.signal&&displaySig.signal!=="WAIT"&&(
            <div className="rich-ai-tp-sl" style={{fontSize:11,display:"flex",flexDirection:"column",gap:4}}>
              {expertSig?.entryType==="limit"&&<div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:6,padding:"4px 10px"}}>
                <span className="rich-ai-tp-sl-label" style={{color:"#374151",fontSize:10}}>LIMIT </span><span className="rich-ai-tp-sl-value" style={{color:"#0284c7",fontWeight:700}}>{expertSig.limitPrice}</span>
              </div>}
              <div style={{background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:6,padding:"4px 10px"}}>
                <span className="rich-ai-tp-sl-label" style={{color:"#374151",fontSize:10}}>TP1 </span><span className="rich-ai-tp-sl-value" style={{color:"#059669",fontWeight:700}}>{displaySig.tp1}</span><span style={{color:"#065f46",fontSize:10}}> +{displaySig.tpPips}p</span>
              </div>
              <div style={{background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:6,padding:"4px 10px"}}>
                <span className="rich-ai-tp-sl-label" style={{color:"#374151",fontSize:10}}>TP2 </span><span style={{color:"#059669",fontWeight:700,opacity:0.85}}>{displaySig.tp2}</span>
              </div>
              <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"4px 10px"}}>
                <span className="rich-ai-tp-sl-label" style={{color:"#374151",fontSize:10}}>SL </span><span className="rich-ai-tp-sl-value" style={{color:"#dc2626",fontWeight:700}}>{displaySig.sl}</span><span style={{color:"#991b1b",fontSize:10}}> -{displaySig.slPips}p</span>
              </div>
              <div style={{fontSize:10,color:"#374151",textAlign:"right"}}>R:R 1:{tfDef?.rr}</div>
            </div>
          )}
        </div>

        {/* TRADE LOGIC: Xu hướng (TF lớn) → Điểm vào (TF nhỏ) */}
        <div className="rich-ai-trade-logic" style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"stretch",background:"#ffffff",border:"1px solid #dde0e4",borderRadius:10,padding:"12px 14px"}}>
          <div style={{flex:"1 1 200px",minWidth:0}}>
            <div className="rich-ai-section-title" style={{fontSize:10,color:"#64748b",letterSpacing:1.5,marginBottom:4}}>Xu hướng (TF lớn quyết định)</div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span className="rich-ai-section-value" style={{fontSize:15,fontWeight:700,color:htContext.trend==="bull"?"#059669":htContext.trend==="bear"?"#dc2626":"#64748b"}}>{htTrendLabel}</span>
              <span style={{fontSize:11,color:"#374151"}}>từ {htFromTf}</span>
            </div>
            <div className="rich-ai-section-note" style={{fontSize:10,color:"#64748b",marginTop:4}}>Chỉ vào lệnh khi TF nhỏ (M1/M5/M15) bắn tín hiệu cùng chiều.</div>
          </div>
          <div style={{flex:"1 1 200px",minWidth:0,borderLeft:"1px solid #e2e8f0",paddingLeft:12}}>
            <div className="rich-ai-section-title" style={{fontSize:10,color:"#64748b",letterSpacing:1.5,marginBottom:4}}>Điểm vào (TF nhỏ bắn tín hiệu)</div>
            {entrySignal ? (
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span className="rich-ai-section-value" style={{fontSize:15,fontWeight:700,color:entrySignal.ex.signal==="LONG"?"#059669":"#dc2626"}}>{entrySignal.ex.signal}</span>
                <span style={{fontSize:11,color:"#374151"}}>từ {entrySignal.key}</span>
                <span style={{fontSize:11,color:"#5c5c5c"}}>@ {entrySignal.ex.price}</span>
              </div>
            ) : (
              <div style={{fontSize:12,color:"#64748b"}}>Chờ tín hiệu từ M1 / M5 / M15</div>
            )}
            <div className="rich-ai-section-note" style={{fontSize:10,color:"#64748b",marginTop:4}}>Khi có LONG/SHORT từ M1/M5/M15 (cùng chiều xu hướng) → cảnh báo điểm vào.</div>
          </div>
        </div>

        {/* TF TABS */}
        <div className="rich-ai-tf-tabs" style={{display:"flex",flexDirection:"column",gap:4}}>
          <div className="rich-ai-tf-tabs-row" style={{display:"flex",gap:4}}>
            {TIMEFRAMES.map(t=>{
              const sg=expertSigs[t.key]||allSigs[t.key]||{};
              const ex=expertSigs[t.key];
              const tc=sg.signal==="LONG"?"#059669":sg.signal==="SHORT"?"#dc2626":"#64748b";
              const trendLabel=ex?.trend==="bull"?"↑ bull":ex?.trend==="bear"?"↓ bear":"—";
              const trendColor=ex?.trend==="bull"?"#059669":ex?.trend==="bear"?"#dc2626":"#64748b";
              const active=selTF===t.key;
              const roleLabel = TREND_POI_TF_KEYS.includes(t.key) ? "Xu hướng" : ENTRY_WATCH_TF_KEYS.includes(t.key) ? "Điểm vào" : null;
              return(
                <button
                  key={t.key}
                  className="rich-ai-tf-btn"
                  onClick={()=>setSelTF(t.key)}
                  style={{
                    flex:1,
                    background:active?"#f8fafc":"#ffffff",
                    border:`1px solid ${active?"#94a3b8":"#dde0e4"}`,
                    borderTop:`3px solid ${active?tc:"transparent"}`,
                    borderRadius:"0 0 8px 8px",
                    padding:"8px 4px",
                    cursor:"pointer",
                    transition:"all .15s",
                    textAlign:"center"
                  }}
                >
                  <div style={{fontSize:12,fontWeight:700,color:active?"#1a1a1a":"#374151",letterSpacing:1}}>{t.label}</div>
                  <div className="rich-ai-tf-signal" style={{fontSize:10,color:tc,fontWeight:700,marginTop:2}}>{sg.signal||"—"}</div>
                  <div style={{fontSize:9,color:trendColor,marginTop:2}}>{trendLabel}</div>
                  {roleLabel&&<div style={{fontSize:9,color:"#94a3b8",marginTop:2,letterSpacing:0.5}}>{roleLabel}</div>}
                </button>
              );
            })}
          </div>
          {displaySig.signal && displaySig.signal !== "WAIT" && (
            <div style={{fontSize:11,color:(displaySig.conf||0)>=68?"#059669":"#b45309",fontWeight:600,marginTop:2}}>
              {tfDef?.label} độ tin cậy · {displaySig.conf?.toFixed(1) || 0}%
            </div>
          )}
        </div>

        {/* ALERT ĐIỂM VÀO */}
        {signalAlert&&(
          <div className="rich-ai-alert" style={{background:signalAlert.direction==="LONG"?"#ecfdf5":"#fef2f2",border:signalAlert.direction==="LONG"?"2px solid #a7f3d0":"2px solid #fecaca",borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:14,animation:"pop .3s ease",fontSize:12}}>
            <span style={{fontSize:24}}>🔔</span>
            <div style={{flex:1}}>
              <div className="rich-ai-alert-title" style={{fontWeight:700,color:signalAlert.direction==="LONG"?"#059669":"#dc2626",fontSize:14,letterSpacing:1}}>Điểm vào: {signalAlert.direction}</div>
              <div className="rich-ai-alert-detail" style={{fontSize:11,color:"#374151",marginTop:4}}>[{signalAlert.tf}] {signalAlert.message} · @{signalAlert.price} — theo xu hướng H4/1H</div>
            </div>
          </div>
        )}

        {alert&&(
          <div style={{background:alert.pnl>0?"#ecfdf5":"#fef2f2",border:alert.pnl>0?"1px solid #a7f3d0":"1px solid #fecaca",borderRadius:8,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,animation:"pop .3s ease",fontSize:12}}>
            <span style={{fontSize:20}}>⚡</span>
            <span style={{color:alert.pnl>0?"#059669":"#dc2626",fontWeight:700}}>{alert.type}</span>
            <span style={{color:"#374151"}}>XAU/USD [{alert.tf}] · {alert.conf}% · @{alert.price}</span>
            <span style={{marginLeft:"auto",color:alert.pnl>0?"#059669":"#dc2626",fontWeight:700}}>{alert.pnl>0?"+":""}{alert.pnl}p</span>
          </div>
        )}

        {/* MAIN GRID */}
        <div className="rich-ai-main-grid" style={{display:"grid",gridTemplateColumns:"1fr",gap:8,flex:1}}>
          <div className="rich-ai-left" style={{display:"flex",flexDirection:"column",gap:8}}>

            {/* Tab bar */}
            <div className="rich-ai-tab-bar" style={{display:"flex",gap:2,background:"#ffffff",border:"1px solid #dde0e4",borderRadius:10,padding:4}}>
              {[["indicators","Chỉ báo"],["poi","POI / Expert"]].map(([k,l])=>(
                <button key={k} onClick={()=>setTab(k)} style={{flex:1,background:tab===k?"#f8fafc":"transparent",border:"none",color:tab===k?"#1a1a1a":"#5c5c5c",padding:"10px 0",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:tab===k?700:400,letterSpacing:1}}>{l}</button>
              ))}
            </div>

            <div className="rich-ai-panel" style={{background:"#ffffff",border:"1px solid #dde0e4",borderRadius:10,padding:"14px 16px",flex:1}}>

              {tab==="indicators"&&<div>
                <div className="rich-ai-panel-title" style={{fontSize:13,color:"#374151",letterSpacing:1,marginBottom:10}}>Chỉ báo · {tfDef?.label}</div>
                <div className="rich-ai-indicators-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
                  {[
                    ["RSI (14)",sig.rsi,sig.rsi<30?"→ OVERSOLD":sig.rsi>70?"→ OVERBOUGHT":"→ NEUTRAL",sig.rsi<30?"#059669":sig.rsi>70?"#dc2626":"#b45309"],
                    ["STOCH",sig.stoch,sig.stoch<20?"→ OVERSOLD":sig.stoch>80?"→ OVERBOUGHT":"→ NEUTRAL",sig.stoch<20?"#059669":sig.stoch>80?"#dc2626":"#0284c7"],
                    ["MACD HIST",sig.macd?.h,sig.macd?.h>0?"→ BULLISH":"→ BEARISH",sig.macd?.h>0?"#059669":"#dc2626"],
                    ["ATR (14)",sig.atr?.toFixed(2),`SL:${sig.slPips}p / TP:${sig.tpPips}p`,"#0284c7"],
                    ["EMA TREND",sig.up?"UPTREND":sig.dn?"DOWNTREND":"RANGING",sig.up?"8>21>55":sig.dn?"8<21<55":"mixed",sig.up?"#059669":sig.dn?"#dc2626":"#b45309"],
                    ["BB",sig.bb?(sig.price<=sig.bb.lower?"AT LOWER":sig.price>=sig.bb.upper?"AT UPPER":"INSIDE"):"—",sig.bb?`w:${(sig.bb.upper-sig.bb.lower).toFixed(2)}`:"—","#0284c7"],
                    ["Điểm số",sig.score,`${sig.conf}% độ tin cậy`,sc],
                    ["Tín hiệu",sig.signal,`@ ${sig.price?.toFixed(2)||"—"}`,sc],
                    ["Giá",livePrice?.mid != null ? livePrice.mid.toFixed(2) : "—","Trực tuyến","#1a1a1a"],
                  ].map(([n,v,note,c])=>(
                    <div key={n} className="rich-ai-ind-card" style={{background:"#f8fafc",border:"1px solid #dde0e4",borderRadius:8,padding:"10px 12px"}}>
                      <div className="rich-ai-ind-name" style={{color:"#374151",fontSize:10,letterSpacing:1,marginBottom:4}}>{n}</div>
                      <div className="rich-ai-ind-value" style={{color:c,fontWeight:700,fontSize:15}}>{v??"—"}</div>
                      <div className="rich-ai-ind-note" style={{color:"#5c5c5c",fontSize:10,marginTop:4}}>{note}</div>
                    </div>
                  ))}
                </div>
                {sig.reasons?.length>0&&(
                  <div style={{background:"#f8fafc",border:"1px solid #dde0e4",borderRadius:8,padding:"10px 12px"}}>
                    <div style={{color:"#374151",fontSize:11,letterSpacing:1,marginBottom:8}}>Thành phần tín hiệu · {tfDef?.label}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {sig.reasons.map((r,i)=>(
                        <span key={i} style={{background:`${r.c}12`,border:`1px solid ${r.c}40`,borderRadius:6,padding:"4px 10px",fontSize:10,color:r.c,fontWeight:600}}>{r.t} <span style={{opacity:.5}}>{r.w}</span></span>
                      ))}
                    </div>
                  </div>
                )}
              </div>}

              {tab==="poi"&&<div>
                <div className="rich-ai-panel-title" style={{fontSize:13,color:"#374151",letterSpacing:1,marginBottom:6}}>POI / Expert · Structure, BOS, FVG, Inducement</div>
                <div className="rich-ai-panel-note" style={{fontSize:11,color:"#64748b",marginBottom:12}}>TF lớn (H4, 1H) quyết định xu hướng; TF nhỏ (M1, M5, M15) bắn tín hiệu điểm vào khi cùng chiều.</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {[
                    { title: "Xu hướng (H4, 1H)", keys: TREND_POI_TF_KEYS },
                    { title: "Điểm vào (M1, M5, M15)", keys: ENTRY_WATCH_TF_KEYS },
                    { title: "Khác", keys: TIMEFRAMES.map(x=>x.key).filter(k=>!TREND_POI_TF_KEYS.includes(k)&&!ENTRY_WATCH_TF_KEYS.includes(k)) },
                  ].map(grp=>(
                    <div key={grp.title}>
                      <div style={{fontSize:11,color:"#64748b",fontWeight:600,letterSpacing:1,marginBottom:6}}>{grp.title}</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {grp.keys.map(tfKey=>{
                          const t=TIMEFRAMES.find(x=>x.key===tfKey);
                          if(!t) return null;
                          const ex=expertSigs[t.key];
                          if(!ex) return <div key={t.key} style={{background:"#f8fafc",border:"1px solid #dde0e4",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#374151"}}>{t.label} — đang tải…</div>;
                          return (
                      <div key={t.key} className="rich-ai-poi-card" style={{background:"#f8fafc",border:"1px solid #dde0e4",borderRadius:8,padding:"11px 14px",fontSize:11}}>
                        <div className="rich-ai-poi-header" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <span style={{fontWeight:700,color:"#1a1a1a"}}>{t.label}</span>
                          <span style={{color:ex.signal==="LONG"?"#059669":ex.signal==="SHORT"?"#dc2626":"#64748b",fontWeight:700}}>{ex.signal}</span>
                        </div>
                        <div className="rich-ai-poi-meta" style={{display:"flex",flexWrap:"wrap",gap:8,fontSize:11}}>
                          <span><span style={{color:"#374151"}}>TREND </span><span style={{color:ex.trend==="bull"?"#059669":ex.trend==="bear"?"#dc2626":"#64748b",fontWeight:600}}>{ex.trend||"—"}</span></span>
                          <span><span style={{color:"#374151"}}>BOS </span><span style={{color:ex.lastBOS?.dir==="bull"?"#059669":"#dc2626",fontWeight:600}}>{ex.lastBOS ? ex.lastBOS.dir : "—"}</span></span>
                          <span><span style={{color:"#374151"}}>POI </span><span style={{color:"#0284c7",fontWeight:600}}>{ex.poi ? `${ex.poi.type} ${ex.poi.direction}` : "—"}</span></span>
                          <span><span style={{color:"#374151"}}>ENTRY </span><span style={{color:"#b45309",fontWeight:600}}>{ex.entryType||"—"}</span></span>
                          {ex.entryType==="limit"&&<span><span style={{color:"#374151"}}>LIMIT </span><span style={{color:"#0284c7",fontWeight:600}}>{ex.limitPrice}</span></span>}
                          <span><span style={{color:"#374151"}}>Sweep </span><span style={{color:ex.sweepDetected?"#059669":"#64748b",fontWeight:600}}>{ex.sweepDetected?"Y":"—"}</span></span>
                          <span><span style={{color:"#374151"}}>W/SHS </span><span style={{color:ex.wOrShsOnLowerTF?"#059669":"#64748b",fontWeight:600}}>{ex.wOrShsOnLowerTF?"Y":"—"}</span></span>
                        </div>
                        {ex.poi?.zone&&<div style={{fontSize:11,color:"#5c5c5c",marginTop:6}}>Zone: [{ex.poi.zone[0].toFixed(2)}, {ex.poi.zone[1].toFixed(2)}]</div>}
                        {ex.fvgList?.length>0&&<div style={{marginTop:8}}>
                          <div style={{fontSize:11,color:"#374151",fontWeight:600,marginBottom:4}}>FVG / Imbalance</div>
                          <div style={{fontSize:10,color:"#64748b",marginBottom:6}}>Imbalance = FVG. Entry đẹp: FVG ngay trên (long) hoặc dưới (short) vùng Inducement.</div>
                          <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:100,overflowY:"auto"}}>
                            {ex.fvgList.map((f,i)=>(
                              <div key={i} style={{fontSize:11,display:"flex",alignItems:"center",gap:8}}>
                                <span style={{color:f.type==="bull"?"#059669":"#dc2626",minWidth:40}}>{f.type}</span>
                                <span style={{color:"#5c5c5c"}}>[{f.zone[0].toFixed(2)} – {f.zone[1].toFixed(2)}]</span>
                                <span style={{color:f.mitigated?"#94a3b8":"#b45309",fontWeight:600}}>{f.mitigated?"mitigated":"open"}</span>
                              </div>
                            ))}
                          </div>
                        </div>}
                        {ex.inducement?<div style={{marginTop:8,padding:"8px 10px",background:"#7c3aed14",border:"1px solid #7c3aed50",borderRadius:6}}>
                          <div style={{fontSize:11,color:"#7c3aed",fontWeight:700}}>Vùng dẫn dụ (Inducement)</div>
                          <div style={{fontSize:11,color:"#374151",marginTop:4}}>{ex.inducement.direction} · [{ex.inducement.zone[0].toFixed(2)} – {ex.inducement.zone[1].toFixed(2)}]</div>
                          <div style={{fontSize:10,color:"#64748b",marginTop:4}}>FVG ngay trên/dưới vùng này thường là entry đẹp.</div>
                        </div>:<div style={{marginTop:8,fontSize:10,color:"#94a3b8"}}>Inducement: — (chưa có sweep rõ)</div>}
                        {ex.reasons?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
                          {ex.reasons.map((r,i)=><span key={i} style={{background:`${r.c}18`,border:`1px solid ${r.c}50`,borderRadius:6,padding:"4px 8px",fontSize:10,color:r.c,fontWeight:600}}>{r.t}</span>)}
                        </div>}
                      </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
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
