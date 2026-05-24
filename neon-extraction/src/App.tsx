import { useState, useCallback, useRef, useEffect } from "react"
import {
  Link, Play, Download, Search, Eye, Heart, Clock, Youtube,
  Instagram, Facebook, Music2, ChevronDown, Zap, Shield,
  ArrowDownToLine, CheckCircle2, AlertCircle, Loader2, X
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  cn, formatDuration, formatBytes, formatNumber,
  detectPlatform, platformMeta, type Platform, type VideoInfo, type VideoQuality, type RecentDownload
} from "@/lib/utils"

type AppState = "idle" | "scanning" | "info" | "downloading" | "done" | "error"

export default function App() {
  const [url, setUrl] = useState("")
  const [state, setState] = useState<AppState>("idle")
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [selectedQuality, setSelectedQuality] = useState<VideoQuality | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [recentDownloads, setRecentDownloads] = useState<RecentDownload[]>([])
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null)
  const [hoveredQuality, setHoveredQuality] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const platform = url ? detectPlatform(url) : null

  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ msg, type })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  const handleScan = useCallback(async () => {
    if (!url.trim()) return
    setState("scanning")

    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Extraction failed")

      setVideoInfo(data)
      const best = data.qualities?.find((q: VideoQuality) => q.height >= 1080) || data.qualities?.[0]
      setSelectedQuality(best || null)
      setState("info")
      showToast("Video extracted successfully", "success")
    } catch (err: any) {
      setState("error")
      showToast(err.message || "Failed to extract video info", "error")
      setTimeout(() => setState("idle"), 2000)
    }
  }, [url, showToast])

  const handleDownload = useCallback(async () => {
    if (!videoInfo || !selectedQuality) return
    setState("downloading")
    setDownloadProgress(0)

    const progressInterval = setInterval(() => {
      setDownloadProgress(p => {
        const next = p + Math.random() * 8
        return next > 90 ? 90 : next
      })
    }, 500)

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "manual",
        body: JSON.stringify({
          url: url.trim(),
          quality: selectedQuality.label,
          format_id: selectedQuality.format_id,
        }),
      })

      clearInterval(progressInterval)

      if (res.status === 302 || res.status === 301) {
        const redirectUrl = res.headers.get("Location") || res.headers.get("location")
        if (redirectUrl) {
          window.open(redirectUrl, "_blank")
          setDownloadProgress(100)
          setState("done")
          showToast(`Download started — ${selectedQuality.label}`, "success")
          setRecentDownloads(prev => [
            {
              platform: videoInfo.platform,
              title: videoInfo.title,
              quality: selectedQuality.label,
              filename: videoInfo.title,
              time: new Date().toLocaleTimeString(),
            },
            ...prev.slice(0, 4),
          ])
          setTimeout(() => setState("info"), 2000)
          return
        }
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Download failed" }))
        throw new Error(err.error || "Download failed")
      }

      const contentType = res.headers.get("content-type") || ""

      if (contentType.includes("json")) {
        const data = await res.json()
        if (data.type === "multi" && data.videoUrl) {
          window.open(data.videoUrl, "_blank")
          setDownloadProgress(100)
          setState("done")
          showToast(`Download started — ${selectedQuality.label} (video only)`, "success")
          setRecentDownloads(prev => [
            {
              platform: videoInfo.platform,
              title: videoInfo.title,
              quality: selectedQuality.label,
              filename: data.filename || "video.mp4",
              time: new Date().toLocaleTimeString(),
            },
            ...prev.slice(0, 4),
          ])
          setTimeout(() => setState("info"), 2000)
          return
        }
        throw new Error("Unexpected response format")
      }

      setDownloadProgress(100)

      if (contentType.includes("video") || contentType.includes("octet-stream")) {
        const blob = await res.blob()
        const cd = res.headers.get("content-disposition")
        let filename = "video.mp4"
        if (cd) {
          const match = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
          if (match) filename = match[1].replace(/['"]/g, "")
        }

        const a = document.createElement("a")
        a.href = URL.createObjectURL(blob)
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(a.href)
      }

      setState("done")
      showToast(`Download complete — ${selectedQuality.label}`, "success")

      setRecentDownloads(prev => [
        {
          platform: videoInfo.platform,
          title: videoInfo.title,
          quality: selectedQuality.label,
          filename,
          time: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 4),
      ])

      setTimeout(() => setState("info"), 2000)
    } catch (err: any) {
      clearInterval(progressInterval)
      setState("info")
      showToast(err.message || "Download failed", "error")
    }
  }, [videoInfo, selectedQuality, url, showToast])

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && /^https?:\/\//i.test(text)) {
        setUrl(text)
      }
    } catch {}
  }, [])

  useEffect(() => {
    loadRecent()
  }, [])

  async function loadRecent() {
    try {
      const res = await fetch("/api/recent")
      const data = await res.json()
      if (data.length > 0) {
        setRecentDownloads(data.slice(0, 5).map((item: any) => ({
          platform: item.platform,
          title: item.fileName,
          quality: item.quality,
          filename: item.fileName,
          time: new Date(item.time).toLocaleTimeString(),
        })))
      }
    } catch {}
  }

  const PlatformIcon = ({ p, size = 14 }: { p: Platform; size?: number }) => {
    const props = { width: size, height: size }
    switch (p) {
      case "youtube": return <Youtube {...props} />
      case "instagram": return <Instagram {...props} />
      case "facebook": return <Facebook {...props} />
      case "tiktok": return <Music2 {...props} />
      case "twitter": return <X {...props} />
      default: return <Play {...props} />
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background layers */}
      <div className="fixed inset-0 grid-bg pointer-events-none" />
      <div className="fixed inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0,240,255,0.06), transparent), radial-gradient(ellipse 60% 50% at 80% 100%, rgba(255,45,120,0.04), transparent)"
      }} />
      <div className="fixed inset-0 noise-bg pointer-events-none opacity-35" />
      <div className="fixed inset-0 scanlines-bg pointer-events-none opacity-40" />

      {/* Floating particles */}
      <Particles />

      {/* Toast */}
      {toast && (
        <div className={cn(
          "fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-lg glass-panel font-mono text-xs",
          toast.type === "error" && "border-neon-magenta/30 text-neon-magenta",
          toast.type === "success" && "border-neon-green/30 text-neon-green",
          "animate-fade-in-up"
        )}>
          {toast.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-2 opacity-50 hover:opacity-100"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Main content */}
      <div className="relative z-10 max-w-[780px] mx-auto px-6 py-10 pb-20">
        {/* Header */}
        <header className="text-center mb-14 animate-fade-in-up">
          {/* Logo */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl border border-neon-cyan/60 bg-neon-cyan/5 mb-4 relative overflow-hidden box-glow-cyan">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-neon-cyan/10 to-transparent animate-scan-sweep" />
            <Play className="w-7 h-7 text-neon-cyan relative z-10 fill-neon-cyan/20" />
          </div>

          <h1 className="font-mono text-4xl sm:text-5xl font-extrabold tracking-tight leading-none text-white text-glow-cyan">
            <GlitchText text="NEON" />{" "}
            <span className="text-neon-cyan">EXTRACTION</span>
          </h1>
          <p className="font-mono text-xs font-light tracking-[0.3em] uppercase text-muted-foreground mt-2">
            Video Extraction Engine
          </p>

          {/* Platform badges */}
          <div className="flex justify-center gap-3 mt-5 flex-wrap">
            {(["youtube", "instagram", "facebook", "tiktok"] as Platform[]).map(p => (
              <div
                key={p}
                className={cn(
                  "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full glass-panel font-mono text-[0.65rem] tracking-wide text-muted-foreground transition-all hover:border-neon-cyan/30 hover:text-foreground"
                )}
              >
                <PlatformIcon p={p} size={13} />
                {platformMeta[p].name}
              </div>
            ))}
          </div>
        </header>

        {/* URL Input Section */}
        <section className="mb-8 animate-fade-in-up" style={{ animationDelay: "0.15s" }}>
          <Card className="relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-neon-cyan/40 to-transparent" />
            <CardContent className="p-8">
              {/* Label */}
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan shadow-[0_0_8px_rgba(0,240,255,0.8)] animate-pulse-glow" />
                <span className="font-mono text-[0.6rem] font-medium tracking-[0.15em] uppercase text-muted-foreground">
                  Target URL
                </span>
              </div>

              {/* Input */}
              <div className="relative group">
                <input
                  ref={inputRef}
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && url.trim() && handleScan()}
                  placeholder="Paste video link here..."
                  className={cn(
                    "w-full py-4 pl-12 pr-24 rounded-xl font-mono text-sm bg-deep-50/90 border transition-all outline-none",
                    "placeholder:text-muted-foreground/60 placeholder:font-light",
                    state === "scanning"
                      ? "border-neon-cyan focus:border-neon-cyan"
                      : "border-neon-cyan/10 focus:border-neon-cyan focus:shadow-[0_0_0_3px_rgba(0,240,255,0.08),0_0_30px_rgba(0,240,255,0.06)]"
                  )}
                  spellCheck={false}
                  autoComplete="off"
                />
                <Link className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-neon-cyan transition-colors" />

                {/* Scan bar */}
                {state === "scanning" && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-neon-cyan shadow-[0_0_20px_rgba(0,240,255,1),0_0_60px_rgba(0,240,255,0.3)] animate-scan-bar" />
                )}

                {/* Platform detect badge */}
                {platform && platform !== "unknown" && (
                  <div className={cn(
                    "absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full",
                    "bg-neon-cyan/10 border border-neon-cyan/25 font-mono text-[0.55rem] font-semibold tracking-wider uppercase text-neon-cyan",
                    "transition-all duration-300"
                  )}>
                    <PlatformIcon p={platform} size={11} />
                    {platformMeta[platform].name}
                  </div>
                )}

                {/* Paste button */}
                {!url && (
                  <button
                    onClick={handlePaste}
                    className="absolute right-3 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full bg-neon-cyan/5 border border-neon-cyan/15 font-mono text-[0.55rem] text-muted-foreground hover:text-neon-cyan hover:border-neon-cyan/30 transition-all"
                  >
                    PASTE
                  </button>
                )}
              </div>

              {/* Extract button */}
              <Button
                variant="neon"
                size="lg"
                className="w-full mt-4 h-12 text-xs rounded-xl"
                disabled={!url.trim() || state === "scanning"}
                onClick={handleScan}
              >
                {state === "scanning" ? (
                  <span className="flex items-center gap-2.5">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Scanning...
                  </span>
                ) : (
                  <span className="flex items-center gap-2.5">
                    <Search className="w-4 h-4" />
                    Extract Video Info
                  </span>
                )}
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* Video Info Card */}
        {videoInfo && (state === "info" || state === "downloading" || state === "done") && (
          <section className="mb-8 animate-card-reveal">
            <Card>
              <CardContent className="p-7">
                {/* Video info */}
                <div className="flex gap-5 mb-6">
                  {/* Thumbnail */}
                  <div className="shrink-0 w-48 h-[108px] rounded-lg overflow-hidden border border-neon-cyan/10 bg-deep relative hidden sm:block">
                    {videoInfo.thumbnail && (
                      <img
                        src={videoInfo.thumbnail}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    )}
                    <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 font-mono text-[0.6rem] text-white">
                      {formatDuration(videoInfo.duration)}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[0.55rem] font-semibold tracking-wider uppercase mb-2 border",
                      platformMeta[videoInfo.platform].bgClass,
                      platformMeta[videoInfo.platform].borderClass
                    )} style={{ color: platformMeta[videoInfo.platform].color }}>
                      <PlatformIcon p={videoInfo.platform} size={10} />
                      {platformMeta[videoInfo.platform].name}
                    </div>
                    <h3 className="font-sans text-base font-semibold text-white leading-snug line-clamp-2 mb-1">
                      {videoInfo.title}
                    </h3>
                    {videoInfo.uploader && (
                      <p className="font-mono text-[0.65rem] text-muted-foreground mb-2">
                        by {videoInfo.uploader}
                      </p>
                    )}
                    <div className="flex gap-3 font-mono text-[0.6rem] text-muted-foreground">
                      {videoInfo.view_count > 0 && (
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3 opacity-50" />{formatNumber(videoInfo.view_count)} views</span>
                      )}
                      {videoInfo.like_count > 0 && (
                        <span className="flex items-center gap-1"><Heart className="w-3 h-3 opacity-50" />{formatNumber(videoInfo.like_count)} likes</span>
                      )}
                      {videoInfo.duration > 0 && (
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3 opacity-50" />{formatDuration(videoInfo.duration)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Separator */}
                <div className="h-px bg-gradient-to-r from-transparent via-neon-cyan/15 to-transparent mb-6" />

                {/* Quality selector */}
                <div className="mb-2">
                  <span className="font-mono text-[0.6rem] font-medium tracking-[0.15em] uppercase text-muted-foreground">
                    Select Quality
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
                  {videoInfo.qualities.map((q, i) => (
                    <button
                      key={q.label}
                      onClick={() => setSelectedQuality(q)}
                      onMouseEnter={() => setHoveredQuality(i)}
                      onMouseLeave={() => setHoveredQuality(null)}
                      className={cn(
                        "relative p-3.5 rounded-lg border text-left transition-all overflow-hidden",
                        selectedQuality?.label === q.label
                          ? "border-neon-cyan box-glow-cyan bg-neon-cyan/5"
                          : "border-neon-cyan/10 bg-deep-50/80 hover:border-neon-cyan/25"
                      )}
                      style={{ animationDelay: `${i * 0.08}s` }}
                    >
                      {/* HD badge */}
                      {q.height >= 1080 && (
                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-neon-magenta/15 border border-neon-magenta/30 font-mono text-[0.45rem] font-bold tracking-wider text-neon-magenta">
                          HD
                        </span>
                      )}

                      <div className={cn(
                        "font-mono text-base font-bold transition-colors",
                        selectedQuality?.label === q.label ? "text-neon-cyan text-glow-cyan" : "text-white"
                      )}>
                        {q.label}
                      </div>
                      <div className="font-mono text-[0.55rem] text-muted-foreground mt-0.5">
                        {q.ext.toUpperCase()}{q.vbr ? ` · ${Math.round(q.vbr)}kbps` : ""}
                      </div>
                      {q.filesize && (
                        <div className="font-mono text-[0.5rem] text-neon-cyan/70 mt-1">
                          ≈ {formatBytes(q.filesize)}
                        </div>
                      )}

                      {/* Hover glow */}
                      {(hoveredQuality === i || selectedQuality?.label === q.label) && (
                        <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/8 to-transparent pointer-events-none" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Download button */}
                <Button
                  variant="neon-solid"
                  size="lg"
                  className="w-full h-14 rounded-xl text-sm relative overflow-hidden"
                  disabled={!selectedQuality || state === "downloading"}
                  onClick={handleDownload}
                >
                  {/* Shimmer effect */}
                  <div className="absolute -inset-1/2 bg-conic-gradient from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 animate-shimmer pointer-events-none" />

                  {state === "downloading" ? (
                    <span className="flex items-center gap-2.5 relative z-10">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </span>
                  ) : state === "done" ? (
                    <span className="flex items-center gap-2.5 relative z-10">
                      <CheckCircle2 className="w-4 h-4" />
                      Downloaded!
                    </span>
                  ) : (
                    <span className="flex items-center gap-2.5 relative z-10">
                      <ArrowDownToLine className="w-4 h-4" />
                      Download {selectedQuality?.label || "Full HD"}
                      {selectedQuality && selectedQuality.height >= 1080 && " Full HD"}
                    </span>
                  )}
                </Button>

                {/* Progress bar */}
                {state === "downloading" && (
                  <div className="mt-3">
                    <Progress value={downloadProgress} className="h-1" />
                    <div className="flex justify-between mt-1 font-mono text-[0.55rem] text-muted-foreground">
                      <span>Downloading...</span>
                      <span>{Math.round(downloadProgress)}%</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Recent Downloads */}
        <section className="animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
          <div className="flex items-center gap-2.5 mb-5">
            <span className="font-mono text-[0.6rem] font-medium tracking-[0.2em] uppercase text-muted-foreground">
              Recent Extractions
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-neon-cyan/15 to-transparent" />
          </div>

          {recentDownloads.length === 0 ? (
            <div className="text-center py-12 font-mono text-[0.65rem] text-muted-foreground/50 tracking-wide">
              <ArrowDownToLine className="w-8 h-8 mx-auto mb-3 opacity-20" />
              No downloads yet — paste a URL to begin
            </div>
          ) : (
            <div className="space-y-2">
              {recentDownloads.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3.5 p-3.5 rounded-lg glass-panel hover:border-neon-cyan/20 transition-all animate-fade-in-up"
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <div className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                    platformMeta[item.platform].bgClass
                  )} style={{ color: platformMeta[item.platform].color }}>
                    <PlatformIcon p={item.platform} size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[0.7rem] font-medium text-white truncate">
                      {item.title || item.filename}
                    </div>
                    <div className="font-mono text-[0.55rem] text-muted-foreground mt-0.5 flex gap-3">
                      <span>{item.time}</span>
                      <span>{platformMeta[item.platform].name}</span>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-neon-cyan/8 border border-neon-cyan/15 font-mono text-[0.55rem] font-semibold tracking-wider text-neon-cyan shrink-0">
                    {item.quality}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="text-center mt-16 pt-6 border-t border-neon-cyan/10 font-mono text-[0.55rem] text-muted-foreground tracking-widest animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
          <span className="text-neon-cyan">NEON EXTRACTION</span> — Social Video Downloader · For personal use only
        </footer>
      </div>
    </div>
  )
}

function GlitchText({ text }: { text: string }) {
  return (
    <span className="relative inline-block">
      {text}
      <span
        className="absolute inset-0 text-neon-magenta animate-glitch-1"
        style={{ clipPath: "inset(0 0 65% 0)" }}
        aria-hidden
      >
        {text}
      </span>
      <span
        className="absolute inset-0 text-neon-cyan animate-glitch-2"
        style={{ clipPath: "inset(65% 0 0 0)" }}
        aria-hidden
      >
        {text}
      </span>
    </span>
  )
}

function Particles() {
  const count = 25
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={cn(
            "absolute w-[2px] h-[2px] rounded-full opacity-0 animate-float-up",
            i % 4 === 0 ? "bg-neon-magenta" : "bg-neon-cyan"
          )}
          style={{
            left: `${(i / count) * 100}%`,
            animationDelay: `${Math.random() * 8}s`,
            animationDuration: `${6 + Math.random() * 6}s`,
          }}
        />
      ))}
    </div>
  )
}
