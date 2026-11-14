// Outstation Round Trip requests this fleet's drivers filed directly (requestRoundTripDuty): the
// vendor only approves or declines — the server (decideDriverTripRequest) does the actual
// eligibility, document and schedule-overlap re-check and assignment. No other trip type reaches here.
import React, { useState } from 'react';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { Badge, Between, Btn, Empty, Feedback, Grid, Inline, KV, Panel, SectionLine, Small, Stack } from '../../components/kit/core';
import { dayTime } from '../../components/kit/format';
import { ActionError } from '../../services/callables';
import { approveDriverTripRequest, rejectDriverTripRequest, requestIsOpen, type DriverTripRequest } from '../../services/driverTripRequests';

export function DriverTripRequestsScreen() {
  const d = useVendorData();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const decide = async (r: DriverTripRequest, decision: 'approve' | 'reject') => {
    setBusyId(r.id);
    setError('');
    try {
      await (decision === 'approve' ? approveDriverTripRequest(r.id) : rejectDriverTripRequest(r.id));
    } catch (e) {
      setError(e instanceof ActionError ? e.message : `Could not ${decision === 'approve' ? 'approve' : 'decline'} this request.`);
    } finally {
      setBusyId(null);
    }
  };

  const open = d.tripRequests.filter(requestIsOpen);
  const decided = d.tripRequests.filter((r) => !requestIsOpen(r)).slice(0, 20);

  return (
    <Page title="Round trip requests" subtitle="Drivers who asked to take an Outstation Round Trip directly, before it is assigned.">
      {d.errors.tripRequests ? <Feedback tone="error" message={d.errors.tripRequests} /> : null}
      {error ? <Feedback tone="error" message={error} /> : null}
      <SectionLine title="Waiting for your decision" meta={`${open.length} ${open.length === 1 ? 'request' : 'requests'}`} />
      {open.length ? (
        <Grid gap={14}>
          {open.map((r) => (
            <Panel key={r.id}>
              <Stack gap={8}>
                <Between>
                  <Small>{r.requestedAt ? dayTime(r.requestedAt) : '—'}</Small>
                  <Badge label="Pending" tone="amber" />
                </Between>
                <KV rows={[['Driver', r.driverName || '—'], ['Vehicle', r.vehicleNumber || '—'], ['Booking', r.bookingCode]]} />
                <Inline style={{ marginTop: 6 }}>
                  <Btn title="Approve" kind="primary" busy={busyId === r.id} disabled={busyId !== null && busyId !== r.id} onPress={() => void decide(r, 'approve')} />
                  <Btn title="Decline" kind="secondary" busy={false} disabled={busyId !== null} onPress={() => void decide(r, 'reject')} />
                </Inline>
              </Stack>
            </Panel>
          ))}
        </Grid>
      ) : (
        <Empty icon="checkmark-done-outline" title="No requests waiting" text="A driver's round-trip request appears here until you approve or decline it." />
      )}
      {decided.length ? (
        <>
          <SectionLine title="Recently decided" />
          <Grid gap={10}>
            {decided.map((r) => (
              <Panel key={r.id}>
                <Between>
                  <Small>{r.driverName || '—'} · {r.bookingCode}</Small>
                  <Badge label={r.status} tone={r.status === 'Approved' ? 'green' : 'neutral'} />
                </Between>
              </Panel>
            ))}
          </Grid>
        </>
      ) : null}
    </Page>
  );
}
