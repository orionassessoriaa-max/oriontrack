'use client';

import { useState, useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate, AnimatePresence } from 'framer-motion';

type OrionFunnelProps = {
  total: number;
  activePipeline: number;
  quotedAndSold: number;
  sold: number;
};

export default function OrionFunnel({
  total = 40,
  activePipeline = 12,
  quotedAndSold = 8,
  sold = 1,
}: OrionFunnelProps) {
  const [hoveredTier, setHoveredTier] = useState<number | null>(null);

  // Framer Motion values for the falling particle
  const animY = useMotionValue(125);
  const animVal = useMotionValue(total);
 
  // Smoothly format the moving value into a rounded integer
  const roundedVal = useTransform(animVal, (latest) => Math.round(latest));
  const [displayVal, setDisplayVal] = useState(total);
 
  // React state sync for rounded value to avoid any Hydration/Render mismatches
  useEffect(() => {
    return roundedVal.on('change', (v) => setDisplayVal(v));
  }, [roundedVal]);
 
  // Center Y coordinates for each tier with the new 20px spaced coordinates
  const tierYPositions: Record<number, number> = {
    1: 125,
    2: 245,
    3: 355,
    4: 465,
  };
 
  // Values corresponding to each tier
  const tierValues: Record<number, number> = {
    1: total,
    2: activePipeline,
    3: quotedAndSold,
    4: sold,
  };
 
  // Trigger staggered path animations on hover changes
  useEffect(() => {
    if (hoveredTier === null) {
      // Snap particle back to Tier 1 when hover exits
      animate(animY, tierYPositions[1], { duration: 0.4, ease: 'easeOut' });
      animate(animVal, total, { duration: 0.4, ease: 'easeOut' });
      return;
    }
 
    // Build the dynamic path keyframes from Tier 1 to the hovered Tier
    const yKeyframes: number[] = [tierYPositions[1]];
    const valKeyframes: number[] = [total];
 
    for (let i = 2; i <= hoveredTier; i++) {
      yKeyframes.push(tierYPositions[i]);
      valKeyframes.push(tierValues[i]);
    }
 
    const duration = 0.25 * hoveredTier; // Staggered duration based on path depth
 
    // Animate vertical Y movement with a bouncy impact feel
    animate(animY, yKeyframes, {
      duration,
      ease: 'easeInOut',
      times: yKeyframes.map((_, idx) => idx / (yKeyframes.length - 1 || 1)),
      type: 'spring',
      stiffness: 110,
      damping: 14,
      mass: 0.8,
    });
 
    // Animate dynamic intermediate values
    animate(animVal, valKeyframes, {
      duration,
      ease: 'easeInOut',
    });
  }, [hoveredTier, total, activePipeline, quotedAndSold, sold]);
 
  const funnelSteps = [
    {
      id: 1,
      name: 'Leads',
      value: total,
      detail: 'Entradas captadas',
      color: '#00bcff',
      glow: 'rgba(0, 188, 255, 0.4)',
      ellipseStroke: '#58aeff',
      bodyStroke: '#2b88ff',
      mouthFill: 'url(#funnelMouth1)',
      bodyFill: 'url(#funnelBody1)',
      cy: 70,
      rx: 200,
      ry: 32,
      bodyPath: 'M 60 70 A 200 32 0 0 0 460 70 L 420 175 A 160 26 0 0 1 100 175 Z',
      leftHighlight: 'M 62 72 L 102 173',
      rightHighlight: 'M 458 72 L 418 173',
    },
    {
      id: 2,
      name: 'Atendimento',
      value: activePipeline,
      detail: 'Em atendimento',
      color: '#00f5ff',
      glow: 'rgba(0, 245, 255, 0.4)',
      ellipseStroke: '#22d3ee',
      bodyStroke: '#00c8e6',
      mouthFill: 'url(#funnelMouth2)',
      bodyFill: 'url(#funnelBody2)',
      cy: 195,
      rx: 150,
      ry: 24,
      bodyPath: 'M 110 195 A 150 24 0 0 0 410 195 L 375 290 A 115 18 0 0 1 145 290 Z',
      leftHighlight: 'M 112 197 L 147 288',
      rightHighlight: 'M 408 197 L 373 288',
    },
    {
      id: 3,
      name: 'Cotação',
      value: quotedAndSold,
      detail: 'Propostas enviadas',
      color: '#c084fc',
      glow: 'rgba(192, 132, 252, 0.4)',
      ellipseStroke: '#c084fc',
      bodyStroke: '#8d42f5',
      mouthFill: 'url(#funnelMouth3)',
      bodyFill: 'url(#funnelBody3)',
      cy: 310,
      rx: 105,
      ry: 17,
      bodyPath: 'M 155 310 A 105 17 0 0 0 365 310 L 335 395 A 75 12 0 0 1 185 395 Z',
      leftHighlight: 'M 157 312 L 187 393',
      rightHighlight: 'M 363 312 L 333 393',
    },
    {
      id: 4,
      name: 'Vendas',
      value: sold,
      detail: 'Conversões fechadas',
      color: '#2dd4bf',
      glow: 'rgba(45, 212, 191, 0.4)',
      ellipseStroke: '#2dd4bf',
      bodyStroke: '#00c2be',
      mouthFill: 'url(#funnelMouth4)',
      bodyFill: 'url(#funnelBody4)',
      cy: 415,
      rx: 68,
      ry: 11,
      bodyPath: 'M 192 415 A 68 11 0 0 0 328 415 C 328 415 315 505 260 515 C 205 505 192 415 192 415 Z',
      leftHighlight: 'M 194 417 C 194 417 205 495 242 508',
      rightHighlight: 'M 326 417 C 326 417 315 495 278 508',
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center w-full min-h-[500px]">
      {/* Left: Centered Glass Funnel SVG (Full width, no cutoff side labels) */}
      <div className="relative w-full max-w-[460px] mx-auto select-none animate-in fade-in duration-700">
        {/* Glow backlight behind active segments */}
        <AnimatePresence>
          {hoveredTier && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 0.22, scale: 1.05 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="absolute inset-0 pointer-events-none rounded-full blur-[100px]"
              style={{
                background: funnelSteps[hoveredTier - 1]?.color || '#007cff',
              }}
            />
          )}
        </AnimatePresence>

        <svg viewBox="0 0 520 600" className="w-full h-auto overflow-visible">
          <style>{`
            @keyframes radar-sweep {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            .animate-radar-sweep {
              transform-origin: 260px 300px;
              animation: radar-sweep 16s linear infinite;
            }
          `}</style>
          <defs>
            {/* SVG Glowing drop shadows and double gaussian blur neon filters */}
            {funnelSteps.map((step) => (
              <filter id={`glow-tier-${step.id}`} key={step.id} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="8" result="blur1" />
                <feGaussianBlur stdDeviation="22" result="blur2" />
                <feMerge>
                  <feMergeNode in="blur2" />
                  <feMergeNode in="blur1" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            ))}

            {/* Glowing particle glow */}
            <radialGradient id="particleGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="35%" stopColor="#a78bfa" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#090e1a" stopOpacity="0" />
            </radialGradient>

            {/* Mouth Gradients ( Frosted Glass Inner Lip ) */}
            <linearGradient id="funnelMouth1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00357c" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#0066cc" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="funnelMouth2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00455c" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#007fa6" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="funnelMouth3" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3d096d" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#6b15b2" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="funnelMouth4" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#004744" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#007a76" stopOpacity="0.95" />
            </linearGradient>

            {/* Body Gradients ( Semi-Transparent Glowing Neon Frost ) */}
            <linearGradient id="funnelBody1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00bcff" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#003194" stopOpacity="0.75" />
            </linearGradient>
            <linearGradient id="funnelBody2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00f5ff" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#004e63" stopOpacity="0.75" />
            </linearGradient>
            <linearGradient id="funnelBody3" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c084fc" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#4f008f" stopOpacity="0.75" />
            </linearGradient>
            <linearGradient id="funnelBody4" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#004a47" stopOpacity="0.75" />
            </linearGradient>

            {/* Premium Specular Glass Reflection Shine */}
            <linearGradient id="funnelGlossShine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
              <stop offset="25%" stopColor="#ffffff" stopOpacity="0.12" />
              <stop offset="75%" stopColor="#ffffff" stopOpacity="0.0" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.25" />
            </linearGradient>
          </defs>

          {/* DYNAMIC TECH RADAR COORDINATE BACKDROP */}
          <g opacity="0.16" pointerEvents="none">
            {/* Outer dotted tracking circle */}
            <circle cx="260" cy="300" r="260" fill="none" stroke="#1e293b" strokeWidth="2" />
            <circle cx="260" cy="300" r="240" fill="none" stroke="#3b82f6" strokeWidth="1" strokeDasharray="3 9" />
            
            {/* Rotating Sweep Beam */}
            <line x1="260" y1="300" x2="260" y2="40" stroke="url(#funnelBody1)" strokeWidth="2.5" className="animate-radar-sweep opacity-70" />
            
            {/* Middle ticks ring */}
            <circle cx="260" cy="300" r="185" fill="none" stroke="#8b5cf6" strokeWidth="0.8" strokeDasharray="16 6" />
            {/* Inner target circle */}
            <circle cx="260" cy="300" r="130" fill="none" stroke="#2dd4bf" strokeWidth="0.5" strokeDasharray="2 6" />
            
            {/* Grid axis lines with crosshair markers */}
            <line x1="260" y1="20" x2="260" y2="580" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="1" strokeDasharray="4 4" />
            <line x1="20" y1="300" x2="500" y2="300" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="1" strokeDasharray="4 4" />
            
            {/* HUD corners */}
            <path d="M 35 35 H 65 M 35 35 V 65" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
            <path d="M 485 35 H 455 M 485 35 V 65" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
            <path d="M 35 565 H 65 M 35 565 V 535" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
            <path d="M 485 565 H 455 M 485 565 V 535" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
            
            {/* Center target lock marker */}
            <circle cx="260" cy="300" r="6" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
            <circle cx="260" cy="300" r="1.5" fill="#2dd4bf" />
          </g>

          {/* RENDER THE 3D GLASS SEGMENTS */}
          {funnelSteps.map((step) => {
            const isActive = hoveredTier === step.id;
            const isDimmed = hoveredTier !== null && !isActive;

            return (
              <g
                key={step.id}
                onMouseEnter={() => setHoveredTier(step.id)}
                onMouseLeave={() => setHoveredTier(null)}
                className="cursor-pointer transition-all duration-300"
              >
                {/* 3D Glass Cup Group */}
                <g
                  style={{
                    transform: isActive ? 'scale(1.04) translateY(-3px)' : 'scale(1) translateY(0px)',
                    transformOrigin: `260px ${step.cy + 50}px`,
                    filter: isActive ? `url(#glow-tier-${step.id}) brightness(1.22)` : 'none',
                    opacity: isDimmed ? 0.35 : 1,
                    transition: 'all 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {/* Top Mouth Ellipse (Double-stroke lip for glass thickness) */}
                  <ellipse
                    cx="260"
                    cy={step.cy}
                    rx={step.rx}
                    ry={step.ry}
                    fill={step.mouthFill}
                    stroke={step.ellipseStroke}
                    strokeWidth={isActive ? '3' : '1.5'}
                    className="transition-all duration-300"
                  />
                  <ellipse
                    cx="260"
                    cy={step.cy}
                    rx={step.rx - 1}
                    ry={step.ry - 1}
                    fill="none"
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth="1"
                    pointerEvents="none"
                  />

                  {/* Glass Body */}
                  <path
                    d={step.bodyPath}
                    fill={step.bodyFill}
                    stroke={step.bodyStroke}
                    strokeWidth={isActive ? '2.5' : '1.2'}
                  />

                  {/* Reflective Gloss Overlay */}
                  <path
                    d={step.bodyPath}
                    fill="url(#funnelGlossShine)"
                    pointerEvents="none"
                  />

                  {/* Cylindrical speculative reflections left and right */}
                  <path
                    d={step.leftHighlight}
                    stroke="rgba(255, 255, 255, 0.45)"
                    strokeWidth={isActive ? '3' : '1.5'}
                    fill="none"
                    strokeLinecap="round"
                    pointerEvents="none"
                  />
                  <path
                    d={step.rightHighlight}
                    stroke="rgba(255, 255, 255, 0.22)"
                    strokeWidth={isActive ? '2.5' : '1'}
                    fill="none"
                    strokeLinecap="round"
                    pointerEvents="none"
                  />

                  {/* Dynamic Value Text (Hidden during active hover particle movement, otherwise glows) */}
                  <motion.text
                    x="260"
                    y={tierYPositions[step.id] + 8}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={step.id === 1 ? '68' : step.id === 2 ? '60' : step.id === 3 ? '52' : '40'}
                    fontWeight="900"
                    className="font-black select-none tracking-tight"
                    style={{
                      textShadow: '0 4px 16px rgba(0,0,0,0.6), 0 0 10px rgba(255,255,255,0.1)',
                      pointerEvents: 'none',
                    }}
                    animate={{
                      opacity: hoveredTier !== null ? 0.08 : 1,
                      scale: hoveredTier !== null ? 0.92 : 1,
                      filter: isActive ? 'drop-shadow(0 0 8px rgba(255,255,255,0.5))' : 'none',
                    }}
                    transition={{ duration: 0.22 }}
                  >
                    {step.value}
                  </motion.text>
                </g>
              </g>
            );
          })}

          {/* DYNAMIC FALLING VALUE PARTICLE */}
          <AnimatePresence>
            {hoveredTier !== null && (
              <motion.g
                style={{ y: animY }}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                pointerEvents="none"
              >
                {/* Floating particle ambient glow backing */}
                <circle
                  cx="260"
                  cy="8"
                  r="56"
                  fill="url(#particleGlow)"
                />
                
                {/* Neon core border around the falling value (reactive to hovered tier color) */}
                <circle
                  cx="260"
                  cy="8"
                  r="40"
                  fill="rgba(5, 9, 20, 0.95)"
                  stroke={funnelSteps[hoveredTier - 1]?.color || '#ffffff'}
                  strokeWidth="3.5"
                  style={{
                    filter: `drop-shadow(0 0 14px ${funnelSteps[hoveredTier - 1]?.color}bb)`,
                  }}
                />

                {/* Outer tech dotted ring orbiting the particle */}
                <circle
                  cx="260"
                  cy="8"
                  r="48"
                  fill="none"
                  stroke={funnelSteps[hoveredTier - 1]?.color || '#ffffff'}
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  className="animate-radar-sweep"
                  opacity="0.8"
                />

                {/* The flowing/falling value number */}
                <text
                  x="260"
                  y="22"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="44"
                  fontWeight="950"
                  className="font-black tracking-tighter"
                  style={{
                    textShadow: '0 0 10px rgba(255, 255, 255, 0.85)',
                  }}
                >
                  {displayVal}
                </text>
              </motion.g>
            )}
          </AnimatePresence>
        </svg>
      </div>

      {/* Right: Modern glassmorphic sidebar (Synced HTML/CSS Metrics Cards) */}
      <div className="flex flex-col gap-4 text-left w-full max-w-sm sm:max-w-md mx-auto animate-in fade-in slide-in-from-right-4 duration-700">
        <div className="flex items-center justify-between mb-2 border-b border-white/5 pb-2.5">
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
            Fases do Funil
          </h3>
          <span className="text-[10px] font-bold text-slate-500 uppercase">
            Conversão Geral
          </span>
        </div>
        
        {funnelSteps.map((step) => {
          const isActive = hoveredTier === step.id;
          const percentage = total > 0 ? ((step.value / total) * 100) : 0;

          return (
            <div
              key={step.id}
              className={`relative overflow-hidden p-4.5 rounded-2xl border transition-all duration-350 cursor-pointer ${
                isActive
                  ? 'bg-slate-900/60 border-white/20 shadow-2xl -translate-y-0.5'
                  : 'bg-slate-950/20 border-white/5 opacity-70 hover:opacity-100 hover:bg-slate-900/35 hover:border-white/10'
              }`}
              style={{
                boxShadow: isActive ? `0 8px 30px -4px ${step.color}15, inset 0 0 12px ${step.color}05` : 'none',
              }}
              onMouseEnter={() => setHoveredTier(step.id)}
              onMouseLeave={() => setHoveredTier(null)}
            >
              {/* Dynamic glowing side neon border strip */}
              <div 
                className="absolute left-0 top-0 bottom-0 w-1 transition-all duration-350"
                style={{
                  backgroundColor: step.color,
                  boxShadow: isActive ? `0 0 10px 1px ${step.color}` : 'none',
                  opacity: isActive ? 1 : 0.4,
                }}
              />

              <div className="flex items-center justify-between mb-3.5 pl-2.5">
                <div className="flex items-center gap-3.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: step.color,
                      boxShadow: `0 0 8px ${step.color}`,
                    }}
                  />
                  <div>
                    <h4 className="font-extrabold text-white text-base leading-tight tracking-tight">{step.detail}</h4>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">{step.name}</p>
                  </div>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end">
                  <p 
                    className="text-2xl font-black leading-none transition-all duration-300"
                    style={{
                      color: isActive ? '#ffffff' : '#e2e8f0',
                      textShadow: isActive ? `0 0 10px ${step.color}40` : 'none',
                    }}
                  >
                    {step.value}
                  </p>
                </div>
              </div>

              {/* Glowing internal progress bar synced with percentage */}
              <div className="w-full bg-slate-950/80 rounded-full h-2.5 overflow-hidden border border-white/5 pl-2.5 ml-2.5">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    backgroundColor: step.color,
                    boxShadow: `0 0 8px ${step.color}aa`,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.65, ease: 'easeOut' }}
                />
              </div>

              <div className="flex justify-between items-center mt-2.5 text-[10px] font-bold pl-2.5 ml-2.5">
                <span className="text-slate-500 uppercase tracking-wider">Porcentagem comercial</span>
                <span 
                  className="px-2 py-0.5 rounded-full border border-white/5 transition-all duration-350"
                  style={{
                    color: step.color,
                    backgroundColor: `${step.color}0d`,
                    borderColor: `${step.color}25`,
                  }}
                >
                  {percentage.toFixed(0)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
