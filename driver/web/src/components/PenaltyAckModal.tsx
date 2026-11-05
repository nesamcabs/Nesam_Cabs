import React, { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { DriverPenalty } from '../types';
import { acknowledgePenalty, disputePenalty } from '../services/tripService';
import { ActionError } from '../services/callables';
import { formatDateTime12 } from '../utils/time';

export const ACK_TEXT = 'I have read and understood the penalty information.';
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * Shown for a penalty the driver has not yet acknowledged. It cannot be closed
 * until they tick the box and acknowledge (or raise a dispute). The tick records that the penalty
 * was read — it is not an admission, and the driver can still dispute it.
 */
export const PenaltyAckModal: React.FC<{ penalty: DriverPenalty; onDone: (message: string) => void }> = ({ penalty, onDone }) => {
  const [checked, setChecked] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onDone(success);
    } catch (err) {
      setError(err instanceof ActionError ? err.message : 'That did not go through. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4 overflow-y-auto" role="alertdialog" aria-modal="true" aria-labelledby="penalty-title">
      <div className="bg-white rounded-2xl border-2 border-red-600 shadow-2xl w-full max-w-md my-6">
        <div className="bg-red-600 text-white px-5 py-4 rounded-t-xl flex items-center gap-3">
          <AlertTriangle className="w-7 h-7 shrink-0" />
          <div>
            <h2 id="penalty-title" className="text-lg font-black">A penalty has been issued</h2>
            <p className="text-sm text-red-100">Please read it carefully.</p>
          </div>
        </div>
        <div className="p-5 space-y-3 text-sm text-gray-900">
          <div className="text-center bg-red-50 border border-red-200 rounded-xl py-3">
            <p className="text-xs font-bold uppercase text-red-700">Penalty amount</p>
            <p className="text-3xl font-black text-red-700">{rupees(penalty.amount)}</p>
          </div>
          <dl className="space-y-2">
            <div><dt className="text-xs font-bold uppercase text-gray-600">Reason</dt><dd className="font-semibold">{penalty.category} — {penalty.reason}</dd></div>
            {penalty.description && <div><dt className="text-xs font-bold uppercase text-gray-600">Additional details</dt><dd>{penalty.description}</dd></div>}
            {penalty.bookingCode && <div><dt className="text-xs font-bold uppercase text-gray-600">Trip / booking</dt><dd className="font-mono font-semibold">{penalty.bookingCode}</dd></div>}
            <div><dt className="text-xs font-bold uppercase text-gray-600">Date and time</dt><dd>{penalty.issuedAt ? formatDateTime12(penalty.issuedAt) : '—'}{penalty.incidentDate ? ` · incident on ${penalty.incidentDate}` : ''}</dd></div>
          </dl>

          {!disputing ? (
            <>
              <label className="flex items-start gap-2 font-semibold pt-1">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="w-5 h-5 mt-0.5 accent-red-600" />
                <span>{ACK_TEXT}</span>
              </label>
              <p className="text-xs text-gray-600">Ticking this only confirms that you have read the penalty. You can still dispute it.</p>
            </>
          ) : (
            <label className="block">
              <span className="font-bold block mb-1">Why do you dispute this penalty?</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} className="w-full border border-gray-400 rounded-lg p-2.5 text-sm" placeholder="Explain what happened (at least 10 characters)" />
            </label>
          )}
          {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-800 font-semibold p-2.5 rounded-lg">{error}</div>}
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            {!disputing ? (
              <>
                <button onClick={() => void run(() => acknowledgePenalty(penalty.id), 'Penalty acknowledged.')} disabled={!checked || busy} className="flex-1 py-3 bg-red-600 text-white font-extrabold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Acknowledge
                </button>
                <button onClick={() => setDisputing(true)} disabled={busy} className="flex-1 py-3 border border-gray-400 text-gray-900 font-bold rounded-xl">I want to dispute this</button>
              </>
            ) : (
              <>
                <button onClick={() => { setDisputing(false); setError(''); }} disabled={busy} className="flex-1 py-3 border border-gray-400 text-gray-900 font-bold rounded-xl">Back</button>
                <button onClick={() => void run(() => disputePenalty(penalty.id, note.trim()), 'Your dispute was sent to NESAM.')} disabled={busy || note.trim().length < 10} className="flex-1 py-3 bg-gray-900 text-white font-extrabold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send dispute
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
