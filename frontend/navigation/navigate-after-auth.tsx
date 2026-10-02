import { navigationContainerRef } from '../App';
import { getTopRouteName } from './linking';
import { landingTab } from '../util/trials';

export const navigateAfterAuth = (
  pendingClub: unknown,
  personId: number,
  { preserveLocation }: { preserveLocation: boolean },
) => {
  if (!navigationContainerRef.current) return;

  if (pendingClub) {
    navigationContainerRef.reset({
      routes: [ { name: "Home", state: { routes: [ { name: "Search" } ] } } ]
    });
    return;
  }

  const topRoute = getTopRouteName(navigationContainerRef.current.getRootState?.());
  if (preserveLocation &&
      (topRoute === 'Home' || topRoute === 'Prospect Profile Screen')) {
    return;
  }

  navigationContainerRef.reset({
    routes: [ { name: 'Home', state: { routes: [ { name: landingTab(personId) } ] } } ]
  });
};
