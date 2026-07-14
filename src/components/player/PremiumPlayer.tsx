"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import Hls from "hls.js";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  SkipBack,
  SkipForward,
  Crown,
  Sparkles,
  Server,
  Loader2,
  Subtitles,
  Check,
  ChevronRight,
  X,
  ListVideo,
  FastForward,
  LayoutGrid,
  Activity,
  Globe,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Caption {
  file?: string;
  url?: string;
  label?: string;
  language?: string;
}

interface PremiumPlayerProps {
  logo?: string;
  poster?: string;
  color?: string;
  streamUrl: string;
  downloadUrl?: string;
  captions?: Caption[];
  defaultSubtitlesLanguage?: string;
  onTimeUpdate?: (position: number) => void;
  onComplete?: () => void;
  onError?: () => void;
  onServerChange?: () => void;
  autoplay?: boolean;
  server?: boolean;
  serverName?: string;
  servers?: { id: string; name: string; status?: 'online' | 'offline' }[];
  onServerSelect?: (id: string) => void;
  title?: string;
  year?: string;
  season?: string;
  episode?: string;
  onNextEpisode?: () => void;
  onEpisodeChange?: (season: number, episode: number) => void;
  seriesData?: {
    seasons: {
      season_number: number;
      episode_count: number;
      name: string;
    }[];
  };
  isPremium?: boolean;
  tmdbId?: string;
  type?: "movie" | "tv";
  showVidLuxWatermark?: boolean;
  /** External quality options (e.g. from API) shown in the player's Quality settings menu */
  externalQualities?: { id: string; label: string }[];
  /** Currently selected external quality id */
  selectedExternalQuality?: string;
  /** Called when user picks a quality from the settings menu */
  onExternalQualityChange?: (id: string) => void;
  /** External audio/language options shown in the player's Language settings menu */
  externalAudioTracks?: { id: string; label: string }[];
  /** Currently selected external audio id */
  selectedExternalAudio?: string;
  /** Called when user picks a language from the settings menu */
  onExternalAudioChange?: (id: string) => void;
  /** Show the server availability icon in the top-right corner (controlled by `para` URL param) */
  showServerIcon?: boolean;
  /** Info about the active streaming server shown in the icon badge */
  activeServerInfo?: {
    name: string;
    available: boolean;
    format: "hls" | "mp4";
    languages: string[];
  };
  /** All available servers shown in the server-switch dropdown */
  availableServers?: {
    id: string;
    name: string;
    available: boolean;
    format: "hls" | "mp4";
    languages: string[];
  }[];
  /** Called when user picks a server from the dropdown */
  onServerSwitch?: (id: string) => void;
}

/**
 * Detect whether a stream URL should be handed to hls.js.
 *
 * Hoisted out of the component so the init effect and the stall watchdog
 * agree on the answer without depending on hlsRef being populated yet
 * (both effects run in the same commit, ordering is not guaranteed).
 */
function isHlsUrl(streamUrl: string): boolean {
  if (
    streamUrl.includes(".m3u8") ||
    streamUrl.includes("vixsrc-proxy") ||
    streamUrl.includes("/api/hls-proxy") ||
    streamUrl.startsWith("data:application/vnd.apple.mpegurl")
  ) {
    return true;
  }
  try {
    const u = new URL(streamUrl, window.location.href);
    for (const [, value] of u.searchParams) {
      if (value.includes(".m3u8")) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

const PremiumPlayer = forwardRef<{ seek: (time: number) => void }, PremiumPlayerProps>((

  
    {

      logo,
      poster,
      color = "#8b5cf6",
      streamUrl,
      downloadUrl,
      captions = [],
      defaultSubtitlesLanguage,
      onTimeUpdate,
      onComplete,
      onError,
      onServerChange,
      autoplay = true,
      server = false,
      serverName = "Default",
      servers = [],
      onServerSelect,
      title,
      year,
      season,
      episode,
      onNextEpisode,
      onEpisodeChange,
      seriesData,
      isPremium = false,
      tmdbId,
      type = "movie",
      showVidLuxWatermark = true,
      externalQualities,
      selectedExternalQuality,
      onExternalQualityChange,
      externalAudioTracks,
      selectedExternalAudio,
      onExternalAudioChange,
      showServerIcon = false,
      activeServerInfo,
      availableServers = [],
      onServerSwitch,
    },
    ref
  ) => {
    // Proxy external poster images through the server to avoid service worker CORS issues
    const proxiedPoster = poster && poster.startsWith("http") 
      ? `/api/proxy-image?url=${encodeURIComponent(poster)}`
      : poster;

    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const onErrorRef = useRef<PremiumPlayerProps["onError"]>(onError);
    const onTimeUpdateRef = useRef<PremiumPlayerProps["onTimeUpdate"]>(onTimeUpdate);
    const onCompleteRef = useRef<PremiumPlayerProps["onComplete"]>(onComplete);
    const streamUrlRef = useRef(streamUrl);
    const reportedFailureRef = useRef<string | null>(null);
    const pendingSeekRef = useRef<number | null>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const volumeRef = useRef<HTMLDivElement>(null);
    const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const doubleTapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [buffered, setBuffered] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [showCaptions, setShowCaptions] = useState(false);
    const [showSeries, setShowSeries] = useState(false);
    const [showServerList, setShowServerList] = useState(false);
    const [showServerDropdown, setShowServerDropdown] = useState(false);
    const [selectedSeason, setSelectedSeason] = useState<number>(Number(season) || 1);
    const [activeCaption, setActiveCaption] = useState<number>(-1);
    const [qualities, setQualities] = useState<{ height: number; index: number }[]>([]);
    const [currentQuality, setCurrentQuality] = useState<number>(-1);
    const [settingsMenu, setSettingsMenu] = useState<"main" | "quality" | "speed" | "audio" | "audiotrack" | "subtitle_settings">("main");
    const [audioTracks, setAudioTracks] = useState<{ label: string; language: string; index: number }[]>([]);
    const [activeAudioTrack, setActiveAudioTrack] = useState<number>(0);
    const [audioBoost, setAudioBoost] = useState(1);
    const audioContextRef = useRef<AudioContext | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [seekIndicator, setSeekIndicator] = useState<{ show: boolean; direction: "left" | "right"; seconds: number }>({
      show: false,
      direction: "left",
      seconds: 0,
    });
    const [lastTap, setLastTap] = useState<{ time: number; x: number }>({ time: 0, x: 0 });
    const touchStartTimeRef = useRef<number>(0);
    const [showAd, setShowAd] = useState(false);

    // Subtitle Appearance State
    const [subSettings, setSubSettings] = useState({
      size: "1.5rem", // Default: Large
      backgroundColor: "transparent", // Default: None
      textColor: "#FFFFFF",
      bottom: "20%" // Default: High
    });

    const applyPendingSeek = useCallback(() => {
      const video = videoRef.current;
      const t = pendingSeekRef.current;
      if (!video || t == null) return;
      if (!Number.isFinite(t)) {
        pendingSeekRef.current = null;
        return;
      }

      if (video.readyState >= 1) {
        try {
          video.currentTime = Math.max(0, t);
        } catch {
          // ignore
        }
        pendingSeekRef.current = null;
      }
    }, []);

    // Report a dead source at most once per streamUrl. Without this latch the
    // route's fallback ladder burns every tier in a single frame: swapping
    // video.src aborts the in-flight load, browsers surface that as an
    // `error` event, and each one escalates again before the new tier has had
    // a chance to fetch a single byte.
    const reportSourceFailure = useCallback((reason: string) => {
      const src = streamUrlRef.current;
      if (!src || reportedFailureRef.current === src) return;
      reportedFailureRef.current = src;
      console.error("[Player]", reason, src);
      setIsLoading(false);
      onErrorRef.current?.();
    }, []);

    // Expose seek method
    useImperativeHandle(ref, () => ({
      seek: (time: number) => {
        if (videoRef.current) {
          pendingSeekRef.current = time;
          applyPendingSeek();
        }
      },
    }));

    useEffect(() => {
      onErrorRef.current = onError;
      onTimeUpdateRef.current = onTimeUpdate;
      onCompleteRef.current = onComplete;
    }, [onError, onTimeUpdate, onComplete]);

    // Auto-select English subtitles
    useEffect(() => {
      if (captions && captions.length > 0) {
        const englishIndex = captions.findIndex(cap =>
          (cap.language && cap.language.toLowerCase().includes('en')) ||
          (cap.label && cap.label.toLowerCase().includes('english'))
        );

        if (englishIndex !== -1) {
          setActiveCaption(englishIndex);
        }
      }
    }, [captions]);

    // Initialize HLS
    useEffect(() => {
      streamUrlRef.current = streamUrl;
      const video = videoRef.current;
      if (!video || !streamUrl) return;

      setIsLoading(true);
      setAudioTracks([]);
      setActiveAudioTrack(0);

      const isHLS = isHlsUrl(streamUrl);

      if (isHLS && Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          // These are VOD movies/episodes, not a live broadcast. lowLatencyMode
          // pins playback to the live edge, buffers only a tiny window, and
          // disables seeking - which is exactly why playback died after ~2 min
          // and the scrubber wouldn't move. Off means normal VOD behavior.
          lowLatencyMode: false,
          // Keep a large forward buffer so playback doesn't stall on slow
          // segment fetches through the proxy, and hold plenty behind the
          // playhead so backward seeks are instant.
          maxBufferLength: 60,
          maxMaxBufferLength: 600,
          backBufferLength: 90,
          // More retries: every segment goes through our own /api/hls-proxy
          // route, so a single slow/failed upstream fetch shouldn't kill the stream.
          fragLoadingMaxRetry: 6,
          fragLoadingMaxRetryTimeout: 64000,
          fragLoadingRetryDelay: 1000,
          manifestLoadingMaxRetry: 4,
          levelLoadingMaxRetry: 4,
          xhrSetup: (xhr: XMLHttpRequest) => {
            xhr.timeout = 30000;
          },
        });

        hlsRef.current = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        hls.on(
          Hls.Events.AUDIO_TRACKS_UPDATED,
          (_event: string, data: { audioTracks: Array<{ name?: string; lang?: string }> }) => {
            const tracks = (data.audioTracks || []).map((t, index) => ({
              label: t.name || t.lang || `Audio ${index + 1}`,
              language: t.lang || "unknown",
              index,
            }));
            setAudioTracks(tracks);
            setActiveAudioTrack(typeof hls.audioTrack === "number" ? hls.audioTrack : 0);
          }
        );

        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event: string, data: { id: number }) => {
          setActiveAudioTrack(data.id);
        });

        hls.on(Hls.Events.MANIFEST_PARSED, (_event: string, data: { levels: Array<{ height: number }> }) => {
          const levels = data.levels.map((level: { height: number }, index: number) => ({
            height: level.height,
            index,
          }));
          setQualities(levels);
          setCurrentQuality(-1); // Auto

          try {
            const tracks = (hls.audioTracks || []).map((t, index) => ({
              label: (t as any).name || (t as any).lang || `Audio ${index + 1}`,
              language: (t as any).lang || "unknown",
              index,
            }));
            if (tracks.length > 0) {
              setAudioTracks(tracks);
              setActiveAudioTrack(typeof hls.audioTrack === "number" ? hls.audioTrack : 0);
            }
          } catch {
            // ignore
          }

          applyPendingSeek();
          if (autoplay) {
            video.play().catch(() => { });
          }
        });

        hls.on(Hls.Events.ERROR, (_event: string, data: { fatal: boolean; type?: string; details?: string }) => {
          if (data.fatal) {
            console.error("[HLS] Fatal error:", data.type, data.details);
            // Tear down the instance immediately so no further fatal events
            // fire while the parent is deciding whether to retry. Without
            // this, hls.js can fire a second fatal error (e.g. NETWORK_ERROR
            // followed by MEDIA_ERROR on the same dead source) which burns
            // through both Blaze tiers before the first retry has loaded.
            hls.destroy();
            hlsRef.current = null;
            // Use the same per-URL latch as the native-video error path so
            // at most one onError fires per streamUrl regardless of how many
            // fatal events hls.js emits.
            reportSourceFailure(`HLS fatal: ${data.type} / ${data.details}`);
          }
        });

        return () => {
          hls.destroy();
          hlsRef.current = null;
        };
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = streamUrl;
        if (autoplay) {
          video.play().catch(() => { });
        }
      } else {
        video.src = streamUrl;
        if (autoplay) {
          video.play().catch(() => { });
        }
      }

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    }, [streamUrl]);

    // ── Progressive (mp4) stall watchdog ─────────────────────────────────
    // A dead upstream can answer with a 200 that never yields a single byte
    // of media (a hung proxy, an HTML error page with the wrong
    // content-type, a 403 body). In that case the <video> element fires no
    // `error` event at all — it just spins forever, which is exactly the
    // "loads and goes silent" symptom.
    //
    // Only declare the source dead when *nothing at all* has arrived. Every
    // `progress` event re-arms the timer, so a 20 KB/s connection buffers
    // happily instead of being killed for being slow.
    useEffect(() => {
      const video = videoRef.current;
      if (!video || !streamUrl || isHlsUrl(streamUrl)) return;

      let timer = 0;
      let settled = false;

      const arm = () => {
        window.clearTimeout(timer);
        if (settled) return;
        timer = window.setTimeout(() => {
          if (settled || video.error) return;
          if (video.buffered.length === 0 && video.readyState === 0) {
            settled = true;
            reportSourceFailure("no data from source after 15s");
          }
        }, 15_000);
      };

      const disarm = () => {
        settled = true;
        window.clearTimeout(timer);
      };

      arm();
      video.addEventListener("progress", arm);
      video.addEventListener("loadeddata", disarm);
      video.addEventListener("playing", disarm);

      return () => {
        window.clearTimeout(timer);
        video.removeEventListener("progress", arm);
        video.removeEventListener("loadeddata", disarm);
        video.removeEventListener("playing", disarm);
      };
    }, [streamUrl]);

    // Video event handlers
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const handlePlay = () => setIsPlaying(true);
      const handlePause = () => setIsPlaying(false);
      const handleTimeUpdate = () => {
        setCurrentTime(video.currentTime);
        onTimeUpdateRef.current?.(video.currentTime);
      };
      const handleDurationChange = () => setDuration(video.duration);
      const handleProgress = () => {
        if (video.buffered.length > 0) {
          setBuffered(video.buffered.end(video.buffered.length - 1));
          if (video.buffered.end(video.buffered.length - 1) > video.currentTime + 0.5) {
            setIsLoading(false);
          }
        }
      };
      const handleWaiting = () => setIsLoading(true);
      // Native media errors were never surfaced before: onError only fired
      // from the hls.js ERROR event, so a broken mp4 source failed silently.
      const handleError = () => {
        if (hlsRef.current) return; // hls.js reports its own fatal errors
        const err = video.error;
        // code 1 = MEDIA_ERR_ABORTED — that's us swapping src, not a bad source.
        if (!err || err.code === 1) return;
        reportSourceFailure(`media error ${err.code} (${err.message || "no message"})`);
      };
      const handleCanPlay = () => {
        setIsLoading(false);
        applyPendingSeek();
      };
      const handlePlaying = () => {
        setIsLoading(false);
        setIsPlaying(true);
      };
      const handleEnded = () => {
        setIsPlaying(false);
        onCompleteRef.current?.();
      };
      const handleVolumeChange = () => {
        setVolume(video.volume);
        setIsMuted(video.muted);
      };
      const handleLoadedMetadata = () => {
        if (hlsRef.current) return;
        const videoElement = video as any;
        if (videoElement.audioTracks && videoElement.audioTracks.length > 1) {
          const tracks = [];
          for (let i = 0; i < videoElement.audioTracks.length; i++) {
            const track = videoElement.audioTracks[i];
            tracks.push({
              label: track.label || `Audio ${i + 1}`,
              language: track.language || 'unknown',
              index: i,
            });
            if (track.enabled) {
              setActiveAudioTrack(i);
            }
          }
          setAudioTracks(tracks);
        }
        applyPendingSeek();
      };

      video.addEventListener("play", handlePlay);
      video.addEventListener("pause", handlePause);
      video.addEventListener("timeupdate", handleTimeUpdate);
      video.addEventListener("durationchange", handleDurationChange);
      video.addEventListener("progress", handleProgress);
      video.addEventListener("waiting", handleWaiting);
      video.addEventListener("canplay", handleCanPlay);
      video.addEventListener("playing", handlePlaying);
      video.addEventListener("ended", handleEnded);
      video.addEventListener("volumechange", handleVolumeChange);
      video.addEventListener("loadedmetadata", handleLoadedMetadata);
      video.addEventListener("error", handleError);

      return () => {
        video.removeEventListener("play", handlePlay);
        video.removeEventListener("pause", handlePause);
        video.removeEventListener("timeupdate", handleTimeUpdate);
        video.removeEventListener("durationchange", handleDurationChange);
        video.removeEventListener("progress", handleProgress);
        video.removeEventListener("waiting", handleWaiting);
        video.removeEventListener("canplay", handleCanPlay);
        video.removeEventListener("playing", handlePlaying);
        video.removeEventListener("ended", handleEnded);
        video.removeEventListener("volumechange", handleVolumeChange);
        video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        video.removeEventListener("error", handleError);
      };
    }, [onTimeUpdate, onComplete]);

    // Fullscreen change handler
    useEffect(() => {
      const handleFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
      };

      document.addEventListener("fullscreenchange", handleFullscreenChange);
      return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
    }, []);

    // Auto-hide controls
    const resetControlsTimeout = useCallback(() => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      setShowControls(true);
      controlsTimeoutRef.current = setTimeout(() => {
        if (isPlaying && !showSettings) {
          setShowControls(false);
        }
      }, 3000);
    }, [isPlaying, showSettings]);

    useEffect(() => {
      resetControlsTimeout();
      return () => {
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
        }
      };
    }, [resetControlsTimeout]);

    // Keyboard controls
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (!videoRef.current) return;

        switch (e.key) {
          case " ":
          case "k":
            e.preventDefault();
            togglePlay();
            break;
          case "ArrowLeft":
            e.preventDefault();
            seek(-10);
            break;
          case "ArrowRight":
            e.preventDefault();
            seek(10);
            break;
          case "ArrowUp":
            e.preventDefault();
            changeVolume(0.1);
            break;
          case "ArrowDown":
            e.preventDefault();
            changeVolume(-0.1);
            break;
          case "m":
            e.preventDefault();
            toggleMute();
            break;
          case "f":
            e.preventDefault();
            toggleFullscreen();
            break;
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    const togglePlay = () => {
      if (videoRef.current) {
        if (isPlaying) {
          videoRef.current.pause();
        } else {
          videoRef.current.play().catch(() => { });
        }
      }
    };

    const toggleMute = () => {
      if (videoRef.current) {
        videoRef.current.muted = !videoRef.current.muted;
      }
    };

    const changeVolume = (delta: number) => {
      if (videoRef.current) {
        const newVolume = Math.max(0, Math.min(1, videoRef.current.volume + delta));
        videoRef.current.volume = newVolume;
        if (newVolume > 0 && videoRef.current.muted) {
          videoRef.current.muted = false;
        }
      }
    };

    // Duration that is safe to seek against. video.duration can be NaN (not
    // loaded yet) or Infinity (stream flagged live) - in both cases fall back
    // to the end of the seekable range so seeking still works instead of
    // being clamped to 0.
    const getSeekableDuration = () => {
      const video = videoRef.current;
      if (!video) return 0;
      let d = video.duration;
      if (!Number.isFinite(d)) {
        try {
          d = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : 0;
        } catch {
          d = 0;
        }
      }
      return d || 0;
    };

    const seek = (seconds: number) => {
      if (videoRef.current) {
        const videoDuration = getSeekableDuration();
        const newTime = Math.max(
          0,
          videoDuration
            ? Math.min(videoDuration, videoRef.current.currentTime + seconds)
            : videoRef.current.currentTime + seconds,
        );
        videoRef.current.currentTime = newTime;
        setCurrentTime(newTime);
        setSeekIndicator({ show: true, direction: seconds > 0 ? "right" : "left", seconds: Math.abs(seconds) });
        setTimeout(() => setSeekIndicator((prev) => ({ ...prev, show: false })), 500);
      }
    };

    // Pointer-based scrubbing. The old handler was onClick-only: no touch
    // drag support at all, so on phones the 6px-tall bar was effectively
    // unseekable. Pointer events unify mouse + touch: press anywhere on the
    // bar to jump, keep the finger/button down and drag to scrub.
    const isScrubbingRef = useRef(false);

    const seekToClientX = useCallback((clientX: number) => {
      const video = videoRef.current;
      const bar = progressRef.current;
      if (!video || !bar) return;
      const dur = getSeekableDuration();
      if (!dur) return;
      const rect = bar.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newTime = percent * dur;
      try {
        video.currentTime = newTime;
      } catch {
        // ignore - not seekable yet
      }
      setCurrentTime(newTime);
    }, []);

    const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      isScrubbingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore - capture unsupported
      }
      seekToClientX(e.clientX);
    };

    const handleProgressPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return;
      e.stopPropagation();
      seekToClientX(e.clientX);
    };

    const handleProgressPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      isScrubbingRef.current = false;
    };

    const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!volumeRef.current || !videoRef.current) return;
      const rect = volumeRef.current.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      videoRef.current.volume = Math.max(0, Math.min(1, percent));
      if (percent > 0 && videoRef.current.muted) {
        videoRef.current.muted = false;
      }
    };

    const toggleFullscreen = async () => {
      if (!containerRef.current) return;

      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    };

    const handleQualityChange = (index: number) => {
      if (hlsRef.current) {
        hlsRef.current.currentLevel = index;
        setCurrentQuality(index);
      }
      setShowSettings(false);
      setSettingsMenu("main");
    };

    const handleSpeedChange = (speed: number) => {
      if (videoRef.current) {
        videoRef.current.playbackRate = speed;
        setPlaybackSpeed(speed);
      }
      setShowSettings(false);
      setSettingsMenu("main");
    };

    const handleAudioBoostChange = (boost: number) => {
      if (!videoRef.current) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        sourceNodeRef.current = audioContextRef.current.createMediaElementSource(videoRef.current);
        gainNodeRef.current = audioContextRef.current.createGain();
        sourceNodeRef.current.connect(gainNodeRef.current);
        gainNodeRef.current.connect(audioContextRef.current.destination);
      }

      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = boost;
        setAudioBoost(boost);
      }
      setShowSettings(false);
      setSettingsMenu("main");
    };

    const handleCaptionChange = (index: number) => {
      setActiveCaption(index);
      setShowCaptions(false);

      if (videoRef.current) {
        const tracks = videoRef.current.textTracks;
        for (let i = 0; i < tracks.length; i++) {
          tracks[i].mode = i === index ? "showing" : "hidden";
        }
      }
    };

    // Keep HTML5 track elements synchronized with activeCaption state
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      
      const syncTracks = () => {
        const tracks = video.textTracks;
        for (let i = 0; i < tracks.length; i++) {
          tracks[i].mode = i === activeCaption ? "showing" : "hidden";
        }
      };

      // Run sync immediately
      syncTracks();

      // Listen for text track additions or changes
      video.addEventListener("loadedmetadata", syncTracks);
      return () => {
        video.removeEventListener("loadedmetadata", syncTracks);
      };
    }, [activeCaption, captions]);

    const handleAudioTrackChange = (index: number) => {
      if (!videoRef.current) return;

      if (hlsRef.current) {
        hlsRef.current.audioTrack = index;
        setActiveAudioTrack(index);
      } else {
        const videoElement = videoRef.current as any;
        if (videoElement.audioTracks) {
          for (let i = 0; i < videoElement.audioTracks.length; i++) {
            videoElement.audioTracks[i].enabled = i === index;
          }
          setActiveAudioTrack(index);
        }
      }
      setShowSettings(false);
      setSettingsMenu("main");
    };

    const clickTimerRef = useRef<NodeJS.Timeout | null>(null);

    const handleDoubleTap = (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('[data-controls]')) return;

      if (touchStartTimeRef.current && Date.now() - touchStartTimeRef.current < 500) {
        return;
      }

      const now = Date.now();
      const x = e.clientX;
      const containerWidth = containerRef.current?.clientWidth || 0;

      if (now - lastTap.time < 300) {
        if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
        if (x < containerWidth / 3) {
          seek(-10);
        } else if (x > (containerWidth * 2) / 3) {
          seek(10);
        } else {
          toggleFullscreen();
        }
      } else {
        if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
        clickTimerRef.current = setTimeout(() => {
          togglePlay();
          resetControlsTimeout();
          clickTimerRef.current = null;
        }, 250);
      }

      setLastTap({ time: now, x });
    };

    const handleTouchStart = (e: React.TouchEvent) => {
      touchStartTimeRef.current = Date.now();
    };

    const touchTimerRef = useRef<NodeJS.Timeout | null>(null);

    const handleTouchEnd = (e: React.TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('[data-controls]')) return;

      const now = Date.now();
      const touch = e.changedTouches[0];
      const x = touch.clientX;
      const containerWidth = containerRef.current?.clientWidth || 0;

      if (now - lastTap.time < 300 && Math.abs(x - lastTap.x) < 50) {
        if (touchTimerRef.current) { clearTimeout(touchTimerRef.current); touchTimerRef.current = null; }
        e.preventDefault();
        if (x < containerWidth / 3) {
          seek(-10);
        } else if (x > (containerWidth * 2) / 3) {
          seek(10);
        } else {
          toggleFullscreen();
        }
      } else {
        if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
        touchTimerRef.current = setTimeout(() => {
          togglePlay();
          resetControlsTimeout();
          touchTimerRef.current = null;
        }, 250);
      }

      setLastTap({ time: now, x });
    };

    const formatTime = (seconds: number) => {
      if (isNaN(seconds)) return "0:00";
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
      }
      return `${m}:${s.toString().padStart(2, "0")}`;
    };

    const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

    return (
      <div
        ref={containerRef}
        tabIndex={0}
        className="relative w-full h-full bg-black group select-none overflow-hidden outline-none"
        onMouseMove={resetControlsTimeout}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={handleDoubleTap}
      >
        {/* Video Element */}
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          poster={proxiedPoster}
          playsInline
          referrerPolicy="no-referrer"
        >
          {captions.map((cap, index) => (
            <track
              key={index}
              kind="captions"
              src={cap.file || cap.url}
              label={cap.label || `Subtitle ${index + 1}`}
              srcLang={cap.language || "en"}
            />
          ))}
        </video>

        {/* Loading Spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-20">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-full blur-xl animate-pulse"
                style={{ backgroundColor: `${color}40` }}
              />
              <div
                className="relative w-16 h-16 rounded-full flex items-center justify-center animate-spin"
                style={{
                  border: `3px solid ${color}30`,
                  borderTopColor: color,
                }}
              />
              <Crown
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-white animate-bounce"
              />
            </div>
          </div>
        )}

        {/* Seek Indicator */}
        {seekIndicator.show && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 z-30 flex items-center gap-2
              ${seekIndicator.direction === "left" ? "left-1/4" : "right-1/4"}
              animate-pulse`}
          >
            <div
              className="flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md"
              style={{ backgroundColor: `${color}40` }}
            >
              {seekIndicator.direction === "left" ? (
                <SkipBack className="w-6 h-6 text-white" />
              ) : (
                <SkipForward className="w-6 h-6 text-white" />
              )}
              <span className="text-white font-bold">{seekIndicator.seconds}s</span>
            </div>
          </div>
        )}

        {/* Top Controls Info (Server, Title, Year) */}
        <div
          className={`absolute left-14 sm:left-4 z-10 flex items-center gap-3
            transition-all duration-500 transform
            ${showControls ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"}`}
          style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          {server && (
            <div className="relative group/servers">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowServerList(!showServerList);
                }}
                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2
                  rounded-full shadow-lg backdrop-blur-md border transition-all duration-300
                  ${showServerList ? "ring-2 ring-white/20 scale-105" : "hover:scale-105 active:scale-95"}`}
                style={{
                  background: showServerList
                    ? `linear-gradient(to right, ${color}, ${color}cc)`
                    : `linear-gradient(to right, ${color}e6, ${color}cc)`,
                  boxShadow: `0 10px 15px -3px ${color}30`,
                  borderColor: `${color}40`,
                }}
              >
                <Server className={`w-4 h-4 sm:w-5 sm:h-5 text-white ${isLoading ? 'animate-pulse' : ''}`} />
                <span className="text-white font-black text-[10px] sm:text-xs uppercase tracking-widest hidden xs:block">
                  {serverName}
                </span>
                <ChevronRight className={`w-3 h-3 sm:w-4 sm:h-4 text-white/70 transition-transform duration-300 
                  ${showServerList ? 'rotate-90' : ''}`} />
              </button>

              {/* Server List Popover */}
              {showServerList && (
                <div
                  className="absolute top-full left-0 mt-3 w-48 sm:w-60 bg-black/95 backdrop-blur-2xl 
                  rounded-2xl border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-3 border-b border-white/5 bg-white/5">
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Select Server</p>
                  </div>
                  <div className="p-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                    {servers.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          onServerSelect?.(s.id);
                          setShowServerList(false);
                        }}
                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all duration-200
                          ${s.name === serverName
                            ? "bg-white/10 text-white"
                            : "hover:bg-white/5 text-white/60 hover:text-white"}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${s.status === 'offline' ? 'bg-red-500' : 'bg-green-500'}`} />
                          <span className="font-bold text-sm tracking-tight">{s.name}</span>
                        </div>
                        {s.name === serverName && (
                          <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                        {s.status === 'offline' && <span className="text-[9px] font-black opacity-40">FAILED</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {(title || year || season || episode) && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2 drop-shadow-lg">
              {title && (
                <span className="text-white font-black text-sm sm:text-lg tracking-tight line-clamp-1 uppercase">
                  {title}
                </span>
              )}
              {(season && episode && season !== "undefined" && episode !== "undefined" && season !== "0") && (
                <div className="flex items-center gap-2">
                  <div className="hidden sm:block w-1 h-1 rounded-full bg-white/40" />
                  <span className="text-white font-black text-[10px] sm:text-xs tracking-widest bg-white/10 px-2 py-0.5 rounded border border-white/10">
                    S{season} : E{episode}
                  </span>
                </div>
              )}
              {year && (
                <div className="flex items-center gap-2">
                  {!season && !episode && <div className="hidden sm:block w-1 h-1 rounded-full bg-white/40" />}
                  <span className="text-white/60 font-bold text-[10px] sm:text-xs tracking-widest">
                    {year}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Top-right: Logo + Server Icon */}
        <div
          className={`absolute right-3 sm:right-4 z-10 flex flex-col items-end gap-2
            transition-all duration-500
            ${showControls ? "opacity-90 scale-100" : "opacity-60 scale-90"}`}
          style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          {logo && (
            <img
              src={logo}
              alt="Logo"
              className="h-9 w-9 sm:h-14 sm:w-14 object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
            />
          )}

          {showServerIcon && activeServerInfo && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowServerDropdown((v) => !v);
                  setShowServerList(false);
                  setShowSettings(false);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full backdrop-blur-md border text-[10px] font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95"
                style={{
                  background: showServerDropdown ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.55)",
                  borderColor: activeServerInfo.available ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)",
                }}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    activeServerInfo.available ? "bg-green-400 animate-pulse" : "bg-red-400"
                  }`}
                />
                <span className="text-white/90">{activeServerInfo.name}</span>
                <span
                  className="text-[9px] font-black px-1 py-0.5 rounded"
                  style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)" }}
                >
                  {activeServerInfo.format.toUpperCase()}
                </span>
                <span className="text-white/40 hidden xs:inline">{activeServerInfo.languages.join(" / ")}</span>
                <ChevronRight
                  className={`w-3 h-3 text-white/40 transition-transform duration-200 ${showServerDropdown ? "rotate-90" : ""}`}
                />
              </button>

              {showServerDropdown && availableServers.length > 0 && (
                <div
                  className="absolute top-full right-0 mt-2 w-52 bg-black/95 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-3 border-b border-white/5 bg-white/5">
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Switch Server</p>
                  </div>
                  <div className="p-1.5">
                    {availableServers.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          onServerSwitch?.(s.id);
                          setShowServerDropdown(false);
                        }}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 text-left
                          ${s.name === activeServerInfo.name
                            ? "bg-white/10 text-white"
                            : "hover:bg-white/5 text-white/60 hover:text-white"}`}
                      >
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.available ? "bg-green-400" : "bg-red-400"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm tracking-tight">{s.name}</span>
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-white/10 text-white/50">
                              {s.format.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-[10px] text-white/30 mt-0.5">{s.languages.join(" / ")}</p>
                        </div>
                        {s.name === activeServerInfo.name && (
                          <Check className="w-3.5 h-3.5 text-white/60 flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* VidLux Watermark */}
        {showVidLuxWatermark && (
          <a
            href={typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className={`absolute bottom-16 sm:bottom-20 right-3 sm:right-4 z-10
              transition-all duration-500 cursor-pointer hover:scale-105
              ${showControls ? "opacity-80" : "opacity-50"} hover:opacity-100`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-white/10 hover:border-blue-400/50 transition-colors">
              <svg 
                viewBox="0 0 40 40" 
                className="w-5 h-5 sm:w-6 sm:h-6" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="20" cy="20" r="20" fill="#3B82F6"/>
                <path 
                  d="M15 12.5L28 20L15 27.5V12.5Z" 
                  fill="white"
                />
              </svg>
              <span className="text-white font-black text-xs sm:text-sm uppercase tracking-wider" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', fontStyle: 'italic' }}>
                VidLux
              </span>
            </div>
          </a>
        )}

        {/* Center Play Button */}
        {!isPlaying && !isLoading && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20
              w-16 h-16 sm:w-20 sm:h-20 rounded-full
              flex items-center justify-center
              transition-all duration-300 hover:scale-110 active:scale-95"
            style={{
              background: `linear-gradient(135deg, ${color}, ${color}dd)`,
              boxShadow: `0 0 40px ${color}60`,
            }}
          >
            <Play className="w-8 h-8 sm:w-10 sm:h-10 text-white ml-1" fill="white" />
          </button>
        )}

        {/* Gradient Overlays */}
        <div
          className={`absolute inset-0 pointer-events-none z-[5] transition-opacity duration-500
            ${showControls ? "opacity-100" : "opacity-0"}`}
        >
          <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-black/70 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />
        </div>

        {/* Controls - data-controls makes the tap/double-tap handlers on the
            container ignore this whole region (the check existed but nothing
            in the tree ever carried the attribute, so tapping the progress
            bar also queued a play/pause toggle 250ms later - which paused the
            video right after every seek and made seeking feel broken). */}
        <div
          data-controls
          className={`absolute bottom-0 left-0 right-0 z-40 px-3 sm:px-5 pb-3 sm:pb-4
            transition-all duration-500 transform
            ${showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
        >
          {/* Progress Bar - tall hit area (h-6) wrapping a thin visual track,
              so fingers can actually land on it; pointer events give tap +
              drag scrubbing on both mouse and touch. touch-action:none stops
              the browser from treating a scrub as a page scroll. */}
          <div
            ref={progressRef}
            className="relative h-6 mb-1.5 sm:mb-2 cursor-pointer group/progress flex items-center"
            style={{ touchAction: "none" }}
            onPointerDown={handleProgressPointerDown}
            onPointerMove={handleProgressPointerMove}
            onPointerUp={handleProgressPointerUp}
            onPointerCancel={handleProgressPointerUp}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const safeDur = Number.isFinite(duration) && duration > 0 ? duration : 0;
              const progressPercent = safeDur ? Math.min(100, (currentTime / safeDur) * 100) : 0;
              const bufferedPercent = safeDur ? Math.min(100, (buffered / safeDur) * 100) : 0;
              return (
                <div className="relative w-full h-1.5 sm:h-2 rounded-full">
                  {/* Background */}
                  <div className="absolute inset-0 bg-white/20 rounded-full" />

                  {/* Buffered */}
                  <div
                    className="absolute inset-y-0 left-0 bg-white/30 rounded-full"
                    style={{ width: `${bufferedPercent}%` }}
                  />

                  {/* Progress */}
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all"
                    style={{
                      width: `${progressPercent}%`,
                      background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                    }}
                  />

                  {/* Thumb - always visible on touch-first layouts; the old
                      hover-only thumb never appeared on phones */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 sm:w-4 sm:h-4 rounded-full
                      opacity-100 sm:opacity-0 sm:group-hover/progress:opacity-100 transition-all duration-200
                      shadow-lg"
                    style={{
                      left: `calc(${progressPercent}% - 6px)`,
                      backgroundColor: "white",
                      border: `2px solid ${color}`,
                    }}
                  />
                </div>
              );
            })()}
          </div>

          {/* Control Buttons */}
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            {/* Left Controls */}
            <div className="flex items-center gap-1 sm:gap-3">
              {/* Play/Pause */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
                className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full
                  bg-white/10 hover:bg-white/20 backdrop-blur-sm
                  transition-all duration-200 hover:scale-110 active:scale-95"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="white" />
                ) : (
                  <Play className="w-5 h-5 sm:w-6 sm:h-6 text-white ml-0.5" fill="white" />
                )}
              </button>

              {/* Skip Backward */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  seek(-10);
                }}
                className="hidden sm:flex w-10 h-10 items-center justify-center rounded-full
                  hover:bg-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
              >
                <SkipBack className="w-5 h-5 text-white" />
              </button>

              {/* Skip Forward */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  seek(10);
                }}
                className="hidden sm:flex w-10 h-10 items-center justify-center rounded-full
                  hover:bg-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
              >
                <SkipForward className="w-5 h-5 text-white" />
              </button>

              {/* Next Episode */}
              {onNextEpisode && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNextEpisode();
                  }}
                  className="w-10 h-10 flex items-center justify-center rounded-full
                    bg-white/5 hover:bg-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
                  title="Next Episode"
                >
                  <FastForward className="w-5 h-5 text-white" />
                </button>
              )}

              {/* Volume */}
              <div className="hidden sm:flex items-center gap-2 group/volume">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMute();
                  }}
                  className="w-10 h-10 flex items-center justify-center rounded-full
                    hover:bg-white/10 transition-all duration-200"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-5 h-5 text-white" />
                  ) : (
                    <Volume2 className="w-5 h-5 text-white" />
                  )}
                </button>

                <div
                  ref={volumeRef}
                  className="w-0 group-hover/volume:w-20 h-1.5 rounded-full cursor-pointer
                    overflow-hidden transition-all duration-300 bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleVolumeClick(e);
                  }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(isMuted ? 0 : volume) * 100}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>

              {/* Time */}
              <div className="text-white text-xs sm:text-sm font-medium ml-1 sm:ml-2">
                <span>{formatTime(currentTime)}</span>
                <span className="text-white/50 mx-1">/</span>
                <span className="text-white/70">{formatTime(duration)}</span>
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-1 sm:gap-2">

              {/* Download Button */}
              {(downloadUrl || tmdbId) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (downloadUrl) {
                      window.open(downloadUrl, "_blank");
                    } else {
                      const dlUrl = type === "movie"
                        ? `/download/movie/${tmdbId}`
                        : `/download/tv/${tmdbId}/${season || 1}/${episode || 1}`;
                      window.open(dlUrl, "_blank");
                    }
                  }}
                  className="w-10 h-10 flex items-center justify-center rounded-full
                    hover:bg-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
                  title="Download Options"
                >
                  <Download className="w-5 h-5 text-white" />
                </button>
              )}

              {/* Series Selector */}
              {seriesData && (
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSeries(!showSeries);
                      setShowSettings(false);
                      setShowCaptions(false);
                      setShowServerList(false);
                    }}
                    className={`w-10 h-10 flex items-center justify-center rounded-full
                      transition-all duration-200 hover:scale-110 active:scale-95
                      ${showSeries ? "bg-white/20" : "hover:bg-white/10"}`}
                    title="Season & Episode"
                  >
                    <ListVideo className="w-5 h-5 text-white" />
                  </button>

                  {/* Series Menu */}
                  {showSeries && (
                    <div
                      className="absolute bottom-full right-0 mb-4 w-64 sm:w-72 max-w-[calc(100vw-2rem)]
                        bg-black/95 backdrop-blur-2xl rounded-2xl border border-white/10
                        shadow-2xl overflow-hidden flex flex-col"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-4 border-b border-white/5 flex items-center justify-between">
                        <h3 className="text-white font-bold text-sm uppercase tracking-widest">Select Episode</h3>
                        <button onClick={() => setShowSeries(false)}><X className="w-4 h-4 text-white/50" /></button>
                      </div>

                      {/* Season Horizontal List */}
                      <div className="flex gap-2 p-3 overflow-x-auto border-b border-white/5 no-scrollbar">
                        {seriesData.seasons.map((s) => (
                          <button
                            key={s.season_number}
                            onClick={() => setSelectedSeason(s.season_number)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all
                              ${selectedSeason === s.season_number
                                ? "bg-white text-black"
                                : "text-white/60 hover:text-white hover:bg-white/5"}`}
                          >
                            Season {s.season_number}
                          </button>
                        ))}
                      </div>

                      {/* Episode Grid */}
                      <div className="p-3 max-h-[250px] overflow-y-auto grid grid-cols-4 sm:grid-cols-5 gap-2 custom-scrollbar">
                        {Array.from({ length: seriesData.seasons.find(s => s.season_number === selectedSeason)?.episode_count || 0 }).map((_, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              onEpisodeChange?.(selectedSeason, i + 1);
                              setShowSeries(false);
                            }}
                            className={`aspect-square flex items-center justify-center rounded-lg text-[10px] font-black transition-all
                              ${selectedSeason === Number(season) && (i + 1) === Number(episode)
                                ? "ring-2 ring-white bg-white/20 text-white"
                                : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white"}`}
                            style={selectedSeason === Number(season) && (i + 1) === Number(episode) ? { color: color } : {}}
                          >
                            {i + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Captions */}
              {captions.length > 0 && (
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCaptions(!showCaptions);
                      setShowSettings(false);
                      setShowServerList(false);
                    }}
                    className={`w-10 h-10 flex items-center justify-center rounded-full
                      transition-all duration-200 hover:scale-110 active:scale-95
                      ${activeCaption >= 0 ? "bg-white/20" : "hover:bg-white/10"}`}
                  >
                    <Subtitles className="w-5 h-5 text-white" />
                  </button>

                  {/* Captions Menu */}
                  {showCaptions && (
                    <div
                      className="absolute bottom-full right-0 mb-2 w-40 sm:w-44 max-w-[calc(100vw-2rem)]
                        bg-black/90 backdrop-blur-xl rounded-xl border border-white/10
                        shadow-2xl overflow-hidden"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-1.5 max-h-[40vh] overflow-y-auto">
                        <button
                          onClick={() => handleCaptionChange(-1)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg
                            transition-colors ${activeCaption === -1 ? "bg-white/10" : "hover:bg-white/5"}`}
                        >
                          <span className="text-xs sm:text-sm text-white">Off</span>
                          {activeCaption === -1 && <Check className="w-3.5 h-3.5" style={{ color }} />}
                        </button>
                        {captions.map((cap, index) => (
                          <button
                            key={index}
                            onClick={() => handleCaptionChange(index)}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg
                              transition-colors ${activeCaption === index ? "bg-white/10" : "hover:bg-white/5"}`}
                          >
                            <span className="text-xs sm:text-sm text-white truncate">{cap.label || `Subtitle ${index + 1}`}</span>
                            {activeCaption === index && <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Settings */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSettings(!showSettings);
                    setShowCaptions(false);
                    setShowServerList(false);
                    setSettingsMenu("main");
                  }}
                  className={`w-10 h-10 flex items-center justify-center rounded-full
                    transition-all duration-300 hover:scale-110 active:scale-95
                    ${showSettings ? "bg-white/20 rotate-45" : "hover:bg-white/10"}`}
                >
                  <Settings className="w-5 h-5 text-white" />
                </button>

                {/* Settings Menu */}
                {showSettings && (
                  <div
                    className="absolute bottom-full right-0 mb-2 w-44 sm:w-48 max-w-[calc(100vw-2rem)]
                      bg-black/90 backdrop-blur-xl rounded-xl border border-white/10
                      shadow-2xl overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {settingsMenu === "main" && (
                      <div className="p-1.5">
                        {/* Quality — prefer external options; fall back to HLS levels */}
                        {((externalQualities && externalQualities.length > 0) || qualities.length > 0) && (
                          <button
                            onClick={() => setSettingsMenu("quality")}
                            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg
                              hover:bg-white/5 transition-colors"
                          >
                            <span className="text-xs sm:text-sm text-white">Quality</span>
                            <div className="flex items-center gap-1 text-white/60">
                              <span className="text-[10px] sm:text-xs">
                                {externalQualities && externalQualities.length > 0
                                  ? (externalQualities.find(q => q.id === selectedExternalQuality)?.label ?? externalQualities[0]?.label ?? "Auto")
                                  : (currentQuality === -1 ? "Auto" : `${qualities[currentQuality]?.height}p`)}
                              </span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </div>
                          </button>
                        )}
                        <button
                          onClick={() => setSettingsMenu("speed")}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg
                            hover:bg-white/5 transition-colors"
                        >
                          <span className="text-xs sm:text-sm text-white">Speed</span>
                          <div className="flex items-center gap-1 text-white/60">
                            <span className="text-[10px] sm:text-xs">{playbackSpeed}x</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </div>
                        </button>
                        <button
                          onClick={() => setSettingsMenu("audio")}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg
                            hover:bg-white/5 transition-colors"
                        >
                          <span className="text-xs sm:text-sm text-white">Audio Boost</span>
                          <div className="flex items-center gap-1 text-white/60">
                            <span className="text-[10px] sm:text-xs">{audioBoost === 1 ? "Normal" : `${audioBoost}x`}</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </div>
                        </button>
                        {/* Language / Audio Track */}
                        <button
                          onClick={() => setSettingsMenu("audiotrack")}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg
                            hover:bg-white/5 transition-colors"
                        >
                          <span className="text-xs sm:text-sm text-white">Language</span>
                          <div className="flex items-center gap-1 text-white/60">
                            <span className="text-[10px] sm:text-xs truncate max-w-[6rem]">
                              {externalAudioTracks && externalAudioTracks.length > 0
                                ? (externalAudioTracks.find(t => t.id === selectedExternalAudio)?.label ?? externalAudioTracks[0]?.label ?? "Default")
                                : (audioTracks[activeAudioTrack]?.label || "Default")}
                            </span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </div>
                        </button>

                        <div className="my-1 border-t border-white/10" />

                        <button
                          onClick={() => setSettingsMenu("subtitle_settings")}
                          className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg
                            hover:bg-white/5 transition-colors"
                        >
                          <span className="text-xs sm:text-sm text-white">Subtitle Styles</span>
                          <ChevronRight className="w-3.5 h-3.5 text-white/60" />
                        </button>
                      </div>
                    )}

                    {settingsMenu === "quality" && (
                      <div className="p-1.5 max-h-[40vh] overflow-y-auto">
                        <button
                          onClick={() => setSettingsMenu("main")}
                          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-white/60 hover:text-white
                            border-b border-white/10 mb-1"
                        >
                          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                          <span className="text-xs sm:text-sm">Quality</span>
                        </button>
                        {externalQualities && externalQualities.length > 0 ? (
                          // External quality list (API-sourced MP4 qualities)
                          externalQualities.map((q) => (
                            <button
                              key={q.id}
                              onClick={() => { onExternalQualityChange?.(q.id); setShowSettings(false); setSettingsMenu("main"); }}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg
                                transition-colors ${(selectedExternalQuality ?? externalQualities[0]?.id) === q.id ? "bg-white/10" : "hover:bg-white/5"}`}
                            >
                              <span className="text-xs sm:text-sm text-white">{q.label}</span>
                              {(selectedExternalQuality ?? externalQualities[0]?.id) === q.id && <Check className="w-3.5 h-3.5" style={{ color }} />}
                            </button>
                          ))
                        ) : (
                          // HLS auto-detected quality levels
                          <>
                            <button
                              onClick={() => handleQualityChange(-1)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg
                                transition-colors ${currentQuality === -1 ? "bg-white/10" : "hover:bg-white/5"}`}
                            >
                              <span className="text-xs sm:text-sm text-white">Auto</span>
                              {currentQuality === -1 && <Check className="w-3.5 h-3.5" style={{ color }} />}
                            </button>
                            {qualities.map((q) => (
                              <button
                                key={q.index}
                                onClick={() => handleQualityChange(q.index)}
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg
                                  transition-colors ${currentQuality === q.index ? "bg-white/10" : "hover:bg-white/5"}`}
                              >
                                <span className="text-xs sm:text-sm text-white">{q.height}p</span>
                                {currentQuality === q.index && <Check className="w-3.5 h-3.5" style={{ color }} />}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}

                    {settingsMenu === "speed" && (
                      <div className="p-1.5 max-h-[40vh] overflow-y-auto">
                        <button
                          onClick={() => setSettingsMenu("main")}
                          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-white/60 hover:text-white
                            border-b border-white/10 mb-1"
                        >
                          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                          <span className="text-xs sm:text-sm">Speed</span>
                        </button>
                        {speeds.map((speed) => (
                          <button
                            key={speed}
                            onClick={() => handleSpeedChange(speed)}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg
                              transition-colors ${playbackSpeed === speed ? "bg-white/10" : "hover:bg-white/5"}`}
                          >
                            <span className="text-xs sm:text-sm text-white">{speed}x</span>
                            {playbackSpeed === speed && <Check className="w-3.5 h-3.5" style={{ color }} />}
                          </button>
                        ))}
                      </div>
                    )}

                    {settingsMenu === "audio" && (
                      <div className="p-1.5 max-h-[40vh] overflow-y-auto">
                        <button
                          onClick={() => setSettingsMenu("main")}
                          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-white/60 hover:text-white
                            border-b border-white/10 mb-1"
                        >
                          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                          <span className="text-xs sm:text-sm">Audio Boost</span>
                        </button>
                        {[1, 1.5, 2, 2.5, 3, 4].map((boost) => (
                          <button
                            key={boost}
                            onClick={() => handleAudioBoostChange(boost)}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg
                              transition-colors ${audioBoost === boost ? "bg-white/10" : "hover:bg-white/5"}`}
                          >
                            <span className="text-xs sm:text-sm text-white">{boost === 1 ? "Normal" : `${boost}x Boost`}</span>
                            {audioBoost === boost && <Check className="w-3.5 h-3.5" style={{ color }} />}
                          </button>
                        ))}
                      </div>
                    )}

                    {settingsMenu === "audiotrack" && (
                      <div className="p-1.5 max-h-[40vh] overflow-y-auto">
                        <button
                          onClick={() => setSettingsMenu("main")}
                          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-white/60 hover:text-white
                            border-b border-white/10 mb-1"
                        >
                          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                          <span className="text-xs sm:text-sm">Language</span>
                        </button>
                        {externalAudioTracks && externalAudioTracks.length > 0 ? (
                          // External language list (API-sourced)
                          externalAudioTracks.map((track) => (
                            <button
                              key={track.id}
                              onClick={() => { onExternalAudioChange?.(track.id); setShowSettings(false); setSettingsMenu("main"); }}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg
                                transition-colors ${(selectedExternalAudio ?? externalAudioTracks[0]?.id) === track.id ? "bg-white/10" : "hover:bg-white/5"}`}
                            >
                              <span className="text-xs sm:text-sm text-white truncate">{track.label}</span>
                              {(selectedExternalAudio ?? externalAudioTracks[0]?.id) === track.id && <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />}
                            </button>
                          ))
                        ) : audioTracks.length === 0 ? (
                          <button
                            onClick={() => { setShowSettings(false); setSettingsMenu("main"); }}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                          >
                            <span className="text-xs sm:text-sm text-white">Default</span>
                            <Check className="w-3.5 h-3.5" style={{ color }} />
                          </button>
                        ) : (
                          audioTracks.map((track) => (
                            <button
                              key={track.index}
                              onClick={() => handleAudioTrackChange(track.index)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg
                                transition-colors ${activeAudioTrack === track.index ? "bg-white/10" : "hover:bg-white/5"}`}
                            >
                              <span className="text-xs sm:text-sm text-white truncate">{track.label}</span>
                              {activeAudioTrack === track.index && <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />}
                            </button>
                          ))
                        )}
                      </div>
                    )}

                    {settingsMenu === "subtitle_settings" && (
                      <div className="p-1.5 max-h-[40vh] overflow-y-auto">
                        <button
                          onClick={() => setSettingsMenu("main")}
                          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-white/60 hover:text-white
                                border-b border-white/10 mb-2"
                        >
                          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                          <span className="text-xs sm:text-sm">Subtitle Styles</span>
                        </button>

                        {/* Font Size */}
                        <div className="px-2.5 py-1 mb-2">
                          <span className="text-[10px] uppercase text-white/50 font-bold tracking-wider mb-1 block">Size</span>
                          <div className="flex gap-1">
                            {[{ l: "Small", v: "0.8rem" }, { l: "Normal", v: "1rem" }, { l: "Large", v: "1.5rem" }].map((bg) => (
                              <button
                                key={bg.l}
                                onClick={() => setSubSettings(prev => ({ ...prev, size: bg.v }))}
                                className={`flex-1 py-1 text-xs rounded border ${subSettings.size === bg.v ? "bg-white text-black border-white" : "bg-transparent text-white border-white/20"}`}
                              >
                                {bg.l}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Background */}
                        <div className="px-2.5 py-1 mb-2">
                          <span className="text-[10px] uppercase text-white/50 font-bold tracking-wider mb-1 block">Background</span>
                          <div className="flex gap-1">
                            {[{ l: "None", v: "transparent" }, { l: "Dim", v: "rgba(0,0,0,0.5)" }, { l: "Black", v: "rgba(0,0,0,1)" }].map((bg) => (
                              <button
                                key={bg.l}
                                onClick={() => setSubSettings(prev => ({ ...prev, backgroundColor: bg.v }))}
                                className={`flex-1 py-1 text-xs rounded border ${subSettings.backgroundColor === bg.v ? "bg-white text-black border-white" : "bg-transparent text-white border-white/20"}`}
                              >
                                {bg.l}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Color */}
                        <div className="px-2.5 py-1 mb-1">
                          <span className="text-[10px] uppercase text-white/50 font-bold tracking-wider mb-1 block">Color</span>
                          <div className="flex gap-1">
                            {[{ l: "White", v: "#FFFFFF" }, { l: "Yellow", v: "#FFFF00" }].map((col) => (
                              <button
                                key={col.l}
                                onClick={() => setSubSettings(prev => ({ ...prev, textColor: col.v }))}
                                className={`flex-1 py-1 text-xs rounded border ${subSettings.textColor === col.v ? "bg-white text-black border-white" : "bg-transparent text-white border-white/20"}`}
                              >
                                {col.l}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Position */}
                        <div className="px-2.5 py-1 mb-1">
                          <span className="text-[10px] uppercase text-white/50 font-bold tracking-wider mb-1 block">Position</span>
                          <div className="flex gap-1">
                            {[{ l: "Low", v: "5%" }, { l: "Normal", v: "10%" }, { l: "High", v: "20%" }].map((pos) => (
                              <button
                                key={pos.l}
                                onClick={() => setSubSettings(prev => ({ ...prev, bottom: pos.v }))}
                                className={`flex-1 py-1 text-xs rounded border ${subSettings.bottom === pos.v ? "bg-white text-black border-white" : "bg-transparent text-white border-white/20"}`}
                              >
                                {pos.l}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Fullscreen */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullscreen();
                }}
                className="w-10 h-10 flex items-center justify-center rounded-full
                  hover:bg-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
              >
                {isFullscreen ? (
                  <Minimize className="w-5 h-5 text-white" />
                ) : (
                  <Maximize className="w-5 h-5 text-white" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Custom Styles */}
        <style dangerouslySetInnerHTML={{ __html: `
          video::-webkit-media-controls {
            display: none !important;
          }
          video::-webkit-media-controls-enclosure {
            display: none !important;
          }
          video::cue {
            font-size: ${subSettings.size} !important;
            background-color: ${subSettings.backgroundColor} !important;
            color: ${subSettings.textColor} !important;
            text-shadow: 0 0 2px black;
            line-height: normal; 
          }
          video::-webkit-media-text-track-display {
            transform: translateY(-${parseInt(subSettings.bottom) - 10}%);
          }
          video::-webkit-media-text-track-container {
            bottom: ${subSettings.bottom} !important;
          }
        `}} />
      </div>
    );
  }
);

PremiumPlayer.displayName = "PremiumPlayer";

export default PremiumPlayer;
