import { useState, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

import ParticleField from "@/components/ParticleField";
import ScanPanel from "@/components/ScanPanel";
import StatusPanel from "@/components/StatusPanel";
import JarvisOverlay from "@/components/JarvisOverlay";
import ResultCard, { MediaResult } from "@/components/ResultCard";

import { useVoice } from "@/hooks/useVoice";
import { Shield } from "lucide-react";

type Phase = "idle" | "scanning" | "result";

interface ScanRequest {
  url: string;
  files: File[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getMediaType = (fileType: string): MediaResult["mediaType"] => {
  if (fileType.startsWith("video/")) return "video";
  if (fileType.startsWith("audio/")) return "audio";
  return "image";
};

const resolveFinalPrediction = (
  rawPrediction: string | undefined,
  score: number | undefined,
  threshold: number | undefined,
): "Real" | "Fake" | undefined => {
  if (!rawPrediction) return undefined;

  const normalized = rawPrediction.trim().toLowerCase();
  if (normalized === "real") return "Real";
  if (normalized === "fake") return "Fake";

  const cut = typeof threshold === "number" ? threshold : 0.5;
  const value = typeof score === "number" ? score : 0.5;
  return value >= cut ? "Real" : "Fake";
};

const Index = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<MediaResult[]>([]);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  const { speak, stop } = useVoice();
  const activeScanIdRef = useRef(0);

  /*
  ---------------------------
  BACKEND HEALTH CHECK
  ---------------------------
  */

  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8001/health");
        setBackendConnected(res.ok);
      } catch {
        setBackendConnected(false);
      }
    };

    checkBackend();
    const interval = setInterval(checkBackend, 10000);

    return () => clearInterval(interval);
  }, []);

  /*
  ---------------------------
  START SCAN
  ---------------------------
  */

  const startScan = useCallback(async (payload: ScanRequest) => {
    if (!payload.files.length || phase === "scanning") return;

    if (backendConnected === false) {
      alert("Backend is offline. Please start FastAPI server and try again.");
      return;
    }

    activeScanIdRef.current += 1;
    const scanId = activeScanIdRef.current;

    setPhase("scanning");
    setResults([]);
    setProgress(0);

    const scanStartedAt = Date.now();

    const builtResults: MediaResult[] = [];
    const failedFiles: string[] = [];

    for (let i = 0; i < payload.files.length; i++) {
      if (scanId !== activeScanIdRef.current) {
        return;
      }

      const file = payload.files[i];

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("http://127.0.0.1:8001/scan", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          throw new Error(`Scan failed for ${file.name} (${res.status})`);
        }

        const data = await res.json();

        const apiType = typeof data?.type === "string" ? data.type : getMediaType(file.type);
        const detections = Array.isArray(data?.detections) ? data.detections : [];
        const imageResult = data?.result && typeof data.result === "object" ? data.result : null;

        const confidence = typeof imageResult?.confidence === "number" ? imageResult.confidence : undefined;
        const score = typeof imageResult?.score === "number" ? imageResult.score : undefined;
        const threshold = typeof imageResult?.threshold === "number" ? imageResult.threshold : undefined;
        const predictionRaw = typeof imageResult?.prediction === "string" ? imageResult.prediction : undefined;
        const prediction = resolveFinalPrediction(predictionRaw, score, threshold);
        const detector = typeof imageResult?.detector === "string" ? imageResult.detector : undefined;
        const qualityWarnings = Array.isArray(imageResult?.quality?.warnings)
          ? imageResult.quality.warnings.filter((w: unknown) => typeof w === "string")
          : [];

        builtResults.push({
          id: `${file.name}-${i}`,
          filename: file.name,
          mediaType: apiType === "video" || apiType === "audio" || apiType === "image" ? apiType : getMediaType(file.type),
          detections,
          prediction,
          confidence,
          score,
          threshold,
          detector,
          qualityWarnings,
        });

      } catch (err) {
        failedFiles.push(file.name);
        builtResults.push({
          id: `${file.name}-${i}`,
          filename: file.name,
          mediaType: getMediaType(file.type),
          detections: [],
          prediction: "Error",
          qualityWarnings: ["scan_failed"],
        });

      }

      setProgress(((i + 1) / payload.files.length) * 100);

      await sleep(220);
    }

    const minOverlayMs = 1200;
    const elapsed = Date.now() - scanStartedAt;

    if (elapsed < minOverlayMs) {
      await sleep(minOverlayMs - elapsed);
    }

    if (scanId !== activeScanIdRef.current) {
      return;
    }

    setResults(builtResults);

    setPhase("result");

    if (failedFiles.length > 0) {
      speak("Scan completed with some errors");
      alert(`Scan completed, but ${failedFiles.length} file(s) failed: ${failedFiles.join(", ")}`);
      return;
    }

    speak("Analysis complete");
  }, [backendConnected, phase, speak]);

  /*
  ---------------------------
  RESTORE
  ---------------------------
  */

  const restore = useCallback(() => {
    activeScanIdRef.current += 1;
    stop();
    setResults([]);
    setProgress(0);
    setPhase("idle");
  }, [stop]);

  return (
    <div className="min-h-screen relative">

      <ParticleField />

      {/* HEADER */}

      <motion.header
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 flex items-center justify-between px-8 py-6"
      >

        <div className="flex items-center gap-3">

          <Shield
            className="w-8 h-8"
            style={{
              color: "var(--dd-cyan)",
              filter: "drop-shadow(0 0 8px rgba(34,211,238,0.5))"
            }}
          />

          <div>
            <h1 className="text-xl font-black tracking-wider text-glow-cyan">
              DEEP-DEFEND
            </h1>

            <span className="font-mono-hud text-[10px] text-muted-foreground tracking-[0.3em]">
              v4.0 // NEURAL DEFENSE SYSTEM
            </span>
          </div>

        </div>

        <div className="flex items-center gap-4">

          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: backendConnected ? "#22d3ee" : "#ef4444"
            }}
          />

          <span className="font-mono-hud text-xs text-glow-cyan">
            {backendConnected ? "BACKEND CONNECTED" : "BACKEND OFFLINE"}
          </span>

        </div>

      </motion.header>

      {/* MAIN */}

      <main className="relative z-10 px-8 py-4 max-w-7xl mx-auto">

        <div className="grid md:grid-cols-2 gap-8">

          <ScanPanel
            onScan={startScan}
            isScanning={phase === "scanning"}
            backendConnected={backendConnected}
          />

          <StatusPanel
            progress={progress}
            isScanning={phase === "scanning"}
            backendConnected={backendConnected}
          />

        </div>

      </main>

      {/* SCANNING OVERLAY */}

      <AnimatePresence>

        {phase === "scanning" && (
          <JarvisOverlay
            progress={Math.round(progress)}
            onComplete={() => {}}
          />
        )}

      </AnimatePresence>

      {/* RESULT */}

      <AnimatePresence>

        {phase === "result" && results.length > 0 && (

          <ResultCard
            results={results}
            onRestore={restore}
          />

        )}

      </AnimatePresence>

    </div>
  );
};

export default Index;