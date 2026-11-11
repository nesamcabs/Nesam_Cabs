import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { SupportTicket } from '@core/types';
import { useCustomerData } from '@core/context/CustomerData';
import { SUPPORT_CATEGORIES, submitSupportTicket, subscribeToSupportTickets } from '@core/services/userService';
import { describeError } from '@core/utils/retry';
import { Badge, Button, EmptyState, FieldShell, Notice, PageHead, TextArea, TextField } from '@/components/ui';
import { FAQS } from '@/pages/book/content';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/state/Auth';
import { useSeo } from '@/lib/seo';
import { SUPPORT_SEO } from '@/seo/pages';
import { PolicyLinks } from '@/pages/PolicySections';

type Tab = 'help' | 'ticket' | 'mine';
const OTHER = '__other';
const MAX_DESCRIPTION = 2000;

/** Shortcuts to the pages that answer most questions without a ticket. */
const QUICK: { icon: string; title: string; text: string; to: string }[] = [
  { icon: 'trip-history', title: 'My trips', text: 'Track, change or cancel a booking', to: '/trips' },
  { icon: 'receipt', title: 'Payments & refunds', text: 'Receipts, refund credits and charges', to: '/account/payments' },
  { icon: 'document', title: 'Policies', text: 'Cancellation, refund and safety', to: '/legal' },
];

export function SupportPage() {
  useSeo(SUPPORT_SEO);
  const [params] = useSearchParams();
  const initialBooking = params.get('booking') ?? '';
  const { profile, trips } = useCustomerData();
  const { openLoginModal } = useAuth();
  const [tab, setTab] = useState<Tab>(initialBooking ? 'ticket' : 'help');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [category, setCategory] = useState(SUPPORT_CATEGORIES[0]!);
  const recent = useMemo(() => trips.slice(0, 15), [trips]);
  const [bookingChoice, setBookingChoice] = useState(initialBooking ? (recent.some((t) => t.bookingId === initialBooking) ? initialBooking : OTHER) : '');
  const [bookingId, setBookingId] = useState(initialBooking);
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [listError, setListError] = useState('');

  useEffect(() => {
    if (!profile?.uid) return undefined;
    return subscribeToSupportTickets(profile.uid, setTickets, (e) => setListError(describeError(e, 'We couldn’t load your tickets.')));
  }, [profile?.uid]);

  const openCount = tickets.filter((t) => t.status !== 'Resolved' && t.status !== 'Closed').length;

  const submit = async () => {
    if (!profile) {
      openLoginModal({ title: 'Sign in to raise ticket' });
      return;
    }
    if (description.trim().length < 10) return setError('Please describe the issue in at least 10 characters.');
    if (sending) return;
    setSending(true);
    setError('');
    try {
      const related = bookingChoice === OTHER ? bookingId.trim() : bookingChoice;
      await submitSupportTicket(profile, { category, bookingId: related, description }, 'nesam');
      setDescription('');
      setBookingId('');
      setBookingChoice('');
      setSubmitted(true);
      setTab('mine');
    } catch (e) {
      setError(describeError(e, 'We couldn’t submit your ticket. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageHead title="Help and support" />

      <div className="page support-page">
        <div className="seg" role="tablist" aria-label="Support sections">
          <button type="button" role="tab" aria-selected={tab === 'help'} className="seg__btn" onClick={() => setTab('help')}>
            <Icon name="help" size={16} /> Help
          </button>
          <button type="button" role="tab" aria-selected={tab === 'ticket'} className="seg__btn" onClick={() => setTab('ticket')}>
            <Icon name="edit" size={16} /> New ticket
          </button>
          <button type="button" role="tab" aria-selected={tab === 'mine'} className="seg__btn" onClick={() => setTab('mine')}>
            <Icon name="support" size={16} /> My tickets
            {openCount ? <span className="seg__count">{openCount}</span> : null}
          </button>
        </div>

        <div role="tabpanel">
          {tab === 'help' ? (
            <div className="support-help">
              <section aria-label="Quick help">
                <h2 className="support-title">Quick help</h2>
                <div className="quick-help">
                  {QUICK.map((q) => (
                    <Link key={q.to} to={q.to} className="quick-help__item">
                      <span className="quick-help__icon"><Icon name={q.icon} size={20} /></span>
                      <span className="quick-help__text">
                        <strong>{q.title}</strong>
                        <small>{q.text}</small>
                      </span>
                      <Icon name="chevron-right" size={16} />
                    </Link>
                  ))}
                  <button type="button" className="quick-help__item" onClick={() => setTab('ticket')}>
                    <span className="quick-help__icon"><Icon name="support" size={20} /></span>
                    <span className="quick-help__text">
                      <strong>Raise a ticket</strong>
                      <small>Report an issue with a trip or payment</small>
                    </span>
                    <Icon name="chevron-right" size={16} />
                  </button>
                </div>
              </section>

              <section aria-label="Frequently asked questions">
                <h2 className="support-title">Frequently asked questions</h2>
                <div className="card faq-list">
                  {FAQS.map((f) => (
                    <details key={f.q} className="faq-list__item">
                      <summary>
                        <span>{f.q}</span>
                        <Icon name="chevron-down" size={18} />
                      </summary>
                      <p>{f.a}</p>
                    </details>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {tab === 'ticket' ? (
            <form
              className="card ticket-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="ticket-form__head">
                <h2>Raise a ticket</h2>
                <p>Tell us what went wrong. Our team replies here, in My tickets.</p>
              </div>
              <FieldShell label="Topic">
                {({ id }) => (
                  <select id={id} className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {SUPPORT_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                )}
              </FieldShell>
              {recent.length ? (
                <FieldShell label="Related booking">
                  {({ id }) => (
                    <select id={id} className="select" value={bookingChoice} onChange={(e) => setBookingChoice(e.target.value)}>
                      <option value="">Not about a booking</option>
                      {recent.map((t) => (
                        <option key={t.id} value={t.bookingId}>
                          {t.bookingId} · {t.pickup.name} → {t.drop.name}
                        </option>
                      ))}
                      <option value={OTHER}>Another booking ID…</option>
                    </select>
                  )}
                </FieldShell>
              ) : null}
              {!recent.length || bookingChoice === OTHER ? (
                <TextField
                  label={
                    <>
                      Booking ID <small>(optional)</small>
                    </>
                  }
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                  placeholder="e.g. NTT-2026-000062"
                  autoComplete="off"
                />
              ) : null}
              <TextArea
                label="What happened?"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
                hint={`Include the date and time if it is about a trip. ${description.length}/${MAX_DESCRIPTION}`}
                placeholder="Describe the issue"
              />
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Button type="submit" block loading={sending} icon="send">
                Submit ticket
              </Button>
            </form>
          ) : null}

          {tab === 'mine' ? (
            <div className="stack">
              {submitted ? <Notice tone="success">Your ticket was submitted. Our team will get back to you here.</Notice> : null}
              {listError ? <Notice tone="error">{listError}</Notice> : null}
              {!profile ? (
                <div className="card card--center">
                  <EmptyState
                    art="support"
                    title="Sign in to view tickets"
                    action={
                      <Button variant="primary" onClick={() => openLoginModal({ title: 'Sign in to view tickets' })}>
                        Sign in
                      </Button>
                    }
                  >
                    Sign in with your mobile number to view tickets you’ve raised.
                  </EmptyState>
                </div>
              ) : tickets.length === 0 ? (
                <div className="card card--center">
                  <EmptyState
                    art="support"
                    title="No tickets yet"
                    action={
                      <Button variant="secondary" onClick={() => setTab('ticket')}>
                        Raise a ticket
                      </Button>
                    }
                  >
                    Tickets you raise will be tracked here.
                  </EmptyState>
                </div>
              ) : (
                <ul className="card card--list ticket-list">
                  {tickets.map((t) => (
                    <li key={t.id} className="ticket-list__item">
                      <div className="ticket-list__head">
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

        <div className="support-policies">
          <PolicyLinks lead="Customer policies:" ids={['cancellation', 'refund', 'safety', 'privacy']} />
        </div>
      </div>
    </>
  );
}
