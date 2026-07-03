import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as api from './api.js';
// Import (not a bare string path) so Vite's bundler tracks this reference
// and rewrites it to the correct hashed/copied path in dist/assets/ during
// build — the same way it already rewrites the <link rel="icon"> tag in
// index.html. A literal "./icon.svg" string only worked in dev (where Vite
// serves source files directly); in the production build the file actually
// ends up at dist/assets/icon-<hash>.svg with nothing left at dist/icon.svg,
// so the old string reference 404'd silently in every packaged build.
import iconUrl from './icon.svg';

// ─── Theme ────────────────────────────────────────────────────────────────────
const T = {
  bg: '#0e0e12', surface: '#16161c', surfaceHover: '#1c1c24', surfaceActive: '#22222e',
  border: '#28283a', borderSubtle: '#1c1c28',
  accent: '#7c6af7', accentHover: '#9585ff', accentDim: '#2d2858',
  youtube: '#ff4444', youtubeDim: '#3d1212',
  text: '#e6e6f0', textMuted: '#7a7a9a', textSubtle: '#46465e',
  success: '#3dd68c', successDim: 'rgba(61,214,140,0.1)',
  warning: '#f5a623', danger: '#f25c5c', dangerDim: 'rgba(242,92,92,0.1)',
  ai: '#b48af7', aiDim: '#28214a',
};

// ─── Global styles ────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Lora:ital,wght@0,400;0,600;1,400;1,600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; overflow: hidden; }
  body { background: ${T.bg}; color: ${T.text}; font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
  .reader-body { font-family: 'Lora', Georgia, serif; font-size: 17px; line-height: 1.8; max-width: 100%; overflow-x: hidden; word-wrap: break-word; overflow-wrap: break-word; }
  .reader-body * { max-width: 100% !important; }
  .reader-body p  { margin-bottom: 1.2em; }
  .reader-body h1,.reader-body h2,.reader-body h3 { font-family:'Inter',sans-serif; font-weight:600; line-height:1.3; margin:1.6em 0 0.6em; }
  .reader-body h2 { font-size:1.3em; } .reader-body h3 { font-size:1.1em; }
  .reader-body a  { color:${T.accent}; text-decoration:none; }
  .reader-body a:hover { text-decoration:underline; }
  .reader-body blockquote { border-left:3px solid ${T.accent}; padding:0.5em 1em; margin:1.2em 0; color:${T.textMuted}; font-style:italic; }
  .reader-body code { font-family:'JetBrains Mono','Fira Code',monospace; font-size:0.85em; background:${T.surfaceActive}; padding:0.15em 0.4em; border-radius:3px; font-style:normal; word-break:break-word; }
  .reader-body pre { background:${T.surfaceActive}; padding:1em; border-radius:8px; overflow-x:auto; margin:1em 0; max-width:100%; }
  .reader-body pre code { background:none; padding:0; word-break:normal; white-space:pre; }
  .reader-body ul,.reader-body ol { margin:0.75em 0 0.75em 1.5em; }
  .reader-body li { margin-bottom:0.4em; }
  .reader-body img { max-width:100%; height:auto; border-radius:6px; margin:0.5em 0; }
  .reader-body iframe,.reader-body video,.reader-body embed,.reader-body object { max-width:100%; }
  .reader-body .flux-lead-image { margin:0 0 1.4em; }
  .reader-body .flux-lead-image img { width:100%; max-height:420px; object-fit:cover; border-radius:10px; margin:0; }
  .reader-body table { border-collapse:collapse; width:100%; margin:1em 0; table-layout:fixed; }
  .reader-body th,.reader-body td { border:1px solid ${T.border}; padding:0.5em 0.75em; word-wrap:break-word; overflow-wrap:break-word; }
  .reader-body th { background:${T.surface}; font-family:'Inter',sans-serif; font-weight:600; font-size:0.9em; }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
  @keyframes slideIn { from { transform:translateX(10px); opacity:0; } to { transform:translateX(0); opacity:1; } }
  @keyframes slideInFromRight { from { transform:translateX(28px); opacity:0; } to { transform:translateX(0); opacity:1; } }
  @keyframes slideInFromLeft  { from { transform:translateX(-28px); opacity:0; } to { transform:translateX(0); opacity:1; } }
  @keyframes slideUp { from { transform:translateY(100%); } to { transform:translateY(0); } }
  @keyframes slideDown { from { transform:translateY(0); } to { transform:translateY(100%); } }
  .fade-in { animation:fadeIn 0.18s ease; }
  .slide-in { animation:slideIn 0.16s ease; }
  .slide-in-next { animation:slideInFromRight 0.22s cubic-bezier(0.16,1,0.3,1); }
  .slide-in-prev { animation:slideInFromLeft 0.22s cubic-bezier(0.16,1,0.3,1); }
  .slide-up { animation:slideUp 0.22s ease; }
  .slide-down { animation:slideDown 0.2s ease forwards; }
  .flux-picker-active, .flux-picker-active * { cursor: crosshair !important; pointer-events: auto !important; }
  .flux-drag-region { -webkit-app-region: drag; app-region: drag; }
  .flux-no-drag { -webkit-app-region: no-drag; app-region: no-drag; }
  input,textarea,select { background:${T.surfaceActive}; color:${T.text}; border:1px solid ${T.border}; border-radius:7px; padding:8px 12px; font-family:inherit; font-size:13px; outline:none; transition:border-color 0.15s; }
  input:focus,textarea:focus,select:focus { border-color:${T.accent}; }
  input::placeholder,textarea::placeholder { color:${T.textSubtle}; }
`;

// ─── Primitives ───────────────────────────────────────────────────────────────
function Spinner({ size=16, color=T.accent }) {
  return <div style={{ width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />;
}
function Badge({ children, tone='accent', tiny }) {
  const map = { accent:{bg:T.accentDim,fg:T.accent}, yt:{bg:T.youtubeDim,fg:T.youtube}, success:{bg:T.successDim,fg:T.success}, warning:{bg:'rgba(245,166,35,.12)',fg:T.warning}, ai:{bg:T.aiDim,fg:T.ai}, muted:{bg:T.surfaceActive,fg:T.textMuted}, danger:{bg:T.dangerDim,fg:T.danger} };
  const {bg,fg} = map[tone]||map.accent;
  return <span style={{ background:bg, color:fg, fontSize:tiny?9:10, fontWeight:600, letterSpacing:'0.04em', padding:tiny?'1px 5px':'2px 7px', borderRadius:4, whiteSpace:'nowrap', flexShrink:0 }}>{children}</span>;
}
function Btn({ children, onClick, variant='ghost', small, disabled, icon, style:sx }) {
  const [h,setH] = useState(false);
  const s = { ghost:{bg:h?T.surfaceHover:'transparent',fg:h?T.text:T.textMuted,border:'none'}, primary:{bg:h?T.accentHover:T.accent,fg:'#fff',border:'none'}, danger:{bg:h?'#c94040':T.danger,fg:'#fff',border:'none'}, outline:{bg:h?T.surfaceHover:'transparent',fg:h?T.text:T.textMuted,border:`1px solid ${T.border}`} }[variant]||{};
  return <button disabled={disabled} onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ background:s.bg, color:s.fg, border:s.border||'none', padding:small?'5px 10px':'7px 14px', borderRadius:7, cursor:disabled?'not-allowed':'pointer', fontSize:small?12:13, fontWeight:500, display:'flex', alignItems:'center', gap:6, transition:'all 0.12s', opacity:disabled?0.5:1, whiteSpace:'nowrap', flexShrink:0, ...sx }}>{icon&&<span>{icon}</span>}{children}</button>;
}
function IconBtn({ icon, onClick, title, active, danger, size=30, disabled }) {
  const [h,setH] = useState(false);
  return <button title={title} disabled={disabled} onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ width:size, height:size, border:'none', cursor:disabled?'not-allowed':'pointer', background:active?T.accentDim:h?T.surfaceHover:'transparent', color:disabled?T.textSubtle:active?T.accent:danger&&h?T.danger:h?T.text:T.textMuted, borderRadius:7, fontSize:size*0.47, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.12s', flexShrink:0, opacity:disabled?0.4:1 }}>{icon}</button>;
}
function Divider({ vertical, margin=8 }) {
  return <div style={vertical ? { width:1, alignSelf:'stretch', background:T.border, margin:`0 ${margin}px`, flexShrink:0 } : { height:1, background:T.borderSubtle, margin:`${margin}px 0` }} />;
}
function Modal({ title, children, onClose, wide }) {
  return <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:20, width:wide?560:420, maxWidth:'100%', maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.5)' }} className="fade-in">
      <div style={{ display:'flex', alignItems:'center', marginBottom:16, flexShrink:0 }}>
        <span style={{ fontWeight:700, fontSize:15 }}>{title}</span>
        <div style={{ flex:1 }} />
        <IconBtn icon="✕" onClick={onClose} size={26} />
      </div>
      <div style={{ overflowY:'auto', flex:1 }}>
        {children}
      </div>
    </div>
  </div>;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function timeAgo(d) {
  const date = d instanceof Date ? d : new Date(d);
  const m = Math.floor((Date.now()-date)/60000);
  if (m<1) return 'just now'; if (m<60) return `${m}m`;
  const h=Math.floor(m/60); if (h<24) return `${h}h`; return `${Math.floor(h/24)}d`;
}
function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return url; } }

// ─── DeArrow ──────────────────────────────────────────────────────────────────
// Community-sourced replacement titles and thumbnails for YouTube videos.
// API: https://dearrow.ajay.app/api/branding?videoID=<id>
// Falls back to original title/thumbnail if no entry or API unreachable.
async function fetchDeArrow(videoId) {
  try {
    const resp = await fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoId}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const title = data.titles?.find(t => t.votes > 0 && !t.locked === false || t.votes >= 0)?.title
                || data.titles?.[0]?.title
                || null;
    const thumb = data.thumbnails?.find(t => t.votes > 0)?.timestamp != null
      ? `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoId}&time=${data.thumbnails.find(t=>t.votes>0).timestamp}`
      : null;
    return { title, thumb };
  } catch { return null; }
}

// ─── OllamaStartPrompt component ──────────────────────────────────────────────
// Shown when an AI feature is triggered and Ollama isn't running.
function OllamaStartPrompt({ onStart, onCancel, starting, error }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000, padding:20 }}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:24, width:360, maxWidth:'100%', boxShadow:'0 20px 60px rgba(0,0,0,0.5)' }} className="fade-in">
        <div style={{ fontSize:28, marginBottom:12, textAlign:'center' }}>🦙</div>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:8, textAlign:'center' }}>Ollama isn't running</div>
        <div style={{ fontSize:13, color:T.textMuted, lineHeight:1.6, marginBottom:16, textAlign:'center' }}>
          This AI feature requires Ollama. Would you like Flux to start it?
          It'll be stopped automatically when you're done.
        </div>
        {error && <div style={{ fontSize:12, color:T.danger, background:'rgba(242,92,92,0.1)', border:`1px solid ${T.danger}33`, borderRadius:6, padding:'8px 12px', marginBottom:12, lineHeight:1.5 }}>{error}</div>}
        <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
          <Btn variant="outline" onClick={onCancel} disabled={starting}>Cancel</Btn>
          <Btn variant="primary" onClick={onStart} disabled={starting}>
            {starting ? <><Spinner size={12} color="#fff" /> Starting…</> : 'Start Ollama'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── useOllama hook ────────────────────────────────────────────────────────────
// Wraps any Ollama API call with:
//   1. A connectivity check before the call
//   2. A "Start Ollama?" prompt if not running
//   3. Auto-stop of the spawned process when the feature completes/errors
//
// Usage:
//   const { runWithOllama, promptJsx } = useOllama(settings);
//   // In render: {promptJsx}
//   // In handler: const result = await runWithOllama(() => api.ollama.summarize(...));
function useOllama(settings) {
  const [promptState, setPromptState] = useState(null); // null | 'asking' | 'starting'
  const [startError, setStartError] = useState(null);
  const resolveRef = useRef(null);
  const rejectRef  = useRef(null);
  const startedRef = useRef(false); // did WE start Ollama?

  const runWithOllama = useCallback(async (fn) => {
    const ollamaUrl = settings?.ollamaUrl;
    const autoStart = settings?.ollamaAutoStart;
    const { running } = await api.ollama.isRunning(ollamaUrl);
    if (!running) {
      if (autoStart) {
        // Skip prompt — start silently
        const r = await api.ollama.start(ollamaUrl);
        if (!r.ok) throw new Error(r.error || 'Could not start Ollama.');
        startedRef.current = !r.alreadyRunning;
      } else {
        // Ask the user
        const proceed = await new Promise((resolve, reject) => {
          resolveRef.current = resolve;
          rejectRef.current  = reject;
          setPromptState('asking');
          setStartError(null);
        });
        if (!proceed) return null;
      }
    }

    let result;
    try {
      result = await fn();
    } finally {
      if (startedRef.current) {
        api.ollama.stopIfStarted().catch(() => {});
        startedRef.current = false;
      }
    }
    return result;
  }, [settings?.ollamaUrl, settings?.ollamaAutoStart]);

  const handleStart = useCallback(async () => {
    setPromptState('starting');
    setStartError(null);
    const ollamaUrl = settings?.ollamaUrl;
    const r = await api.ollama.start(ollamaUrl);
    if (r.ok) {
      startedRef.current = !r.alreadyRunning;
      setPromptState(null);
      resolveRef.current?.(true);
    } else {
      setStartError(r.error || 'Failed to start Ollama.');
      setPromptState('asking'); // back to asking so they can retry or cancel
    }
  }, [settings?.ollamaUrl]);

  const handleCancel = useCallback(() => {
    setPromptState(null);
    setStartError(null);
    resolveRef.current?.(false);
  }, []);

  const promptJsx = promptState ? (
    <OllamaStartPrompt
      onStart={handleStart}
      onCancel={handleCancel}
      starting={promptState === 'starting'}
      error={startError}
    />
  ) : null;

  return { runWithOllama, promptJsx };
}

function useDeArrow(videoId, enabled) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled || !videoId) return;
    let cancelled = false;
    fetchDeArrow(videoId).then(d => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [videoId, enabled]);
  return data;
}
let _ytApiPromise = null;
function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (_ytApiPromise) return _ytApiPromise;
  _ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return _ytApiPromise;
}

// ─── Watch progress persistence (localStorage) ────────────────────────────────
const YT_PROGRESS_KEY = 'flux_yt_progress';
function getYtProgress(videoId) {
  try { return JSON.parse(localStorage.getItem(YT_PROGRESS_KEY) || '{}')[videoId] || 0; } catch { return 0; }
}
function setYtProgress(videoId, seconds) {
  try {
    const all = JSON.parse(localStorage.getItem(YT_PROGRESS_KEY) || '{}');
    all[videoId] = Math.floor(seconds);
    localStorage.setItem(YT_PROGRESS_KEY, JSON.stringify(all));
  } catch {}
}

// ─── SponsorBlock ──────────────────────────────────────────────────────────────
const SPONSORBLOCK_CATEGORIES = ['sponsor','selfpromo','interaction','intro','outro','preview'];
async function fetchSponsorSegments(videoId) {
  try {
    const cats = SPONSORBLOCK_CATEGORIES.map(c=>`category=${c}`).join('&');
    const resp = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&${cats}`);
    if (!resp.ok) return []; // 404 = no segments for this video
    const data = await resp.json();
    return (data||[]).map(s=>({ start:s.segment[0], end:s.segment[1], category:s.category }));
  } catch { return []; }
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ folders, feeds, articles, activeView, onSelectView, onOpenAddFeed, onAddToFolder, onRefreshAll, onExportOPML, onImportOPML, onNewFolder, onOpenSettings, onFeedSettings, onRemoveFeed, onRemoveFolder, onManageFolderFeeds, newArticleCount, settings, onReorderFolders, onEditFolder }) {
  const [dragFolderIdx, setDragFolderIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [feedMenu, setFeedMenu] = useState(null);   // { x, y, feed }
  const [folderMenu, setFolderMenu] = useState(null); // { x, y, folder }
  // Base-filtered articles for count computation — applies the same per-feed
  // content filters as visibleArticles (hideShorts, titleBlocklist) so sidebar
  // counts match what the user actually sees rather than including articles
  // that are filtered out.
  const baseFilteredArticles = useMemo(() => {
    return articles.filter(a => {
      const feed = feeds.find(f => f.id === a.feedId);
      if (feed?.hideShorts && a.isShort) return false;
      if (feed?.titleBlocklist?.length) {
        for (const pattern of feed.titleBlocklist) {
          try { if (new RegExp(pattern,'i').test(a.title)) return false; } catch {}
        }
      }
      return true;
    });
  }, [articles, feeds]);
  const unreadInFolder = (fid) => baseFilteredArticles.filter(a=>!a.isRead&&(fid==='__all'||feeds.find(f=>f.id===a.feedId)?.folder===fid)).length;
  const unreadInFeed   = (fid) => baseFilteredArticles.filter(a=>!a.isRead&&a.feedId===fid).length;

  const openFeedMenu = (e, feed) => setFeedMenu({ x:e.clientX, y:e.clientY, feed });
  const openFolderMenu = (e, folder) => setFolderMenu({ x:e.clientX, y:e.clientY, folder });

  return (
    <aside style={{ width:collapsed?52:216, minWidth:collapsed?52:216, background:T.surface, borderRight:`1px solid ${T.border}`, display:'flex', flexDirection:'column', transition:'width 0.2s ease, min-width 0.2s ease', overflow:'hidden' }}>
      {/* On macOS, titleBarStyle:'hiddenInset' removes the title bar but
          keeps the traffic-light buttons floating over the content, with
          no obvious way to drag the window. This header strip is marked
          as a draggable region (extra top padding clears the buttons);
          the collapse toggle is explicitly excluded so it stays clickable. */}
      <div className="flux-drag-region" style={{ padding: collapsed?(api.platform==='darwin'?'24px 8px 12px':'14px 8px 12px'):(api.platform==='darwin'?'26px 12px 12px':'14px 12px 12px'), borderBottom:`1px solid ${T.borderSubtle}`, display:'flex', alignItems:'center', gap:8, justifyContent:collapsed?'center':undefined }}>
        {collapsed
          ? <div className="flux-no-drag"><IconBtn icon="›" title="Expand sidebar" onClick={()=>setCollapsed(false)} size={28} /></div>
          : <>
              <img src={iconUrl} alt="" style={{ width:30, height:30, borderRadius:8, flexShrink:0 }} />
              <span style={{ fontWeight:700, fontSize:14, letterSpacing:'-0.01em' }}>Flux</span>
              <div style={{ flex:1 }} />
              <div className="flux-no-drag"><IconBtn icon="‹" title="Collapse sidebar" onClick={()=>setCollapsed(true)} size={26} /></div>
            </>
        }
      </div>

      <nav style={{ flex:1, overflowY:'auto', padding:'8px 6px 0' }}>
        {[{id:'__all',label:'All Items',icon:'◈'},{id:'__unread',label:'Unread',icon:'●'},{id:'__starred',label:'Starred',icon:'★'}]
          .filter(v=>!(settings?.hiddenViews||[]).includes(v.id))
          .map(v=>{
          const count = v.id==='__all'?unreadInFolder('__all'):v.id==='__unread'?articles.filter(a=>!a.isRead).length:articles.filter(a=>a.isStarred).length;
          return <SidebarRow key={v.id} icon={v.icon} label={v.label} count={count} isActive={activeView===v.id} collapsed={collapsed} onClick={()=>onSelectView(v.id)} />;
        })}
        {folders.map((folder, idx)=>{
          const ffeeds = feeds.filter(f=>f.folder===folder.id);
          return <FolderGroup key={folder.id} folder={folder} feeds={ffeeds} unreadTotal={unreadInFolder(folder.id)} unreadPerFeed={unreadInFeed} activeView={activeView} onSelectView={onSelectView} collapsed={collapsed} onFeedContextMenu={openFeedMenu} onFolderContextMenu={openFolderMenu} onAddFeedToFolder={(f)=>onAddToFolder(f)}
            draggable={!collapsed} dragIndex={idx}
            onDragStart={()=>setDragFolderIdx(idx)}
            onDragOver={(e)=>{ e.preventDefault(); if(dragOverIdx!==idx) setDragOverIdx(idx); }}
            onDrop={()=>{
              if (dragFolderIdx===null || dragFolderIdx===idx) { setDragFolderIdx(null); setDragOverIdx(null); return; }
              const reordered = [...folders];
              const [moved] = reordered.splice(dragFolderIdx, 1);
              reordered.splice(idx, 0, moved);
              setDragFolderIdx(null); setDragOverIdx(null);
              onReorderFolders(reordered.map(f=>f.id));
            }}
            onDragEnd={()=>{ setDragFolderIdx(null); setDragOverIdx(null); }}
            isDragging={dragFolderIdx===idx}
            showDropIndicator={dragOverIdx===idx && dragFolderIdx!==null && dragFolderIdx!==idx}
          />;
        })}
        {feeds.filter(f=>!f.folder||!folders.find(fo=>fo.id===f.folder)).map(feed=>(
          <SidebarRow key={feed.id} icon={feed.isYoutube?'▶':'◉'} label={feed.name} count={unreadInFeed(feed.id)} isActive={activeView===`feed:${feed.id}`} collapsed={collapsed} onClick={()=>onSelectView(`feed:${feed.id}`)} isYt={feed.isYoutube} onContextMenu={e=>{e.preventDefault();openFeedMenu(e,feed);}} favicon={feed.favicon} />
        ))}
        {!collapsed && (
          <div onClick={onNewFolder} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 9px', borderRadius:7, cursor:'pointer', marginTop:6, color:T.textSubtle, fontSize:12 }}
            onMouseEnter={e=>{e.currentTarget.style.background=T.surfaceHover;e.currentTarget.style.color=T.textMuted;}}
            onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color=T.textSubtle;}}>
            <span style={{ fontSize:12 }}>+</span><span>New folder</span>
          </div>
        )}
      </nav>

      {!collapsed&&(
        <div style={{ padding:10, borderTop:`1px solid ${T.borderSubtle}`, display:'flex', flexDirection:'column', gap:6 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ flex:1 }} />
            <IconBtn icon="⚙" title="Settings" onClick={onOpenSettings} size={26} />
          </div>
          <div style={{ display:'flex', gap:4 }}>
            <Btn small icon="+" variant="ghost" onClick={onOpenAddFeed}>Add feed</Btn>
            <div style={{ flex:1 }} />
            <div style={{ position:'relative', display:'inline-flex' }}>
              <IconBtn icon="↺" title={newArticleCount>0?`${newArticleCount} new article${newArticleCount>1?'s':''} — click to refresh`:'Refresh all'} onClick={onRefreshAll} size={28} />
              {newArticleCount>0&&<div style={{ position:'absolute', top:-2, right:-2, minWidth:14, height:14, borderRadius:7, background:T.accent, color:'#fff', fontSize:9, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px', pointerEvents:'none' }}>{newArticleCount>99?'99+':newArticleCount}</div>}
            </div>
          </div>
          <div style={{ display:'flex', gap:4 }}>
            <Btn small icon="↑" variant="outline" onClick={onExportOPML}>Export OPML</Btn>
            <Btn small icon="↓" variant="outline" onClick={onImportOPML}>Import OPML</Btn>
          </div>
        </div>
      )}
      {collapsed&&(
        <div style={{ padding:'8px 6px', borderTop:`1px solid ${T.borderSubtle}`, display:'flex', flexDirection:'column', gap:2 }}>
          <IconBtn icon="+" title="Add feed" onClick={onOpenAddFeed} size={40} />
          <IconBtn icon="↺" title="Refresh" onClick={onRefreshAll} size={40} />
          <IconBtn icon="↑" title="Export OPML" onClick={onExportOPML} size={40} />
          <IconBtn icon="↓" title="Import OPML" onClick={onImportOPML} size={40} />
          <IconBtn icon="⚙" title="Settings" onClick={onOpenSettings} size={40} />
        </div>
      )}

      {feedMenu && (
        <ContextMenu x={feedMenu.x} y={feedMenu.y} onClose={()=>setFeedMenu(null)} items={[
          { label:'Feed settings', icon:'⚙', onClick:()=>onFeedSettings(feedMenu.feed) },
          { divider:true },
          { label:'Remove feed', icon:'✕', danger:true, onClick:()=>onRemoveFeed(feedMenu.feed.id) },
        ]} />
      )}
      {folderMenu && (
        <ContextMenu x={folderMenu.x} y={folderMenu.y} onClose={()=>setFolderMenu(null)} items={[
          { label:'View all articles', icon:'◈', onClick:()=>onSelectView(`folder:${folderMenu.folder.id}`) },
          { label:'Add feeds', icon:'+', onClick:()=>onAddToFolder(folderMenu.folder) },
          { label:'Manage feeds', icon:'☰', onClick:()=>onManageFolderFeeds(folderMenu.folder) },
          { label:'Rename / change icon', icon:'✏️', onClick:()=>onEditFolder(folderMenu.folder) },
          { divider:true },
          { label:'Delete folder', icon:'✕', danger:true, onClick:()=>onRemoveFolder(folderMenu.folder.id) },
        ]} />
      )}
    </aside>
  );
}

function SidebarRow({ icon, label, count, isActive, collapsed, onClick, isYt, onContextMenu, indent, favicon }) {
  const [h,setH]=useState(false);
  const [faviconOk, setFaviconOk] = useState(!!favicon);
  useEffect(()=>{ setFaviconOk(!!favicon); },[favicon]);

  const iconContent = favicon && faviconOk
    ? <img src={favicon} alt="" onError={()=>setFaviconOk(false)} style={{ width:14, height:14, borderRadius:2, objectFit:'contain', flexShrink:0 }} />
    : <span style={{ fontSize:12, flexShrink:0 }}>{icon}</span>;

  return <div onClick={onClick} onContextMenu={onContextMenu} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ display:'flex', alignItems:'center', gap:8, padding:collapsed?'7px 11px':'6px 9px', paddingLeft:collapsed?undefined:(9+(indent||0)), borderRadius:7, cursor:'pointer', marginBottom:1, background:isActive?T.accentDim:h?T.surfaceHover:'transparent', color:isActive?T.accent:isYt?T.youtube:T.text, justifyContent:collapsed?'center':undefined, transition:'all 0.1s' }}>
    {iconContent}
    {!collapsed&&<><span style={{ flex:1, fontSize:12.5, fontWeight:isActive?600:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</span>{count>0&&<span style={{ background:isActive?T.accent:T.accentDim, color:isActive?'#fff':T.accent, fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:10, minWidth:18, textAlign:'center' }}>{count>99?'99+':count}</span>}</>}
  </div>;
}

function FolderGroup({ folder, feeds, unreadTotal, unreadPerFeed, activeView, onSelectView, collapsed, onFeedContextMenu, onFolderContextMenu, onAddFeedToFolder, draggable, onDragStart, onDragOver, onDrop, onDragEnd, isDragging, showDropIndicator }) {
  const [open,setOpen]=useState(()=>{
    try { return localStorage.getItem(`flux-folder-open-${folder.id}`) !== 'false'; } catch { return true; }
  });
  const [h,setH]=useState(false);
  const toggleOpen = (e) => {
    e.stopPropagation();
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(`flux-folder-open-${folder.id}`, String(next)); } catch {}
  };
  // Hide only when collapsed AND empty (saves space in the icon rail).
  // When expanded, show even empty folders so newly created folders are
  // visible immediately — otherwise "New folder" appears to do nothing.
  if (!feeds.length&&collapsed) return null;
  const isActive = activeView===`folder:${folder.id}`;
  return <div
    draggable={draggable}
    onDragStart={onDragStart}
    onDragOver={onDragOver}
    onDrop={onDrop}
    onDragEnd={onDragEnd}
    style={{ opacity:isDragging?0.4:1, borderTop:showDropIndicator?`2px solid ${T.accent}`:'2px solid transparent', transition:'opacity 0.15s' }}>
    <div onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      onContextMenu={e=>{e.preventDefault();onFolderContextMenu(e,folder);}}
      onClick={()=>onSelectView(`folder:${folder.id}`)}
      style={{ display:'flex', alignItems:'center', gap:6, padding:collapsed?'7px 11px':'5px 9px', borderRadius:7, cursor:'pointer', background:isActive?T.accentDim:h?T.surfaceHover:'transparent', color:isActive?T.accent:undefined, justifyContent:collapsed?'center':undefined, marginBottom:1, marginTop:4, transition:'background 0.1s' }}>
      {draggable&&<span style={{ fontSize:10, color:T.textSubtle, cursor:'grab', flexShrink:0 }}>⠿</span>}
      <span style={{ fontSize:11, color:isActive?T.accent:T.textSubtle }}>{folder.icon}</span>
      {!collapsed&&<>
        <span style={{ flex:1, fontSize:11, fontWeight:600, color:isActive?T.accent:T.textSubtle, letterSpacing:'0.05em', textTransform:'uppercase', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{folder.name}</span>
        {unreadTotal>0&&!open&&<span style={{ fontSize:10, color:T.textSubtle }}>{unreadTotal}</span>}
        <span onClick={toggleOpen} style={{ fontSize:10, color:T.textSubtle, transition:'transform 0.15s', transform:open?'rotate(0deg)':'rotate(-90deg)', padding:'2px 4px', cursor:'pointer', flexShrink:0 }}>▾</span>
      </>}
    </div>
    {!collapsed&&open&&(
      <div style={{ position:'relative' }}>
        {feeds.length>0&&<div style={{ position:'absolute', left:14, top:2, bottom:24, width:1, background:T.borderSubtle }} />}
        {feeds.length===0&&(
          <div style={{ padding:'4px 9px 6px', fontSize:11, color:T.textSubtle, fontStyle:'italic' }}>No feeds yet — add one below or right-click for options.</div>
        )}
        {feeds.map(feed=><SidebarRow key={feed.id} icon={feed.isYoutube?'▶':'◉'} label={feed.name} count={unreadPerFeed(feed.id)} isActive={activeView===`feed:${feed.id}`} collapsed={false} onClick={()=>onSelectView(`feed:${feed.id}`)} isYt={feed.isYoutube} onContextMenu={e=>{e.preventDefault();onFeedContextMenu(e,feed);}} indent={12} favicon={feed.favicon} />)}
        <div onClick={()=>onAddFeedToFolder(folder)} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 9px', paddingLeft:21, borderRadius:7, cursor:'pointer', color:T.textSubtle, fontSize:11.5 }}
          onMouseEnter={e=>{e.currentTarget.style.background=T.surfaceHover;e.currentTarget.style.color=T.textMuted;}}
          onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color=T.textSubtle;}}>
          <span style={{ fontSize:11 }}>+</span><span>Add feeds</span>
        </div>
      </div>
    )}
  </div>;
}

// ─── Article List ─────────────────────────────────────────────────────────────
function ArticleList({ articles, activeView, feeds, folders, onSelect, selectedId, onMarkAllRead, filters, onFiltersChange, showAiFilter, onOpenFeedSettings, collapsed, onToggleCollapse, deArrowEnabled }) {
  const [search, setSearch] = useState('');
  const listScrollRef = useRef(null);

  // Reset scroll position when switching views — don't carry position from
  // one folder/feed into a completely different one.
  useEffect(()=>{
    if (listScrollRef.current) listScrollRef.current.scrollTop = 0;
  },[activeView]);

  const filtered = useMemo(()=>{
    let base;
    if (activeView==='__all') base = articles;
    else if (activeView==='__unread') base = articles.filter(a=>!a.isRead);
    else if (activeView==='__starred') base = articles.filter(a=>a.isStarred);
    else if (activeView.startsWith('feed:')) base = articles.filter(a=>a.feedId===activeView.slice(5));
    else if (activeView.startsWith('folder:')) { const fid=activeView.slice(7); base = articles.filter(a=>feeds.find(f=>f.id===a.feedId)?.folder===fid); }
    else base = articles;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      base = base.filter(a => a.title.toLowerCase().includes(q) || a.summary?.toLowerCase().includes(q) || feeds.find(f=>f.id===a.feedId)?.name?.toLowerCase().includes(q));
    }
    return base;
  },[articles,activeView,feeds,search]);

  const label = activeView==='__all'?'All Items'
    :activeView==='__unread'?'Unread'
    :activeView==='__starred'?'Starred'
    :activeView.startsWith('feed:')?(feeds.find(f=>f.id===activeView.slice(5))?.name||'Feed')
    :activeView.startsWith('folder:')?(folders?.find(fo=>fo.id===activeView.slice(7))?.name||'Folder')
    :'Folder';

  const feedsInView = useMemo(()=>{
    const ids = new Set(filtered.map(a=>a.feedId));
    return feeds.filter(f=>ids.has(f.id)).sort((a,b)=>a.name.localeCompare(b.name));
  },[filtered,feeds]);

  const singleFeed = activeView.startsWith('feed:') ? feeds.find(f=>f.id===activeView.slice(5)) : null;

  const displayed = useMemo(()=>{
    if (!showAiFilter) return filtered.map(a=>({ type:'article', article:a }));
    const seen = new Set();
    const out = [];
    for (const a of filtered) {
      if (a.clusterId) {
        if (seen.has(a.clusterId)) continue;
        seen.add(a.clusterId);
        const members = filtered.filter(x=>x.clusterId===a.clusterId).sort((x,y)=>new Date(y.date)-new Date(x.date));
        out.push({ type:'group', clusterId:a.clusterId, members });
      } else {
        out.push({ type:'article', article:a });
      }
    }
    return out;
  },[filtered, showAiFilter]);

  const handleSelect = (item) => {
    onSelect(item);
  };

  if (collapsed) {
    // Collapsed rail — just a thin strip showing the label and expand button
    return <div style={{ width:40, minWidth:40, background:T.surface, borderRight:`1px solid ${T.border}`, display:'flex', flexDirection:'column', alignItems:'center', padding:'10px 0', gap:8, overflow:'hidden', transition:'width 0.2s ease' }}>
      <IconBtn icon="›" title={`Expand article list (${label})`} onClick={()=>onToggleCollapse?.(false)} size={32} />
      {filtered.filter(a=>!a.isRead).length>0&&(
        <div style={{ fontSize:10, fontWeight:700, color:T.accent, writingMode:'vertical-rl', textOrientation:'mixed', transform:'rotate(180deg)', letterSpacing:'0.03em', marginTop:4 }}>
          {filtered.filter(a=>!a.isRead).length}
        </div>
      )}
    </div>;
  }

  return <div style={{ width:320, minWidth:320, background:T.surface, borderRight:`1px solid ${T.border}`, display:'flex', flexDirection:'column', overflow:'hidden', transition:'width 0.2s ease' }}>
    <div style={{ padding:'12px 14px 10px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
      <IconBtn icon="‹" title="Collapse article list" onClick={()=>onToggleCollapse?.(true)} size={26} />
      <span style={{ fontWeight:700, fontSize:14 }}>{label}</span>
      <span style={{ color:T.textSubtle, fontSize:11 }}>{filtered.filter(a=>!a.isRead).length} unread</span>
      <div style={{ flex:1 }} />
      {singleFeed && <IconBtn icon="⚙" title="Feed settings" onClick={()=>onOpenFeedSettings(singleFeed)} size={26} />}
      <IconBtn icon="⊟" title="Mark all read" onClick={onMarkAllRead} size={26} />
    </div>
    <FilterBar filters={filters} onChange={onFiltersChange} feedsInView={feedsInView} showAiFilter={showAiFilter} />
    <div style={{ padding:'6px 10px', borderBottom:`1px solid ${T.borderSubtle}`, display:'flex', alignItems:'center', gap:6 }}>
      <span style={{ color:T.textSubtle, fontSize:13 }}>🔍</span>
      <input
        value={search} onChange={e=>setSearch(e.target.value)}
        placeholder="Search articles…"
        style={{ flex:1, background:'transparent', border:'none', outline:'none', fontSize:13, color:T.text, padding:'2px 0' }}
      />
      {search && <IconBtn icon="✕" size={20} onClick={()=>setSearch('')} />}
    </div>
    <div ref={listScrollRef} style={{ flex:1, overflowY:'auto' }}>
      {filtered.length===0&&(
        feeds.length===0
          ? <div style={{ padding:24, textAlign:'center', color:T.textSubtle, fontSize:13 }}>Nothing here yet.<br/>Add a feed to get started.</div>
          : <div style={{ padding:24, textAlign:'center', color:T.textSubtle, fontSize:13 }}>Nothing matches the current filters.</div>
      )}
      {displayed.map(item => item.type==='group'
        ? <GroupRow key={`group:${item.clusterId}`} group={item} feeds={feeds} isSelected={selectedId===`group:${item.clusterId}`} onClick={()=>handleSelect({ id:`group:${item.clusterId}`, isGroup:true, clusterId:item.clusterId, members:item.members })} />
        : <ArticleRow key={item.article.id} article={item.article} feed={feeds.find(f=>f.id===item.article.feedId)} isSelected={item.article.id===selectedId} onClick={()=>handleSelect(item.article)} deArrowEnabled={deArrowEnabled} />
      )}
    </div>
  </div>;
}

function ArticleRow({ article, feed, isSelected, onClick, deArrowEnabled }) {
  const [h,setH]=useState(false);
  const isYt=article.isYoutube;
  const dearrow = useDeArrow(isYt ? article.videoId : null, !!deArrowEnabled);
  const displayTitle = (deArrowEnabled && dearrow?.title) ? dearrow.title : article.title;
  const displayThumb = (deArrowEnabled && dearrow?.thumb) ? dearrow.thumb : article.thumbnail;

  return <div onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ padding:'11px 13px', borderBottom:`1px solid ${T.borderSubtle}`, cursor:'pointer', background:isSelected?T.surfaceActive:h?T.surfaceHover:'transparent', borderLeft:`3px solid ${isSelected?T.accent:'transparent'}`, transition:'background 0.1s', position:'relative' }}>
    {isYt&&displayThumb&&<div style={{ width:'100%', aspectRatio:'16/9', borderRadius:6, overflow:'hidden', background:T.bg, marginBottom:8, position:'relative' }}>
      <img src={displayThumb} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e=>{e.target.style.display='none';}} />
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ width:32, height:32, borderRadius:'50%', background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:12 }}>▶</div></div>
      {deArrowEnabled&&dearrow?.title&&<div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'4px 6px', background:'rgba(0,0,0,.7)', fontSize:11, color:'#fff', fontWeight:600 }}>{dearrow.title}</div>}
    </div>}
    <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4, flexWrap:'wrap' }}>
      <span style={{ fontSize:10, fontWeight:700, letterSpacing:'0.04em', color:isYt?T.youtube:T.accent, textTransform:'uppercase' }}>{feed?.name||domainOf(article.link)}</span>
      {isYt&&article.duration&&<Badge tone="yt" tiny>▶ {article.duration}</Badge>}
      {article.clusterId&&<Badge tone="ai" tiny>◆ {article.clusterSize}</Badge>}
      {feed?.inlineBrowser&&<Badge tone="muted" tiny>inline</Badge>}
      {deArrowEnabled&&dearrow?.title&&<Badge tone="muted" tiny>DeArrow</Badge>}
      <span style={{ flex:1 }} />
      {!article.isRead&&<div style={{ width:6, height:6, borderRadius:'50%', background:isYt?T.youtube:T.accent, flexShrink:0 }} />}
      <span style={{ fontSize:10, color:T.textSubtle }}>{timeAgo(article.date)}</span>
    </div>
    <div style={{ fontSize:13, fontWeight:article.isRead?400:600, color:article.isRead?T.textMuted:T.text, lineHeight:1.4, marginBottom:4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{displayTitle}</div>
    {article.summary&&<div style={{ fontSize:12, color:T.textMuted, lineHeight:1.45, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{article.summary}</div>}
    {article.isStarred&&<span style={{ position:'absolute', bottom:10, right:12, fontSize:11, color:T.warning }}>★</span>}
  </div>;
}

function GroupRow({ group, feeds, isSelected, onClick }) {
  const [h,setH]=useState(false);
  const top = group.members[0];
  const isYt = top.isYoutube;
  const sourceNames = [...new Set(group.members.map(m=>feeds.find(f=>f.id===m.feedId)?.name || domainOf(m.link)))];
  const anyUnread = group.members.some(m=>!m.isRead);
  return <div onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ padding:'11px 13px', borderBottom:`1px solid ${T.borderSubtle}`, cursor:'pointer', background:isSelected?T.surfaceActive:h?T.surfaceHover:'transparent', borderLeft:`3px solid ${isSelected?T.accent:'transparent'}`, transition:'background 0.1s', position:'relative' }}>
    {isYt&&top.thumbnail&&<div style={{ width:'100%', aspectRatio:'16/9', borderRadius:6, overflow:'hidden', background:T.bg, marginBottom:8, position:'relative' }}>
      <img src={top.thumbnail} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e=>{e.target.style.display='none';}} />
    </div>}
    <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4, flexWrap:'wrap' }}>
      <Badge tone="ai" tiny>◆ {group.members.length} sources</Badge>
      <span style={{ flex:1 }} />
      {anyUnread&&<div style={{ width:6, height:6, borderRadius:'50%', background:isYt?T.youtube:T.accent, flexShrink:0 }} />}
      <span style={{ fontSize:10, color:T.textSubtle }}>{timeAgo(top.date)}</span>
    </div>
    <div style={{ fontSize:13, fontWeight:anyUnread?600:400, color:anyUnread?T.text:T.textMuted, lineHeight:1.4, marginBottom:4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{top.title}</div>
    <div style={{ fontSize:11, color:T.textSubtle, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sourceNames.join(' · ')}</div>
  </div>;
}

// ─── Group View (clustered "same story" articles) ─────────────────────────────
function GroupView({ group, feeds, settings, onOpenMember }) {
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const top = group.members[0];

  useEffect(()=>{
    setSummary(null); setSummaryError(false);
    if (!settings?.aiClusteringEnabled) return;
    setSummaryLoading(true);
    const items = group.members.map(m=>({
      title: m.title,
      summary: m.summary,
      source: feeds.find(f=>f.id===m.feedId)?.name,
    }));
    api.ollama.summarize({ items, ollamaUrl: settings.ollamaUrl||undefined })
      .then(r=>setSummary(r?.summary||null))
      .catch(()=>setSummaryError(true))
      .finally(()=>setSummaryLoading(false));
  },[group.clusterId, settings?.aiClusteringEnabled]);

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'10px 20px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:8, flexShrink:0, background:T.surface }}>
        <Badge tone="ai">◆ {group.members.length} sources covering this story</Badge>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'28px 32px', maxWidth:760, width:'100%', margin:'0 auto' }}>
        <h1 style={{ fontSize:24, fontWeight:700, lineHeight:1.3, marginBottom:16, color:T.text }}>{top.title}</h1>

        <div style={{ background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:10, padding:'14px 16px', marginBottom:24 }}>
          <div style={{ fontSize:11, fontWeight:700, color:T.textSubtle, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:8 }}>AI summary across sources</div>
          {summaryLoading && <div style={{ display:'flex', alignItems:'center', gap:8, color:T.textMuted, fontSize:13 }}><Spinner size={13}/>Summarizing coverage…</div>}
          {summaryError && <div style={{ fontSize:13, color:T.textSubtle }}>Couldn't generate a summary — Ollama may not be running or reachable.</div>}
          {summary && <div style={{ fontSize:14, color:T.text, lineHeight:1.6 }}>{summary}</div>}
          {!settings?.aiClusteringEnabled && <div style={{ fontSize:13, color:T.textSubtle }}>Enable AI grouping in Settings to generate a cross-source summary.</div>}
        </div>

        <div style={{ fontSize:11, fontWeight:700, color:T.textSubtle, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:10 }}>Read individual coverage</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {group.members.map(m=>{
            const feed = feeds.find(f=>f.id===m.feedId);
            return (
              <div key={m.id} onClick={()=>onOpenMember(m)}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderRadius:8, border:`1px solid ${T.border}`, cursor:'pointer', background:T.surface, transition:'background 0.1s' }}
                onMouseEnter={e=>e.currentTarget.style.background=T.surfaceHover}
                onMouseLeave={e=>e.currentTarget.style.background=T.surface}>
                <div style={{ flex:1, overflow:'hidden' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:T.accent, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:3 }}>{feed?.name || domainOf(m.link)}</div>
                  <div style={{ fontSize:13, fontWeight:m.isRead?400:600, color:m.isRead?T.textMuted:T.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.title}</div>
                </div>
                {!m.isRead&&<div style={{ width:6, height:6, borderRadius:'50%', background:T.accent, flexShrink:0 }} />}
                {m.isStarred&&<span style={{ color:T.warning, fontSize:12 }}>★</span>}
                <span style={{ fontSize:11, color:T.textSubtle, flexShrink:0 }}>{timeAgo(m.date)}</span>
                <span style={{ color:T.textSubtle, flexShrink:0 }}>→</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function InlineBrowser({ url, onClose, onNavigateArticle, onStepBack, isMobile }) {
  const [history, setHistory] = useState([url]);
  const [idx, setIdx]         = useState(0);
  const [title, setTitle]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack]       = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const webviewRef = useRef(null);
  const iframeRef  = useRef(null);
  const current    = history[idx];

  // Web mode: proxy through the backend so X-Frame-Options/CSP headers that
  // would otherwise block framing are stripped server-side.
  const proxiedSrc = `/api/proxy?url=${encodeURIComponent(current)}`;

  const pushHistory = useCallback((newUrl) => {
    if (!newUrl || newUrl === 'about:blank') return;
    setHistory(h => {
      if (h[idx] === newUrl) return h; // no-op, already here
      return [...h.slice(0, idx+1), newUrl];
    });
    setIdx(i => i+1);
  }, [idx]);

  // ── Electron: <webview> wiring ────────────────────────────────────────────
  useEffect(() => {
    if (!api.isElectron) return;
    const wv = webviewRef.current;
    if (!wv) return;

    const onStartLoading = () => setLoading(true);
    const onStopLoading  = () => {
      setLoading(false);
      try {
        setCanGoBack(wv.canGoBack());
        setCanGoForward(wv.canGoForward());
      } catch {}
    };
    const onNavigate = (e) => {
      const newUrl = e.url;
      if (newUrl && newUrl !== current) pushHistory(newUrl);
      // Update back/forward availability immediately on navigation, not
      // just on stop-loading — makes buttons update in real-time.
      try { setCanGoBack(wv.canGoBack()); setCanGoForward(wv.canGoForward()); } catch {}
    };
    const onTitleUpdated = (e) => setTitle(e.title);
    const onFailLoad = (e) => {
      // -3 is ERR_ABORTED, common on redirects — ignore
      if (e.errorCode === -3) return;
      setLoading(false);
    };

    wv.addEventListener('did-start-loading', onStartLoading);
    wv.addEventListener('did-stop-loading', onStopLoading);
    wv.addEventListener('did-navigate', onNavigate);
    wv.addEventListener('did-navigate-in-page', onNavigate);
    wv.addEventListener('page-title-updated', onTitleUpdated);
    wv.addEventListener('did-fail-load', onFailLoad);

    // Keyboard shortcuts inside the embedded page don't bubble to our
    // window — <webview> content runs in a separate guest page. Forward
    // a small set of navigation shortcuts via before-input-event so you're
    // never "trapped" with no way to move between articles.
    //   Alt+← / Alt+→  → previous/next article (Alt avoids clobbering
    //                     normal arrow-key use in the embedded page, e.g.
    //                     text fields, video seeking, carousels)
    //   Escape          → step back through followed-link history
    const onBeforeInput = (e) => {
      if (e.type !== 'keyDown') return;
      if (e.alt && e.key === 'ArrowLeft')  onNavigateArticle?.(-1);
      else if (e.alt && e.key === 'ArrowRight') onNavigateArticle?.(1);
      else if (e.key === 'Escape') onStepBack?.();
    };
    wv.addEventListener('before-input-event', onBeforeInput);

    return () => {
      wv.removeEventListener('did-start-loading', onStartLoading);
      wv.removeEventListener('did-stop-loading', onStopLoading);
      wv.removeEventListener('did-navigate', onNavigate);
      wv.removeEventListener('did-navigate-in-page', onNavigate);
      wv.removeEventListener('page-title-updated', onTitleUpdated);
      wv.removeEventListener('did-fail-load', onFailLoad);
      wv.removeEventListener('before-input-event', onBeforeInput);
    };
  }, [pushHistory, onNavigateArticle, onStepBack]); // intentionally omits 'current' — listener setup runs once per mount

  // Electron: target=_blank / window.open() inside the page → navigate
  // the webview itself instead of spawning a new Electron window.
  useEffect(() => {
    if (!api.isElectron) return;
    return api.webview.onNewWindow((newUrl) => {
      pushHistory(newUrl);
      webviewRef.current?.loadURL(newUrl);
    });
  }, [pushHistory]);

  // Load the current URL into the webview whenever it changes via our own
  // back/forward buttons (in-page navigation already updates history directly).
  useEffect(() => {
    if (!api.isElectron) return;
    const wv = webviewRef.current;
    if (!wv) return;
    try { if (wv.getURL?.() === current) return; } catch {}
    try { wv.loadURL?.(current); } catch {}
  }, [current]);

  const navigate = (dir) => {
    if (api.isElectron) {
      const wv = webviewRef.current;
      try {
        if (dir < 0 && wv?.canGoBack?.()) wv.goBack();
        else if (dir > 0 && wv?.canGoForward?.()) wv.goForward();
      } catch {}
      return;
    }
    setIdx(i => Math.max(0, Math.min(history.length-1, i+dir)));
  };

  const reload = () => {
    if (api.isElectron) { try { webviewRef.current?.reload?.(); } catch {} }
    else if (iframeRef.current) iframeRef.current.src = iframeRef.current.src;
  };

  // Web-mode iframe: detect in-page navigation where possible (same-origin
  // only — cross-origin loads can't be introspected, so back/forward there
  // just replays our own history stack).
  const handleIframeLoad = () => {
    setLoading(false);
    try {
      const loc = iframeRef.current?.contentWindow?.location?.href;
      if (loc && loc !== 'about:blank') pushHistory(loc);
    } catch {} // cross-origin — expected, ignore
  };

  const backDisabled    = api.isElectron ? !canGoBack    : idx === 0;
  const forwardDisabled = api.isElectron ? !canGoForward : idx === history.length-1;

  return (
    <div style={{ position:'absolute', inset:0, zIndex:30, background:T.bg, display:'flex', flexDirection:'column' }}>
      {/* Browser chrome */}
      <div style={{ padding: isMobile?'10px 12px':'8px 12px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:6, background:T.surface, flexShrink:0, paddingTop: isMobile?'calc(10px + env(safe-area-inset-top))':8 }}>
        <IconBtn icon="←" title="Back" onClick={()=>navigate(-1)} disabled={backDisabled} size={isMobile?36:28} />
        <IconBtn icon="→" title="Forward" onClick={()=>navigate(1)} disabled={forwardDisabled} size={isMobile?36:28} />
        <IconBtn icon="↺" title="Reload" onClick={reload} size={isMobile?36:28} />
        {loading && <Spinner size={13} />}
        {!isMobile && (
          <div style={{ flex:1, background:T.surfaceActive, borderRadius:6, padding:'5px 10px', fontSize:12, color:T.textMuted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {title ? `${title} — ${current}` : current}
          </div>
        )}
        {isMobile && <div style={{ flex:1 }} />}
        <IconBtn icon="↗" title="Open in default browser" onClick={()=>api.openExternal(current)} size={isMobile?36:28} />
        {!isMobile && <><Divider vertical margin={4} /><Btn small variant="outline" onClick={onClose}>✕ Close</Btn></>}
        {isMobile && <IconBtn icon="✕" title="Close" onClick={onClose} size={36} />}
      </div>

      {api.isElectron ? (
        <>
          <webview
            ref={webviewRef}
            src={current}
            style={{ flex:1, display:'flex' }}
            allowpopups="true"
          />
          {!isMobile && (
            <div style={{ padding:'4px 12px', fontSize:11, color:T.textSubtle, background:T.surface, borderTop:`1px solid ${T.borderSubtle}`, flexShrink:0 }}>
              Alt+← / Alt+→ switches articles · Escape steps back through followed links
            </div>
          )}
          {isMobile && <div style={{ flexShrink:0, height:'calc(52px + env(safe-area-inset-bottom))' }} />}
        </>
      ) : (
        <>
          {current ? (
            <iframe
              key={current}
              ref={iframeRef}
              src={proxiedSrc}
              onLoad={handleIframeLoad}
              sandbox="allow-scripts allow-forms allow-popups allow-pointer-lock allow-top-navigation-by-user-activation"
              style={{ flex:1, border:'none', background:'#fff' }}
              title="Inline browser"
            />
          ) : (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:T.textSubtle }}>No URL</div>
          )}
          {!isMobile && (
            <div style={{ padding:'4px 12px', fontSize:11, color:T.textSubtle, background:T.surface, borderTop:`1px solid ${T.borderSubtle}`, flexShrink:0 }}>
              Some sites block embedding entirely — if the page is blank, use ↗ to open it in a real browser tab.
            </div>
          )}
          {isMobile && <div style={{ flexShrink:0, height:'calc(52px + env(safe-area-inset-bottom))' }} />}
        </>
      )}
    </div>
  );
}

// ─── Reader Pane ──────────────────────────────────────────────────────────────
function ReaderPane({ article, feed, allArticles, allFeeds, onNavigate, onMarkRead, onToggleStar, onOpenRules, onSaveRule, settings, isMobile }) {
  const [content,    setContent]    = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [fontSize,   setFontSize]   = useState(17);
  const [lineWidth,  setLineWidth]  = useState(680);
  const [pickMode,   setPickMode]   = useState(false);
  const [ruleWarning,setRuleWarning] = useState(null);
  const [articleSummary, setArticleSummary] = useState(null);
  const [mobileMoreMenu, setMobileMoreMenu] = useState(null);
  const [inlineBrow, setInlineBrow] = useState(false);
  const [browUrl,    setBrowUrl]    = useState(null);
  const [browStack,  setBrowStack]  = useState([]);

  const { runWithOllama, promptJsx: ollamaPromptJsx } = useOllama(settings);

  const readerScrollRef = useRef(null);
  const contentRef      = useRef(null);
  const outerDivRef     = useRef(null); // needed for non-passive wheel listener
  // Tracks which way navigate() was last called (1 = next, -1 = previous,
  // 0 = not a directional nav e.g. clicking an article in the list) so the
  // article-change animation can slide in from the matching side instead
  // of always using the same generic fade — makes swipe/keyboard/wheel
  // navigation feel continuous instead of an abrupt cut.
  const navDirRef        = useRef(0);
  const currentIdx      = allArticles.findIndex(a=>a.id===article?.id);

  // Reset state when article changes
  useEffect(()=>{
    setContent(null); setError(null); setPickMode(false); setRuleWarning(null); setArticleSummary(null);
    setInlineBrow(false); setBrowUrl(null); setBrowStack([]);
    // Always reset scroll to top — don't carry position from one article
    // to the next or from one view into a completely different article.
    if (readerScrollRef.current) readerScrollRef.current.scrollTop = 0;
    if (!article || article.isGroup) return;

    // Mark read after a brief view delay, regardless of article type or
    // whether it opens in the inline browser — previously this only
    // happened on the Readability-fetch path, so inline-browser and
    // YouTube articles never got marked read.
    const markReadTimer = setTimeout(()=>onMarkRead(article.id, article.feedId), 1200);

    if (article.isYoutube) return ()=>clearTimeout(markReadTimer);

    // If feed uses inline browser, show that by default
    if (feed?.inlineBrowser) { setInlineBrow(true); setBrowUrl(article.link); return ()=>clearTimeout(markReadTimer); }

    loadArticleContent(article);

    return ()=>clearTimeout(markReadTimer);
  },[article?.id]);

  // Pulled out of the effect above so the manual inline-browser toggle can
  // also trigger it. Previously, switching a feed's default to inline
  // browser meant the regular-reader fetch never ran for that article at
  // all — so flipping back to regular mode mid-article left `content`
  // stuck at null forever (the effect only fires on article?.id changes,
  // not when inlineBrow is toggled by hand).
  const loadArticleContent = useCallback((art)=>{
    setLoading(true);
    api.articles.fetch({
      url:         art.link,
      feedId:      art.feedId,
      rssFallback: { title: art.title, summary: art.summary },
    })
      .then(r=>{ setContent(r); setLoading(false); })
      .catch(e=>{ setError(e.message); setLoading(false); });
  },[]);

  // Clear the direction flag after the article-change render has used it,
  // so the *next* article change defaults back to the plain fade unless
  // navigate() sets a direction again. Runs after paint, so the animation
  // class above already had the right value when it mattered.
  useEffect(()=>{
    navDirRef.current = 0;
  },[article?.id]);

  // Shared by navigate() and the mobile prev/next preview labels — group
  // entries are synthetic (not in allArticles), so we step from the edge
  // of the cluster's member span rather than from a real index.
  const groupEdgeIdx = useCallback((dir)=>{
    if (!article?.isGroup) return currentIdx;
    const memberIds = new Set((article.members||[]).map(m=>m.id));
    const indices = allArticles.map((a,i)=>memberIds.has(a.id)?i:-1).filter(i=>i!==-1);
    if (!indices.length) return currentIdx;
    return dir>0 ? Math.max(...indices) : Math.min(...indices);
  },[article,currentIdx,allArticles]);

  const navigate = useCallback((dir)=>{
    const idx = groupEdgeIdx(dir);
    let next = allArticles[idx+dir];
    // Landing on a clustered article should open its group view, same as
    // clicking the collapsed group row in the article list would.
    if (next?.clusterId) {
      const members = allArticles.filter(a=>a.clusterId===next.clusterId).sort((x,y)=>new Date(y.date)-new Date(x.date));
      next = { id:`group:${next.clusterId}`, isGroup:true, clusterId:next.clusterId, members };
    }
    if (next) { navDirRef.current = dir; onNavigate(next); }
  },[groupEdgeIdx,allArticles,onNavigate]);

  const prevArticle = allArticles[groupEdgeIdx(-1)-1] || null;
  const nextArticle = allArticles[groupEdgeIdx(1)+1] || null;
  const [toast, setToast] = useState(null);
  const handleShare = useCallback(async ()=>{
    const shareData = { title: article.title||'', url: article.link };
    if (navigator.share) {
      try { await navigator.share(shareData); return; }
      catch (e) { if (e?.name === 'AbortError') return; } // user cancelled the native sheet — not a failure
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(article.link);
      } else {
        // navigator.clipboard requires a secure context (https, or
        // localhost) — plain http:// LAN access (the server's normal mode)
        // doesn't have it, so fall back to the old execCommand trick.
        const ta = document.createElement('textarea');
        ta.value = article.link; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      setToast('Link copied');
    } catch { setToast('Could not share'); }
    setTimeout(()=>setToast(null), 1500);
  },[article]);

  // Arrow-key scroll (up/down) + article navigation (left/right, j/k)
  // Note: when the inline browser webview has focus, keydown events don't
  // bubble to window — arrow-key nav is handled via `before-input-event`
  // on the webview itself (see InlineBrowser component). These window
  // listeners only fire when focus is in the host window (reader mode,
  // toolbar, etc.).
  useEffect(()=>{
    if (pickMode) return;
    const handler=(e)=>{
      if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
      if (inlineBrow) return; // focus is inside webview; handled by before-input-event
      const scrollEl = readerScrollRef.current;
      if (e.key==='ArrowDown'||e.key==='PageDown') { e.preventDefault(); scrollEl?.scrollBy({top:e.key==='PageDown'?scrollEl.clientHeight*0.85:120,behavior:'smooth'}); }
      if (e.key==='ArrowUp'  ||e.key==='PageUp')   { e.preventDefault(); scrollEl?.scrollBy({top:e.key==='PageUp'  ?-scrollEl.clientHeight*0.85:-120,behavior:'smooth'}); }
      if ((e.key==='ArrowRight'||e.key==='j')&&!browStack.length) navigate(1);
      if ((e.key==='ArrowLeft' ||e.key==='k')&&!browStack.length) navigate(-1);
      if (e.key==='Escape'&&browStack.length) setBrowStack(s=>s.slice(0,-1));
    };
    window.addEventListener('keydown',handler);
    return ()=>window.removeEventListener('keydown',handler);
  },[navigate,pickMode,browStack.length,inlineBrow]);

  // Handle new-window events from webviews (target=_blank, window.open).
  // The main process sends 'webview:new-window' via IPC — we decide here
  // whether to load it in the inline browser (if it's currently open) or
  // open in the system browser (if in reader mode).
  // Note: when InlineBrowser is rendered, its own onNewWindow effect also
  // runs and takes over; this is the fallback for when it's NOT mounted.
  useEffect(()=>{
    if (!api.isElectron) return;
    if (inlineBrow) return; // InlineBrowser component handles it while mounted
    return api.webview.onNewWindow((newUrl)=>{
      if (!newUrl || !/^https?:\/\//i.test(newUrl)) return;
      // Open in inline browser if feed prefers it, otherwise system browser
      if (feed?.inlineBrowser) {
        setBrowStack(s=>[...s, browUrl||article?.link]);
        setBrowUrl(newUrl);
        setInlineBrow(true);
      } else {
        api.openExternal(newUrl);
      }
    });
  },[inlineBrow, feed?.inlineBrowser, article?.link, browUrl]);

  // Intercept link clicks in reader content.
  // Routing logic:
  //   - feed.inlineBrowser ON: all links open in the inline browser
  //   - feed.inlineBrowser OFF: links open in system browser;
  //     Cmd/Ctrl or middle-click overrides to inline browser instead
  useEffect(()=>{
    const el=contentRef.current;
    if (!el) return;
    const handler=(e)=>{
      const a=e.target.closest('a');
      if (!a||!a.href) return;
      if (a.href.startsWith(window.location.origin)) return;
      e.preventDefault();
      const forceInline = e.metaKey || e.ctrlKey || e.button===1;
      const useInline = feed?.inlineBrowser || forceInline;
      if (useInline) {
        setBrowStack(s=>[...s,browUrl||article?.link]);
        setBrowUrl(a.href);
        setInlineBrow(true);
      } else {
        api.openExternal(a.href);
      }
    };
    el.addEventListener('click',handler);
    el.addEventListener('auxclick',handler);
    return ()=>{ el.removeEventListener('click',handler); el.removeEventListener('auxclick',handler); };
  },[article?.link, browUrl, feed?.inlineBrowser]);

  // Convert raw embedded YouTube iframes (common in non-YouTube feeds, e.g.
  // a Verge article embedding a video) into click-to-play thumbnails.
  // Auto-loaded youtube.com/embed iframes are a common source of blank
  // boxes / ERR_NAME_NOT_RESOLVED-style failures depending on network setup,
  // and loading N video players per article is wasteful regardless.
  useEffect(()=>{
    const el = contentRef.current;
    if (!el || !content) return;

    const iframes = [...el.querySelectorAll('iframe')];
    for (const iframe of iframes) {
      const src = iframe.getAttribute('src') || iframe.getAttribute('data-src') || '';
      const m = src.match(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
      if (!m) continue;
      const videoId = m[1];

      const wrapper = document.createElement('div');
      wrapper.className = 'flux-yt-embed';
      wrapper.style.cssText = 'position:relative;width:100%;padding-top:56.25%;border-radius:10px;overflow:hidden;background:#000;cursor:pointer;margin:1em 0;';
      wrapper.innerHTML = `
        <img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" />
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25);">
          <div style="width:60px;height:60px;border-radius:50%;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;">▶</div>
        </div>`;
      wrapper.addEventListener('click', () => {
        const realIframe = document.createElement('iframe');
        realIframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
        realIframe.referrerPolicy = 'strict-origin-when-cross-origin';
        realIframe.allow = 'autoplay; fullscreen; encrypted-media';
        realIframe.allowFullscreen = true;
        realIframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;';
        wrapper.innerHTML = '';
        wrapper.appendChild(realIframe);
      }, { once: true });

      // Preserve the original element's position via its parent
      const parent = iframe.parentElement;
      if (parent && parent.tagName === 'DIV' && parent.children.length === 1) {
        parent.replaceWith(wrapper);
      } else {
        iframe.replaceWith(wrapper);
      }
    }
  },[content]);

  // Two-finger horizontal scroll on trackpad triggers navigation (desktop).
  // Touch swipe is intentionally NOT used for article navigation — it's
  // too easy to trigger accidentally while scrolling, and mobile has
  // dedicated prev/next buttons in the toolbar instead.
  //
  // A single physical swipe fires many 'wheel' events in quick succession
  // with small per-event deltas, but on macOS that's not the whole story:
  // after the user's fingers actually lift off the trackpad, the OS keeps
  // firing additional wheel events with steadily decaying deltaX —
  // "momentum"/inertial scrolling — for a noticeable extra stretch of
  // time. There's often a small natural gap between the end of the active
  // swipe and the start of the momentum tail (the finger-lift itself takes
  // a moment to register), and a short quiet-timer can expire in exactly
  // that gap — unlocking navigation right as the momentum events start
  // arriving, letting them accumulate past the threshold and fire a
  // second, unwanted navigate() for what the user experienced as one
  // continuous swipe. That's the "moves two articles" symptom.
  //
  // Fix: detect momentum by its actual signature (a run of same-or-smaller
  // deltaX magnitude arriving in quick succession — momentum decays
  // monotonically, an active swipe doesn't) and ignore wheel events once
  // momentum is detected, on top of the existing single-nav-per-gesture
  // lock. The lock itself also gets a longer, non-resettable-by-momentum
  // cooldown so a fresh deliberate swipe right after a momentum tail isn't
  // accidentally eaten.
  const gestureActiveRef  = useRef(false);  // true once we've committed to a nav this gesture
  const gestureAccumRef   = useRef(0);      // accumulated deltaX since gesture start
  const gestureEndRef     = useRef(null);   // timer that detects "events stopped" = gesture over
  const lastDeltaMagRef   = useRef(0);      // |deltaX| of the previous event, for momentum detection
  const lastEventTimeRef  = useRef(0);      // performance.now() of the previous event
  const momentumCountRef  = useRef(0);      // consecutive non-increasing-magnitude events

  const onWheel = useCallback((e) => {
    if (browStack.length) return;
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5;
    if (!horizontal) return;
    e.preventDefault();

    const now = performance.now();
    const elapsed = now - lastEventTimeRef.current;
    const absDelta = Math.abs(e.deltaX);

    // Momentum signature: events arriving in quick succession (<80ms apart)
    // with magnitude that isn't increasing — a real, actively-driven swipe
    // tends to ramp up then taper sharply at release, while momentum decays
    // smoothly and consistently over many events. A long pause (>250ms)
    // means fingers were lifted and this is a genuinely new gesture, so
    // momentum tracking resets.
    if (elapsed < 80 && absDelta > 0) {
      if (absDelta <= lastDeltaMagRef.current || absDelta < 4) momentumCountRef.current++;
      else momentumCountRef.current = 0;
    } else if (elapsed >= 250) {
      momentumCountRef.current = 0;
    }
    lastDeltaMagRef.current = absDelta;
    lastEventTimeRef.current = now;

    // Once we've already navigated this gesture AND we're seeing the
    // momentum signature, ignore outright — don't even let it keep the
    // lock timer alive, since this is exactly the inertial tail that
    // shouldn't trigger a second navigation.
    const isMomentum = momentumCountRef.current >= 3;
    if (gestureActiveRef.current && isMomentum) return;

    // Any non-momentum wheel activity resets the "gesture over" timer —
    // the gesture is still ongoing as long as real (non-inertial) events
    // keep arriving. Using a longer window than before (280ms) so a
    // natural micro-pause between active-swipe and momentum-tail doesn't
    // prematurely unlock right as momentum starts.
    if (!isMomentum) {
      clearTimeout(gestureEndRef.current);
      gestureEndRef.current = setTimeout(() => {
        gestureActiveRef.current = false;
        gestureAccumRef.current = 0;
        momentumCountRef.current = 0;
      }, 280);
    }

    if (gestureActiveRef.current) return; // already navigated this gesture

    gestureAccumRef.current += e.deltaX;
    if (Math.abs(gestureAccumRef.current) > 60) {
      gestureActiveRef.current = true; // lock out further navigation until gesture ends
      navigate(gestureAccumRef.current > 0 ? 1 : -1);
    }
  },[browStack.length, navigate]);

  // React's synthetic onWheel and modern browsers both register wheel
  // listeners as passive by default for scroll-performance reasons.
  // Passive listeners cannot call preventDefault() — the call is silently
  // ignored and the browser logs "Unable to preventDefault inside passive
  // event listener". That means our scroll-prevention was never actually
  // working: the browser's own inertia-scroll-to-navigate ran in parallel
  // with ours, producing the "moves two articles" symptom. Fix: attach
  // manually with { passive: false } so preventDefault() actually works.
  useEffect(()=>{
    const el = outerDivRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  },[onWheel]);

  const handleSummarize = useCallback(async ()=>{
    if (!article) return;
    setArticleSummary('loading');
    const items = [{
      title: article.title,
      summary: content?.excerpt || article.summary || '',
      source: feed?.name,
    }];
    const result = await runWithOllama(() =>
      api.ollama.summarize({ items, ollamaUrl: settings?.ollamaUrl||undefined })
    );
    if (result === null) {
      // User cancelled the Ollama start prompt
      setArticleSummary(null);
    } else {
      setArticleSummary(result?.summary || 'No summary generated.');
    }
  },[article, content, feed, settings, runWithOllama]);

  const handleCommitRule = useCallback(({selector, mode})=>{
    if (!feed) return;
    const updated = {
      feedId: feed.id,
      cssSelectors: [...(feed.cssSelectors||[]), ...(mode==='block'||mode==='hide'?[selector]:[])],
      htmlPatterns: feed.htmlPatterns||[],
    };
    onSaveRule(updated);
    setPickMode(false);
    setRuleWarning(null);
    // Re-fetch content with new rules
    if (article&&!article.isYoutube) {
      setContent(null); setLoading(true);
      api.articles.fetch({url:article.link,feedId:article.feedId}).then(r=>{
        setContent(r); setLoading(false);
        // Sanity check: did the rule actually remove anything? If the
        // selector still matches the freshly-fetched content, the rule
        // is a no-op (e.g. it was built from a class Readability stripped,
        // or the selector is too specific to survive re-extraction).
        try {
          const probe = new DOMParser().parseFromString(r.content||'', 'text/html');
          if (probe.querySelector(selector)) {
            setRuleWarning(selector);
          }
        } catch {}
      }).catch(e=>{setError(e.message);setLoading(false);});
    }
  },[feed,article,onSaveRule]);

  if (!article) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10, color:T.textSubtle }}>
      <div style={{ fontSize:40 }}>◈</div>
      <div style={{ fontSize:14 }}>Pick something to read</div>
      <div style={{ fontSize:12, color:T.textSubtle, opacity:0.6 }}>↑↓ scroll · ←→ or j/k navigate</div>
    </div>
  );

  if (article.isGroup) {
    return <GroupView group={article} feeds={allFeeds} settings={settings} onOpenMember={onNavigate} />;
  }

  return (
    <div ref={outerDivRef} style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', position:'relative' }}>
      {ollamaPromptJsx}
      {/* Toolbar — condensed on mobile (prev/next/star/external/more), full set on desktop */}
      {isMobile ? (
        <div style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:90, padding:'6px 16px', paddingBottom:'calc(6px + env(safe-area-inset-bottom))', borderTop:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:4, background:T.surface }}>
          <IconBtn icon="⋯" title="More" onClick={(e)=>{
            const r = e.currentTarget.getBoundingClientRect();
            const menuW = 200;
            const x = Math.min(Math.max(8, r.left), window.innerWidth - menuW - 8);
            setMobileMoreMenu({ x, y: r.top });
          }} size={44} />
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:2, minWidth:0 }}>
            {prevArticle && (
              <button onClick={()=>navigate(-1)} title={prevArticle.title}
                style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:6, background:'transparent', border:'none', color:T.textMuted, padding:'8px 6px', cursor:'pointer', borderRadius:8 }}>
                <span style={{ fontSize:22, flexShrink:0, color:T.text }}>←</span>
                <span style={{ fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textAlign:'left' }}>{prevArticle.title}</span>
              </button>
            )}
            {nextArticle && (
              <button onClick={()=>navigate(1)} title={nextArticle.title}
                style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6, background:'transparent', border:'none', color:T.textMuted, padding:'8px 6px', cursor:'pointer', borderRadius:8 }}>
                <span style={{ fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textAlign:'right' }}>{nextArticle.title}</span>
                <span style={{ fontSize:22, flexShrink:0, color:T.text }}>→</span>
              </button>
            )}
          </div>
          <IconBtn icon="⤴" title="Share" onClick={handleShare} size={44} />
          {toast && (
            <div style={{ position:'absolute', bottom:'calc(100% + 8px)', left:'50%', transform:'translateX(-50%)', background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:8, padding:'6px 12px', fontSize:12, color:T.text, whiteSpace:'nowrap', boxShadow:'0 4px 12px rgba(0,0,0,0.3)' }}>{toast}</div>
          )}
        </div>
      ) : (
      <div style={{ padding:'10px 20px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:6, flexShrink:0, background:T.surface }}>
        <IconBtn icon="←" title="Previous (k/←)" onClick={()=>navigate(-1)} size={28} />
        <IconBtn icon="→" title="Next (j/→)"     onClick={()=>navigate(1)}  size={28} />
        {browStack.length>0&&<><Divider vertical margin={4}/><Btn small variant="outline" icon="↩" onClick={()=>{ const prev=browStack[browStack.length-1]; setBrowStack(s=>s.slice(0,-1)); setBrowUrl(prev||null); if (!prev) setInlineBrow(false); }}>Back</Btn></>}
        <Divider vertical margin={4} />
        <IconBtn icon={article.isStarred?'★':'☆'} title="Star" active={article.isStarred} onClick={()=>onToggleStar(article.id,article.feedId,!article.isStarred)} size={28} />
        <IconBtn icon="↗" title="Open in default browser" onClick={()=>api.openExternal(article.link)} size={28} />
        <IconBtn icon="◫" title="Inline browser (remembered per feed)"  active={inlineBrow&&!browStack.length}
          onClick={()=>{
            const next = !inlineBrow;
            setInlineBrow(next);
            if (next) { setBrowUrl(article.link); setBrowStack([]); }
            else if (!content) { loadArticleContent(article); } // was never fetched while inline was active
            if (feed) onSaveRule({ feedId: feed.id, cssSelectors: feed.cssSelectors||[], htmlPatterns: feed.htmlPatterns||[], inlineBrowser: next, hideShorts: feed.hideShorts||false });
          }} size={28} />
        <IconBtn icon="⊹" title={!content?'Not available — this article has no extracted content to pick from':pickMode?'Exit picker (Esc)':'Pick elements to block'} active={pickMode} disabled={!content}
          onClick={()=>setPickMode(p=>!p)} size={28} />
        <IconBtn icon="⚙" title="Feed blocking rules" onClick={()=>onOpenRules(feed)} size={28} />
        {settings?.aiClusteringEnabled && !article.isYoutube && (
          <>
            <Divider vertical margin={4} />
            <IconBtn icon="◆" title={articleSummary?'Hide AI summary':'Summarize this article with AI'} active={!!articleSummary} onClick={articleSummary?()=>setArticleSummary(null):handleSummarize} size={28} />
          </>
        )}
        <div style={{ flex:1 }} />
        {content?.bypassSource&&content.bypassSource!=='direct'&&<Badge tone={content.bypassSource==='12ft.io'?'warning':'ai'}>via {content.bypassSource}</Badge>}
        {pickMode&&<Badge tone="danger">● picking</Badge>}
        <div style={{ display:'flex', alignItems:'center', gap:2 }}>
          <IconBtn icon="a" title="Smaller" onClick={()=>setFontSize(s=>Math.max(13,s-1))} size={26} />
          <span style={{ fontSize:11, color:T.textSubtle, minWidth:22, textAlign:'center' }}>{fontSize}</span>
          <IconBtn icon="A" title="Larger"  onClick={()=>setFontSize(s=>Math.min(26,s+1))} size={26} />
        </div>
        <Divider vertical margin={4} />
        <IconBtn icon="⊡" title="Narrower" onClick={()=>setLineWidth(w=>Math.max(480,w-40))} size={26} />
        <IconBtn icon="⊞" title="Wider"    onClick={()=>setLineWidth(w=>Math.min(960,w+40))} size={26} />
      </div>
      )}
      {isMobile && mobileMoreMenu && (
        <ContextMenu x={mobileMoreMenu.x} y={mobileMoreMenu.y} onClose={()=>setMobileMoreMenu(null)} items={[
          { label: article.isStarred?'Unstar':'Star', icon: article.isStarred?'★':'☆', onClick:()=>onToggleStar(article.id,article.feedId,!article.isStarred) },
          { label:'Open in default browser', icon:'↗', onClick:()=>api.openExternal(article.link) },
          { divider:true },
          { label:'Inline browser', icon:'◫', onClick:()=>{
              const next = !inlineBrow;
              setInlineBrow(next);
              if (next) { setBrowUrl(article.link); setBrowStack([]); }
              else if (!content) { loadArticleContent(article); }
              if (feed) onSaveRule({ feedId: feed.id, cssSelectors: feed.cssSelectors||[], htmlPatterns: feed.htmlPatterns||[], inlineBrowser: next, hideShorts: feed.hideShorts||false });
            } },
          { label: pickMode?'Exit element picker':'Pick elements to block', icon:'⊹', disabled:!content, onClick:()=>setPickMode(p=>!p) },
          { label:'Feed blocking rules', icon:'⚙', onClick:()=>onOpenRules(feed) },
          ...(settings?.aiClusteringEnabled && !article.isYoutube ? [{ label: articleSummary?'Hide AI summary':'Summarize with AI', icon:'◆', onClick: articleSummary?()=>setArticleSummary(null):handleSummarize }] : []),
          { divider:true },
          { label:'Smaller text', icon:'a', onClick:()=>setFontSize(s=>Math.max(13,s-1)) },
          { label:'Larger text',  icon:'A', onClick:()=>setFontSize(s=>Math.min(26,s+1)) },
        ]} />
      )}

      {/* Inline browser overlay — sits above content, below toolbar (desktop
          only — mobile's toolbar lives at the bottom now, so nothing to clear) */}
      {inlineBrow&&browUrl&&(
        <div key={`${article.id}:${browUrl}`} style={{ position:'absolute', inset:0, zIndex:30, top: isMobile ? 0 : 49 }}>
          <InlineBrowser
            key={article.id}
            url={browUrl}
            isMobile={isMobile}
            onClose={()=>{ setInlineBrow(false); setBrowUrl(null); setBrowStack([]); }}
            onNavigateArticle={navigate}
            onStepBack={()=>{
              if (!browStack.length) return;
              const prev=browStack[browStack.length-1];
              setBrowStack(s=>s.slice(0,-1));
              setBrowUrl(prev||null);
              if (!prev) setInlineBrow(false);
            }}
          />
        </div>
      )}

      {/* Reader scroll area */}
      <div ref={readerScrollRef} style={{ flex:1, overflowY:'auto', overflowX:'hidden', padding:'32px 24px', paddingBottom: isMobile ? 'calc(32px + 52px + env(safe-area-inset-bottom))' : 32, position:'relative' }}>
        <div key={article.id} style={{ maxWidth:lineWidth, margin:'0 auto' }} className={navDirRef.current===1?'slide-in-next':navDirRef.current===-1?'slide-in-prev':'slide-in'}>
          {/* Meta */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, flexWrap:'wrap' }}>
            <span style={{ fontSize:11, fontWeight:700, color:article.isYoutube?T.youtube:T.accent, textTransform:'uppercase', letterSpacing:'0.05em' }}>{feed?.name||domainOf(article.link)}</span>
            {article.isYoutube&&<Badge tone="yt">▶ Video</Badge>}
            <span style={{ color:T.textSubtle, fontSize:12 }}>·</span>
            <span style={{ color:T.textMuted, fontSize:12 }}>{timeAgo(article.date)}</span>
            {content?.byline&&<><span style={{ color:T.textSubtle, fontSize:12 }}>·</span><span style={{ color:T.textMuted, fontSize:12, fontStyle:'italic' }}>{content.byline}</span></>}
          </div>
          <h1 style={{ fontSize:Math.round(fontSize*1.65), fontWeight:700, lineHeight:1.2, letterSpacing:'-0.025em', marginBottom:28, color:T.text, fontFamily:"'Inter',sans-serif" }}>{article.title}</h1>

          {article.isYoutube&&article.videoId&&<YTEmbed videoId={article.videoId} sponsorBlockEnabled={settings?.sponsorBlockEnabled !== false} deArrowEnabled={!!settings?.deArrowEnabled} />}
          {loading&&<div style={{ display:'flex', alignItems:'center', gap:10, color:T.textMuted, padding:'24px 0' }}><Spinner /><span style={{ fontSize:13 }}>Fetching article…</span></div>}
          {error&&<div style={{ background:'rgba(242,92,92,.08)', border:'1px solid rgba(242,92,92,.2)', borderRadius:8, padding:'12px 16px', marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:600, color:T.danger, marginBottom:4 }}>Fetch failed</div>
            <div style={{ fontSize:12, color:T.textMuted }}>{error}</div>
            <div style={{ fontSize:14, color:T.text, marginTop:8, lineHeight:1.6 }}>{article.summary}</div>
          </div>}
          {articleSummary&&<div style={{ background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:10, padding:'14px 16px', marginBottom:20, position:'relative' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
              <span style={{ fontSize:11, fontWeight:700, color:T.textSubtle, letterSpacing:'0.06em', textTransform:'uppercase' }}>AI summary</span>
              <div style={{ flex:1 }} />
              <IconBtn icon="✕" title="Dismiss" onClick={()=>setArticleSummary(null)} size={22} />
            </div>
            {articleSummary==='loading'&&<div style={{ display:'flex', alignItems:'center', gap:8, color:T.textMuted, fontSize:13 }}><Spinner size={13}/>Summarizing…</div>}
            {articleSummary==='error'&&<div style={{ fontSize:13, color:T.textSubtle }}>Couldn't generate a summary — Ollama may not be running or reachable.</div>}
            {articleSummary&&articleSummary!=='loading'&&articleSummary!=='error'&&<div style={{ fontSize:14, color:T.text, lineHeight:1.6 }}>{articleSummary}</div>}
          </div>}
          {ruleWarning&&<div style={{ background:'rgba(242,176,92,.08)', border:`1px solid ${T.warning}33`, borderRadius:8, padding:'10px 14px', marginBottom:16, display:'flex', alignItems:'flex-start', gap:10 }}>
            <span style={{ fontSize:14 }}>⚠</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:2 }}>Rule saved, but didn't remove anything</div>
              <div style={{ fontSize:12, color:T.textMuted, lineHeight:1.5 }}>The selector <code style={{ background:T.surfaceActive, padding:'1px 5px', borderRadius:4 }}>{ruleWarning}</code> still matches an element after re-fetching. The page structure may not match what was picked, or the element may be added dynamically. You can remove the rule via the ⚙ rules editor.</div>
            </div>
            <IconBtn icon="✕" title="Dismiss" onClick={()=>setRuleWarning(null)} size={22} />
          </div>}
          {content&&!loading&&<div ref={contentRef} className="reader-body" style={{ fontSize }} dangerouslySetInnerHTML={{ __html:content.content }} />}
          {article.isYoutube&&<div style={{ marginTop:16, fontSize, lineHeight:1.75, color:T.textMuted, fontFamily:'Lora,serif' }}>{article.summary}</div>}

          <div style={{ marginTop:48, paddingTop:16, borderTop:`1px solid ${T.borderSubtle}`, display:'flex', justifyContent:'space-between' }}>
            <Btn small variant="ghost" icon="←" onClick={()=>navigate(-1)}>{allArticles[currentIdx-1]?.title?.slice(0,30)||'Previous'}</Btn>
            <Btn small variant="ghost" onClick={()=>navigate(1)}>{allArticles[currentIdx+1]?.title?.slice(0,30)||'Next'} →</Btn>
          </div>
        </div>

        {/* Element picker overlay — sits inside scroll area so coords work */}
        {pickMode&&content&&<ElementPicker containerRef={contentRef} onCommitRule={handleCommitRule} onExit={()=>setPickMode(false)} />}
      </div>
    </div>
  );
}

function YTEmbed({ videoId, sponsorBlockEnabled, deArrowEnabled }) {
  const [playing,setPlaying]   = useState(false);
  const [segments,setSegments] = useState([]);
  const [apiFailed,setApiFailed] = useState(false);
  const containerRef  = useRef(null);
  const placeholderRef = useRef(null);
  const playerRef     = useRef(null);
  const segmentsRef   = useRef([]);
  const skippedRef    = useRef(new Set());
  const pollRef       = useRef(null);
  const dearrow = useDeArrow(videoId, !!deArrowEnabled);

  useEffect(()=>{ segmentsRef.current = segments; },[segments]);

  // Fetch SponsorBlock segments once per video
  useEffect(()=>{
    if (!sponsorBlockEnabled) { setSegments([]); return; }
    let cancelled=false;
    fetchSponsorSegments(videoId).then(s=>{ if(!cancelled) setSegments(s); });
    return ()=>{ cancelled=true; };
  },[videoId, sponsorBlockEnabled]);

  // Create the player once playback starts
  useEffect(()=>{
    // In Electron, window.location.origin is 'app://flux', which YouTube's
    // IFrame API rejects with error 153 regardless of the `origin`
    // playerVar (see JSX below) — so never even attempt YT.Player here.
    // Without this guard, loadYouTubeAPI() still loads YouTube's widget
    // script globally on every play, even though the JSX correctly
    // renders the safe nocookie <iframe> instead of `containerRef`.
    if (!playing || apiFailed || api.isElectron) return;
    let destroyed=false;
    let ready=false;

    // Fallback: if the IFrame API never calls onReady within 4s, drop to
    // a plain <iframe> embed. That always works.
    const fallbackTimer = setTimeout(()=>{
      if (!ready && !destroyed) setApiFailed(true);
    }, 4000);

    loadYouTubeAPI().then(YT=>{
      if (destroyed || !containerRef.current) return;
      const start = getYtProgress(videoId);
      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 1, rel: 0, enablejsapi: 1,
          // Must be 'https://www.youtube.com' — passing window.location.origin
          // (which is 'app://flux' in the packaged Electron app) causes
          // YouTube to reject the embed with error 153 "video player
          // configuration error". YouTube validates this against its allowlist
          // of known HTTP(S) origins; app:// is not on that list.
          origin: 'https://www.youtube.com',
          ...(start > 5 ? { start } : {}),
        },
        events: {
          onReady: () => {
            ready = true;
            clearTimeout(fallbackTimer);
            pollRef.current = setInterval(()=>{
              const p = playerRef.current;
              if (!p?.getCurrentTime) return;
              try {
                const t = p.getCurrentTime();
                setYtProgress(videoId, t);
                for (let i=0; i<segmentsRef.current.length; i++) {
                  const seg = segmentsRef.current[i];
                  if (t >= seg.start && t < seg.end - 0.5) {
                    if (!skippedRef.current.has(i)) {
                      skippedRef.current.add(i);
                      p.seekTo(seg.end, true);
                    }
                    break;
                  } else if (t < seg.start) {
                    skippedRef.current.delete(i);
                  }
                }
              } catch {}
            }, 1000);
          },
        },
      });
    }).catch(()=>{ if (!destroyed) setApiFailed(true); });

    return ()=>{
      destroyed=true;
      clearTimeout(fallbackTimer);
      clearInterval(pollRef.current);
      try { playerRef.current?.destroy(); } catch {}
      playerRef.current=null;
    };
  },[playing, videoId, apiFailed]); // api.isElectron is a module-level constant, not a dependency


  const thumbSrc = (deArrowEnabled && dearrow?.thumb)
    ? dearrow.thumb
    : `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  return (
    <div style={{ marginBottom:24 }}>
      {deArrowEnabled && dearrow?.title && !playing && (
        <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:6, lineHeight:1.4 }}>
          {dearrow.title}
          <Badge tone="muted" style={{ marginLeft:6 }}>DeArrow</Badge>
        </div>
      )}
      <div ref={placeholderRef} style={{ position:'relative', width:'100%', paddingTop:'56.25%', borderRadius:10, overflow:'hidden', background:'#000', cursor: playing?'default':'pointer' }} onClick={()=>!playing&&setPlaying(true)}>
        {playing
          ? (apiFailed || api.isElectron
              // In Electron: always use youtube-nocookie.com iframe directly.
              // The YouTube IFrame JS API communicates via postMessage targeting
              // 'https://www.youtube.com' but our window origin is 'app://flux',
              // causing error 153 regardless of the `origin` playerVar. The
              // nocookie iframe is self-contained and has no origin requirement.
              // SponsorBlock/seek API unavailable in this path but that's
              // preferable to a broken player.
              ? <iframe src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', border:'none' }} allow="autoplay; fullscreen; encrypted-media" allowFullScreen title="YouTube video" referrerPolicy="strict-origin-when-cross-origin" />
              : <div ref={containerRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%' }} />)
          : <>
              <img src={thumbSrc} alt="thumbnail" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} onError={e=>{e.target.src=`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;}} />
              <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.25)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <div style={{ width:60, height:60, borderRadius:'50%', background:'rgba(0,0,0,.8)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:22 }}>▶</div>
              </div>
            </>
        }
      </div>
      {(sponsorBlockEnabled && !apiFailed && segments.length>0) && (
        <div style={{ display:'flex', gap:8, marginTop:8, alignItems:'center', flexWrap:'wrap' }}>
          <Badge tone="success">SponsorBlock: {segments.length} segment{segments.length>1?'s':''} auto-skipped</Badge>
          {apiFailed && <span style={{ fontSize:11, color:T.textSubtle }}>Playing in compatibility mode — SponsorBlock unavailable for this video.</span>}
        </div>
      )}
    </div>
  );
}

// ─── Element picker ───────────────────────────────────────────────────────────
function buildSelector(el, container) {
  if (!el||el===container||!container?.contains(el)) return null;

  const usableId = (node) => (node.id && !/^\d/.test(node.id) && !/^[a-f0-9]{6,}$/i.test(node.id))
    ? `#${CSS.escape(node.id)}` : null;
  const usableClasses = (node) => [...node.classList].filter(c=>
    c.length>1 && !/^[a-f0-9]{5,}$/.test(c) && !/^(css|sc|emotion|styled)-/.test(c) && !/^\d/.test(c));

  // The picked element itself is identifiable — no positional info needed.
  const ownId = usableId(el);
  if (ownId) return ownId;
  const ownCls = usableClasses(el);
  if (ownCls.length) return `${el.tagName.toLowerCase()}.${ownCls.slice(0,2).map(c=>CSS.escape(c)).join('.')}`;

  // Otherwise walk up looking for an identifiable ancestor (id or class),
  // building a plain tag-name path down to the element. This deliberately
  // avoids :nth-of-type — sibling positions/counts shift between different
  // articles on the same site (one more ad here, one fewer image there),
  // which made rules built from absolute positions match on the article
  // they were created on but not on others from the same feed.
  const tagPath = [el.tagName.toLowerCase()];
  let cur = el.parentElement, depth = 0;
  while (cur && cur !== container && depth < 4) {
    const id = usableId(cur);
    if (id) return `${id} ${tagPath.join(' > ')}`;
    const cls = usableClasses(cur);
    if (cls.length) return `${cur.tagName.toLowerCase()}.${cls.slice(0,2).map(c=>CSS.escape(c)).join('.')} ${tagPath.join(' > ')}`;
    tagPath.unshift(cur.tagName.toLowerCase());
    cur = cur.parentElement;
    depth++;
  }

  // Nothing identifiable nearby — fall back to the accumulated plain tag
  // path. Broader than ideal, but stable: it matches the same repeating
  // template structure across articles instead of one specific position.
  return tagPath.join(' > ');
}

function ElementPicker({ containerRef, onCommitRule, onExit }) {
  const [hovered,setHovered]=useState(null);
  const [pinned,setPinned]=useState(null);
  const [editSel,setEditSel]=useState('');
  const [mode,setMode]=useState('block');

  // Attach listeners directly to the content container — no overlay div,
  // since an overlay on top would itself be the elementFromPoint target.
  useEffect(()=>{
    const container = containerRef.current;
    if (!container) return;

    container.classList.add('flux-picker-active');

    const handleMouseMove = (e) => {
      if (pinned) return;
      const el = e.target;
      if (!el || el === container || !container.contains(el)) { setHovered(null); return; }
      setHovered({ el, rect: el.getBoundingClientRect(), selector: buildSelector(el, container) });
    };

    const handleClick = (e) => {
      const el = e.target;
      if (pinned || !el || el === container || !container.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      const selector = buildSelector(el, container);
      setPinned({ el, rect: el.getBoundingClientRect(), selector });
      setEditSel(selector);
      setMode('block');
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('click', handleClick, true);
    return () => {
      container.classList.remove('flux-picker-active');
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('click', handleClick, true);
    };
  },[pinned,containerRef]);

  useEffect(()=>{
    const h=(e)=>{ if(e.key==='Escape'){if(pinned){setPinned(null);setHovered(null);}else onExit();} };
    window.addEventListener('keydown',h,true);
    return ()=>window.removeEventListener('keydown',h,true);
  },[pinned,onExit]);

  const commit=useCallback(()=>{ if(editSel.trim()){onCommitRule({selector:editSel.trim(),mode});setPinned(null);setHovered(null);} },[editSel,mode,onCommitRule]);

  const activeRect=pinned?.rect??hovered?.rect??null;
  const activeSelector=pinned?.selector??hovered?.selector??null;

  const popoverPos=useMemo(()=>{
    if (!pinned?.rect) return {top:100,left:100};
    const r=pinned.rect; const pw=300,ph=190,vw=window.innerWidth,vh=window.innerHeight;
    let top=r.bottom+8, left=r.left;
    if(top+ph>vh-16) top=r.top-ph-8;
    if(left+pw>vw-16) left=vw-pw-16;
    if(left<8) left=8; if(top<8) top=8;
    return {top,left};
  },[pinned?.rect]);

  return <>
    {activeRect&&<PickerHighlight rect={activeRect} pinned={!!pinned} selector={activeSelector} />}
    {pinned&&<PickerPopover pos={popoverPos} selector={editSel} onSelectorChange={setEditSel} mode={mode} onModeChange={setMode} onCommit={commit} onCancel={()=>{setPinned(null);setHovered(null);}} />}
  </>;
}

function PickerHighlight({ rect, pinned, selector }) {
  const color=pinned?T.danger:T.accent;
  return <div style={{ position:'fixed', top:rect.top-2, left:rect.left-2, width:rect.width+4, height:rect.height+4, border:`2px solid ${color}`, borderRadius:3, background:pinned?`${T.danger}18`:`${T.accent}12`, pointerEvents:'none', zIndex:50, transition:pinned?'none':'all 0.06s ease', boxShadow:`0 0 0 1px ${color}44` }}>
    {selector&&<div style={{ position:'absolute', bottom:'100%', left:0, marginBottom:4, background:color, color:'#fff', fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:4, whiteSpace:'nowrap', maxWidth:320, overflow:'hidden', textOverflow:'ellipsis', fontFamily:"'JetBrains Mono',monospace", pointerEvents:'none', boxShadow:'0 2px 8px rgba(0,0,0,.4)' }}>{selector}</div>}
  </div>;
}

function PickerPopover({ pos, selector, onSelectorChange, mode, onModeChange, onCommit, onCancel }) {
  const MODES=[{id:'block',label:'Block',icon:'⊘',desc:'Remove before Readability — never fetched'},{id:'hide',label:'Hide',icon:'◌',desc:'CSS display:none after render'}];
  return <div onClick={e=>e.stopPropagation()} style={{ position:'fixed', top:pos.top, left:pos.left, width:300, background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:'0 12px 40px rgba(0,0,0,.55)', zIndex:60, overflow:'hidden', animation:'fadeIn 0.12s ease' }}>
    <div style={{ padding:'10px 12px 8px', borderBottom:`1px solid ${T.borderSubtle}`, display:'flex', alignItems:'center', gap:6 }}>
      <span style={{ fontSize:11, fontWeight:700, color:T.accent, letterSpacing:'0.04em', textTransform:'uppercase' }}>Element selected</span>
      <div style={{ flex:1 }} /><IconBtn icon="✕" onClick={onCancel} size={22} />
    </div>
    <div style={{ padding:'10px 12px 8px' }}>
      <div style={{ fontSize:11, color:T.textMuted, marginBottom:5 }}>CSS selector</div>
      <input value={selector} onChange={e=>onSelectorChange(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')onCommit();if(e.key==='Escape')onCancel();}} spellCheck={false} style={{ width:'100%', fontFamily:"'JetBrains Mono',monospace", fontSize:11 }} />
    </div>
    <div style={{ padding:'0 12px 10px', display:'flex', gap:6 }}>
      {MODES.map(m=><button key={m.id} onClick={()=>onModeChange(m.id)} title={m.desc} style={{ flex:1, padding:'6px 8px', background:mode===m.id?(m.id==='block'?T.danger+'22':T.accentDim):T.surfaceActive, border:`1px solid ${mode===m.id?(m.id==='block'?T.danger:T.accent):T.border}`, borderRadius:6, cursor:'pointer', color:mode===m.id?(m.id==='block'?T.danger:T.accent):T.textMuted, fontSize:12, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', gap:5, transition:'all 0.1s' }}><span>{m.icon}</span>{m.label}</button>)}
    </div>
    <div style={{ padding:'0 12px 10px' }}><div style={{ fontSize:11, color:T.textSubtle, lineHeight:1.5 }}>{MODES.find(m=>m.id===mode)?.desc}</div></div>
    <div style={{ padding:'8px 12px', borderTop:`1px solid ${T.borderSubtle}`, display:'flex', gap:6, justifyContent:'flex-end' }}>
      <Btn small variant="outline" onClick={onCancel}>Cancel</Btn>
      <Btn small variant={mode==='block'?'danger':'primary'} onClick={onCommit}>{mode==='block'?'⊘ Block':'◌ Hide'}</Btn>
    </div>
  </div>;
}

// ─── Modals ───────────────────────────────────────────────────────────────────
// ─── Add Feeds to Folder Modal ────────────────────────────────────────────────
// Combines two ways to populate a folder: pick from feeds you're already
// subscribed to elsewhere, or paste a new feed URL directly.
function AddToFolderModal({ folder, feeds, folders, onAssignExisting, onAddNew, onClose }) {
  const [tab, setTab] = useState('existing'); // 'existing' | 'new'

  const candidates = useMemo(()=>
    [...feeds].filter(f=>f.folder!==folder.id).sort((a,b)=>a.name.localeCompare(b.name))
  ,[feeds, folder.id]);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const toggle = (id) => setSelectedIds(prev=>{
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const saveExisting = async () => {
    if (selectedIds.size===0) { onClose(); return; }
    setSaving(true);
    try {
      await Promise.all([...selectedIds].map(id => onAssignExisting(id, folder.id)));
      onClose();
    } finally { setSaving(false); }
  };

  // "New feed" form state — mirrors AddFeedModal's discovery flow (paste
  // anything, resolve to an actual feed URL, confirm, then add) since this
  // is a genuinely separate modal/code path from AddFeedModal, used
  // specifically for the folder context menu's "Add feeds" action.
  const [url,setUrl]=useState(''); const [name,setName]=useState(''); const [inline,setInline]=useState(false); const [loading,setLoading]=useState(false); const [error,setError]=useState(null);
  const [resolved,setResolved]=useState(null);
  const [resolving,setResolving]=useState(false);

  const [multiChoice,setMultiChoice]=useState(null);
  const [checkedUrls,setCheckedUrls]=useState(new Set());

  const findFeed = async () => {
    if (!url.trim()) return;
    setResolving(true); setError(null); setMultiChoice(null);
    try {
      const r = await api.feeds.resolve(url.trim());
      if (r.multiple) {
        setMultiChoice(r.feeds);
        setCheckedUrls(new Set([r.feeds[0].feedUrl]));
      } else if (r.noFeedFound) {
        setError("Couldn't find a feed on that page. Try pasting a direct feed URL, or use OpenRSS (openrss.org) to generate one for this site.");
      } else {
        setResolved(r);
        if (r.name && !name.trim()) setName(r.name);
      }
    } catch(e) {
      setResolved({ feedUrl: url.trim(), name: null, isYoutube: false });
      setError(`Couldn't auto-detect a feed (${e.message}) — will try adding this URL directly.`);
    } finally { setResolving(false); }
  };

  const submitNew = async () => {
    setLoading(true); setError(null);
    try {
      if (multiChoice) {
        const chosen = multiChoice.filter(f => checkedUrls.has(f.feedUrl));
        if (!chosen.length) { setError('Select at least one feed to add.'); setLoading(false); return; }
        for (const f of chosen) {
          await onAddNew({ url:f.feedUrl, name:f.name||undefined, folder:folder.id, inlineBrowser:inline, cssSelectors:[], htmlPatterns:[] });
        }
        onClose();
        return;
      }
      const feedUrl = resolved?.feedUrl || url.trim();
      if (!feedUrl) return;
      await onAddNew({ url:feedUrl, name:name.trim()||undefined, folder:folder.id, inlineBrowser:inline, cssSelectors:[], htmlPatterns:[] });
      onClose();
    } catch(e){ setError(e.message); } finally { setLoading(false); }
  };

  return <Modal title={`Add feeds to ${folder.icon} ${folder.name}`} onClose={onClose}>
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', gap:4, borderBottom:`1px solid ${T.border}`, marginBottom:4 }}>
        {[{id:'existing',label:'Your feeds'},{id:'new',label:'New feed URL'}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ background:'none', border:'none', borderBottom:`2px solid ${tab===t.id?T.accent:'transparent'}`, color:tab===t.id?T.text:T.textMuted, fontWeight:tab===t.id?600:400, fontSize:13, padding:'8px 4px', cursor:'pointer', marginBottom:-1 }}>{t.label}</button>
        ))}
      </div>

      {tab==='existing' ? (
        <>
          <div style={{ maxHeight:320, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
            {candidates.length===0&&<div style={{ fontSize:13, color:T.textSubtle, padding:'12px 0' }}>All your feeds are already in this folder. Switch to "New feed URL" to add another.</div>}
            {candidates.map(f=>{
              const elsewhere = f.folder && folders?.find(fo=>fo.id===f.folder);
              return (
                <label key={f.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 8px', borderRadius:6, cursor:'pointer' }}
                  onMouseEnter={e=>e.currentTarget.style.background=T.surfaceHover}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <input type="checkbox" checked={selectedIds.has(f.id)} onChange={()=>toggle(f.id)} style={{ width:'auto' }} />
                  <span style={{ fontSize:13, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.isYoutube?'▶ ':'◉ '}{f.name}</span>
                  {elsewhere&&<span style={{ fontSize:10, color:T.textSubtle }}>in {elsewhere.icon} {elsewhere.name}</span>}
                </label>
              );
            })}
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
            <Btn variant="outline" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" onClick={saveExisting} disabled={saving}>{saving?<Spinner size={12} color="#fff"/>:null}{saving?'Adding…':selectedIds.size>0?`Add ${selectedIds.size} feed${selectedIds.size>1?'s':''}`:'Done'}</Btn>
          </div>
        </>
      ) : (
        <>
          <div>
            <label style={{ fontSize:12, color:T.textMuted, display:'block', marginBottom:5 }}>Website, YouTube channel, or feed URL *</label>
            <div style={{ display:'flex', gap:8 }}>
              <input autoFocus style={{ flex:1 }} value={url} onChange={e=>{setUrl(e.target.value);setResolved(null);setMultiChoice(null);}} onKeyDown={e=>e.key==='Enter'&&((resolved||multiChoice)?submitNew():findFeed())} placeholder="youtube.com/@channel, example.com, or a feed URL" />
              {!resolved && !multiChoice && <Btn variant="outline" onClick={findFeed} disabled={resolving||!url.trim()}>{resolving?<Spinner size={12}/>:'Find feed'}</Btn>}
            </div>
          </div>
          {multiChoice && (
            <div style={{ background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:8, padding:'10px 14px', fontSize:12, display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ color:T.textMuted }}>This page has {multiChoice.length} feeds — pick which to add:</div>
              {multiChoice.map(f => (
                <label key={f.feedUrl} style={{ display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer' }}>
                  <input type="checkbox" checked={checkedUrls.has(f.feedUrl)} style={{ width:'auto', marginTop:2 }}
                    onChange={e=>setCheckedUrls(prev=>{ const next=new Set(prev); e.target.checked?next.add(f.feedUrl):next.delete(f.feedUrl); return next; })} />
                  <div>
                    <div style={{ color:T.text, fontWeight:600 }}>{f.name || f.feedUrl}</div>
                    <div style={{ color:T.textSubtle, fontFamily:"'JetBrains Mono',monospace", fontSize:10, wordBreak:'break-all' }}>{f.feedUrl}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
          {resolved && !multiChoice && (
            <div style={{ background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:8, padding:'10px 14px', fontSize:12 }}>
              <div style={{ color:T.textMuted, marginBottom:2 }}>{resolved.isYoutube?'Found YouTube channel feed:':'Found feed:'}</div>
              <div style={{ color:T.text, fontFamily:"'JetBrains Mono',monospace", fontSize:11, wordBreak:'break-all' }}>{resolved.feedUrl}</div>
            </div>
          )}
          {!multiChoice && <div><label style={{ fontSize:12, color:T.textMuted, display:'block', marginBottom:5 }}>Display name</label><input style={{ width:'100%' }} value={name} onChange={e=>setName(e.target.value)} placeholder="Auto-detected" /></div>}
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13 }}><input type="checkbox" checked={inline} onChange={e=>setInline(e.target.checked)} style={{ width:'auto', padding:0 }} />Use inline browser (for sites that block reader mode)</label>
          {error&&<div style={{ fontSize:12, color:(resolved||multiChoice)?T.warning:T.danger }}>{error}</div>}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
            <Btn variant="outline" onClick={onClose}>Cancel</Btn>
            {(resolved || multiChoice)
              ? <Btn variant="primary" onClick={submitNew} disabled={loading}>{loading?<Spinner size={12} color="#fff"/>:null}{loading?'Adding…':multiChoice?`Add ${checkedUrls.size||''} feed${checkedUrls.size===1?'':'s'}`:'Add feed'}</Btn>
              : <Btn variant="primary" onClick={findFeed} disabled={resolving||!url.trim()}>{resolving?<Spinner size={12} color="#fff"/>:null}{resolving?'Searching…':'Find feed'}</Btn>}
          </div>
        </>
      )}
    </div>
  </Modal>;
}

function AddFeedModal({ folders, preselectedFolder, onAdd, onClose }) {
  const [url,setUrl]=useState(''); const [name,setName]=useState(''); const [folder,setFolder]=useState(preselectedFolder ?? (folders[0]?.id||'')); const [inline,setInline]=useState(false); const [loading,setLoading]=useState(false); const [error,setError]=useState(null);
  // resolved: null = not yet resolved, {feedUrl,name,isYoutube} = found a
  // feed and showing the confirmation preview before committing.
  const [resolved,setResolved]=useState(null);
  const [resolving,setResolving]=useState(false);
  // When a page exposes more than one feed (main + comments, per-category,
  // etc.), resolve() returns { multiple:true, feeds:[...] } instead of a
  // single result — this holds which of those the user has checked.
  const [multiChoice,setMultiChoice]=useState(null); // array of feed objects, or null when not in multi-mode
  const [checkedUrls,setCheckedUrls]=useState(new Set());

  const findFeed=async()=>{
    if(!url.trim()) return;
    setResolving(true); setError(null); setMultiChoice(null);
    try {
      const r = await api.feeds.resolve(url.trim());
      if (r.multiple) {
        setMultiChoice(r.feeds);
        setCheckedUrls(new Set([r.feeds[0].feedUrl])); // preselect the first as a sensible default
      } else if (r.noFeedFound) {
        setError(`Couldn't find a feed on that page.${r.openRssSuggestion ? ' Try pasting a direct feed URL, or use OpenRSS (openrss.org) to generate one for this site.' : ''}`);
      } else {
        setResolved(r);
        if (r.name && !name.trim()) setName(r.name);
      }
    } catch(e) {
      // Resolution failed — fall back to treating the input as a literal
      // feed URL so power users who already have a direct feed link
      // aren't blocked by a discovery step they didn't need.
      setResolved({ feedUrl: url.trim(), name: null, isYoutube: false });
      setError(`Couldn't auto-detect a feed (${e.message}) — will try adding this URL directly.`);
    } finally { setResolving(false); }
  };

  const submit=async()=>{
    setLoading(true); setError(null);
    try {
      if (multiChoice) {
        const chosen = multiChoice.filter(f => checkedUrls.has(f.feedUrl));
        if (!chosen.length) { setError('Select at least one feed to add.'); setLoading(false); return; }
        for (const f of chosen) {
          await onAdd({ url:f.feedUrl, name:f.name||undefined, folder:folder||null, inlineBrowser:inline, cssSelectors:[], htmlPatterns:[] });
        }
        onClose();
        return;
      }
      const feedUrl = resolved?.feedUrl || url.trim();
      if(!feedUrl) return;
      await onAdd({url:feedUrl,name:name.trim()||undefined,folder:folder||null,inlineBrowser:inline,cssSelectors:[],htmlPatterns:[]}); onClose();
    }
    catch(e){setError(e.message);}
    finally{setLoading(false);}
  };

  const preFolder = folders.find(f=>f.id===preselectedFolder);
  return <Modal title={preFolder?`Add Feed to ${preFolder.icon} ${preFolder.name}`:"Add Feed"} onClose={onClose}>
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div>
        <label style={{ fontSize:12, color:T.textMuted, display:'block', marginBottom:5 }}>Website, YouTube channel, or feed URL *</label>
        <div style={{ display:'flex', gap:8 }}>
          <input autoFocus style={{ flex:1 }} value={url} onChange={e=>{setUrl(e.target.value);setResolved(null);setMultiChoice(null);}} onKeyDown={e=>e.key==='Enter'&&(resolved||multiChoice?submit():findFeed())} placeholder="youtube.com/@channel, example.com, or a feed URL" />
          {!resolved && !multiChoice && <Btn variant="outline" onClick={findFeed} disabled={resolving||!url.trim()}>{resolving?<Spinner size={12}/>:'Find feed'}</Btn>}
        </div>
        <div style={{ fontSize:11, color:T.textSubtle, marginTop:4 }}>Paste a YouTube channel/video link, a website's homepage, or a direct feed URL — we'll figure out the rest.</div>
      </div>
      {multiChoice && (
        <div style={{ background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:8, padding:'10px 14px', fontSize:12, display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ color:T.textMuted }}>This page has {multiChoice.length} feeds — pick which to add:</div>
          {multiChoice.map(f => (
            <label key={f.feedUrl} style={{ display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer' }}>
              <input type="checkbox" checked={checkedUrls.has(f.feedUrl)} style={{ width:'auto', marginTop:2 }}
                onChange={e=>setCheckedUrls(prev=>{ const next=new Set(prev); e.target.checked?next.add(f.feedUrl):next.delete(f.feedUrl); return next; })} />
              <div>
                <div style={{ color:T.text, fontWeight:600 }}>{f.name || f.feedUrl}</div>
                <div style={{ color:T.textSubtle, fontFamily:"'JetBrains Mono',monospace", fontSize:10, wordBreak:'break-all' }}>{f.feedUrl}</div>
              </div>
            </label>
          ))}
        </div>
      )}
      {resolved && !multiChoice && (
        <div style={{ background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:8, padding:'10px 14px', fontSize:12 }}>
          <div style={{ color:T.textMuted, marginBottom:2 }}>{resolved.isYoutube?'Found YouTube channel feed:':'Found feed:'}</div>
          <div style={{ color:T.text, fontFamily:"'JetBrains Mono',monospace", fontSize:11, wordBreak:'break-all' }}>{resolved.feedUrl}</div>
        </div>
      )}
      {!multiChoice && <div><label style={{ fontSize:12, color:T.textMuted, display:'block', marginBottom:5 }}>Display name</label><input style={{ width:'100%' }} value={name} onChange={e=>setName(e.target.value)} placeholder="Auto-detected" /></div>}
      <div><label style={{ fontSize:12, color:T.textMuted, display:'block', marginBottom:5 }}>Folder</label><select value={folder} onChange={e=>setFolder(e.target.value)} style={{ width:'100%' }}><option value="">No folder</option>{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13 }}><input type="checkbox" checked={inline} onChange={e=>setInline(e.target.checked)} style={{ width:'auto', padding:0 }} />Use inline browser (for sites that block reader mode)</label>
      {error&&<div style={{ fontSize:12, color:(resolved||multiChoice)?T.warning:T.danger }}>{error}</div>}
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        {(resolved || multiChoice)
          ? <Btn variant="primary" onClick={submit} disabled={loading}>{loading?<Spinner size={12} color="#fff"/>:null}{loading?'Adding…':multiChoice?`Add ${checkedUrls.size||''} feed${checkedUrls.size===1?'':'s'}`:'Add feed'}</Btn>
          : <Btn variant="primary" onClick={findFeed} disabled={resolving||!url.trim()}>{resolving?<Spinner size={12} color="#fff"/>:null}{resolving?'Searching…':'Find feed'}</Btn>}
      </div>
    </div>
  </Modal>;
}

const FETCH_STRATEGY_LABELS = { 'direct':'Direct fetch', '12ft.io':'12ft.io (paywall bypass)', 'archive.ph':'archive.ph', 'googlebot-ua':'Googlebot user-agent' };
const FETCH_STRATEGY_NAMES_FALLBACK = ['direct','12ft.io','archive.ph','googlebot-ua'];

// Reorderable list of fetch strategies — up/down buttons rather than full
// drag-and-drop, much less code for the same outcome on a short list.
function StrategyOrderPicker({ order, onChange }) {
  const list = order?.length ? order : FETCH_STRATEGY_NAMES_FALLBACK;
  const move = (i, dir) => {
    const next = [...list];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
      {list.map((name, i) => (
        <div key={name} style={{ display:'flex', alignItems:'center', gap:8, background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:6, padding:'6px 10px' }}>
          <span style={{ fontSize:11, color:T.textSubtle, width:16 }}>{i+1}</span>
          <span style={{ flex:1, fontSize:13, color:T.text }}>{FETCH_STRATEGY_LABELS[name] || name}</span>
          <button onClick={()=>move(i,-1)} disabled={i===0} style={{ background:'transparent', border:'none', color:i===0?T.textSubtle:T.text, cursor:i===0?'default':'pointer', fontSize:13, padding:'2px 6px', opacity:i===0?0.3:1 }}>▲</button>
          <button onClick={()=>move(i,1)} disabled={i===list.length-1} style={{ background:'transparent', border:'none', color:i===list.length-1?T.textSubtle:T.text, cursor:i===list.length-1?'default':'pointer', fontSize:13, padding:'2px 6px', opacity:i===list.length-1?0.3:1 }}>▼</button>
        </div>
      ))}
    </div>
  );
}

function FeedRulesModal({ feed, folders, onSave, onClose }) {
  const [css,setCss]=useState((feed?.cssSelectors||[]).join('\n'));
  const [html,setHtml]=useState((feed?.htmlPatterns||[]).join('\n'));
  const [inline,setInline]=useState(feed?.inlineBrowser||false);
  const [hideShorts,setHideShorts]=useState(feed?.hideShorts||false);
  const [folder,setFolder]=useState(feed?.folder||'');
  const [titleBlocklist,setTitleBlocklist]=useState((feed?.titleBlocklist||[]).join('\n'));
  const [strategyOverride,setStrategyOverride]=useState(!!feed?.fetchStrategyOrder?.length);
  const [strategyOrder,setStrategyOrder]=useState(feed?.fetchStrategyOrder?.length?feed.fetchStrategyOrder:FETCH_STRATEGY_NAMES_FALLBACK);
  const [editingUrl,setEditingUrl]=useState(false);
  const [url,setUrl]=useState(feed?.url||'');
  const [urlError,setUrlError]=useState(null);
  const save=async()=>{
    setUrlError(null);
    try {
      await onSave({feedId:feed.id,cssSelectors:css.split('\n').map(s=>s.trim()).filter(Boolean),htmlPatterns:html.split('\n').map(s=>s.trim()).filter(Boolean),inlineBrowser:inline,hideShorts,folder:folder||null,titleBlocklist:titleBlocklist.split('\n').map(s=>s.trim()).filter(Boolean),fetchStrategyOrder:strategyOverride?strategyOrder:[], ...(editingUrl && url.trim()!==feed?.url ? {url:url.trim()} : {})});
      onClose();
    } catch(e) { setUrlError(e.message); }
  };
  return <Modal title={`Feed settings — ${feed?.name}`} onClose={onClose} wide>
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:8, padding:'10px 14px', fontSize:12, color:T.textMuted, lineHeight:1.6 }}>Rules are applied <strong style={{ color:T.text }}>before</strong> Readability extracts the article.</div>
      <div>
        <label style={{ fontSize:12, fontWeight:600, color:T.text, display:'block', marginBottom:6 }}>Feed URL</label>
        {!editingUrl ? (
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ flex:1, fontFamily:"'JetBrains Mono',monospace", fontSize:11.5, color:T.textMuted, background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:6, padding:'7px 10px', wordBreak:'break-all' }}>{feed?.url}</div>
            <Btn small variant="outline" onClick={()=>setEditingUrl(true)}>Change</Btn>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <input value={url} onChange={e=>{setUrl(e.target.value);setUrlError(null);}} style={{ width:'100%', fontFamily:"'JetBrains Mono',monospace", fontSize:12 }} />
            <div style={{ fontSize:11, color:T.textMuted }}>Changing this points the feed at a different source — existing articles stay, new ones come from the new URL.</div>
            {urlError && <div style={{ fontSize:11, color:T.danger }}>{urlError}</div>}
            <div><Btn small variant="outline" onClick={()=>{setEditingUrl(false);setUrl(feed?.url||'');setUrlError(null);}}>Cancel change</Btn></div>
          </div>
        )}
      </div>
      <div>
        <label style={{ fontSize:12, fontWeight:600, color:T.text, display:'block', marginBottom:6 }}>Folder</label>
        <select value={folder} onChange={e=>setFolder(e.target.value)} style={{ width:'100%' }}>
          <option value="">No folder</option>
          {(folders||[]).map(f=><option key={f.id} value={f.id}>{f.icon} {f.name}</option>)}
        </select>
      </div>
      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13 }}><input type="checkbox" checked={inline} onChange={e=>setInline(e.target.checked)} style={{ width:'auto', padding:0 }} />Use inline browser for this feed</label>
      {feed?.isYoutube && (
        <label style={{ display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer', fontSize:13 }}>
          <input type="checkbox" checked={hideShorts} onChange={e=>setHideShorts(e.target.checked)} style={{ width:'auto', padding:0, marginTop:2 }} />
          <span>
            Hide Shorts
            <div style={{ fontSize:11, color:T.textMuted, marginTop:2, lineHeight:1.5 }}>
              For channel feeds, fetches YouTube's "videos only" upload playlist instead of
              the regular channel feed — Shorts are excluded at the source, not filtered
              after the fact. For feeds where that doesn't apply, falls back to checking the
              video URL path and "#shorts" tags in the title/description.
            </div>
          </span>
        </label>
      )}
      <div>
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, marginBottom:8 }}>
          <input type="checkbox" checked={strategyOverride} onChange={e=>setStrategyOverride(e.target.checked)} style={{ width:'auto', padding:0 }} />
          Override article-fetch order for this feed
        </label>
        {strategyOverride && (
          <>
            <div style={{ fontSize:11, color:T.textMuted, marginBottom:6, lineHeight:1.5 }}>
              Flux tries each method in order until one returns usable content. Reorder to put
              a method that works better for this site first (e.g. 12ft.io for known paywalls).
            </div>
            <StrategyOrderPicker order={strategyOrder} onChange={setStrategyOrder} />
          </>
        )}
      </div>
      <div>
        <label style={{ fontSize:12, fontWeight:600, color:T.text, display:'block', marginBottom:6 }}>Hide items with titles matching</label>
        <textarea value={titleBlocklist} onChange={e=>setTitleBlocklist(e.target.value)} placeholder={`^\\[Sponsor\\]\nSponsored Post`} style={{ width:'100%', height:60, resize:'vertical', fontFamily:"'JetBrains Mono',monospace", fontSize:12 }} />
        <div style={{ fontSize:11, color:T.textMuted, marginTop:4, lineHeight:1.5 }}>
          One regex per line, matched against the article title. Useful for feeds that bake
          recurring sponsor/promo posts directly into the RSS (e.g. Daring Fireball's weekly
          "[Sponsor]" item) — these are genuine feed content, not a bug, but you may not want
          them cluttering your unread list.
        </div>
      </div>
      <div><label style={{ fontSize:12, fontWeight:600, color:T.text, display:'block', marginBottom:6 }}>CSS selectors to remove</label><textarea value={css} onChange={e=>setCss(e.target.value)} placeholder={`.paywall-overlay\n.subscription-modal\n#cookie-banner`} style={{ width:'100%', height:110, resize:'vertical', fontFamily:"'JetBrains Mono',monospace", fontSize:12 }} /></div>
      <div><label style={{ fontSize:12, fontWeight:600, color:T.text, display:'block', marginBottom:6 }}>HTML text patterns (regex)</label><textarea value={html} onChange={e=>setHtml(e.target.value)} placeholder="Subscribe to read more" style={{ width:'100%', height:80, resize:'vertical', fontFamily:"'JetBrains Mono',monospace", fontSize:12 }} /></div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={save}>Save</Btn></div>
    </div>
  </Modal>;
}

function OPMLResultModal({ result, mode, onClose }) {
  const isExport=mode==='export';
  return <Modal title={isExport?'Export complete':'Import complete'} onClose={onClose}>
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {isExport
        ?<div style={{ display:'flex', alignItems:'center', gap:12, background:T.successDim, border:'1px solid rgba(61,214,140,.2)', borderRadius:8, padding:'12px 14px' }}><span style={{ fontSize:20 }}>✓</span><div><div style={{ fontSize:13, fontWeight:600, color:T.success }}>{result.count} feed{result.count!==1?'s':''} exported</div>{result.filePath&&<div style={{ fontSize:11, color:T.textMuted, marginTop:2, fontFamily:'monospace', wordBreak:'break-all' }}>{result.filePath}</div>}</div></div>
        :<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
          {[{label:'Imported',value:result.imported,tone:'success'},{label:'Skipped',value:result.skipped,tone:'warning'},{label:'Total',value:result.total,tone:'muted'}].map(({label,value,tone})=>{
            const c={success:{bg:T.successDim,fg:T.success},warning:{bg:'rgba(245,166,35,.1)',fg:T.warning},muted:{bg:T.surfaceActive,fg:T.textMuted}}[tone];
            return <div key={label} style={{ background:c.bg, borderRadius:8, padding:'10px 12px', textAlign:'center' }}><div style={{ fontSize:22, fontWeight:700, color:c.fg }}>{value}</div><div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>{label}</div></div>;
          })}
        </div>
      }
      <div style={{ display:'flex', justifyContent:'flex-end' }}><Btn variant="primary" onClick={onClose}>Done</Btn></div>
    </div>
  </Modal>;
}

// Web-mode OPML file picker
function OPMLImportModal({ onClose, onResult }) {
  const [dragging,setDragging]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);

  const doImport=async(file)=>{
    setLoading(true); setError(null);
    try { const r=await api.opml.importFile(file); onResult(r); onClose(); }
    catch(e) { setError(e.message); setLoading(false); }
  };

  return <Modal title="Import OPML" onClose={onClose}>
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <label
        htmlFor="opml-file-input"
        onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f)doImport(f);}}
        style={{ display:'block', border:`2px dashed ${dragging?T.accent:T.border}`, borderRadius:10, padding:'28px 20px', textAlign:'center', cursor:'pointer', transition:'border-color 0.15s', background:dragging?T.accentDim:'transparent' }}>
        <div style={{ fontSize:28, marginBottom:8 }}>⇪</div>
        <div style={{ fontSize:13, color:T.textMuted }}>Drop .opml file here or tap to browse</div>
        {/* A native <label htmlFor> association is the reliable way to open
            the file picker on iOS Safari — calling .click() on a hidden
            <input type="file"> from a JS click handler is a documented
            source of inconsistent behavior across iOS versions (it can
            silently fail to open the picker), while a label/input pairing
            is standards-based and doesn't depend on JS call-stack timing.
            Visually hidden via clip/position rather than display:none, to
            stay safely inside what iOS considers a "real" form control. */}
        <input id="opml-file-input" type="file" accept=".opml,.xml,application/xml,text/xml,text/x-opml"
          style={{ position:'absolute', width:1, height:1, padding:0, margin:-1, overflow:'hidden', clip:'rect(0,0,0,0)', whiteSpace:'nowrap', border:0 }}
          onChange={e=>{ const f=e.target.files?.[0]; if(f) doImport(f); e.target.value=''; }} />
      </label>
      {loading&&<div style={{ display:'flex', alignItems:'center', gap:8, color:T.textMuted, fontSize:13 }}><Spinner size={14} />Importing…</div>}
      {error&&<div style={{ fontSize:12, color:T.danger }}>{error}</div>}
      <div style={{ display:'flex', justifyContent:'flex-end' }}><Btn variant="outline" onClick={onClose}>Cancel</Btn></div>
    </div>
  </Modal>;
}

// ─── Ollama cluster toast ─────────────────────────────────────────────────────
function ClusteringIndicator({ state }) {
  if (!state) return null;
  return <div style={{ position:'fixed', bottom:16, right:16, background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:'8px 12px', display:'flex', alignItems:'center', gap:8, fontSize:12, color:T.textMuted, boxShadow:'0 4px 16px rgba(0,0,0,.3)', zIndex:50 }}>
    {state==='loading'?<><Spinner size={12} />Clustering with Ollama…</>:<><span style={{ color:T.ai }}>◆</span>Clustering done</>}
  </div>;
}


// ─── Settings Modal ───────────────────────────────────────────────────────────
function DailyDigestModal({ articles, settings, onClose }) {
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { runWithOllama, promptJsx } = useOllama(settings);

  useEffect(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = articles.filter(a => !a.isShort && (a._dateMs || 0) > cutoff);
    if (recent.length < 3) {
      setError('Not enough recent articles (need at least 3 from the last 24 hours). Refresh your feeds first.');
      setLoading(false);
      return;
    }
    runWithOllama(() => api.ollama.dailyDigest({
      articles: recent.map(a => ({ title: a.title, summary: a.summary || '', source: a.feedName || '' })),
      ollamaUrl: settings?.ollamaUrl || undefined,
      model: settings?.ollamaModel || undefined,
    })).then(r => {
      if (r === null) { onClose(); return; } // user cancelled
      setDigest(r?.digest || r?.summary || String(r));
      setLoading(false);
    }).catch(e => { setError(e.message); setLoading(false); });
  }, []);

  return (
    <Modal title="📰 Daily Digest" onClose={onClose} wide>
      {promptJsx}
      <div style={{ minHeight: 120 }}>
        {loading && !error && <div style={{ display:'flex', alignItems:'center', gap:12, color:T.textMuted, padding:'24px 0' }}><Spinner size={18} />Generating digest…</div>}
        {error && <div style={{ color:T.danger, fontSize:13, lineHeight:1.6 }}>{error}</div>}
        {digest && <div style={{ fontSize:14, lineHeight:1.75, color:T.text, whiteSpace:'pre-wrap' }}>{digest}</div>}
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:16 }}>
          <Btn variant="outline" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </Modal>
  );
}

function SettingsModal({ settings, onSave, onClose }) {
  const [aiEnabled, setAiEnabled] = useState(settings.aiClusteringEnabled ?? false);
  const [sbEnabled, setSbEnabled] = useState(settings.sponsorBlockEnabled ?? true);
  const [deArrowEnabled, setDeArrowEnabled] = useState(settings.deArrowEnabled ?? false);
  const [ollamaAutoStart, setOllamaAutoStart] = useState(settings.ollamaAutoStart ?? false);
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaUrl || '');
  const [ollamaModel, setOllamaModel] = useState(settings.ollamaModel || '');
  const [cacheDays, setCacheDays] = useState(settings.articleCacheDays ?? 7);
  const [refreshInterval, setRefreshInterval] = useState(settings.refreshIntervalMinutes ?? 30);
  const [hiddenViews, setHiddenViews] = useState(new Set(settings.hiddenViews || []));
  const [strategyOrder, setStrategyOrder] = useState(settings.fetchStrategyOrder?.length ? settings.fetchStrategyOrder : FETCH_STRATEGY_NAMES_FALLBACK);
  const [clusterMaxDaysApart, setClusterMaxDaysApart] = useState(settings.clusterMaxDaysApart ?? 3);
  const [clusterSameSource, setClusterSameSource] = useState(!(settings.clusterExcludeSameSource !== false)); // UI shows the positive framing ("group same-source together")

  const save = async () => {
    await onSave({ ...settings, aiClusteringEnabled: aiEnabled, sponsorBlockEnabled: sbEnabled, deArrowEnabled, ollamaAutoStart, ollamaUrl: ollamaUrl.trim(), ollamaModel: ollamaModel.trim(), articleCacheDays: Number(cacheDays)||7, refreshIntervalMinutes: Number(refreshInterval)||30, hiddenViews: [...hiddenViews], fetchStrategyOrder: strategyOrder, clusterMaxDaysApart: Number(clusterMaxDaysApart)||3, clusterExcludeSameSource: !clusterSameSource });
    onClose();
  };

  const Toggle = ({ checked, onChange, title, desc }) => (
    <label style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, cursor:'pointer' }}>
      <div>
        <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{title}</div>
        {desc && <div style={{ fontSize:11, color:T.textMuted, marginTop:3, lineHeight:1.5 }}>{desc}</div>}
      </div>
      <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} style={{ width:'auto', flexShrink:0, marginTop:2 }} />
    </label>
  );

  return <Modal title="Settings" onClose={onClose} wide>
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      <div>
        <div style={{ fontSize:11, fontWeight:700, color:T.textSubtle, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:10 }}>AI features</div>
        <Toggle checked={aiEnabled} onChange={setAiEnabled} title="AI article grouping"
          desc="Detects when multiple feeds describe the same story and groups them into one card. Runs locally via Ollama after every refresh." />
        {aiEnabled && (
          <div style={{ marginTop:12, paddingLeft:2, display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ display:'flex', gap:8 }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:T.textMuted, display:'block', marginBottom:4 }}>Ollama URL</label>
                <input value={ollamaUrl} onChange={e=>setOllamaUrl(e.target.value)} placeholder="http://localhost:11434" style={{ width:'100%' }} />
              </div>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:T.textMuted, display:'block', marginBottom:4 }}>Embedding model</label>
                <input value={ollamaModel} onChange={e=>setOllamaModel(e.target.value)} placeholder="nomic-embed-text" style={{ width:'100%' }} />
              </div>
            </div>
            <div>
              <label style={{ fontSize:11, color:T.textMuted, display:'block', marginBottom:4 }}>Only group stories within this many days of each other</label>
              <input type="number" min={1} max={30} value={clusterMaxDaysApart} onChange={e=>setClusterMaxDaysApart(e.target.value)} style={{ width:80 }} />
            </div>
            <Toggle checked={clusterSameSource} onChange={setClusterSameSource}
              title="Group same-source articles together"
              desc="Off by default — a single outlet publishing a follow-up or live-blog update on its own earlier story isn't 'other outlets covering the same story', which is what grouping is meant to surface." />
          </div>
        )}
        <div style={{ marginTop:12 }}>
          <Toggle checked={ollamaAutoStart} onChange={setOllamaAutoStart}
            title="Auto-start Ollama"
            desc={ollamaAutoStart
              ? "Ollama will be started automatically when you use an AI feature, without asking first. It'll be stopped when done."
              : "When you use an AI feature, Flux will ask before starting Ollama. Turn this on to skip the prompt."} />
        </div>
      </div>

      <Divider margin={2} />

      <div>
        <div style={{ fontSize:11, fontWeight:700, color:T.textSubtle, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:10 }}>Sidebar views</div>
        {[{id:'__all',label:'All Items',icon:'◈'},{id:'__unread',label:'Unread',icon:'●'},{id:'__starred',label:'Starred',icon:'★'}].map(v=>(
          <Toggle key={v.id} checked={!hiddenViews.has(v.id)} onChange={show=>{
            setHiddenViews(prev=>{ const n=new Set(prev); if(show) n.delete(v.id); else n.add(v.id); return n; });
          }} title={`${v.icon} ${v.label}`} desc="" />
        ))}
      </div>

      <Divider margin={2} />

      <div>
        <div style={{ fontSize:11, fontWeight:700, color:T.textSubtle, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:10 }}>YouTube</div>
        <Toggle checked={sbEnabled} onChange={setSbEnabled} title="SponsorBlock"
          desc="Automatically skips sponsor segments, self-promo, and other non-content sections in YouTube videos using community-submitted timestamps." />
        <div style={{ marginTop:10 }}>
          <Toggle checked={deArrowEnabled} onChange={setDeArrowEnabled} title="DeArrow"
            desc="Replaces clickbait titles and thumbnails in YouTube feeds with community-submitted alternatives from the DeArrow API (dearrow.ajay.app). Falls back to the original if no alternative is available." />
        </div>
      </div>

      <Divider margin={2} />

      <div>
        <div style={{ fontSize:11, fontWeight:700, color:T.textSubtle, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:10 }}>Auto-refresh</div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <label style={{ fontSize:13, color:T.text, flexShrink:0 }}>Check for new articles every</label>
          <input type="number" min={1} max={1440} value={refreshInterval} onChange={e=>setRefreshInterval(e.target.value)} style={{ width:70 }} />
          <span style={{ fontSize:13, color:T.textMuted }}>minutes</span>
        </div>
        <div style={{ fontSize:11, color:T.textMuted, marginTop:6, lineHeight:1.5 }}>Set to 0 to disable. Minimum 1 minute. Refresh happens in the background — you'll see a badge on the ↺ button when new articles arrive.</div>
      </div>

      <Divider margin={2} />

      <div>
        <div style={{ fontSize:11, fontWeight:700, color:T.textSubtle, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:10 }}>Article cache</div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <span style={{ fontSize:13, color:T.text }}>Keep fetched articles for</span>
          <input type="number" min={1} max={365} value={cacheDays} onChange={e=>setCacheDays(e.target.value)} style={{ width:66 }} />
          <span style={{ fontSize:13, color:T.textMuted }}>days</span>
        </div>
        <div style={{ fontSize:11, color:T.textMuted, marginBottom:10, lineHeight:1.5 }}>Articles open instantly from cache. Set to 1 to always re-fetch (ignores caching). Rules and element-block changes clear the cache for that article automatically.</div>
        <Btn small variant="outline" onClick={()=>{ api.articles.clearCache(); }}>Clear cache now</Btn>
      </div>

      <Divider margin={2} />

      <div>
        <div style={{ fontSize:11, fontWeight:700, color:T.textSubtle, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:6 }}>Article fetch order</div>
        <div style={{ fontSize:11, color:T.textMuted, marginBottom:10, lineHeight:1.5 }}>
          Default order Flux tries when fetching full article content. Individual feeds can
          override this in their feed settings.
        </div>
        <StrategyOrderPicker order={strategyOrder} onChange={setStrategyOrder} />
      </div>

      {api.isRemoteHttp() && <AccountSection />}

      <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={save}>Save</Btn>
      </div>
    </div>
  </Modal>;
}

// Only rendered when the app is talking to a real server with accounts
// (plain web build, or Electron in remote-server mode) — Electron's local
// IPC mode has no login at all, so there's nothing to manage here.
function AccountSection() {
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [curPw, setCurPw] = useState(''); const [newPw, setNewPw] = useState('');
  const [show2faSetup, setShow2faSetup] = useState(null); // { secret, otpauth } while mid-setup
  const [code, setCode] = useState('');
  const [disablePw, setDisablePw] = useState('');
  const [showDisable2fa, setShowDisable2fa] = useState(false);

  useEffect(() => { api.auth.me().then(setMe).catch(()=>{}); }, []);

  const changePassword = async () => {
    setBusy(true); setMsg(null);
    try { await api.auth.changePassword(curPw, newPw); setMsg({ ok:true, text:'Password updated.' }); setCurPw(''); setNewPw(''); setShowPasswordForm(false); }
    catch (e) { setMsg({ ok:false, text:e.message }); }
    finally { setBusy(false); }
  };
  const start2fa = async () => {
    setBusy(true); setMsg(null);
    try { setShow2faSetup(await api.auth.twoFactor.setup()); }
    catch (e) { setMsg({ ok:false, text:e.message }); }
    finally { setBusy(false); }
  };
  const confirm2fa = async () => {
    setBusy(true); setMsg(null);
    try { await api.auth.twoFactor.enable(code); setShow2faSetup(null); setCode(''); setMe(m=>({...m, twoFactorEnabled:true})); setMsg({ ok:true, text:'Two-factor authentication enabled.' }); }
    catch (e) { setMsg({ ok:false, text:e.message }); }
    finally { setBusy(false); }
  };
  const disable2fa = async () => {
    setBusy(true); setMsg(null);
    try { await api.auth.twoFactor.disable(disablePw); setShowDisable2fa(false); setDisablePw(''); setMe(m=>({...m, twoFactorEnabled:false})); setMsg({ ok:true, text:'Two-factor authentication disabled.' }); }
    catch (e) { setMsg({ ok:false, text:e.message }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:16, marginTop:4, display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ fontSize:11, fontWeight:700, color:T.textSubtle, letterSpacing:'0.06em', textTransform:'uppercase' }}>Account</div>
      <div style={{ fontSize:13, color:T.text, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span>Signed in as <strong>{me?.username || '…'}</strong>{me?.isAdmin && <span style={{ fontSize:10, color:T.accent, marginLeft:6, border:`1px solid ${T.accent}`, borderRadius:4, padding:'1px 5px' }}>ADMIN</span>}</span>
        <Btn small variant="outline" onClick={async()=>{ await api.auth.logout(); window.location.reload(); }}>Log out</Btn>
      </div>

      {msg && <div style={{ fontSize:12, color: msg.ok ? T.success : T.danger }}>{msg.text}</div>}

      {!showPasswordForm ? (
        <Btn small variant="outline" onClick={()=>setShowPasswordForm(true)}>Change password</Btn>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <input type="password" placeholder="Current password" value={curPw} onChange={e=>setCurPw(e.target.value)} />
          <input type="password" placeholder="New password (min. 8 characters)" value={newPw} onChange={e=>setNewPw(e.target.value)} />
          <div style={{ display:'flex', gap:8 }}>
            <Btn small variant="outline" onClick={()=>{setShowPasswordForm(false);setCurPw('');setNewPw('');}}>Cancel</Btn>
            <Btn small variant="primary" onClick={changePassword} disabled={busy||!curPw||newPw.length<8}>{busy?<Spinner size={11} color="#fff"/>:null}Update</Btn>
          </div>
        </div>
      )}

      <div style={{ borderTop:`1px solid ${T.borderSubtle}`, paddingTop:12 }}>
        <div style={{ fontSize:13, color:T.text, marginBottom:6 }}>Two-factor authentication {me?.twoFactorEnabled ? <span style={{ color:T.success, fontSize:11 }}>● Enabled</span> : <span style={{ color:T.textSubtle, fontSize:11 }}>● Disabled</span>}</div>
        {!me?.twoFactorEnabled && !show2faSetup && <Btn small variant="outline" onClick={start2fa} disabled={busy}>Set up two-factor authentication</Btn>}
        {show2faSetup && (
          <div style={{ display:'flex', flexDirection:'column', gap:8, background:T.surfaceActive, border:`1px solid ${T.border}`, borderRadius:8, padding:12 }}>
            <div style={{ fontSize:12, color:T.textMuted }}>Scan this with your authenticator app (Google Authenticator, Authy, 1Password, Bitwarden, etc.):</div>
            <img src={show2faSetup.qrCodeDataUrl} alt="2FA QR code" style={{ width:180, height:180, alignSelf:'center', borderRadius:8, background:'#fff', padding:8 }} />
            <details style={{ fontSize:11, color:T.textSubtle }}>
              <summary style={{ cursor:'pointer' }}>Can't scan? Enter manually</summary>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, wordBreak:'break-all', background:T.surface, padding:8, borderRadius:6, marginTop:6, color:T.text }}>{show2faSetup.secret}</div>
            </details>
            <input inputMode="numeric" placeholder="Enter 6-digit code to confirm" value={code} onChange={e=>setCode(e.target.value)} style={{ letterSpacing:'0.2em', textAlign:'center' }} />
            <div style={{ display:'flex', gap:8 }}>
              <Btn small variant="outline" onClick={()=>{setShow2faSetup(null);setCode('');}}>Cancel</Btn>
              <Btn small variant="primary" onClick={confirm2fa} disabled={busy||code.trim().length<6}>{busy?<Spinner size={11} color="#fff"/>:null}Confirm</Btn>
            </div>
          </div>
        )}
        {me?.twoFactorEnabled && !showDisable2fa && <Btn small variant="outline" onClick={()=>setShowDisable2fa(true)}>Disable two-factor authentication</Btn>}
        {showDisable2fa && (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <input type="password" placeholder="Confirm your password" value={disablePw} onChange={e=>setDisablePw(e.target.value)} />
            <div style={{ display:'flex', gap:8 }}>
              <Btn small variant="outline" onClick={()=>{setShowDisable2fa(false);setDisablePw('');}}>Cancel</Btn>
              <Btn small variant="danger" onClick={disable2fa} disabled={busy||!disablePw}>{busy?<Spinner size={11} color="#fff"/>:null}Disable</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── New Folder Modal ─────────────────────────────────────────────────────────
// Curated set of icons for folders — a mix of emoji and Unicode symbols
// covering common RSS reading categories.
const FOLDER_ICONS = [
  '◈','📰','💻','🎮','🎵','🎬','📚','🔬','🏀','⚽','🍕','✈️',
  '💡','🌍','🏛️','💰','📷','🎨','🔧','🏠','🌿','⚡','🦾','🧠',
  '📡','🎙️','🏋️','🎯','🎲','🔐','🌐','📊','🤖','🚀','☁️','🗞️',
  '🖥️','📱','🎧','🎤','🎥','📝','🔔','⭐','❤️','🔥','💎','🧩',
];

function FolderIconPicker({ value, onChange }) {
  return <div style={{ display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap:4, marginTop:6 }}>
    {FOLDER_ICONS.map(ic=>(
      <button key={ic} onClick={()=>onChange(ic)}
        style={{ fontSize:18, padding:'6px 2px', borderRadius:6, border:value===ic?`2px solid ${T.accent}`:'2px solid transparent', background:value===ic?T.accentDim:'transparent', cursor:'pointer', textAlign:'center', transition:'all 0.1s' }}>
        {ic}
      </button>
    ))}
    <input value={value} onChange={e=>onChange(e.target.value)} maxLength={8}
      style={{ gridColumn:'span 2', textAlign:'center', fontSize:16, border:`2px solid ${T.border}`, borderRadius:6, padding:'4px 0', background:T.surfaceActive, color:T.text }}
      placeholder="✏️" title="Or type any emoji/symbol" />
  </div>;
}

function NewFolderModal({ onAdd, onClose }) {
  const [name,setName] = useState('');
  const [icon,setIcon] = useState('◈');
  const [error,setError] = useState(null);
  const submit = async () => {
    if (!name.trim()) return;
    try { await onAdd({ name: name.trim(), icon: icon.trim() || '◈' }); onClose(); }
    catch(e) { setError(e.message); }
  };
  return <Modal title="New folder" onClose={onClose}>
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div>
        <label style={{ fontSize:12, color:T.textMuted, display:'block', marginBottom:5 }}>Name</label>
        <input autoFocus value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="e.g. Tech News" style={{ width:'100%' }} />
      </div>
      <div>
        <label style={{ fontSize:12, color:T.textMuted, display:'block', marginBottom:5 }}>Icon</label>
        <FolderIconPicker value={icon} onChange={setIcon} />
      </div>
      {error&&<div style={{ fontSize:12, color:T.danger }}>{error}</div>}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit}>Create</Btn>
      </div>
    </div>
  </Modal>;
}

function EditFolderModal({ folder, onSave, onClose }) {
  const [name,setName] = useState(folder.name);
  const [icon,setIcon] = useState(folder.icon||'◈');
  const [error,setError] = useState(null);
  const submit = async () => {
    if (!name.trim()) return;
    try { await onSave({ folderId:folder.id, name:name.trim(), icon:icon.trim()||'◈' }); onClose(); }
    catch(e) { setError(e.message); }
  };
  return <Modal title="Edit folder" onClose={onClose}>
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div>
        <label style={{ fontSize:12, color:T.textMuted, display:'block', marginBottom:5 }}>Name</label>
        <input autoFocus value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} style={{ width:'100%' }} />
      </div>
      <div>
        <label style={{ fontSize:12, color:T.textMuted, display:'block', marginBottom:5 }}>Icon</label>
        <FolderIconPicker value={icon} onChange={setIcon} />
      </div>
      {error&&<div style={{ fontSize:12, color:T.danger }}>{error}</div>}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit}>Save</Btn>
      </div>
    </div>
  </Modal>;
}


// ─── Manage Folder Feeds Modal ────────────────────────────────────────────────
function ManageFolderFeedsModal({ folder, feeds, onAssign, onClose }) {
  const [memberIds, setMemberIds] = useState(new Set(feeds.filter(f=>f.folder===folder.id).map(f=>f.id)));
  const [saving, setSaving] = useState(false);

  const toggle = (feedId) => setMemberIds(prev=>{
    const next = new Set(prev);
    if (next.has(feedId)) next.delete(feedId); else next.add(feedId);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      const changed = feeds.filter(f => memberIds.has(f.id) !== (f.folder===folder.id));
      await Promise.all(changed.map(f => onAssign(f.id, memberIds.has(f.id) ? folder.id : null)));
      onClose();
    } finally { setSaving(false); }
  };

  const sorted = [...feeds].sort((a,b)=>a.name.localeCompare(b.name));

  return <Modal title={`Manage feeds — ${folder.icon} ${folder.name}`} onClose={onClose}>
    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
      <div style={{ fontSize:12, color:T.textMuted, marginBottom:6 }}>Check the feeds that belong in this folder. Unchecking a feed doesn't remove it — it just moves to "no folder".</div>
      <div style={{ maxHeight:320, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
        {sorted.length===0&&<div style={{ fontSize:13, color:T.textSubtle, padding:'12px 0' }}>No feeds yet — add one first.</div>}
        {sorted.map(f=>{
          const inThisFolder = memberIds.has(f.id);
          const elsewhere = f.folder && f.folder!==folder.id && !inThisFolder;
          return (
            <label key={f.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 8px', borderRadius:6, cursor:'pointer' }}
              onMouseEnter={e=>e.currentTarget.style.background=T.surfaceHover}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <input type="checkbox" checked={inThisFolder} onChange={()=>toggle(f.id)} style={{ width:'auto' }} />
              <span style={{ fontSize:13, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.isYoutube?'▶ ':'◉ '}{f.name}</span>
              {elsewhere&&<span style={{ fontSize:10, color:T.textSubtle }}>currently in another folder — checking moves it here</span>}
            </label>
          );
        })}
      </div>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:8 }}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={save} disabled={saving}>{saving?<Spinner size={12} color="#fff"/>:null}{saving?'Saving…':'Save'}</Btn>
      </div>
    </div>
  </Modal>;
}

// ─── Context menu ─────────────────────────────────────────────────────────────
function ContextMenu({ x, y, items, onClose }) {
  useEffect(()=>{
    const close = () => onClose();
    const esc = (e)=>{ if(e.key==='Escape') onClose(); };
    // Attaching these listeners immediately can let the very tap/click that
    // opened the menu also be the one that closes it — on mobile, touch
    // events synthesize a following 'click' with timing that isn't always
    // safely past the handler that just called setMobileMoreMenu(...), and
    // even on desktop a fast double-fire is possible. Deferring to the
    // next tick guarantees the opening interaction has fully finished
    // before anything can dismiss the menu.
    const timer = setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('touchend', close);
      window.addEventListener('contextmenu', close);
      window.addEventListener('keydown', esc);
    }, 0);
    return ()=>{
      clearTimeout(timer);
      window.removeEventListener('click', close);
      window.removeEventListener('touchend', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', esc);
    };
  },[onClose]);

  // Keep on-screen
  const style = useMemo(()=>{
    const w=180, h=items.length*34+8;
    let left=x, top=y;
    if (left+w > window.innerWidth-8) left = window.innerWidth-w-8;
    if (top+h > window.innerHeight-8) top = window.innerHeight-h-8;
    return { top, left };
  },[x,y,items.length]);

  return <div onClick={e=>e.stopPropagation()} style={{ position:'fixed', top:style.top, left:style.left, background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,.45)', zIndex:300, overflow:'hidden', minWidth:170, padding:'4px 0' }} className="fade-in">
    {items.map((it,i)=> it.divider
      ? <div key={i} style={{ height:1, background:T.borderSubtle, margin:'4px 0' }} />
      : <ContextMenuItem key={i} item={it} onClose={onClose} />
    )}
  </div>;
}
function ContextMenuItem({ item, onClose }) {
  const [h,setH]=useState(false);
  return <div onClick={()=>{ if (item.disabled) return; item.onClick(); onClose(); }}
    onMouseEnter={()=>!item.disabled&&setH(true)} onMouseLeave={()=>setH(false)}
    style={{ padding:'7px 12px', fontSize:13, cursor:item.disabled?'default':'pointer', color:item.disabled?T.textSubtle:(item.danger?T.danger:T.text), opacity:item.disabled?0.5:1, display:'flex', alignItems:'center', gap:8, background:h?T.surfaceHover:'transparent', transition:'background 0.1s' }}>
    {item.icon&&<span style={{ width:14, textAlign:'center', fontSize:12 }}>{item.icon}</span>}{item.label}
  </div>;
}

// ─── Filter bar ───────────────────────────────────────────────────────────────
const DEFAULT_FILTERS = { source: 'all', status: 'all', ai: 'all' };

function FilterBar({ filters, onChange, feedsInView, showAiFilter }) {
  const active = filters.source!=='all' || filters.status!=='all' || filters.ai!=='all';
  return <div style={{ padding:'8px 14px', borderBottom:`1px solid ${T.borderSubtle}`, display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
    <select value={filters.status} onChange={e=>onChange({...filters, status:e.target.value})} style={{ fontSize:11, padding:'4px 8px' }}>
      <option value="all">All</option>
      <option value="unread">Unread</option>
      <option value="read">Read</option>
      <option value="starred">Starred</option>
    </select>
    {feedsInView.length>1 && (
      <select value={filters.source} onChange={e=>onChange({...filters, source:e.target.value})} style={{ fontSize:11, padding:'4px 8px', maxWidth:140 }}>
        <option value="all">All sources</option>
        {feedsInView.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    )}
    {showAiFilter && (
      <select value={filters.ai} onChange={e=>onChange({...filters, ai:e.target.value})} style={{ fontSize:11, padding:'4px 8px' }}>
        <option value="all">All articles</option>
        <option value="grouped">Grouped only</option>
        <option value="ungrouped">Ungrouped only</option>
      </select>
    )}
    {active && <Btn small variant="ghost" onClick={()=>onChange(DEFAULT_FILTERS)}>Clear filters</Btn>}
  </div>;
}

// ─── Mobile breakpoint hook ───────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(()=>window.innerWidth < 768);
  useEffect(()=>{
    const mq = window.matchMedia('(max-width: 767px)');
    const h = (e) => setMobile(e.matches);
    mq.addEventListener('change', h);
    return ()=>mq.removeEventListener('change', h);
  },[]);
  return mobile;
}

// ─── Mobile Layout ────────────────────────────────────────────────────────────
// Single-pane stack navigation with a bottom tab bar.
//
// Three "screens":
//   feeds   – sidebar view (nav + folder/feed list)
//   list    – article list for the active view
//   article – reader pane for the selected article
//
// Bottom bar always visible, shows: All · Folders · [active feed] · Refresh
// and a small Feeds sheet (full feed list + settings access).
//
function MobileLayout({
  feeds_, folders_, articles, visibleArticles, activeView, setActiveView,
  selectedArticle, setSelectedArticle,
  handleRefreshAll, refreshing, settings, handleSaveSettings,
  onMarkRead, onToggleStar, onSaveRules, onOpenRules, setRulesTarget, setShowSettings,
  setShowAddFeed, setAddToFolderTarget, setShowNewFolder, setEditFolderTarget,
  handleMarkAllRead, filters, setFilters,
  handleRemoveFeed, handleRemoveFolder, handleAssignFeedFolder, setManageFolderTarget,
  setShowOPMLImport, handleExportOPML, handleImportOPML,
  baseFilteredArticles,
}) {
  const [screen, setScreen] = useState('list'); // 'list' | 'article'
  const [showFeedsSheet, setShowFeedsSheet] = useState(false);
  const [closingSheet, setClosingSheet] = useState(false);
  const [folderExpanded, setFolderExpanded] = useState({});
  const closeSheet = () => {
    setClosingSheet(true);
    setTimeout(() => { setShowFeedsSheet(false); setClosingSheet(false); }, 220);
  };
  const pinnedFolderIds = settings?.pinnedFolderIds || [];
  const togglePinFolder = (folderId) => {
    const isPinned = pinnedFolderIds.includes(folderId);
    const next = isPinned ? pinnedFolderIds.filter(id=>id!==folderId) : [...pinnedFolderIds, folderId];
    handleSaveSettings?.({ ...settings, pinnedFolderIds: next });
  };
  const [screenAnim, setScreenAnim] = useState(null); // 'in'|'back'|null
  const goToList = (view) => { if (view) setActiveView(view); setScreenAnim('back'); setScreen('list'); closeSheet(); };
  const goToArticle = (article) => { setSelectedArticle(article); setScreenAnim('in'); setScreen('article'); };
  const goBack = () => { setScreenAnim('back'); setScreen('list'); };

  const unreadAll = baseFilteredArticles.filter(a=>!a.isRead).length;
  const unreadUnread = unreadAll;

  // ── Bottom tab bar (inline JSX — NOT a component, prevents remount) ─────────
  const pinnedFolders = pinnedFolderIds.map(id=>folders_.find(f=>f.id===id)).filter(Boolean);
  const visibleDefaultViews = [
    { id:'__all',     icon:'◈', label:'All',     count: baseFilteredArticles.filter(a=>!a.isRead).length },
    { id:'__unread',  icon:'●', label:'Unread',  count: unreadUnread },
    { id:'__starred', icon:'★', label:'Starred', count: baseFilteredArticles.filter(a=>a.isStarred).length },
  ].filter(v=>!(settings?.hiddenViews||[]).includes(v.id));
  const scrollableCount = visibleDefaultViews.length + pinnedFolders.length;
  const hasPins = pinnedFolders.length > 0;
  const tabBtnStyle = (active) => ({
    flex: hasPins ? '0 0 64px' : 1, height:'100%', border:'none', background:'transparent',
    color:active?T.accent:T.textSubtle, display:'flex', flexDirection:'column', alignItems:'center',
    justifyContent:'center', gap:2, cursor:'pointer', fontSize:11, fontWeight:active?700:400, position:'relative',
  });
  const bottomBar = (
    <div style={{ position:'fixed', bottom:0, left:0, right:0, height:56, background:T.surface, borderTop:`1px solid ${T.border}`, display:'flex', alignItems:'center', zIndex:90, paddingBottom:'env(safe-area-inset-bottom)' }}>
      {/* Scrollable region — only the default views + pinned folders scroll;
          Feeds/Refresh below stay pinned in place so they can never be
          scrolled off-screen no matter how many tabs are pinned. */}
      <div style={{ flex: scrollableCount>0 ? 1 : 0, minWidth:0, display:'flex', height:'100%', overflowX: hasPins ? 'auto' : 'hidden', WebkitOverflowScrolling:'touch' }}>
        {visibleDefaultViews.map(v => {
          const active = activeView===v.id && screen==='list';
          return (
            <button key={v.id} onClick={()=>goToList(v.id)} style={tabBtnStyle(active)}>
              <span style={{ fontSize:18, lineHeight:1 }}>{v.icon}</span>
              <span>{v.label}</span>
              {v.count>0 && <div style={{ position:'absolute', top:8, right:'calc(50% - 14px)', minWidth:16, height:16, borderRadius:8, background:T.accent, color:'#fff', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 4px' }}>{v.count}</div>}
            </button>
          );
        })}
        {pinnedFolders.map(folder => {
          const view = `folder:${folder.id}`;
          const active = activeView===view && screen==='list';
          const count = baseFilteredArticles.filter(a=>!a.isRead && feeds_.find(f=>f.id===a.feedId)?.folder===folder.id).length;
          return (
            <button key={folder.id} onClick={()=>goToList(view)} style={tabBtnStyle(active)}>
              <span style={{ fontSize:18, lineHeight:1 }}>{folder.icon}</span>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:60 }}>{folder.name}</span>
              {count>0 && <div style={{ position:'absolute', top:8, right:'calc(50% - 14px)', minWidth:16, height:16, borderRadius:8, background:T.accent, color:'#fff', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 4px' }}>{count}</div>}
            </button>
          );
        })}
      </div>
      <button onClick={()=>showFeedsSheet ? closeSheet() : setShowFeedsSheet(true)} style={{ ...tabBtnStyle(showFeedsSheet), flex:'0 0 64px' }}>
        <span style={{ fontSize:18, lineHeight:1 }}>☰</span>
        <span>Feeds</span>
      </button>
      <button onClick={handleRefreshAll} style={{ ...tabBtnStyle(refreshing), flex:'0 0 64px' }}>
        {refreshing ? <Spinner size={18} color={T.accent} /> : <span style={{ fontSize:18, lineHeight:1 }}>↺</span>}
        <span>Refresh</span>
      </button>
    </div>
  );

  // ── Feeds sheet (inline JSX) ─────────────────────────────────────────────────
  const feedsSheet = showFeedsSheet && (
    <div style={{ position:'fixed', inset:0, zIndex:80 }}>
      <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.5)' }} onClick={closeSheet} />
      <div className={closingSheet?'slide-down':'slide-up'}
        style={{ position:'absolute', bottom:0, left:0, right:0, background:T.surface, borderRadius:'16px 16px 0 0', maxHeight:'82vh', display:'flex', flexDirection:'column', paddingBottom:'env(safe-area-inset-bottom)' }}>
        {/* Handle */}
        <div style={{ width:40, height:4, borderRadius:2, background:T.border, margin:'12px auto 4px', flexShrink:0 }} />
        {/* Header */}
        <div style={{ padding:'4px 16px 10px', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <span style={{ fontWeight:700, fontSize:16, color:T.text }}>Feeds</span>
          <div style={{ flex:1 }} />
          <label style={{ background:T.surfaceActive, color:T.textMuted, border:`1px solid ${T.border}`, borderRadius:7, padding:'6px 10px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            ↓ OPML
            <input type="file" accept=".opml,.xml,application/xml,text/xml,text/x-opml" style={{ position:'absolute', width:1, height:1, overflow:'hidden', clip:'rect(0,0,0,0)' }}
              onChange={e=>{ const f=e.target.files?.[0]; if(!f) return; api.opml.importFile(f).then(r=>{ closeSheet(); alert(`Imported ${r.imported} feeds, skipped ${r.skipped}.`); }).catch(err=>alert('Import failed: '+err.message)); e.target.value=''; }} />
          </label>
          <button onClick={()=>{ setShowAddFeed(true); closeSheet(); }}
            style={{ background:T.accentDim, color:T.accent, border:'none', borderRadius:7, padding:'6px 12px', fontSize:12, fontWeight:600, cursor:'pointer' }}>+ Add feed</button>
          <button onClick={()=>{ setShowSettings(true); closeSheet(); }}
            style={{ background:'transparent', color:T.textSubtle, border:'none', padding:'6px 8px', fontSize:20, cursor:'pointer' }}>⚙</button>
        </div>

        <div style={{ overflowY:'auto', flex:1, padding:'0 8px' }}>
          {/* Bottom bar tabs — tap to show/hide All/Unread/Starred */}
          <div style={{ padding:'6px 8px 12px' }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em', color:T.textSubtle, marginBottom:6 }}>Bottom bar tabs</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {[{id:'__all',label:'All'},{id:'__unread',label:'Unread'},{id:'__starred',label:'Starred'}].map(v=>{
                const hidden = (settings?.hiddenViews||[]).includes(v.id);
                return (
                  <button key={v.id} onClick={()=>{
                    const cur = settings?.hiddenViews || [];
                    const next = hidden ? cur.filter(id=>id!==v.id) : [...cur, v.id];
                    handleSaveSettings?.({ ...settings, hiddenViews: next });
                  }}
                    style={{ fontSize:12, fontWeight:600, padding:'6px 12px', borderRadius:16, cursor:'pointer', border:`1px solid ${hidden?T.border:T.accent}`, background:hidden?'transparent':T.accentDim, color:hidden?T.textSubtle:T.accent }}>
                    {hidden?'☐':'☑'} {v.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Folders */}
          {folders_.map(folder=>{
            const ffeeds = feeds_.filter(f=>f.folder===folder.id);
            const open = folderExpanded[folder.id] ?? true;
            const unread = baseFilteredArticles.filter(a=>!a.isRead&&ffeeds.some(f=>f.id===a.feedId)).length;
            return (
              <div key={folder.id}>
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 8px 6px', cursor:'pointer' }}>
                  {/* Tap icon/name to navigate to folder view */}
                  <span style={{ fontSize:14 }}>{folder.icon}</span>
                  <span onClick={()=>goToList(`folder:${folder.id}`)}
                    style={{ flex:1, fontSize:13, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em', color:T.textSubtle }}>
                    {folder.name}
                  </span>
                  {unread>0 && <span style={{ fontSize:11, color:T.accent, fontWeight:700, marginRight:4 }}>{unread}</span>}
                  {/* Pin to bottom bar */}
                  <button onClick={(e)=>{ e.stopPropagation(); togglePinFolder(folder.id); }}
                    title={pinnedFolderIds.includes(folder.id) ? 'Unpin from bar' : 'Pin to bar'}
                    style={{ background:'transparent', border:'none', color:pinnedFolderIds.includes(folder.id)?T.accent:T.textSubtle, fontSize:14, padding:'2px 6px', cursor:'pointer' }}>
                    {pinnedFolderIds.includes(folder.id) ? '📌' : '📍'}
                  </button>
                  {/* Edit button for folder */}
                  <button onClick={()=>{ setEditFolderTarget(folder); closeSheet(); }}
                    style={{ background:'transparent', border:'none', color:T.textSubtle, fontSize:14, padding:'2px 6px', cursor:'pointer' }}>✏️</button>
                  {/* Delete folder */}
                  <button onClick={(e)=>{ e.stopPropagation(); if (confirm(`Delete folder "${folder.name}"? Feeds inside will become unfiled.`)) handleRemoveFolder(folder.id); }}
                    style={{ background:'transparent', border:'none', color:T.danger, fontSize:13, padding:'2px 6px', cursor:'pointer' }}>✕</button>
                  <span onClick={()=>setFolderExpanded(p=>({...p,[folder.id]:!open}))}
                    style={{ fontSize:11, color:T.textSubtle, transition:'transform 0.15s', transform:open?'rotate(0deg)':'rotate(-90deg)', padding:'4px', cursor:'pointer' }}>▾</span>
                </div>
                {open && ffeeds.map(feed=>{
                  const cnt = baseFilteredArticles.filter(a=>!a.isRead&&a.feedId===feed.id).length;
                  return (
                    <div key={feed.id} onClick={()=>goToList(`feed:${feed.id}`)}
                      style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 8px 9px 24px', borderRadius:8, cursor:'pointer' }}
                      onTouchStart={e=>e.currentTarget.style.background=T.surfaceHover}
                      onTouchEnd={e=>e.currentTarget.style.background='transparent'}>
                      {feed.favicon
                        ? <img src={feed.favicon} style={{ width:16, height:16, borderRadius:3, flexShrink:0, objectFit:'cover' }} onError={e=>{e.currentTarget.style.display='none';}} />
                        : <span style={{ fontSize:12, color:feed.isYoutube?T.youtube:T.accent, flexShrink:0 }}>{feed.isYoutube?'▶':'◉'}</span>}
                      <span style={{ flex:1, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{feed.name}</span>
                      {cnt>0 && <span style={{ fontSize:11, fontWeight:700, color:T.accent, marginRight:2 }}>{cnt}</span>}
                      <button onClick={(e)=>{ e.stopPropagation(); setRulesTarget(feed); closeSheet(); }}
                        style={{ background:'transparent', border:'none', color:T.textSubtle, fontSize:14, padding:'2px 6px', cursor:'pointer', flexShrink:0 }}>⚙</button>
                      <button onClick={(e)=>{ e.stopPropagation(); if (confirm(`Remove feed "${feed.name}"?`)) handleRemoveFeed(feed.id); }}
                        style={{ background:'transparent', border:'none', color:T.danger, fontSize:13, padding:'2px 6px', cursor:'pointer', flexShrink:0 }}>✕</button>
                    </div>
                  );
                })}
                {open && <div onClick={()=>{ setAddToFolderTarget(folder); closeSheet(); }}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 8px 7px 24px', borderRadius:8, cursor:'pointer', color:T.textSubtle, fontSize:13 }}>
                  <span>+ Add feed</span>
                </div>}
              </div>
            );
          })}

          {/* Unfiled feeds */}
          {feeds_.filter(f=>!f.folder||!folders_.find(fo=>fo.id===f.folder)).length>0 && (
            <div style={{ padding:'10px 8px 6px', color:T.textSubtle, fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em' }}>Other feeds</div>
          )}
          {feeds_.filter(f=>!f.folder||!folders_.find(fo=>fo.id===f.folder)).map(feed=>{
            const cnt = baseFilteredArticles.filter(a=>!a.isRead&&a.feedId===feed.id).length;
            return (
              <div key={feed.id} onClick={()=>goToList(`feed:${feed.id}`)}
                style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 8px', borderRadius:8, cursor:'pointer' }}
                onTouchStart={e=>e.currentTarget.style.background=T.surfaceHover}
                onTouchEnd={e=>e.currentTarget.style.background='transparent'}>
                {feed.favicon
                  ? <img src={feed.favicon} style={{ width:16, height:16, borderRadius:3, flexShrink:0, objectFit:'cover' }} onError={e=>{e.currentTarget.style.display='none';}} />
                  : <span style={{ fontSize:12, color:feed.isYoutube?T.youtube:T.accent, flexShrink:0 }}>{feed.isYoutube?'▶':'◉'}</span>}
                <span style={{ flex:1, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{feed.name}</span>
                {cnt>0 && <span style={{ fontSize:11, fontWeight:700, color:T.accent, marginRight:2 }}>{cnt}</span>}
                <button onClick={(e)=>{ e.stopPropagation(); setRulesTarget(feed); closeSheet(); }}
                  style={{ background:'transparent', border:'none', color:T.textSubtle, fontSize:14, padding:'2px 6px', cursor:'pointer', flexShrink:0 }}>⚙</button>
                <button onClick={(e)=>{ e.stopPropagation(); if (confirm(`Remove feed "${feed.name}"?`)) handleRemoveFeed(feed.id); }}
                  style={{ background:'transparent', border:'none', color:T.danger, fontSize:13, padding:'2px 6px', cursor:'pointer', flexShrink:0 }}>✕</button>
              </div>
            );
          })}

          {/* New folder button — always visible, not buried */}
          <div onClick={()=>{ setShowNewFolder(true); closeSheet(); }}
            style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 8px', borderRadius:8, cursor:'pointer', color:T.accent, fontSize:14, fontWeight:600, borderTop:`1px solid ${T.border}`, marginTop:8 }}>
            <span style={{ fontSize:16 }}>+</span>
            <span>New folder</span>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Screen: Article list (inline JSX via useMemo) ────────────────────────────
  const label = activeView==='__all'?'All Items':activeView==='__unread'?'Unread':activeView==='__starred'?'Starred'
    :activeView.startsWith('feed:')?(feeds_.find(f=>f.id===activeView.slice(5))?.name||'Feed')
    :activeView.startsWith('folder:')?(folders_.find(fo=>fo.id===activeView.slice(7))?.name||'Folder'):'';
  const unreadVisible = visibleArticles.filter(a=>!a.isRead).length;

  const listScreen = (
    <div className={screenAnim==='back'?'slide-in-prev':''} onAnimationEnd={()=>setScreenAnim(null)} style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'14px 16px 10px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:8, flexShrink:0, background:T.surface }}>
        {(activeView!=='__all') && <IconBtn icon="←" size={26} onClick={()=>goToList('__all')} />}
        <span style={{ fontWeight:700, fontSize:17, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</span>
        <span style={{ color:T.textSubtle, fontSize:12, flexShrink:0 }}>{unreadVisible} unread</span>
        <IconBtn icon="⊟" title="Mark all read" onClick={handleMarkAllRead} size={28} />
      </div>
      <FilterBar filters={filters} onChange={setFilters} feedsInView={feeds_.filter(f=>visibleArticles.some(a=>a.feedId===f.id))} showAiFilter={settings?.aiClusteringEnabled} />
      <div style={{ flex:1, overflowY:'auto', WebkitOverflowScrolling:'touch', paddingBottom:56 }}>
        {visibleArticles.length===0 && <div style={{ padding:40, textAlign:'center', color:T.textSubtle }}>Nothing here.</div>}
        {visibleArticles.map(a => (
          <ArticleRow key={a.id} article={a} feed={feeds_.find(f=>f.id===a.feedId)} isSelected={false} onClick={()=>goToArticle(a)} />
        ))}
      </div>
    </div>
  );

  // ── Screen: Article reader (inline JSX — NOT a component) ───────────────────
  const articleScreen = (
    <div className={screenAnim==='in'?'slide-in-next':''} onAnimationEnd={()=>setScreenAnim(null)} style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'10px 16px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:10, flexShrink:0, background:T.surface, paddingTop:'calc(10px + env(safe-area-inset-top))' }}>
        <IconBtn icon="←" title="Back" onClick={goBack} size={32} />
        <span style={{ flex:1, fontSize:14, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:T.text }}>{selectedArticle?.title||''}</span>
      </div>
      <ReaderPane
        article={selectedArticle}
        feed={feeds_.find(f=>f.id===selectedArticle?.feedId)}
        allArticles={visibleArticles}
        allFeeds={feeds_}
        onNavigate={(a)=>setSelectedArticle(a)}
        onMarkRead={onMarkRead}
        onToggleStar={onToggleStar}
        onOpenRules={setRulesTarget}
        onSaveRule={onSaveRules}
        settings={settings}
        isMobile
      />
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh', overflow:'hidden', background:T.bg }}>
      {screen==='article' ? articleScreen : listScreen}
      {screen!=='article' && bottomBar}
      {feedsSheet}
    </div>
  );
}


// ─── Root App ─────────────────────────────────────────────────────────────────
function LoginScreen({ onSuccess }) {
  // 'server' (Electron only, first-run: point at a hosted Flux server) →
  // 'login' / 'register' → 'totp' (only if the account has 2FA enabled).
  const [mode, setMode] = useState(api.auth.supportsRemoteConfig && !api.isRemoteHttp() ? 'server' : 'login');
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [signupOpen, setSignupOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (mode !== 'login' && mode !== 'register') return;
    api.auth.status().then(s => setSignupOpen(!!s.signupOpen)).catch(() => {});
  }, [mode]);

  const connectServer = async () => {
    if (!serverUrl.trim()) return;
    setLoading(true); setError(null);
    try {
      await api.auth.configureRemote(serverUrl.trim());
      const s = await api.auth.status();
      setSignupOpen(!!s.signupOpen);
      setMode('login');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const submitLogin = async () => {
    if (!username.trim() || !password) return;
    setLoading(true); setError(null);
    try {
      const label = navigator.userAgent.match(/Chrome|Firefox|Safari|Edge/)?.[0] || 'device';
      const r = await api.auth.login(username.trim(), password, label, mode==='totp' ? totpCode.trim() : undefined);
      if (r.requiresTotp) { setMode('totp'); return; }
      onSuccess();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const submitRegister = async () => {
    if (!username.trim() || password.length < 8) { setError('Username and a password of at least 8 characters are required.'); return; }
    setLoading(true); setError(null);
    try {
      const label = navigator.userAgent.match(/Chrome|Firefox|Safari|Edge/)?.[0] || 'device';
      await api.auth.register(username.trim(), password, label, email.trim() || undefined);
      onSuccess();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const card = { width: 340, background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:28, display:'flex', flexDirection:'column', gap:14, boxShadow:'0 8px 32px rgba(0,0,0,0.3)' };
  const title = { fontSize:18, fontWeight:700, color:T.text, marginBottom:2 };
  const sub = { fontSize:12.5, color:T.textMuted, marginBottom:4, lineHeight:1.5 };

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:T.bg }}>
      <div style={card}>
        <div style={{ fontSize:22, fontWeight:800, color:T.accent, letterSpacing:'-0.02em' }}>Flux</div>

        {mode === 'server' && (<>
          <div style={title}>Connect to a server</div>
          <div style={sub}>Point this app at a Flux server you or someone else is hosting. You can switch back to local storage later in Settings.</div>
          <input autoFocus placeholder="https://flux.example.com" value={serverUrl} onChange={e=>setServerUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&connectServer()} />
          {error && <div style={{ fontSize:12, color:T.danger }}>{error}</div>}
          <Btn variant="primary" onClick={connectServer} disabled={loading || !serverUrl.trim()}>{loading?<Spinner size={12} color="#fff"/>:null}{loading?'Connecting…':'Connect'}</Btn>
        </>)}

        {mode === 'login' && (<>
          <div style={title}>Log in</div>
          <div style={sub}>You'll stay signed in on this device until you log out.</div>
          <input autoFocus placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submitLogin()} />
          <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submitLogin()} />
          {error && <div style={{ fontSize:12, color:T.danger }}>{error}</div>}
          <Btn variant="primary" onClick={submitLogin} disabled={loading || !username.trim() || !password}>{loading?<Spinner size={12} color="#fff"/>:null}{loading?'Logging in…':'Log in'}</Btn>
          {signupOpen && <div style={{ fontSize:12, color:T.textMuted, textAlign:'center' }}>No account yet? <a href="#" onClick={e=>{e.preventDefault();setMode('register');setError(null);}} style={{ color:T.accent }}>Create one</a></div>}
          {api.auth.supportsRemoteConfig && <div style={{ fontSize:11, color:T.textSubtle, textAlign:'center' }}><a href="#" onClick={e=>{e.preventDefault();setMode('server');setError(null);}} style={{ color:T.textSubtle }}>Connect to a different server</a></div>}
        </>)}

        {mode === 'register' && (<>
          <div style={title}>Create account</div>
          <div style={sub}>{signupOpen ? 'Set a username and password to get started.' : 'Registration is currently closed on this server.'}</div>
          {signupOpen && <>
            <input autoFocus placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} />
            <input type="password" placeholder="Password (min. 8 characters)" value={password} onChange={e=>setPassword(e.target.value)} />
            <input type="email" placeholder="Email (optional)" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submitRegister()} />
            {error && <div style={{ fontSize:12, color:T.danger }}>{error}</div>}
            <Btn variant="primary" onClick={submitRegister} disabled={loading || !username.trim() || password.length<8}>{loading?<Spinner size={12} color="#fff"/>:null}{loading?'Creating…':'Create account'}</Btn>
          </>}
          <div style={{ fontSize:12, color:T.textMuted, textAlign:'center' }}>Already have an account? <a href="#" onClick={e=>{e.preventDefault();setMode('login');setError(null);}} style={{ color:T.accent }}>Log in</a></div>
        </>)}

        {mode === 'totp' && (<>
          <div style={title}>Verification code</div>
          <div style={sub}>Enter the 6-digit code from your authenticator app.</div>
          <input autoFocus inputMode="numeric" placeholder="123456" value={totpCode} onChange={e=>setTotpCode(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submitLogin()} style={{ letterSpacing:'0.3em', textAlign:'center', fontSize:18 }} />
          {error && <div style={{ fontSize:12, color:T.danger }}>{error}</div>}
          <Btn variant="primary" onClick={submitLogin} disabled={loading || totpCode.trim().length<6}>{loading?<Spinner size={12} color="#fff"/>:null}{loading?'Verifying…':'Verify'}</Btn>
          <div style={{ fontSize:12, color:T.textMuted, textAlign:'center' }}><a href="#" onClick={e=>{e.preventDefault();setMode('login');setTotpCode('');setError(null);}} style={{ color:T.textSubtle }}>Back</a></div>
        </>)}
      </div>
    </div>
  );
}

export default function App() {
  const isMobile = useIsMobile();
  // 'checking' (verifying a stored token / Electron's local-vs-remote mode),
  // 'needed' (show the login screen), 'ok' (render the real app). Electron
  // in local IPC mode never has accounts at all, so it goes straight to 'ok'.
  const [authState, setAuthState] = useState('checking');
  useEffect(() => {
    let cancelled = false;
    api.auth.onUnauthorized(() => { if (!cancelled) setAuthState('needed'); });
    (async () => {
      await api.auth.ready(); // Electron: wait for persisted remote-server config to load
      if (!api.isRemoteHttp()) { if (!cancelled) setAuthState('ok'); return; }
      if (!api.auth.isLoggedIn()) { if (!cancelled) setAuthState('needed'); return; }
      try { await api.auth.me(); if (!cancelled) setAuthState('ok'); } // confirms the stored token is still valid
      catch { if (!cancelled) setAuthState('needed'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const [feeds_,  setFeeds]    = useState([]);
  const [folders_,setFolders]  = useState([]);
  const [articles,setArticles] = useState([]);
  const articlesRef = useRef([]); // keeps current articles accessible inside refreshFeeds useCallback
  useEffect(() => { articlesRef.current = articles; }, [articles]);
  const [activeView,setActiveView] = useState('__all');
  const [selectedArticle,setSelectedArticle] = useState(null);
  const [refreshing,setRefreshing] = useState(false);
  const [articleListCollapsed,setArticleListCollapsed] = useState(false);
  const [showAddFeed,setShowAddFeed] = useState(null); // null | true | folder object
  const [rulesTarget,setRulesTarget] = useState(null);
  const [opmlResult, setOpmlResult]  = useState(null);
  const [showOPMLImport,setShowOPMLImport] = useState(false);
  const [clusterState,setClusterState] = useState(null);
  const [showSettings,setShowSettings] = useState(false);
  const [showNewFolder,setShowNewFolder] = useState(false);
  const [showDigest,setShowDigest] = useState(false);
  const [editFolderTarget, setEditFolderTarget] = useState(null);
  const [manageFolderTarget,setManageFolderTarget] = useState(null);
  const [addToFolderTarget,setAddToFolderTarget] = useState(null);
  const [settings,setSettings] = useState({ aiClusteringEnabled:false, sponsorBlockEnabled:true, ollamaUrl:'', ollamaModel:'' });
  const [filtersByView,setFiltersByView] = useState({});

  const filters = filtersByView[activeView] || DEFAULT_FILTERS;
  const setFilters = (f) => setFiltersByView(prev=>({ ...prev, [activeView]: f }));


  const refreshFeeds = useCallback(async(feedList, state, settingsOverride)=>{
    const cfg = settingsOverride || settings;
    setRefreshing(true);
    const readSet  = new Set(state?.read    || []);
    const starSet  = new Set(state?.starred || []);

    try {
      if (api.isElectron) {
        // ── Streaming path (Electron) ─────────────────────────────────────
        // Seed from current articles so the list doesn't go empty while
        // fetching — articles appear immediately, updated as feeds complete.
        // This also preserves in-memory read/starred state across refreshes.
        let accumulated = [...articlesRef.current]; // seed from current so list doesn't go empty

        // Precompute a timestamp-keyed sorted array by converting dates once
        // instead of on every sort comparison (Date constructor is expensive).
        const mergeInto = (existing, incoming) => {
          // Merge + deduplicate by article id, preserving read/starred state
          // from whichever copy is more "read". The incoming copy has state
          // from the DB (readSet), but if the user marked it read in this
          // session, the existing copy in React state has isRead:true even
          // if the DB write hasn't settled yet. Take the union (true if either).
          const map = new Map(existing.map(a => [a.id, a]));
          for (const a of incoming) {
            const prev = map.get(a.id);
            map.set(a.id, prev ? {
              ...a,
              isRead:    prev.isRead    || a.isRead,
              isStarred: prev.isStarred || a.isStarred,
            } : a);
          }
          const arr = Array.from(map.values());
          arr.sort((a, b) => (b._dateMs || 0) - (a._dateMs || 0));
          return arr;
        };

        const unsub = api.feeds.onStreamResult((data) => {
          if (data.type === 'avatarUpdate') {
            // Background avatar upgrade — update feed favicon without re-sorting articles
            setFeeds(prev => prev.map(f => f.id === data.feedId ? { ...f, favicon: data.favicon } : f));
            return;
          }
          if (!data.ok || !data.items?.length) return;

          const newItems = data.items.map(item => ({
            ...item,
            _dateMs:   item.date ? new Date(item.date).getTime() : 0,
            isRead:    readSet.has(`${item.feedId}:${item.id}`),
            isStarred: starSet.has(`${item.feedId}:${item.id}`),
          }));

          accumulated = mergeInto(accumulated, newItems);
          setArticles([...accumulated]); // new array ref so React re-renders

          // Only update favicon in memory if the feed doesn't already have
          // one persisted — prevents a generic Google favicon placeholder
          // from overwriting a YouTube channel avatar that's already stored.
          if (data.favicon) {
            setFeeds(prev => prev.map(f => {
              if (f.id !== data.feedId) return f;
              if (f.favicon) return f; // already has a favicon — keep it
              api.feeds.updateRules({ feedId: f.id, favicon: data.favicon }).catch(()=>{});
              return { ...f, favicon: data.favicon };
            }));
          }
        });

        // Now kick off the stream — results flow back via the event above
        await api.feeds.fetchStream();
        unsub(); // clean up listener

        // Final dedup pass in case of any last stragglers
        setArticles(prev => {
          const map = new Map(prev.map(a => [a.id, a]));
          const arr = Array.from(map.values());
          arr.sort((a, b) => (b._dateMs || 0) - (a._dateMs || 0));
          return arr;
        });

      } else {
        // ── Batch path (web server) ───────────────────────────────────────
        const results = await api.feeds.fetchAll();

        const faviconUpdates = results.filter(r => r.ok && r.favicon);
        if (faviconUpdates.length) {
          setFeeds(prev => prev.map(f => {
            const hit = faviconUpdates.find(r => r.feedId === f.id);
            if (!hit || f.favicon === hit.favicon) return f;
            api.feeds.updateRules({ feedId: f.id, favicon: hit.favicon }).catch(()=>{});
            return { ...f, favicon: hit.favicon };
          }));
        }

        const allItems = results.filter(r => r.ok).flatMap(r => (r.items || []).map(item => ({
          ...item,
          _dateMs:   item.date ? new Date(item.date).getTime() : 0,
          isRead:    readSet.has(`${item.feedId}:${item.id}`),
          isStarred: starSet.has(`${item.feedId}:${item.id}`),
        })));
        allItems.sort((a, b) => (b._dateMs || 0) - (a._dateMs || 0));
        setArticles(allItems);
      }

      // AI clustering — opt-in only, runs after articles are visible
      if (cfg.aiClusteringEnabled) {
        setClusterState('loading');
        try {
          setArticles(prev => {
            api.ollama.cluster({ articles: prev, ollamaUrl: cfg.ollamaUrl||undefined, model: cfg.ollamaModel||undefined, maxDaysApart: cfg.clusterMaxDaysApart ?? 3, excludeSameSource: cfg.clusterExcludeSameSource !== false })
              .then(clustered => { setArticles(clustered); setClusterState('done'); setTimeout(()=>setClusterState(null),3000); })
              .catch(() => setClusterState(null));
            return prev; // keep showing articles while clustering runs
          });
        } catch { setClusterState(null); }
      }

    } finally { setRefreshing(false); }
  },[settings]);

  useEffect(()=>{
    if (authState !== 'ok') return;
    Promise.all([api.feeds.list(), api.folders.list(), api.articles.getState(), api.settings.get()])
      .then(([f,fo,state,s])=>{
        setFeeds(f); setFolders(fo);
        const merged = { aiClusteringEnabled:false, sponsorBlockEnabled:true, ollamaAutoStart:false, ollamaUrl:'', ollamaModel:'', ...(s||{}) };
        setSettings(merged);
        if(f.length>0) refreshFeeds(f,state,merged);
      });
  },[authState]);

  const [newArticleCount, setNewArticleCount] = useState(0);

  const handleRefreshAll = async()=>{
    setNewArticleCount(0);
    const state=await api.articles.getState();
    refreshFeeds(feeds_,state);
  };

  // Auto-refresh: poll for new articles at the configured interval.
  // Uses a ref so the interval doesn't restart every time settings change —
  // only when the interval value itself changes.
  const autoRefreshRef = useRef(null);
  useEffect(()=>{
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    const mins = settings.refreshIntervalMinutes ?? 30;
    if (!mins || mins < 1 || feeds_.length === 0) return;
    autoRefreshRef.current = setInterval(async ()=>{
      const prevCount = articles.length;
      const state = await api.articles.getState();
      await refreshFeeds(feeds_, state);
      // Brief delay so refreshFeeds has settled
      setTimeout(()=>{
        setArticles(curr => {
          const diff = curr.length - prevCount;
          if (diff > 0) setNewArticleCount(n => n + diff);
          return curr;
        });
      }, 500);
    }, mins * 60 * 1000);
    return () => clearInterval(autoRefreshRef.current);
  },[settings.refreshIntervalMinutes, feeds_.length]);

  const handleAddFeed = async(config)=>{
    const newFeed = await api.feeds.add(config);
    const updated = [...feeds_, newFeed];
    setFeeds(updated);
    setRefreshing(true);
    try {
      const r = await api.feeds.fetchOne(newFeed.id);
      if (r?.items) {
        const state = await api.articles.getState();
        const readSet=new Set(state.read), starSet=new Set(state.starred);
        const newItems=r.items.map(item=>({...item, _dateMs: item.date ? new Date(item.date).getTime() : 0, isRead:readSet.has(`${item.feedId}:${item.id}`), isStarred:starSet.has(`${item.feedId}:${item.id}`)}));
        setArticles(prev=>[...newItems,...prev].sort((a,b)=>(b._dateMs||0)-(a._dateMs||0)));
      }
      // Persist favicon so it survives app restarts without needing a full refresh
      if (r?.favicon) {
        await api.feeds.updateRules({ feedId: newFeed.id, favicon: r.favicon });
        setFeeds(prev=>prev.map(f=>f.id===newFeed.id ? { ...f, favicon: r.favicon } : f));
      }
    } finally { setRefreshing(false); }
  };

  const handleRemoveFeed = async(feedId)=>{
    await api.feeds.remove(feedId);
    setFeeds(prev=>prev.filter(f=>f.id!==feedId));
    setArticles(prev=>prev.filter(a=>a.feedId!==feedId));
    if (activeView===`feed:${feedId}`) setActiveView('__all');
    if (selectedArticle?.feedId===feedId) setSelectedArticle(null);
  };

  const handleAddFolder = async({name,icon})=>{
    const folder = await api.folders.add({name,icon});
    setFolders(prev=>[...prev,folder]);
  };

  const handleRemoveFolder = async(folderId)=>{
    await api.folders.remove(folderId);
    setFolders(prev=>prev.filter(f=>f.id!==folderId));
    // Mirror the backend: feeds in the deleted folder become unfiled
    setFeeds(prev=>prev.map(f=>f.folder===folderId?{...f,folder:null}:f));
    if (activeView===`folder:${folderId}`) setActiveView('__all');
  };

  const handleReorderFolders = async(orderedIds)=>{
    // Optimistic reorder — reflect the new order immediately, persist after
    setFolders(prev => orderedIds.map(id => prev.find(f=>f.id===id)).filter(Boolean));
    try { await api.folders.reorder(orderedIds); }
    catch (e) { console.warn('Failed to persist folder order:', e); }
  };

  const handleEditFolder = async({ folderId, name, icon })=>{
    const updated = await api.folders.update({ folderId, name, icon });
    setFolders(prev=>prev.map(f=>f.id===folderId?{...f,name:updated.name,icon:updated.icon}:f));
  };

  const handleAssignFeedFolder = async(feedId, folderId)=>{
    await api.feeds.updateRules({ feedId, folder: folderId });
    setFeeds(prev=>prev.map(f=>f.id===feedId?{...f,folder:folderId}:f));
  };

  const handleMarkRead = useCallback(async(articleId, feedId)=>{
    setArticles(prev=>prev.map(a=>a.id===articleId?{...a,isRead:true}:a));
    await api.articles.markRead({articleId, feedId});
  },[]);
  const handleToggleStar  = useCallback(async(articleId, feedId, starred)=>{
    setArticles(prev=>prev.map(a=>a.id===articleId?{...a,isStarred:starred}:a));
    await api.articles.toggleStar({articleId, feedId, starred});
  },[]);
  const handleSaveRules   = async(rules)=>{
    await api.feeds.updateRules(rules);
    setFeeds(prev=>prev.map(f=>f.id===rules.feedId?{...f,...rules}:f));
  };
  const handleSaveSettings = async(next)=>{
    await api.settings.set(next);
    setSettings(next);
    // If AI clustering was just turned off, drop any existing cluster tags
    // and the indicator immediately rather than waiting for next refresh.
    if (!next.aiClusteringEnabled) {
      setArticles(prev=>prev.map(a=>({ ...a, clusterId:null, clusterSize:null })));
      setClusterState(null);
    }
  };
  const handleExportOPML  = async()=>{ const r=await api.opml.export(); if(!r.canceled) setOpmlResult({mode:'export',result:r}); };
  const handleImportOPML  = async()=>{
    if (api.isElectron) {
      const r=await api.opml.import();
      if (!r.canceled) { setOpmlResult({mode:'import',result:r}); if(r.imported>0){const [f,fo,state]=await Promise.all([api.feeds.list(),api.folders.list(),api.articles.getState()]);setFeeds(f);setFolders(fo);await refreshFeeds(f,state);} }
    } else { setShowOPMLImport(true); }
  };

  const visibleArticles = useMemo(()=>{
    let result;
    if (activeView==='__all')     result = articles;
    else if (activeView==='__unread')  result = articles.filter(a=>!a.isRead);
    else if (activeView==='__starred') result = articles.filter(a=>a.isStarred);
    else if (activeView.startsWith('feed:'))   result = articles.filter(a=>a.feedId===activeView.slice(5));
    else if (activeView.startsWith('folder:')){ const fid=activeView.slice(7); result = articles.filter(a=>feeds_.find(f=>f.id===a.feedId)?.folder===fid); }
    else result = articles;

    // Per-feed "hide shorts" and title-blocklist filtering — applied
    // regardless of other view/status filters, since these represent
    // "never show me this" rather than a temporary view toggle.
    result = result.filter(a=>{
      const feed = feeds_.find(f=>f.id===a.feedId);
      if (feed?.hideShorts && a.isShort) return false;
      if (feed?.titleBlocklist?.length) {
        for (const pattern of feed.titleBlocklist) {
          try { if (new RegExp(pattern, 'i').test(a.title)) return false; }
          catch { /* invalid regex in the blocklist — ignore rather than crash filtering */ }
        }
      }
      return true;
    });

    // Folder/view-local filters (source, read status, AI grouping)
    if (filters.source !== 'all') result = result.filter(a=>a.feedId===filters.source);
    if (filters.status === 'unread')  result = result.filter(a=>!a.isRead);
    else if (filters.status === 'read')    result = result.filter(a=>a.isRead);
    else if (filters.status === 'starred') result = result.filter(a=>a.isStarred);
    if (settings.aiClusteringEnabled) {
      if (filters.ai === 'grouped')   result = result.filter(a=>!!a.clusterId);
      if (filters.ai === 'ungrouped') result = result.filter(a=>!a.clusterId);
    }

    return result;
  },[articles,activeView,feeds_,filters,settings.aiClusteringEnabled]);

  // Base-filtered for counts (no view/status filter, just content filters)
  const baseFilteredArticles = useMemo(()=>articles.filter(a=>{
    const feed=feeds_.find(f=>f.id===a.feedId);
    if (feed?.hideShorts&&a.isShort) return false;
    if (feed?.titleBlocklist?.length) for (const p of feed.titleBlocklist) { try { if(new RegExp(p,'i').test(a.title)) return false; } catch {} }
    return true;
  }),[articles,feeds_]);

  // Marks only the articles currently visible (respecting whatever
  // folder/feed/filter view is active) as read — not every article in the
  // whole app. Previously this ignored the active view entirely, so
  // clicking "mark all read" while inside a single folder would mark
  // every article everywhere as read, which is surprising and was the
  // reported bug. Also now actually persists each read-state change
  // (previously this only touched local React state, so it didn't survive
  // a refresh).
  const handleMarkAllRead = useCallback(async()=>{
    const idsToMark = visibleArticles.filter(a=>!a.isRead).map(a=>({id:a.id, feedId:a.feedId}));
    if (!idsToMark.length) return;
    const idSet = new Set(idsToMark.map(x=>x.id));
    setArticles(prev=>prev.map(a=>idSet.has(a.id)?{...a,isRead:true}:a));
    // Fire all persistence calls in parallel — these are independent
    // per-article writes, no need to serialize them.
    await Promise.all(idsToMark.map(({id,feedId})=>api.articles.markRead({articleId:id, feedId}).catch(e=>console.warn('Failed to persist read state for', id, e))));
  },[visibleArticles]);

  if (authState === 'checking') {
    return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:T.bg, color:T.textSubtle, fontSize:13 }}>
      <style>{GLOBAL_CSS}</style>
      <Spinner size={18}/>
    </div>;
  }
  if (authState === 'needed') {
    return <>
      <style>{GLOBAL_CSS}</style>
      <LoginScreen onSuccess={()=>setAuthState('ok')} />
    </>;
  }

  if (isMobile) return <>
    <style>{GLOBAL_CSS}</style>
    <MobileLayout
      feeds_={feeds_} folders_={folders_} articles={articles} visibleArticles={visibleArticles}
      activeView={activeView} setActiveView={setActiveView}
      selectedArticle={selectedArticle} setSelectedArticle={setSelectedArticle}
      handleRefreshAll={handleRefreshAll} refreshing={refreshing} settings={settings}
      handleSaveSettings={handleSaveSettings}
      onMarkRead={handleMarkRead} onToggleStar={handleToggleStar}
      onSaveRules={handleSaveRules} onOpenRules={setRulesTarget} setRulesTarget={setRulesTarget}
      setShowSettings={setShowSettings}
      setShowAddFeed={setShowAddFeed} setAddToFolderTarget={setAddToFolderTarget}
      setShowNewFolder={setShowNewFolder} setEditFolderTarget={setEditFolderTarget}
      handleMarkAllRead={handleMarkAllRead} filters={filters} setFilters={setFilters}
      handleRemoveFeed={handleRemoveFeed} handleRemoveFolder={handleRemoveFolder}
      handleAssignFeedFolder={handleAssignFeedFolder} setManageFolderTarget={setManageFolderTarget}
      setShowOPMLImport={setShowOPMLImport} handleExportOPML={handleExportOPML} handleImportOPML={handleImportOPML}
      baseFilteredArticles={baseFilteredArticles}
    />
    {showSettings&&<SettingsModal settings={settings} onSave={handleSaveSettings} onClose={()=>setShowSettings(false)} />}
    {showAddFeed&&<AddFeedModal folders={folders_} preselectedFolder={typeof showAddFeed==='object'?showAddFeed.id:null} onAdd={handleAddFeed} onClose={()=>setShowAddFeed(null)} />}
    {addToFolderTarget&&<AddToFolderModal folder={addToFolderTarget} feeds={feeds_} folders={folders_} onAssignExisting={handleAssignFeedFolder} onAddNew={handleAddFeed} onClose={()=>setAddToFolderTarget(null)} />}
    {showNewFolder&&<NewFolderModal onAdd={handleAddFolder} onClose={()=>setShowNewFolder(false)} />}
    {editFolderTarget&&<EditFolderModal folder={editFolderTarget} onSave={handleEditFolder} onClose={()=>setEditFolderTarget(null)} />}
    {rulesTarget&&<FeedRulesModal feed={rulesTarget} folders={folders_} onSave={handleSaveRules} onClose={()=>setRulesTarget(null)} />}
  </>;

  return <>
    <style>{GLOBAL_CSS}</style>
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <Sidebar folders={folders_} feeds={feeds_} articles={articles} activeView={activeView} onSelectView={(v)=>{ setActiveView(v); setArticleListCollapsed(false); }} onOpenAddFeed={(folder)=>setShowAddFeed(folder&&folder.id?folder:true)} onAddToFolder={(folder)=>setAddToFolderTarget(folder)} onRefreshAll={handleRefreshAll} refreshing={refreshing} onExportOPML={handleExportOPML} onImportOPML={handleImportOPML} onNewFolder={()=>setShowNewFolder(true)} onOpenSettings={()=>setShowSettings(true)} onFeedSettings={setRulesTarget} onRemoveFeed={handleRemoveFeed} onRemoveFolder={handleRemoveFolder} onManageFolderFeeds={setManageFolderTarget} newArticleCount={newArticleCount} settings={settings} onReorderFolders={handleReorderFolders} onEditFolder={setEditFolderTarget} />
      <ArticleList articles={visibleArticles} activeView={activeView} feeds={feeds_} folders={folders_} onSelect={setSelectedArticle} selectedId={selectedArticle?.id} onMarkAllRead={handleMarkAllRead} filters={filters} onFiltersChange={setFilters} showAiFilter={settings.aiClusteringEnabled} onOpenFeedSettings={setRulesTarget} collapsed={articleListCollapsed} onToggleCollapse={setArticleListCollapsed} deArrowEnabled={!!settings.deArrowEnabled} />
      <ReaderPane article={selectedArticle} feed={feeds_.find(f=>f.id===selectedArticle?.feedId)} allArticles={visibleArticles} allFeeds={feeds_} onNavigate={setSelectedArticle} onMarkRead={handleMarkRead} onToggleStar={handleToggleStar} onOpenRules={setRulesTarget} onSaveRule={handleSaveRules} settings={settings} />
    </div>

    {refreshing&&<div style={{ position:'fixed', bottom:16, right:16, background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:'8px 12px', display:'flex', alignItems:'center', gap:8, fontSize:12, color:T.textMuted, boxShadow:'0 4px 16px rgba(0,0,0,.3)', zIndex:50 }}><Spinner size={12}/>Fetching feeds…</div>}
    {settings.aiClusteringEnabled && <ClusteringIndicator state={clusterState} />}

    {showAddFeed&&<AddFeedModal folders={folders_} preselectedFolder={typeof showAddFeed==='object'?showAddFeed.id:null} onAdd={handleAddFeed} onClose={()=>setShowAddFeed(null)} />}
    {rulesTarget&&<FeedRulesModal feed={rulesTarget} folders={folders_} onSave={handleSaveRules} onClose={()=>setRulesTarget(null)} />}
    {opmlResult&&<OPMLResultModal mode={opmlResult.mode} result={opmlResult.result} onClose={()=>setOpmlResult(null)} />}
    {showOPMLImport&&<OPMLImportModal onClose={()=>setShowOPMLImport(false)} onResult={async(r)=>{ setOpmlResult({mode:'import',result:r}); if(r.imported>0){const [f,fo,state]=await Promise.all([api.feeds.list(),api.folders.list(),api.articles.getState()]);setFeeds(f);setFolders(fo);await refreshFeeds(f,state);} }} />}
    {showSettings&&<SettingsModal settings={settings} onSave={handleSaveSettings} onClose={()=>setShowSettings(false)} />}
    {showNewFolder&&<NewFolderModal onAdd={handleAddFolder} onClose={()=>setShowNewFolder(false)} />}
    {editFolderTarget&&<EditFolderModal folder={editFolderTarget} onSave={handleEditFolder} onClose={()=>setEditFolderTarget(null)} />}
    {manageFolderTarget&&<ManageFolderFeedsModal folder={manageFolderTarget} feeds={feeds_} onAssign={handleAssignFeedFolder} onClose={()=>setManageFolderTarget(null)} />}
    {addToFolderTarget&&<AddToFolderModal folder={addToFolderTarget} feeds={feeds_} folders={folders_} onAssignExisting={handleAssignFeedFolder} onAddNew={handleAddFeed} onClose={()=>setAddToFolderTarget(null)} />}
  </>;
}
