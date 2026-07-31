/**
 * Direct-to-R2 lesson-video upload. The backend hands back a presigned PUT ticket; the
 * browser PUTs the file straight to R2 (never through the app server), so a 2 GB video is
 * fine. Requires the bucket's CORS policy to allow this origin.
 */

export interface VideoUploadTicket {
  upload_url: string;
  key: string;
  content_type: string;
  max_bytes: number;
  expires_in?: number;
}

export const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,video/ogg,video/x-matroska,.mp4,.mov,.m4v,.webm,.ogg,.ogv,.mkv";

/** PUT a file to R2 via the presigned URL, reporting progress as a 0..1 fraction. */
export function uploadVideoToR2(
  ticket: VideoUploadTicket,
  file: File,
  onProgress?: (fraction: number) => void,
): { promise: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", ticket.upload_url, true);
    // Must match the Content-Type the backend signed, or R2 rejects the signature.
    xhr.setRequestHeader("Content-Type", ticket.content_type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (storage responded ${xhr.status}).`));
    };
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.onerror = () =>
      reject(
        new Error(
          "Upload was blocked. The video storage may not allow uploads from this site yet (CORS). You can paste a link instead for now.",
        ),
      );
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
