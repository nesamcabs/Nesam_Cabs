// Account pages: a sidebar on desktop (who is signed in, the account sections, "Book a cab"),
// and the page alone on phones and tablets (the bottom navigation's Account tab leads here).
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useCustomerData } from '@/state/CustomerData';
import { useAuth } from '@/state/Auth';
import { useInbox } from '@/state/Inbox';
import { Avatar, Button, EmptyState, LinkButton } from './ui';
import { Icon } from './Icon';

const LINKS = [
  { to: '/account', label: 'Overview', icon: 'profile', end: true },
  { to: '/trips', label: 'My Bookings', icon: 'booking' },
  { to: '/account/payments', label: 'Payments & Refunds', icon: 'wallet' },
  { to: '/account/edit', label: 'My Profile', icon: 'profile' },
  { to: '/account/places', label: 'Saved addresses', icon: 'saved-place' },
  { to: '/notifications', label: 'Notifications', icon: 'notifications' },
  { to: '/offers', label: 'Offers', icon: 'offers' },
  { to: '/support', label: 'Help & Support', icon: 'support' },
  { to: '/legal', label: 'Terms & privacy', icon: 'document' },
];

export function AccountLayout({ children }: { children: ReactNode }) {
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const { unreadCount } = useInbox();
  return (
    <div className="acct-page">
      <div className="wrap acct">
        <aside className="acct__side" aria-label="Account sections">
          <div className="acct__who">
            {profile ? <Avatar name={profile.name} photoUrl={profile.photoUrl} size={44} /> : <span className="acct__guest" aria-hidden="true"><Icon name="profile" size={20} /></span>}
            <strong>{profile ? profile.name : 'Guest'}</strong>
            <small>{profile ? 'Your NESAM account' : 'Sign in to see your bookings'}</small>
            {!profile ? (
              <Button size="sm" onClick={() => openLoginModal({ title: 'Continue with mobile' })}>
                Sign in
              </Button>
            ) : null}
          </div>
          <nav className="acct__nav">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `acct__link ${isActive ? 'is-active' : ''}`}>
                <Icon name={l.icon} size={16} />
                <span>{l.label}</span>
                {l.to === '/notifications' && unreadCount > 0 ? <em className="count count--soft">{unreadCount > 9 ? '9+' : unreadCount}</em> : null}
              </NavLink>
            ))}
          </nav>
          <LinkButton to="/book" variant="secondary" block icon="add">
            Book a cab
          </LinkButton>
        </aside>
        <div className="acct__main">{children}</div>
      </div>
    </div>
  );
}

/** What an account page shows to a guest. */
export function SignInPrompt({ title, text, art = 'welcome' }: { title: string; text: string; art?: string }) {
  const { openLoginModal } = useAuth();
  return (
    <div className="card card--center">
      <EmptyState
        art={art}
        title={title}
        action={
          <Button icon="profile" onClick={() => openLoginModal({ title: 'Continue with mobile' })}>
            Sign in
          </Button>
        }
      >
        {text}
      </EmptyState>
    </div>
  );
}
