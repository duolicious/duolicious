import { useEffect, useMemo, useState } from 'react';
import debounce from 'lodash/debounce';
import { getDraftMessage, setDraftMessage } from '../../../kv-storage/draft-messages';
import { sessionPersonUuid } from '../../../kv-storage/session-token';

// A React hook that loads and persists a draft message for a specific
// sender/recipient pair. While loading the draft, it returns `undefined`.
// Once loaded, if there is no draft it returns the empty string.
// Updates are written to storage immediately (fire-and-forget).
const useDraftMessage = (
  recipientPersonUuid: string | null | undefined,
): [string | null, (draft: string) => void] => {
  // Current logged-in user UUID (sender)
  const [senderPersonUuid, setSenderPersonUuid] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const uuid = await sessionPersonUuid();
      setSenderPersonUuid(uuid ?? null);
    })();
  }, []);

  // Load draft when the identifiers become available / change.
  useEffect(() => {
    if (!senderPersonUuid || !recipientPersonUuid) return;

    let isCancelled = false;
    (async () => {
      const loaded = await getDraftMessage(senderPersonUuid, recipientPersonUuid);
      if (!isCancelled) {
        setDraft(loaded ?? '');
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [senderPersonUuid, recipientPersonUuid]);

  // Debounced persist using lodash – rebuilt when the conversation identifiers change.
  const saveDraft = useMemo(
    () => debounce(
      (value: string) => {
        if (senderPersonUuid && recipientPersonUuid) {
          setDraftMessage(
            senderPersonUuid,
            recipientPersonUuid,
            value
          ).catch(
            console.error
          );
        }
      },
      500
    ),
    [senderPersonUuid, recipientPersonUuid]
  );

  // Flush pending writes on unmount/navigation so we don't lose the last edits.
  useEffect(() => {
    return () => saveDraft?.flush();
  }, [saveDraft]);

  if (!(senderPersonUuid && recipientPersonUuid) && draft !== null) {
    setDraft(null);
  }

  return [draft, saveDraft];
};

export { useDraftMessage };
