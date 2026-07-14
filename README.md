# Groove

Groove is a vinyl-themed music player you run locally in a browser. It has playlists, a signature "Groove Notes" feature for pinning timestamped notes onto a song, an audio-reactive waveform, and pages for browsing, favoriting, and charting your most-played tracks. Everything is built with plain HTML, CSS, and JavaScript, no frameworks or build step required.

## Live Link
🔗: https://sumreen-sf.github.io/MusicPlayer_CodeAlpha/

## Getting started

The app needs to be served by a local web server. Opening `index.html` directly by double-clicking it (a `file://` URL) will not work, because the browser blocks the AudioContext and CORS behavior the player relies on.

If you have VS Code, the easiest option is the Live Server extension: right-click `index.html` and choose "Open with Live Server".

If you'd rather use the command line, Python's built-in server works fine:

```
python3 -m http.server
```

Then open `http://localhost:8000` in your browser.

## Adding your music

Groove ships with a small demo library, but it's meant to hold your own music. There are two ways to add a track:

1. Click "+ Add Music" and upload an audio file from your device.
2. Click "+ Add Music" and paste a direct link to an audio file hosted somewhere.

Groove can't connect to streaming catalogs like Spotify or YouTube Music. There's no public API that allows a third-party app to play arbitrary catalog audio, so this only works with files you own or host yourself.

Each track can have its own cover image too. If you don't set one, Groove generates an abstract cover from the track's title, so you're never looking at a blank square.

## Features

**Playlists.** Create as many as you like, and delete any playlist you no longer want. Groove always keeps at least one playlist around so you're never left without a home for your tracks.

**Groove Notes.** Pin a short note to any point in a song. A small gold marker appears on the seek bar. Hover it to read the note, click it to jump straight to that moment. Useful for marking a favorite bridge, a lyric you want to remember, or a cue for a DJ set.

**Browse.** Shows your most and least listened tracks, plus every playlist you have, as clickable cards.

**Charts.** A ranked list of your most-played songs, and a leaderboard of your most-used playlists based on how much their tracks have been played.

**Favorites.** Heart any track from anywhere in the app (the queue, Browse, Charts) and it shows up on your Favorites page.

**Delete.** Both tracks and playlists can be deleted, with a confirmation window first. Deleting a track removes it from every playlist, from Favorites, from any Groove Notes attached to it, and from your play count history.

**Responsive layout.** The app adapts down to phone-sized screens. Below a certain width, the sidebar becomes a slide-out drawer you open with the menu button in the top left.

## How your data is stored

Groove runs entirely in your browser and doesn't send anything to a server. Your data lives in two places:

- **localStorage** holds small, structured data: your playlists, Groove Notes, play counts, favorites, and the titles and artists of tracks you've added.
- **IndexedDB** holds the actual audio and cover image files you upload. Browsers don't let you keep an uploaded file's temporary link around after a page refresh, so the real file is stored here and a fresh link is created each time you open the app.

This means your library, playlists, and notes will still be there the next time you open Groove in the same browser. If you clear your browser's site data, or open the app in a different browser or a private window, that data won't be there, since none of it leaves your machine.

Tracks you paste in as a direct link are the exception. Those are just stored as a URL, so they'll keep working as long as the link itself stays valid.

## Project structure

```
index.html   the page structure and layout
style.css    all styling, including the responsive breakpoints
script.js    everything else: playback, playlists, storage, and the UI logic
```

There's no build process. Editing any of these three files and refreshing the browser is enough to see your changes.

## A few things worth knowing

- Track IDs are assigned in the order tracks are defined in `script.js`. If you add, remove, or reorder the built-in tracks at the top of the file by hand, any playlists or notes you've already saved could end up pointing at the wrong track. Adding new tracks through the "+ Add Music" button in the app doesn't have this problem.
- Album art you haven't set yourself is generated on the fly from the track's title, so it stays visually consistent with the rest of the app instead of pulling in outside images.
- The waveform visualizer uses the Web Audio API, which is part of why the app needs to be served over a local server rather than opened as a plain file.

## Credits

Fonts used are Fraunces, Space Grotesk, and Space Mono, all loaded from Google Fonts.
