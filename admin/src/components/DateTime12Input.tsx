import TimeSelect12 from "./TimeSelect12";

interface Props {
  /** Local "YYYY-MM-DDTHH:mm", or "" for no value. */
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  id?: string;
  /** Earliest selectable date, "YYYY-MM-DD". */
  min?: string;
  hasError?: boolean;
  /** Names the field for screen readers, e.g. "Pickup from". */
  label?: string;
}

/** The time a freshly chosen date starts with, so the date alone never leaves the value half empty. */
const DEFAULT_TIME = "10:00";

/**
 * Date and time with an explicit 12-hour clock (hour, minute, AM/PM). The browser's own
 * datetime-local field follows the computer's locale and can show 24-hour time, so this always
 * shows "06:30 PM". The value stays a local "YYYY-MM-DDTHH:mm" string, so saved data is unchanged.
 */
export default function DateTime12Input({ value, onChange, disabled, id, min, hasError, label = "Date and time" }: Props) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value || "");
  const date = m ? m[1] : "";
  const time = m ? m[2] : "";

  return (
    <div className="ds-dt12" role="group" aria-label={label} data-invalid={hasError ? "true" : undefined}>
      <input
        id={id}
        className="ds-input"
        type="date"
        value={date}
        min={min}
        disabled={disabled}
        aria-label={`${label} · date`}
        aria-invalid={hasError || undefined}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}T${time || DEFAULT_TIME}` : "")}
      />
      <TimeSelect12
        label={label}
        value={date ? time || DEFAULT_TIME : ""}
        disabled={disabled || !date}
        onChange={(v) => date && onChange(`${date}T${v}`)}
      />
    </div>
  );
}
