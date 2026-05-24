import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return "0:00"
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}

export function formatBytes(b: number | null): string {
  if (!b || b <= 0) return ""
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + " GB"
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB"
  return (b / 1024).toFixed(0) + " KB"
}

export function formatNumber(n: number): string {
  if (!n || n <= 0) return ""
  if (n >= 1000000000) return (n / 1000000000).toFixed(1) + "B"
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M"
  if (n >= 1000) return (n / 1000).toFixed(1) + "K"
  return String(n)
}

export function detectPlatform(url: string): Platform {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube"
  if (/instagram\.com/i.test(url)) return "instagram"
  if (/facebook\.com|fb\.watch/i.test(url)) return "facebook"
  if (/tiktok\.com/i.test(url)) return "tiktok"
  if (/twitter\.com|x\.com/i.test(url)) return "twitter"
  return "unknown"
}

export type Platform = "youtube" | "instagram" | "facebook" | "tiktok" | "twitter" | "unknown"

export interface PlatformInfo {
  name: string
  color: string
  bgClass: string
  borderClass: string
}

export const platformMeta: Record<Platform, PlatformInfo> = {
  youtube: { name: "YouTube", color: "#FF0000", bgClass: "bg-red-500/10", borderClass: "border-red-500/30" },
  instagram: { name: "Instagram", color: "#E1306C", bgClass: "bg-pink-500/10", borderClass: "border-pink-500/30" },
  facebook: { name: "Facebook", color: "#1877F2", bgClass: "bg-blue-500/10", borderClass: "border-blue-500/30" },
  tiktok: { name: "TikTok", color: "#00F2EA", bgClass: "bg-cyan-300/10", borderClass: "border-cyan-300/30" },
  twitter: { name: "X / Twitter", color: "#1DA1F2", bgClass: "bg-sky-500/10", borderClass: "border-sky-500/30" },
  unknown: { name: "Video", color: "#00F0FF", bgClass: "bg-neon-cyan/10", borderClass: "border-neon-cyan/20" },
}

export interface VideoQuality {
  label: string
  height: number
  format_id: string
  ext: string
  filesize: number | null
  vcodec: string
  acodec: string
  vbr: number | null
  abr: number | null
  tbr: number | null
}

export interface VideoInfo {
  title: string
  thumbnail: string | null
  duration: number
  description: string
  platform: Platform
  qualities: VideoQuality[]
  uploader: string
  view_count: number
  like_count: number
}

export interface RecentDownload {
  platform: Platform
  title: string
  quality: string
  filename: string
  time: string
}
