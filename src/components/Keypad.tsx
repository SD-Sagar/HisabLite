import { Delete } from 'lucide-react';
import { useT } from '../i18n';

/**
 * Big number keys, like a calculator: for amounts (with a point) and for the PIN. On a phone this
 * is easier than the phone's own keyboard, which covers half the screen and jumps about.
 */
export function Keypad({
  onDigit,
  onBack,
  dot,
  className,
}: {
  onDigit: (d: string) => void;
  onBack: () => void;
  /** show the decimal point key */
  dot?: boolean;
  className?: string;
}) {
  const t = useT();
  const key = (k: string) => (
    <button key={k} type="button" className="key" onClick={() => onDigit(k)}>
      {k}
    </button>
  );
  return (
    <div className={`keypad ${className ?? ''}`}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key)}
      {dot ? key('.') : <span />}
      {key('0')}
      <button type="button" className="key" aria-label={t.keypad.back} onClick={onBack}>
        <Delete size={24} />
      </button>
    </div>
  );
}
