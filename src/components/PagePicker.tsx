import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, ImagePlus, Plus, X } from 'lucide-react';
import { useT } from '../i18n';

/**
 * The photos chosen for one reading. One khata page often is not enough — a day can run over
 * the fold, and an old book has many pages — so every screen that reads paper takes several.
 */
export interface Pages {
  files: File[];
  previews: string[];
  add(list: FileList | null): void;
  remove(index: number): void;
  clear(): void;
  max: number;
}

export function usePages(max: number): Pages {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const made = useRef<string[]>([]);

  useEffect(() => () => made.current.forEach((url) => URL.revokeObjectURL(url)), []);

  return {
    files,
    previews,
    max,
    add(list) {
      const picked = [...(list ?? [])].slice(0, max - files.length);
      if (!picked.length) return;
      const urls = picked.map((f) => URL.createObjectURL(f));
      made.current.push(...urls);
      setFiles([...files, ...picked]);
      setPreviews([...previews, ...urls]);
    },
    remove(index) {
      URL.revokeObjectURL(previews[index]);
      setFiles(files.filter((_, i) => i !== index));
      setPreviews(previews.filter((_, i) => i !== index));
    },
    clear() {
      previews.forEach((url) => URL.revokeObjectURL(url));
      setFiles([]);
      setPreviews([]);
    },
  };
}

/**
 * Before any photo: the camera and the gallery. After: a small picture of every page, each with
 * a ✕, and a tile for the next one. Taking the last page away brings the first screen back.
 */
export function PagePicker({
  pages,
  editable,
  heading,
  intro,
  tips,
  help,
}: {
  pages: Pages;
  /** false while the photos are being read, so nothing moves under the reader */
  editable: boolean;
  heading: string;
  intro: string;
  tips?: string[];
  help?: ReactNode;
}) {
  const t = useT();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const room = pages.files.length < pages.max;

  // the value is cleared so the same page can be picked again right after it was removed
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    pages.add(e.target.files);
    e.target.value = '';
  };

  return (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={take} />
      <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={take} />

      {!pages.previews.length ? (
        <div className="scan-start">
          <div className="scan-illustration">
            <Camera size={44} />
          </div>
          <h2>{heading}</h2>
          <p className="muted">{intro}</p>
          <div className="scan-buttons">
            <button className="btn primary big" onClick={() => cameraRef.current?.click()}>
              <Camera size={22} /> {t.scan.camera}
            </button>
            <button className="btn ghost big" onClick={() => galleryRef.current?.click()}>
              <ImagePlus size={22} /> {t.scan.gallery}
            </button>
          </div>
          {tips && (
            <ul className="tips">
              {tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="page-strip">
            {pages.previews.map((src, i) => (
              <div key={src} className="page-thumb">
                <img src={src} alt={t.scan.pageNo(i + 1)} />
                <span className="page-no">{i + 1}</span>
                {editable && (
                  <button type="button" className="page-x" aria-label={t.scan.removePage} onClick={() => pages.remove(i)}>
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            {editable && room && (
              <button type="button" className="page-add" onClick={() => cameraRef.current?.click()}>
                <Plus size={20} />
                {t.scan.addPage}
              </button>
            )}
          </div>
          <p className="muted small page-note">
            {help}
            {editable && room && (
              <button type="button" className="btn ghost small" onClick={() => galleryRef.current?.click()}>
                <ImagePlus size={15} /> {t.scan.gallery}
              </button>
            )}
          </p>
        </>
      )}
    </>
  );
}
