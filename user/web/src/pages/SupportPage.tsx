import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SupportTicket } from '@core/types';
import { useCustomerData } from '@/state/CustomerData';
import { SUPPORT_CATEGORIES, submitSupportTicket, subscribeToSupportTickets } from '@core/services/userService';
import { SCHEDULED_CANCELLATION_FEE, SCHEDULED_FREE_CANCEL_BEFORE_MS, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY, SUPPORT_WHATSAPP } from '@core/config/constants';
import { formatINR } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { Badge, Button, EmptyState, FieldShell, Notice, PageHead, Tabs, TextArea, TextField } from '@/components/ui';
import { FAQS } from '@/pages/book/content';
import { Icon } from '@/components/Icon';
import { AccountLayout, SignInPrompt } from '@/components/AccountLayout';
import { useAuth } from '@/state/Auth';
import { useSeo } from '@/lib/seo';
import { CONTACT, whatsappLink } from '@/lib/contact';

type Tab = 'help' | 'ticket' | 'mine';

const TOPIC_TEXT: Record<string, string> = {
  change: 'Change request: ',
  feedback: 'Feedback: ',
};

export function SupportPage() {
  useSeo({
    title: 'Customer Support & 24/7 Helpline',
    description: 'Need help with your outstation cab booking? Call NESAM Cabs at +91 90250 99990 or submit a ticket. Fast 24/7 assistance across Tamil Nadu.',
    canonical: '/support',
  });
  const [params] = useSearchParams();
  const initialBooking = params.get('booking') ?? '';
  const topic = params.get('topic') ?? '';
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const [tab, setTab] = useState<Tab>(initialBooking || TOPIC_TEXT[topic] ? 'ticket' : 'help');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [category, setCategory] = useState(TOPIC_TEXT[topic] ? 'Other' : SUPPORT_CATEGORIES[0]!);
  const [bookingId, setBookingId] = useState(initialBooking);
  const [description, setDescription] = useState(TOPIC_TEXT[topic] ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [listError, setListError] = useState('');

  useEffect(() => {
    if (!profile?.uid) return undefined;
    return subscribeToSupportTickets(profile.uid, setTickets, (e) => setListError(describeError(e, 'We couldn’t load your tickets.')));
  }, [profile?.uid]);

  const submit = async () => {
    if (!profile) {
      openLoginModal({ title: 'Continue with mobile', subtitle: 'Sign in to send your request. You’ll come back to this page.' });
      return;
    }
    if (description.trim().length < 10) return setError('Please describe the issue in at least 10 characters.');
    if (sending) return;
    setSending(true);
    setError('');
    try {
      await submitSupportTicket(profile, { category, bookingId, description }, 'nesam');
      setDescription('');
      setBookingId('');
      setSubmitted(true);
      setTab('mine');
    } catch (e) {
      setError(describeError(e, 'We couldn’t submit your request. Please try again or call support.'));
    } finally {
      setSending(false);
    }
  };

  const freeHours = Math.round(SCHEDULED_FREE_CANCEL_BEFORE_MS / 3600000);
  const faqs = [
    {
      q: 'How do cancellations and refunds work?',
      a: `Cancel from My Bookings. Cancelling more than ${freeHours} hour${freeHours === 1 ? '' : 's'} before pickup is free; after that a ${formatINR(SCHEDULED_CANCELLATION_FEE)} fee applies. The screen shows any fee before you confirm. Refunds of any amount already paid are recorded under Payments & Refunds.`,
    },
    ...FAQS.filter((f) => !/cancel/i.test(f.q)),
  ];

  return (
    <AccountLayout>
      <PageHead backTo="/account" title="Help & Support">
        Answers, a direct line to NESAM, and a way to raise an issue with a trip.
      </PageHead>

      <Tabs
        variant="boxed"
        className="support-tabs"
        label="Support sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'help', label: 'Help' },
          { value: 'ticket', label: 'Send a request' },
          { value: 'mine', label: 'My requests', count: tickets.length || undefined },
        ]}
      />

      <div className="support">
        <div className="support__main" role="tabpanel">
          {tab === 'help' ? (
            <div className="faq__list faq__list--card">
              {faqs.map((f, i) => (
                <details key={f.q} className="faq__item" open={i === 0 && topic === 'cancellation'}>
                  <summary>
                    <span>{f.q}</span>
                    <Icon name="plus" size={16} className="faq__plus" />
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          ) : null}

          {tab === 'ticket' ? (
            <form
              className="card"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <FieldShell label="What’s it about?">
                {({ id }) => (
                  <select id={id} className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {SUPPORT_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                )}
              </FieldShell>
              <TextField label="Booking ID (optional)" value={bookingId} onChange={(e) => setBookingId(e.target.value)} placeholder="e.g. NT-1042" autoComplete="off" />
              <TextArea label="Describe the issue" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 2000))} hint="Tell us what happened and when. A change is only made once NESAM confirms it." placeholder="What do you need help with?" />
              {error ? <Notice tone="error">{error}</Notice> : null}
              <div className="form-actions">
                <Button type="submit" icon="send" loading={sending}>
                  Send request
                </Button>
              </div>
            </form>
          ) : null}

          {tab === 'mine' ? (
            <div className="stack">
              {submitted ? <Notice tone="success">Your request was sent. Our team will get back to you.</Notice> : null}
              {listError ? <Notice tone="error">{listError}</Notice> : null}
              {!profile ? (
                <SignInPrompt art="support" title="Sign in to view your requests" text="Sign in with your mobile number to view requests you’ve sent." />
              ) : tickets.length === 0 ? (
                <div className="card card--center">
                  <EmptyState
                    icon="support"
                    title="No requests yet"
                    action={
                      <Button variant="secondary" onClick={() => setTab('ticket')}>
                        Send a request
                      </Button>
                    }
                  >
                    Requests you send will be tracked here.
                  </EmptyState>
                </div>
              ) : (
                <ul className="card card--list">
                  {tickets.map((t) => (
                    <li key={t.id} className="ticket-row">
                      <div className="ticket-row__head">
                        <strong>{t.category || 'Support request'}</strong>
                        <Badge tone={t.status === 'Resolved' || t.status === 'Closed' ? 'green' : t.status === 'In Progress' ? 'blue' : 'amber'} dot>
                          {t.status}
                        </Badge>
                      </div>
                      <p>{t.description}</p>
                      <small>
                        {t.createdAt}
                        {t.bookingId ? ` · Booking ${t.bookingId}` : ''}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <aside className="support__aside">
          <section className="card contact-card">
            <span className="contact-card__icon" aria-hidden="true">
              <Icon name="support" size={20} />
            </span>
            <h2>Talk to NESAM</h2>
            <p>For a booking or a trip in progress, call us — we’re here around the clock.</p>
            <a className="btn btn--primary btn--block" href={`tel:${SUPPORT_PHONE}`}>
              <Icon name="phone" size={17} /> Call {SUPPORT_PHONE_DISPLAY}
            </a>
            <a className="btn btn--secondary btn--block" href={whatsappLink(SUPPORT_WHATSAPP, 'Hello NESAM, I need help with my booking.')} target="_blank" rel="noopener noreferrer">
              <Icon name="chat" size={17} /> WhatsApp NESAM
            </a>
            <a className="contact-card__mail" href={`mailto:${CONTACT.email}`}>
              {CONTACT.email}
            </a>
          </section>
        </aside>
      </div>
    </AccountLayout>
  );
}
