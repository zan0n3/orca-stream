import React from 'react'
import { Separator } from '@/components/ui/separator'
import { SunoCreateJobCard } from './SunoCreateJobCard'
import { SunoSongWriter } from './SunoSongWriter'
import { SunoTrackList } from './SunoTrackList'
import { useSunoJob, useSunoTracks } from './use-suno-music'

/** Suno tab of the Orca Stream panel: write a song, make it on Suno, then preview and play it on stream. */
export default function SunoPanel(): React.JSX.Element {
  const library = useSunoTracks()
  const { job, create, togglePlay, download } = useSunoJob(library.refresh)
  const creating = job.phase === 'creating' || job.phase === 'generating'
  return (
    <div className="scrollbar-sleek h-full space-y-4 overflow-y-auto px-3 py-3">
      <SunoSongWriter creating={creating} onCreate={(draft) => void create(draft)} />
      <SunoCreateJobCard job={job} onTogglePlay={togglePlay} onDownload={download} />
      <Separator />
      <SunoTrackList library={library} />
    </div>
  )
}
