// The state tag on a duty card: pickup state, then drop state.
import { stateRoute } from '../src/utils/places';

describe('the state tag of a duty', () => {
  it.each([
    ['Pondicherry', 'Trichy', 'PY-TN'],
    ['Theni, Tamil Nadu, India', 'Munnar', 'TN-KL'],
    ['Madurai', 'Tirupati', 'TN-AP'],
    ['Chennai Central', 'Bangalore Airport', 'TN-KA'],
    ['Coimbatore, Tamil Nadu 641001', 'Idukki, Kerala', 'TN-KL'],
    ['Chennai', 'Madurai', 'TN'],
    // A road named after another town does not move the pickup there.
    ['Pondicherry Road, Chennai', 'Mysore Road, Bengaluru', 'TN-KA'],
    // Puducherry town's PIN codes are inside the Tamil Nadu range; the ones beside them are Tamil Nadu.
    ['12 Mission Street 605001', 'Bus Stand Road 605602', 'PY-TN'],
    ['Somewhere unknown', 'Trichy', 'TN'],
    ['Somewhere unknown', 'Another place', ''],
  ])('%s to %s reads "%s"', (from, to, tag) => {
    expect(stateRoute(from, to)).toBe(tag);
  });
});
