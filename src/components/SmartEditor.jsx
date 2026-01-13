import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { useGesture, useDrag } from '@use-gesture/react';
import * as THREE from 'three';
import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';
import '../shaders/SkinShader'; 

// --- ÍCONES ---
const ICONS = { eraser: "🧹", move: "👆", upload: "📷", save: "⬇️", debug: "👁️", light: "☀️", layer: "🎨", close: "✕" };

// --- PRESETS ---
const STYLES = {
  fresh: { label: "✨ Vibrante", opacity: 0.98, skinDetail: 0.10, grain: 0.03, inkColor: '#ffffff' },
  healed: { label: "🌿 Realista", opacity: 0.92, skinDetail: 0.35, grain: 0.06, inkColor: '#f0f0f0' },
  aged: { label: "⏳ Desbotada", opacity: 0.80, skinDetail: 0.55, grain: 0.12, inkColor: '#e0e0e0' },
  bw: { label: "⚫ Blackwork", opacity: 0.92, skinDetail: 0.30, grain: 0.08, inkColor: '#1a1a1a' }
};

const MAX_AI_RESOLUTION = 1024;

// --- CSS GLOBAL ---
const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
  body { margin: 0; background: #000; font-family: 'Inter', sans-serif; overflow: hidden; position: fixed; inset: 0; }
  
  /* Scroll e Sliders */
  ::-webkit-scrollbar { width: 0px; background: transparent; }
  .scroll-container { -webkit-overflow-scrolling: touch; }
  
  /* Input Range Customizado */
  input[type=range] { -webkit-appearance: none; width: 100%; background: transparent; height: 30px; cursor: pointer; touch-action: pan-x; } /* touch-action: pan-x permite deslizar o slider */
  input[type=range]:focus { outline: none; }
  input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; }
  input[type=range]::-webkit-slider-thumb { height: 20px; width: 20px; border-radius: 50%; background: #00ff00; margin-top: -7px; box-shadow: 0 0 10px rgba(0,255,0,0.5); -webkit-appearance: none; }
  
  .fade-in { animation: fadeIn 0.3s ease-out; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
`;

const useBodySegmentation = (imageSrc) => {
  const [maskCanvas, setMaskCanvas] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Iniciando...");
  useEffect(() => {
    let active = true;
    const processImage = async () => {
      try {
        if (!active) return;
        setProgress(10); setStatus("Carregando IA...");
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        if(!active) return;
        const segmenter = await ImageSegmenter.createFromOptions(vision, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite", delegate: "CPU" }, runningMode: "IMAGE", outputCategoryMask: false, outputConfidenceMasks: true });
        setProgress(40); setStatus("Processando...");
        const img = new Image(); img.crossOrigin = "anonymous"; img.src = imageSrc;
        img.onload = () => {
            if (!active) return;
            const scale = Math.min(1, MAX_AI_RESOLUTION / Math.max(img.width, img.height));
            const w = Math.floor(img.width * scale); const h = Math.floor(img.height * scale);
            const tempCanvas = document.createElement('canvas'); tempCanvas.width = w; tempCanvas.height = h;
            tempCanvas.getContext('2d').drawImage(img, 0, 0, w, h);
            setTimeout(() => {
                try {
                    const result = segmenter.segment(tempCanvas); const masks = result.confidenceMasks;
                    if (!masks) throw new Error("Sem corpo");
                    const maskFloat = masks[1] ? masks[1].getAsFloat32Array() : masks[0].getAsFloat32Array();
                    const maskCanvas = document.createElement("canvas"); maskCanvas.width = w; maskCanvas.height = h;
                    const ctx = maskCanvas.getContext("2d"); const imageData = ctx.createImageData(w, h);
                    for (let i = 0; i < maskFloat.length; i++) { const val = maskFloat[i] > 0.2 ? 255 : 0; imageData.data[i * 4] = val; imageData.data[i * 4 + 1] = val; imageData.data[i * 4 + 2] = val; imageData.data[i * 4 + 3] = 255; }
                    ctx.putImageData(imageData, 0, 0);
                    if (active) { setMaskCanvas(maskCanvas); setProgress(100); }
                } catch (err) { console.error(err); const fallback = document.createElement("canvas"); fallback.width = w; fallback.height = h; fallback.getContext("2d").fillStyle = "white"; fallback.getContext("2d").fillRect(0,0,w,h); setMaskCanvas(fallback); }
            }, 50);
        };
      } catch (error) { console.error(error); setStatus("Erro"); }
    };
    processImage(); return () => { active = false; };
  }, [imageSrc]);
  return { maskCanvas, progress, status };
};

const TattooScene = ({ image, mask, imageTattoo, eraserTexture, lightAngle, pos, scale, rot, currentStyle, cylindrical, debugMode }) => {
  const shaderRef = useRef();
  const { viewport } = useThree();
  const baseTexture = useTexture(image);
  const emptyTex = useMemo(() => new THREE.Texture(), []);
  const tattooTexture = useTexture(imageTattoo || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');
  useEffect(() => { if (tattooTexture) { tattooTexture.wrapS = tattooTexture.wrapT = THREE.ClampToEdgeWrapping; tattooTexture.minFilter = THREE.LinearFilter; } }, [tattooTexture]);
  const maskTexture = useMemo(() => { if (!mask) return new THREE.Texture(); const tex = new THREE.CanvasTexture(mask); tex.flipY = true; return tex; }, [mask]);
  const lightDirVector = useMemo(() => { const rad = lightAngle * (Math.PI / 180); return new THREE.Vector2(Math.sin(rad), Math.cos(rad)); }, [lightAngle]);
  const imgWidth = baseTexture.image?.width || 1; const imgHeight = baseTexture.image?.height || 1; const planeAspect = imgWidth / imgHeight;
  let width = viewport.width; let height = viewport.width / planeAspect; if (height > viewport.height) { height = viewport.height; width = viewport.height * planeAspect; }
  const uniforms = useMemo(() => ({ uTattooPos: new THREE.Vector2(), uTattooScale: new THREE.Vector2(), uInkColor: new THREE.Color(), uLightDir: new THREE.Vector2() }), []);
  useFrame(() => {
    if (shaderRef.current) {
      uniforms.uTattooPos.set(pos.x, pos.y); uniforms.uTattooScale.set(scale, scale); uniforms.uInkColor.set(currentStyle.inkColor); uniforms.uLightDir.copy(lightDirVector);
      shaderRef.current.uBaseTexture = baseTexture; shaderRef.current.uTattooTexture = imageTattoo ? tattooTexture : emptyTex;
      shaderRef.current.uMaskTexture = maskTexture; shaderRef.current.uEraserTexture = eraserTexture || emptyTex;
      shaderRef.current.uTattooPos = uniforms.uTattooPos; shaderRef.current.uTattooScale = uniforms.uTattooScale; shaderRef.current.uInkColor = uniforms.uInkColor; shaderRef.current.uLightDir = uniforms.uLightDir;
      shaderRef.current.uRotation = rot; shaderRef.current.uOpacity = currentStyle.opacity; shaderRef.current.uGrain = currentStyle.grain; shaderRef.current.uSkinDetail = currentStyle.skinDetail; shaderRef.current.uCylindrical = cylindrical; shaderRef.current.uDebugMode = debugMode; shaderRef.current.uOutputOnlyTattoo = 0;
    }
  });
  return ( <mesh> <planeGeometry args={[width, height]} /> <skinShaderMaterial ref={shaderRef} transparent={true} depthTest={false} depthWrite={false} /> </mesh> );
};

const SmartEditor = ({ imageSrc }) => {
  const [bgImage, setBgImage] = useState(imageSrc);
  const { maskCanvas, progress, status } = useBodySegmentation(bgImage);
  const [isSaving, setIsSaving] = useState(false);
  const [tattooSrc, setTattooSrc] = useState(null);
  const tattooInputRef = useRef(null);
  const bgInputRef = useRef(null);

  const [activeTab, setActiveTab] = useState('styles'); 
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const [scale, setScale] = useState(0.3);
  const [rot, setRot] = useState(0);
  const [selectedStyle, setSelectedStyle] = useState('fresh');
  const [cylindrical, setCylindrical] = useState(0.3);
  const [debugMode, setDebugMode] = useState(0);
  const [brushSize, setBrushSize] = useState(40);
  const [lightAngle, setLightAngle] = useState(0);

  // --- MENU DRAWER ---
  const SNAP_POINTS = [10, 30, 50, 75, 95];
  const [drawerHeight, setDrawerHeight] = useState(30); 
  const [isDragging, setIsDragging] = useState(false);

  const eraserCanvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const eraserTextureRef = useRef(new THREE.Texture());

  useEffect(() => {
    if (maskCanvas && eraserCanvasRef.current) {
        eraserCanvasRef.current.width = maskCanvas.width; eraserCanvasRef.current.height = maskCanvas.height;
        const ctx = eraserCanvasRef.current.getContext('2d'); ctx.clearRect(0,0,maskCanvas.width, maskCanvas.height);
        eraserTextureRef.current.image = eraserCanvasRef.current; eraserTextureRef.current.needsUpdate = true;
    }
  }, [maskCanvas]);

  const stopPropagation = (e) => { e.stopPropagation(); };

  const bindDrawer = useDrag(({ movement: [, my], down, memo = drawerHeight }) => {
    const movementVh = (my / window.innerHeight) * 100;
    const newHeight = memo - movementVh;
    const clamped = Math.min(95, Math.max(10, newHeight));

    if (down) {
      setIsDragging(true);
      setDrawerHeight(clamped);
      return memo;
    } else {
      setIsDragging(false);
      const closest = SNAP_POINTS.reduce((prev, curr) => 
        Math.abs(curr - clamped) < Math.abs(prev - clamped) ? curr : prev
      );
      setDrawerHeight(closest);
    }
  }, { pointer: { touch: true }, preventDefault: true });

  const getCoords = (e) => { const cvs = eraserCanvasRef.current; const r = cvs.getBoundingClientRect(); const cx = e.touches ? e.touches[0].clientX : e.clientX; const cy = e.touches ? e.touches[0].clientY : e.clientY; return { x: (cx - r.left) * (cvs.width / r.width), y: (cy - r.top) * (cvs.height / r.height) }; };
  const startDraw = useCallback((e) => { if(activeTab !== 'eraser') return; e.preventDefault(); isDrawingRef.current = true; const ctx = eraserCanvasRef.current.getContext('2d'); const {x,y} = getCoords(e); ctx.beginPath(); ctx.moveTo(x,y); ctx.fillStyle='white'; ctx.beginPath(); ctx.arc(x,y,brushSize/2,0,Math.PI*2); ctx.fill(); eraserTextureRef.current.needsUpdate = true; }, [activeTab, brushSize]);
  const doDraw = useCallback((e) => { if(activeTab !== 'eraser' || !isDrawingRef.current) return; e.preventDefault(); const ctx = eraserCanvasRef.current.getContext('2d'); const {x,y} = getCoords(e); ctx.lineTo(x,y); ctx.strokeStyle='white'; ctx.lineWidth=brushSize; ctx.lineCap='round'; ctx.stroke(); eraserTextureRef.current.needsUpdate = true; }, [activeTab, brushSize]);
  const stopDraw = useCallback(() => isDrawingRef.current = false, []);
  const clearEraser = () => { const ctx = eraserCanvasRef.current.getContext('2d'); ctx.clearRect(0,0,eraserCanvasRef.current.width,eraserCanvasRef.current.height); eraserTextureRef.current.needsUpdate = true; };

  const bindCanvas = useGesture({
    onDrag: ({ delta: [dx, dy] }) => { if (activeTab === 'eraser') return; setPos(p => ({ x: Math.max(0, Math.min(1, p.x + dx*0.0015)), y: Math.max(0, Math.min(1, p.y - dy*0.0015)) })); },
    onPinch: ({ offset: [d, a] }) => { if (activeTab === 'eraser') return; const s = d/50; if(s>0.05 && s<2.0) setScale(s); setRot(a); },
    onWheel: ({ delta: [, dy], ctrlKey }) => { if (activeTab === 'eraser') return; if(ctrlKey) setRot(p=>p+dy*0.01); else setScale(p=>Math.max(0.05, Math.min(1.5, p-dy*0.001))); }
  }, { eventOptions: { passive: false }, pinch: { scaleBounds: {min:0.1, max:2}, rubberband: true }, enabled: activeTab !== 'eraser' });

  const handleTattooUpload = (e) => { const f = e.target.files[0]; if(f) { setTattooSrc(URL.createObjectURL(f)); setPos({x:0.5,y:0.5}); setScale(0.3); clearEraser(); } };
  const handleBgUpload = (e) => { const f = e.target.files[0]; if(f) { setBgImage(URL.createObjectURL(f)); clearEraser(); } };
  const handleSave = useCallback(() => { if(isSaving) return; setIsSaving(true); requestAnimationFrame(() => setTimeout(() => { try { const c = document.querySelector('canvas[data-engine^="three"]'); const a = document.createElement('a'); a.download = `ink_pro_${Date.now()}.jpg`; a.href = c.toDataURL('image/jpeg', 0.95); a.click(); } catch(e){console.error(e);} finally { setIsSaving(false); } }, 100)); }, [isSaving]);

  return (
    <div style={{ width: '100%', height: '100dvh', background: '#000', display: 'flex', flexDirection: 'column', position: 'fixed', inset: 0 }}>
      <style>{GLOBAL_STYLES}</style>
      <input type="file" ref={tattooInputRef} onChange={handleTattooUpload} accept="image/png, image/jpeg, image/webp" style={{ display: 'none' }} />
      <input type="file" ref={bgInputRef} onChange={handleBgUpload} accept="image/*" style={{ display: 'none' }} />

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '15px 20px', zIndex: 100, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)', pointerEvents: 'none', transition: 'opacity 0.3s', opacity: drawerHeight > 70 ? 0 : 1 }}>
                {/* NOME*/}
          <div style={{color: '#fff', fontWeight: '800', fontSize: '18px', letterSpacing: '-0.5px'}}><span style={{color:'#00ff00'}}></span></div>
          <div style={{display:'flex', gap:'12px', pointerEvents: 'auto'}}>
             <button onClick={() => bgInputRef.current.click()} style={btnHeader} title="Trocar Foto">{ICONS.upload}</button>
             <button onClick={() => tattooInputRef.current.click()} style={btnHeader} title="Trocar Tatuagem">{ICONS.layer}</button>
             <button onClick={handleSave} style={{...btnHeader, background: '#00ff00', color: '#000'}}>{isSaving ? "..." : ICONS.save}</button>
          </div>
      </div>

      <div {...bindCanvas()} style={{ flex: 1, position: 'relative', overflow: 'hidden', touchAction: 'none' }}>
        {progress < 100 && ( <div style={{position:'absolute', inset:0, background:'#000', zIndex:200, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center'}}> <div style={{color:'#00ff00', fontWeight:'bold', marginBottom:10}}>{status}</div> <div style={{width:200, height:4, background:'#333', borderRadius:2}}><div style={{width:`${progress}%`, height:'100%', background:'#00ff00', transition:'width 0.2s'}}/></div> </div> )}
        {!tattooSrc && maskCanvas && progress === 100 && ( <div onClick={() => tattooInputRef.current.click()} style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:10, background:'rgba(0,0,0,0.4)', backdropFilter:'blur(2px)'}}> <div style={{textAlign:'center', color:'white', padding: 20, border: '1px dashed rgba(255,255,255,0.3)', borderRadius: 12}}> <div style={{fontSize: 40, marginBottom: 10}}>📂</div> <div style={{fontWeight:'bold'}}>Adicionar Tatuagem</div> </div> </div> )}
        {maskCanvas && ( <Canvas gl={{ preserveDrawingBuffer: true, antialias: true, pixelRatio: Math.min(window.devicePixelRatio, 2) }}> <React.Suspense fallback={null}> <TattooScene image={bgImage} mask={maskCanvas} imageTattoo={tattooSrc} eraserTexture={eraserTextureRef.current} lightAngle={lightAngle} pos={pos} scale={scale} rot={rot} currentStyle={STYLES[selectedStyle]} cylindrical={cylindrical} debugMode={debugMode} /> </React.Suspense> </Canvas> )}
        <canvas ref={eraserCanvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', touchAction: 'none', opacity: 0, pointerEvents: activeTab === 'eraser' ? 'auto' : 'none' }} onPointerDown={startDraw} onPointerMove={doDraw} onPointerUp={stopDraw} onPointerLeave={stopDraw} />
      </div>

      {/* DRAWER */}
      <div 
        style={{ 
            background: 'rgba(20, 20, 20, 0.96)', backdropFilter: 'blur(15px)', 
            borderTop: '1px solid rgba(255,255,255,0.1)', borderTopLeftRadius: 20, borderTopRightRadius: 20, 
            position:'absolute', bottom: 0, left: 0, right: 0, zIndex: 101, 
            display: 'flex', flexDirection: 'column', 
            height: `${drawerHeight}vh`, 
            transition: isDragging ? 'none' : 'height 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)',
            touchAction: 'none',
            boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
        }}>
         
         <div 
            {...bindDrawer()} 
            style={{ 
                width: '100%', height: 40, 
                display: 'flex', alignItems: 'center', justifyContent: 'center', 
                cursor: 'grab', flexShrink: 0, 
                touchAction: 'none',
                background: 'transparent'
            }}
         >
             <div style={{width: 50, height: 5, background: 'rgba(255,255,255,0.3)', borderRadius: 3}} />
         </div>

         {/* ABAS */}
         <div style={{display:'flex', justifyContent:'space-around', padding:'0 0 10px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', flexShrink: 0, opacity: drawerHeight < 15 ? 0 : 1, transition: 'opacity 0.2s'}}>
            <TabBtn label="Estilos" icon={ICONS.layer} active={activeTab === 'styles'} onClick={() => { setActiveTab('styles'); if(drawerHeight < 30) setDrawerHeight(50); }} />
            <TabBtn label="Ajustes" icon={ICONS.light} active={activeTab === 'adjust'} onClick={() => { setActiveTab('adjust'); if(drawerHeight < 30) setDrawerHeight(50); }} />
            <TabBtn label="Borracha" icon={ICONS.eraser} active={activeTab === 'eraser'} onClick={() => { setActiveTab('eraser'); if(drawerHeight < 30) setDrawerHeight(50); }} color={activeTab==='eraser'?'#ff4444':null} />
         </div>

         {/* CONTEÚDO SCROLLÁVEL */}
         <div 
            className="scroll-container" 
            style={{
                padding: '20px', overflowY: 'auto', flex: 1, overscrollBehavior: 'contain', 
                touchAction: 'pan-y',
                opacity: drawerHeight < 20 ? 0 : 1, pointerEvents: drawerHeight < 20 ? 'none' : 'auto', transition: 'opacity 0.2s'
            }}
            onPointerDownCapture={stopPropagation}
         >
             {activeTab === 'styles' && (
                 <div className="fade-in" style={{display:'grid', gridTemplateColumns: '1fr 1fr', gap:'12px', paddingBottom: 50}}>
                     {Object.entries(STYLES).map(([key, style]) => (
                         <button key={key} onClick={() => setSelectedStyle(key)} style={{ padding: '15px', borderRadius: '12px', border: 'none', background: selectedStyle === key ? '#00ff00' : 'rgba(255,255,255,0.08)', color: selectedStyle === key ? '#000' : '#fff', fontWeight: 'bold', fontSize: '13px', display:'flex', alignItems:'center', gap: 10, cursor:'pointer', transition: 'all 0.2s' }}>
                             <div style={{fontSize: 18}}>{style.label.split(' ')[0]}</div> <div>{style.label.split(' ')[1]}</div>
                         </button>
                     ))}
                 </div>
             )}

             {activeTab === 'adjust' && (
                 <div className="fade-in" style={{display:'flex', flexDirection:'column', gap: 25, paddingBottom: 50}}>
                     <div style={{display:'flex', gap: 20, alignItems:'center'}}>
                         <div style={{textAlign:'center'}}>
                             <div style={{marginBottom: 8, fontSize: 10, color:'#888', fontWeight:'bold'}}>LUZ</div>
                             <div style={{position:'relative', width: 70, height: 70, borderRadius: '50%', background: '#222', border: '2px solid #444'}}>
                                 <input type="range" min="0" max="360" value={lightAngle} onChange={e => setLightAngle(Number(e.target.value))} style={{position:'absolute', width:'100%', height:'100%', opacity: 0, cursor:'pointer'}} />
                                 <div style={{ position: 'absolute', top: '50%', left: '50%', width: 2, height: '50%', background: '#00ff00', transformOrigin: 'top center', transform: `translate(-50%, 0) rotate(${lightAngle + 180}deg)`, pointerEvents:'none' }}> <div style={{width: 8, height: 8, background: '#00ff00', borderRadius: '50%', position:'absolute', bottom: 0, left: -3, boxShadow:'0 0 10px #00ff00'}} /> </div>
                             </div>
                         </div>
                         <div style={{flex: 1, display:'flex', flexDirection:'column', gap: 20}}>
                             <div> <div style={{display:'flex', justifyContent:'space-between', marginBottom: 8}}> <label style={lbl}>ENVOLVER BRAÇO</label> <span style={val}>{Math.round(cylindrical*100)}%</span> </div> <input type="range" min="0" max="1" step="0.05" value={cylindrical} onChange={e => setCylindrical(Number(e.target.value))} /> </div>
                             <div> <div style={{display:'flex', justifyContent:'space-between', marginBottom: 8}}> <label style={lbl}>ESCALA</label> <span style={val}>{scale.toFixed(2)}x</span> </div> <input type="range" min="0.1" max="1.5" step="0.01" value={scale} onChange={e => setScale(Number(e.target.value))} /> </div>
                         </div>
                     </div>
                 </div>
             )}

             {activeTab === 'eraser' && (
                 <div className="fade-in">
                     <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 15}}> <label style={{color:'#ff4444', fontWeight:'bold', fontSize: 12}}>TAMANHO</label> <button onClick={clearEraser} style={{background:'rgba(255,68,68,0.2)', color:'#ff4444', border:'none', padding:'5px 10px', borderRadius: 4, fontSize: 10, fontWeight:'bold'}}>LIMPAR TUDO</button> </div>
                     <input type="range" min="10" max="100" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} style={{background: 'linear-gradient(90deg, #ff4444, #880000)'}} />
                 </div>
             )}
         </div>
      </div>
    </div>
  );
};

const TabBtn = ({ label, icon, active, onClick, color }) => (
    <button onClick={onClick} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: active ? (color || '#00ff00') : '#666', transition: 'color 0.2s', flex: 1, padding: '5px' }}>
        <span style={{fontSize: 20}}>{icon}</span>
        <span style={{fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase'}}>{label}</span>
        {active && <div style={{width: 4, height: 4, borderRadius: '50%', background: color || '#00ff00', marginTop: 2}} />}
    </button>
);

const btnHeader = { background: 'rgba(255,255,255,0.15)', backdropFilter:'blur(4px)', border:'none', width: 36, height: 36, borderRadius: '50%', fontSize: 20, display:'grid', placeItems:'center', cursor:'pointer' };
const lbl = { color: '#888', fontSize: 11, fontWeight: 'bold', letterSpacing: 1 };
const val = { color: '#fff', fontSize: 11, fontFamily: 'monospace' };

export default SmartEditor;