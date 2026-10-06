import { navigationContainerRef } from '../App';
import { getTopRouteName } from './linking';

export const navigateAfterAuth = (
  pendingClub: unknown,
  { preserveLocation }: { preserveLocation: boolean },
) => {
  if (!navigationContainerRef.current) return;

  const topRoute = getTopRouteName(navigationContainerRef.current.getRootState?.());
  if (!pendingClub && preserveLocation &&
      (topRoute === 'Home' || topRoute === 'Prospect Profile Screen')) {
    return;
  }

  navigationContainerRef.reset({
    routes: [ { name: 'Home', state: { routes: [ { name: 'Search' } ] } } ]
  });
};
