import { ApiResponse, api, japi } from './api';
import { SOMETHING_WENT_WRONG, notifyErrorToast } from '../components/toast';
import { delay } from '../util/util';

type VideoJob = {
  uuid: string
  position: number
  status: 'queued' | 'running' | 'failure'
  message: string
};

type VideoJobResult =
  | { ok: true, photoUuid: string }
  | { ok: false, message: string };

const put = (
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<boolean> => new Promise((resolve) => {
  const xhr = new XMLHttpRequest();

  xhr.open('PUT', url);
  xhr.setRequestHeader('Content-Type', contentType);
  xhr.upload.onprogress = (event) => onProgress(event.loaded / event.total);
  xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
  xhr.onerror = () => resolve(false);
  xhr.send(body);
});

const notifyFailedRequest = ({ status, text }: ApiResponse) => notifyErrorToast(
  status === 429 ? 'You can upload 10 videos a day. Try again tomorrow.' :
  [400, 409, 503].includes(status) && text ? text :
  SOMETHING_WENT_WRONG
);

const startVideoUpload = async (
  position: number,
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<string | null> => {
  const upload = await japi<{ uuid: string, upload_url: string }>(
    'post',
    '/video-upload',
    { position, byte_size: body.size, content_type: contentType },
  );

  if (!upload.ok || !upload.json) {
    notifyFailedRequest(upload);
    return null;
  }

  const { uuid, upload_url } = upload.json;

  let uploaded = false;
  for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
    uploaded = await put(upload_url, body, contentType, onProgress);
  }

  if (!uploaded) {
    notifyErrorToast("Your video didn't finish uploading. Please try again");
    return null;
  }

  const done = await api('post', `/video-upload/${uuid}/done`);

  if (!done.ok) {
    notifyFailedRequest(done);
    return null;
  }

  return uuid;
};

const waitForVideoJob = async (
  uuid: string,
): Promise<VideoJobResult | null> => {
  while (true) {
    await delay(2000);

    const { status, json } = await api<{
      status: string
      message: string
      photo_uuid: string | null
    }>('get', `/video-upload/${uuid}`);

    if (status === 401) {
      return null;
    }

    if (json?.photo_uuid) {
      return { ok: true, photoUuid: json.photo_uuid };
    }

    if (json?.status === 'failure' || status === 404) {
      return { ok: false, message: json?.message || SOMETHING_WENT_WRONG };
    }
  }
};

export {
  VideoJob,
  startVideoUpload,
  waitForVideoJob,
};
