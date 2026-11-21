/** Transient notice toast (copied link, saved file, zoom level, …). */
import { useEffect, useState } from 'react';
import { useBrowser } from '../context/BrowserContext';

const TOAST_MS = 4200;

export function Toast() {
  const { shape } = useBrowser();
  const notice = shape.browser?.notice ?? null;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!notice) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice || !visible) return null;
  return (
    <div className="toast" role="status">
      {notice.message}
    </div>
  );
}
