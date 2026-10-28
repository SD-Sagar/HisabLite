import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { db } from '../db';
import { useT } from '../i18n';
import { loadPhoto } from '../lib/sync';
import { Modal } from './ui';

/** Shows a stored khata photo (fetched from the cloud if it was taken on another phone), or any blob URL passed as src. */
export function ImageViewer({ imageId, src, onClose }: { imageId?: number | null; src?: string | null; onClose: () => void }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setUrl(null);
    setMissing(false);
    if (!imageId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    db.images.get(imageId).then(async (img) => {
      const blob = img ? await loadPhoto(img) : null;
      if (cancelled) return;
      if (!blob) return setMissing(true);
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId]);

  const shown = src ?? url;
  if (!imageId && !src) return null;
  return (
    <Modal open onClose={onClose} title={t.common.khataPhoto}>
      {shown ? (
        <a href={shown} target="_blank" rel="noreferrer">
          <img className="full-image" src={shown} alt={t.common.khataPage} />
        </a>
      ) : missing ? (
        <p className="muted center">{t.image.notFound}</p>
      ) : (
        <p className="muted center">
          <Loader2 className="spin" size={28} />
        </p>
      )}
    </Modal>
  );
}
