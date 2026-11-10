import { DIAL_CODES } from '@/lib/countryCodes';

const UNIQUE_DIAL_CODES = [...new Set(DIAL_CODES.map((item) => item.code))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

export function CountryCodeSelect({ value, onChange, id, label = 'Country code' }: { value: string; onChange: (code: string) => void; id: string; label?: string }) {
  return (
    <label className="country-code" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {UNIQUE_DIAL_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
      </select>
    </label>
  );
}
