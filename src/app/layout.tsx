import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'สแกนเลขสลาก 6 หลัก',
  description: 'สแกนเลข 6 หลักจากสลากกินแบ่งรัฐบาลด้วยกล้องมือถือ แล้วส่งออกเป็น CSV',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>
        <div className="min-h-screen max-w-xl mx-auto p-4">{children}</div>
      </body>
    </html>
  );
}
