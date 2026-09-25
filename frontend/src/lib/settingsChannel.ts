/**
 * Word between the venue editor and the multiview when both are open.
 *
 * They are windows of the same app on the same origin, so a BroadcastChannel reaches
 * across without the shell. The multiview would notice a saved change on its next
 * poll anyway (the API reports a new venues version); this only makes it immediate.
 */

const CHANNEL = 'taiko-multiview:settings';

export function announceVenuesSaved(): void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: 'venues-saved' });
    channel.close();
  } catch {
    // No BroadcastChannel: the next poll still picks the change up.
  }
}

export function onVenuesSaved(listener: () => void): () => void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => {
      if ((event.data as { type?: string } | null)?.type === 'venues-saved') {
        listener();
      }
    };
    return () => channel.close();
  } catch {
    return () => {};
  }
}
