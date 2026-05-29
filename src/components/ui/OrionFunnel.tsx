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
  const animY = useMotionValue(162);
  const animVal = useMotionValue(total);

  // Smoothly format the moving value into a rounded integer
  const roundedVal = useTransform(animVal, (latest) => Math.round(latest));
  const [displayVal, setDisplayVal] = useState(total);

  // React state sync for rounded value to avoid any Hydration/Render mismatches
  useEffect(() => {
    return roundedVal.onChange((v) => setDisplayVal(v));
  }, [roundedVal]);

  // Center Y coordinates for each tier
  const tierYPositions: Record<number, number> = {
    1: 162,
    2: 278,
    3: 386,
    4: 500,
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

    const duration = 0.28 * hoveredTier; // Staggered duration based on path depth

    // Animate vertical Y movement with a bouncy impact feel
    animate(animY, yKeyframes, {
      duration,
      ease: 'easeInOut',
      times: yKeyframes.map((_, idx) => idx / (yKeyframes.length - 1 || 1)),
      type: 'spring',
      stiffness: 110,
      damping: 13,
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
      topLipPath: 'cx="260" cy="100" rx="200" ry="38"',
      bodyPath: 'M 60 100 A 200 38 0 0 0 460 100 L 385 210 A 125 22 0 0 1 135 210 Z',
      connectorY: 150,
      labelX: 576,
      labelY: 158,
      connectorLine: { x1: 420, x2: 560 },
    },
    {
      id: 2,
      name: 'Atendimento',
      value: activePipeline,
      detail: 'Em funil comercial',
      color: '#00c2ff',
      glow: 'rgba(0, 194, 255, 0.4)',
      ellipseStroke: '#22d3ee',
      bodyStroke: '#00c8e6',
      mouthFill: 'url(#funnelMouth2)',
      bodyFill: 'url(#funnelBody2)',
      topLipPath: 'cx="260" cy="220" rx="125" ry="22"',
      bodyPath: 'M 135 220 A 125 22 0 0 0 385 220 L 330 320 A 70 14 0 0 1 190 320 Z',
      connectorY: 270,
      labelX: 576,
      labelY: 278,
      connectorLine: { x1: 356, x2: 560 },
    },
    {
      id: 3,
      name: 'Cotação',
      value: quotedAndSold,
      detail: 'Propostas e vendas',
      color: '#a78bfa',
      glow: 'rgba(167, 139, 250, 0.4)',
      ellipseStroke: '#a78bfa',
      bodyStroke: '#8d42f5',
      mouthFill: 'url(#funnelMouth3)',
      bodyFill: 'url(#funnelBody3)',
      topLipPath: 'cx="260" cy="330" rx="76" ry="14"',
      bodyPath: 'M 184 330 A 76 14 0 0 0 336 330 L 306 430 A 46 9 0 0 1 214 430 Z',
      connectorY: 380,
      labelX: 576,
      labelY: 388,
      connectorLine: { x1: 308, x2: 560 },
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
      topLipPath: 'cx="260" cy="440" rx="48" ry="9"',
      bodyPath: 'M 212 440 A 48 9 0 0 0 308 440 C 308 440 295 560 260 570 C 225 560 212 440 212 440 Z',
      connectorY: 500,
      labelX: 576,
      labelY: 508,
      connectorLine: { x1: 278, x2: 560 },
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8 items-center w-full min-h-[500px]">
      {/* Left: Responsive 3D Glass Funnel SVG */}
      <div className="relative w-full max-w-[500px] mx-auto select-none">
        {/* Glow backlight behind active segments */}
        <AnimatePresence>
          {hoveredTier && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 0.12, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 pointer-events-none rounded-full blur-[80px]"
              style={{
                background: funnelSteps[hoveredTier - 1]?.color || '#007cff',
              }}
            />
          )}
        </AnimatePresence>

        <svg viewBox="0 0 840 640" className="w-full h-auto overflow-visible">
          <defs>
            {/* SVG Glowing drop shadows */}
            {funnelSteps.map((step) => (
              <filter id={`glow-tier-${step.id}`} key={step.id} x="-25%" y="-25%" width="150%" height="150%">
                <feDropShadow dx="0" dy="0" stdDeviation="15" floodColor={step.color} floodOpacity="0.75" />
              </filter>
            ))}

            {/* Glowing particle glow */}
            <radialGradient id="particleGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="35%" stopColor="#a78bfa" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#090e1a" stopOpacity="0" />
            </radialGradient>

            {/* Mouth Gradients */}
            <linearGradient id="funnelMouth1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#08224b" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#004da3" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="funnelMouth2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#002d3c" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#006385" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="funnelMouth3" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2c0650" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#4f127e" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="funnelMouth4" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#002d2c" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#005d5a" stopOpacity="0.9" />
            </linearGradient>

            {/* Body Gradients */}
            <linearGradient id="funnelBody1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f62e6" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#002b78" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="funnelBody2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00a8e0" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#005978" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="funnelBody3" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6719cd" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#3c0b78" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="funnelBody4" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00a39e" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#005956" stopOpacity="0.85" />
            </linearGradient>

            {/* Premium Glossy Overlay Shine */}
            <linearGradient id="funnelGlossShine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
              <stop offset="30%" stopColor="#ffffff" stopOpacity="0.1" />
              <stop offset="70%" stopColor="#ffffff" stopOpacity="0.0" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.15" />
            </linearGradient>
          </defs>

          {/* BACKGROUND RING */}
          <circle cx="260" cy="300" r="220" fill="none" stroke="rgba(255, 255, 255, 0.02)" strokeWidth="1" strokeDasharray="5 15" pointerEvents="none" />

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
                    transformOrigin: `260px ${step.id * 120}px`,
                    filter: isActive ? `url(#glow-tier-${step.id}) brightness(1.2)` : 'none',
                    opacity: isDimmed ? 0.35 : 1,
                    transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {/* Top Mouth Ellipse */}
                  <ellipse
                    cx="260"
                    cy={step.id === 1 ? 100 : step.id === 2 ? 220 : step.id === 3 ? 330 : 440}
                    rx={step.id === 1 ? 200 : step.id === 2 ? 125 : step.id === 3 ? 76 : 48}
                    ry={step.id === 1 ? 38 : step.id === 2 ? 22 : step.id === 3 ? 14 : 9}
                    fill={step.mouthFill}
                    stroke={step.ellipseStroke}
                    strokeWidth={isActive ? '3' : '2'}
                    className="transition-all duration-300"
                  />

                  {/* Glass Body */}
                  <path
                    d={step.bodyPath}
                    fill={step.bodyFill}
                    stroke={step.bodyStroke}
                    strokeWidth="1.5"
                  />

                  {/* Reflective Gloss Overlay */}
                  <path
                    d={step.bodyPath}
                    fill="url(#funnelGlossShine)"
                    pointerEvents="none"
                  />

                  {/* Static Value Text (Hidden during active hover particle movement, otherwise glows) */}
                  <motion.text
                    x="260"
                    y={tierYPositions[step.id] + 8}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={step.id === 1 ? '72' : step.id === 2 ? '64' : step.id === 3 ? '54' : '44'}
                    fontWeight="900"
                    style={{
                      textShadow: '0 4px 12px rgba(0,0,0,0.5)',
                      pointerEvents: 'none',
                    }}
                    animate={{
                      opacity: hoveredTier !== null ? 0.08 : 1,
                      scale: hoveredTier !== null ? 0.9 : 1,
                    }}
                    transition={{ duration: 0.2 }}
                  >
                    {step.value}
                  </motion.text>
                </g>

                {/* Connecting Lines and Labels (Fade out non-hovered paths) */}
                <g
                  style={{
                    opacity: isDimmed ? 0.2 : 1,
                    transition: 'opacity 0.3s ease',
                  }}
                >
                  {/* Glowing connector dot at the cup wall */}
                  <circle
                    cx={step.connectorLine.x1}
                    cy={step.connectorY}
                    r={isActive ? '8' : '6'}
                    fill={step.color}
                    style={{ filter: `drop-shadow(0 0 6px ${step.color})` }}
                  />

                  {/* Fine connecting line */}
                  <line
                    x1={step.connectorLine.x1}
                    y1={step.connectorY}
                    x2={step.connectorLine.x2}
                    y2={step.connectorY}
                    stroke={step.color}
                    strokeWidth={isActive ? '3' : '1.5'}
                    style={{ filter: isActive ? `drop-shadow(0 0 4px ${step.color})` : 'none' }}
                  />

                  {/* Terminal indicator dot */}
                  <circle
                    cx={step.connectorLine.x2}
                    cy={step.connectorY}
                    r={isActive ? '8' : '6'}
                    fill={step.color}
                    style={{ filter: `drop-shadow(0 0 6px ${step.color})` }}
                  />

                  {/* Stage Label Text */}
                  <text
                    x={step.labelX}
                    y={step.labelY}
                    fill={isActive ? '#ffffff' : '#94a3b8'}
                    fontSize="24"
                    fontWeight="900"
                    className="tracking-wide select-none"
                    style={{
                      textShadow: isActive ? `0 0 8px ${step.color}` : 'none',
                      transition: 'fill 0.3s ease',
                    }}
                  >
                    {step.detail}
                  </text>
                </g>
              </g>
            );
          })}

          {/* DYNAMIC FALLING VALUE PARTICLE */}
          <AnimatePresence>
            {hoveredTier !== null && (
              <motion.g
                style={{ y: animY }}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.2 }}
                pointerEvents="none"
              >
                {/* Floating particle ambient glow backing */}
                <circle
                  cx="260"
                  cy="8"
                  r="52"
                  fill="url(#particleGlow)"
                />
                
                {/* Neon core border around the falling value */}
                <circle
                  cx="260"
                  cy="8"
                  r="42"
                  fill="rgba(9, 14, 26, 0.9)"
                  stroke="#ffffff"
                  strokeWidth="2.5"
                  style={{
                    filter: 'drop-shadow(0 0 14px rgba(255, 255, 255, 0.45))',
                  }}
                />

                {/* The flowing/falling value number */}
                <text
                  x="260"
                  y="24"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="52"
                  fontWeight="950"
                  className="font-black tracking-tighter"
                  style={{
                    textShadow: '0 0 10px rgba(255, 255, 255, 0.8)',
                  }}
                >
                  {displayVal}
                </text>
              </motion.g>
            )}
          </AnimatePresence>
        </svg>
      </div>

      {/* Right: Premium glassmorphic stage legends/metrics details */}
      <div className="flex flex-col gap-4 text-left w-full max-w-sm sm:max-w-md mx-auto">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-2 border-b border-white/5 pb-2">
          Métricas de Conversão
        </h3>
        
        {funnelSteps.map((step) => {
          const isActive = hoveredTier === step.id;
          const percentage = ((step.value / total) * 100) || 0;

          return (
            <div
              key={step.id}
              className={`flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 ${
                isActive
                  ? 'bg-white/10 border-white/20 shadow-xl -translate-y-0.5'
                  : 'bg-white/5 border-white/5 opacity-70 hover:opacity-100'
              }`}
              onMouseEnter={() => setHoveredTier(step.id)}
              onMouseLeave={() => setHoveredTier(null)}
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-3.5 w-3.5 rounded-full shrink-0 animate-pulse"
                  style={{
                    backgroundColor: step.color,
                    boxShadow: `0 0 8px ${step.color}`,
                  }}
                />
                <div>
                  <h4 className="font-extrabold text-white text-base leading-tight">{step.detail}</h4>
                  <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">{step.name}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xl font-black text-white leading-none">{step.value}</p>
                <p className="text-[10px] font-bold text-slate-400 mt-1 bg-white/5 px-2 py-0.5 rounded-full inline-block">
                  {percentage.toFixed(0)}% do total
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
