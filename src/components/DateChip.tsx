import { CalendarDays, ChevronDown } from 'lucide-react';
import { useLang, useT } from '../i18n';
import { dayLabel, todayISO } from '../lib/format';

/** The date as a small pill — “আজ, 18 সেপ্টেম্বর” — that opens the phone's date picker when tapped. */
export function DateChip({ value, onChange, label }: { value: string; onChange: (iso: string) => void; label?: string }) {
  const t = useT();
  const lang = useLang();
  return (
    <label className="date-chip">
      <CalendarDays size={17} />
      <span>
        {label && `${label}: `}
        <b>{dayLabel(value, lang)}</b>
      </span>
      <ChevronDown size={16} />
      <input
        type="date"
        value={value}
        max={todayISO()}
        aria-label={label ?? t.common.date}
        onChange={(e) => onChange(e.target.value || todayISO())}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            // older browsers open their picker on their own
          }
        }}
      />
    </label>
  );
}
