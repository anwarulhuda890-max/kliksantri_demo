import { CommonActions } from '@react-navigation/native';

export async function navigateFromNotification(navigationRef, payload, { anak, setActiveSantri }) {
  if (!navigationRef?.isReady?.()) return;

  const santriId = payload?.santri_id != null ? Number(payload.santri_id) : null;
  const unitId = payload?.unit_id != null ? Number(payload.unit_id) : null;

  if (santriId && Array.isArray(anak) && anak.length > 0 && setActiveSantri) {
    const matches = anak.filter(
      (item) => Number(item.santri_id ?? item.id) === santriId,
    );
    const child = unitId != null
      ? matches.find((item) => Number(item.unit_id) === unitId)
      : matches.length === 1 ? matches[0] : null;
    if (child) {
      await setActiveSantri(child);
    }
  }

  navigationRef.dispatch(
    CommonActions.navigate({
      name: 'Notifications',
    }),
  );
}

export async function setupNotificationNavigation(
  navigationRef,
  { getAnak, setActiveSantri },
) {
  let Notifications;
  try {
    Notifications = require('expo-notifications');
  } catch {
    return () => {};
  }

  Notifications.setNotificationHandler({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });

  async function handleResponse(response) {
    const data = response?.notification?.request?.content?.data;
    if (!data) return;
    const anak = typeof getAnak === 'function' ? getAnak() : getAnak;
    await navigateFromNotification(navigationRef, data, { anak, setActiveSantri });
  }

  const subscription =
    Notifications.addNotificationResponseReceivedListener(handleResponse);

  try {
    const lastResponse =
      await Notifications.getLastNotificationResponseAsync();
    if (lastResponse) {
      handleResponse(lastResponse);
    }
  } catch {}

  return () => subscription.remove();
}
