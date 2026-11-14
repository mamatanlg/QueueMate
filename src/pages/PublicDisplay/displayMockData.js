import advertisementArtwork from './campus-ad-preview.svg'

export const displayWindows = [
  { number: 1, status: 'Available', ticket: '042' },
  { number: 2, status: 'Available', ticket: '039' },
  { number: 3, status: 'Available', ticket: null },
  { number: 4, status: 'Unavailable', ticket: null },
]

export const latestQueueNumber = '047'
export const queueEntryAccessCode = 'QM-47K2'
export const queueEntryDemoUrl = `https://queuemate.example/queue?code=${queueEntryAccessCode}`
export const displayAdvertisement = [
  {
    eyebrow: 'CAMPUS ADVERTISEMENT PREVIEW',
    title: 'Campus Advertisement',
    description: 'Placeholder artwork for the QueueMate public display.',
    note: 'Replace with approved school promotional materials.',
    image: advertisementArtwork,
  },
]
