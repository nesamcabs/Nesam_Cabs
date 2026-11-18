// "Edit your pickup" (Customer UX 9.0): change the pickup date, time and — for a Round Trip — the trip days without leaving the vehicle
// page. The fares and packages are recalculated by the server as soon as the booking changes. The same overnight rule as the booking
// form applies: a pickup from 6:46 PM to 12:59 AM is a 2-day trip, and the stepper cannot go below it.
import { useState } from 'react';
import { scheduleProblem } from '@core/utils/bookingRules';
import { formatDate } from '@core/utils/format';
import { Dialog } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { TimePicker, formatTime12 } from '@/components/TimePicker';
import { useBooking } from '@/state/Booking';
import { addDaysISO, combineDateTime, earliestSlot, latestPickup, toDateInput, toTimeInput } from '@/lib/schedule';
import { isOvernightPickup } from '@core/utils/timePackages';
import './editTrip.css';

/** Round trips are booked for up to this many days (the server's roundTrip.maxDays). */
const RT_MAX_DAYS = 30;

export function EditTripDialog({ onClose }: { onClose: () => void }) {
  const { draft, update } = useBooking();
  const round = draft.tripType === 'Round Trip' && !draft.multicity;
  const start = draft.scheduledAt && draft.scheduledAt.getTime() > Date.now() ? draft.scheduledAt : earliestSlot();
  const [date, setDate] = useState(() => toDateInput(start));
  const [time, setTime] = useState(() => toTimeInput(start));
  const [days, setDays] = useState(() => Math.max(1, draft.tripDays || 1));
  const [auto, setAuto] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [error, setError] = useState('');

  const overnight = round && isOvernightPickup(combineDateTime(date, time));
  const minDays = overnight ? 2 : 1;
  const firstDay = toDateInput(earliestSlot());
  const lastDay = toDateInput(latestPickup());

  const chooseTime = (t: string) => {
    setTime(t);
    setError('');
    if (!round) return;
    const night = isOvernightPickup(combineDateTime(date, t));
    if (night && days < 2) { setDays(2); setAuto(true); }
    else if (!night && auto) { setDays(1); setAuto(false); }
  };
  const step = (by: number) => {
    setAuto(false);
    setError('');
    setDays((d) => Math.min(RT_MAX_DAYS, Math.max(minDays, d + by)));
  };

  const save = () => {
    const at = combineDateTime(date, time);
    if (!at) return setError('Choose a pickup date and time.');
    const problem = scheduleProblem(at);
    if (problem) return setError(problem);
    update(
      round
        ? { scheduledAt: at, tripEndAt: combineDateTime(addDaysISO(date, days - 1), time), tripDays: days, daysAuto: false, timePackage: '' }
        : { scheduledAt: at, tripEndAt: null, timePackage: '' },
    );
    onClose();
  };

  return (
    <>
      <Dialog
        title="Edit your pickup"
        subtitle="Choose your pickup date and time. Available packages and fares will update."
        onClose={onClose}
        className="etd"
        footer={<button type="button" className="etd__save" onClick={save}>Update trip</button>}
      >
        <div className="etd__grid">
          <label className="etd__field">
            <span>Pickup date</span>
            <input type="date" value={date} min={firstDay} max={lastDay} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setError(''); } }} />
          </label>
          <div className="etd__field">
            <span>Pickup time</span>
            <button type="button" className="etd__time" onClick={() => setTimeOpen(true)} aria-label={`Pickup time: ${formatTime12(time)}`}>
              {formatTime12(time) || 'Select'}
              <Icon name="clock" size={18} />
            </button>
          </div>
        </div>

        {round ? (
          <div className="etd__days">
            <span id="etd-days">{overnight ? 'Trip days' : 'Days'}{overnight ? <small>Overnight</small> : null}</span>
            <div role="group" aria-labelledby="etd-days">
              <button type="button" aria-label="One day less" disabled={days <= minDays} onClick={() => step(-1)}>−</button>
              <output aria-live="polite">{days} {days === 1 ? 'day' : 'days'}</output>
              <button type="button" aria-label="One day more" disabled={days >= RT_MAX_DAYS} onClick={() => step(1)}>+</button>
            </div>
            <p>{overnight && days === 2 ? 'Overnight trip · ' : ''}Ends {formatDate(combineDateTime(addDaysISO(date, days - 1), '00:00') ?? new Date())}</p>
          </div>
        ) : null}

        {error ? <p className="etd__error" role="alert">{error}</p> : null}
      </Dialog>
      {timeOpen ? <TimePicker title="Pickup time" date={date} value={time} validate="pickup" onClose={() => setTimeOpen(false)} onConfirm={(t) => { chooseTime(t); setTimeOpen(false); }} /> : null}
    </>
  );
}
