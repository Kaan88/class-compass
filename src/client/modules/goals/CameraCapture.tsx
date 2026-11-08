/**
 * "Take a picture" (S13b2, D-119). On a phone or tablet (coarse pointer) the system camera opens
 * through a capture file input; elsewhere (classroom laptops, desktops with a webcam) an in-page
 * camera with shutter, retake, use photo and, when there is more than one camera, switch camera.
 * The camera is released as soon as a photo is taken or the panel closes.
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { captureFrame } from '../../lib/images.ts';
import { Button } from '../../ui/Button.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { IconCamera, IconCheck, IconSwap, IconUndo } from '../../ui/icons.tsx';

/** Phones and tablets: let the operating system's camera app take the picture. */
export function prefersSystemCamera(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

export function CameraCapture({ onPhoto, idPrefix }: { onPhoto: (photo: Blob) => void; idPrefix: string }) {
  const { t } = useI18n();
  const system = prefersSystemCamera();
  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [cameras, setCameras] = useState(0);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<Blob | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);

  const release = () => {
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    setReady(false);
  };

  useEffect(() => {
    if (system || !supported || shot) return;
    let cancelled = false;
    setError(false);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing }, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        setReady(true);
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) setCameras(devices.filter((d) => d.kind === 'videoinput').length);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      release();
    };
  }, [facing, shot, system, supported]);

  useEffect(() => {
    if (!shot) {
      setShotUrl(null);
      return;
    }
    const url = URL.createObjectURL(shot);
    setShotUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [shot]);

  if (system || !supported) {
    return (
      <div className="cc-field">
        <label className="cc-field__label" htmlFor={`${idPrefix}-camera`}>
          {t('evidence.openCamera')}
        </label>
        <input
          id={`${idPrefix}-camera`}
          className="cc-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPhoto(f);
            e.target.value = '';
          }}
        />
      </div>
    );
  }

  const take = async () => {
    if (!video.current) return;
    const blob = await captureFrame(video.current);
    if (!blob) return;
    release();
    setShot(blob);
  };

  return (
    <div className="cc-stack cc-camera" data-testid="camera">
      {error ? <Alert kind="warning">{t('evidence.cameraDenied')}</Alert> : null}
      {shot && shotUrl ? (
        <img src={shotUrl} alt={t('evidence.photoPreview')} className="cc-camera__view" />
      ) : (
        <video ref={video} className="cc-camera__view" playsInline muted aria-label={t('evidence.cameraView')} />
      )}
      <div className="cc-row">
        {shot ? (
          <>
            <Button
              variant="primary"
              onPress={() => {
                onPhoto(shot);
                setShot(null);
              }}
            >
              <IconCheck />
              {t('evidence.usePhoto')}
            </Button>
            <Button onPress={() => setShot(null)}>
              <IconUndo />
              {t('evidence.retake')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" isDisabled={!ready} onPress={() => void take()}>
              <IconCamera />
              {t('evidence.shutter')}
            </Button>
            {cameras > 1 ? (
              <Button onPress={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}>
                <IconSwap />
                {t('evidence.switchCamera')}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
