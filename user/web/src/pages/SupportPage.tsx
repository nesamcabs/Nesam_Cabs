import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SupportTicket } from '@core/types';
import { useCustomerData } from '@core/context/CustomerData';
import { SUPPORT_CATEGORIES, submitSupportTicket, subscribeToSupportTickets } from '@core/services/userService';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { describeError } from '@core/utils/retry';
import { Badge, Button, EmptyState, FieldShell, Notice, PageHead, TextArea, TextField } from '@/components/ui';
import { FAQS } from '@/pages/book/content';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/state/Auth';
import { useSeo } from '@/lib/seo';
import { SUPPORT_SEO } from '@/seo/pages';
import { PolicyLinks } from '@/pages/PolicySections';

type Tab = 'help' | 'ticket' | 'mine';

export function SupportPage() {
  useSeo(SUPPORT_SEO);
  const [params] = useSearchParams();
  const initialBooking = params.get('booking') ?? '';
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const [tab, setTab] = useState<Tab>(initialBooking ? 'ticket' : 'help');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [category, setCategory] = useState(SUPPORT_CATEGORIES[0]!);
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
      await submitSupportTicket(profile, { category, bookingId, description }, 'nesam');
      setDescription('');
      setBookingId('');
      setSubmitted(true);
      setTab('mine');
    } catch (e) {
      setError(describeError(e, 'We couldn’t submit your ticket. Please try again or call support.'));
    } finally {
      setSending(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'help', label: 'Help' },
    { id: 'ticket', label: 'Raise a ticket' },
    { id: 'mine', label: `My tickets (${tickets.length})` },
  ];

  return (
    <>
      <PageHead eyebrow="We’re here to help" title="Help and support">
        Answers, a direct line to NESAM Cabs, and a way to raise an issue with a trip.
      </PageHead>

      <div className="page">
        <div className="tabs" role="tablist" aria-label="Support sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="support">
          <div className="support__main" role="tabpanel">
            {tab === 'help' ? (
              <div className="faq faq--grid">
                {FAQS.map((f) => (
                  <details key={f.q} className="faq__item">
                    <summary>
                      <span>{f.q}</span>
                      <Icon name="chevron-down" size={20} />
                    </summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </div>
            ) : null}

            {tab === 'ticket' ? (
              <form
                className="card form-card"
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
                <TextField
                  label={
                    <>
                      Booking ID <small>(optional)</small>
                    </>
                  }
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                  placeholder="e.g. NT-1042"
                  autoComplete="off"
                />
                <TextArea label="Describe the issue" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 2000))} hint="Tell us what happened and when." placeholder="What went wrong?" />
                {error ? <Notice tone="error">{error}</Notice> : null}
                <div className="form-actions">
                  <Button type="submit" loading={sending}>
                    Submit ticket
                  </Button>
                </div>
              </form>
            ) : null}

            {tab === 'mine' ? (
              <div className="stack">
                {submitted ? <Notice tone="success">Your ticket was submitted. Our team will get back to you.</Notice> : null}
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
                  <ul className="card card--list">
                    {tickets.map((t) => (
                      <li key={t.id} className="ticket">
                        <div className="ticket__head">
                          <strong>{t.category || 'Support request'}</strong>
                          <Badge tone={t.status === 'Resolved' || t.status === 'Closed' ? 'green' : t.status === 'In Progress' ? 'blue' : 'amber'} dot>
                            {t.status}
                          </Badge>
                        </div>
                        <p>{t.description}</p>
                        <small className="muted">
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
            <section className="contact-card">
              <img src="/website-images/web/photography/trust-support.webp" alt="" width={724} height={543} loading="lazy" />
              <div className="contact-card__body">
                <h2>Talk to NESAM Cabs</h2>
                <p>Need help with a ride in progress? Call us — we’re here around the clock.</p>
                <a className="btn btn--primary btn--block" href={`tel:${SUPPORT_PHONE}`}>
                  <Icon name="phone" /> Call {SUPPORT_PHONE_DISPLAY}
                </a>
                {tab !== 'ticket' ? (
                  <Button variant="secondary" block onClick={() => setTab('ticket')}>
                    Raise a ticket
                  </Button>
                ) : null}
                <PolicyLinks lead="Customer policies:" ids={['cancellation', 'refund', 'safety', 'privacy']} />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
