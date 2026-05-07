import { useEffect, useRef, useState } from 'react';

/**
 * Visitor photo capture via the iPad's front camera. Renders a live video
 * preview, a "Take photo" button, then "Retake" / "Use this photo" once the
 * shot is taken.
 *
 * Returns the captured PNG as a base64 data URL via onChange.
 *
 * Camera access requires HTTPS in production (browsers block getUserMedia
 * on http:// for non-localhost origins). Workshop deploy needs a TLS cert.
 */
export default function PhotoCapture({ onChange }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStarting(false);
      } catch (e) {
        setErr(e?.message || 'Camera access was denied. Please ask a member of staff.');
        setStarting(false);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  const takePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // Mirror so the captured image matches the preview (front camera is mirrored).
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/png');
    setPhoto(dataUrl);
  };

  const retake = () => {
    setPhoto(null);
    onChange?.(null);
  };

  const confirm = () => {
    onChange?.(photo);
  };

  if (err) {
    return <div className="error" role="alert">{err}</div>;
  }

  return (
    <div className="photo-capture">
      <div className="photo-stage">
        {!photo && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="photo-preview"
            style={{ transform: 'scaleX(-1)' }} /* mirror the preview */
          />
        )}
        {photo && <img src={photo} alt="Captured visitor" className="photo-captured" />}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      <div className="photo-actions">
        {!photo && (
          <button type="button" className="kiosk-cta" onClick={takePhoto} disabled={starting}>
            {starting ? 'Starting camera…' : 'Take photo'}
          </button>
        )}
        {photo && (
          <>
            <button type="button" className="secondary" onClick={retake}>Retake</button>
            <button type="button" className="kiosk-cta" onClick={confirm}>Use this photo</button>
          </>
        )}
      </div>
    </div>
  );
}
