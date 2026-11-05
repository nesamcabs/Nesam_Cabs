import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GeoPlace, LatLng, LocationItem } from '@core/types';
import { isValidLatLng } from '@core/utils/geo';
import { useCustomerData } from '@/state/CustomerData';
import { deleteSavedPlace, savePlace } from '@core/services/userService';
import { describeError } from '@core/utils/retry';
import { Button, Dialog, EmptyState, Notice, PageHead, Segmented, TextField } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { PlaceSuggestions } from '@/components/PlaceSuggestions';
import { useDeviceLocation } from '@/lib/hooks';
import { useBooking } from '@/state/Booking';
import { AccountLayout, SignInPrompt } from '@/components/AccountLayout';
import { useSeo } from '@/lib/seo';

type Kind = 'home' | 'work' | 'favorite';
const ICON: Record<string, string> = { home: 'home', work: 'briefcase', favorite: 'star' };

function AddPlaceDialog({ onClose }: { onClose: () => void }) {
  const { profile, savedPlaces } = useCustomerData();
  const { position } = useDeviceLocation(false);
  const [kind, setKind] = useState<Kind>('favorite');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<GeoPlace | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!picked) return setError('Search for the place to save.');
    if (!profile) return setError('Sign in to save this place.');
    const name = kind === 'home' ? 'Home' : kind === 'work' ? 'Work' : label.trim() || picked.name;
    // Only one Home and one Work: replace the existing entry.
    const existing = kind !== 'favorite' ? savedPlaces.find((p) => p.type === kind) : undefined;
    setBusy(true);
    setError('');
    try {
      await savePlace({ ...picked, id: existing?.id ?? '', name, address: picked.address, type: kind }, profile.uid);
      onClose();
    } catch (e) {
      setError(describeError(e, 'We couldn’t save this place.'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Add a saved place"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!picked} onClick={() => void save()}>
            Save place
          </Button>
        </>
      }
    >
      <div className="stack">
        <Segmented
          label="Place type"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'home', label: 'Home' },
            { value: 'work', label: 'Work' },
            { value: 'favorite', label: 'Favourite' },
          ]}
        />
        {picked ? (
          <div className="picked">
            <Icon name="location-pin" />
            <div>
              <strong>{picked.name}</strong>
              <small className="muted">{picked.address}</small>
            </div>
            <button type="button" className="link-btn" onClick={() => setPicked(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <div className="search search--field">
              <Icon name="search" size={18} />
              <label className="sr-only" htmlFor="place-q">
                Search address, street or landmark
              </label>
              <input id="place-q" data-autofocus type="search" placeholder="Search address, street or landmark" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            </div>
            <PlaceSuggestions query={query} near={position} saved={[]} recent={[]} onSelect={setPicked} />
          </>
        )}
        {kind === 'favorite' && picked ? <TextField label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 40))} placeholder="e.g. Hospital, College, Mom’s house" /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
    </Dialog>
  );
}

export function SavedPlacesPage() {
  useSeo({ title: 'Saved Places', noindex: true });
  const { savedPlaces, profile } = useCustomerData();
  const { update } = useBooking();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<LocationItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!profile) {
    return (
      <AccountLayout>
        <PageHead backTo="/account" title="Saved addresses">
          Your regular pickup and drop places — one tap when booking.
        </PageHead>
        <SignInPrompt title="Sign in to view saved addresses" text="Sign in with your mobile number to save home, work and favourite places for quick booking." />
      </AccountLayout>
    );
  }

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteSavedPlace(removing.id);
      setRemoving(null);
    } catch (e) {
      setError(describeError(e, 'We couldn’t remove this place.'));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  };

  const order = (p: LocationItem) => (p.type === 'home' ? 0 : p.type === 'work' ? 1 : 2);
  const sorted = [...savedPlaces].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));

  return (
    <AccountLayout>
      <PageHead
        backTo="/account"
        title="Saved addresses"
        actions={
          <Button icon="add" size="sm" onClick={() => setAdding(true)}>
            Add address
          </Button>
        }
      >
        Your regular pickup and drop places — one tap when booking.
      </PageHead>
      <div className="stack">
        {error ? <Notice tone="error">{error}</Notice> : null}

        {sorted.length === 0 ? (
          <div className="card card--center">
            <EmptyState
              icon="saved-place"
              title="No saved addresses yet"
              action={
                <Button icon="add" onClick={() => setAdding(true)}>
                  Add your first place
                </Button>
              }
            >
              Save Home and Work to start a booking in one tap.
            </EmptyState>
          </div>
        ) : (
          <ul className="place-grid">
            {sorted.map((p) => (
              <li key={p.id} className="saved">
                <span className="saved__icon">
                  <Icon name={ICON[p.type] ?? 'saved-place'} size={18} />
                </span>
                <span className="saved__text">
                  <strong>{p.name}</strong>
                  <small>{p.address}</small>
                </span>
                {isValidLatLng(p as Partial<LatLng>) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    trailing="arrow-up-right"
                    onClick={() => {
                      update({ pickup: p as GeoPlace });
                      navigate('/book');
                    }}
                  >
                    Book from here
                  </Button>
                ) : null}
                <button type="button" className="icon-btn" aria-label={`Remove ${p.name}`} onClick={() => setRemoving(p)}>
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {adding ? <AddPlaceDialog onClose={() => setAdding(false)} /> : null}
      {removing ? (
        <Dialog
          title="Remove this place?"
          onClose={() => setRemoving(null)}
          dismissible={!busy}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)} disabled={busy}>
                Keep
              </Button>
              <Button variant="primary" loading={busy} onClick={() => void remove()}>
                Remove
              </Button>
            </>
          }
        >
          <p className="muted">“{removing.name}” will be removed from your saved places.</p>
        </Dialog>
      ) : null}
    </AccountLayout>
  );
}
