export const upload = {
  title: 'Upload',
  dropzone: {
    cta: 'Tap to pick photos and videos',
    hint: 'or drag files here',
    addMore: 'Add more files',
  },
  queue: {
    canceled: 'Canceled',
    skipped: 'Already in the tray',
  },
  summary: {
    uploading: '{n} uploading',
    queued: '{n} queued',
    done: '{n} uploaded',
    skipped: '{n} already there',
    errors: '{n} failed',
    keepOpen: 'Keep the app open until the upload finishes',
    doneTitle: 'Upload complete',
    organizeNow: 'Organize now',
    retryFailed: 'Retry failed',
    cancelPending: 'Cancel pending',
    clearFinished: 'Clear finished',
  },
  toastDone: 'Upload complete | 1 file uploaded | {n} files uploaded',
  toastSkipped:
    'Files already in the tray | 1 file was already in the tray | {n} files were already in the tray',
} as const
