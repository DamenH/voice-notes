# Manual checks

Things automated tests can't cover: they need a real device or a human sign-in.
Tick them off on the deployed app (https://damenh.github.io/voice-notes/).

## OpenRouter sign-in (OAuth PKCE)
- [ ] Settings → Connect OpenRouter → sign in → you return to the same screen with
      "Connected to OpenRouter". (Automated tests verify the authorization URL,
      the PKCE challenge and the state check, but not the real sign-in page.)
- [ ] Repeat from the installed app on Android: the callback may open in the
      browser rather than the app; the verifier is in localStorage so either
      completes the sign-in. Note which happens.
- [ ] Disconnect removes the key; recording still works; model steps show
      "Connect OpenRouter".

## Android (Chrome)
- [ ] Install from the browser menu ("Install app"); it opens standalone with the icon.
- [ ] Record for 1–2 minutes with the screen on: level meter moves, timer counts.
- [ ] **Screen lock during recording:** lock the phone for 30 s, unlock. Expected:
      the screen wake lock keeps the screen on while the app is visible; if the
      user locks it manually, Chrome usually keeps capturing while a microphone
      stream is active (the tab shows the mic indicator). Record what happened:
      does the timer keep counting? Is the audio continuous on playback?
- [ ] **Switching apps during recording:** switch to another app for 30 s and back.
      Same questions as above.
- [ ] If capture was suspended, the app shows a warning and keeps everything saved
      up to that point (audio is saved every 5 s). Force-close the app while
      recording, reopen: the recording shows "Interrupted — saved up to here" and plays.
- [ ] Long recording: 20+ minutes, then let the default pipeline run. Check the
      transcript covers the whole recording and the timestamps line up.
- [ ] Storage: Settings → Storage shows usage; "Keep my data" makes storage persistent
      (installed apps are usually granted it automatically).
- [ ] Read aloud plays through the phone speaker; auto-speak works after a response.

## Desktop
- [ ] Install from Chrome/Edge; with window-controls-overlay the title bar area is draggable.
- [ ] Offline: turn off the network, reopen the installed app, browse and play
      recordings, record a new one; it shows "Waiting for a connection" and
      processes when back online.
- [ ] Update prompt: after a new deploy, "A new version is ready" appears; Reload is
      disabled while recording.

## Results log

| Date | Device / browser | Check | Result |
| --- | --- | --- | --- |
| | | | |
