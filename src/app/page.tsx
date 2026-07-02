'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { preprocessForOcr, extractSixDigitCandidates } from '@/lib/ocr';

type ScannedItem = { id: string; number: string };
type OcrWorker = {
  recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

const STORAGE_KEY = 'lottery-scan-items';
// guide box as a fraction of the video frame (wide, short strip in the middle)
const GUIDE = { x: 0.08, y: 0.4, w: 0.84, h: 0.2 };
const STREAK_TO_CONFIRM = 2;
const COOLDOWN_MS = 1800;

export default function ScanPage() {
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [liveGuess, setLiveGuess] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [manualNumber, setManualNumber] = useState('');
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<OcrWorker | null>(null);
  const loopActiveRef = useRef(false);
  const lastGuessRef = useRef<string | null>(null);
  const streakRef = useRef(0);
  const cooldownUntilRef = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setItems(JSON.parse(saved));
    } catch {}
  }, []);

  // Attach the stream once the (now-visible) <video> element is mounted/shown,
  // rather than while it was still display:none — some mobile browsers never
  // start decoding frames for a hidden video even after it becomes visible.
  useEffect(() => {
    const video = videoRef.current;
    if (!camOn || !video || !streamRef.current) return;
    video.srcObject = streamRef.current;
    video.play().catch((err) => setCamError(cameraErrorMessage(err)));
  }, [camOn]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items]);

  const addItem = useCallback((num: string) => {
    setItems((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, number: num }]);
    setFlash(num);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(120);
    setTimeout(() => setFlash(null), 1200);
  }, []);

  const scanLoop = useCallback(async () => {
    while (loopActiveRef.current) {
      const video = videoRef.current;
      const worker = workerRef.current;
      if (!video || !worker || video.readyState < 2 || !video.videoWidth) {
        await sleep(150);
        continue;
      }
      if (Date.now() < cooldownUntilRef.current) {
        await sleep(150);
        continue;
      }
      try {
        const sx = Math.round(GUIDE.x * video.videoWidth);
        const sy = Math.round(GUIDE.y * video.videoHeight);
        const sw = Math.round(GUIDE.w * video.videoWidth);
        const sh = Math.round(GUIDE.h * video.videoHeight);
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = sw;
        cropCanvas.height = sh;
        const ctx = cropCanvas.getContext('2d')!;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
        const processed = preprocessForOcr(cropCanvas);

        const { data } = await worker.recognize(processed);
        const candidates = extractSixDigitCandidates(data.text || '');
        const best = candidates[0] || null;
        setLiveGuess(best);

        if (best && best === lastGuessRef.current) {
          streakRef.current += 1;
        } else {
          streakRef.current = best ? 1 : 0;
          lastGuessRef.current = best;
        }

        if (best && streakRef.current >= STREAK_TO_CONFIRM) {
          addItem(best);
          streakRef.current = 0;
          lastGuessRef.current = null;
          setLiveGuess(null);
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
        }
      } catch {
        // ignore a single failed frame, keep looping
      }
      await sleep(80);
    }
  }, [addItem]);

  async function startCamera() {
    setCamError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'เบราว์เซอร์นี้ไม่รองรับการขอใช้กล้อง (หรือหน้านี้ไม่ได้เปิดผ่าน HTTPS) ลองเปิดลิงก์นี้ด้วย Chrome แล้วลองใหม่'
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      if (!workerRef.current) {
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('eng');
        await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
        workerRef.current = worker;
      }

      setCamOn(true);
      loopActiveRef.current = true;
      scanLoop();
    } catch (err: any) {
      setCamError(cameraErrorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  function stopCamera() {
    loopActiveRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
    setLiveGuess(null);
  }

  useEffect(() => {
    return () => {
      loopActiveRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      workerRef.current?.terminate();
    };
  }, []);

  function confirmManual() {
    const clean = manualNumber.trim();
    if (!/^\d{6}$/.test(clean)) return;
    addItem(clean);
    setManualNumber('');
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function clearAll() {
    if (items.length && !confirm('ล้างรายการทั้งหมด?')) return;
    setItems([]);
  }

  function exportCsv() {
    const header = 'number6';
    const rows = items.map((i) => i.number);
    const csv = [header, ...rows].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `lottery-numbers-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">สแกนเลข 6 หลักจากสลาก (OCR)</h1>
      <div className="card space-y-2 text-sm text-gray-600">
        <p>
          เปิดกล้อง แล้วจัดแถวเลข 6 หลักตัวใหญ่บนสลากให้อยู่ในกรอบ ระบบจะอ่านและเพิ่มเข้ารายการ
          ให้อัตโนมัติเมื่ออ่านซ้ำได้ตรงกัน (ประมวลผลบนเครื่องทั้งหมด ไม่ส่งภาพขึ้นเซิร์ฟเวอร์)
        </p>
        <p className="text-amber-700">
          หมายเหตุ: QR/บาร์โค้ดเล็กบนสลากเป็นรหัสเข้ารหัสของ กสอ. ไม่สามารถถอดเป็นเลข 6 หลักได้ตรงๆ
          จึงใช้วิธีอ่านตัวเลขที่พิมพ์ด้วย OCR แทน
        </p>
      </div>

      <div className="card space-y-3">
        {!camOn ? (
          <button className="btn-primary" disabled={starting} onClick={startCamera}>
            {starting ? 'กำลังเปิดกล้อง...' : 'เปิดกล้อง เริ่มสแกน'}
          </button>
        ) : (
          <button className="btn-secondary" onClick={stopCamera}>หยุดกล้อง</button>
        )}
        {camError && <div className="text-amber-700 text-sm whitespace-pre-line">{camError}</div>}

        <div
          className={camOn ? 'relative w-full bg-black rounded-lg overflow-hidden' : 'hidden'}
          style={{ aspectRatio: videoSize ? `${videoSize.w} / ${videoSize.h}` : '16 / 9' }}
        >
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setVideoSize({ w: v.videoWidth, h: v.videoHeight });
            }}
          />
          <div
            className="absolute border-2 border-emerald-400"
            style={{
              left: `${GUIDE.x * 100}%`,
              top: `${GUIDE.y * 100}%`,
              width: `${GUIDE.w * 100}%`,
              height: `${GUIDE.h * 100}%`,
            }}
          />
          <div className="absolute inset-x-0 bottom-2 flex justify-center">
            <div className="px-3 py-1 rounded bg-black/60 text-white text-sm font-mono">
              {flash ? `เพิ่มแล้ว: ${flash}` : liveGuess ? `กำลังอ่าน: ${liveGuess}` : 'จัดเลขให้อยู่ในกรอบเขียว'}
            </div>
          </div>
        </div>

        <div>
          <label className="label">หรือพิมพ์เลขเอง</label>
          <div className="flex gap-2">
            <input
              className="input font-mono"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={manualNumber}
              onChange={(e) => setManualNumber(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button className="btn-primary" onClick={confirmManual}>เพิ่ม</button>
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">รายการที่สแกนแล้ว ({items.length})</h2>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={items.length === 0} onClick={clearAll}>ล้างทั้งหมด</button>
            <button className="btn-primary" disabled={items.length === 0} onClick={exportCsv}>ดาวน์โหลด CSV</button>
          </div>
        </div>
        {items.length === 0 ? (
          <div className="text-sm text-gray-500">ยังไม่มีรายการ</div>
        ) : (
          <ul className="divide-y">
            {items.map((it, idx) => (
              <li key={it.id} className="py-1.5 flex items-center justify-between text-sm">
                <span className="font-mono text-base">{idx + 1}. {it.number}</span>
                <button className="text-red-600 hover:underline" onClick={() => removeItem(it.id)}>ลบ</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cameraErrorMessage(err: any): string {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return (
        'ไม่ได้รับอนุญาตให้ใช้กล้อง แก้ไขได้ดังนี้\n' +
        '1) เช็คสิทธิ์กล้องของแอปเบราว์เซอร์: ตั้งค่ามือถือ → แอป → เบราว์เซอร์ที่ใช้ → สิทธิ์ → กล้อง → อนุญาต\n' +
        '2) เช็คสิทธิ์เฉพาะเว็บนี้ในตัวเบราว์เซอร์: แตะไอคอนกุญแจ/i ข้าง URL → ตั้งค่าไซต์ → กล้อง → อนุญาต\n' +
        '3) โหลดหน้าใหม่แล้วกด "เปิดกล้อง เริ่มสแกน" อีกครั้ง'
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'ไม่พบกล้องบนอุปกรณ์นี้';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'เปิดกล้องไม่ได้ อาจมีแอปอื่นกำลังใช้กล้องอยู่ ลองปิดแอปกล้อง/แอปวิดีโอคอลอื่นแล้วลองใหม่';
    case 'OverconstrainedError':
      return 'ไม่พบกล้องที่ตรงกับเงื่อนไขที่ขอ ลองใหม่อีกครั้ง';
    default:
      return 'เปิดกล้องไม่สำเร็จ: ' + (err?.message || String(err));
  }
}
