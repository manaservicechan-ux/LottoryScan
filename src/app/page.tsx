'use client';
import { useEffect, useRef, useState } from 'react';
import { preprocessForOcr, extractSixDigitCandidates } from '@/lib/ocr';

type ScanStep = 'idle' | 'cropping' | 'processing' | 'review';
type Rect = { x: number; y: number; w: number; h: number };
type ScannedItem = { id: string; number: string };

const STORAGE_KEY = 'lottery-scan-items';

export default function ScanPage() {
  const [step, setStep] = useState<ScanStep>('idle');
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [manualNumber, setManualNumber] = useState('');
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const imgBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setItems(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }, [items]);

  function pickPhoto() {
    fileInputRef.current?.click();
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setCandidates([]);
    setManualNumber('');
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    setRect(null);
    setStep('cropping');
  }

  function relPos(clientX: number, clientY: number) {
    const box = imgBoxRef.current!.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - box.left, 0), box.width);
    const y = Math.min(Math.max(clientY - box.top, 0), box.height);
    return { x: x / box.width, y: y / box.height };
  }

  function onDragStart(clientX: number, clientY: number) {
    const p = relPos(clientX, clientY);
    setDragStart(p);
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function onDragMove(clientX: number, clientY: number) {
    if (!dragStart) return;
    const p = relPos(clientX, clientY);
    setRect({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    });
  }

  function onDragEnd() {
    setDragStart(null);
  }

  async function runOcr(useFullImage: boolean) {
    if (!imgRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const img = imgRef.current;
      const natW = img.naturalWidth;
      const natH = img.naturalHeight;

      const cropCanvas = document.createElement('canvas');
      let sx = 0, sy = 0, sw = natW, sh = natH;
      if (!useFullImage && rect && rect.w > 0.02 && rect.h > 0.02) {
        sx = Math.round(rect.x * natW);
        sy = Math.round(rect.y * natH);
        sw = Math.round(rect.w * natW);
        sh = Math.round(rect.h * natH);
      }
      cropCanvas.width = sw;
      cropCanvas.height = sh;
      const cctx = cropCanvas.getContext('2d')!;
      cctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const processed = preprocessForOcr(cropCanvas);

      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
      const { data } = await worker.recognize(processed);
      await worker.terminate();

      const found = extractSixDigitCandidates(data.text || '');
      setCandidates(found);
      if (found.length === 0) {
        setError('อ่านเลข 6 หลักไม่ได้ ลองครอบเฉพาะแถวเลขให้ชัดขึ้น หรือกรอกเอง');
      }
      setStep('review');
    } catch (err: any) {
      setError('เกิดข้อผิดพลาดระหว่างอ่านภาพ: ' + (err?.message || String(err)));
      setStep('review');
    } finally {
      setBusy(false);
    }
  }

  function confirmNumber(num: string) {
    const clean = num.trim();
    if (!/^\d{6}$/.test(clean)) {
      setError('เลขต้องเป็นตัวเลข 6 หลักเท่านั้น');
      return;
    }
    setItems((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, number: clean }]);
    resetToIdle();
  }

  function resetToIdle() {
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    setImgUrl(null);
    setRect(null);
    setCandidates([]);
    setManualNumber('');
    setError(null);
    setStep('idle');
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
          ถ่ายรูปเฉพาะแถวเลข 6 หลักตัวใหญ่บนสลากให้ชัดและเต็มเฟรม ระบบจะอ่านด้วย OCR
          บนเครื่อง (ไม่ส่งภาพขึ้นเซิร์ฟเวอร์) แล้วให้ยืนยันเลขก่อนเพิ่มเข้ารายการทุกครั้ง
        </p>
        <p className="text-amber-700">
          หมายเหตุ: QR/บาร์โค้ดเล็กบนสลากเป็นรหัสเข้ารหัสของ กสอ. ไม่สามารถถอดเป็นเลข 6 หลักได้ตรงๆ
          จึงใช้วิธีอ่านตัวเลขที่พิมพ์ด้วย OCR แทน
        </p>
      </div>

      {step === 'idle' && (
        <div className="card">
          <button className="btn-primary" onClick={pickPhoto}>ถ่ายรูป / เลือกรูปสลาก</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onFileChosen}
          />
        </div>
      )}

      {step === 'cropping' && imgUrl && (
        <div className="card space-y-3">
          <div className="text-sm text-gray-600">ลากเลือกกรอบเฉพาะแถวเลข 6 หลัก แล้วกด &quot;อ่านเลข&quot;</div>
          <div
            ref={imgBoxRef}
            className="relative inline-block select-none touch-none max-w-full"
            onMouseDown={(e) => onDragStart(e.clientX, e.clientY)}
            onMouseMove={(e) => e.buttons === 1 && onDragMove(e.clientX, e.clientY)}
            onMouseUp={onDragEnd}
            onTouchStart={(e) => onDragStart(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchMove={(e) => onDragMove(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchEnd={onDragEnd}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={imgRef} src={imgUrl} alt="สลาก" className="max-w-full max-h-[70vh] block" draggable={false} />
            {rect && (
              <div
                className="absolute border-2 border-rose-500 bg-rose-500/20 pointer-events-none"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => runOcr(false)}>
              {busy ? 'กำลังอ่าน...' : 'อ่านเลข (เฉพาะกรอบ)'}
            </button>
            <button className="btn-secondary" disabled={busy} onClick={() => runOcr(true)}>
              อ่านทั้งภาพ
            </button>
            <button className="btn-secondary" disabled={busy} onClick={resetToIdle}>ยกเลิก</button>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="card space-y-3">
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt="สลาก" className="max-h-40 rounded border" />
          )}
          {error && <div className="text-amber-700 text-sm">{error}</div>}
          {candidates.length > 0 && (
            <div>
              <div className="label">เลขที่อ่านได้ (กดเพื่อยืนยัน)</div>
              <div className="flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <button key={c} className="btn-secondary text-lg font-mono" onClick={() => confirmNumber(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
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
              <button className="btn-primary" onClick={() => confirmNumber(manualNumber)}>เพิ่ม</button>
            </div>
          </div>
          <button className="btn-secondary" onClick={resetToIdle}>สแกนใบถัดไป</button>
        </div>
      )}

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
