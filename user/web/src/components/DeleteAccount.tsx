// "Delete my account": a request the team verifies and settles (open bookings, payments) before anything is removed.
// Lives on the Help and support page, not in the profile drawer.
import { useState } from 'react';
import { useCustomerData } from '@core/context/CustomerData';
import { callFunction } from '@core/services/callables';
import { describeError } from '@core/utils/retry';
import { Button, Dialog, Notice } from '@/components/ui';
import { Icon } from '@/components/Icon';

export function DeleteAccountCard() {
  const { profile } = useCustomerData();
  const [ask, setAsk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  if (!profile) return null;

  const requestDeletion = async () => {
    if (deleting) return;
    setDeleting(true);
    setResult(null);
    try {
      const r = await callFunction<{ role: string }, { alreadyOpen: boolean; liveBookings: number; reference: string }>('requestAccountDeletion', { role: 'customer' });
      setResult({
        tone: 'success',
        text: `${r.alreadyOpen ? 'Your request is already with our team.' : 'Request received.'} Reference ${r.reference}. We will confirm by phone or email${r.liveBookings ? `. ${r.liveBookings} booking(s) are still open and must be completed or cancelled first` : ''}.`,
      });
    } catch (e) {
      setResult({ tone: 'error', text: describeError(e, 'The request was not sent. Please try again.') });
    } finally {
      setDeleting(false);
      setAsk(false);
    }
  };

  return (
    <>
      <div className="card card--list delete-account">
        <button type="button" className="setting setting--danger setting--button" onClick={() => setAsk(true)}>
          <span className="setting__icon"><Icon name="trash" size={18} /></span>
          <span className="setting__label">Delete my account</span>
        </button>
      </div>
      {result ? <Notice tone={result.tone}>{result.text}</Notice> : null}

      {ask ? (
        <Dialog
          title="Delete your account?"
          onClose={() => setAsk(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsk(false)}>
                Keep my account
              </Button>
              <Button variant="danger" loading={deleting} onClick={() => void requestDeletion()}>
                Request deletion
              </Button>
            </>
          }
        >
          <p className="muted">
            We will verify the request, settle anything still open (bookings, payments) and then delete your account and personal data. Records we must keep by law, such as invoices, are retained. This cannot be undone once it is processed.
          </p>
        </Dialog>
      ) : null}
    </>
  );
}
