// Web stand-in for @react-native-community/datetimepicker (wired in by
// metro.config.js for the "web" platform only). The apps use just the imperative
// `DateTimePickerAndroid.open({ mode: 'date' | 'time', ... })`; here it opens a
// small dialog around the browser's own <input type="date|time"> picker.
import { showDialog } from '../domDialog';

type PickerMode = 'date' | 'time';

interface ChangeEvent {
  type: 'set' | 'dismissed';
  nativeEvent: { timestamp: number };
}

interface OpenParams {
  value: Date;
  mode?: PickerMode;
  minimumDate?: Date;
  maximumDate?: Date;
  is24Hour?: boolean;
  onChange?: (event: ChangeEvent, date?: Date) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

let closeCurrent: (() => void) | null = null;

function open({ value, mode = 'date', minimumDate, maximumDate, onChange }: OpenParams): void {
  closeCurrent?.();
  const fire = (type: ChangeEvent['type'], date?: Date) => onChange?.({ type, nativeEvent: { timestamp: (date ?? value).getTime() } }, date);

  const input = document.createElement('input');
  input.type = mode;
  input.value = mode === 'date' ? toDateValue(value) : toTimeValue(value);
  if (mode === 'date') {
    if (minimumDate) input.min = toDateValue(minimumDate);
    if (maximumDate) input.max = toDateValue(maximumDate);
  }
  input.style.cssText =
    'width:100%;box-sizing:border-box;min-height:46px;padding:0 12px;font:600 16px inherit;border:1px solid #E5E7EB;border-radius:12px;background:#fff;color:#111;';

  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top:6px;min-height:16px;font-size:12px;color:#D92D20;';
  const wrap = document.createElement('div');
  wrap.append(input, hint);

  closeCurrent = showDialog({
    title: mode === 'date' ? 'Select date' : 'Select time',
    content: wrap,
    buttons: [
      { text: 'Cancel', style: 'cancel', onPress: () => fire('dismissed') },
      {
        text: 'OK',
        onPress: () => {
          if (!input.value) {
            hint.textContent = mode === 'date' ? 'Choose a date.' : 'Choose a time.';
            return false;
          }
          if (mode === 'date' && !input.checkValidity()) {
            hint.textContent = 'That date is outside the allowed range.';
            return false;
          }
          const next = new Date(value);
          if (mode === 'date') {
            const [y, m, d] = input.value.split('-').map(Number);
            next.setFullYear(y!, m! - 1, d!);
          } else {
            const [h, min] = input.value.split(':').map(Number);
            next.setHours(h!, min!, 0, 0);
          }
          fire('set', next);
          return undefined;
        },
      },
    ],
    onDismiss: () => {
      closeCurrent = null;
    },
  });
}

export const DateTimePickerAndroid = {
  open,
  dismiss: (): Promise<boolean> => {
    const was = closeCurrent !== null;
    closeCurrent?.();
    closeCurrent = null;
    return Promise.resolve(was);
  },
};

export default DateTimePickerAndroid;
