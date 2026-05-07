import { useEffect, useRef, useState } from 'react';

/**
 * Simple drawn-signature canvas. Pointer events so it works for finger,
 * stylus, or mouse equivalently. Returns the captured PNG (data URL) via
 * onChange whenever the visitor adds a stroke; null when cleared.
 */
export default function SignaturePad({ onChange, disabled = false, height = 160 }) {
  const ref = useRef(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Resize for device pixel ratio so strokes are crisp on retina.
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const cssWidth = canvas.offsetWidth;
      canvas.width = cssWidth * ratio;
      canvas.height = height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#111';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cssWidth, height);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [height]);

  const pos = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e) => {
    if (disabled) return;
    drawingRef.current = true;
    const ctx = ref.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    e.preventDefault();
  };
  const move = (e) => {
    if (!drawingRef.current) return;
    const ctx = ref.current.getContext('2d');
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    e.preventDefault();
  };
  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setHasInk(true);
    const dataUrl = ref.current.toDataURL('image/png');
    onChange?.(dataUrl);
  };

  const clear = () => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    setHasInk(false);
    onChange?.(null);
  };

  return (
    <div className="signature-pad-wrap">
      <canvas
        ref={ref}
        className={`signature-pad ${disabled ? 'disabled' : ''}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        style={{ height, touchAction: 'none' }}
      />
      <div className="signature-pad-actions">
        <button type="button" className="secondary" onClick={clear} disabled={disabled || !hasInk}>Clear</button>
        {!hasInk && !disabled && <span className="muted" style={{ fontSize: 13 }}>Sign with your finger or stylus.</span>}
      </div>
    </div>
  );
}
